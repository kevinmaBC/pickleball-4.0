'use strict';
/* S2 Acceptance Gate — PBTrainingEvidence session API (S2-T09, S2-T10, S2-T17, S2-T18). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createModule } = require(path.join(__dirname, '..', '..', 'js', 'training-evidence.js'));
const { createFakeStore } = require(path.join(__dirname, 'helpers', 'fake_store.js'));
const { createReadyFacade, seedData } = require(path.join(__dirname, 'helpers', 'canonical_facade.js'));

async function makeModule(seedPlayers) {
  const pbStore = createFakeStore(seedPlayers);
  const pbCanonical = await createReadyFacade();
  return { module: createModule({ pbStore: pbStore, pbCanonical: pbCanonical }), pbStore: pbStore, pbCanonical: pbCanonical };
}

test('S2-T09: createTrainingSession persists a valid record with canonical_schema_version stamped from PBCanonical', async () => {
  const { module, pbCanonical } = await makeModule([{ player_id: 'plr_1', display_name: 'Alice' }]);
  const s = await module.createSession({ player_id: 'plr_1', notes: 'first session' });
  assert.ok(s.training_session_id);
  assert.equal(s.player_id, 'plr_1');
  assert.equal(s.notes, 'first session');
  assert.equal(s.ended_at, null);
  assert.ok(s.session_date);
  assert.ok(s.started_at);
  assert.ok(s.created_at);
  assert.equal(s.canonical_schema_version, pbCanonical.schemaVersion);
  assert.equal(s.canonical_schema_version, seedData.schema_version);
});

test('S2-T10: unknown player_id is rejected deterministically — no orphan session, no auto-created player', async () => {
  const { module, pbStore } = await makeModule([]);
  await assert.rejects(module.createSession({ player_id: 'plr_does_not_exist' }), /unknown player_id/);
  const sessions = await pbStore.getAll('training_sessions');
  assert.deepStrictEqual(sessions, []);
  const players = await pbStore.getAll('players');
  assert.deepStrictEqual(players, []);
});

test('createSession requires player_id', async () => {
  const { module } = await makeModule([]);
  await assert.rejects(module.createSession({}), /player_id is required/);
});

test('endSession patches ended_at and preserves other fields', async () => {
  const { module } = await makeModule([{ player_id: 'plr_1', display_name: 'Alice' }]);
  const s = await module.createSession({ player_id: 'plr_1' });
  assert.equal(s.ended_at, null);
  const ended = await module.endSession(s.training_session_id, {});
  assert.equal(ended.training_session_id, s.training_session_id);
  assert.notEqual(ended.ended_at, null);
  assert.equal(ended.player_id, s.player_id);
});

test('endSession rejects unknown training_session_id', async () => {
  const { module } = await makeModule([]);
  await assert.rejects(module.endSession('trn_missing', {}), /not found/);
});

test('listSessionsByPlayer returns only that player\'s sessions', async () => {
  const { module } = await makeModule([{ player_id: 'plr_1' }, { player_id: 'plr_2' }]);
  const a = await module.createSession({ player_id: 'plr_1' });
  await module.createSession({ player_id: 'plr_2' });
  const list = await module.listSessionsByPlayer('plr_1');
  assert.equal(list.length, 1);
  assert.equal(list[0].training_session_id, a.training_session_id);
});

test('S2-T17/T18: evidenceBySession and evidenceByDrill query correctly', async () => {
  const { module } = await makeModule([{ player_id: 'plr_1' }]);
  const s = await module.createSession({ player_id: 'plr_1' });
  await module.addEvidence({ training_session_id: s.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'S' });
  await module.addEvidence({ training_session_id: s.training_session_id, source_drill_id: 'DRILL-SERVE-DEPTH', trial_no: 1, outcome: 'F' });

  const bySession = await module.evidenceBySession(s.training_session_id);
  assert.equal(bySession.length, 2);

  const byDrill = await module.evidenceByDrill('DRILL-BALANCE');
  assert.equal(byDrill.length, 1);
  assert.equal(byDrill[0].source_drill_id, 'DRILL-BALANCE');

  const byMaster = await module.evidenceByMaster('FM-01');
  assert.equal(byMaster.length, 1);
  assert.equal(byMaster[0].source_drill_id, 'DRILL-BALANCE');
});
