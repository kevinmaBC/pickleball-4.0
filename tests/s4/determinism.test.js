'use strict';
/* S4 Test Matrix T33, T46: repeated calls with identical input are
 * deep-equal across all states (both-available, training-only,
 * assessment-only, neither). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv, addAssessment, addTrials } = require('./helpers/build_env.js');

async function repeatedCallsDeepEqual(env, player_id) {
  const a = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id });
  const b = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id });
  assert.deepEqual(a, b);
  return a;
}

test('S4-T33/T46: neither domain — repeated calls deep-equal', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await repeatedCallsDeepEqual(env, 'plr_1');
});

test('S4-T33/T46: assessment-only — repeated calls deep-equal', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await addAssessment(env.pbStore, { assessment_id: 'asm_1', player_id: 'plr_1', assessment_date: '2026-04-01' });
  await repeatedCallsDeepEqual(env, 'plr_1');
});

test('S4-T33/T46: training-only — repeated calls deep-equal', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S', 'F']);
  await repeatedCallsDeepEqual(env, 'plr_1');
});

test('S4-T33/T46: both domains — repeated calls deep-equal', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await addAssessment(env.pbStore, { assessment_id: 'asm_1', player_id: 'plr_1', assessment_date: '2026-04-01' });
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S', 'F']);
  const snap = await repeatedCallsDeepEqual(env, 'plr_1');
  assert.equal(snap.assessment_state.availability, 'AVAILABLE');
  assert.equal(snap.training_state.availability, 'AVAILABLE');
});
