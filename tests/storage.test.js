/* tests/storage.test.js — S7-A/S8-A: Safe IndexedDB upgrade (v1 -> v3)
 * Verifies: existing S1-S6 stores/records survive the upgrade untouched,
 * review_snapshots / prescriptions / retests (S7-A) are created empty, and
 * training_cycles / weekly_plans / session_plans / session_logs /
 * cycle_summaries (S8-A) are created empty — all in a single additive
 * upgrade from a pre-existing v1 database (as a real user's device would
 * see, having never opened the app between S1 and now).
 * Run: node tests/storage.test.js
 */
var assert = require('assert');
var createFakeIndexedDB = require('./fake-indexeddb');

var fakeIDB = createFakeIndexedDB();

// Seed a pre-existing v1 database, as if a real user already has S1-S6 data
// on disk before this upgrade ships.
fakeIDB._seed('pb_v2', 1, {
  players: {
    keyPath: 'player_id',
    records: [{ player_id: 'plr_1', display_name: 'Alice', created_at: '2026-01-01T00:00:00.000Z' }]
  },
  assessments: {
    keyPath: 'assessment_id',
    indexes: [['by_player', 'player_id']],
    records: [{ assessment_id: 'asm_1', player_id: 'plr_1', assessment_tier: 'lite', created_at: '2026-01-01T00:00:00.000Z' }]
  },
  test_sessions: {
    keyPath: 'test_session_id',
    indexes: [['by_assessment', 'assessment_id']],
    records: [{ test_session_id: 'ses_1', assessment_id: 'asm_1', test_id: 'T01', started_at: '2026-01-01T00:00:00.000Z' }]
  },
  trial_events: {
    keyPath: 'trial_event_id',
    indexes: [['by_session', 'test_session_id']],
    records: [{ trial_event_id: 'trl_1', test_session_id: 'ses_1', trial_no: 1, outcome: 'S', created_at: '2026-01-01T00:00:00.000Z' }]
  }
});

global.indexedDB = fakeIDB;
delete require.cache[require.resolve('../js/storage.js')];
var PBStore = require('../js/storage.js');

function run() {
  return PBStore.open().then(function () {
    // 1. DB version bumped to 3 (S8-A), without destroying prior data.
    assert.strictEqual(PBStore.DB_VERSION, 3);

    var dump = fakeIDB._dump()['pb_v2'];
    assert.strictEqual(dump.version, 3);

    // 2. Existing S1-S6 stores preserved with their original records intact.
    ['players', 'assessments', 'test_sessions', 'trial_events'].forEach(function (name) {
      assert.ok(dump.stores[name], 'store preserved: ' + name);
    });
    assert.strictEqual(dump.stores.players.data.get('plr_1').display_name, 'Alice');
    assert.strictEqual(dump.stores.assessments.data.get('asm_1').player_id, 'plr_1');
    assert.strictEqual(dump.stores.test_sessions.data.get('ses_1').test_id, 'T01');
    assert.strictEqual(dump.stores.trial_events.data.get('trl_1').outcome, 'S');

    // 3. New S7 stores created, empty, no destructive migration performed.
    ['review_snapshots', 'prescriptions', 'retests'].forEach(function (name) {
      assert.ok(dump.stores[name], 'store created: ' + name);
      assert.strictEqual(dump.stores[name].data.size, 0, name + ' starts empty');
    });

    // 3b. New S8-A stores created, empty, in the same single additive upgrade.
    ['training_cycles', 'weekly_plans', 'session_plans', 'session_logs', 'cycle_summaries'].forEach(function (name) {
      assert.ok(dump.stores[name], 'store created: ' + name);
      assert.strictEqual(dump.stores[name].data.size, 0, name + ' starts empty');
    });
    // Required indexes exist on each new S8-A store.
    assert.ok(dump.stores.training_cycles.indexes.by_prescription, 'training_cycles.by_prescription index exists');
    assert.ok(dump.stores.training_cycles.indexes.by_review_snapshot, 'training_cycles.by_review_snapshot index exists');
    assert.ok(dump.stores.training_cycles.indexes.by_status, 'training_cycles.by_status index exists');
    assert.ok(dump.stores.weekly_plans.indexes.by_cycle, 'weekly_plans.by_cycle index exists');
    assert.ok(dump.stores.weekly_plans.indexes.by_cycle_week, 'weekly_plans.by_cycle_week index exists');
    assert.ok(dump.stores.session_plans.indexes.by_week, 'session_plans.by_week index exists');
    assert.ok(dump.stores.session_plans.indexes.by_cycle, 'session_plans.by_cycle index exists');
    assert.ok(dump.stores.session_plans.indexes.by_status, 'session_plans.by_status index exists');
    assert.ok(dump.stores.session_logs.indexes.by_session_plan, 'session_logs.by_session_plan index exists');
    assert.ok(dump.stores.session_logs.indexes.by_week, 'session_logs.by_week index exists');
    assert.ok(dump.stores.session_logs.indexes.by_cycle, 'session_logs.by_cycle index exists');
    assert.ok(dump.stores.session_logs.indexes.by_status, 'session_logs.by_status index exists');
    assert.ok(dump.stores.cycle_summaries.indexes.by_cycle, 'cycle_summaries.by_cycle index exists');
    assert.ok(dump.stores.cycle_summaries.indexes.by_retest_readiness, 'cycle_summaries.by_retest_readiness index exists');

    // 4. Existing S1-S6 reads/writes still work post-upgrade.
    return PBStore.listPlayers();
  }).then(function (players) {
    assert.strictEqual(players.length, 1);
    assert.strictEqual(players[0].player_id, 'plr_1');
    return PBStore.trialsBySession('ses_1');
  }).then(function (trials) {
    assert.strictEqual(trials.length, 1);
    assert.strictEqual(trials[0].trial_event_id, 'trl_1');

    // 5. Minimal CRUD helpers for the new S7 stores work end-to-end.
    return PBStore.createReviewSnapshot({ assessment_id: 'asm_1', data: { note: 'placeholder' } });
  }).then(function (snapshot) {
    assert.ok(snapshot.review_snapshot_id);
    assert.strictEqual(snapshot.assessment_id, 'asm_1');
    assert.ok(snapshot.schema_version);
    assert.ok(snapshot.generated_at);
    return PBStore.reviewSnapshotsByAssessment('asm_1');
  }).then(function (snapshots) {
    assert.strictEqual(snapshots.length, 1);
    return PBStore.createPrescription({ assessment_id: 'asm_1', data: {} });
  }).then(function (rx) {
    assert.ok(rx.prescription_id);
    return PBStore.createRetest({ assessment_id: 'asm_1', prescription_id: rx.prescription_id, data: {} });
  }).then(function (rt) {
    assert.ok(rt.retest_id);
    assert.ok(rt.prescription_id);
    return PBStore.retestsByAssessment('asm_1');
  }).then(function (retests) {
    assert.strictEqual(retests.length, 1);
    console.log('storage.test.js: all assertions passed');
  });
}

run().catch(function (err) {
  console.error('storage.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
