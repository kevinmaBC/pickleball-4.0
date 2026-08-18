'use strict';
/* S5 Acceptance Gate — static index.html load-order check (S5-T58). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const scriptSrcs = [...html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map((m) => m[1]);

const LEGACY_ORDER = [
  './js/i18n.js', './js/config-loader.js', './js/storage.js', './js/metrics.js',
  './js/preview.js', './js/app.js', './js/assessment.js'
];

test('legacy script relative order is still preserved', () => {
  const positions = LEGACY_ORDER.map((src) => scriptSrcs.indexOf(src));
  assert.ok(positions.every((i) => i !== -1));
  for (let i = 1; i < positions.length; i++) assert.ok(positions[i] > positions[i - 1]);
});

test('S0-S4 canonical/evidence/analytics/state script order is still preserved', () => {
  const mastersIdx = scriptSrcs.indexOf('./js/masters-repo.js');
  const facadeIdx = scriptSrcs.indexOf('./js/canonical-runtime.js');
  const evidenceIdx = scriptSrcs.indexOf('./js/training-evidence.js');
  const analyticsIdx = scriptSrcs.indexOf('./js/training-analytics.js');
  const stateIdx = scriptSrcs.indexOf('./js/player-training-state.js');
  const lastLegacyIdx = scriptSrcs.indexOf('./js/assessment.js');
  assert.ok(mastersIdx > lastLegacyIdx);
  assert.ok(facadeIdx > mastersIdx);
  assert.ok(evidenceIdx > facadeIdx);
  assert.ok(analyticsIdx > evidenceIdx);
  assert.ok(stateIdx > analyticsIdx);
});

test('S5-T58: assessment-classifier.js is present in index.html and loads without disturbing any existing relative order', () => {
  const classifierIdx = scriptSrcs.indexOf('./js/assessment-classifier.js');
  assert.ok(classifierIdx !== -1, './js/assessment-classifier.js must be loaded from index.html');
  // PBAssessmentClassifier has zero PBStore/PBCanonical/PBTrainingAnalytics/PBPlayerTrainingState
  // dependency (statically enforced in architecture_guard.test.js), so unlike every prior S1-S4
  // module it has no required predecessor script — only that it does not appear BEFORE the
  // legacy chain finishes (config-loader.js hosts data/ fetch conventions this module mirrors)
  // and does not reorder anything already asserted above.
  const configLoaderIdx = scriptSrcs.indexOf('./js/config-loader.js');
  assert.ok(classifierIdx > configLoaderIdx, 'assessment-classifier.js loads after config-loader.js (mirrors its fetch-based config-loading convention)');
});
