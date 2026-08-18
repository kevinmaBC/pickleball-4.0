'use strict';
/* S6 Test Matrix T38-T41: no match_validation section when the level has none
 * configured; PASS/FAIL/exact-boundary cases when it is configured (4.0). */
const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyAndExplain, LEVEL_GATES } = require('./helpers/s5_fixture.js');

const GOOD_COMPONENTS = { technical_score: 95, decision_score: 95, pressure_score: 95 };
const GOOD_METRICS_40 = { serve_in_pct: 97, return_quality_pct: 80, drop_ball_quality_pct: 75, reset_ball_quality_pct: 70, shot_selection_pct: 85, pressure_success_pct: 75, ue_per_game: 2 };

function buildAllPassMetrics(cfg) {
  const m = {};
  Object.keys(cfg.hard_gates).forEach((gateKey) => {
    const isMax = gateKey.endsWith('_max');
    const sourceKey = isMax ? gateKey.slice(0, -4) : gateKey;
    const threshold = cfg.hard_gates[gateKey].threshold;
    m[sourceKey] = isMax ? Math.max(0, threshold - 1) : threshold + 1;
  });
  return m;
}

for (const label of ['3.0', '3.5', '4.5', '5.0']) {
  test(`S6-T38 [${label}]: no match_validation configured -> explanation.match_validation is null (section omitted)`, () => {
    const cfg = LEVEL_GATES.levels[label];
    const { s5Result, explanation } = classifyAndExplain(label, {
      target_level: parseFloat(label), metrics: buildAllPassMetrics(cfg), component_scores: GOOD_COMPONENTS,
      evidence_confidence: 'C4', match_transfer_score: 100
    });
    assert.equal(s5Result.match_validation.configured, false);
    assert.equal(explanation.match_validation, null);
  });
}

test('S6-T39: match validation PASS (4.0, transfer=74) -> status PASS, margin positive', () => {
  const { explanation } = classifyAndExplain('4.0', {
    target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 74
  });
  assert.equal(explanation.match_validation.required, true);
  assert.equal(explanation.match_validation.status, 'PASS');
  assert.equal(explanation.match_validation.observed, 74);
  assert.equal(explanation.match_validation.minimum, 70);
  assert.equal(explanation.match_validation.margin, 4);
});

test('S6-T40: match validation FAIL (4.0, transfer=69) -> status FAIL, margin negative, forces overall FAIL', () => {
  const { s5Result, explanation } = classifyAndExplain('4.0', {
    target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 69
  });
  assert.equal(s5Result.level_status, 'FAIL');
  assert.equal(explanation.match_validation.status, 'FAIL');
  assert.equal(explanation.match_validation.margin, -1);
  assert.equal(explanation.summary.reason_code, 'MATCH_VALIDATION_FAIL', 'no gate failed here — capability/gates/evidence all satisfied, so match must be the headline reason');
});

test('S6-T41: match validation exact boundary (4.0, transfer=70) -> status PASS, margin exactly zero', () => {
  const { explanation } = classifyAndExplain('4.0', {
    target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 70
  });
  assert.equal(explanation.match_validation.status, 'PASS');
  assert.equal(explanation.match_validation.margin, 0);
});
