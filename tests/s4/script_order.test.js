'use strict';
/* S4 Acceptance Gate — static index.html load-order check (S4-T39). */
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

test('S0-S3 canonical/evidence/analytics script order is still preserved', () => {
  const mastersIdx = scriptSrcs.indexOf('./js/masters-repo.js');
  const facadeIdx = scriptSrcs.indexOf('./js/canonical-runtime.js');
  const evidenceIdx = scriptSrcs.indexOf('./js/training-evidence.js');
  const analyticsIdx = scriptSrcs.indexOf('./js/training-analytics.js');
  const lastLegacyIdx = scriptSrcs.indexOf('./js/assessment.js');
  assert.ok(mastersIdx > lastLegacyIdx);
  assert.ok(facadeIdx > mastersIdx);
  assert.ok(evidenceIdx > facadeIdx);
  assert.ok(analyticsIdx > evidenceIdx);
});

test('S4-T39: player-training-state.js loads after training-analytics.js (after PBStore, PBCanonical, and PBTrainingAnalytics are all defined)', () => {
  const analyticsIdx = scriptSrcs.indexOf('./js/training-analytics.js');
  const stateIdx = scriptSrcs.indexOf('./js/player-training-state.js');
  assert.ok(stateIdx !== -1, './js/player-training-state.js is loaded from index.html');
  assert.ok(stateIdx > analyticsIdx, 'player-training-state.js must load after training-analytics.js');
});
