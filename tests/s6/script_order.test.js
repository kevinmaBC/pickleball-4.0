'use strict';
/* S6 Acceptance Gate — static index.html load-order check. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const scriptSrcs = [...html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map((m) => m[1]);

test('S0-S5 script order is still preserved', () => {
  const LEGACY_ORDER = [
    './js/i18n.js', './js/config-loader.js', './js/storage.js', './js/metrics.js',
    './js/preview.js', './js/app.js', './js/assessment.js',
    './js/masters-repo.js', './js/canonical-runtime.js', './js/training-evidence.js',
    './js/training-analytics.js', './js/player-training-state.js', './js/assessment-classifier.js'
  ];
  const positions = LEGACY_ORDER.map((src) => scriptSrcs.indexOf(src));
  assert.ok(positions.every((i) => i !== -1));
  for (let i = 1; i < positions.length; i++) assert.ok(positions[i] > positions[i - 1]);
});

test('S6: assessment-explainer.js is present in index.html and loads after assessment-classifier.js without disturbing any existing order', () => {
  const explainerIdx = scriptSrcs.indexOf('./js/assessment-explainer.js');
  const classifierIdx = scriptSrcs.indexOf('./js/assessment-classifier.js');
  assert.ok(explainerIdx !== -1, './js/assessment-explainer.js must be loaded from index.html');
  assert.ok(explainerIdx > classifierIdx, 'assessment-explainer.js loads after assessment-classifier.js (it consumes S5 output)');
});
