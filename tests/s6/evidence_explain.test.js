'use strict';
/* S6 Test Matrix T33-T37: evidence.input/minimum copied exactly from S5; sufficient
 * evidence -> PASS; insufficient -> FAIL (while overall classification_status is
 * LOW_CONFIDENCE); no C-level derivation from counts/dates, static and behavioral;
 * evidence at the exact minimum rank passes (parity with S5-T18). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { classifyAndExplain } = require('./helpers/s5_fixture.js');

const GOOD_COMPONENTS = { technical_score: 95, decision_score: 95, pressure_score: 95 };
const GOOD_METRICS_40 = { serve_in_pct: 97, return_quality_pct: 80, drop_ball_quality_pct: 75, reset_ball_quality_pct: 70, shot_selection_pct: 85, pressure_success_pct: 75, ue_per_game: 2 };

test('S6-T33: evidence.input/minimum copied exactly from s5Result.evidence', () => {
  const { s5Result, explanation } = classifyAndExplain('4.0', {
    target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C3', match_transfer_score: 100
  });
  assert.equal(explanation.evidence.input, s5Result.evidence.input);
  assert.equal(explanation.evidence.minimum, s5Result.evidence.minimum);
  assert.equal(explanation.evidence.input, 'C3');
  assert.equal(explanation.evidence.minimum, 'C3');
});

test('S6-T34: sufficient evidence (rank >= minimum) -> evidence.status PASS', () => {
  const { s5Result, explanation } = classifyAndExplain('4.0', {
    target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 100
  });
  assert.equal(s5Result.evidence.ok, true);
  assert.equal(explanation.evidence.status, 'PASS');
});

test('S6-T35: insufficient evidence -> evidence.status FAIL, while overall classification_status is LOW_CONFIDENCE (two distinct, non-contradictory facts)', () => {
  const { s5Result, explanation } = classifyAndExplain('4.0', {
    target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C2', match_transfer_score: 100
  });
  assert.equal(s5Result.evidence.ok, false);
  assert.equal(explanation.evidence.status, 'FAIL');
  assert.equal(explanation.classification_status, 'LOW_CONFIDENCE');
});

test('S6-T36 (static): assessment-explainer.js contains no count/date-driven confidence-derivation vocabulary', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'assessment-explainer.js'), 'utf8');
  ['session_date', 'test_dates', '.length >=', 'daysSince', 'dateDiff'].forEach((needle) => {
    assert.ok(!src.includes(needle), 'no count/date-driven confidence-derivation vocabulary: ' + needle);
  });
});

test('S6-T36 (behavioral): extraneous count/date-shaped fields on metrics never influence evidence.status — evidence.status is driven solely by s5Result.evidence.ok', () => {
  const { explanation } = classifyAndExplain('4.0', {
    target_level: 4.0,
    metrics: Object.assign({}, GOOD_METRICS_40, { test_date_count: 99, video_match_count: 99, session_dates: ['2026-01-01', '2026-01-02', '2026-01-03'] }),
    component_scores: GOOD_COMPONENTS, evidence_confidence: 'C1', match_transfer_score: 100
  });
  assert.equal(explanation.evidence.status, 'FAIL', 'extraneous count/date fields must never upgrade C1 into a passing evidence rank');
  assert.equal(explanation.evidence.input, 'C1');
});

test('S6-T37: evidence at the exact minimum rank passes (parity with tests/s5/evidence.test.js S5-T18)', () => {
  const { s5Result, explanation } = classifyAndExplain('4.0', {
    target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C3', match_transfer_score: 100
  });
  assert.equal(s5Result.evidence.ok, true);
  assert.equal(explanation.evidence.status, 'PASS');
  assert.notEqual(explanation.classification_status, 'LOW_CONFIDENCE');
});
