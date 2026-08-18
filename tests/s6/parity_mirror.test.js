'use strict';
/* Owner-approved S6 Decision E enforcement: PBAssessmentExplainer's
 * CAPABILITY_WEIGHTS/BORDERLINE_BAND_PP are display-only mirrors of
 * js/assessment-classifier.js's own hardcoded literals (Owner-frozen S5 R1/R4) —
 * never an independent S6 policy source. This file proves numeric parity: applying
 * the mirrored weights to a component-score object reproduces S5's real
 * capability_score_0_100 output exactly, and the mirrored band reproduces S5's real
 * BORDERLINE/PASS/FAIL boundary exactly (also re-checked in capability_explain T20). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const classifierFactory = require('../../js/assessment-classifier.js');
const explainerFactory = require('../../js/assessment-explainer.js');

const explainer = explainerFactory.createModule();

test('parity: PBAssessmentExplainer.CAPABILITY_WEIGHTS applied by hand reproduces PBAssessmentClassifier.calculateCapabilityScore() exactly, across many component-score samples', () => {
  const samples = [
    { technical_score: 80, decision_score: 78, pressure_score: 75 },
    { technical_score: 92, decision_score: 90, pressure_score: 88 },
    { technical_score: 60, decision_score: 60, pressure_score: 60 },
    { technical_score: 100, decision_score: 0, pressure_score: 50 },
    { technical_score: 33.3, decision_score: 55.5, pressure_score: 77.7 }
  ];
  const w = explainer.CAPABILITY_WEIGHTS;
  samples.forEach((s) => {
    const mirrored = w.technical_score * s.technical_score + w.decision_score * s.decision_score + w.pressure_score * s.pressure_score;
    const authoritative = classifierFactory.calculateCapabilityScore(s);
    // authoritative is round-half-even to 1 decimal (R1); the mirrored raw dot-product
    // must land within rounding distance of it — proving the weights are the SAME
    // weights, not a drifted second copy.
    assert.ok(Math.abs(mirrored - authoritative) < 0.05, `mirrored=${mirrored} vs authoritative=${authoritative} for ${JSON.stringify(s)}`);
  });
});

test('parity: PBAssessmentExplainer.BORDERLINE_BAND_PP (5) matches the literal hardcoded inside js/assessment-classifier.js\'s classifyCore()', () => {
  const classifierSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'assessment-classifier.js'), 'utf8');
  assert.match(classifierSrc, /Math\.abs\(cap - levelCfg\.capability_min\) <= 5/, 'S5 source must still hardcode the same 5-point band this mirror assumes');
  assert.equal(explainer.BORDERLINE_BAND_PP, 5);
});

test('parity: CAPABILITY_WEIGHTS values match the literal multipliers hardcoded inside js/assessment-classifier.js\'s calculateCapabilityScore()', () => {
  const classifierSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'assessment-classifier.js'), 'utf8');
  assert.match(classifierSrc, /0\.45 \* componentScores\.technical_score/);
  assert.match(classifierSrc, /0\.30 \* componentScores\.decision_score/);
  assert.match(classifierSrc, /0\.25 \* componentScores\.pressure_score/);
  assert.deepEqual(explainer.CAPABILITY_WEIGHTS, { technical_score: 0.45, decision_score: 0.30, pressure_score: 0.25 });
});
