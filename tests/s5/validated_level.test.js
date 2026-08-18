'use strict';
/* S5 Test Matrix T38-T43: allowed validated levels are exactly {3.0,3.5,4.0,4.5,5.0}; the
 * highest independently-PASSing label wins; no PASS anywhere => null; no continuous/decimal
 * interpolation is ever produced; 4.5 and 5.0 provisional status is surfaced in the result
 * without excluding them from validation. Exercises the real loadConfig() -> validatedLevel()
 * path via the fetch stub (tests/s5/helpers/fetch_stub.js), not a bypass. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const factory = require(path.join(__dirname, '..', '..', 'js', 'assessment-classifier.js'));
const { LEVEL_GATES } = require('./helpers/level_gates.js');
const { installFetchStub } = require('./helpers/fetch_stub.js');

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
function unionAllPassMetrics() {
  let m = {};
  for (const label of ['3.0', '3.5', '4.0', '4.5', '5.0']) m = Object.assign(m, allPassMetrics(LEVEL_GATES.levels[label]));
  return m;
}

test('S5-T38: validatedLevel() result.level_results contains exactly the keys 3.0/3.5/4.0/4.5/5.0, no others', async () => {
  const restore = installFetchStub();
  try {
    const classifier = factory.createModule();
    await classifier.loadConfig('./data/');
    const r = classifier.validatedLevel({ metrics: {}, component_scores: { technical_score: 1, decision_score: 1, pressure_score: 1 }, evidence_confidence: 'C1' });
    assert.deepEqual(Object.keys(r.level_results).sort(), ['3.0', '3.5', '4.0', '4.5', '5.0']);
  } finally { restore(); }
});

test('S5-T39/T60: all levels comfortably PASS => validated_training_level is the highest label, 5.0', async () => {
  const restore = installFetchStub();
  try {
    const classifier = factory.createModule();
    await classifier.loadConfig('./data/');
    const r = classifier.validatedLevel({
      metrics: unionAllPassMetrics(),
      component_scores: { technical_score: 99, decision_score: 99, pressure_score: 99 },
      evidence_confidence: 'C4', match_transfer_score: 99
    });
    assert.equal(r.validated_training_level, 5.0);
    for (const label of ['3.0', '3.5', '4.0', '4.5', '5.0']) assert.equal(r.level_results[label].level_status, 'PASS');
  } finally { restore(); }
});

test('S5-T40: no level passes => validated_training_level is null (never a default/lowest level)', async () => {
  const restore = installFetchStub();
  try {
    const classifier = factory.createModule();
    await classifier.loadConfig('./data/');
    const r = classifier.validatedLevel({ metrics: {}, component_scores: { technical_score: 1, decision_score: 1, pressure_score: 1 }, evidence_confidence: 'C1' });
    assert.equal(r.validated_training_level, null);
  } finally { restore(); }
});

test('S5-T41: no continuous/decimal interpolation — validated_training_level is always exactly one of the five discrete labels or null, never e.g. 4.2', async () => {
  const restore = installFetchStub();
  try {
    const classifier = factory.createModule();
    await classifier.loadConfig('./data/');
    const allowed = [3.0, 3.5, 4.0, 4.5, 5.0, null];
    const scenarios = [
      { metrics: {}, component_scores: { technical_score: 50, decision_score: 50, pressure_score: 50 }, evidence_confidence: 'C4' },
      { metrics: unionAllPassMetrics(), component_scores: { technical_score: 77.7, decision_score: 88.8, pressure_score: 99.9 }, evidence_confidence: 'C4', match_transfer_score: 99 }
    ];
    for (const s of scenarios) {
      const r = classifier.validatedLevel(s);
      assert.ok(allowed.includes(r.validated_training_level), 'validated_training_level ' + r.validated_training_level + ' must be one of the discrete labels or null');
    }
  } finally { restore(); }
});

test('S5-T42: 4.5 provisional_level is surfaced true in the level_results entry, per data/level_gates_v2_3_1.json status="provisional"', async () => {
  assert.equal(LEVEL_GATES.levels['4.5'].status, 'provisional');
  const restore = installFetchStub();
  try {
    const classifier = factory.createModule();
    await classifier.loadConfig('./data/');
    const r = classifier.validatedLevel({ metrics: unionAllPassMetrics(), component_scores: { technical_score: 99, decision_score: 99, pressure_score: 99 }, evidence_confidence: 'C4', match_transfer_score: 99 });
    assert.equal(r.level_results['4.5'].provisional_level, true);
    assert.equal(r.level_results['4.5'].level_status, 'PASS', 'provisional PASS still counts toward validated_training_level');
  } finally { restore(); }
});

test('S5-T43: 5.0 provisional_level is surfaced true in the level_results entry, per data/level_gates_v2_3_1.json status="provisional"', async () => {
  assert.equal(LEVEL_GATES.levels['5.0'].status, 'provisional');
  const restore = installFetchStub();
  try {
    const classifier = factory.createModule();
    await classifier.loadConfig('./data/');
    const r = classifier.validatedLevel({ metrics: unionAllPassMetrics(), component_scores: { technical_score: 99, decision_score: 99, pressure_score: 99 }, evidence_confidence: 'C4', match_transfer_score: 99 });
    assert.equal(r.level_results['5.0'].provisional_level, true);
    assert.equal(r.level_results['5.0'].level_status, 'PASS');
  } finally { restore(); }
});

test('non-provisional levels (3.0/3.5/4.0) surface provisional_level false', async () => {
  const restore = installFetchStub();
  try {
    const classifier = factory.createModule();
    await classifier.loadConfig('./data/');
    const r = classifier.validatedLevel({ metrics: unionAllPassMetrics(), component_scores: { technical_score: 99, decision_score: 99, pressure_score: 99 }, evidence_confidence: 'C4', match_transfer_score: 99 });
    for (const label of ['3.0', '3.5', '4.0']) assert.equal(r.level_results[label].provisional_level, false);
  } finally { restore(); }
});

test('S5-R5: genuine non-contiguous PASS is preserved and exposed as-is (4.5 PASS while 3.0/3.5/4.0 all FAIL) — Owner-frozen decision, no contiguous-progression rule applied', async () => {
  const restore = installFetchStub();
  try {
    const classifier = factory.createModule();
    await classifier.loadConfig('./data/');
    const metrics = {
      serve_in_pct: 50, return_in_pct: 50, return_quality_pct: 50, drop_ball_quality_pct: 50,
      reset_ball_quality_pct: 50, shot_selection_pct: 50, pressure_success_pct: 50,
      pattern_success_pct: 90, attack_conversion_pct: 90, transition_nvz_gain_pct: 90,
      wrong_attack_pct: 5, ue_per_game: 1,
      rally_control_pct: 50, pattern_adaptation_pct: 50, neutralize_under_pressure_pct: 50
    };
    const r = classifier.validatedLevel({ metrics, component_scores: { technical_score: 95, decision_score: 90, pressure_score: 85 }, evidence_confidence: 'C3', match_transfer_score: 90 });
    assert.equal(r.level_results['3.0'].level_status, 'FAIL');
    assert.equal(r.level_results['3.5'].level_status, 'FAIL');
    assert.equal(r.level_results['4.0'].level_status, 'FAIL');
    assert.equal(r.level_results['4.5'].level_status, 'PASS');
    assert.equal(r.level_results['5.0'].level_status, 'LOW_CONFIDENCE');
    assert.equal(r.validated_training_level, 4.5, 'the higher PASS must be returned even though lower levels FAIL — never silently corrected/normalized');
  } finally { restore(); }
});

test('classifyTarget() throws a clear error for an unknown target_level, and resolves the correct config for a valid one', async () => {
  const restore = installFetchStub();
  try {
    const classifier = factory.createModule();
    await classifier.loadConfig('./data/');
    assert.throws(() => classifier.classifyTarget({ target_level: 3.25, metrics: {}, component_scores: { technical_score: 1, decision_score: 1, pressure_score: 1 }, evidence_confidence: 'C1' }));
    const r = classifier.classifyTarget({ target_level: 3.0, metrics: {}, component_scores: { technical_score: 1, decision_score: 1, pressure_score: 1 }, evidence_confidence: 'C1' });
    assert.equal(r.target_level, 3.0);
    assert.equal(r.capability_min, LEVEL_GATES.levels['3.0'].capability_min);
  } finally { restore(); }
});

test('classifyTarget()/validatedLevel() throw a clear error when loadConfig() has not been resolved yet', () => {
  const classifier = factory.createModule();
  assert.throws(() => classifier.classifyTarget({ target_level: 3.0, metrics: {}, component_scores: {}, evidence_confidence: 'C1' }));
  assert.throws(() => classifier.validatedLevel({ metrics: {}, component_scores: {}, evidence_confidence: 'C1' }));
});
