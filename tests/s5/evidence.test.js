'use strict';
/* S5 Test Matrix T16-T20: EVIDENCE_RANK C1<C2<C3<C4 exact; insufficient evidence =>
 * LOW_CONFIDENCE per the frozen reference; evidence at the exact minimum rank passes;
 * no confidence derivation from counts/dates (evidence_confidence is the only accepted
 * evidence-shaped input — there is no alternate parameter path); an invalid confidence
 * value is explicitly rejected (thrown), never silently coerced. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const factory = require(path.join(__dirname, '..', '..', 'js', 'assessment-classifier.js'));
const { LEVEL_GATES } = require('./helpers/level_gates.js');

const classifier = factory.createModule();
const GOOD_COMPONENTS = { technical_score: 95, decision_score: 95, pressure_score: 95 };
const GOOD_METRICS_40 = { serve_in_pct: 97, return_quality_pct: 80, drop_ball_quality_pct: 75, reset_ball_quality_pct: 70, shot_selection_pct: 85, pressure_success_pct: 75, ue_per_game: 2 };

test('S5-T16: EVIDENCE_RANK is exactly C1<C2<C3<C4 (1<2<3<4), mirroring the frozen Python reference', () => {
  assert.deepEqual(factory.EVIDENCE_RANK, { C1: 1, C2: 2, C3: 3, C4: 4 });
});

test('S5-T17: evidence below a level\'s evidence_min => LOW_CONFIDENCE (never PASS/BORDERLINE/FAIL)', () => {
  // 4.0's evidence_min is C3; supply C2 (insufficient) with otherwise-perfect gates/capability.
  const r = classifier.classifyLevel(
    { target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C2', match_transfer_score: 100 },
    LEVEL_GATES.levels['4.0']
  );
  assert.equal(r.level_status, 'LOW_CONFIDENCE');
  assert.equal(r.evidence.ok, false);
});

test('S5-T18: evidence at the exact minimum rank passes the evidence check', () => {
  // 4.0's evidence_min is C3 — supplying exactly C3 must satisfy evidence.ok.
  const r = classifier.classifyLevel(
    { target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C3', match_transfer_score: 100 },
    LEVEL_GATES.levels['4.0']
  );
  assert.equal(r.evidence.ok, true);
  assert.notEqual(r.level_status, 'LOW_CONFIDENCE');
});

test('S5-T19: no confidence derivation from counts/dates — evidence_confidence is the ONLY evidence-shaped input the API accepts; there is no session-count/date parameter anywhere in classifyLevel\'s input surface', () => {
  const inputWithExtraneousFields = {
    target_level: 4.0,
    metrics: GOOD_METRICS_40,
    component_scores: GOOD_COMPONENTS,
    evidence_confidence: 'C1',
    match_transfer_score: 100,
    // deliberately inject count/date-shaped fields that a derivation implementation might
    // have been tempted to read — the classifier must ignore them entirely and still return
    // LOW_CONFIDENCE strictly from the literal 'C1' string.
    test_date_count: 99, video_match_count: 99, session_dates: ['2026-01-01', '2026-01-02', '2026-01-03']
  };
  const r = classifier.classifyLevel(inputWithExtraneousFields, LEVEL_GATES.levels['4.0']);
  assert.equal(r.level_status, 'LOW_CONFIDENCE', 'extraneous count/date fields must never upgrade C1 into a passing evidence rank');
  assert.equal(r.evidence.input, 'C1');
});

test('S5-T20: an evidence_confidence value outside {C1,C2,C3,C4} is explicitly rejected (thrown), never silently coerced', () => {
  assert.throws(
    () => classifier.classifyLevel({ target_level: 3.0, metrics: {}, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C5' }, LEVEL_GATES.levels['3.0']),
    (err) => err.code === 'INVALID_EVIDENCE_CONFIDENCE'
  );
  assert.throws(
    () => classifier.classifyLevel({ target_level: 3.0, metrics: {}, component_scores: GOOD_COMPONENTS, evidence_confidence: 'high' }, LEVEL_GATES.levels['3.0']),
    (err) => err.code === 'INVALID_EVIDENCE_CONFIDENCE'
  );
  assert.throws(
    () => classifier.classifyLevel({ target_level: 3.0, metrics: {}, component_scores: GOOD_COMPONENTS, evidence_confidence: undefined }, LEVEL_GATES.levels['3.0']),
    (err) => err.code === 'INVALID_EVIDENCE_CONFIDENCE'
  );
});
