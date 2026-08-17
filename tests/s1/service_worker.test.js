'use strict';
/* S1 Acceptance Gate — static sw.js checks (S1-T13/T14). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sw = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8');
const PRE_S1_CACHE_VERSION = 'pb40-v15';

test('S1-T14: SW cache version bumped past the pre-S1 baseline', () => {
  const m = sw.match(/const CACHE=['"]([^'"]+)['"]/);
  assert.ok(m, 'CACHE const found in sw.js');
  assert.notEqual(m[1], PRE_S1_CACHE_VERSION, 'CACHE version must change from ' + PRE_S1_CACHE_VERSION);
});

test('S1-T13: PWA precache list includes canonical runtime JS and the runtime seed', () => {
  assert.match(sw, /\.\/js\/masters-repo\.js/);
  assert.match(sw, /\.\/js\/canonical-runtime\.js/);
  assert.match(sw, /\.\/data\/canonical\/seed_data\.json/);
});

test('existing navigation/network fetch strategy is preserved (network-first nav, SWR otherwise)', () => {
  assert.match(sw, /req\.mode===['"]navigate['"]/);
  assert.match(sw, /caches\.match\(req\)/);
});
