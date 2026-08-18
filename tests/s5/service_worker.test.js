'use strict';
/* S5 Acceptance Gate — static sw.js checks (S5-T57 config-asset precache, S5-T59 cache bump). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sw = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8');
const PRE_S5_CACHE_VERSION = 'pb40-v19';

test('S5-T59: SW cache version bumped past the pre-S5 (S4) baseline', () => {
  const m = sw.match(/const CACHE=['"]([^'"]+)['"]/);
  assert.ok(m, 'CACHE const found in sw.js');
  assert.notEqual(m[1], PRE_S5_CACHE_VERSION, 'CACHE version must change from ' + PRE_S5_CACHE_VERSION);
});

test('S5-T57/T59: PWA precache list includes assessment-classifier.js and its config authority, alongside every existing S0-S4 asset', () => {
  assert.match(sw, /\.\/js\/masters-repo\.js/);
  assert.match(sw, /\.\/js\/canonical-runtime\.js/);
  assert.match(sw, /\.\/js\/training-evidence\.js/);
  assert.match(sw, /\.\/js\/training-analytics\.js/);
  assert.match(sw, /\.\/js\/player-training-state\.js/);
  assert.match(sw, /\.\/js\/assessment-classifier\.js/);
  assert.match(sw, /\.\/data\/level_gates_v2_3_1\.json/);
  assert.match(sw, /\.\/data\/canonical\/seed_data\.json/);
});

test('data/evidence_confidence_v2_3_1.json is deliberately NOT precached (input-domain reference only — never fetched at runtime)', () => {
  assert.doesNotMatch(sw, /evidence_confidence_v2_3_1\.json/);
});

test('existing navigation/network fetch strategy is preserved (network-first nav, SWR otherwise)', () => {
  assert.match(sw, /req\.mode===['"]navigate['"]/);
  assert.match(sw, /caches\.match\(req\)/);
});
