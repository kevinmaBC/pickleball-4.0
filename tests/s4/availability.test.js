'use strict';
/* S4 Test Matrix T25-T26, T29-T32: training-evidence availability
 * (Owner-frozen 15.5: reuse S3's existing evidence-count semantics), and
 * the full 2x2 assessment/training independence matrix — neither domain
 * gates or overwrites the other's availability. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv, addAssessment, addTrials } = require('./helpers/build_env.js');

async function seedEvidence(env, player_id) {
  const session = await env.pbTrainingEvidence.createSession({ player_id, session_date: '2026-08-01' });
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S', 'F']);
}

test('S4-T25: no training evidence => training_state.availability is NONE', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.training_state.availability, 'NONE');
  assert.equal(snap.availability.training_evidence, 'NONE');
  assert.equal(snap.training_state.analytics.overall.trial_count_total, 0, 'analytics object is still present, zero-filled');
});

test('S4-T26: any evidence => training_state.availability is AVAILABLE', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await seedEvidence(env, 'plr_1');
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.training_state.availability, 'AVAILABLE');
  assert.equal(snap.availability.training_evidence, 'AVAILABLE');
});

test('S4-T29: assessment yes / training no', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await addAssessment(env.pbStore, { assessment_id: 'asm_1', player_id: 'plr_1', assessment_date: '2026-04-01' });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.availability, 'AVAILABLE');
  assert.equal(snap.training_state.availability, 'NONE');
});

test('S4-T30: assessment no / training yes', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await seedEvidence(env, 'plr_1');
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.availability, 'NONE');
  assert.equal(snap.training_state.availability, 'AVAILABLE');
});

test('S4-T31: both available', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await addAssessment(env.pbStore, { assessment_id: 'asm_1', player_id: 'plr_1', assessment_date: '2026-04-01' });
  await seedEvidence(env, 'plr_1');
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.availability, 'AVAILABLE');
  assert.equal(snap.training_state.availability, 'AVAILABLE');
});

test('S4-T32: neither available', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.availability, 'NONE');
  assert.equal(snap.training_state.availability, 'NONE');
});
