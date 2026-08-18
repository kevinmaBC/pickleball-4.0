'use strict';
/* S3 Acceptance Gate — corrupt/unknown identifier handling (S3-T29, T30, plus
 * the unknown_session_ids extension covered in filters.test.js T26).
 * Corrupt rows are injected directly via the fake PBStore (bypassing
 * PBTrainingEvidence.addEvidence's write-time validation) to simulate
 * pre-existing/legacy data drift — the same scenario the analytics layer
 * must defend against since it never assumes its inputs are clean. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv, addTrials } = require('./helpers/build_env.js');

test('S3-T29: an unknown source_drill_id is excluded from all aggregation and surfaced in integrity', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S']);

  // Directly inject a corrupt row that addEvidence would have rejected.
  await env.pbStore.put('drill_evidence_events', {
    drill_evidence_id: 'dev_corrupt_1',
    training_session_id: session.training_session_id,
    source_drill_id: 'DRILL-DOES-NOT-EXIST',
    master_id: 'FM-99',
    trial_no: 99,
    outcome: 'S',
    created_at: new Date().toISOString()
  });

  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1' });
  assert.deepEqual(snap.integrity.unknown_drill_ids, ['DRILL-DOES-NOT-EXIST']);
  assert.equal(snap.overall.trial_count_total, 1, 'the corrupt row must not be counted');
  assert.equal(snap.overall.outcome_S_count, 1, 'only the legitimate DRILL-BALANCE trial counts');
});

test('S3-T30: a stored master_id that disagrees with the canonical derivation is aggregated under the canonical Master and surfaced, never silently discarded', async () => {
  const env = await buildEnv([{ player_id: 'plr_2', display_name: 'P2' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_2', session_date: '2026-08-01' });

  // DRILL-BALANCE canonically belongs to FM-01 — stamp a stale/wrong stored master_id (FM-02).
  await env.pbStore.put('drill_evidence_events', {
    drill_evidence_id: 'dev_mismatch_1',
    training_session_id: session.training_session_id,
    source_drill_id: 'DRILL-BALANCE',
    master_id: 'FM-02',
    trial_no: 1,
    outcome: 'S',
    created_at: new Date().toISOString()
  });

  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_2' });
  assert.deepEqual(snap.integrity.mismatched_master_ids, ['FM-02'], 'the stale stored value is named, not swallowed');

  const fm01 = snap.by_master.find((r) => r.master_id === 'FM-01');
  const fm02 = snap.by_master.find((r) => r.master_id === 'FM-02');
  assert.equal(fm01.trial_count_total, 1, 'aggregation follows the canonical Drill->Master mapping, not the stale stored value');
  assert.equal(fm02.trial_count_total, 0, 'the row is never attributed to the stale value');
  assert.equal(snap.overall.trial_count_total, 1, 'the row is still counted overall — nothing is silently lost');

  const balanceRow = snap.by_drill.find((r) => r.source_drill_id === 'DRILL-BALANCE');
  assert.equal(balanceRow.master_id, 'FM-01', 'by_drill always reports the canonical master, never the stale stored one');
});

test('corrupt rows are deduplicated and sorted in integrity output', async () => {
  const env = await buildEnv([{ player_id: 'plr_3', display_name: 'P3' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_3', session_date: '2026-08-01' });
  await env.pbStore.put('drill_evidence_events', {
    drill_evidence_id: 'dev_z', training_session_id: session.training_session_id,
    source_drill_id: 'DRILL-ZZZ', master_id: 'FM-99', trial_no: 1, outcome: 'S', created_at: new Date().toISOString()
  });
  await env.pbStore.put('drill_evidence_events', {
    drill_evidence_id: 'dev_a', training_session_id: session.training_session_id,
    source_drill_id: 'DRILL-AAA', master_id: 'FM-99', trial_no: 1, outcome: 'S', created_at: new Date().toISOString()
  });
  await env.pbStore.put('drill_evidence_events', {
    drill_evidence_id: 'dev_a2', training_session_id: session.training_session_id,
    source_drill_id: 'DRILL-AAA', master_id: 'FM-99', trial_no: 2, outcome: 'P', created_at: new Date().toISOString()
  });

  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_3' });
  assert.deepEqual(snap.integrity.unknown_drill_ids, ['DRILL-AAA', 'DRILL-ZZZ'], 'deduplicated and lexicographically sorted');
});
