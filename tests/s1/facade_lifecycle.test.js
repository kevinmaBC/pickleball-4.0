'use strict';
/* S1 Acceptance Gate — PBCanonical facade: readiness/error contract,
 * deterministic accessors, no partial index, no mutation leakage. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const seedData = require(path.join(__dirname, '..', '..', 'data', 'canonical', 'seed_data.json'));
const PBMasters = require(path.join(__dirname, '..', '..', 'js', 'masters-repo.js'));
const { createFacade } = require(path.join(__dirname, '..', '..', 'js', 'canonical-runtime.js'));

function fakeLoaderResolving() {
  return { load: function () { return Promise.resolve(PBMasters.buildIndex(seedData)); } };
}
function fakeLoaderRejecting(err) {
  return { load: function () { return Promise.reject(err); } };
}

test('state starts as loading and accessors throw before ready (no partial index exposed)', () => {
  const f = createFacade({ pbMasters: fakeLoaderResolving(), url: 'x' });
  assert.equal(f.state, 'loading');
  assert.equal(f.error, null);
  assert.throws(() => f.getMaster('FM-01'), /not ready/);
  assert.throws(() => f.getDrill('DRILL-BALANCE'), /not ready/);
  assert.throws(() => f.getDrillsByMaster('FM-01'), /not ready/);
  assert.throws(() => f.listMasters(), /not ready/);
  assert.throws(() => f.listDrills(), /not ready/);
});

test('S1-T03/T04: ready resolves with 13 masters and 35 drills', async () => {
  const f = createFacade({ pbMasters: fakeLoaderResolving(), url: 'x' });
  const repo = await f.ready;
  assert.equal(f.state, 'ready');
  assert.equal(repo.masterCount, 13);
  assert.equal(repo.drillCount, 35);
});

test('S1-T05/T06/T07: getMaster/getDrill/getDrillsByMaster delegate through the facade once ready', async () => {
  const f = createFacade({ pbMasters: fakeLoaderResolving(), url: 'x' });
  await f.ready;
  const m = f.getMaster('FM-01');
  assert.ok(m);
  assert.equal(m.master_id, 'FM-01');
  const d = f.getDrill('DRILL-BALANCE');
  assert.ok(d);
  assert.equal(d.source_drill_id, 'DRILL-BALANCE');
  const drills = f.getDrillsByMaster('FM-01');
  assert.ok(Array.isArray(drills));
  assert.ok(drills.length > 0);
  assert.equal(f.listMasters().length, 13);
  assert.equal(f.listDrills().length, 35);
});

test('S1-T08: unknown ids are deterministic once ready', async () => {
  const f = createFacade({ pbMasters: fakeLoaderResolving(), url: 'x' });
  await f.ready;
  assert.equal(f.getMaster('FM-99'), null);
  assert.equal(f.getDrill('DRILL-DOES-NOT-EXIST'), null);
  assert.deepStrictEqual(f.getDrillsByMaster('FM-99'), []);
});

test('S1-T09: retrieved objects stay frozen through the facade — mutation cannot corrupt future reads', async () => {
  const f = createFacade({ pbMasters: fakeLoaderResolving(), url: 'x' });
  await f.ready;
  const m = f.getMaster('FM-01');
  assert.throws(() => { 'use strict'; m.name = 'HACKED'; });
  assert.equal(f.getMaster('FM-01').name, m.name);
});

test('facade never re-fetches or rebuilds a second index — repeated ready reads return the same object', async () => {
  const loader = fakeLoaderResolving();
  const f = createFacade({ pbMasters: loader, url: 'x' });
  const repoA = await f.ready;
  const repoB = await f.ready;
  assert.strictEqual(repoA, repoB);
});

test('load failure sets an explicit error state, ready rejects, accessors throw', async () => {
  const boom = new Error('boom: HTTP 500');
  const f = createFacade({ pbMasters: fakeLoaderRejecting(boom), url: 'x' });
  await assert.rejects(f.ready, /boom/);
  assert.equal(f.state, 'error');
  assert.equal(f.error, boom);
  assert.throws(() => f.getMaster('FM-01'), /not ready/);
});

test('missing PBMasters loader produces an explicit error state instead of throwing during construction', async () => {
  const f = createFacade({ pbMasters: undefined, url: 'x' });
  await assert.rejects(f.ready, /PBMasters is not available/);
  assert.equal(f.state, 'error');
});
