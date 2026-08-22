/* tests/s11-full-product-journey.test.js — S11-F: End-to-End Product Journey
 * Run: node tests/s11-full-product-journey.test.js
 *
 * Drives the real, accepted production API surface (S9 -> S10 -> S11-A/B/C/D/E)
 * through one continuous player journey, exactly as a real user's actions would
 * exercise it (Review's "Use This Training Plan" -> HOME -> Guided Training ->
 * Progress -> History) — no DevTools/browser-console creation of Development
 * Cycle / Prescription Workflow / Session Result / Training Evidence / Progress
 * / Reassessment records (per the frozen S11-F package's Hard QA Rule). Every
 * one of those is produced by calling the same production entry points the
 * real browser UI calls. js/review-ui.js's click handler and
 * js/guided-training-ui.js's click handlers are DOM-mount code, deliberately
 * untested in Node per this repo's established convention (see this file's
 * sibling test files' own top comments) — the real button click was verified
 * separately via manual browser QA (see docs/S11-F-END-TO-END-PRODUCT-QA.md).
 */
var assert = require('assert');
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

function freshRuntime() {
  MODULES.forEach(function (pair) {
    delete require.cache[require.resolve(pair[0])];
    global[pair[1]] = require(pair[0]);
  });
}

freshRuntime();

