/* tests/s11-reload-recovery.test.js — S11-F: Reload / Recovery Matrix
 * Run: node tests/s11-reload-recovery.test.js
 *
 * Drives the same real production API surface as
 * tests/s11-full-product-journey.test.js, but interleaves genuine reload
 * simulation at each of the frozen package's 8 checkpoints (R1..R8): every
 * module is re-`require`d (its own in-memory state — e.g.
 * js/guided-training-action-controller.js's ACTIVE_SESSION — is discarded,
 * exactly like a real browser tab reload discards page JS state), while the
 * shared fake IndexedDB instance's own closure state (the actual persisted
 * records) survives, exactly like a real browser's IndexedDB surviving a
 * page reload. This is the same reload-simulation convention
 * tests/session-evidence-persistence.test.js already established.
 *
 * After each reload, only PRODUCTION READERS are used to verify state
 * (js/home-dashboard-adapter.js, js/guided-training-action-controller.js's
 * resolveSessionState, js/progress-reassessment-adapter.js,
 * js/history-explainability-adapter.js) — never DevTools-style direct
 * PBStore inspection standing in for the real read path (PBStore.get* calls
 * below are used only to double-check durability, never to fabricate state).
 */
var assert = require('assert');
var createFakeIndexedDB = require('./fake-indexeddb');

var fakeIDB = createFakeIndexedDB();
global.indexedDB = fakeIDB;

var MODULES = [
  ['../js/storage.js', 'PBStore'],
  ['../js/namespace.js', 'PBNamespace'],
  ['../js/match-observation-engine.js', 'PBMatchObservation'],
  ['../js/performance-analysis-engine.js', 'PBPerformanceAnalysis'],
  ['../js/diagnosis-engine.js', 'PBDiagnosis'],
  ['../js/recommendation-priority-engine.js', 'PBRecommendationPriority'],
  ['../js/training-prescription-engine.js', 'PBTrainingPrescription'],
  ['../js/dashboard-integration-engine.js', 'PBDashboard'],
  ['../js/workflow-integration-engine.js', 'PBWorkflow'],
  ['../js/prescription-workflow-engine.js', 'PBPrescriptionWorkflow'],
  ['../js/session-evidence-engine.js', 'PBSessionEvidence'],
  ['../js/session-evidence-persistence.js', 'PBSessionEvidencePersistence'],
  ['../js/decision-cycle-registration-controller.js', 'PBDecisionCycleRegistration'],
  ['../js/product-journey-orchestrator.js', 'PBProductJourney'],
  ['../js/home-dashboard-adapter.js', 'PBHomeDashboardAdapter'],
  ['../js/guided-training-action-controller.js', 'PBGuidedTrainingController'],
  ['../js/cycle-baseline-engine.js', 'PBCycleBaseline'],
  ['../js/progress-tracking-engine.js', 'PBProgressTracking'],
  ['../js/reassessment-engine.js', 'PBReassessment'],
  ['../js/progress-reassessment-persistence.js', 'PBProgressReassessmentPersistence'],
  ['../js/progress-reassessment-adapter.js', 'PBProgressReassessmentAdapter'],
  ['../js/history-explainability-adapter.js', 'PBHistoryExplainabilityAdapter']
];

// Simulates a genuine page reload: every module's own in-memory state is discarded and
// re-required, but `fakeIDB`'s closure (the actual persisted IndexedDB records) survives.
function reload() {
  MODULES.forEach(function (pair) {
    delete require.cache[require.resolve(pair[0])];
    global[pair[1]] = require(pair[0]);
  });
}

reload();

function baseRally(overrides) {
  return Object.assign({
    game_number: 1, rally_number: 1,
    phase: 'transition', intent: 'neutralize', shot: 'reset', target: 'middle',
    quality: 'good', movement: 'balanced', result: 'continue',
    control_state: 'neutral'
  }, overrides || {});
}

