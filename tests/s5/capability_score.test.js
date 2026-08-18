'use strict';
/* S5 Test Matrix T09-T13: capability_score = 0.45*technical + 0.30*decision + 0.25*pressure,
 * exact weights; missing technical/decision/pressure => INCOMPLETE (capability null); a
 * stored 0 is a real value, never treated as missing. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const factory = require(path.join(__dirname, '..', '..', 'js', 'assessment-classifier.js'));
const { LEVEL_GATES } = require('./helpers/level_gates.js');

const classifier = factory.createModule();

test('S5-T09: exact 0.45/0.30/0.25 formula (weights read from data/level_gates_v2_3_1.json match the frozen Python reference)', () => {
  assert.deepEqual(LEVEL_GATES.capability_weights, { technical_score: 0.45, decision_score: 0.3, pressure_score: 0.25 });
  const got = factory.calculateCapabilityScore({ technical_score: 100, decision_score: 0, pressure_score: 0 });
  assert.equal(got, 45.0);
  const got2 = factory.calculateCapabilityScore({ technical_score: 0, decision_score: 100, pressure_score: 0 });
  assert.equal(got2, 30.0);
  const got3 = factory.calculateCapabilityScore({ technical_score: 0, decision_score: 0, pressure_score: 100 });
  assert.equal(got3, 25.0);
});

test('S5-T10: missing technical_score => capability_score_0_100 null, level_status INCOMPLETE', () => {
  const r = classifier.classifyLevel(
    { target_level: 3.0, metrics: { serve_in_pct: 90, return_in_pct: 85, ue_per_game: 2 }, component_scores: { technical_score: undefined, decision_score: 80, pressure_score: 80 }, evidence_confidence: 'C4' },
    LEVEL_GATES.levels['3.0']
  );
  assert.equal(r.capability_score_0_100, null);
  assert.equal(r.level_status, 'INCOMPLETE');
});

test('S5-T11: missing decision_score => capability_score_0_100 null, level_status INCOMPLETE', () => {
  const r = classifier.classifyLevel(
    { target_level: 3.0, metrics: { serve_in_pct: 90, return_in_pct: 85, ue_per_game: 2 }, component_scores: { technical_score: 80, decision_score: null, pressure_score: 80 }, evidence_confidence: 'C4' },
    LEVEL_GATES.levels['3.0']
  );
  assert.equal(r.capability_score_0_100, null);
  assert.equal(r.level_status, 'INCOMPLETE');
});

test('S5-T12: missing pressure_score => capability_score_0_100 null, level_status INCOMPLETE', () => {
  const r = classifier.classifyLevel(
    { target_level: 3.0, metrics: { serve_in_pct: 90, return_in_pct: 85, ue_per_game: 2 }, component_scores: { technical_score: 80, decision_score: 80 }, evidence_confidence: 'C4' },
    LEVEL_GATES.levels['3.0']
  );
  assert.equal(r.capability_score_0_100, null);
  assert.equal(r.level_status, 'INCOMPLETE');
});

test('S5-T13: a stored 0 component score is a real value, never coerced into "missing" (must not trigger INCOMPLETE)', () => {
  const got = factory.calculateCapabilityScore({ technical_score: 0, decision_score: 80, pressure_score: 80 });
  assert.notEqual(got, null);
  assert.equal(got, 44.0); // 0.45*0 + 0.30*80 + 0.25*80 = 44
  const r = classifier.classifyLevel(
    { target_level: 3.0, metrics: { serve_in_pct: 90, return_in_pct: 85, ue_per_game: 2 }, component_scores: { technical_score: 0, decision_score: 80, pressure_score: 80 }, evidence_confidence: 'C4' },
    LEVEL_GATES.levels['3.0']
  );
  assert.notEqual(r.level_status, 'INCOMPLETE');
  assert.equal(r.capability_score_0_100, 44.0);
});

test('null vs 0 distinguished for all three components independently (component_scores echoed back unchanged)', () => {
  const r = classifier.classifyLevel(
    { target_level: 3.0, metrics: {}, component_scores: { technical_score: 0, decision_score: 0, pressure_score: 0 }, evidence_confidence: 'C4' },
    LEVEL_GATES.levels['3.0']
  );
  assert.equal(r.capability_score_0_100, 0);
  assert.deepEqual(r.component_scores, { technical_score: 0, decision_score: 0, pressure_score: 0 });
});
