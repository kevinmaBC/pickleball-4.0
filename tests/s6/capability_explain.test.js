'use strict';
/* S6 Test Matrix T16-T22: capability.observed/required copied exactly from S5's own
 * two numbers; margin positive/zero/negative exact; capability.status banding mirrors
 * S5's own +/-5 borderline literal (Owner-approved Decision E) and is proven to never
 * diverge from S5's actual level_status in pure-capability-driven scenarios (all gates
 * pass, evidence ok, match ok/unconfigured); weights exact; missing component score
 * never coerced to zero. */
const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyAndExplain, LEVEL_GATES } = require('./helpers/s5_fixture.js');
const explainerFactory = require('../../js/assessment-explainer.js');

function allPassMetrics(cfg) {
  const m = {};
  Object.keys(cfg.hard_gates).forEach((gateKey) => {
    const isMax = gateKey.endsWith('_max');
    const sourceKey = isMax ? gateKey.slice(0, -4) : gateKey;
    const threshold = cfg.hard_gates[gateKey].threshold;
    m[sourceKey] = isMax ? Math.max(0, threshold - 1) : threshold + 1;
  });
  return m;
}
function uniformComponents(x) { return { technical_score: x, decision_score: x, pressure_score: x }; }
function explainAt(label, x) {
  const cfg = LEVEL_GATES.levels[label];
  return classifyAndExplain(label, {
    target_level: parseFloat(label), metrics: allPassMetrics(cfg), component_scores: uniformComponents(x),
    evidence_confidence: 'C4', match_transfer_score: 100
  });
}

test('S6-T16: capability.observed/required copied exactly from s5Result.capability_score_0_100/capability_min', () => {
  const { s5Result, explanation } = explainAt('4.0', 90);
  assert.equal(explanation.capability.observed, s5Result.capability_score_0_100);
  assert.equal(explanation.capability.required, s5Result.capability_min);
});

test('S6-T17: margin positive when capability comfortably exceeds the minimum', () => {
  const cmin = LEVEL_GATES.levels['4.0'].capability_min;
  const { explanation } = explainAt('4.0', cmin + 10);
  assert.equal(explanation.capability.margin, 10);
  assert.equal(explanation.capability.status, 'PASS');
});

test('S6-T18: margin exactly zero at the capability_min boundary', () => {
  const cmin = LEVEL_GATES.levels['4.0'].capability_min;
  const { explanation } = explainAt('4.0', cmin);
  assert.equal(explanation.capability.margin, 0);
  assert.equal(explanation.capability.status, 'PASS');
});

test('S6-T19: margin negative when capability is below the minimum', () => {
  const cmin = LEVEL_GATES.levels['4.0'].capability_min;
  const { explanation } = explainAt('4.0', cmin - 3);
  assert.equal(explanation.capability.margin, -3);
});

test('S6-T20: capability.status banding never diverges from S5\'s own level_status in pure-capability-driven scenarios (all gates pass, evidence ok, match ok)', () => {
  for (const label of ['3.0', '3.5', '4.0', '4.5', '5.0']) {
    const cmin = LEVEL_GATES.levels[label].capability_min;
    const cases = [
      { x: cmin, expect: 'PASS' },
      { x: cmin + 3, expect: 'PASS' },
      { x: cmin - 5, expect: 'BORDERLINE' },
      { x: Math.max(0, cmin - 6), expect: 'FAIL' }
    ];
    cases.forEach(({ x, expect }) => {
      const { s5Result, explanation } = explainAt(label, x);
      assert.equal(s5Result.level_status, expect, `sanity: ${label} at x=${x}`);
      assert.equal(explanation.capability.status, expect, `${label} at x=${x}: capability.status must match S5's own level_status when gates/evidence/match are all satisfied`);
    });
  }
});

test('S6-T21: capability weights are exactly {technical_score:0.45, decision_score:0.30, pressure_score:0.25}, matching the mirrored S5 literal', () => {
  const explainer = explainerFactory.createModule();
  assert.deepEqual(explainer.CAPABILITY_WEIGHTS, { technical_score: 0.45, decision_score: 0.30, pressure_score: 0.25 });
  const { explanation } = explainAt('4.0', 90);
  const byKey = {};
  explanation.capability.components.forEach((c) => { byKey[c.metric] = c.weight; });
  assert.deepEqual(byKey, { technical_score: 0.45, decision_score: 0.30, pressure_score: 0.25 });
});

test('S6-T22: a missing component score is surfaced as null in capability.components, never coerced to 0', () => {
  const { explanation } = classifyAndExplain('3.0', {
    target_level: 3.0, metrics: {},
    component_scores: { technical_score: 90, decision_score: null, pressure_score: 90 },
    evidence_confidence: 'C4'
  });
  const decision = explanation.capability.components.find((c) => c.metric === 'decision_score');
  assert.equal(decision.value, null);
  const technical = explanation.capability.components.find((c) => c.metric === 'technical_score');
  assert.equal(technical.value, 90);
});
