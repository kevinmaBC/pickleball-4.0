'use strict';
/* S5 Test Matrix T44-T47: JS<->Python parity for capability_score, gate_results,
 * classification status, and validated_level. Every expected value in
 * tests/s5/fixtures/golden_vectors.json was produced by actually running the frozen
 * schemas/scoring_engine_reference_v2_3_1.py once (tests/s5/helpers/generate_golden_vectors.py)
 * — never hand-derived — per Owner-frozen R1. This file only re-checks the already-generated
 * fixture against the JS implementation; it does not invoke Python. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const factory = require(path.join(__dirname, '..', '..', 'js', 'assessment-classifier.js'));
const { LEVEL_GATES } = require('./helpers/level_gates.js');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'golden_vectors.json'), 'utf8'));
const classifier = factory.createModule();

test('golden_vectors.json fixture is present, non-trivial, and declares its Python provenance', () => {
  assert.ok(fixture.capability_vectors.length >= 40, 'expected a substantial capability-score golden-vector set');
  assert.ok(fixture.classify_vectors.length >= 80, 'expected a substantial classify() golden-vector set');
  assert.ok(fixture.validated_level_vectors.length >= 3, 'expected at least the all-PASS / no-PASS / non-contiguous validated_level golden vectors');
  assert.match(fixture.generated_from, /scoring_engine_reference_v2_3_1\.py/);
});

test('S5-T44 (capability_score parity, including rounding tie-boundary stress — Owner-frozen R1): every golden capability vector matches exactly', () => {
  let checked = 0;
  for (const v of fixture.capability_vectors) {
    const got = factory.calculateCapabilityScore({ technical_score: v.technical_score, decision_score: v.decision_score, pressure_score: v.pressure_score });
    assert.equal(got, v.expected_capability_score_0_100, 'capability_score parity mismatch for ' + v.note);
    checked++;
  }
  assert.equal(checked, fixture.capability_vectors.length);
});

test('S5-T45/T46 (gate_results + classification-status parity): every golden classify vector matches exactly', () => {
  let checked = 0;
  for (const v of fixture.classify_vectors) {
    const levelCfg = LEVEL_GATES.levels[v.level_label];
    const input = {
      target_level: parseFloat(v.level_label),
      metrics: v.metrics,
      component_scores: v.component_scores,
      evidence_confidence: v.evidence_confidence,
      match_transfer_score: v.match_transfer_score
    };
    const result = classifier.classifyLevel(input, levelCfg);
    const want = v.expected;

    assert.equal(result.level_status, want.status, 'status parity mismatch for ' + v.note);
    assert.equal(result.capability_score_0_100, want.capability_score_0_100, 'capability parity mismatch for ' + v.note);
    if (want.status !== 'INCOMPLETE') {
      assert.deepEqual(result.gate_results, want.gate_results, 'gate_results parity mismatch for ' + v.note);
      assert.equal(result.evidence.ok, want.evidence_ok, 'evidence_ok parity mismatch for ' + v.note);
      assert.equal(result.match_validation.ok, want.match_validation_ok, 'match_validation_ok parity mismatch for ' + v.note);
    }
    checked++;
  }
  assert.equal(checked, fixture.classify_vectors.length);
});

test('S5-T47 (validated_level parity, including the genuine non-contiguous-PASS case): every golden validated_level vector matches exactly', () => {
  let checked = 0;
  for (const v of fixture.validated_level_vectors) {
    const levelResults = {};
    const passed = [];
    for (const label of ['3.0', '3.5', '4.0', '4.5', '5.0']) {
      const levelCfg = LEVEL_GATES.levels[label];
      const r = classifier.classifyLevel(
        { target_level: parseFloat(label), metrics: v.metrics, component_scores: v.component_scores, evidence_confidence: v.evidence_confidence, match_transfer_score: v.match_transfer_score },
        levelCfg
      );
      levelResults[label] = r.level_status;
      if (r.level_status === 'PASS') passed.push(parseFloat(label));
    }
    const validated = passed.length ? Math.max(...passed) : null;
    assert.deepEqual(levelResults, v.expected_level_results_status, 'level_results status parity mismatch for ' + v.note);
    assert.equal(validated, v.expected_validated_training_level, 'validated_training_level parity mismatch for ' + v.note);
    checked++;
  }
  assert.equal(checked, fixture.validated_level_vectors.length);
});
