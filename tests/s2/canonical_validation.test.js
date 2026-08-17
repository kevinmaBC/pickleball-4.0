'use strict';
/* S2 Acceptance Gate — canonical Drill validation and deterministic Master
 * derivation (S2-T11, S2-T12, S2-T13, S2-T14, S2-T21 partial). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createModule } = require(path.join(__dirname, '..', '..', 'js', 'training-evidence.js'));
const { createFakeStore } = require(path.join(__dirname, 'helpers', 'fake_store.js'));
const { createReadyFacade, seedData } = require(path.join(__dirname, 'helpers', 'canonical_facade.js'));

async function makeModule() {
  const pbStore = createFakeStore([{ player_id: 'plr_1', display_name: 'Alice' }]);
  const pbCanonical = await createReadyFacade();
  const module = createModule({ pbStore: pbStore, pbCanonical: pbCanonical });
  const session = await module.createSession({ player_id: 'plr_1' });
  return { module: module, pbStore: pbStore, session: session };
}

test('S2-T11: valid canonical Drill evidence persists with a correctly derived master_id', async () => {
  const { module, session } = await makeModule();
  const e = await module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'S' });
  assert.equal(e.source_drill_id, 'DRILL-BALANCE');
  assert.equal(e.master_id, 'FM-01');
});

test('S2-T12: unknown source_drill_id is rejected and no row is written', async () => {
  const { module, session, pbStore } = await makeModule();
  await assert.rejects(
    module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-DOES-NOT-EXIST', trial_no: 1, outcome: 'S' }),
    /unknown source_drill_id/
  );
  const rows = await pbStore.getAll('drill_evidence_events');
  assert.deepStrictEqual(rows, []);
});

test('S2-T13: a caller-supplied master_id is ignored — the derived mapping cannot be forged', async () => {
  const { module, session } = await makeModule();
  const e = await module.addEvidence({
    training_session_id: session.training_session_id,
    source_drill_id: 'DRILL-BALANCE', // truthfully belongs to FM-01
    master_id: 'FM-99',               // forged/conflicting — must be ignored
    trial_no: 1,
    outcome: 'S'
  });
  assert.equal(e.master_id, 'FM-01');
  assert.notEqual(e.master_id, 'FM-99');
});

test('S2-T14: all 35 canonical Drill IDs derive the correct Master (cross-checked against seed_data.json independently of the module)', async () => {
  const { module } = await makeModule();

  // Build the expected drill -> master map directly from the authority JSON,
  // independent of training-evidence.js's own derivation logic.
  const expected = {};
  seedData.masters.forEach((m) => {
    m.source_drill_ids.forEach((did) => { expected[did] = m.master_id; });
  });
  assert.equal(Object.keys(expected).length, 35);

  seedData.drills.forEach((d) => {
    const got = module._deriveMasterId(d.source_drill_id);
    assert.equal(got, expected[d.source_drill_id], 'mismatch for ' + d.source_drill_id);
  });
});

test('addEvidence rejects before the session exists check if source_drill_id is unknown (canonical validated first)', async () => {
  const { module } = await makeModule();
  await assert.rejects(
    module.addEvidence({ training_session_id: 'trn_missing_and_irrelevant', source_drill_id: 'DRILL-NOPE', trial_no: 1, outcome: 'S' }),
    /unknown source_drill_id/
  );
});

test('addEvidence rejects an unknown training_session_id for an otherwise-valid canonical drill', async () => {
  const { module } = await makeModule();
  await assert.rejects(
    module.addEvidence({ training_session_id: 'trn_missing', source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'S' }),
    /training_session_id "trn_missing" not found/
  );
});
