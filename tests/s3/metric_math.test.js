'use strict';
/* S3 Acceptance Gate — literal count / rate arithmetic and zero-denominator
 * handling (S3-T06, T07, T08, T09, T10, T11). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv, addTrials } = require('./helpers/build_env.js');

test('S3-T06: empty snapshot is deterministic — zero-filled, no NaN/Infinity, called twice deep-equal', async () => {
  const env = await buildEnv([{ player_id: 'plr_empty', display_name: 'Empty' }]);
  const snap1 = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_empty' });
  const snap2 = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_empty' });

  assert.equal(snap1.player_id, 'plr_empty');
  assert.equal(snap1.snapshot_version, 'PB30-50-S3-OBS-v1');
  assert.deepEqual(snap1.coverage, {
    master_count_total: 13, master_count_with_evidence: 0, master_count_without_evidence: 13,
    drill_count_total: 35, drill_count_with_evidence: 0, drill_count_without_evidence: 35,
    session_count: 0, evidence_date_first: null, evidence_date_last: null
  });
  assert.deepEqual(snap1.overall, {
    trial_count_total: 0, outcome_S_count: 0, outcome_P_count: 0, outcome_F_count: 0, outcome_I_count: 0,
    valid_trial_count: 0,
    S_rate_total: null, P_rate_total: null, F_rate_total: null, I_rate_total: null,
    S_rate_valid: null, P_rate_valid: null, F_rate_valid: null
  });
  assert.equal(snap1.by_master.length, 13);
  assert.equal(snap1.by_drill.length, 35);
  assert.ok(snap1.by_kpi.length > 0);
  snap1.by_master.forEach((r) => assert.equal(r.trial_count_total, 0));
  snap1.by_drill.forEach((r) => assert.equal(r.trial_count_total, 0));
  snap1.by_kpi.forEach((r) => assert.equal(r.trial_count_total, 0));
  assert.deepEqual(snap1.integrity, { unknown_drill_ids: [], unknown_master_ids: [], mismatched_master_ids: [], unknown_session_ids: [] });

  // No JSON value is ever NaN/Infinity — round-trip through JSON and check for finite/null only on every rate field.
  const roundTripped = JSON.parse(JSON.stringify(snap1));
  [...roundTripped.by_master, ...roundTripped.by_drill, ...roundTripped.by_kpi, roundTripped.overall].forEach((row) => {
    ['S_rate_total', 'P_rate_total', 'F_rate_total', 'I_rate_total', 'S_rate_valid', 'P_rate_valid', 'F_rate_valid'].forEach((k) => {
      assert.ok(row[k] === null || Number.isFinite(row[k]), k + ' must be null or finite');
    });
  });

  assert.deepStrictEqual(snap1, snap2, 'identical filter input must produce a deep-equal snapshot');
});

test('S3-T07/T08/T09: S/P/F/I counts and total/valid rates are exact', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  // 2 S, 1 P, 1 F, 1 I => total=5, valid=4
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S', 'S', 'P', 'F', 'I']);

  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1' });
  assert.deepEqual(
    { S: snap.overall.outcome_S_count, P: snap.overall.outcome_P_count, F: snap.overall.outcome_F_count, I: snap.overall.outcome_I_count },
    { S: 2, P: 1, F: 1, I: 1 }
  );
  assert.equal(snap.overall.trial_count_total, 5);
  assert.equal(snap.overall.valid_trial_count, 4);
  assert.equal(snap.overall.S_rate_total, 2 / 5);
  assert.equal(snap.overall.P_rate_total, 1 / 5);
  assert.equal(snap.overall.F_rate_total, 1 / 5);
  assert.equal(snap.overall.I_rate_total, 1 / 5);
  assert.equal(snap.overall.S_rate_valid, 2 / 4);
  assert.equal(snap.overall.P_rate_valid, 1 / 4);
  assert.equal(snap.overall.F_rate_valid, 1 / 4);
  assert.equal('I_rate_valid' in snap.overall, false, 'I has no valid-denominator rate (I is excluded from the valid denominator by definition)');
});

test('S3-T10: zero denominator produces null on a per-row basis, not just when the whole snapshot is empty', async () => {
  const env = await buildEnv([{ player_id: 'plr_2', display_name: 'P2' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_2', session_date: '2026-08-01' });
  // Only one drill (DRILL-BALANCE, Master FM-01) has evidence — every other of the 34 drills / 12 masters must show null rates.
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S']);

  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_2' });
  const untouchedDrill = snap.by_drill.find((r) => r.source_drill_id === 'DRILL-SERVE-DEPTH');
  assert.equal(untouchedDrill.trial_count_total, 0);
  assert.equal(untouchedDrill.S_rate_total, null);
  assert.equal(untouchedDrill.S_rate_valid, null);

  const untouchedMaster = snap.by_master.find((r) => r.master_id === 'FM-02');
  assert.equal(untouchedMaster.trial_count_total, 0);
  assert.equal(untouchedMaster.S_rate_total, null);

  const touchedDrill = snap.by_drill.find((r) => r.source_drill_id === 'DRILL-BALANCE');
  assert.equal(touchedDrill.S_rate_total, 1);
  assert.equal(touchedDrill.S_rate_valid, 1);
});

test('S3-T11: session de-dup — multiple trials in the same session for the same drill count as one session', async () => {
  const env = await buildEnv([{ player_id: 'plr_3', display_name: 'P3' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_3', session_date: '2026-08-01' });
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S', 'P', 'F']);

  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_3' });
  const row = snap.by_drill.find((r) => r.source_drill_id === 'DRILL-BALANCE');
  assert.equal(row.trial_count_total, 3, 'three trials recorded');
  assert.equal(row.session_count, 1, 'but only one distinct session');
  assert.equal(snap.coverage.session_count, 1);

  const masterRow = snap.by_master.find((r) => r.master_id === 'FM-01');
  assert.equal(masterRow.session_count, 1);
});
