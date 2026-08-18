'use strict';
/* S6 Test Matrix T51 (Node-side leg): a representative end-to-end explanation, run
 * through the public API with the exact S5_DATA_CONTRACT.md/S6_DATA_CONTRACT.md
 * worked example (target 4.0, capability 78.2, PASS), asserting the exact expected
 * explanation object. This proves the Node module surface end-to-end; the equivalent
 * run inside a real browser (real script-tag load order, no fetch/storage dependency
 * to stub) is additionally performed and recorded in the S6 completion report. */
const test = require('node:test');
const assert = require('node:assert/strict');

const { classify } = require('./helpers/s5_fixture.js');
const explainerFactory = require('../../js/assessment-explainer.js');

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

test('S6-T51 (Node leg): representative explanation via explainClassification() matches the S6_DATA_CONTRACT.md worked example exactly', () => {
  const { s5Result, levelConfig, metrics } = classify('4.0', DATA_CONTRACT_EXAMPLE_INPUT);

  // sanity: reproduce the exact S5 worked-example numbers first (tests/s5/browser_representative.test.js EXPECTED)
  assert.equal(s5Result.capability_score_0_100, 78.2);
  assert.equal(s5Result.level_status, 'PASS');

  const explainer = explainerFactory.createModule();
  const explanation = explainer.explainClassification(s5Result, metrics, levelConfig);

  assert.equal(explanation.explanation_version, 'PB30-50-S6-EXPLAIN-v1');
  assert.equal(explanation.target_level, 4.0);
  assert.equal(explanation.classification_status, 'PASS');
  assert.deepEqual(explanation.summary, { reason_code: 'PASS_ALL_REQUIREMENTS', explanation: explanation.summary.explanation });
  assert.ok(explanation.summary.explanation.length > 0);

  assert.equal(explanation.capability.status, 'PASS');
  assert.equal(explanation.capability.observed, 78.2);
  assert.equal(explanation.capability.required, 76);
  assert.equal(Math.round(explanation.capability.margin * 10) / 10, 2.2);

  assert.deepEqual(explanation.evidence, { status: 'PASS', input: 'C3', minimum: 'C3' });

  const expectedGates = {
    serve_in_pct: { required: 95, observed: 96, direction: 'MIN', status: 'PASS' },
    return_quality_pct: { required: 75, observed: 78, direction: 'MIN', status: 'PASS' },
    drop_ball_quality_pct: { required: 70, observed: 72, direction: 'MIN', status: 'PASS' },
    reset_ball_quality_pct: { required: 65, observed: 68, direction: 'MIN', status: 'PASS' },
    shot_selection_pct: { required: 80, observed: 82, direction: 'MIN', status: 'PASS' },
    pressure_success_pct: { required: 70, observed: 74, direction: 'MIN', status: 'PASS' },
    ue_per_game: { required: 5, observed: 4, direction: 'MAX', status: 'PASS' }
  };
  assert.equal(explanation.hard_gates.length, 7);
  explanation.hard_gates.forEach((g) => {
    const expected = expectedGates[g.metric];
    assert.ok(expected, `unexpected gate metric ${g.metric}`);
    assert.equal(g.required, expected.required);
    assert.equal(g.observed, expected.observed);
    assert.equal(g.direction, expected.direction);
    assert.equal(g.status, expected.status);
    assert.equal(g.reason_code, null);
  });

  assert.deepEqual(explanation.match_validation, { required: true, status: 'PASS', observed: 74, minimum: 70, margin: 4 });
  assert.deepEqual(explanation.missing_inputs, []);
  assert.equal(explanation.provisional, false);
  assert.deepEqual(explanation.blocking_reasons, []);
  assert.deepEqual(explanation.provenance, {
    classifier_version: 'PB30-50-S5-CLASSIFIER-v1',
    schema_version: null,
    benchmark_version: null,
    explainer_version: 'PB30-50-S6-EXPLAIN-v1'
  });
});
