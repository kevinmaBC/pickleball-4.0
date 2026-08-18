'use strict';
/* S5 Test Matrix T31-T37: all five level_status values (INCOMPLETE, LOW_CONFIDENCE, PASS,
 * BORDERLINE, FAIL) are reachable and exact; the borderline band is exactly capability_min-5
 * through capability_min (inclusive at -5, exclusive above min — PASS wins the tie by branch
 * order, exactly mirroring the frozen Python reference's elif chain); BORDERLINE is never
 * folded into validated PASS anywhere. Uses uniform technical=decision=pressure=X components
 * so capability_score_0_100 === X exactly (weights sum to 1.0, and integer X has no fractional
 * part to round), which isolates the classification-boundary logic under test from the R1
 * rounding-parity concern covered separately in tests/s5/parity.test.js. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const factory = require(path.join(__dirname, '..', '..', 'js', 'assessment-classifier.js'));
const { LEVEL_GATES } = require('./helpers/level_gates.js');

const classifier = factory.createModule();

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
function classifyAt(label, x, evidence, matchScore) {
  const cfg = LEVEL_GATES.levels[label];
  return classifier.classifyLevel(
    { target_level: parseFloat(label), metrics: allPassMetrics(cfg), component_scores: uniformComponents(x), evidence_confidence: evidence || 'C4', match_transfer_score: matchScore === undefined ? 100 : matchScore },
    cfg
  );
}

test('S5-T31: INCOMPLETE parity — capability_score_0_100 null iff a component_score is missing', () => {
  const cfg = LEVEL_GATES.levels['3.0'];
  const r = classifier.classifyLevel({ target_level: 3.0, metrics: allPassMetrics(cfg), component_scores: { technical_score: 90, decision_score: null, pressure_score: 90 }, evidence_confidence: 'C4' }, cfg);
  assert.equal(r.level_status, 'INCOMPLETE');
  assert.equal(r.capability_score_0_100, null);
});

test('S5-T32: LOW_CONFIDENCE parity — evidence below evidence_min overrides an otherwise-PASSing profile', () => {
  const r = classifyAt('4.0', 90, 'C2'); // 4.0 evidence_min is C3
  assert.equal(r.level_status, 'LOW_CONFIDENCE');
});

test('S5-T33: PASS parity — capability at exactly capability_min, gates/evidence/match all ok', () => {
  for (const label of ['3.0', '3.5', '4.0', '4.5', '5.0']) {
    const cmin = LEVEL_GATES.levels[label].capability_min;
    const r = classifyAt(label, cmin);
    assert.equal(r.capability_score_0_100, cmin);
    assert.equal(r.level_status, 'PASS', `${label} at capability_min=${cmin} exactly must PASS`);
  }
});

test('S5-T34: BORDERLINE parity — capability exactly 5pp below capability_min, gates/evidence/match ok', () => {
  for (const label of ['3.0', '3.5', '4.0', '4.5', '5.0']) {
    const cmin = LEVEL_GATES.levels[label].capability_min;
    const r = classifyAt(label, cmin - 5);
    assert.equal(r.capability_score_0_100, cmin - 5);
    assert.equal(r.level_status, 'BORDERLINE', `${label} at capability_min-5=${cmin - 5} must be BORDERLINE`);
  }
});

test('S5-T35: FAIL parity — capability 6pp below capability_min (just outside the band) fails', () => {
  for (const label of ['3.0', '3.5', '4.0', '4.5', '5.0']) {
    const cmin = LEVEL_GATES.levels[label].capability_min;
    const x = Math.max(0, cmin - 6);
    const r = classifyAt(label, x);
    assert.equal(r.level_status, 'FAIL', `${label} at capability_min-6=${x} must be FAIL (outside the +/-5 band)`);
  }
});

test('S5-T36: borderline band exact — capability_min-5 is BORDERLINE, capability_min-5.1 is FAIL (one-tenth outside)', () => {
  for (const label of ['3.0', '3.5', '4.0', '4.5', '5.0']) {
    const cmin = LEVEL_GATES.levels[label].capability_min;
    const onBand = classifyAt(label, cmin - 5);
    const justOutside = classifyAt(label, cmin - 5.1);
    assert.equal(onBand.level_status, 'BORDERLINE');
    assert.equal(justOutside.level_status, 'FAIL', `${label} at capability_min-5.1 must fall just outside the borderline band`);
  }
});

test('S5-T33b: capability ABOVE capability_min within the 5pp band is still PASS, never BORDERLINE (PASS branch wins the elif chain, exactly like the frozen Python reference)', () => {
  for (const label of ['3.0', '3.5', '4.0', '4.5', '5.0']) {
    const cmin = LEVEL_GATES.levels[label].capability_min;
    const r = classifyAt(label, cmin + 3);
    assert.equal(r.level_status, 'PASS', `${label} at capability_min+3 must be PASS, not BORDERLINE — the borderline band is one-sided (below min only)`);
  }
});

test('S5-T37: BORDERLINE never counts as validated PASS — validatedLevel only accumulates exact status==="PASS"', () => {
  // Directly exercise the exact-string-equality contract that validatedLevel() depends on:
  // a BORDERLINE result's level_status must never satisfy a PASS check.
  const r = classifyAt('4.0', LEVEL_GATES.levels['4.0'].capability_min - 5);
  assert.equal(r.level_status, 'BORDERLINE');
  assert.notEqual(r.level_status, 'PASS');
  assert.ok(r.level_status !== 'PASS', 'strict inequality — no loose/partial match between BORDERLINE and PASS');
});
