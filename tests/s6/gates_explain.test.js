'use strict';
/* S6 Test Matrix T23-T30: every gate S5 evaluated is represented in hard_gates; MIN/MAX
 * margin positive/zero/negative exact; a missing gate metric is never coerced to zero
 * (observed/margin stay null while status still comes verbatim from S5's own FAIL). */
const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyAndExplain, LEVEL_GATES } = require('./helpers/s5_fixture.js');

const GOOD_COMPONENTS = { technical_score: 95, decision_score: 95, pressure_score: 95 };

for (const label of ['3.0', '3.5', '4.0', '4.5', '5.0']) {
  const cfg = LEVEL_GATES.levels[label];

  test(`S6-T23 [${label}]: every gate S5 evaluated is represented in hard_gates, no others`, () => {
    const { s5Result, explanation } = classifyAndExplain(label, {
      target_level: parseFloat(label), metrics: {}, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4'
    });
    assert.deepEqual(
      explanation.hard_gates.map((g) => g.metric).sort(),
      Object.keys(s5Result.gate_results).map((k) => k.endsWith('_max') ? k.slice(0, -4) : k).sort()
    );
    assert.equal(explanation.hard_gates.length, Object.keys(s5Result.gate_results).length);
  });

  for (const [gateKey, rule] of Object.entries(cfg.hard_gates)) {
    const isMax = gateKey.endsWith('_max');
    const sourceKey = isMax ? gateKey.slice(0, -4) : gateKey;
    const threshold = rule.threshold;

    test(`S6-T24/T27 [${label} ${gateKey}]: MIN/MAX margin exactly zero at the threshold boundary, status PASS`, () => {
      const metrics = { [sourceKey]: threshold };
      const { explanation } = classifyAndExplain(label, {
        target_level: parseFloat(label), metrics, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 100
      });
      const g = explanation.hard_gates.find((x) => x.metric === sourceKey);
      assert.equal(g.status, 'PASS');
      assert.equal(g.direction, isMax ? 'MAX' : 'MIN');
      assert.equal(g.required, threshold);
      assert.equal(g.observed, threshold);
      assert.equal(g.margin, 0);
      assert.equal(g.reason_code, null);
    });

    test(`S6-T25/T28 [${label} ${gateKey}]: margin negative one unit past the boundary, status FAIL, reason_code exact`, () => {
      const beyond = isMax ? threshold + 1 : threshold - 1;
      const metrics = { [sourceKey]: beyond };
      const { explanation } = classifyAndExplain(label, {
        target_level: parseFloat(label), metrics, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 100
      });
      const g = explanation.hard_gates.find((x) => x.metric === sourceKey);
      assert.equal(g.status, 'FAIL');
      assert.equal(g.observed, beyond);
      assert.equal(g.margin, -1, 'margin is always -1 one unit past the boundary regardless of MIN/MAX direction');
      assert.equal(g.reason_code, isMax ? 'GATE_ABOVE_MAXIMUM' : 'GATE_BELOW_MINIMUM');
    });

    test(`S6-T26/T29 [${label} ${gateKey}]: margin positive comfortably on the good side of the boundary`, () => {
      const good = isMax ? Math.max(0, threshold - 5) : threshold + 5;
      const metrics = { [sourceKey]: good };
      const { explanation } = classifyAndExplain(label, {
        target_level: parseFloat(label), metrics, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 100
      });
      const g = explanation.hard_gates.find((x) => x.metric === sourceKey);
      assert.equal(g.status, 'PASS');
      assert.ok(g.margin > 0, `margin must be positive for ${gateKey} observed=${good} threshold=${threshold}`);
    });

    test(`S6-T30 [${label} ${gateKey}]: metric omitted entirely — observed/margin stay null (never coerced to 0), status still comes verbatim from S5's own FAIL`, () => {
      const { s5Result, explanation } = classifyAndExplain(label, {
        target_level: parseFloat(label), metrics: {}, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 100
      });
      const g = explanation.hard_gates.find((x) => x.metric === sourceKey);
      assert.equal(g.observed, null);
      assert.equal(g.margin, null);
      assert.equal(g.status, 'FAIL');
      assert.equal(g.status, s5Result.gate_results[gateKey] ? 'PASS' : 'FAIL', 'status must be the verbatim S5 boolean, not independently recomputed from the null observed value');
    });
  }
}
