'use strict';
/* S0 Acceptance Gate — Source immutability + SSOT equivalence (owner decision I-1).
 *
 * Proves:
 *  1. data/canonical/seed_data.json (runtime copy) is semantically
 *     equivalent to docs/handoff/phase0-s0/seed_data.json (authority /
 *     SSOT). Any drift between the two fails this test.
 *  2. Objects returned by masters-repo.js are frozen, so runtime code
 *     cannot silently mutate source-owned fields or master membership.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const authorityData = require(path.join(__dirname, '..', '..', 'docs', 'handoff', 'phase0-s0', 'seed_data.json'));
const runtimeData = require(path.join(__dirname, '..', '..', 'data', 'canonical', 'seed_data.json'));
const authoritySchema = require(path.join(__dirname, '..', '..', 'docs', 'handoff', 'phase0-s0', 'seed_data.schema.json'));
const runtimeSchema = require(path.join(__dirname, '..', '..', 'data', 'canonical', 'seed_data.schema.json'));
const { buildIndex } = require(path.join(__dirname, '..', '..', 'js', 'masters-repo.js'));

const IMMUTABLE_DRILL_FIELDS = [
  'source_drill_id', 'level_range', 'progression', 'purpose', 'setup', 'feed',
  'dose', 'success_criterion', 'primary_kpi', 'secondary_kpis', 'evidence', 'match_transfer'
];

test('runtime seed_data.json is semantically equivalent to the authority (SSOT)', () => {
  assert.deepStrictEqual(runtimeData, authorityData);
});

test('runtime seed_data.schema.json is semantically equivalent to the authority (SSOT)', () => {
  assert.deepStrictEqual(runtimeSchema, authoritySchema);
});

test('every immutable drill field in the runtime copy matches the authority value exactly', () => {
  const authorityByDrillId = new Map(authorityData.drills.map((d) => [d.source_drill_id, d]));
  for (const runtimeDrill of runtimeData.drills) {
    const authorityDrill = authorityByDrillId.get(runtimeDrill.source_drill_id);
    assert.ok(authorityDrill, `runtime drill "${runtimeDrill.source_drill_id}" has no authority counterpart`);
    for (const field of IMMUTABLE_DRILL_FIELDS) {
      assert.equal(runtimeDrill[field], authorityDrill[field], `field "${field}" drifted for drill "${runtimeDrill.source_drill_id}"`);
    }
  }
});

test('master membership (source_drill_ids) matches the authority exactly, per master', () => {
  const authorityByMasterId = new Map(authorityData.masters.map((m) => [m.master_id, m]));
  for (const runtimeMaster of runtimeData.masters) {
    const authorityMaster = authorityByMasterId.get(runtimeMaster.master_id);
    assert.ok(authorityMaster, `runtime master "${runtimeMaster.master_id}" has no authority counterpart`);
    assert.deepStrictEqual(
      runtimeMaster.source_drill_ids.slice().sort(),
      authorityMaster.source_drill_ids.slice().sort(),
      `master membership drifted for "${runtimeMaster.master_id}"`
    );
  }
});

test('masters-repo.buildIndex() returns deep-frozen master and drill objects', () => {
  const repo = buildIndex(JSON.parse(JSON.stringify(runtimeData)));

  const master = repo.getMaster('FM-01');
  assert.ok(Object.isFrozen(master));
  assert.ok(Object.isFrozen(master.source_drill_ids));

  const drill = repo.getDrill('DRILL-BALANCE');
  assert.ok(Object.isFrozen(drill));
});

test('mutating a returned drill or master throws (strict-mode frozen-object write)', () => {
  const repo = buildIndex(JSON.parse(JSON.stringify(runtimeData)));

  const drill = repo.getDrill('DRILL-BALANCE');
  assert.throws(() => { drill.dose = 'TAMPERED'; }, TypeError);

  const master = repo.getMaster('FM-01');
  assert.throws(() => { master.source_drill_ids.push('DRILL-INVENTED'); }, TypeError);
  assert.throws(() => { master.name = 'TAMPERED'; }, TypeError);
});

test('buildIndex rejects a payload where a drill was reassigned to a different master', () => {
  const tampered = JSON.parse(JSON.stringify(runtimeData));
  // Move DRILL-BALANCE from FM-01 into FM-02 as well -> dual ownership
  const fm02 = tampered.masters.find((m) => m.master_id === 'FM-02');
  fm02.source_drill_ids.push('DRILL-BALANCE');

  assert.throws(() => buildIndex(tampered), /claimed by multiple masters/);
});

test('buildIndex rejects a payload with an invented extra drill', () => {
  const tampered = JSON.parse(JSON.stringify(runtimeData));
  tampered.drills.push({
    source_drill_id: 'DRILL-INVENTED',
    level_range: 'x', progression: 'x', purpose: 'x', setup: 'x', feed: 'x',
    dose: 'x', success_criterion: 'x', primary_kpi: 'x', secondary_kpis: 'x',
    evidence: 'x', match_transfer: 'x'
  });

  assert.throws(() => buildIndex(tampered), /expected exactly 35 drills/);
});
