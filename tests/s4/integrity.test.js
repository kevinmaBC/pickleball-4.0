'use strict';
/* S4 Test Matrix T27: S3 integrity is propagated verbatim into
 * integrity.analytics_integrity, and integrity.status (Owner-frozen 15.4:
 * data-integrity only, never a performance signal) flips OK -> ISSUES_PRESENT
 * purely on presence/absence of any corrupt/unknown id, with no severity
 * ranking. Corrupt rows are injected the same way tests/s3/integrity.test.js
 * does — directly via the fake store, bypassing addEvidence's validation. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv } = require('./helpers/build_env.js');

test('S4-T27: clean data => integrity.status OK, empty analytics_integrity arrays', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  await env.pbTrainingEvidence.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'S' });

  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.integrity.status, 'OK');
  assert.deepEqual(snap.integrity.analytics_integrity, { unknown_drill_ids: [], unknown_master_ids: [], mismatched_master_ids: [], unknown_session_ids: [] });
});

test('S4-T27: an unknown source_drill_id propagates unchanged into analytics_integrity and flips status to ISSUES_PRESENT', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  await env.pbStore.put('drill_evidence_events', {
    drill_evidence_id: 'dev_corrupt_1', training_session_id: session.training_session_id,
    source_drill_id: 'DRILL-DOES-NOT-EXIST', master_id: 'FM-99', trial_no: 1, outcome: 'S', created_at: new Date().toISOString()
  });

  const directAnalytics = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1' });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });

  assert.deepEqual(snap.integrity.analytics_integrity, directAnalytics.integrity, 'propagated verbatim, not re-derived');
  assert.deepEqual(snap.integrity.analytics_integrity.unknown_drill_ids, ['DRILL-DOES-NOT-EXIST']);
  assert.equal(snap.integrity.status, 'ISSUES_PRESENT');
});

test('S4 (15.4): integrity.status never reflects player performance — a player with zero trials but clean data is still OK', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.integrity.status, 'OK', 'no evidence at all is not a data-integrity issue');
  assert.equal(snap.training_state.availability, 'NONE');
});
