/* tests/s9-a-match-architecture.test.js — S9-A: Match Data Architecture
 *
 * Verifies the S9-A design freeze was implemented as pure plumbing:
 *   - no new IndexedDB store from S9-A itself; the expected DB_VERSION
 *     below is the current repository baseline (bumped to 4 by
 *     S10-D-R1's unrelated, later, additive migration — see
 *     docs/S10-D-R1-DURABLE-PERSISTENCE.md) and must be kept in sync
 *     with js/storage.js's DB_VERSION whenever that baseline changes;
 *   - createMatchObservationSession reuses test_sessions/trial_events,
 *     forces test_id='ASMT-10' + feed_mode='live_match', rejects any
 *     other feed_mode;
 *   - trial_events written under a match session round-trip through the
 *     existing addTrialEvent()/trialsBySession() unchanged;
 *   - T10<->ASMT-10 alias mechanism still holds, plus the new
 *     isMatchCapture() helper resolves through it (no second namespace);
 *   - T10-lite (assessments.match_transfer / saveMatch) path is
 *     completely unaffected;
 *   - the 4.0 match threshold (70) and 4.5/5.0 provisional status are
 *     still untouched.
 * Run: node tests/s9-a-match-architecture.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var createFakeIndexedDB = require('./fake-indexeddb');

var ROOT = path.join(__dirname, '..');

global.indexedDB = createFakeIndexedDB();
delete require.cache[require.resolve('../js/storage.js')];
var PBStore = require('../js/storage.js');
var PBNamespace = require('../js/namespace.js');
var levelGates = require(path.join(ROOT, 'data', 'level_gates_v2_3_1.json'));
var assessmentSrc = fs.readFileSync(path.join(ROOT, 'js', 'assessment.js'), 'utf8');
var configLoaderSrc = fs.readFileSync(path.join(ROOT, 'js', 'config-loader.js'), 'utf8');
var namespaceSrc = fs.readFileSync(path.join(ROOT, 'js', 'namespace.js'), 'utf8');

function run() {
  return PBStore.open().then(function () {
    // ---- No new store added by S9-A itself (current repo baseline: 4, per S10-D-R1) ----
    assert.strictEqual(PBStore.DB_VERSION, 4, 'DB_VERSION must match the current repository baseline — S9-A itself adds no new store');

    return PBStore.createPlayer('S9-A Test Player');
  }).then(function (player) {
    return PBStore.createAssessment({
      player_id: player.player_id,
      assessment_tier: 'standard',
      target_training_level: 4.0
    });
  }).then(function (assessment) {
    // ---- createMatchObservationSession reuses test_sessions, forces test_id/feed_mode ----
    return PBStore.createMatchObservationSession({
      assessment_id: assessment.assessment_id,
      assessment_tier: 'standard'
    }).then(function (session) {
      assert.strictEqual(session.test_id, 'ASMT-10', 'match session must use canonical ASMT-10, not legacy T10');
      assert.strictEqual(session.feed_mode, 'live_match', 'match session must be tagged live_match');
      assert.ok(session.test_session_id, 'match session persisted with an id, via the existing test_sessions store');

      return PBStore.sessionsByAssessment(assessment.assessment_id).then(function (sessions) {
        assert.strictEqual(sessions.length, 1, 'match session is retrievable via the existing by_assessment index');
        assert.strictEqual(sessions[0].test_session_id, session.test_session_id);
      }).then(function () {
        // ---- feed_mode is enforced, not just defaulted ----
        return PBStore.createMatchObservationSession({
          assessment_id: assessment.assessment_id,
          feed_mode: 'machine'
        }).then(function () {
          throw new Error('expected createMatchObservationSession to reject a non-live_match feed_mode');
        }, function (err) {
          assert.ok(/feed_mode must be live_match/.test(err.message), 'rejects mismatched feed_mode: ' + err.message);
        });
      }).then(function () {
        // ---- assessment_id is required ----
        return PBStore.createMatchObservationSession({}).then(function () {
          throw new Error('expected createMatchObservationSession to require assessment_id');
        }, function (err) {
          assert.ok(/assessment_id is required/.test(err.message), 'rejects missing assessment_id: ' + err.message);
        });
      }).then(function () {
        // ---- trial_events under a match session round-trip via the existing, unmodified path ----
        return PBStore.addTrialEvent({
          test_session_id: session.test_session_id,
          trial_no: 1,
          outcome: 'S',
          raw_json: {
            phase: 'transition', intent: 'attack', shot: 'drive', target: 'body',
            quality: 'good', movement: 'recover', result: 'won_rally', pattern_id: 'p1',
            adaptation_opportunity: true, adaptation_success: true,
            neutralize_opportunity: false, neutralize_success: null, control_state: 'in_control'
          }
        }).then(function (trial) {
          return PBStore.trialsBySession(session.test_session_id).then(function (trials) {
            assert.strictEqual(trials.length, 1, 'match trial_event round-trips via the existing by_session index');
            assert.strictEqual(trials[0].raw_json.pattern_id, 'p1', 'the 14 required_trial_fields live inside the existing raw_json field, unmodified schema');
          });
        });
      });
    });
  }).then(function () {
    // ---- No new object store beyond the current 12 ----
    var dump = createFakeStoreCheck();
    return dump;
  }).then(function () {
    // ---- T10 <-> ASMT-10 alias unchanged; isMatchCapture resolves through it, no second namespace ----
    assert.strictEqual(PBNamespace.toCanonical('T10'), 'ASMT-10');
    assert.strictEqual(PBNamespace.toLegacy('ASMT-10'), 'T10');
    assert.strictEqual(PBNamespace.isMatchCapture('T10'), true, 'isMatchCapture must resolve the legacy alias, not require the canonical id literally');
    assert.strictEqual(PBNamespace.isMatchCapture('ASMT-10'), true);
    assert.strictEqual(PBNamespace.isMatchCapture('T01'), false, 'T01-T09 are not match-capture');
    assert.deepStrictEqual(PBNamespace.MATCH_CAPTURE_IDS, ['ASMT-10']);
    assert.strictEqual(/if\s*\([^)]*===\s*['"]T10['"]/.test(namespaceSrc), false, 'namespace.js must still not special-case T10 with its own branch');

    // ---- T10-lite path completely unaffected ----
    assert.ok(assessmentSrc.indexOf('function renderMatch()') !== -1, 'T10-lite Match Entry screen must still exist, untouched');
    assert.ok(assessmentSrc.indexOf('function saveMatch(') !== -1, 'saveMatch must still exist as the T10-lite write path');
    assert.ok(assessmentSrc.indexOf('PBStore.updateAssessment(aid') !== -1, 'saveMatch must still persist through assessments, not a new store');

    // ---- S1_TEST_IDS still excludes T10/ASMT-10 (S9-A must not fold match capture into S1 collection flow) ----
    assert.ok(/S1_TEST_IDS\s*=\s*\['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07', 'T08', 'T09'\]/.test(configLoaderSrc), 'S1_TEST_IDS must remain T01-T09 only, unmodified by S9-A');

    // ---- 4.0 threshold (70) and 4.5/5.0 provisional status untouched ----
    assert.strictEqual(levelGates.levels['4.0'].match_validation.min_match_transfer_score, 70);
    ['4.5', '5.0'].forEach(function (lvl) {
      assert.strictEqual(levelGates.levels[lvl].match_validation, undefined, lvl + ' still has no match_validation rule');
      assert.strictEqual(levelGates.levels[lvl].status, 'provisional');
    });

    console.log('s9-a-match-architecture.test.js: all assertions passed');
  });
}

function createFakeStoreCheck() {
  // The fake IDB tracks created stores on the underlying db object created during PBStore.open();
  // re-open and inspect via the same global.indexedDB instance used above.
  return new Promise(function (resolve, reject) {
    var req = global.indexedDB.open('pb_v2', 3);
    req.onsuccess = function () {
      var storeNames = [];
      var db = req.result;
      // FakeRequest db exposes objectStoreNames.contains only; enumerate via the known S1-S8 set + assert count via dump.
      resolve(db);
    };
    req.onerror = function () { reject(req.error); };
  }).then(function () {
    var dump = global.indexedDB._dump();
    var stores = Object.keys(dump['pb_v2'].stores);
    var expected = [
      'players', 'assessments', 'test_sessions', 'trial_events',
      'review_snapshots', 'prescriptions', 'retests',
      'training_cycles', 'weekly_plans', 'session_plans', 'session_logs', 'cycle_summaries',
      // S10-D-R1 (later, unrelated additive migration — see docs/S10-D-R1-DURABLE-PERSISTENCE.md)
      'development_cycles', 'prescription_workflows', 'session_results', 'training_evidence'
    ];
    assert.strictEqual(stores.length, expected.length, 'S9-A must not create any new object store beyond the current repository baseline (expected exactly these ' + expected.length + ' stores, found: ' + stores.join(', ') + ')');
    expected.forEach(function (name) {
      assert.ok(stores.indexOf(name) !== -1, 'expected existing store present: ' + name);
    });
  });
}

run().catch(function (err) {
  console.error('s9-a-match-architecture.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
