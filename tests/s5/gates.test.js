'use strict';
/* S5 Test Matrix T14, T21-T26: Match Transfer excluded from the capability-score formula;
 * min-threshold (>=) and _max-threshold (<=) hard gates exact at the boundary and one unit
 * beyond it; a missing gate metric can never PASS; classifyLevel(level X) only ever
 * evaluates level X's own hard_gates, never another level's. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const factory = require(path.join(__dirname, '..', '..', 'js', 'assessment-classifier.js'));
const { LEVEL_GATES } = require('./helpers/level_gates.js');

const classifier = factory.createModule();
const GOOD_COMPONENTS = { technical_score: 95, decision_score: 95, pressure_score: 95 };

test('S5-T14: match_transfer_score never participates in the capability_score formula', () => {
  const a = factory.calculateCapabilityScore(GOOD_COMPONENTS);
  // calculateCapabilityScore doesn't even accept match_transfer_score as a parameter; prove it
  // structurally by confirming a wildly different match_transfer_score never changes the
  // computed capability at the classifyLevel level either.
  const r1 = classifier.classifyLevel(
    { target_level: 4.0, metrics: { serve_in_pct: 97, return_quality_pct: 80, drop_ball_quality_pct: 75, reset_ball_quality_pct: 70, shot_selection_pct: 85, pressure_success_pct: 75, ue_per_game: 2 }, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 0 },
    LEVEL_GATES.levels['4.0']
  );
  const r2 = classifier.classifyLevel(
    { target_level: 4.0, metrics: { serve_in_pct: 97, return_quality_pct: 80, drop_ball_quality_pct: 75, reset_ball_quality_pct: 70, shot_selection_pct: 85, pressure_success_pct: 75, ue_per_game: 2 }, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 100 },
    LEVEL_GATES.levels['4.0']
  );
  assert.equal(r1.capability_score_0_100, a);
  assert.equal(r2.capability_score_0_100, a);
  assert.equal(r1.capability_score_0_100, r2.capability_score_0_100, 'match_transfer_score must never change capability_score_0_100 even though it changes match_validation.ok');
  assert.notEqual(r1.match_validation.ok, r2.match_validation.ok, 'sanity: match_transfer_score DID change match_validation.ok, proving it is read elsewhere, just never folded into capability');
});

for (const label of ['3.0', '3.5', '4.0', '4.5', '5.0']) {
  const cfg = LEVEL_GATES.levels[label];
  for (const [gateKey, rule] of Object.entries(cfg.hard_gates)) {
    const isMax = gateKey.endsWith('_max');
    const sourceKey = isMax ? gateKey.slice(0, -4) : gateKey;
    const threshold = rule.threshold;

    test(`S5-T21/T23 [${label} ${gateKey}]: exact-threshold boundary passes`, () => {
      const metrics = { [sourceKey]: threshold };
      const r = classifier.classifyLevel({ target_level: parseFloat(label), metrics, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 100 }, cfg);
      assert.equal(r.gate_results[gateKey], true, `${gateKey} at exact threshold ${threshold} must pass (${isMax ? '<=' : '>='})`);
    });

    test(`S5-T22/T24 [${label} ${gateKey}]: one unit beyond the boundary fails`, () => {
      const beyond = isMax ? threshold + 1 : threshold - 1;
      const metrics = { [sourceKey]: beyond };
      const r = classifier.classifyLevel({ target_level: parseFloat(label), metrics, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 100 }, cfg);
      assert.equal(r.gate_results[gateKey], false, `${gateKey} at ${beyond} (one unit past ${threshold}) must fail`);
    });

    test(`S5-T25 [${label} ${gateKey}]: metric omitted entirely can never PASS this gate`, () => {
      const r = classifier.classifyLevel({ target_level: parseFloat(label), metrics: {}, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 100 }, cfg);
      assert.equal(r.gate_results[gateKey], false, `${gateKey} must be false when its source metric is entirely absent`);
      assert.notEqual(r.level_status, 'PASS', 'a level with a missing gate metric can never be PASS');
      assert.notEqual(r.level_status, 'BORDERLINE', 'a level with a missing gate metric can never be BORDERLINE either (all gates must pass for BORDERLINE too)');
    });
  }

  test(`S5-T26 [${label}]: gate_results contains exactly this level's own hard_gates keys, no others`, () => {
    const r = classifier.classifyLevel({ target_level: parseFloat(label), metrics: {}, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4' }, cfg);
    assert.deepEqual(Object.keys(r.gate_results).sort(), Object.keys(cfg.hard_gates).sort());
  });
}
