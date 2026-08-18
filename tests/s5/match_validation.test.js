'use strict';
/* S5 Test Matrix T27-T30: 4.0 requires match_transfer_score >= 70 (per the frozen
 * data/level_gates_v2_3_1.json); the exact minimum passes; one below fails (forcing
 * an overall FAIL even when gates/capability/evidence are otherwise perfect); levels
 * without a match_validation config (3.0/3.5/4.5/5.0 today) are entirely unaffected
 * by match_transfer_score, including when it's missing. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const factory = require(path.join(__dirname, '..', '..', 'js', 'assessment-classifier.js'));
const { LEVEL_GATES } = require('./helpers/level_gates.js');

const classifier = factory.createModule();
const GOOD_COMPONENTS = { technical_score: 95, decision_score: 95, pressure_score: 95 };
const GOOD_METRICS_40 = { serve_in_pct: 97, return_quality_pct: 80, drop_ball_quality_pct: 75, reset_ball_quality_pct: 70, shot_selection_pct: 85, pressure_success_pct: 75, ue_per_game: 2 };

test('S5-T27: 4.0 has match_validation.required === true with min_match_transfer_score === 70 (frozen config)', () => {
  const mv = LEVEL_GATES.levels['4.0'].match_validation;
  assert.equal(mv.required, true);
  assert.equal(mv.min_match_transfer_score, 70);
});

test('S5-T28: match_transfer_score at the exact minimum (70) passes match_validation', () => {
  const r = classifier.classifyLevel(
    { target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 70 },
    LEVEL_GATES.levels['4.0']
  );
  assert.equal(r.match_validation.ok, true);
  assert.equal(r.level_status, 'PASS');
});

test('S5-T29: match_transfer_score one below the minimum (69) fails match_validation and forces overall FAIL', () => {
  const r = classifier.classifyLevel(
    { target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 69 },
    LEVEL_GATES.levels['4.0']
  );
  assert.equal(r.match_validation.ok, false);
  assert.equal(r.level_status, 'FAIL', 'match failure forces FAIL even though gates/capability/evidence are otherwise all satisfied');
});

test('S5-T29b: match_transfer_score entirely missing on a match-required level fails match_validation and forces FAIL', () => {
  const r = classifier.classifyLevel(
    { target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4' },
    LEVEL_GATES.levels['4.0']
  );
  assert.equal(r.match_validation.ok, false);
  assert.equal(r.level_status, 'FAIL');
  assert.ok(r.missing_inputs.includes('match_transfer_score'));
});

for (const label of ['3.0', '3.5', '4.5', '5.0']) {
  test(`S5-T30 [${label}]: no match_validation configured — a missing OR very low match_transfer_score never affects the outcome`, () => {
    const cfg = LEVEL_GATES.levels[label];
    assert.equal(cfg.match_validation, undefined, `${label} must have no match_validation config in the frozen JSON`);

    const buildInput = (mts) => ({
      target_level: parseFloat(label),
      metrics: buildAllPassMetrics(cfg),
      component_scores: GOOD_COMPONENTS,
      evidence_confidence: 'C4',
      match_transfer_score: mts
    });
    const rMissing = classifier.classifyLevel(buildInput(undefined), cfg);
    const rZero = classifier.classifyLevel(buildInput(0), cfg);
    const rHigh = classifier.classifyLevel(buildInput(100), cfg);

    assert.equal(rMissing.match_validation.configured, false);
    assert.equal(rMissing.match_validation.ok, true, 'match_validation.ok defaults to true when unconfigured, exactly like the frozen Python reference');
    assert.equal(rMissing.level_status, rZero.level_status);
    assert.equal(rMissing.level_status, rHigh.level_status);
    assert.equal(rMissing.level_status, 'PASS', 'sanity: this level does actually PASS on gates/capability/evidence alone');
  });
}

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
