'use strict';
/* S4 Test Matrix T17-T22: exact stored-field pass-through, missing values
 * never synthesized, zero preserved distinctly from null, no score/level/
 * confidence computation, DUPR and bottleneck/recommended_block fields are
 * pass-through only (Owner-frozen 15.1 match_transfer_score aliasing and
 * 15.2 explicit-whitelist projection are exercised here too). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv, addAssessment } = require('./helpers/build_env.js');

test('S4-T17: every listed stored assessment field is copied exactly when present', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await addAssessment(env.pbStore, {
    assessment_id: 'asm_full', player_id: 'plr_1', assessment_date: '2026-04-01',
    assessment_tier: 'full', target_training_level: 4.5,
    schema_version: '2.3.1', benchmark_version: '2.1.1', protocol_version: '2.2.1',
    patch: {
      validated_training_level: 4.0,
      capability_score_0_100: 77.5,
      technical_score: 80,
      decision_score: 70,
      pressure_score: 65,
      evidence_confidence: 'C2',
      primary_bottleneck: 'FM-03',
      secondary_bottleneck: 'FM-07',
      recommended_block_id: 'blk_9',
      dupr: { singles_rating: 4.1, source_mode: 'manual' },
      external_validation_note: 'note text'
    }
  });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  const s = snap.assessment_state;
  assert.equal(s.availability, 'AVAILABLE');
  assert.equal(s.selected_assessment_id, 'asm_full');
  assert.equal(s.assessment_date, '2026-04-01');
  assert.equal(s.assessment_tier, 'full');
  assert.equal(s.target_training_level, 4.5);
  assert.equal(s.validated_training_level, 4.0);
  assert.equal(s.capability_score_0_100, 77.5);
  assert.equal(s.technical_score, 80);
  assert.equal(s.decision_score, 70);
  assert.equal(s.pressure_score, 65);
  assert.equal(s.evidence_confidence, 'C2');
  assert.equal(s.primary_bottleneck, 'FM-03');
  assert.equal(s.secondary_bottleneck, 'FM-07');
  assert.equal(s.recommended_block_id, 'blk_9');
  assert.deepEqual(s.dupr, { singles_rating: 4.1, source_mode: 'manual' });
  assert.equal(s.external_validation_note, 'note text');
  assert.deepEqual(s.versions, { schema_version: '2.3.1', benchmark_version: '2.1.1', protocol_version: '2.2.1' });
});

test('S4-T18: fields never written on the stored record surface as null, never synthesized', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  // addAssessment's baseline shape carries no validated_training_level/capability_score_0_100/etc —
  // matching what js/storage.js#createAssessment actually writes today.
  await addAssessment(env.pbStore, { assessment_id: 'asm_bare', player_id: 'plr_1', assessment_date: '2026-04-01' });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  const s = snap.assessment_state;
  ['validated_training_level', 'capability_score_0_100', 'technical_score', 'decision_score',
    'pressure_score', 'match_transfer_score', 'evidence_confidence', 'primary_bottleneck',
    'secondary_bottleneck', 'recommended_block_id', 'dupr', 'external_validation_note'
  ].forEach((k) => assert.equal(s[k], null, k + ' must be null, not fabricated'));
});

test('S4-T19: a stored 0 is preserved as 0, never collapsed to null', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await addAssessment(env.pbStore, {
    assessment_id: 'asm_zero', player_id: 'plr_1', assessment_date: '2026-04-01',
    patch: { technical_score: 0, capability_score_0_100: 0 }
  });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.technical_score, 0);
  assert.notEqual(snap.assessment_state.technical_score, null);
  assert.equal(snap.assessment_state.capability_score_0_100, 0);
  assert.notEqual(snap.assessment_state.capability_score_0_100, null);
});

test('S4-T20: no score/validated-level/confidence value is ever computed — only passed through as stored', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  // technical/decision/pressure present but capability_score_0_100 deliberately absent:
  // a computing implementation would derive it (0.45/0.30/0.25 weights); a pass-through one leaves it null.
  await addAssessment(env.pbStore, {
    assessment_id: 'asm_partial', player_id: 'plr_1', assessment_date: '2026-04-01',
    patch: { technical_score: 90, decision_score: 90, pressure_score: 90 }
  });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.capability_score_0_100, null, 'must not be derived from technical/decision/pressure scores');
  assert.equal(snap.assessment_state.validated_training_level, null, 'must not be inferred');
});

test('S4-T21: dupr is passed through unchanged, never interpreted/compared', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const duprPayload = { singles_rating: 3.9, singles_reliability: 42, doubles_rating: null, source_mode: 'api' };
  await addAssessment(env.pbStore, { assessment_id: 'asm_dupr', player_id: 'plr_1', assessment_date: '2026-04-01', patch: { dupr: duprPayload } });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.deepEqual(snap.assessment_state.dupr, duprPayload);
});

test('S4-T22: primary/secondary bottleneck and recommended_block_id are passed through unchanged, never ranked/generated', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await addAssessment(env.pbStore, {
    assessment_id: 'asm_bn', player_id: 'plr_1', assessment_date: '2026-04-01',
    patch: { primary_bottleneck: 'FM-11', secondary_bottleneck: 'FM-02', recommended_block_id: 'blk_x' }
  });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.primary_bottleneck, 'FM-11');
  assert.equal(snap.assessment_state.secondary_bottleneck, 'FM-02');
  assert.equal(snap.assessment_state.recommended_block_id, 'blk_x');
});

test('S4-T2 (15.1): match_transfer_score aliases the actually-stored nested assessment.match_transfer.score', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await addAssessment(env.pbStore, {
    assessment_id: 'asm_mt', player_id: 'plr_1', assessment_date: '2026-04-01',
    patch: { match_transfer: { decision: 80, transition: 70, pressure: 60, attack: 50, score: 65 } }
  });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.match_transfer_score, 65, 'must read the nested match_transfer.score, not just a flat key');
});

test('S4 (15.1 flat-key priority): a literal flat match_transfer_score field, if ever present, wins over the nested shape', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await addAssessment(env.pbStore, {
    assessment_id: 'asm_mt2', player_id: 'plr_1', assessment_date: '2026-04-01',
    patch: { match_transfer_score: 99, match_transfer: { score: 1 } }
  });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.match_transfer_score, 99);
});

test('S4 (15.2): full assessment object is never exposed — only the whitelisted projection', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  await addAssessment(env.pbStore, {
    assessment_id: 'asm_wl', player_id: 'plr_1', assessment_date: '2026-04-01',
    patch: { ue: { games: 3, counts: { serve: 2 } }, some_future_internal_field: 'should-not-leak' }
  });
  const snap = await env.pbPlayerTrainingState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.assessment_state.ue, undefined, 'ue is not on the S4 whitelist and must not be exposed');
  assert.equal(snap.assessment_state.some_future_internal_field, undefined, 'unknown fields must never leak through');
  assert.equal(snap.assessment_state.player_id, undefined, 'raw assessment.player_id key itself is not part of the projection');
});
