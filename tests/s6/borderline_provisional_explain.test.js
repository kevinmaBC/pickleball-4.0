'use strict';
/* S6 Test Matrix T45-T46: provisional 4.5/5.0 metadata is retained in the explanation
 * exactly as S5 surfaces it; non-provisional levels surface false. */
const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyAndExplain, LEVEL_GATES } = require('./helpers/s5_fixture.js');

const GOOD_COMPONENTS = { technical_score: 95, decision_score: 95, pressure_score: 95 };

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

test('S6-T45: 4.5 provisional_level true is surfaced as explanation.provisional === true', () => {
  const cfg = LEVEL_GATES.levels['4.5'];
  const { s5Result, explanation } = classifyAndExplain('4.5', {
    target_level: 4.5, metrics: buildAllPassMetrics(cfg), component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4'
  });
  assert.equal(s5Result.provisional_level, true);
  assert.equal(explanation.provisional, true);
});

test('S6-T46: 5.0 provisional_level true is surfaced as explanation.provisional === true', () => {
  const cfg = LEVEL_GATES.levels['5.0'];
  const { s5Result, explanation } = classifyAndExplain('5.0', {
    target_level: 5.0, metrics: buildAllPassMetrics(cfg), component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4'
  });
  assert.equal(s5Result.provisional_level, true);
  assert.equal(explanation.provisional, true);
});

test('S6-T46b: non-provisional level (4.0) surfaces explanation.provisional === false', () => {
  const cfg = LEVEL_GATES.levels['4.0'];
  const { s5Result, explanation } = classifyAndExplain('4.0', {
    target_level: 4.0, metrics: buildAllPassMetrics(cfg), component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 100
  });
  assert.equal(s5Result.provisional_level, false);
  assert.equal(explanation.provisional, false);
});
