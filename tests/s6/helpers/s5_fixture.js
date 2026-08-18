'use strict';
/* Shared test helper — produces a real S5 classification (via the unmodified
 * js/assessment-classifier.js) to use as the authoritative input to S6's
 * explainClassification(). S6 tests must never hand-construct a fake s5Result
 * shape; every fixture here is the actual output of PBAssessmentClassifier. */
const path = require('node:path');

const classifierFactory = require(path.join(__dirname, '..', '..', '..', 'js', 'assessment-classifier.js'));
const explainerFactory = require(path.join(__dirname, '..', '..', '..', 'js', 'assessment-explainer.js'));
const { LEVEL_GATES } = require('./level_gates.js');

const classifier = classifierFactory.createModule();
const explainer = explainerFactory.createModule();

function classify(label, input) {
  const levelConfig = LEVEL_GATES.levels[label];
  const s5Result = classifier.classifyLevel(input, levelConfig);
  return { s5Result, levelConfig, metrics: input.metrics || {} };
}

function classifyAndExplain(label, input) {
  const { s5Result, levelConfig, metrics } = classify(label, input);
  const explanation = explainer.explainClassification(s5Result, metrics, levelConfig);
  return { s5Result, levelConfig, metrics, explanation };
}

module.exports = { classifier, explainer, LEVEL_GATES, classify, classifyAndExplain };
