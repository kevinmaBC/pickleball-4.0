'use strict';
/* S5 Test Matrix T61: repeated calls with identical input are deep-equal — no hidden
 * clock/random/Date.now() dependency anywhere in classifyLevel/classifyTarget/validatedLevel. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const factory = require(path.join(__dirname, '..', '..', 'js', 'assessment-classifier.js'));
const { LEVEL_GATES } = require('./helpers/level_gates.js');
const { installFetchStub } = require('./helpers/fetch_stub.js');

const SAMPLE_INPUT = {
  target_level: 4.0,
  metrics: { serve_in_pct: 97, return_quality_pct: 80, drop_ball_quality_pct: 75, reset_ball_quality_pct: 70, shot_selection_pct: 85, pressure_success_pct: 75, ue_per_game: 2 },
  component_scores: { technical_score: 92, decision_score: 90, pressure_score: 88 },
  evidence_confidence: 'C4',
  match_transfer_score: 90
};

test('S5-T61a: classifyLevel — repeated calls with identical input are deep-equal', () => {
  const classifier = factory.createModule();
  const a = classifier.classifyLevel(SAMPLE_INPUT, LEVEL_GATES.levels['4.0']);
  const b = classifier.classifyLevel(SAMPLE_INPUT, LEVEL_GATES.levels['4.0']);
  assert.deepEqual(a, b);
});

test('S5-T61b: calculateCapabilityScore — repeated calls are deep-equal (and equal across two independent module instances)', () => {
  const c1 = factory.createModule();
  const c2 = factory.createModule();
  const scores = { technical_score: 77.7, decision_score: 55.5, pressure_score: 33.3 };
  assert.equal(c1.calculateCapabilityScore(scores), c1.calculateCapabilityScore(scores));
  assert.equal(c1.calculateCapabilityScore(scores), c2.calculateCapabilityScore(scores));
});

test('S5-T61c: validatedLevel — repeated calls with identical input are deep-equal', async () => {
  const restore = installFetchStub();
  try {
    const classifier = factory.createModule();
    await classifier.loadConfig('./data/');
    const input = { metrics: SAMPLE_INPUT.metrics, component_scores: SAMPLE_INPUT.component_scores, evidence_confidence: SAMPLE_INPUT.evidence_confidence, match_transfer_score: SAMPLE_INPUT.match_transfer_score };
    const a = classifier.validatedLevel(input);
    const b = classifier.validatedLevel(input);
    assert.deepEqual(a, b);
  } finally { restore(); }
});
