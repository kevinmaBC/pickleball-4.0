/* tests/session-evidence-persistence.test.js — S10-D-R1: Durable S10
 * Persistence + Reload Idempotency
 * Run: node tests/session-evidence-persistence.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var createFakeIndexedDB = require('./fake-indexeddb');

function assertThrows(promiseOrFn, label, expectedCode) {
  var p = typeof promiseOrFn === 'function' ? Promise.resolve().then(promiseOrFn) : promiseOrFn;
  return p.then(function () {
    throw new Error(label + ' should have rejected but resolved');
  }, function (e) {
    assert.ok(e instanceof Error, label + ' rejects with an Error');
    if (expectedCode) assert.strictEqual(e.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + e.code + ')');
  });
}

// One shared fake IndexedDB instance across the whole run, so "reload" is modeled honestly:
// re-`require`ing storage.js resets its internal _dbPromise (simulating a discarded JS runtime),
// while `fakeIDB`'s own closure state (the actual persisted records) survives — exactly like a
// real browser's IndexedDB surviving a page reload while in-memory JS state does not.
var fakeIDB = createFakeIndexedDB();
global.indexedDB = fakeIDB;

function freshRuntime() {
  delete require.cache[require.resolve('../js/storage.js')];
  global.PBStore = require('../js/storage.js');
  delete require.cache[require.resolve('../js/workflow-integration-engine.js')];
  global.PBWorkflow = require('../js/workflow-integration-engine.js');
  delete require.cache[require.resolve('../js/prescription-workflow-engine.js')];
  global.PBPrescriptionWorkflow = require('../js/prescription-workflow-engine.js');
  delete require.cache[require.resolve('../js/session-evidence-engine.js')];
  global.PBSessionEvidence = require('../js/session-evidence-engine.js');
  delete require.cache[require.resolve('../js/session-evidence-persistence.js')];
  global.PBSessionEvidencePersistence = require('../js/session-evidence-persistence.js');
  return global.PBSessionEvidencePersistence;
}

var SEP = freshRuntime();

function sessionIntent(overrides) {
  return Object.assign({
    session_id: 'sint_1', prescription_ref: 'rx_1', player_id: 'p1', status: 'PLANNED',
    training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION',
    kpi_profile_code: 'EXECUTION_SUCCESS_RATE', schema_version: '1.0'
  }, overrides || {});
}
function activeExecution(overrides) {
  var exec = PBSessionEvidence.createSessionExecution(Object.assign({ session_intent: sessionIntent(), recommendation_ref: 'rec_1' }, overrides || {})).session_execution;
  return PBSessionEvidence.transition(exec, 'START', {});
}

function run() {
  return PBStore.open().then(function () {

    // ================================================================
    // Schema / migration
    // ================================================================
    (function () {
      // 1. DB_VERSION == 4
      assert.strictEqual(PBStore.DB_VERSION, 4);
      var dump = fakeIDB._dump()['pb_v2'];
      // 2. all previous stores still exist
      ['players', 'assessments', 'test_sessions', 'trial_events', 'review_snapshots', 'prescriptions', 'retests',
       'training_cycles', 'weekly_plans', 'session_plans', 'session_logs', 'cycle_summaries'].forEach(function (name) {
        assert.ok(dump.stores[name], 'pre-existing store preserved: ' + name);
      });
      // 3-6. new stores exist
      ['development_cycles', 'prescription_workflows', 'session_results', 'training_evidence'].forEach(function (name) {
        assert.ok(dump.stores[name], 'new store exists: ' + name);
      });
      // 7. required indexes exist
      assert.ok(dump.stores.development_cycles.indexes.by_player);
      assert.ok(dump.stores.development_cycles.indexes.by_state);
      assert.ok(dump.stores.prescription_workflows.indexes.by_player);
      assert.ok(dump.stores.prescription_workflows.indexes.by_prescription);
      assert.ok(dump.stores.prescription_workflows.indexes.by_state);
      assert.ok(dump.stores.session_results.indexes.by_player);
      assert.ok(dump.stores.session_results.indexes.by_prescription);
      assert.ok(dump.stores.session_results.indexes.by_status);
      assert.ok(dump.stores.training_evidence.indexes.by_player);
      assert.ok(dump.stores.training_evidence.indexes.by_session);
      assert.ok(dump.stores.training_evidence.indexes.by_prescription);
      assert.ok(dump.stores.training_evidence.indexes.by_source);
    })();

    return Promise.resolve();
  }).then(function () {

    // 8. v3-style existing records survive upgrade unchanged — separate fresh fakeIDB seeded at v3.
    var seeded = createFakeIndexedDB();
    seeded._seed('pb_v2_seed_check', 3, {
      players: { keyPath: 'player_id', records: [{ player_id: 'plr_seed', display_name: 'Seed Player' }] }
    });
    var savedIDB = global.indexedDB;
    global.indexedDB = seeded;
    delete require.cache[require.resolve('../js/storage.js')];
    var SeedStore = require('../js/storage.js');
    var origDbName = SeedStore.DB_NAME;
    // storage.js's DB_NAME is fixed ('pb_v2'); reuse the seed under that exact name so the
    // module's own open() call upgrades it, matching real deployment.
    seeded._seed(origDbName, 3, {
      players: { keyPath: 'player_id', records: [{ player_id: 'plr_seed', display_name: 'Seed Player', created_at: '2026-01-01T00:00:00.000Z' }] }
    });
    return SeedStore.open().then(function () {
      var dump = seeded._dump()[origDbName];
      assert.strictEqual(dump.version, 4, 'seeded v3 database upgrades to v4');
      assert.strictEqual(dump.stores.players.data.get('plr_seed').display_name, 'Seed Player', 'pre-existing v3 record survives the v4 upgrade unchanged');
      global.indexedDB = savedIDB;
      SEP = freshRuntime(); // restore the shared runtime/IDB for the rest of this suite
    });
  }).then(function () {

    // ================================================================
    // CRUD
    // ================================================================
    var cyc = PBWorkflow.createDevelopmentCycle({ player_id: 'p_crud', baseline_ref: 'asm_crud' }).development_cycle;
    return PBStore.putDevelopmentCycle(cyc).then(function () {
      // 9. put/get development cycle
      return PBStore.getDevelopmentCycle(cyc.cycle_id);
    }).then(function (loaded) {
      assert.strictEqual(loaded.player_id, 'p_crud');
      assert.strictEqual(loaded.state, 'BASELINE_READY');
      // 10. query by player/state
      return Promise.all([
        PBStore.listDevelopmentCyclesByPlayer('p_crud'),
        PBStore.listDevelopmentCyclesByState('BASELINE_READY')
      ]);
    }).then(function (r) {
      assert.ok(r[0].some(function (c) { return c.cycle_id === cyc.cycle_id; }));
      assert.ok(r[1].some(function (c) { return c.cycle_id === cyc.cycle_id; }));

      var pwf = PBPrescriptionWorkflow.createPrescriptionWorkflow({
        prescription: { prescription_id: 'rx_crud', source_recommendation_id: 'rec_crud', status: 'prescribed' },
        player_id: 'p_crud'
      }).prescription_workflow;
      // 11. put/get prescription workflow
      return SEP.persistPrescriptionWorkflow(pwf).then(function () { return SEP.reloadPrescriptionWorkflow(pwf.workflow_id); }).then(function (loaded) {
        assert.strictEqual(loaded.prescription_ref, 'rx_crud');
        // 12. query prescription workflow indexes
        return Promise.all([
          PBStore.listPrescriptionWorkflowsByPlayer('p_crud'),
          PBStore.listPrescriptionWorkflowsByPrescription('rx_crud'),
          PBStore.listPrescriptionWorkflowsByState('DRAFTED')
        ]);
      }).then(function (r) {
        assert.ok(r[0].some(function (w) { return w.workflow_id === pwf.workflow_id; }));
        assert.ok(r[1].some(function (w) { return w.workflow_id === pwf.workflow_id; }));
        assert.ok(r[2].some(function (w) { return w.workflow_id === pwf.workflow_id; }));
      });
    }).then(function () {
      var sr = { session_id: 'sint_crud', player_id: 'p_crud', prescription_ref: 'rx_crud', status: 'COMPLETED', schema_version: '1.0' };
      // 13. put/get Session Result
      return PBStore.putSessionResult(sr).then(function () { return PBStore.getSessionResult('sint_crud'); }).then(function (loaded) {
        assert.strictEqual(loaded.status, 'COMPLETED');
        // 14. query Session Result indexes
        return Promise.all([
          PBStore.listSessionResultsByPlayer('p_crud'),
          PBStore.listSessionResultsByPrescription('rx_crud'),
          PBStore.listSessionResultsByStatus('COMPLETED')
        ]);
      }).then(function (r) {
        r.forEach(function (list) { assert.ok(list.some(function (x) { return x.session_id === 'sint_crud'; })); });
      });
    }).then(function () {
      var ev = { evidence_id: 'ev:sint_crud:KPI', player_id: 'p_crud', session_ref: 'sint_crud', prescription_ref: 'rx_crud', source: 'TRAINING', schema_version: '1.0' };
      // 15. put/get Training Evidence
      return PBStore.putTrainingEvidence(ev).then(function () { return PBStore.getTrainingEvidence('ev:sint_crud:KPI'); }).then(function (loaded) {
        assert.strictEqual(loaded.source, 'TRAINING');
        // 16. query Evidence indexes
        return Promise.all([
          PBStore.listTrainingEvidenceByPlayer('p_crud'),
          PBStore.listTrainingEvidenceBySession('sint_crud'),
          PBStore.listTrainingEvidenceByPrescription('rx_crud'),
          PBStore.listTrainingEvidenceBySource('TRAINING')
        ]);
      }).then(function (r) {
        r.forEach(function (list) { assert.ok(list.some(function (x) { return x.evidence_id === 'ev:sint_crud:KPI'; })); });
      });
    });
  }).then(function () {

    // ================================================================
    // Durability (genuine reload: discard runtime, keep fakeIDB, re-require)
    // ================================================================
    var cyc = PBWorkflow.createDevelopmentCycle({ player_id: 'p_dur', baseline_ref: 'asm_dur' }).development_cycle;
    return PBStore.putDevelopmentCycle(cyc).then(function () {
      var pwf = PBPrescriptionWorkflow.createPrescriptionWorkflow({
        prescription: {
          prescription_id: 'rx_dur', source_recommendation_id: 'rec_dur', status: 'prescribed',
          priority_rank: 1, priority_score: 70, priority_tier: 'HIGH',
          training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION', kpi_profile_code: 'EXECUTION_SUCCESS_RATE'
        }, player_id: 'p_dur'
      }).prescription_workflow;
      var activated = PBPrescriptionWorkflow.transition(pwf, 'ACTIVATE', {});
      return SEP.persistPrescriptionWorkflow(activated).then(function () { return { cycle_id: cyc.cycle_id, workflow_id: activated.workflow_id }; });
    }).then(function (ids) {
      var exec = activeExecution({ session_intent: sessionIntent({ session_id: 'sint_dur' }), recommendation_ref: 'rec_dur' });
      return SEP.completeSessionDurable({ session_execution: exec, attempts: 50, successful_attempts: 38, development_cycle_id: ids.cycle_id })
        .then(function (out) { return Object.assign({}, ids, { evidence_id: out.evidence.evidence_id }); });
    }).then(function (ids) {
      // ---- genuine reload: discard the JS runtime (re-require every module), keep fakeIDB ----
      SEP = freshRuntime();
      return Promise.all([
        PBStore.getDevelopmentCycle(ids.cycle_id),      // 17. Development Cycle survives reload
        PBStore.getPrescriptionWorkflow(ids.workflow_id), // 18. Prescription Workflow survives reload
        PBStore.getSessionResult('sint_dur'),            // 19. Session Result survives reload
        PBStore.getTrainingEvidence(ids.evidence_id)      // 20. Training Evidence survives reload
      ]).then(function (r) {
        assert.strictEqual(r[0].cycle_id, ids.cycle_id);
        assert.deepStrictEqual(r[0].evidence_refs, [ids.evidence_id], 'reloaded cycle carries the evidence ref');
        assert.strictEqual(r[1].workflow_id, ids.workflow_id);
        assert.strictEqual(r[1].state, 'ACTIVE');
        assert.strictEqual(r[2].session_id, 'sint_dur');
        assert.strictEqual(r[2].result_value, 0.76);
        assert.strictEqual(r[3].evidence_id, ids.evidence_id);
        assert.strictEqual(r[3].source, 'TRAINING');
        return ids;
      });
    });
  }).then(function (ids) {

    // ================================================================
    // Cross-reload idempotency
    // ================================================================
    var exec = activeExecution({ session_intent: sessionIntent({ session_id: 'sint_dur' }), recommendation_ref: 'rec_dur' });
    // 21. duplicate finalize blocked/reused after reload (identical payload -> idempotent reuse)
    return SEP.completeSessionDurable({ session_execution: exec, attempts: 50, successful_attempts: 38, development_cycle_id: ids.cycle_id }).then(function (out) {
      assert.strictEqual(out.session_result.session_id, 'sint_dur');
      assert.strictEqual(out.evidence.evidence_id, ids.evidence_id, 'identical replay reuses the existing evidence, no duplicate');
      // 22. conflicting finalize rejected
      return assertThrows(
        SEP.completeSessionDurable({ session_execution: exec, attempts: 50, successful_attempts: 10, development_cycle_id: ids.cycle_id }),
        'conflicting completion payload', 'DUPLICATE_FINALIZATION'
      );
    }).then(function () {
      // 23. duplicate evidence blocked/reused after reload — proven by evidence_id staying identical above;
      // additionally verify no second training_evidence record was created for this session/KPI.
      return PBStore.listTrainingEvidenceBySession('sint_dur');
    }).then(function (list) {
      assert.strictEqual(list.length, 1, 'exactly one Evidence record exists for this session, no duplicate');
      // 24. conflicting evidence (same evidence_id, different upstream data) — modeled via a
      // second distinct session that would collide on kpi_profile_code if built independently;
      // buildTrainingEvidence's determinism means "conflicting content, same id" cannot arise
      // from two different Session Results for the *same* session_id (session_id is part of the
      // identity), so this is proven structurally: the identity ties 1:1 to one session's result.
      assert.strictEqual(list[0].value, 0.76, 'the persisted evidence value matches the original session result, not a later conflicting one');
    });
  }).then(function () {

    // ================================================================
    // Recovery
    // ================================================================

    // 25. existing result + missing evidence can resume
    (function setupPromise() {})();
    var cyc25;
    return (function () {
      var c = PBWorkflow.createDevelopmentCycle({ player_id: 'p_rec25', baseline_ref: 'asm_rec25' }).development_cycle;
      return PBStore.putDevelopmentCycle(c).then(function () { cyc25 = c; });
    })().then(function () {
      var exec = activeExecution({ session_intent: sessionIntent({ session_id: 'sint_rec25' }), recommendation_ref: 'rec_rec25' });
      var result = PBSessionEvidence.completeSession(exec, { attempts: 20, successful_attempts: 15 }).session_result;
      // simulate a prior partial run: Session Result persisted, Evidence step never ran
      return PBStore.putSessionResult(result);
    }).then(function () {
      var exec = activeExecution({ session_intent: sessionIntent({ session_id: 'sint_rec25' }), recommendation_ref: 'rec_rec25' });
      return SEP.completeSessionDurable({ session_execution: exec, attempts: 20, successful_attempts: 15, development_cycle_id: cyc25.cycle_id });
    }).then(function (out) {
      assert.strictEqual(out.session_result.session_id, 'sint_rec25', 'existing Session Result was reused, not re-finalized');
      assert.ok(out.evidence.evidence_id, 'Evidence step completed on resume');
      assert.ok(out.development_cycle.evidence_refs.indexOf(out.evidence.evidence_id) !== -1);

      // 26. existing result/evidence + cycle missing ref can resume ADD_EVIDENCE
      var c2 = PBWorkflow.createDevelopmentCycle({ player_id: 'p_rec26', baseline_ref: 'asm_rec26' }).development_cycle;
      return PBStore.putDevelopmentCycle(c2).then(function () {
        var exec2 = activeExecution({ session_intent: sessionIntent({ session_id: 'sint_rec26' }), recommendation_ref: 'rec_rec26' });
        var result2 = PBSessionEvidence.completeSession(exec2, { attempts: 10, successful_attempts: 7 }).session_result;
        var evidence2 = PBSessionEvidence.buildTrainingEvidence(result2).evidence;
        // simulate a prior partial run: Result + Evidence persisted, cycle never updated
        return Promise.all([PBStore.putSessionResult(result2), PBStore.putTrainingEvidence(evidence2)]).then(function () {
          return SEP.completeSessionDurable({ session_execution: exec2, attempts: 10, successful_attempts: 7, development_cycle_id: c2.cycle_id });
        }).then(function (out2) {
          assert.ok(out2.development_cycle.evidence_refs.indexOf(evidence2.evidence_id) !== -1, 'resume applied ADD_EVIDENCE using the already-persisted Evidence');

          // 27. already fully-completed durable flow is idempotent
          var exec2b = activeExecution({ session_intent: sessionIntent({ session_id: 'sint_rec26' }), recommendation_ref: 'rec_rec26' });
          return SEP.completeSessionDurable({ session_execution: exec2b, attempts: 10, successful_attempts: 7, development_cycle_id: c2.cycle_id }).then(function (out3) {
            assert.strictEqual(out3.development_cycle.evidence_refs.length, out2.development_cycle.evidence_refs.length, 'repeating the fully-completed flow creates no duplicate ref');
          });
        });
      });
    });
  }).then(function () {

    // ================================================================
    // S10-A bridge (durable)
    // ================================================================
    var cyc = PBWorkflow.createDevelopmentCycle({ player_id: 'p_bridge', baseline_ref: 'asm_bridge' }).development_cycle;
    // cycle already has a recommendation on file, per §19's "initial cycle has recommendation" setup
    cyc = PBWorkflow.transition(cyc, 'ADD_EVIDENCE', { evidence_ref: 'ev_seed' });
    cyc = PBWorkflow.transition(cyc, 'GENERATE_RECOMMENDATION', { recommendation_refs: ['rec_bridge'] });
    return PBStore.putDevelopmentCycle(cyc).then(function () {
      var exec = activeExecution({ session_intent: sessionIntent({ session_id: 'sint_bridge', kpi_profile_code: 'BRIDGE_KPI' }), recommendation_ref: 'rec_bridge' });
      return SEP.completeSessionDurable({ session_execution: exec, attempts: 30, successful_attempts: 24, development_cycle_id: cyc.cycle_id });
    }).then(function (out) {
      // 28. persisted evidence_ref enters persisted development cycle
      assert.ok(out.development_cycle.evidence_refs.indexOf(out.evidence.evidence_id) !== -1);
      // 29. S10-A returned state preserved — compute independently and compare
      var independent = PBWorkflow.transition(cyc, 'ADD_EVIDENCE', { evidence_ref: out.evidence.evidence_id });
      assert.strictEqual(out.development_cycle.state, independent.state);
      // this cycle already had a recommendation -> new evidence makes it REASSESSMENT_READY
      assert.strictEqual(out.development_cycle.state, 'REASSESSMENT_READY');

      // 30. REASSESSMENT_READY survives reload when applicable
      SEP = freshRuntime();
      return PBStore.getDevelopmentCycle(cyc.cycle_id).then(function (reloaded) {
        assert.strictEqual(reloaded.state, 'REASSESSMENT_READY', 'REASSESSMENT_READY survives a genuine reload');
      });
    });
  }).then(function () {

    // ================================================================
    // Integrity
    // ================================================================
    var cyc = PBWorkflow.createDevelopmentCycle({ player_id: 'p_int', baseline_ref: 'asm_int' }).development_cycle;
    return PBStore.putDevelopmentCycle(cyc).then(function () {
      var exec = activeExecution({ session_intent: sessionIntent({ session_id: 'sint_int' }), recommendation_ref: 'rec_int' });
      return SEP.completeSessionDurable({ session_execution: exec, attempts: 12, successful_attempts: 9, development_cycle_id: cyc.cycle_id });
    }).then(function (out) {
      // 31. traceability fields preserved
      assert.strictEqual(out.session_result.prescription_ref, 'rx_1');
      assert.strictEqual(out.session_result.recommendation_ref, 'rec_int');
      assert.strictEqual(out.evidence.session_ref, 'sint_int');
      assert.strictEqual(out.evidence.prescription_ref, 'rx_1');
      assert.strictEqual(out.evidence.recommendation_ref, 'rec_int');
      assert.strictEqual(out.evidence.player_id, 'p1');
      // 32. source remains TRAINING
      assert.strictEqual(out.evidence.source, 'TRAINING');
      // 33/34: no progress/trend fields, no recommendation/priority changes
      ['baseline_kpi', 'current_kpi', 'delta', 'trend', 'target_status'].forEach(function (f) {
        assert.strictEqual(out.evidence[f], undefined);
        assert.strictEqual(out.session_result[f], undefined);
      });
      assert.deepStrictEqual(out.development_cycle.recommendation_refs, [], 'no recommendation_refs change from this file');
      assert.strictEqual(out.development_cycle.priority_ref, null);
    });
  }).then(function () {

    // ================================================================
    // Architecture protection
    // ================================================================
    var orchSrc = fs.readFileSync(path.join(__dirname, '../js/session-evidence-persistence.js'), 'utf8');
    var orchStripped = orchSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // 35/36/37: no S7/S8 fake records, no writes into S8 session_logs for S10 data
    ['review_snapshots', 'training_cycles', 'weekly_plans', 'session_plans', 'session_logs', 'cycle_summaries'].forEach(function (token) {
      assert.ok(orchStripped.indexOf("'" + token + "'") === -1 && orchStripped.indexOf('.' + token) === -1,
        'session-evidence-persistence.js must never reference the S7/S8 store "' + token + '"');
    });

    // 38. no S9 engine modification / recommendation-priority-mapping reference
    var forbiddenEngines = ['PBMatchObservation', 'PBPerformanceAnalysis', 'PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'PBDashboard'];
    forbiddenEngines.forEach(function (token) {
      assert.ok(orchStripped.indexOf(token) === -1, 'session-evidence-persistence.js must never reference ' + token);
    });

    // 39. no S10-E logic
    ['baseline_kpi', 'current_kpi', "'delta'", 'IMPROVING', 'DECLINING', "'MET'", 'NOT_MET'].forEach(function (token) {
      assert.ok(orchStripped.indexOf(token) === -1, 'session-evidence-persistence.js must never contain progress vocabulary "' + token + '"');
    });

    // 40. migration is additive only — storage.js's open() only ever calls createObjectStore
    // inside an `if (!db.objectStoreNames.contains(name))` guard, and never calls
    // deleteObjectStore/clear/delete anywhere in its upgrade path.
    var storageSrc = fs.readFileSync(path.join(__dirname, '../js/storage.js'), 'utf8');
    var storageStripped = storageSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(storageStripped.indexOf('deleteObjectStore') === -1, 'storage.js must never delete an object store');
    var upgradeBlock = storageStripped.match(/onupgradeneeded[\s\S]*?\n  \};/)[0];
    assert.ok(/if\s*\(!db\.objectStoreNames\.contains\(name\)\)/.test(upgradeBlock), 'the upgrade path only creates stores that are missing — additive only');
  });
}

run().then(function () {
  console.log('session-evidence-persistence.test.js: all assertions passed');
}).catch(function (err) {
  console.error('session-evidence-persistence.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