function run() {
  var ctx = {};
  return PBStore.open().then(function () {
    return PBStore.createPlayer('S11-F Reload QA Player');
  }).then(function (player) {
    ctx.player = player;
    return PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 });
  }).then(function (assessment) {
    return PBMatchObservation.createMatchSession({ assessment_id: assessment.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF' } });
  }).then(function (session) {
    ctx.match_session = session;
    var chain = Promise.resolve();
    for (var i = 1; i <= 8; i++) {
      (function (i) {
        chain = chain.then(function () {
          return PBMatchObservation.addRallyObservation(session.test_session_id, baseRally({ game_number: 1, rally_number: i, shot: 'drop', quality: 'error', result: 'ue' }));
        });
      })(i);
    }
    return chain;
  }).then(function () {

    // ================================================================
    // F-R01 — reload after Match save: Match survives.
    // ================================================================
    reload();
    return PBStore.get('test_sessions', ctx.match_session.test_session_id).then(function (persisted) {
      assert.ok(persisted, 'F-R01 Match survives reload');
    });
  }).then(function () {

    // Build the real S9 chain + register, exactly as a real user's Review click would.
    return PBDiagnosis.diagnoseMatch(ctx.match_session.test_session_id, ctx.player.player_id).then(function (diagnosis) {
      var recResult = PBRecommendationPriority.prioritizeDiagnosis(diagnosis);
      var primary = recResult.recommendations.filter(function (r) { return r.rank === 1; })[0];
      var rxResult = PBTrainingPrescription.prescribeRecommendations(recResult);
      var matching = rxResult.prescriptions.filter(function (p) { return p.source_recommendation_id === primary.recommendation_id; })[0];
      ctx.primaryRecommendation = primary;
      ctx.primaryPrescription = matching;
      return PBDecisionCycleRegistration.registerDecisionCycle({
        player_id: ctx.player.player_id, source_match_session_id: ctx.match_session.test_session_id,
        recommendation: primary, prescription: matching
      });
    }).then(function (registration) {
      ctx.cycle_id = registration.development_cycle.cycle_id;
      ctx.workflow_id = registration.prescription_workflow.workflow_id;
    });
  }).then(function () {

    // ================================================================
    // F-R02 — reload after registration: Cycle/Workflow survive, via the
    // real S11-A production reader.
    // ================================================================
    reload();
    return PBHomeDashboardAdapter.loadHomeDashboard(ctx.player.player_id).then(function (result) {
      var home = result.home_dashboard;
      assert.strictEqual(home.journey.stage, 'READY_TO_TRAIN', 'F-R02 stage READY_TO_TRAIN survives reload');
      assert.strictEqual(home.next_action.code, 'ACTIVATE_PRESCRIPTION', 'F-R02 next_action survives reload');
      assert.strictEqual(home.next_action.target_ref, ctx.workflow_id, 'F-R02 workflow_id survives reload');
    });
  }).then(function () {

    // ================================================================
    // F-R08 (checked here too, and again at the end): repeated read-side
    // rendering must not create anything. Two consecutive reads must be
    // byte-identical in record counts.
    // ================================================================
    return Promise.all([PBStore.listDevelopmentCyclesByPlayer(ctx.player.player_id), PBStore.listPrescriptionWorkflowsByPlayer(ctx.player.player_id)]);
  }).then(function (before) {
    return PBHomeDashboardAdapter.loadHomeDashboard(ctx.player.player_id).then(function () {
      return Promise.all([PBStore.listDevelopmentCyclesByPlayer(ctx.player.player_id), PBStore.listPrescriptionWorkflowsByPlayer(ctx.player.player_id)]);
    }).then(function (after) {
      assert.strictEqual(after[0].length, before[0].length, 'F-R08 repeated HOME read creates no new Development Cycle');
      assert.strictEqual(after[1].length, before[1].length, 'F-R08 repeated HOME read creates no new Prescription Workflow');
    });
  }).then(function () {

    // Activate, exactly as a real user's HOME click would.
    return PBGuidedTrainingController.activatePrescription({ workflow_id: ctx.workflow_id });
  }).then(function () {

    // ================================================================
    // F-R03 — reload after Prescription activation: Workflow durable (ACTIVE).
    // ================================================================
    reload();
    return PBHomeDashboardAdapter.loadHomeDashboard(ctx.player.player_id).then(function (result) {
      assert.strictEqual(result.home_dashboard.next_action.code, 'START_TRAINING', 'F-R03 workflow durably ACTIVE survives reload (next_action is now START_TRAINING)');
    });
  }).then(function () {

    // ================================================================
    // F-R04 — reload during an active Guided Session: the in-memory-only
    // active session is honestly lost, never fabricated as "resumed".
    // Exercised on a disposable second registration/workflow so this
    // deliberately-abandoned session (per js/guided-training-ui.js's own
    // SESSION_LOST mode, there is no restart path for an IN_PROGRESS
    // workflow whose execution was lost — an already-accepted, frozen
    // limitation, not a defect) never blocks the main lane's R5..R8 checks.
    // ================================================================
    return PBStore.createPlayer('S11-F Reload QA Player (R4 lane)').then(function (player2) {
      return PBStore.createAssessment({ player_id: player2.player_id, assessment_tier: 'lite', target_training_level: 4.0 }).then(function (assessment2) {
        return PBMatchObservation.createMatchSession({ assessment_id: assessment2.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF' } });
      }).then(function (session2) {
        var chain = Promise.resolve();
        for (var i = 1; i <= 8; i++) {
          (function (i) {
            chain = chain.then(function () {
              return PBMatchObservation.addRallyObservation(session2.test_session_id, baseRally({ game_number: 1, rally_number: i, shot: 'drop', quality: 'error', result: 'ue' }));
            });
          })(i);
        }
        return chain.then(function () {
          return PBDiagnosis.diagnoseMatch(session2.test_session_id, player2.player_id);
        }).then(function (diagnosis2) {
          var recResult2 = PBRecommendationPriority.prioritizeDiagnosis(diagnosis2);
          var primary2 = recResult2.recommendations.filter(function (r) { return r.rank === 1; })[0];
          var rxResult2 = PBTrainingPrescription.prescribeRecommendations(recResult2);
          var matching2 = rxResult2.prescriptions.filter(function (p) { return p.source_recommendation_id === primary2.recommendation_id; })[0];
          return PBDecisionCycleRegistration.registerDecisionCycle({
            player_id: player2.player_id, source_match_session_id: session2.test_session_id,
            recommendation: primary2, prescription: matching2
          });
        }).then(function (registration2) {
          return PBGuidedTrainingController.activatePrescription({ workflow_id: registration2.prescription_workflow.workflow_id }).then(function () {
            return PBGuidedTrainingController.startTraining({ workflow_id: registration2.prescription_workflow.workflow_id });
          }).then(function () {
            reload();
            return PBGuidedTrainingController.resolveSessionState({ workflow_id: registration2.prescription_workflow.workflow_id }).then(function (state) {
              assert.strictEqual(state.state, 'ACTIVE_SESSION_LOST', 'F-R04 active session honestly reported lost after reload');
              assert.strictEqual(state.session_execution, null, 'F-R04 no fabricated resumed session_execution');
              assert.strictEqual(PBGuidedTrainingController.getActiveSession(), null, 'F-R04 no in-memory active session survives reload');
            });
          });
        });
      });
    });
  }).then(function () {

    // Main lane resumes: Start Training and complete the session in one uninterrupted run (no
    // reload mid-session — matches the real, working path a user who doesn't reload mid-session
    // takes; F-R04 above already proved the honest-loss behavior for the case where they do).
    return PBGuidedTrainingController.startTraining({ workflow_id: ctx.workflow_id }).then(function (out) {
      ctx.session_execution = out.session_execution;
      return PBGuidedTrainingController.completeSession({ attempts: 12, successful_attempts: 9, development_cycle_id: ctx.cycle_id });
    }).then(function (out) {
      ctx.completion = out;
    });
  }).then(function () {

    // ================================================================
    // F-R05 — reload after Session completion: Result/Evidence survive.
    // ================================================================
    reload();
    return Promise.all([
      PBStore.getSessionResult(ctx.completion.session_result.session_id),
      PBStore.getTrainingEvidence(ctx.completion.evidence.evidence_id)
    ]).then(function (r) {
      assert.ok(r[0], 'F-R05 Session Result survives reload');
      assert.ok(r[1], 'F-R05 TRAINING Evidence survives reload');
      assert.strictEqual(r[1].source, 'TRAINING', 'F-R05 evidence source remains TRAINING after reload');
    });
  }).then(function () {

    // ================================================================
    // F-R06 — reload, Progress reconstructs (real S11-D production reader,
    // no crash; honest BASELINE_UNRESOLVED accepted, no fabricated numbers).
    // ================================================================
    reload();
    return PBProgressReassessmentAdapter.loadProgressReassessment(ctx.player.player_id).then(function (result) {
      var p = result.progress_reassessment;
      assert.ok(p, 'F-R06 Progress view reconstructs without crashing after reload');
      assert.ok(p.training_progress, 'F-R06 training_progress reconstructs');
      assert.ok(p.match_transfer, 'F-R06 match_transfer reconstructs');
    });
  }).then(function () {

    // ================================================================
    // F-R07 — reload at REASSESSMENT_READY: reassessment state survives.
    // ================================================================
    reload();
    return PBHomeDashboardAdapter.loadHomeDashboard(ctx.player.player_id).then(function (result) {
      var home = result.home_dashboard;
      assert.strictEqual(home.journey.stage, 'READY_TO_REASSESS', 'F-R07 REASSESSMENT_READY state survives reload');
      assert.strictEqual(home.next_action.code, 'RECORD_REAL_MATCH', 'F-R07 RECORD_REAL_MATCH next_action survives reload');
    });
  }).then(function () {

    // ================================================================
    // F-R08 — reload on the History page: timeline reconstructs; repeated
    // rendering creates nothing.
    // ================================================================
    reload();
    return PBHistoryExplainabilityAdapter.loadHistoryExplainability(ctx.player.player_id).then(function (result) {
      var history = result.history_explainability;
      var cycleView = history.cycles.filter(function (c) { return c.cycle_id === ctx.cycle_id; })[0];
      assert.ok(cycleView, 'F-R08 current cycle timeline reconstructs after reload');
      assert.ok(cycleView.timeline.length > 0, 'F-R08 timeline is non-empty');
      assert.strictEqual(history.integrity_flags.indexOf('ORPHAN_WORKFLOW_REF'), -1, 'F-R08 no ORPHAN_WORKFLOW_REF after reload');
      return Promise.all([
        PBStore.listDevelopmentCyclesByPlayer(ctx.player.player_id),
        PBStore.listPrescriptionWorkflowsByPlayer(ctx.player.player_id),
        PBStore.listTrainingEvidenceByPlayer(ctx.player.player_id)
      ]);
    }).then(function (before) {
      // Render History twice more in a row — read-side only, must create nothing.
      return PBHistoryExplainabilityAdapter.loadHistoryExplainability(ctx.player.player_id)
        .then(function () { return PBHistoryExplainabilityAdapter.loadHistoryExplainability(ctx.player.player_id); })
        .then(function () {
          return Promise.all([
            PBStore.listDevelopmentCyclesByPlayer(ctx.player.player_id),
            PBStore.listPrescriptionWorkflowsByPlayer(ctx.player.player_id),
            PBStore.listTrainingEvidenceByPlayer(ctx.player.player_id)
          ]);
        }).then(function (after) {
          assert.strictEqual(after[0].length, before[0].length, 'F-R08 repeated History render creates no new Development Cycle');
          assert.strictEqual(after[1].length, before[1].length, 'F-R08 repeated History render creates no new Prescription Workflow');
          assert.strictEqual(after[2].length, before[2].length, 'F-R08 repeated History render creates no new TRAINING Evidence');
        });
    });
  }).then(function () {

    console.log('s11-reload-recovery.test.js: F-R01..F-R08 all assertions passed');
  });
}

run().catch(function (err) {
  console.error('s11-reload-recovery.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