// Same real-world-shaped rally fixture js/diagnosis-engine.test.js's own accepted "A. Valid Skill
// Gap" integration test uses — 8x drop/error/ue rallies clear S9-C's evidence-confidence gate and
// deterministically produce real skill gaps (verified end-to-end in manual browser QA too).
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

    // ================================================================
    // F-T01 — player setup
    // ================================================================
    return PBStore.createPlayer('S11-F QA Player').then(function (player) {
      ctx.player = player;
      assert.ok(player.player_id, 'F-T01 player created');
    });
  }).then(function () {

    // ================================================================
    // F-T02 — durable Match: real Match Observation session, persisted via the
    // real S9-A production API. No TRAINING Evidence must exist merely because
    // a Match was saved.
    // ================================================================
    return PBStore.createAssessment({ player_id: ctx.player.player_id, assessment_tier: 'lite', target_training_level: 4.0 }).then(function (assessment) {
      ctx.assessment = assessment;
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
      return PBStore.get('test_sessions', ctx.match_session.test_session_id);
    }).then(function (persisted) {
      assert.ok(persisted, 'F-T02 match session durable');
      return PBStore.listTrainingEvidenceByPlayer(ctx.player.player_id);
    }).then(function (evidence) {
      assert.deepStrictEqual(evidence, [], 'F-T02 no TRAINING Evidence exists merely because a Match was saved');
    });
  }).then(function () {

    // ================================================================
    // F-T03 — Diagnosis: S9 can consume the durable match (real production API).
    // ================================================================
    return PBDiagnosis.diagnoseMatch(ctx.match_session.test_session_id, ctx.player.player_id).then(function (diagnosis) {
      ctx.diagnosis = diagnosis;
      assert.ok(diagnosis.skill_gaps.length > 0, 'F-T03 real Diagnosis produced skill gaps');
    });
  }).then(function () {

    // ================================================================
    // F-T04 — Recommendation: primary Recommendation exists, rank preserved
    // (never recomputed outside S9).
    // ================================================================
    var recResult = PBRecommendationPriority.prioritizeDiagnosis(ctx.diagnosis);
    ctx.recResult = recResult;
    assert.ok(recResult.recommendations.length > 0, 'F-T04 recommendations produced');
    var primary = recResult.recommendations.filter(function (r) { return r.rank === 1; })[0];
    assert.ok(primary, 'F-T04 primary (rank 1) recommendation exists');
    ctx.primaryRecommendation = primary;
  }).then(function () {

    // ================================================================
    // F-T05 — Prescription: matching Prescription exists,
    // source_recommendation_id matches the Recommendation.
    // ================================================================
    var rxResult = PBTrainingPrescription.prescribeRecommendations(ctx.recResult);
    ctx.rxResult = rxResult;
    var matching = rxResult.prescriptions.filter(function (p) { return p.source_recommendation_id === ctx.primaryRecommendation.recommendation_id; })[0];
    assert.ok(matching, 'F-T05 matching Prescription exists for the primary Recommendation');
    ctx.primaryPrescription = matching;
  }).then(function () {

    // ================================================================
    // F-T06 — Registration: exercise the accepted production path
    // (Review -> "Use This Training Plan" -> PBDecisionCycleRegistration).
    // ================================================================
    return PBDecisionCycleRegistration.registerDecisionCycle({
      player_id: ctx.player.player_id,
      source_match_session_id: ctx.match_session.test_session_id,
      recommendation: ctx.primaryRecommendation,
      prescription: ctx.primaryPrescription
    }).then(function (result) {
      ctx.registration = result;
      assert.strictEqual(result.was_existing, false, 'F-T06 freshly registered');
    });
  }).then(function () {

    // ================================================================
    // F-T07 — Cycle PRESCRIPTION_READY
    // ================================================================
    assert.strictEqual(ctx.registration.development_cycle.state, 'PRESCRIPTION_READY', 'F-T07 cycle PRESCRIPTION_READY');
    ctx.cycle_id = ctx.registration.development_cycle.cycle_id;
  }).then(function () {

    // ================================================================
    // F-T08 — Workflow DRAFTED + full lineage
    // ================================================================
    var cycle = ctx.registration.development_cycle, workflow = ctx.registration.prescription_workflow;
    assert.strictEqual(workflow.state, 'DRAFTED', 'F-T08 workflow DRAFTED');
    assert.ok(cycle.recommendation_refs.indexOf(ctx.primaryRecommendation.recommendation_id) !== -1, 'F-T08 cycle.recommendation_refs contains recommendation_id');
    assert.ok(cycle.prescription_refs.indexOf(ctx.primaryPrescription.prescription_id) !== -1, 'F-T08 cycle.prescription_refs contains prescription_id');
    assert.strictEqual(workflow.recommendation_ref, ctx.primaryRecommendation.recommendation_id, 'F-T08 workflow.recommendation_ref matches recommendation_id');
    assert.strictEqual(workflow.prescription_ref, ctx.primaryPrescription.prescription_id, 'F-T08 workflow.prescription_ref matches prescription_id');
    ctx.workflow_id = workflow.workflow_id;
  }).then(function () {

    // ================================================================
    // Registration idempotency: repeat identical registration -> one Cycle,
    // one Workflow, same IDs reused, no duplicate.
    // ================================================================
    return PBDecisionCycleRegistration.registerDecisionCycle({
      player_id: ctx.player.player_id,
      source_match_session_id: ctx.match_session.test_session_id,
      recommendation: ctx.primaryRecommendation,
      prescription: ctx.primaryPrescription
    }).then(function (replay) {
      assert.strictEqual(replay.was_existing, true, 'registration replay reports was_existing');
      assert.strictEqual(replay.development_cycle.cycle_id, ctx.cycle_id, 'replay reuses the same cycle_id');
      assert.strictEqual(replay.prescription_workflow.workflow_id, ctx.workflow_id, 'replay reuses the same workflow_id');
      return Promise.all([
        PBStore.listDevelopmentCyclesByPlayer(ctx.player.player_id),
        PBStore.listPrescriptionWorkflowsByPlayer(ctx.player.player_id)
      ]);
    }).then(function (r) {
      assert.strictEqual(r[0].length, 1, 'no duplicate Development Cycle created by replay');
      assert.strictEqual(r[1].length, 1, 'no duplicate Prescription Workflow created by replay');
    });
  }).then(function () {

    // ================================================================
    // F-T09 — S11-A ACTIVATE_PRESCRIPTION: real production reader
    // (js/home-dashboard-adapter.js), reads only what is durably persisted.
    // ================================================================
    return PBHomeDashboardAdapter.loadHomeDashboard(ctx.player.player_id).then(function (result) {
      var home = result.home_dashboard;
      assert.strictEqual(home.journey.stage, 'READY_TO_TRAIN', 'F-T09 stage READY_TO_TRAIN, never NEEDS_ASSESSMENT');
      assert.strictEqual(home.next_action.code, 'ACTIVATE_PRESCRIPTION', 'F-T09 next_action ACTIVATE_PRESCRIPTION');
      assert.strictEqual(home.next_action.target_ref, ctx.workflow_id, 'F-T09 next_action.target_ref = workflow_id');
      assert.strictEqual(home.next_action.enabled, true, 'F-T09 exactly one enabled primary CTA');
    });
  }).then(function () {

    // ================================================================
    // F-T10 — Activate (real S11-C production path)
    // ================================================================
    return PBGuidedTrainingController.activatePrescription({ workflow_id: ctx.workflow_id }).then(function (out) {
      assert.strictEqual(out.workflow.state, 'ACTIVE', 'F-T10 workflow ACTIVE');
    });
  }).then(function () {

    // ================================================================
    // F-T11 — Start Training (real S11-C production path)
    // ================================================================
    return PBGuidedTrainingController.startTraining({ workflow_id: ctx.workflow_id }).then(function (out) {
      assert.strictEqual(out.workflow.state, 'IN_PROGRESS', 'F-T11 workflow IN_PROGRESS');
      assert.strictEqual(out.session_execution.state, 'ACTIVE', 'F-T11 session execution ACTIVE');
      ctx.session_execution = out.session_execution;
    });
  }).then(function () {

    // ================================================================
    // F-T12 — Session Execution (in-memory, per S11-C's own documented,
    // frozen "no persisted active session" limitation).
    // ================================================================
    var active = PBGuidedTrainingController.getActiveSession();
    assert.ok(active, 'F-T12 in-memory active session set');
    assert.strictEqual(active.session_execution.session_id, ctx.session_execution.session_id, 'F-T12 in-memory session execution matches Start Training result');
  }).then(function () {

    // ================================================================
    // F-T13 — Session Result durable (real S11-C completeSession -> S10-D-R1)
    // ================================================================
    return PBGuidedTrainingController.completeSession({ attempts: 10, successful_attempts: 7, development_cycle_id: ctx.cycle_id }).then(function (out) {
      ctx.completion = out;
      assert.strictEqual(out.session_result.session_id, ctx.session_execution.session_id, 'F-T13 session result matches the completed execution');
      return PBStore.getSessionResult(out.session_result.session_id);
    }).then(function (persisted) {
      assert.ok(persisted, 'F-T13 Session Result durable');
    });
  }).then(function () {

    // ================================================================
    // F-T14 — TRAINING Evidence durable, source TRAINING (never MATCH)
    // ================================================================
    assert.strictEqual(ctx.completion.evidence.source, 'TRAINING', 'F-T14 evidence source is TRAINING');
    return PBStore.getTrainingEvidence(ctx.completion.evidence.evidence_id).then(function (persisted) {
      assert.ok(persisted, 'F-T14 TRAINING Evidence durable');
    });
  }).then(function () {

    // ================================================================
    // F-T15 — Cycle evidence link: Session Result -> Evidence ->
    // Development Cycle.evidence_refs
    // ================================================================
    assert.ok(ctx.completion.development_cycle.evidence_refs.indexOf(ctx.completion.evidence.evidence_id) !== -1, 'F-T15 cycle.evidence_refs contains the new evidence_id');
    ctx.cycle_state_after_session = ctx.completion.development_cycle.state;
  }).then(function () {

    // ================================================================
    // Session idempotency: replay same completion payload -> same Session
    // Result/Evidence, no duplicate. Conflicting payload -> DUPLICATE_FINALIZATION.
    // ================================================================
    return PBSessionEvidencePersistence.completeSessionDurable({
      session_execution: ctx.session_execution, attempts: 10, successful_attempts: 7, development_cycle_id: ctx.cycle_id
    }).then(function (replay) {
      assert.strictEqual(replay.evidence.evidence_id, ctx.completion.evidence.evidence_id, 'identical replay reuses the same Evidence, no duplicate');
      return PBStore.listTrainingEvidenceByPlayer(ctx.player.player_id);
    }).then(function (all) {
      assert.strictEqual(all.length, 1, 'no duplicate TRAINING Evidence created by replay');
    }).then(function () {
      return assertThrows(
        PBSessionEvidencePersistence.completeSessionDurable({ session_execution: ctx.session_execution, attempts: 10, successful_attempts: 2, development_cycle_id: ctx.cycle_id }),
        'conflicting completion payload', 'DUPLICATE_FINALIZATION'
      );
    });
  }).then(function () {

    // ================================================================
    // F-T16 — Progress: real S11-D production reader
    // (js/progress-reassessment-adapter.js). Baseline/Current/Delta/Trend/
    // Evidence Count fields are always present; honest BASELINE_UNRESOLVED
    // (no fabricated numbers) is an accepted PASS state — this repo has no
    // production caller for captureBaselineDurable yet (documented known
    // limitation, non-blocking; see docs/S11-F-END-TO-END-PRODUCT-QA.md).
    // ================================================================
    return PBProgressReassessmentAdapter.loadProgressReassessment(ctx.player.player_id).then(function (result) {
      ctx.progressView = result.progress_reassessment;
      assert.ok(ctx.progressView, 'F-T16 Progress view composed without crashing');
      assert.ok(ctx.progressView.training_progress, 'F-T16 training_progress present');
      ['status', 'baseline', 'current', 'delta', 'trend', 'evidence_count'].forEach(function (f) {
        assert.ok(Object.prototype.hasOwnProperty.call(ctx.progressView.training_progress, f), 'F-T16 training_progress.' + f + ' present');
      });
    });
  }).then(function () {

    // ================================================================
    // F-T17 — TRAINING / MATCH separation: two independent fields; MATCH
    // is never fabricated when no MATCH KPI-aligned evidence exists.
    // ================================================================
    var p = ctx.progressView;
    assert.notStrictEqual(p.training_progress, p.match_transfer, 'F-T17 training_progress and match_transfer are independent objects');
    assert.ok(p.match_transfer, 'F-T17 match_transfer field present');
    assert.strictEqual(p.match_transfer.numeric_progress, null, 'F-T17 no fabricated MATCH numeric progress');
    assert.notStrictEqual(p.match_transfer.status, 'RESOLVED', 'F-T17 MATCH never silently marked RESOLVED without real MATCH-aligned evidence');
  }).then(function () {

    // ================================================================
    // F-T18 — Reassessment precedence: S10-A's own frozen Rule 5 (new
    // evidence after a recommendation always makes the cycle
    // reassessment-eligible) means the cycle reaches REASSESSMENT_READY
    // immediately once the completed session's evidence is added — verify
    // S11-A honors precedence over START_TRAINING/CONTINUE_TRAINING.
    // ================================================================
    assert.strictEqual(ctx.cycle_state_after_session, 'REASSESSMENT_READY', 'F-T18 precondition: cycle reached REASSESSMENT_READY');
    return PBHomeDashboardAdapter.loadHomeDashboard(ctx.player.player_id).then(function (result) {
      var home = result.home_dashboard;
      assert.strictEqual(home.journey.stage, 'READY_TO_REASSESS', 'F-T18 stage READY_TO_REASSESS');
      assert.strictEqual(home.next_action.code, 'RECORD_REAL_MATCH', 'F-T18 next_action RECORD_REAL_MATCH');
      assert.notStrictEqual(home.next_action.code, 'START_TRAINING', 'F-T18 never START_TRAINING while reassessment is required');
      assert.notStrictEqual(home.next_action.code, 'CONTINUE_TRAINING', 'F-T18 never CONTINUE_TRAINING while reassessment is required');
    });
  }).then(function () {

    // ================================================================
    // F-T19 — History lineage: real S11-E production reader
    // (js/history-explainability-adapter.js).
    // ================================================================
    return PBHistoryExplainabilityAdapter.loadHistoryExplainability(ctx.player.player_id).then(function (result) {
      ctx.history = result.history_explainability;
      var cycleView = ctx.history.cycles.filter(function (c) { return c.cycle_id === ctx.cycle_id; })[0];
      assert.ok(cycleView, 'F-T19 current cycle present in History');
      var types = cycleView.timeline.map(function (e) { return e.type; });
      ['CYCLE_CREATED', 'PRESCRIPTION_WORKFLOW_CREATED', 'TRAINING_EVIDENCE_RECORDED'].forEach(function (t) {
        assert.ok(types.indexOf(t) !== -1, 'F-T19 timeline contains ' + t);
      });
      assert.ok(cycleView.workflow_summary, 'F-T19 workflow_summary (Prescription Workflow lineage) present');
    });
  }).then(function () {

    // ================================================================
    // F-T20 — current production-created workflow: no ORPHAN_WORKFLOW_REF
    // (hard gate — this is exactly the finding S11-F0-R1 was built to fix).
    // ================================================================
    assert.strictEqual(ctx.history.integrity_flags.indexOf('ORPHAN_WORKFLOW_REF'), -1, 'F-T20 no ORPHAN_WORKFLOW_REF for the production-created workflow');
  }).then(function () {

    // ================================================================
    // F-T21..F-T26 — S11-F-R1 / Acceptance Gate F19: Real Match reassessment
    // path, completed end-to-end. Continues the journey from
    // READY_TO_REASSESS / RECORD_REAL_MATCH (F-T18): a second real Match
    // Observation is recorded and run through the exact same, unmodified S9
    // Diagnosis -> Recommendation/Priority -> Training Prescription chain —
    // no new decision logic, only the existing S9 production APIs already
    // exercised by F-T02..F-T05. Verifies the second match's decision output
    // is genuinely independent of the first, and that nothing about the
    // original (now-REASSESSMENT_READY) cycle's durable state is disturbed
    // by simply running S9 again.
    // ================================================================
    return PBStore.createAssessment({ player_id: ctx.player.player_id, assessment_tier: 'lite', target_training_level: 4.0 }).then(function (assessment2) {
      return PBMatchObservation.createMatchSession({ assessment_id: assessment2.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF' } });
    }).then(function (session2) {
      ctx.match_session_2 = session2;
      // F-T21: new match_id != original match_id.
      assert.notStrictEqual(session2.test_session_id, ctx.match_session.test_session_id, 'F-T21 second Match Observation has a distinct match_id from the original');
      var chain = Promise.resolve();
      // A different rally shape (net/error/ue on 'drive') from the original ('drop'/error/ue)
      // so the second match is genuinely distinct evidence, not a byte-for-byte replay.
      for (var i = 1; i <= 8; i++) {
        (function (i) {
          chain = chain.then(function () {
            return PBMatchObservation.addRallyObservation(session2.test_session_id, baseRally({ game_number: 1, rally_number: i, shot: 'drive', quality: 'error', result: 'ue' }));
          });
        })(i);
      }
      return chain;
    }).then(function () {
      return PBDiagnosis.diagnoseMatch(ctx.match_session_2.test_session_id, ctx.player.player_id);
    }).then(function (diagnosis2) {
      assert.ok(diagnosis2.skill_gaps.length > 0, 'F-T22 second real Diagnosis produced skill gaps (existing S9 API, no new logic)');
      var recResult2 = PBRecommendationPriority.prioritizeDiagnosis(diagnosis2);
      var primary2 = recResult2.recommendations.filter(function (r) { return r.rank === 1; })[0];
      assert.ok(primary2, 'F-T23 second primary Recommendation exists');
      // F-T23: new Recommendation lineage belongs to the second Match (recommendation_id is
      // deterministically derived from its own source match_id — never the first match's).
      assert.ok(primary2.recommendation_id.indexOf(ctx.match_session_2.test_session_id) !== -1, 'F-T23 new Recommendation lineage references the second match_id');
      assert.notStrictEqual(primary2.recommendation_id, ctx.primaryRecommendation.recommendation_id, 'F-T23 new Recommendation is distinct from the original');
      ctx.primaryRecommendation2 = primary2;

      var rxResult2 = PBTrainingPrescription.prescribeRecommendations(recResult2);
      var matching2 = rxResult2.prescriptions.filter(function (p) { return p.source_recommendation_id === primary2.recommendation_id; })[0];
      // F-T24: new Prescription belongs to the new Recommendation.
      assert.ok(matching2, 'F-T24 matching Prescription exists for the second Recommendation');
      assert.strictEqual(matching2.source_recommendation_id, primary2.recommendation_id, 'F-T24 new Prescription.source_recommendation_id matches the new Recommendation');
      assert.notStrictEqual(matching2.prescription_id, ctx.primaryPrescription.prescription_id, 'F-T24 new Prescription is distinct from the original');
      ctx.primaryPrescription2 = matching2;
    }).then(function () {
      // F-T25: old TRAINING Evidence remains unchanged by simply running S9 again.
      return PBStore.getTrainingEvidence(ctx.completion.evidence.evidence_id).then(function (persisted) {
        assert.ok(persisted, 'F-T25 original TRAINING Evidence still durable');
        assert.deepStrictEqual(persisted, ctx.completion.evidence, 'F-T25 original TRAINING Evidence byte-for-byte unchanged');
      });
    }).then(function () {
      // F-T26: old cycle/history remains intact; no old recommendation is overwritten.
      return PBStore.getDevelopmentCycle(ctx.cycle_id).then(function (persistedCycle) {
        assert.strictEqual(persistedCycle.state, 'REASSESSMENT_READY', 'F-T26 original cycle state unchanged by running S9 again');
        assert.deepStrictEqual(persistedCycle.recommendation_refs, [ctx.primaryRecommendation.recommendation_id], 'F-T26 original cycle.recommendation_refs not overwritten by the second match\'s recommendation');
        assert.deepStrictEqual(persistedCycle.prescription_refs, [ctx.primaryPrescription.prescription_id], 'F-T26 original cycle.prescription_refs not overwritten by the second match\'s prescription');
        return PBHistoryExplainabilityAdapter.loadHistoryExplainability(ctx.player.player_id);
      }).then(function (result) {
        var cycleView = result.history_explainability.cycles.filter(function (c) { return c.cycle_id === ctx.cycle_id; })[0];
        assert.ok(cycleView, 'F-T26 original cycle still present in History after the second match');
        assert.deepStrictEqual(cycleView.timeline, ctx.history.cycles.filter(function (c) { return c.cycle_id === ctx.cycle_id; })[0].timeline, 'F-T26 original cycle\'s timeline unchanged by the second match (no new registration was performed)');
        assert.strictEqual(result.history_explainability.integrity_flags.indexOf('ORPHAN_WORKFLOW_REF'), -1, 'F-T26 still no ORPHAN_WORKFLOW_REF after the second match');
      });
    });
  }).then(function () {

    console.log('s11-full-product-journey.test.js: F-T01..F-T26 (incl. F19 second Real Match reassessment path) all assertions passed');
  });
}

run().catch(function (err) {
  console.error('s11-full-product-journey.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
