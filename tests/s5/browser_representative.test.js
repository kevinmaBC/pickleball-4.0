'use strict';
/* S5 Test Matrix T60: a representative end-to-end classification, run through the public
 * API with the exact S5_DATA_CONTRACT.md example input, asserting the exact expected result
 * object. The expected capability_score_0_100 (78.2) was independently produced by running
 * the frozen schemas/scoring_engine_reference_v2_3_1.py directly (not derived by hand) —
 * see the identical computation recorded in tests/s5/fixtures/golden_vectors.json's
 * generation trail. This proves the Node module surface end-to-end; the equivalent run
 * inside a real browser (fetch-based loadConfig against the real static file server) is
 * additionally performed in the S5 completion report's real-browser proof section. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const factory = require(path.join(__dirname, '..', '..', 'js', 'assessment-classifier.js'));
const { LEVEL_GATES } = require('./helpers/level_gates.js');
const { installFetchStub } = require('./helpers/fetch_stub.js');

const DATA_CONTRACT_EXAMPLE_INPUT = {
  target_level: 4.0,
  metrics: {
    serve_in_pct: 96,
    return_quality_pct: 78,
    drop_ball_quality_pct: 72,
    reset_ball_quality_pct: 68,
    shot_selection_pct: 82,
    pressure_success_pct: 74,
    ue_per_game: 4
  },
  component_scores: { technical_score: 80, decision_score: 78, pressure_score: 75 },
  evidence_confidence: 'C3',
  match_transfer_score: 74
};

const EXPECTED = {
  classifier_version: 'PB30-50-S5-CLASSIFIER-v1',
  schema_version: '2.3.1',
  benchmark_version: '2.1.1',
  target_level: 4.0,
  level_status: 'PASS',
  provisional_level: false,
  capability_score_0_100: 78.2,
  capability_min: 76,
  component_scores: { technical_score: 80, decision_score: 78, pressure_score: 75 },
  evidence: { input: 'C3', minimum: 'C3', ok: true },
  gate_results: {
    serve_in_pct: true, return_quality_pct: true, drop_ball_quality_pct: true,
    reset_ball_quality_pct: true, shot_selection_pct: true, pressure_success_pct: true,
    ue_per_game_max: true
  },
  match_validation: { configured: true, required: true, min_match_transfer_score: 70, input: 74, ok: true },
  missing_inputs: []
};

test('S5-T60: representative classification via classifyLevel() with an explicit levelConfig matches exactly', () => {
  const classifier = factory.createModule();
  const r = classifier.classifyLevel(DATA_CONTRACT_EXAMPLE_INPUT, LEVEL_GATES.levels['4.0']);
  assert.deepEqual(r, Object.assign({}, EXPECTED, { schema_version: null, benchmark_version: null }), 'schema_version/benchmark_version are null when loadConfig() was never called — diagnostic-only fields');
});

test('S5-T60b: representative classification via classifyTarget() through a real loadConfig() (fetch-stub) matches exactly, including schema_version/benchmark_version', async () => {
  const restore = installFetchStub();
  try {
    const classifier = factory.createModule();
    await classifier.loadConfig('./data/');
    const r = classifier.classifyTarget(DATA_CONTRACT_EXAMPLE_INPUT);
    assert.deepEqual(r, EXPECTED);
  } finally { restore(); }
});
