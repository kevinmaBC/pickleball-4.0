'use strict';
/* S3 Acceptance Gate — static index.html load-order check (S3-T36). */
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

test('S1/S2 canonical + evidence script order is still preserved', () => {
  const mastersIdx = scriptSrcs.indexOf('./js/masters-repo.js');
  const facadeIdx = scriptSrcs.indexOf('./js/canonical-runtime.js');
  const evidenceIdx = scriptSrcs.indexOf('./js/training-evidence.js');
  const lastLegacyIdx = scriptSrcs.indexOf('./js/assessment.js');
  assert.ok(mastersIdx > lastLegacyIdx);
  assert.ok(facadeIdx > mastersIdx);
  assert.ok(evidenceIdx > facadeIdx);
});

test('S3-T36: training-analytics.js loads after training-evidence.js (after PBStore, PBCanonical, and PBTrainingEvidence are all defined)', () => {
  const evidenceIdx = scriptSrcs.indexOf('./js/training-evidence.js');
  const analyticsIdx = scriptSrcs.indexOf('./js/training-analytics.js');
  assert.ok(analyticsIdx !== -1, './js/training-analytics.js is loaded from index.html');
  assert.ok(analyticsIdx > evidenceIdx, 'training-analytics.js must load after training-evidence.js');
});
