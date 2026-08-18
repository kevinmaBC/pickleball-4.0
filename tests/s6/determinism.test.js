'use strict';
/* S6 Test Matrix T50: repeated calls with identical (s5Result, metrics, levelConfig)
 * are deep-equal — no hidden clock/random dependency anywhere in explainClassification(). */
const test = require('node:test');
const assert = require('node:assert/strict');

const { classify } = require('./helpers/s5_fixture.js');
const explainerFactory = require('../../js/assessment-explainer.js');

const GOOD_COMPONENTS = { technical_score: 92, decision_score: 90, pressure_score: 88 };
const SAMPLE_METRICS = { serve_in_pct: 97, return_quality_pct: 80, drop_ball_quality_pct: 75, reset_ball_quality_pct: 70, shot_selection_pct: 85, pressure_success_pct: 75, ue_per_game: 2 };

test('S6-T50a: explainClassification — repeated calls with identical input are deep-equal', () => {
  const { s5Result, levelConfig, metrics } = classify('4.0', {
    target_level: 4.0, metrics: SAMPLE_METRICS, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 90
  });
  const explainer = explainerFactory.createModule();
  const a = explainer.explainClassification(s5Result, metrics, levelConfig);
  const b = explainer.explainClassification(s5Result, metrics, levelConfig);
  assert.deepEqual(a, b);
});

test('S6-T50b: deep-equal across two independent module instances', () => {
  const { s5Result, levelConfig, metrics } = classify('4.0', {
    target_level: 4.0, metrics: SAMPLE_METRICS, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 90
  });
  const e1 = explainerFactory.createModule();
  const e2 = explainerFactory.createModule();
  assert.deepEqual(e1.explainClassification(s5Result, metrics, levelConfig), e2.explainClassification(s5Result, metrics, levelConfig));
});
