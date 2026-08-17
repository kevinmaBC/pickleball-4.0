'use strict';
/* S2 Acceptance Gate — static sw.js checks (S2-T24). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sw = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8');
const PRE_S2_CACHE_VERSION = 'pb40-v16';

test('S2-T24: SW cache version bumped past the pre-S2 (S1) baseline', () => {
  const m = sw.match(/const CACHE=['"]([^'"]+)['"]/);
  assert.ok(m, 'CACHE const found in sw.js');
  assert.notEqual(m[1], PRE_S2_CACHE_VERSION, 'CACHE version must change from ' + PRE_S2_CACHE_VERSION);
});

test('S2-T24: PWA precache list includes js/training-evidence.js alongside the existing S1 canonical runtime assets', () => {
  assert.match(sw, /\.\/js\/masters-repo\.js/);
  assert.match(sw, /\.\/js\/canonical-runtime\.js/);
  assert.match(sw, /\.\/js\/training-evidence\.js/);
  assert.match(sw, /\.\/data\/canonical\/seed_data\.json/);
});

test('existing navigation/network fetch strategy is preserved (network-first nav, SWR otherwise)', () => {
  assert.match(sw, /req\.mode===['"]navigate['"]/);
  assert.match(sw, /caches\.match\(req\)/);
});
