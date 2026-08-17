'use strict';
/* S0 Acceptance Gate — "Canonical seed validates against seed_data.schema.json"
 *
 * NOTE: This is a hand-rolled, repository-compatible structural check
 * scoped exactly to what docs/handoff/phase0-s0/seed_data.schema.json
 * requires (required keys, types, array bounds). It is S0 CONTRACT
 * VALIDATION ONLY — it is not a general-purpose JSON Schema engine and
 * does not implement the full JSON Schema 2020-12 spec. Per owner
 * decision I-3, no external JSON Schema dependency (e.g. Ajv) is
 * introduced in S0.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const runtimeData = require(path.join(__dirname, '..', '..', 'data', 'canonical', 'seed_data.json'));
const schema = require(path.join(__dirname, '..', '..', 'data', 'canonical', 'seed_data.schema.json'));

const REQUIRED_MASTER_FIELDS = schema.properties.masters.items.required;
const REQUIRED_DRILL_FIELDS = schema.properties.drills.items.required;

test('top-level required keys are present', () => {
  for (const key of schema.required) {
    assert.ok(Object.prototype.hasOwnProperty.call(runtimeData, key), `missing top-level key "${key}"`);
  }
});

test('schema_version matches the schema\'s const constraint', () => {
  assert.equal(runtimeData.schema_version, schema.properties.schema_version.const);
});

test('masters array respects schema bounds and per-item required fields/types', () => {
  assert.ok(Array.isArray(runtimeData.masters));
  assert.ok(runtimeData.masters.length >= schema.properties.masters.minItems);
  assert.ok(runtimeData.masters.length <= schema.properties.masters.maxItems);

  for (const m of runtimeData.masters) {
    for (const field of REQUIRED_MASTER_FIELDS) {
      assert.ok(Object.prototype.hasOwnProperty.call(m, field), `master missing "${field}"`);
    }
    assert.equal(typeof m.master_id, 'string');
    assert.equal(typeof m.name, 'string');
    assert.equal(typeof m.class, 'string');
    assert.ok(Array.isArray(m.source_drill_ids));
    assert.ok(m.source_drill_ids.length >= 1);
    for (const did of m.source_drill_ids) assert.equal(typeof did, 'string');
  }
});

test('drills array respects schema bounds and per-item required fields/types', () => {
  assert.ok(Array.isArray(runtimeData.drills));
  assert.ok(runtimeData.drills.length >= schema.properties.drills.minItems);
  assert.ok(runtimeData.drills.length <= schema.properties.drills.maxItems);

  for (const d of runtimeData.drills) {
    for (const field of REQUIRED_DRILL_FIELDS) {
      assert.ok(Object.prototype.hasOwnProperty.call(d, field), `drill missing "${field}"`);
      assert.equal(typeof d[field], 'string', `drill field "${field}" must be a string`);
    }
  }
});
