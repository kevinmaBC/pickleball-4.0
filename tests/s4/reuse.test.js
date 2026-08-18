'use strict';
/* S4 Test Matrix T23-T24, T28: player-training-state.js must consume
 * PBTrainingAnalytics rather than duplicate its aggregation, and forward
 * S3's existing date-filter semantics unchanged (Owner-frozen 15.7: forward
 * the full S3 filter set as-is, no reinterpretation/narrowing/extension). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildEnv, addTrials } = require('./helpers/build_env.js');

const ROOT = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'player-training-state.js'), 'utf8');

test('S4-T23 (static): player-training-state.js never reads drill_evidence_events directly or re-tallies S/P/F/I outcomes', () => {
  assert.doesNotMatch(src, /drill_evidence_events/, 'must go through PBTrainingAnalytics, not the raw evidence store');
  assert.doesNotMatch(src, /outcome_S_count\s*\+=/, 'must not re-implement outcome counting');
  assert.doesNotMatch(src, /outcome\s*===\s*['"]S['"]/, 'must not branch on individual trial outcomes itself');
});

test('S4-T28: training_state.analytics deep-equals a direct PBTrainingAnalytics.computeSnapshot call with the same args', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S', 'P', 'F']);

  const direct = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1' });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.deepEqual(snap.training_state.analytics, direct);
});

test('S4-T24: date_from/date_to are forwarded to S3 unchanged — identical exclusion behavior to a direct S3 call', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const s1 = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-01-01' });
  await addTrials(env.pbTrainingEvidence, s1.training_session_id, 'DRILL-BALANCE', ['S']);
  const s2 = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  await addTrials(env.pbTrainingEvidence, s2.training_session_id, 'DRILL-BALANCE', ['F']);

  const filterArgs = { player_id: 'plr_1', date_from: '2026-06-01', date_to: '2026-12-31' };
  const direct = await env.pbTrainingAnalytics.computeSnapshot(filterArgs);
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState(filterArgs);

  assert.deepEqual(snap.training_state.analytics, direct);
  assert.equal(snap.training_state.analytics.overall.trial_count_total, 1, 'only the in-window session counts, same as a direct S3 call');
  assert.deepEqual(snap.training_state.filter, { date_from: '2026-06-01', date_to: '2026-12-31', training_session_ids: null, source_drill_ids: null, master_ids: null }, 'filter echoed back unchanged (Owner-frozen 15.7)');
});

test('S4 (15.7): the full S3 filter surface (session/drill/master ids) is forwarded unchanged, not just dates', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S']);
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-SERVE-DEPTH', ['F'], { trial_no_start: 1 });

  const filterArgs = { player_id: 'plr_1', source_drill_ids: ['DRILL-BALANCE'] };
  const direct = await env.pbTrainingAnalytics.computeSnapshot(filterArgs);
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState(filterArgs);
  assert.deepEqual(snap.training_state.analytics, direct);
  assert.equal(snap.training_state.analytics.overall.trial_count_total, 1, 'only DRILL-BALANCE evidence counted, exactly like a direct S3 call');
});
