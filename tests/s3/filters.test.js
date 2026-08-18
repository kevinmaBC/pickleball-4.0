'use strict';
/* S3 Acceptance Gate — filter semantics (S3-T24 player, T25 date, T26 session, T27 Drill, T28 Master). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv, addTrials } = require('./helpers/build_env.js');

test('S3-T24: player filter — snapshot for player A never includes player B evidence', async () => {
  const env = await buildEnv([
    { player_id: 'plr_a', display_name: 'A' },
    { player_id: 'plr_b', display_name: 'B' }
  ]);
  const sessA = await env.pbTrainingEvidence.createSession({ player_id: 'plr_a', session_date: '2026-08-01' });
  const sessB = await env.pbTrainingEvidence.createSession({ player_id: 'plr_b', session_date: '2026-08-01' });
  await addTrials(env.pbTrainingEvidence, sessA.training_session_id, 'DRILL-BALANCE', ['S']);
  await addTrials(env.pbTrainingEvidence, sessB.training_session_id, 'DRILL-BALANCE', ['F', 'F']);

  const snapA = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_a' });
  assert.equal(snapA.overall.trial_count_total, 1);
  assert.equal(snapA.overall.outcome_S_count, 1);
  assert.equal(snapA.overall.outcome_F_count, 0);

  const snapB = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_b' });
  assert.equal(snapB.overall.trial_count_total, 2);
  assert.equal(snapB.overall.outcome_F_count, 2);
});

test('S3-T25: date_from/date_to are inclusive bounds applied to session_date', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const sEarly = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-07-01' });
  const sMid = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  const sLate = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-09-01' });
  await addTrials(env.pbTrainingEvidence, sEarly.training_session_id, 'DRILL-BALANCE', ['S']);
  await addTrials(env.pbTrainingEvidence, sMid.training_session_id, 'DRILL-BALANCE', ['P']);
  await addTrials(env.pbTrainingEvidence, sLate.training_session_id, 'DRILL-BALANCE', ['F']);

  const inRange = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1', date_from: '2026-08-01', date_to: '2026-08-31' });
  assert.equal(inRange.overall.trial_count_total, 1);
  assert.equal(inRange.overall.outcome_P_count, 1);

  const boundaryFrom = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1', date_from: '2026-08-01', date_to: '2026-08-01' });
  assert.equal(boundaryFrom.overall.trial_count_total, 1, 'date_from bound is inclusive');

  const openEnded = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1', date_from: '2026-08-01', date_to: null });
  assert.equal(openEnded.overall.trial_count_total, 2, 'null date_to means open-ended (mid + late)');

  const all = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1' });
  assert.equal(all.overall.trial_count_total, 3);
  assert.equal(all.coverage.evidence_date_first, '2026-07-01');
  assert.equal(all.coverage.evidence_date_last, '2026-09-01');
});

test('S3-T26: training_session_ids filter narrows scope to only the requested sessions; unrecognized ids are surfaced, not silently dropped', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const s1 = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  const s2 = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-02' });
  await addTrials(env.pbTrainingEvidence, s1.training_session_id, 'DRILL-BALANCE', ['S']);
  await addTrials(env.pbTrainingEvidence, s2.training_session_id, 'DRILL-BALANCE', ['F']);

  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1', training_session_ids: [s1.training_session_id, 'trn_does_not_exist'] });
  assert.equal(snap.overall.trial_count_total, 1);
  assert.equal(snap.overall.outcome_S_count, 1);
  assert.deepEqual(snap.integrity.unknown_session_ids, ['trn_does_not_exist']);
  assert.deepEqual(snap.filter.training_session_ids, [s1.training_session_id, 'trn_does_not_exist'], 'filter is echoed back exactly as requested');
});

test('S3-T27: source_drill_ids filter narrows by_drill/by_master/overall to matching evidence only', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S', 'S']);
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-SERVE-DEPTH', ['F']);

  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1', source_drill_ids: ['DRILL-BALANCE'] });
  assert.equal(snap.overall.trial_count_total, 2);
  assert.equal(snap.overall.outcome_S_count, 2);
  const balance = snap.by_drill.find((r) => r.source_drill_id === 'DRILL-BALANCE');
  const serve = snap.by_drill.find((r) => r.source_drill_id === 'DRILL-SERVE-DEPTH');
  assert.equal(balance.trial_count_total, 2);
  assert.equal(serve.trial_count_total, 0, 'excluded by the drill filter even though evidence exists for it');
  assert.equal(snap.by_drill.length, 35, 'the Drill filter narrows counts, not the row list itself');

  const fm01 = snap.by_master.find((r) => r.master_id === 'FM-01');
  const fm02 = snap.by_master.find((r) => r.master_id === 'FM-02');
  assert.equal(fm01.trial_count_total, 2);
  assert.equal(fm02.trial_count_total, 0);
});

test('S3-T28: master_ids filter is equivalent to filtering by that Master\'s full drill set', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S']);
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-GRIP', ['P']);
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-SERVE-DEPTH', ['F']);

  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1', master_ids: ['FM-01'] });
  assert.equal(snap.overall.trial_count_total, 2, 'DRILL-BALANCE + DRILL-GRIP, both FM-01; DRILL-SERVE-DEPTH (FM-02) excluded');
  const fm01 = snap.by_master.find((r) => r.master_id === 'FM-01');
  const fm02 = snap.by_master.find((r) => r.master_id === 'FM-02');
  assert.equal(fm01.trial_count_total, 2);
  assert.equal(fm02.trial_count_total, 0);
});

test('player_id is required', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await assert.rejects(env.pbTrainingAnalytics.computeSnapshot({}), /player_id is required/);
  await assert.rejects(env.pbTrainingAnalytics.computeSnapshot(), /player_id is required/);
});
