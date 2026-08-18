'use strict';
/* S3 Acceptance Gate — static sw.js checks (S3-T37). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sw = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8');
const PRE_S3_CACHE_VERSION = 'pb40-v17';

test('S3-T37: SW cache version bumped past the pre-S3 (S2) baseline', () => {
  const m = sw.match(/const CACHE=['"]([^'"]+)['"]/);
  assert.ok(m, 'CACHE const found in sw.js');
  assert.notEqual(m[1], PRE_S3_CACHE_VERSION, 'CACHE version must change from ' + PRE_S3_CACHE_VERSION);
});

test('S3-T37: PWA precache list includes js/training-analytics.js alongside the existing S1/S2 assets', () => {
  assert.match(sw, /\.\/js\/masters-repo\.js/);
  assert.match(sw, /\.\/js\/canonical-runtime\.js/);
  assert.match(sw, /\.\/js\/training-evidence\.js/);
  assert.match(sw, /\.\/js\/training-analytics\.js/);
  assert.match(sw, /\.\/data\/canonical\/seed_data\.json/);
});

test('existing navigation/network fetch strategy is preserved (network-first nav, SWR otherwise)', () => {
  assert.match(sw, /req\.mode===['"]navigate['"]/);
  assert.match(sw, /caches\.match\(req\)/);
});
