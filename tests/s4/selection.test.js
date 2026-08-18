'use strict';
/* S4 Test Matrix T08-T16, T10: player_id required, unknown player rejected
 * (with a stable PLAYER_NOT_FOUND code per Owner decision 15.6), known
 * player not mutated, deterministic latest-assessment selection and its
 * full tie-break chain, and independence from store return order. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv, addAssessment } = require('./helpers/build_env.js');

test('S4-T08: player_id is required', async () => {
  const env = await buildEnv([]);
  await assert.rejects(() => env.pbPlayerTrainingState.getPlayerTrainingState({}), /player_id is required/);
  await assert.rejects(() => env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: '' }), /player_id is required/);
});

test('S4-T09: unknown player_id is rejected with a stable PLAYER_NOT_FOUND code', async () => {
  const env = await buildEnv([]);
  await assert.rejects(
    () => env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_ghost' }),
    (err) => {
      assert.equal(err.code, 'PLAYER_NOT_FOUND');
      return true;
    }
  );
});

test('S4-T10: calling for a known player never writes/deletes and leaves the raw player record byte-identical', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const before = await env.pbStore.get('players', 'plr_1');

  const guardedStore = Object.assign({}, env.pbStore, {
    put: () => { throw new Error('put() must never be called by PBPlayerTrainingState'); },
    del: () => { throw new Error('del() must never be called by PBPlayerTrainingState'); }
  });
  const factory = require('../../js/player-training-state.js');
  const guardedState = factory.createModule({ pbStore: guardedStore, pbCanonical: env.pbCanonical, pbTrainingAnalytics: env.pbTrainingAnalytics });
  const snap = await guardedState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.player_id, 'plr_1');

  const after = await env.pbStore.get('players', 'plr_1');
  assert.deepEqual(after, before);
});

test('S4-T11: no assessment => assessment_state.availability is NONE', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.availability, 'NONE');
  assert.equal(snap.availability.assessment, 'NONE');
  assert.equal(snap.assessment_state.selected_assessment_id, null);
});

test('S4-T12: exactly one assessment is selected when only one exists', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await addAssessment(env.pbStore, { assessment_id: 'asm_only', player_id: 'plr_1', assessment_date: '2026-03-01' });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.availability, 'AVAILABLE');
  assert.equal(snap.assessment_state.selected_assessment_id, 'asm_only');
});

test('S4-T13: assessment_date takes precedence over insertion order', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  // Insert the earlier date last, to prove the store's return/insertion order is irrelevant.
  await addAssessment(env.pbStore, { assessment_id: 'asm_late', player_id: 'plr_1', assessment_date: '2026-05-01', created_at: '2026-05-01T00:00:00.000Z' });
  await addAssessment(env.pbStore, { assessment_id: 'asm_early', player_id: 'plr_1', assessment_date: '2026-01-01', created_at: '2026-06-01T00:00:00.000Z' });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.selected_assessment_id, 'asm_late', 'higher assessment_date wins regardless of created_at or insertion order');
});

test('S4-T14: created_at is the tie-break when assessment_date is equal', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await addAssessment(env.pbStore, { assessment_id: 'asm_older_created', player_id: 'plr_1', assessment_date: '2026-04-01', created_at: '2026-04-01T01:00:00.000Z' });
  await addAssessment(env.pbStore, { assessment_id: 'asm_newer_created', player_id: 'plr_1', assessment_date: '2026-04-01', created_at: '2026-04-01T09:00:00.000Z' });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.selected_assessment_id, 'asm_newer_created');
});

test('S4-T15: assessment_id (lexicographically highest) is the final tie-break', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await addAssessment(env.pbStore, { assessment_id: 'asm_aaa', player_id: 'plr_1', assessment_date: '2026-04-01', created_at: '2026-04-01T00:00:00.000Z' });
  await addAssessment(env.pbStore, { assessment_id: 'asm_zzz', player_id: 'plr_1', assessment_date: '2026-04-01', created_at: '2026-04-01T00:00:00.000Z' });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.selected_assessment_id, 'asm_zzz');
});

test('S4-T16: selection result is independent of the store\'s return order', async () => {
  const rows = {
    asm_a: { assessment_id: 'asm_a', player_id: 'plr_1', assessment_date: '2026-02-01', assessment_tier: 'standard', target_training_level: 4.0, created_at: '2026-02-01T00:00:00.000Z' },
    asm_b: { assessment_id: 'asm_b', player_id: 'plr_1', assessment_date: '2026-07-01', assessment_tier: 'standard', target_training_level: 4.0, created_at: '2026-07-01T00:00:00.000Z' },
    asm_c: { assessment_id: 'asm_c', player_id: 'plr_1', assessment_date: '2026-05-01', assessment_tier: 'standard', target_training_level: 4.0, created_at: '2026-05-01T00:00:00.000Z' }
  };
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  // Shuffle the order getByIndex returns, independent of any real insertion order.
  const shuffledStore = Object.assign({}, env.pbStore, {
    getByIndex: (store, index, value) => {
      if (store === 'assessments') return Promise.resolve([rows.asm_c, rows.asm_a, rows.asm_b]);
      return env.pbStore.getByIndex(store, index, value);
    }
  });
  const factory = require('../../js/player-training-state.js');
  const shuffledState = factory.createModule({ pbStore: shuffledStore, pbCanonical: env.pbCanonical, pbTrainingAnalytics: env.pbTrainingAnalytics });
  const snap = await shuffledState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.selected_assessment_id, 'asm_b', 'highest assessment_date wins regardless of array order returned by the store');
});
