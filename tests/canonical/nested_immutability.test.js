'use strict';
/* S0 Immutability Gate — focused nested-mutation resistance proof.
 *
 * Origin: the S0 final audit raised the question of whether
 * masters-repo.js's freeze protection is "shallow" (top-level only,
 * leaving e.g. master.source_drill_ids mutable). This file proves,
 * independently of source_immutability.test.js, that deepFreeze()
 * protects both top-level fields AND nested array fields, and that
 * canonical in-memory data cannot be altered through any object
 * returned by getMaster / getDrill / getDrillsByMaster — regardless
 * of whether the attempted mutation throws or silently no-ops.
 *
 * "Cannot alter" is proven by re-reading the value after every
 * attempted mutation, not merely by asserting a throw.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const runtimeData = require(path.join(__dirname, '..', '..', 'data', 'canonical', 'seed_data.json'));
const { buildIndex } = require(path.join(__dirname, '..', '..', 'js', 'masters-repo.js'));

// Swallow a possible throw; the assertion of record is always the
// re-read value afterward, not whether this particular call threw.
function tryMutate(fn) {
  try { fn(); } catch (e) { /* strict-mode throw is fine; sloppy-mode no-op is also fine */ }
}

test('top-level field: drill.dose cannot be altered via the returned object', () => {
  const repo = buildIndex(JSON.parse(JSON.stringify(runtimeData)));
  const before = repo.getDrill('DRILL-BALANCE').dose;

  const drill = repo.getDrill('DRILL-BALANCE');
  tryMutate(() => { drill.dose = 'TAMPERED'; });
  tryMutate(() => { delete drill.dose; });
  tryMutate(() => { Object.defineProperty(drill, 'dose', { value: 'TAMPERED' }); });

  assert.equal(drill.dose, before);
  assert.equal(repo.getDrill('DRILL-BALANCE').dose, before);
});

test('top-level field: master.name cannot be altered via the returned object', () => {
  const repo = buildIndex(JSON.parse(JSON.stringify(runtimeData)));
  const before = repo.getMaster('FM-01').name;

  const master = repo.getMaster('FM-01');
  tryMutate(() => { master.name = 'TAMPERED'; });

  assert.equal(master.name, before);
  assert.equal(repo.getMaster('FM-01').name, before);
});

test('nested array field: master.source_drill_ids resists every mutation vector', () => {
  const repo = buildIndex(JSON.parse(JSON.stringify(runtimeData)));
  const before = repo.getMaster('FM-01').source_drill_ids.slice();

  const master = repo.getMaster('FM-01');
  assert.ok(Object.isFrozen(master.source_drill_ids), 'nested array must itself be frozen, not just the parent object');

  tryMutate(() => { master.source_drill_ids.push('DRILL-INVENTED'); });
  tryMutate(() => { master.source_drill_ids[0] = 'DRILL-INVENTED'; });
  tryMutate(() => { master.source_drill_ids.splice(0, 1, 'DRILL-INVENTED'); });
  tryMutate(() => { master.source_drill_ids.pop(); });
  tryMutate(() => { master.source_drill_ids.sort(); });
  tryMutate(() => { master.source_drill_ids.length = 0; });
  tryMutate(() => { master.source_drill_ids = ['DRILL-INVENTED']; });

  assert.deepStrictEqual(master.source_drill_ids, before);
  assert.deepStrictEqual(repo.getMaster('FM-01').source_drill_ids, before);
});

test('master membership: attempted drift does not change getDrillsByMaster results', () => {
  const repo = buildIndex(JSON.parse(JSON.stringify(runtimeData)));
  const before = repo.getDrillsByMaster('FM-01').map((d) => d.source_drill_id).sort();

  const master = repo.getMaster('FM-01');
  // Attempt to smuggle a drill belonging to FM-02 into FM-01's membership.
  tryMutate(() => { master.source_drill_ids.push('DRILL-SERVE-DEPTH'); });
  // Attempt to evict a legitimately-owned drill.
  tryMutate(() => { master.source_drill_ids.splice(0, 1); });

  const after = repo.getDrillsByMaster('FM-01').map((d) => d.source_drill_id).sort();
  assert.deepStrictEqual(after, before);

  // FM-02 must not have gained DRILL-SERVE-DEPTH twice / DRILL-BALANCE at all.
  const fm02 = repo.getDrillsByMaster('FM-02').map((d) => d.source_drill_id).sort();
  assert.deepStrictEqual(fm02, ['DRILL-SERVE-DEPTH', 'DRILL-SERVE-ROUTINE'].sort());
});

test('retrieval again after every attempted mutation still equals a pristine independent snapshot', () => {
  const repo = buildIndex(JSON.parse(JSON.stringify(runtimeData)));
  const pristine = buildIndex(JSON.parse(JSON.stringify(runtimeData))); // independent, untouched index

  // Hammer every accessible object once more, across all 13 masters / 35 drills.
  for (const m of runtimeData.masters) {
    const master = repo.getMaster(m.master_id);
    tryMutate(() => { master.name = 'TAMPERED'; });
    tryMutate(() => { master.source_drill_ids.push('DRILL-INVENTED'); });
    tryMutate(() => { master.source_drill_ids.length = 0; });
  }
  for (const d of runtimeData.drills) {
    const drill = repo.getDrill(d.source_drill_id);
    tryMutate(() => { drill.dose = 'TAMPERED'; });
    tryMutate(() => { drill.success_criterion = 'TAMPERED'; });
  }
  // Also tamper with defensively-copied arrays returned by list/getDrillsByMaster.
  const listed = repo.listMasters();
  listed.forEach((m) => { tryMutate(() => { m.name = 'TAMPERED'; }); });
  listed.push({ master_id: 'FAKE' });

  for (const m of runtimeData.masters) {
    assert.deepStrictEqual(repo.getMaster(m.master_id), pristine.getMaster(m.master_id));
    assert.deepStrictEqual(
      repo.getDrillsByMaster(m.master_id).map((d) => d.source_drill_id),
      pristine.getDrillsByMaster(m.master_id).map((d) => d.source_drill_id)
    );
  }
  for (const d of runtimeData.drills) {
    assert.deepStrictEqual(repo.getDrill(d.source_drill_id), pristine.getDrill(d.source_drill_id));
  }
  assert.equal(repo.masterCount, 13);
  assert.equal(repo.drillCount, 35);
});
