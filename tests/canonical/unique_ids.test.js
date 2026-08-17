'use strict';
/* S0 Acceptance Gate — Data integrity: unique IDs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const runtimeData = require(path.join(__dirname, '..', '..', 'data', 'canonical', 'seed_data.json'));

test('all 13 master_id values are unique', () => {
  const ids = runtimeData.masters.map((m) => m.master_id);
  assert.equal(new Set(ids).size, ids.length);
});

test('all 35 source_drill_id values are unique', () => {
  const ids = runtimeData.drills.map((d) => d.source_drill_id);
  assert.equal(new Set(ids).size, ids.length);
});
