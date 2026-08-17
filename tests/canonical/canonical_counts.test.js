'use strict';
/* S0 Acceptance Gate — Data integrity: exact counts. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const runtimeData = require(path.join(__dirname, '..', '..', 'data', 'canonical', 'seed_data.json'));

test('runtime canonical data has exactly 13 masters', () => {
  assert.equal(runtimeData.masters.length, 13);
});

test('runtime canonical data has exactly 35 drills', () => {
  assert.equal(runtimeData.drills.length, 35);
});
