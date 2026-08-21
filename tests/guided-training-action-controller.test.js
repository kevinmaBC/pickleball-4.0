/* tests/guided-training-action-controller.test.js — S11-C: Guided
 * Training Action Flow Controller
 * Run: node tests/guided-training-action-controller.test.js
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

// Same "genuine reload" fake IndexedDB convention tests/session-evidence-persistence.test.js and
// tests/progress-reassessment-persistence.test.js already use.
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
  delete require.cache[require.resolve('../js/product-journey-orchestrator.js')];
  global.PBProductJourney = require('../js/product-journey-orchestrator.js');
  delete require.cache[require.resolve('../js/guided-training-action-controller.js')];
  global.PBGuidedTrainingController = require('../js/guided-training-action-controller.js');
  return global.PBGuidedTrainingController;
}

var C = freshRuntime();
var idCounter = 0;
function uid(prefix) { idCounter += 1; return prefix + '_' + idCounter; }

// Minimal upstream fixture matching js/prescription-workflow-engine.js's own accepted input
// shape — every field canActivate() requires present (per docs/S10-C-PRESCRIPTION-WORKFLOW.md).
function eligiblePrescription(overrides) {
  return Object.assign({
    prescription_id: uid('rx'), source_recommendation_id: uid('rec'), status: 'prescribed',
    priority_rank: 1, priority_score: 74, priority_tier: 'HIGH',
    training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION',
    kpi_profile_code: 'EXECUTION_SUCCESS_RATE',
    drill_family_code: 'SHOT_EXECUTION', dosage_profile_code: 'PRIMARY_FOCUS',
    resolved_drill_ids: [], drill_resolution_status: 'RESOLVED',
    kpi_target_value: 0.7, kpi_target_status: 'AT_TARGET',
    reassessment_profile_code: 'MATCH_RECHECK'
  }, overrides || {});
}

function putWorkflow(player_id, prescriptionOverrides, workflowOverrides) {
  var pwf = PBPrescriptionWorkflow.createPrescriptionWorkflow({
    prescription: eligiblePrescription(prescriptionOverrides), player_id: player_id
  }).prescription_workflow;
  pwf = Object.assign({}, pwf, workflowOverrides || {});
  return PBStore.putPrescriptionWorkflow(pwf).then(function () { return pwf; });
}

function putCycle(player_id, overrides) {
  var cyc = PBWorkflow.createDevelopmentCycle({ player_id: player_id, baseline_ref: uid('asm') }).development_cycle;
  cyc = Object.assign({}, cyc, overrides || {});
  return PBStore.putDevelopmentCycle(cyc).then(function () { return cyc; });
}

function run() {
  return PBStore.open().then(function () {

    // ================================================================
    // C-T01 — DRAFTED -> ACTIVATE -> ACTIVE, persisted
    // ================================================================
    var player1 = uid('p');
    return putWorkflow(player1).then(function (pwf) {
      return C.activatePrescription({ workflow_id: pwf.workflow_id }).then(function (out) {
        assert.strictEqual(out.workflow.state, 'ACTIVE', 'C-T01 in-memory result state');
        return PBStore.getPrescriptionWorkflow(pwf.workflow_id).then(function (persisted) {
          assert.strictEqual(persisted.state, 'ACTIVE', 'C-T01 persisted state');
          assert.ok(persisted.activated_at, 'C-T01 activated_at set');
        });
      });
    });
  }).then(function () {

    // ================================================================
    // C-T02 — ACTIVE -> START_TRAINING -> IN_PROGRESS + session_intent + ACTIVE execution
    // ================================================================
    var player2 = uid('p');
    return putWorkflow(player2, {}, { state: 'ACTIVE', activated_at: '2026-01-01T00:00:00.000Z' }).then(function (pwf) {
      return C.startTraining({ workflow_id: pwf.workflow_id }).then(function (out) {
        assert.strictEqual(out.workflow.state, 'IN_PROGRESS', 'C-T02 workflow IN_PROGRESS');
        assert.strictEqual(out.session_execution.state, 'ACTIVE', 'C-T02 session execution ACTIVE');
        assert.ok(out.workflow.session_refs.indexOf(out.session_execution.session_id) !== -1, 'C-T02 session_refs includes new session_id');
        var active = C.getActiveSession();
        assert.ok(active, 'C-T02 in-memory active session set');
        assert.strictEqual(active.session_execution.session_id, out.session_execution.session_id);
        return PBStore.getPrescriptionWorkflow(pwf.workflow_id).then(function (persisted) {
          assert.strictEqual(persisted.state, 'IN_PROGRESS', 'C-T02 persisted state');
        });
      });
    });
  }).then(function () {

    // ================================================================
    // C-T03 — stale cycle blocks ACTIVATE
    // ================================================================
    C.clearActiveSession(); // reset shared in-memory state left over from C-T02, independent scenario
    var player3 = uid('p');
    return putCycle(player3, { state: 'REASSESSMENT_READY' }).then(function () {
      return putWorkflow(player3).then(function (pwf) {
        return assertThrows(C.activatePrescription({ workflow_id: pwf.workflow_id }), 'C-T03 stale ACTIVATE', 'STALE_RECOMMENDATION').then(function () {
          return PBStore.getPrescriptionWorkflow(pwf.workflow_id).then(function (persisted) {
            assert.strictEqual(persisted.state, 'DRAFTED', 'C-T03 workflow never mutated when stale');
          });
        });
      });
    });
  }).then(function () {

    // ================================================================
    // C-T04 — stale cycle blocks START_TRAINING
    // ================================================================
    var player4 = uid('p');
    return putCycle(player4, { state: 'REASSESSMENT_READY' }).then(function () {
      return putWorkflow(player4, {}, { state: 'ACTIVE', activated_at: '2026-01-01T00:00:00.000Z' }).then(function (pwf) {
        return assertThrows(C.startTraining({ workflow_id: pwf.workflow_id }), 'C-T04 stale START_TRAINING', 'STALE_RECOMMENDATION').then(function () {
          assert.strictEqual(C.getActiveSession(), null, 'C-T04 no in-memory execution created when stale');
          return PBStore.getPrescriptionWorkflow(pwf.workflow_id).then(function (persisted) {
            assert.strictEqual(persisted.state, 'ACTIVE', 'C-T04 workflow never mutated when stale');
          });
        });
      });
    });
  }).then(function () {

    // ================================================================
    // C-T05 — UNRESOLVED drill still allows Activate/Start
    // ================================================================
    var player5 = uid('p');
    return putWorkflow(player5, { drill_resolution_status: 'UNRESOLVED' }).then(function (pwf) {
      return C.activatePrescription({ workflow_id: pwf.workflow_id }).then(function (out) {
        assert.strictEqual(out.workflow.state, 'ACTIVE', 'C-T05 activation succeeds despite UNRESOLVED drill');
        assert.strictEqual(out.workflow.prescription_snapshot.drill_resolution_status, 'UNRESOLVED', 'C-T05 raw code preserved, never fabricated');
        return C.startTraining({ workflow_id: pwf.workflow_id }).then(function (startOut) {
          assert.strictEqual(startOut.workflow.state, 'IN_PROGRESS', 'C-T05 start succeeds despite UNRESOLVED drill');
        });
      });
    });
  }).then(function () {

    // ================================================================
    // C-T06 — BENCHMARK_NOT_RESOLVED remains explicit
    // ================================================================
    var player6 = uid('p');
    return putWorkflow(player6, { kpi_target_status: 'BENCHMARK_NOT_RESOLVED', kpi_target_value: null }).then(function (pwf) {
      return C.activatePrescription({ workflow_id: pwf.workflow_id }).then(function (out) {
        assert.strictEqual(out.workflow.state, 'ACTIVE', 'C-T06 activation succeeds despite unresolved benchmark');
        assert.strictEqual(out.workflow.prescription_snapshot.kpi_target_status, 'BENCHMARK_NOT_RESOLVED', 'C-T06 raw code preserved, never invented');
        assert.strictEqual(out.workflow.prescription_snapshot.kpi_target_value, null, 'C-T06 no fabricated target value');
      });
    });
  }).then(function () {

    // ================================================================
    // C-T07 — double Start does not create a second session_intent
    // ================================================================
    var player7 = uid('p');
    return putWorkflow(player7, {}, { state: 'ACTIVE', activated_at: '2026-01-01T00:00:00.000Z' }).then(function (pwf) {
      return C.startTraining({ workflow_id: pwf.workflow_id }).then(function (first) {
        return assertThrows(C.startTraining({ workflow_id: pwf.workflow_id }), 'C-T07 double start', 'ALREADY_IN_PROGRESS').then(function () {
          return PBStore.getPrescriptionWorkflow(pwf.workflow_id).then(function (persisted) {
            assert.strictEqual(persisted.session_refs.length, 1, 'C-T07 no second session_intent added to session_refs');
            assert.deepStrictEqual(persisted.session_refs, [first.session_execution.session_id], 'C-T07 session_refs unchanged by the rejected second start');
          });
        });
      });
    });
  }).then(function () {

    // ================================================================
    // C-T08 — complete session delegates to completeSessionDurable
    // ================================================================
    var player8 = uid('p');
    var ctx8 = {};
    return putCycle(player8).then(function (cyc) {
      ctx8.cycle_id = cyc.cycle_id;
      return putWorkflow(player8, {}, { state: 'ACTIVE', activated_at: '2026-01-01T00:00:00.000Z' });
    }).then(function (pwf) {
      ctx8.workflow_id = pwf.workflow_id;
      return C.startTraining({ workflow_id: pwf.workflow_id });
    }).then(function (startOut) {
      ctx8.execution = startOut.session_execution;
      return C.completeSession({ attempts: 20, successful_attempts: 15, development_cycle_id: ctx8.cycle_id });
    }).then(function (out) {
      assert.strictEqual(out.session_result.session_id, ctx8.execution.session_id, 'C-T08 session_result matches the active execution');
      assert.strictEqual(out.session_result.attempts, 20);
      assert.strictEqual(out.session_result.successful_attempts, 15);
      assert.strictEqual(out.evidence.source, 'TRAINING', 'C-T08 evidence produced via the real S10-D engine');
      assert.ok(out.development_cycle.evidence_refs.indexOf(out.evidence.evidence_id) !== -1, 'C-T08 cycle carries the new evidence ref via real ADD_EVIDENCE');
      assert.strictEqual(C.getActiveSession(), null, 'C-T08 active session cleared on success');
      ctx8.evidence_id = out.evidence.evidence_id;
      return ctx8;
    });
  }).then(function (ctx8) {

    // ================================================================
    // C-T09 — duplicate same-payload completion remains idempotent.
    // The controller clears ACTIVE_SESSION on success (§24) and never reconstructs an execution
    // from persisted data (§15), so a "replay" is exercised directly against
    // PBSessionEvidencePersistence.completeSessionDurable with the same execution object the
    // controller used — proving the idempotency guarantee the controller delegates to still
    // holds for exactly the flow it drove.
    // ================================================================
    return PBSessionEvidencePersistence.completeSessionDurable({
      session_execution: ctx8.execution, attempts: 20, successful_attempts: 15, development_cycle_id: ctx8.cycle_id
    }).then(function (out) {
      assert.strictEqual(out.evidence.evidence_id, ctx8.evidence_id, 'C-T09 identical replay reuses the existing evidence, no duplicate');
      return ctx8;
    });
  }).then(function (ctx8) {

    // ================================================================
    // C-T10 — duplicate different-payload completion rejects
    // ================================================================
    return assertThrows(
      PBSessionEvidencePersistence.completeSessionDurable({
        session_execution: ctx8.execution, attempts: 20, successful_attempts: 5, development_cycle_id: ctx8.cycle_id
      }),
      'C-T10 conflicting completion payload', 'DUPLICATE_FINALIZATION'
    );
  }).then(function () {

    // ================================================================
    // C-T15 — reload: IN_PROGRESS workflow + no active execution -> ACTIVE_SESSION_LOST
    // ================================================================
    var player15 = uid('p');
    return putWorkflow(player15, {}, { state: 'ACTIVE', activated_at: '2026-01-01T00:00:00.000Z' }).then(function (pwf) {
      return C.startTraining({ workflow_id: pwf.workflow_id }).then(function () {
        // Simulate a page reload destroying in-memory state, while the persisted workflow
        // (already IN_PROGRESS, written before the "reload") survives.
        C.clearActiveSession();
        return C.resolveSessionState({ workflow_id: pwf.workflow_id }).then(function (state) {
          assert.strictEqual(state.state, 'ACTIVE_SESSION_LOST', 'C-T15 honest reload-loss presentation state');
          assert.strictEqual(state.session_execution, null, 'C-T15 no fabricated execution');
        });
      });
    });
  }).then(function () {

    // ================================================================
    // C-T16 — post-completion Journey refresh uses S11-A
    // ================================================================
    var player16 = uid('p');
    var ctx16 = {};
    return putCycle(player16).then(function (cyc) {
      ctx16.cycle_id = cyc.cycle_id;
      return putWorkflow(player16, {}, { state: 'ACTIVE', activated_at: '2026-01-01T00:00:00.000Z' });
    }).then(function (pwf) {
      return C.startTraining({ workflow_id: pwf.workflow_id });
    }).then(function () {
      return C.completeSession({ attempts: 10, successful_attempts: 8, development_cycle_id: ctx16.cycle_id });
    }).then(function () {
      return C.refreshJourney({ player_id: player16, development_cycle_id: ctx16.cycle_id });
    }).then(function (result) {
      assert.strictEqual(result.journey.journey_version, 'S11-A-V1', 'C-T16 refreshed via the real PBProductJourney engine');
      assert.ok(PBProductJourney.JOURNEY_STAGES.indexOf(result.journey.stage) !== -1, 'C-T16 stage is a real S11-A Journey Stage');
    });
  }).then(function () {

    // ================================================================
    // Structurally invalid input -> explicit error, never a silent guess
    // ================================================================
    return assertThrows(function () { return C.activatePrescription({}); }, 'missing workflow_id (activate)', 'INVALID_INPUT').then(function () {
      return assertThrows(function () { return C.startTraining({}); }, 'missing workflow_id (start)', 'INVALID_INPUT');
    }).then(function () {
      return assertThrows(C.activatePrescription({ workflow_id: 'nonexistent_wf' }), 'unknown workflow', 'PRESCRIPTION_WORKFLOW_NOT_FOUND');
    }).then(function () {
      return assertThrows(C.completeSession({ development_cycle_id: 'cyc_x' }), 'complete with no active session', 'ACTIVE_SESSION_LOST');
    });
  }).then(function () {

    // ================================================================
    // C-T11/C-T12/C-T13/C-T14 — structural source scan
    // ================================================================
    var SRC = fs.readFileSync(path.join(__dirname, '../js/guided-training-action-controller.js'), 'utf8');
    var STRIPPED = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // C-T11: no direct workflow/execution/cycle state assignment.
    assert.strictEqual(/\.\s*state\s*=\s*['"]/.test(STRIPPED), false, 'C-T11: must never directly assign .state = \'...\' — every transition must go through PBPrescriptionWorkflow/PBSessionEvidence');

    // C-T12: no direct evidence creation.
    ['buildTrainingEvidence', 'submitTrainingEvidence', 'putTrainingEvidence', 'createEvidence('].forEach(function (token) {
      assert.strictEqual(STRIPPED.indexOf(token), -1, 'C-T12: must never create Evidence directly (' + token + ')');
    });

    // C-T13: no S9 engine invocation.
    ['PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'diagnoseMatch', 'prioritizeDiagnosis', 'prescribeRecommendations'].forEach(function (token) {
      assert.strictEqual(STRIPPED.indexOf(token), -1, 'C-T13: must never reference ' + token);
    });

    // C-T14: no old S8 TrainingCycle/SessionPlan/session-execution-engine bridge.
    ['PBTrainingPlan', 'PBSessionExecution', 'getSessionPlan', 'session_plans', 'training_cycles', 'weekly_plans'].forEach(function (token) {
      assert.strictEqual(STRIPPED.indexOf(token), -1, 'C-T14: must never reference the old S8 lineage (' + token + ')');
    });

    // No direct workflow transition ownership outside the two authorized S10-C calls, and no
    // direct PBStore writes other than the documented pass-through persistence calls.
    ['.transition(workflow', 'PBWorkflow.transition'].forEach(function (token) {
      assert.strictEqual(STRIPPED.indexOf(token), -1, 'must never call ' + token + ' directly — S10-A cycle transitions belong to PBSessionEvidencePersistence.completeSessionDurable only');
    });
  }).then(function () {

    console.log('guided-training-action-controller.test.js: all assertions passed');
  });
}

run().catch(function (err) {
  console.error('guided-training-action-controller.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
