'use strict';
/* S0 Acceptance Gate — Minimal query contract:
 * getMaster(master_id), getDrill(source_drill_id), getDrillsByMaster(master_id). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const runtimeData = require(path.join(__dirname, '..', '..', 'data', 'canonical', 'seed_data.json'));
const { buildIndex } = require(path.join(__dirname, '..', '..', 'js', 'masters-repo.js'));

const repo = buildIndex(runtimeData);

test('getMaster(master_id) returns the correct master', () => {
  const m = repo.getMaster('FM-01');
  assert.ok(m);
  assert.equal(m.master_id, 'FM-01');
  assert.equal(m.name, 'Foundation');
  assert.equal(m.class, 'FAMILY');
});

test('getMaster(master_id) returns null for an unknown id', () => {
  assert.equal(repo.getMaster('FM-99'), null);
});

test('getDrill(source_drill_id) returns the correct drill with intact fields', () => {
  const d = repo.getDrill('DRILL-BALANCE');
  assert.ok(d);
  assert.equal(d.source_drill_id, 'DRILL-BALANCE');
  assert.equal(d.primary_kpi, 'KPI-FOUND');
  assert.equal(d.level_range, '3.0–3.5');
});

test('getDrill(source_drill_id) returns null for an unknown id', () => {
  assert.equal(repo.getDrill('DRILL-DOES-NOT-EXIST'), null);
});

test('getDrillsByMaster(master_id) returns exactly that master\'s drills', () => {
  const drills = repo.getDrillsByMaster('FM-01');
  const ids = drills.map((d) => d.source_drill_id).sort();
  assert.deepStrictEqual(ids, ['DRILL-BALANCE', 'DRILL-BALANCE-BREATH', 'DRILL-GRIP', 'DRILL-READY'].sort());
});

test('getDrillsByMaster(master_id) returns [] for an unknown master', () => {
  assert.deepStrictEqual(repo.getDrillsByMaster('FM-99'), []);
});

test('every master\'s getDrillsByMaster() output matches its source_drill_ids 1:1', () => {
  for (const m of runtimeData.masters) {
    const drills = repo.getDrillsByMaster(m.master_id);
    const gotIds = drills.map((d) => d.source_drill_id).sort();
    const wantIds = m.source_drill_ids.slice().sort();
    assert.deepStrictEqual(gotIds, wantIds, `mismatch for master "${m.master_id}"`);
  }
});

test('repo reports masterCount 13 and drillCount 35', () => {
  assert.equal(repo.masterCount, 13);
  assert.equal(repo.drillCount, 35);
});
