'use strict';
/* S1 Acceptance Gate — static index.html load-order checks (S1-T11/T12).
 * No browser required: this parses the actual index.html markup. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const scriptSrcs = [...html.matchAll(/<script\s+src="([^"]+)"><\/script>/g)].map((m) => m[1]);

const LEGACY_ORDER = [
  './js/i18n.js',
  './js/config-loader.js',
  './js/storage.js',
  './js/metrics.js',
  './js/preview.js',
  './js/app.js',
  './js/assessment.js'
];

test('S1-T12: existing legacy script relative order is preserved', () => {
  const positions = LEGACY_ORDER.map((src) => scriptSrcs.indexOf(src));
  assert.ok(positions.every((i) => i !== -1), 'all legacy scripts are still present in index.html');
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i] > positions[i - 1], 'legacy script relative order changed: ' + LEGACY_ORDER[i - 1] + ' / ' + LEGACY_ORDER[i]);
  }
});

test('S1-T11: canonical runtime scripts load in correct order, after all legacy scripts', () => {
  const mastersIdx = scriptSrcs.indexOf('./js/masters-repo.js');
  const facadeIdx = scriptSrcs.indexOf('./js/canonical-runtime.js');
  const lastLegacyIdx = scriptSrcs.indexOf('./js/assessment.js');

  assert.ok(mastersIdx !== -1, './js/masters-repo.js is loaded from index.html');
  assert.ok(facadeIdx !== -1, './js/canonical-runtime.js is loaded from index.html');
  assert.ok(mastersIdx > lastLegacyIdx, 'masters-repo.js must load after existing legacy scripts');
  assert.ok(facadeIdx > mastersIdx, 'canonical-runtime.js must load after masters-repo.js');
});
