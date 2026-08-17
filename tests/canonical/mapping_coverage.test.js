'use strict';
/* S0 Acceptance Gate — Every drill maps to exactly one frozen master;
 * no missing canonical drill; no extra/invented drill. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const runtimeData = require(path.join(__dirname, '..', '..', 'data', 'canonical', 'seed_data.json'));

test('35/35 master -> drill mapping coverage, no duplicates, no gaps', () => {
  const allDrillIds = new Set(runtimeData.drills.map((d) => d.source_drill_id));
  const ownerOf = new Map();

  for (const m of runtimeData.masters) {
    for (const did of m.source_drill_ids) {
      assert.ok(
        !ownerOf.has(did),
        `drill "${did}" is claimed by more than one master ("${ownerOf.get(did)}" and "${m.master_id}")`
      );
      ownerOf.set(did, m.master_id);
    }
  }

  // No extra drill invented by a master (every referenced id must exist in drills[])
  for (const [did, masterId] of ownerOf) {
    assert.ok(allDrillIds.has(did), `master "${masterId}" references unknown drill "${did}"`);
  }

  // No missing canonical drill (every drill must be owned by exactly one master)
  for (const did of allDrillIds) {
    assert.ok(ownerOf.has(did), `drill "${did}" is not mapped to any master`);
  }

  // Exact coverage: 35 mapped drill ids, 35 canonical drills
  assert.equal(ownerOf.size, 35);
  assert.equal(allDrillIds.size, 35);
});
