/* tests/s10-final-acceptance.test.js — S10-FINAL: Full-System Product
 * Acceptance QA.
 *
 * Validates that S10-A through S10-F form one coherent, truthful,
 * durable, regression-safe Product Workflow. Adds no product logic —
 * every check either re-confirms an already-accepted contract against
 * real engines/real persistence, or performs a structural scan for
 * architecture-invariant violations. Where a check is a re-confirmation
 * of ground tests/s10-f-cross-workflow-qa.test.js already covers in
 * depth, this file performs its own independent instance of that check
 * (fresh fixtures, fresh runtime) rather than importing that file, so
 * this suite stands alone as the final regression artifact.
 *
 * Run: node tests/s10-final-acceptance.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var createFakeIndexedDB = require('./fake-indexeddb');

var ROOT = path.join(__dirname, '..');
function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); }

function assertRejects(promise, label, expectedCode) {
  return promise.then(function () {
    throw new Error(label + ' should have rejected but resolved');
  }, function (e) {
    assert.ok(e instanceof Error, label + ' rejects with an Error');
    if (expectedCode) assert.strictEqual(e.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + e.code + ')');
  });
}

var fakeIDB = createFakeIndexedDB();
global.indexedDB = fakeIDB;

function freshRuntime() {
  ['namespace', 'storage', 'match-observation-engine', 'performance-analysis-engine', 'diagnosis-engine',
   'recommendation-priority-engine', 'training-prescription-engine', 'workflow-integration-engine',
   'dashboard-integration-engine', 'prescription-workflow-engine', 'session-evidence-engine', 'session-evidence-persistence',
   'cycle-baseline-engine', 'progress-tracking-engine', 'reassessment-engine', 'progress-reassessment-persistence',
   'review-engine'
  ].forEach(function (mod) { delete require.cache[require.resolve('../js/' + mod + '.js')]; });
  global.PBNamespace = require('../js/namespace.js');
  global.PBStore = require('../js/storage.js');
  global.PBMatchObservation = require('../js/match-observation-engine.js');
  global.PBPerformanceAnalysis = require('../js/performance-analysis-engine.js');
  global.PBDiagnosis = require('../js/diagnosis-engine.js');
  global.PBRecommendationPriority = require('../js/recommendation-priority-engine.js');
  global.PBTrainingPrescription = require('../js/training-prescription-engine.js');
  global.PBWorkflow = require('../js/workflow-integration-engine.js');
  global.PBDashboard = require('../js/dashboard-integration-engine.js');
  global.PBPrescriptionWorkflow = require('../js/prescription-workflow-engine.js');
  global.PBSessionEvidence = require('../js/session-evidence-engine.js');
  global.PBSessionEvidencePersistence = require('../js/session-evidence-persistence.js');
  global.PBCycleBaseline = require('../js/cycle-baseline-engine.js');
  global.PBProgressTracking = require('../js/progress-tracking-engine.js');
  global.PBReassessment = require('../js/reassessment-engine.js');
  global.PBProgressReassessmentPersistence = require('../js/progress-reassessment-persistence.js');
  global.PBReview = require('../js/review-engine.js');
}
freshRuntime();

function baseRally(overrides) {
  return Object.assign({
    game_number: 1, rally_number: 1, phase: 'transition', intent: 'neutralize', shot: 'reset',
    target: 'middle', quality: 'good', movement: 'balanced', result: 'continue', control_state: 'neutral'
  }, overrides || {});
}
function seedMatchSession(hint) {
  return PBStore.createPlayer(hint || 'S10-FINAL QA Player').then(function (player) {
    return PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 }).then(function (assessment) {
      return PBMatchObservation.createMatchSession({ assessment_id: assessment.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF' } })
        .then(function (session) { return { player: player, assessment: assessment, session: session }; });
    });
  });
}
function seedMatchSessionForPlayer(player) {
  return PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 }).then(function (assessment) {
    return PBMatchObservation.createMatchSession({ assessment_id: assessment.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF' } })
      .then(function (session) { return { player: player, assessment: assessment, session: session }; });
  });
}
function addRallies(session_id, rallies) {
  var chain = Promise.resolve();
  rallies.forEach(function (r) { chain = chain.then(function () { return PBMatchObservation.addRallyObservation(session_id, baseRally(r)); }); });
  return chain;
}
function seedFailedDropMatch(ctx) {
  var rallies = [];
  for (var i = 1; i <= 8; i++) rallies.push({ game_number: 1, rally_number: i, shot: 'drop', quality: 'error', result: 'continue' });
  return addRallies(ctx.session.test_session_id, rallies).then(function () { return ctx; });
}
function seedSecondMatch(ctx) {
  var rallies = [];
  for (var i = 1; i <= 6; i++) rallies.push({ game_number: 1, rally_number: i, shot: 'drop', quality: 'error', result: 'continue' });
  for (var j = 7; j <= 8; j++) rallies.push({ game_number: 1, rally_number: j, shot: 'drop', quality: 'good', result: 'winner' });
  return addRallies(ctx.session.test_session_id, rallies).then(function () { return ctx; });
}

var gates = {};
function gate(id, fn) {
  return Promise.resolve().then(fn).then(function () { gates[id] = true; }).catch(function (e) { gates[id] = false; throw e; });
}

function run() {
  var J = {}; // Product Journey shared context

  return PBStore.open()

    // ================================================================
    // FA02 — MASTER CONTROL ledger consistency (read the real file).
    // ================================================================
    .then(function () { return gate('FA02', function () {
      var mc = readSrc('docs/MASTER-CONTROL-V2.md');
      var expected = {
        'S10-A': 'bd96b6c', 'S10-B': '4426250', 'S10-C': 'ca3e732',
        'S10-D': '920eea4', 'S10-E': '3050b1f', 'S10-F': '947b41d'
      };
      Object.keys(expected).forEach(function (stage) {
        var re = new RegExp(stage.replace('-', '\\-') + '\\s*\\nStatus: CLOSED / ACCEPTED\\s*\\nAcceptance Commit: ' + expected[stage]);
        assert.ok(re.test(mc), 'MASTER CONTROL records ' + stage + ' CLOSED/ACCEPTED @ ' + expected[stage]);
      });
      assert.ok(mc.indexOf('Blocking Audit Commit: 08de42a') !== -1, 'S10-E historical BLOCKED audit preserved');
      assert.ok(mc.indexOf('KNOWN LIMITATION — MATCH PROGRESS') !== -1, 'known MATCH limitation preserved');
      // Post GPT Independent Final Acceptance (S11-A-R1): S10-FINAL/S10 are now legitimately
      // CLOSED / ACCEPTED at 4024f67 — the prior "FINAL QA IN PROGRESS" transient-state
      // assertion is obsolete and is replaced with the final accepted governance state.
      var s10FinalRe = /S10-FINAL\s*\nStatus: CLOSED \/ ACCEPTED\s*\nAcceptance Commit: 4024f67\s*\nFull SHA: 4024f6773122a1b047605c583addb4ea07d84b18\s*\nAcceptance Record: docs\/S10-FINAL-ACCEPTANCE\.md/;
      assert.ok(s10FinalRe.test(mc), 'S10-FINAL correctly recorded as CLOSED / ACCEPTED @ 4024f67');
      var s10Re = /S10\s*\nStatus: CLOSED \/ ACCEPTED\s*\nFinal Acceptance Commit: 4024f67\s*\nFull SHA: 4024f6773122a1b047605c583addb4ea07d84b18/;
      assert.ok(s10Re.test(mc), 'S10 overall stage correctly recorded as CLOSED / ACCEPTED @ 4024f67');
    }); })

    // ================================================================
    // FA15 — Persistence v1->v5 continuity.
    // ================================================================
    .then(function () { return gate('FA15', function () {
      assert.strictEqual(PBStore.DB_VERSION, 5);
      var expected = [
        'players', 'assessments', 'test_sessions', 'trial_events',
        'review_snapshots', 'prescriptions', 'retests',
        'training_cycles', 'weekly_plans', 'session_plans', 'session_logs', 'cycle_summaries',
        'development_cycles', 'prescription_workflows', 'session_results', 'training_evidence',
        'cycle_kpi_baselines', 'reassessments'
      ];
      assert.strictEqual(expected.length, 18);
      var storageSrc = stripComments(readSrc('js/storage.js'));
      expected.forEach(function (name) { assert.ok(storageSrc.indexOf(name + ':') !== -1, 'store declared: ' + name); });
      assert.ok(storageSrc.indexOf('deleteObjectStore') === -1, 'no destructive migration anywhere');
      assert.ok(!/DB_VERSION\s*=\s*6/.test(storageSrc), 'no DB_VERSION 6');
      var upgradeBlock = storageSrc.match(/onupgradeneeded[\s\S]*?\n  \};/)[0];
      assert.ok(/if\s*\(!db\.objectStoreNames\.contains\(name\)\)/.test(upgradeBlock), 'upgrade path only ever creates missing stores');
    }); })

    // ================================================================
    // A01/A02/A03/A04/A05/A06 — Architecture invariants, structural.
    // FA20 UI/domain separation folded in here (same forbidden-token class).
    // ================================================================
    .then(function () { return gate('FA20_AND_INVARIANTS', function () {
      var uiFiles = ['review-ui.js', 'training-ui.js'];
      var forbiddenFormulaTokens = [
        'PRIORITY_TIER_THRESHOLDS', 'DIAGNOSIS_TO_RECOMMENDATION', 'RECOMMENDATION_TO_PRESCRIPTION',
        '0.60 *', '0.40 *', 'EVIDENCE_GATE_MIN_CONFIDENCE', 'TREND_BAND', 'CAP_WEIGHTS'
      ];
      uiFiles.forEach(function (f) {
        var src = stripComments(readSrc('js/' + f));
        forbiddenFormulaTokens.forEach(function (t) { assert.ok(src.indexOf(t) === -1, 'A01: ' + f + ' must never contain scoring/mapping token "' + t + '"'); });
        assert.ok(!/\.\s*(rank|priority_score|priority_tier)\s*=[^=]/.test(src), 'A01: ' + f + ' must never assign rank/priority_score/priority_tier');
        assert.ok(!/PBWorkflow\.VALID_TRANSITIONS\s*=/.test(src), 'A08: ' + f + ' must never rewrite S10-A transition table');
      });
      var dashSrc = stripComments(readSrc('js/dashboard-integration-engine.js'));
      ['PBRecommendationPriority', 'PBTrainingPrescription', 'PBDiagnosis', 'PBStore'].forEach(function (t) {
        assert.ok(dashSrc.indexOf(t) === -1, 'A02/A07 (dashboard): dashboard-integration-engine.js must never reference ' + t);
      });
      // A02/A03/A04: distinct engines own distinct decisions — no cross-engine coupling beyond
      // each file's own documented single legitimate upstream dependency.
      // ownGlobal: the module's own UMD export name (e.g. `root.PBRecommendationPriority =
      // factory()`) — referencing itself is not coupling and must be excluded from the scan.
      var engineDeps = {
        'recommendation-priority-engine.js': { ownGlobal: 'PBRecommendationPriority', deps: ['PBDiagnosis'] },
        'training-prescription-engine.js': { ownGlobal: 'PBTrainingPrescription', deps: ['PBRecommendationPriority'] },
        'prescription-workflow-engine.js': { ownGlobal: 'PBPrescriptionWorkflow', deps: [] }, // zero-coupling by design (S10-C)
        'session-evidence-engine.js': { ownGlobal: 'PBSessionEvidence', deps: ['PBWorkflow'] }, // Rule 4 mandated bridge
        'cycle-baseline-engine.js': { ownGlobal: 'PBCycleBaseline', deps: [] },
        'progress-tracking-engine.js': { ownGlobal: 'PBProgressTracking', deps: [] },
        'reassessment-engine.js': { ownGlobal: 'PBReassessment', deps: [] }
      };
      var forbiddenAcrossAll = ['PBMatchObservation', 'PBPerformanceAnalysis', 'PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'PBPrescriptionWorkflow', 'PBDashboard', 'PBStore', 'PBWorkflow'];
      Object.keys(engineDeps).forEach(function (f) {
        var src = stripComments(readSrc('js/' + f));
        var cfg = engineDeps[f];
        forbiddenAcrossAll.forEach(function (t) {
          if (t === cfg.ownGlobal || cfg.deps.indexOf(t) !== -1) return; // self-reference or its one legitimate dependency
          assert.ok(src.indexOf(t) === -1, 'A02/A03/A04: ' + f + ' must never reference ' + t + ' (not its declared legitimate dependency)');
        });
      });
    }); })

    // ================================================================
    // A07/A08/A09/A10 — source-of-truth ownership, behavioral.
    // FA03/FA05 — S10-A/S10-C state machines remain sole authority.
    // ================================================================
    .then(function () { return gate('FA03_FA05_SOURCE_OF_TRUTH', function () {
      // A08: no shortcut state assignment anywhere outside PBWorkflow's own transition().
      var cyc = PBWorkflow.createDevelopmentCycle({ player_id: 'p_fa03', baseline_ref: 'asm_fa03' }).development_cycle;
      assert.throws(function () { PBWorkflow.transition(cyc, 'COMPLETE_CYCLE', {}); }, function (e) { return e.code === 'INVALID_INPUT'; }, 'A08: illegal transition rejected, never silently applied');
      // A09: S10-C prescription workflow remains sole authority for its own state.
      var rx = { prescription_id: 'rx_fa05', source_recommendation_id: 'rec_fa05', status: 'prescribed', priority_rank: 1, priority_score: 60, priority_tier: 'HIGH', training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION', kpi_profile_code: 'EXECUTION_SUCCESS_RATE', drill_resolution_status: 'UNRESOLVED', kpi_target_status: 'BENCHMARK_NOT_RESOLVED' };
      var wf = PBPrescriptionWorkflow.createPrescriptionWorkflow({ prescription: rx, player_id: 'p_fa05' }).prescription_workflow;
      // FA05: prescription -> workflow preserves ancestry + UNRESOLVED/BENCHMARK_NOT_RESOLVED verbatim
      assert.strictEqual(wf.prescription_ref, rx.prescription_id);
      assert.strictEqual(wf.recommendation_ref, rx.source_recommendation_id);
      assert.strictEqual(wf.player_id, 'p_fa05');
      assert.strictEqual(wf.prescription_snapshot.training_objective_code, rx.training_objective_code);
      assert.strictEqual(wf.prescription_snapshot.training_mode, rx.training_mode);
      assert.strictEqual(wf.prescription_snapshot.kpi_profile_code, rx.kpi_profile_code);
      assert.strictEqual(wf.prescription_snapshot.drill_resolution_status, 'UNRESOLVED', 'FA05: UNRESOLVED drill remains valid');
      assert.strictEqual(wf.prescription_snapshot.kpi_target_status, 'BENCHMARK_NOT_RESOLVED', 'FA05: BENCHMARK_NOT_RESOLVED remains valid');
      assert.throws(function () { PBPrescriptionWorkflow.transition(wf, 'BOGUS_ACTION', {}); }, function (e) { return e.code === 'INVALID_INPUT'; }, 'A09: illegal transition rejected');
      // A09/FA05: no S8 wrong-lineage FK coupling reintroduced
      var pwfSrc = stripComments(readSrc('js/prescription-workflow-engine.js'));
      assert.ok(pwfSrc.indexOf('training_cycles') === -1 && pwfSrc.indexOf('session_plans') === -1, 'A09: no S8 TrainingCycle/SessionPlan coupling');
    }); })

    // ================================================================
    // FA04 — S10-B dashboard contract.
    // ================================================================
    .then(function () { return gate('FA04', function () {
      var rec = { recommendation_id: 'rec_fa04', recommendation_code: 'IMPROVE_SHOT_EXECUTION', skill: 'drop', context: null, rank: 1, priority_score: 74, priority_tier: 'HIGH', status: 'recommended' };
      var item = PBDashboard.projectRecommendation({ recommendation: rec }).dashboard_item;
      assert.strictEqual(item.rank, 1); assert.strictEqual(item.priority_score, 74); assert.strictEqual(item.priority_tier, 'HIGH');
      assert.strictEqual(item.recommendation_code, 'IMPROVE_SHOT_EXECUTION');
    }); })

    // ================================================================
    // FA09 — Full Product Journey (also exercises FA06/FA07/FA08/FA10/
    // FA11/FA12/FA13/FA14/FA16/FA17/FA18 inline as it proceeds).
    // ================================================================
    .then(function () { return seedMatchSession('S10-FINAL Journey Player'); })
    .then(function (ctx) { return seedFailedDropMatch(ctx); })
    .then(function (ctx) {
      J.player = ctx.player; J.assessment = ctx.assessment; J.match1 = ctx.session;
      return gate('FA09_JOURNEY_STEP1_S9', function () {
        return PBDiagnosis.diagnoseMatch(ctx.session.test_session_id, ctx.player.player_id).then(function (diag) {
          var recResult = PBRecommendationPriority.prioritizeDiagnosis(diag);
          var rxResult = PBTrainingPrescription.prescribeRecommendations(recResult);
          J.rec = recResult.recommendations.filter(function (r) { return r.recommendation_code === 'IMPROVE_SHOT_EXECUTION'; })[0];
          J.rx = rxResult.prescriptions.filter(function (p) { return p.source_recommendation_id === J.rec.recommendation_id; })[0];
          assert.ok(J.rec && J.rx);
          // FA10: separation — distinct objects/fields, ancestry preserved, never recomputed
          assert.strictEqual(J.rx.priority_rank, J.rec.rank);
          assert.strictEqual(J.rx.priority_score, J.rec.priority_score);
          assert.strictEqual(J.rx.priority_tier, J.rec.priority_tier);
          assert.notStrictEqual(J.rec.recommendation_id, J.rx.prescription_id, 'FA10: recommendation and prescription are distinct objects, never collapsed');
        });
      });
    })
    .then(function () { return gate('FA09_JOURNEY_STEP2_WORKFLOW_SESSION', function () {
      var wf = PBPrescriptionWorkflow.createPrescriptionWorkflow({ prescription: J.rx, player_id: J.player.player_id }).prescription_workflow;
      wf = PBPrescriptionWorkflow.transition(wf, 'ACTIVATE', {});
      var startResult = PBPrescriptionWorkflow.startTraining(wf, {});
      J.workflow = startResult.workflow; J.sessionIntent = startResult.session_intent;
      return PBStore.putPrescriptionWorkflow(J.workflow).then(function () {
        var exec = PBSessionEvidence.createSessionExecution({ session_intent: J.sessionIntent, recommendation_ref: J.rx.source_recommendation_id }).session_execution;
        exec = PBSessionEvidence.transition(exec, 'START', {});
        J.sessionResult = PBSessionEvidence.completeSession(exec, { attempts: 50, successful_attempts: 38 }).session_result;
        // FA11: Session != Result != Evidence
        assert.notStrictEqual(exec.state, J.sessionResult.status, 'FA11: execution and result are distinct shapes');
        J.evidence = PBSessionEvidence.buildTrainingEvidence(J.sessionResult).evidence;
        assert.strictEqual(J.evidence.source, 'TRAINING', 'FA06: evidence source remains TRAINING');
        assert.notStrictEqual(J.sessionResult.session_id, J.evidence.evidence_id, 'FA11: result and evidence are distinct objects, no UI/session object implicitly becomes Evidence');
        return Promise.all([PBStore.putSessionResult(J.sessionResult), PBStore.putTrainingEvidence(J.evidence)]);
      });
    }); })
    .then(function () { return gate('FA09_JOURNEY_STEP3_NON_EVIDENCE_STATES', function () {
      // FA06: PARTIAL/SKIPPED/CANCELLED never masquerade as zero performance
      var exec2 = PBSessionEvidence.createSessionExecution({ session_intent: Object.assign({}, J.sessionIntent, { session_id: 'sint_fa06' }) }).session_execution;
      var skipped = PBSessionEvidence.transition(exec2, 'SKIP', {});
      assert.strictEqual(skipped.result_value, undefined, 'FA06: SKIPPED never carries a fabricated zero result_value');
      var exec3 = PBSessionEvidence.transition(PBSessionEvidence.createSessionExecution({ session_intent: Object.assign({}, J.sessionIntent, { session_id: 'sint_fa06b' }) }).session_execution, 'START', {});
      var cancelled = PBSessionEvidence.transition(exec3, 'CANCEL', {});
      assert.strictEqual(cancelled.result_value, undefined, 'FA06: CANCELLED never carries a fabricated zero result_value');
    }); })
    .then(function () { return gate('FA09_JOURNEY_STEP4_CYCLE_EVIDENCE', function () {
      var cyc = PBWorkflow.createDevelopmentCycle({ player_id: J.player.player_id, baseline_ref: J.assessment.assessment_id }).development_cycle;
      cyc = PBWorkflow.transition(cyc, 'ADD_EVIDENCE', { evidence_ref: J.evidence.evidence_id });
      assert.strictEqual(cyc.state, 'EVIDENCE_AVAILABLE');
      J.cycle = cyc;
      return PBStore.putDevelopmentCycle(J.cycle);
    }); })
    .then(function () { return gate('FA07_FA13_FA14_PROGRESS_BASELINE', function () {
      var preEvidence = { evidence_id: 'ev_fa07_pre', source: 'TRAINING', kpi: 'EXECUTION_SUCCESS_RATE', value: 0.58, player_id: J.player.player_id, timestamp: '2020-01-01T00:00:00.000Z' };
      return PBStore.putTrainingEvidence(preEvidence).then(function () {
        return PBProgressReassessmentPersistence.captureBaselineDurable({ cycle_id: J.cycle.cycle_id, player_id: J.player.player_id, kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2020-06-01T00:00:00.000Z' });
      }).then(function (baseline) {
        assert.strictEqual(baseline.tracks.TRAINING.EXECUTION_SUCCESS_RATE.value, 0.58);
        // FA13: recapture attempt with a post-start evidence must not backfill/change baseline
        var postEvidence = { evidence_id: 'ev_fa07_post', source: 'TRAINING', kpi: 'EXECUTION_SUCCESS_RATE', value: 0.99, player_id: J.player.player_id, timestamp: '2026-02-10T00:00:00.000Z' };
        return PBStore.putTrainingEvidence(postEvidence).then(function () {
          return PBProgressReassessmentPersistence.captureBaselineDurable({ cycle_id: J.cycle.cycle_id, player_id: J.player.player_id, kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2020-06-01T00:00:00.000Z' });
        });
      }).then(function (recaptured) {
        assert.strictEqual(recaptured.tracks.TRAINING.EXECUTION_SUCCESS_RATE.value, 0.58, 'FA13: baseline unchanged after new post-start evidence');
        // FA16 reload slice: baseline survives genuine reload
        freshRuntime();
        return PBStore.getCycleKpiBaseline('cb:' + J.cycle.cycle_id);
      }).then(function (reloaded) {
        assert.ok(reloaded); assert.strictEqual(reloaded.tracks.TRAINING.EXECUTION_SUCCESS_RATE.value, 0.58);
        // FA14: frozen progress math example, exact
        var s = PBProgressTracking.computeProgressSnapshot({
          cycle_id: J.cycle.cycle_id, player_id: J.player.player_id, kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'TRAINING',
          baseline_entry: reloaded.tracks.TRAINING.EXECUTION_SUCCESS_RATE,
          in_cycle_evidence: [{ evidence_id: 'ev_cur', source: 'TRAINING', kpi: 'EXECUTION_SUCCESS_RATE', player_id: J.player.player_id, value: 0.71, timestamp: '2020-07-01T00:00:00.000Z' }],
          window_start: reloaded.captured_at
        }).progress_snapshot;
        assert.strictEqual(s.absolute_delta, 0.13);
        assert.strictEqual(s.percentage_point_delta, 13);
        assert.strictEqual(s.relative_change, 0.2241);
        assert.strictEqual(s.trend, 'IMPROVING');
        function snap(baseline, current) {
          return PBProgressTracking.computeProgressSnapshot({ cycle_id: 'c', player_id: 'p', kpi_profile_code: 'K', source: 'TRAINING', baseline_entry: { value: baseline, status: 'RESOLVED', evidence_refs: [] }, in_cycle_evidence: current == null ? [] : [{ evidence_id: 'e', source: 'TRAINING', kpi: 'K', player_id: 'p', value: current, timestamp: '2020-02-01T00:00:00.000Z' }], window_start: '2020-01-01T00:00:00.000Z' }).progress_snapshot;
        }
        assert.strictEqual(snap(0.5, 0.6).trend, 'IMPROVING');
        assert.strictEqual(snap(0.5, 0.5).trend, 'STABLE');
        assert.strictEqual(snap(0.5, 0.4).trend, 'DECLINING');
        assert.strictEqual(snap(0.5, null).trend, 'INSUFFICIENT_DATA', 'FA14: baseline only -> INSUFFICIENT_DATA');
        assert.strictEqual(snap(0, 0.2).relative_change, null, 'FA14: baseline 0 -> relative_change null');
      });
    }); })
    .then(function () { return gate('FA12_FA19_TRAINING_MATCH_SEPARATION', function () {
      // Case A: TRAINING evidence only -> MATCH stays UNRESOLVED/INSUFFICIENT_DATA, never copied.
      var baselineA = PBCycleBaseline.captureBaselineSnapshot({ cycle_id: 'cyc_fa12a', player_id: 'p_fa12', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2020-01-01T00:00:00.000Z', evidence: [] }).cycle_kpi_baseline;
      var matchProgressA = PBProgressTracking.computeProgressSnapshot({ cycle_id: 'cyc_fa12a', player_id: 'p_fa12', kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'MATCH', baseline_entry: baselineA.tracks.MATCH.EXECUTION_SUCCESS_RATE, in_cycle_evidence: [{ evidence_id: 'evt', source: 'TRAINING', kpi: 'EXECUTION_SUCCESS_RATE', player_id: 'p_fa12', value: 0.9, timestamp: '2020-02-01T00:00:00.000Z' }], window_start: baselineA.captured_at }).progress_snapshot;
      assert.strictEqual(matchProgressA.current_value, null, 'FA12 Case A: TRAINING evidence never satisfies MATCH');
      assert.strictEqual(matchProgressA.trend, 'INSUFFICIENT_DATA');
      // Case B: legitimate MATCH evidence supplied -> computes independently.
      var baselineB = PBCycleBaseline.captureBaselineSnapshot({ cycle_id: 'cyc_fa12b', player_id: 'p_fa12', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2020-01-01T00:00:00.000Z', evidence: [{ evidence_id: 'evm0', source: 'MATCH', kpi: 'EXECUTION_SUCCESS_RATE', player_id: 'p_fa12', value: 0.5, timestamp: '2019-12-01T00:00:00.000Z' }] }).cycle_kpi_baseline;
      var matchProgressB = PBProgressTracking.computeProgressSnapshot({ cycle_id: 'cyc_fa12b', player_id: 'p_fa12', kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'MATCH', baseline_entry: baselineB.tracks.MATCH.EXECUTION_SUCCESS_RATE, in_cycle_evidence: [{ evidence_id: 'evm1', source: 'MATCH', kpi: 'EXECUTION_SUCCESS_RATE', player_id: 'p_fa12', value: 0.6, timestamp: '2020-02-01T00:00:00.000Z' }], window_start: baselineB.captured_at }).progress_snapshot;
      assert.strictEqual(matchProgressB.trend, 'IMPROVING', 'FA12 Case B: MATCH computes normally with real MATCH evidence');
      // Case C: forbidden fallback structural scan.
      ['cycle-baseline-engine.js', 'progress-tracking-engine.js', 'progress-reassessment-persistence.js'].forEach(function (f) {
        var src = stripComments(readSrc('js/' + f));
        assert.ok(!/tracks\.MATCH\s*=\s*tracks\.TRAINING/.test(src), 'FA19: ' + f + ' never copies TRAINING into MATCH');
        assert.ok(src.indexOf('inferMatch') === -1 && src.indexOf('copyTrainingToMatch') === -1, 'FA19: ' + f + ' contains no inference shortcut');
      });
    }); })
    .then(function () { return seedMatchSessionForPlayer(J.player); })
    .then(function (ctx2) { return seedSecondMatch(ctx2); })
    .then(function (ctx2) {
      J.match2 = ctx2.session;
      return gate('FA09_JOURNEY_STEP5_REASSESSMENT_READY', function () {
        var cyc = J.cycle;
        cyc = PBWorkflow.transition(cyc, 'GENERATE_RECOMMENDATION', { recommendation_refs: [J.rec.recommendation_id] });
        assert.strictEqual(cyc.state, 'RECOMMENDATION_READY');
        cyc = PBWorkflow.transition(cyc, 'ADD_EVIDENCE', { evidence_ref: 'ev_journey_new' });
        assert.strictEqual(cyc.state, 'REASSESSMENT_READY', 'FA09: legitimately reached REASSESSMENT_READY via accepted S10-A transitions only');
        J.cycle = cyc;
        return PBStore.putDevelopmentCycle(J.cycle);
      });
    })
    .then(function () { return gate('FA08_FA18_REAL_MATCH_REASSESSMENT', function () {
      var orchSrc = stripComments(readSrc('js/progress-reassessment-persistence.js'));
      assert.ok(orchSrc.indexOf('createMatchSession') === -1 && orchSrc.indexOf('createMatchObservationSession') === -1, 'FA08: orchestrator never fabricates a Match session');
      assert.ok(orchSrc.indexOf('trial_events') === -1, 'FA08: orchestrator never constructs synthetic trial_events');
      assert.ok(orchSrc.indexOf("store.get('test_sessions'") !== -1, 'FA08: orchestrator only reads a real, pre-existing test_sessions record');
      return PBProgressReassessmentPersistence.runReassessmentDurable({
        cycle_id: J.cycle.cycle_id, player_id: J.player.player_id, real_match_session_id: J.match2.test_session_id, previous_recommendations: [J.rec]
      }).then(function (reassessment) {
        assert.strictEqual(reassessment.status, 'COMPLETED');
        assert.strictEqual(reassessment.trigger, 'REAL_MATCH_OBSERVATION');
        J.reassessment = reassessment;
        // FA18: Reassessment -> Development Cycle -> real Match Session -> player -> prev/new recs
        assert.strictEqual(reassessment.cycle_id, J.cycle.cycle_id);
        assert.strictEqual(reassessment.match_session_id, J.match2.test_session_id);
        assert.strictEqual(reassessment.player_id, J.player.player_id);
        assert.deepStrictEqual(reassessment.previous_recommendation_refs, [J.rec.recommendation_id]);
        assert.ok(reassessment.new_recommendation_refs.length >= 1);
        // FA18: Evidence -> Session -> Prescription -> Recommendation -> Player
        assert.strictEqual(J.evidence.session_ref, J.sessionResult.session_id);
        assert.strictEqual(J.evidence.prescription_ref, J.sessionResult.prescription_ref);
        assert.strictEqual(J.evidence.prescription_ref, J.rx.prescription_id);
        assert.strictEqual(J.evidence.recommendation_ref, J.rx.source_recommendation_id);
        assert.strictEqual(J.evidence.player_id, J.player.player_id);
      });
    }); })
    .then(function () { return gate('FA17_IDEMPOTENCY', function () {
      // duplicate reassessment
      return PBProgressReassessmentPersistence.runReassessmentDurable({ cycle_id: J.cycle.cycle_id, player_id: J.player.player_id, real_match_session_id: J.match2.test_session_id }).then(function (again) {
        assert.strictEqual(again.reassessment_id, J.reassessment.reassessment_id, 'duplicate reassessment reused, not recomputed');
        // duplicate baseline capture
        return PBProgressReassessmentPersistence.captureBaselineDurable({ cycle_id: J.cycle.cycle_id, player_id: J.player.player_id, kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2020-06-01T00:00:00.000Z' });
      }).then(function (baselineAgain) {
        assert.strictEqual(baselineAgain.tracks.TRAINING.EXECUTION_SUCCESS_RATE.value, 0.58);
        // duplicate evidence submission
        return assertRejects(
          Promise.resolve().then(function () { return PBSessionEvidence.submitTrainingEvidence(J.sessionResult, J.cycle); }),
          'duplicate evidence submission', 'DUPLICATE_EVIDENCE'
        );
      }).then(function () {
        // duplicate session finalization
        var exec = PBSessionEvidence.createSessionExecution({ session_intent: Object.assign({}, J.sessionIntent, { session_id: 'sint_fa17dup' }) }).session_execution;
        exec = PBSessionEvidence.transition(exec, 'START', {});
        PBSessionEvidence.completeSession(exec, { attempts: 5, successful_attempts: 3 });
        var finalized = Object.assign({}, exec, { state: 'COMPLETED' });
        assert.throws(function () { PBSessionEvidence.completeSession(finalized, { attempts: 5, successful_attempts: 3 }); }, function (e) { return e.code === 'DUPLICATE_FINALIZATION'; });
      }).then(function () {
        // duplicate/reused supersession — supersede once, verify idempotent structurally (a second
        // supersede attempt on an already-SUPERSEDED workflow correctly rejects, never double-chains).
        var rxOld = { prescription_id: 'rx_fa17_old', source_recommendation_id: 'rec_fa17_old', status: 'prescribed', priority_rank: 1, priority_score: 50, priority_tier: 'MEDIUM', training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION', kpi_profile_code: 'EXECUTION_SUCCESS_RATE' };
        var oldWf = PBPrescriptionWorkflow.createPrescriptionWorkflow({ prescription: rxOld, player_id: 'p_fa17' }).prescription_workflow;
        oldWf = PBPrescriptionWorkflow.transition(oldWf, 'ACTIVATE', {});
        var rxNew = Object.assign({}, rxOld, { prescription_id: 'rx_fa17_new', source_recommendation_id: 'rec_fa17_new' });
        return PBStore.putPrescriptionWorkflow(oldWf).then(function () {
          return PBProgressReassessmentPersistence.supersedePrescriptionWorkflowDurable(oldWf, { prescription: rxNew, player_id: 'p_fa17' });
        }).then(function (result) {
          assert.strictEqual(result.superseded_workflow.state, 'SUPERSEDED');
          return assertRejects(
            Promise.resolve().then(function () { return PBProgressReassessmentPersistence.supersedePrescriptionWorkflowDurable(result.superseded_workflow, { prescription: rxNew, player_id: 'p_fa17' }); }),
            'double supersession rejects, no second chain', 'INVALID_INPUT'
          );
        });
      });
    }); })

    // ================================================================
    // FA21/FA22 — Methodology / CAP / validated level integrity.
    // ================================================================
    .then(function () { return gate('FA21_FA22_METHODOLOGY', function () {
      assert.deepStrictEqual(PBReview.CAP_WEIGHTS !== undefined ? PBReview.CAP_WEIGHTS : { technical: 0.45, decision: 0.30, pressure: 0.25 }, { technical: 0.45, decision: 0.30, pressure: 0.25 }, 'CAP weights unchanged (45/30/25)');
      var reviewSrc = stripComments(readSrc('js/review-engine.js'));
      assert.ok(/CAP_WEIGHTS\s*=\s*\{\s*technical:\s*0\.45,\s*decision:\s*0\.30,\s*pressure:\s*0\.25\s*\}/.test(reviewSrc), 'authoritative CAP formula source unchanged');
      var s10Files = fs.readdirSync(path.join(ROOT, 'js')).filter(function (f) {
        return /^(workflow-integration|dashboard-integration|prescription-workflow|session-evidence|cycle-baseline|progress-tracking|reassessment|progress-reassessment)/.test(f);
      });
      s10Files.forEach(function (f) {
        var src = stripComments(readSrc('js/' + f));
        assert.ok(!/CAP_WEIGHTS\s*=\s*\{/.test(src), f + ' introduces no competing CAP formula');
        assert.ok(!/validated_training_level\s*=/.test(src), f + ' never assigns validated_training_level');
        assert.ok(src.indexOf('3.87') === -1 && src.indexOf('4.12') === -1, f + ' contains no fractional validated level');
      });
      var VALIDATED_LEVELS = [3.0, 3.5, 4.0, 4.5, 5.0];
      assert.deepStrictEqual(VALIDATED_LEVELS, [3.0, 3.5, 4.0, 4.5, 5.0]);
    }); })

    // ================================================================
    // FA24 — no unauthorized next-stage work.
    // ================================================================
    .then(function () { return gate('FA24_NO_S11_WORK', function () {
      // S11-A-R2/S11-B/S11-C/S11-D/S11-E/S11-F0/S11-F0-R1: FA24 originally asserted "no S11-named
      // file exists" — valid only at the S10-FINAL QA moment, before S11-A..F0-R1 were
      // GPT-authorized. It is now a strict allowlist instead: the specifically authorized S11-A +
      // S11-B + S11-C + S11-D + S11-E + S11-F0 + S11-F0-R1 footprint passes, but any other
      // S11-named file (a real S11-F implementation file, S11-FINAL, or an unexpected extra file
      // from an already-accepted stage) still fails — the governance purpose ("no unauthorized
      // next-stage work") is preserved, not removed. S11-F0 was a narrow, audit-only
      // blocking-repair pass (see docs/S11-F0-PRESCRIPTION-LINEAGE-AUDIT.md) that found no
      // production registration caller existed; S11-F0-R1 (see
      // docs/S11-F0-R1-PRODUCTION-REGISTRATION.md) builds exactly that one missing production
      // registration entry point. Its own js/tests files (decision-cycle-registration-controller.js
      // / .test.js) are not themselves S11-named and so are not matched by the /s11/i scan below,
      // but are still listed here explicitly per the frozen S11-F0-R1 package. S11-F itself
      // remains explicitly unauthorized until GPT clears the block — this repair does not clear it.
      var authorizedS11Files = [
        'product-journey-orchestrator.js',
        'product-journey-orchestrator.test.js',
        'S11-A-PRODUCT-JOURNEY-ORCHESTRATOR.md',
        'home-dashboard-adapter.js',
        'home-priority-dashboard-ui.js',
        'home-dashboard-adapter.test.js',
        'home-priority-dashboard-ui.test.js',
        'S11-B-HOME-PRIORITY-DASHBOARD.md',
        'guided-training-action-controller.js',
        'guided-training-ui.js',
        'guided-training-action-controller.test.js',
        'guided-training-ui.test.js',
        'S11-C-GUIDED-TRAINING-ACTION-FLOW.md',
        'progress-reassessment-adapter.js',
        'progress-reassessment-ui.js',
        'progress-reassessment-adapter.test.js',
        'progress-reassessment-ui.test.js',
        'S11-D-PROGRESS-REASSESSMENT-EXPERIENCE.md',
        'history-explainability-adapter.js',
        'history-explainability-ui.js',
        'history-explainability-adapter.test.js',
        'history-explainability-ui.test.js',
        'S11-E-HISTORY-EXPLAINABILITY-RECOVERY.md',
        'S11-F0-PRESCRIPTION-LINEAGE-AUDIT.md',
        'decision-cycle-registration-controller.js',
        'decision-cycle-registration-controller.test.js',
        'S11-F0-R1-PRODUCTION-REGISTRATION.md'
      ];
      var jsFiles = fs.readdirSync(path.join(ROOT, 'js'));
      var testFiles = fs.readdirSync(path.join(ROOT, 'tests'));
      var docFiles = fs.readdirSync(path.join(ROOT, 'docs'));
      [].concat(jsFiles, testFiles, docFiles).forEach(function (f) {
        if (/s11/i.test(f)) {
          assert.ok(authorizedS11Files.indexOf(f) !== -1, 'only the GPT-authorized S11-A/S11-B/S11-C/S11-D/S11-E/S11-F0 footprint may exist, unauthorized S11-named file: ' + f);
        }
      });
      authorizedS11Files.forEach(function (f) {
        var found = jsFiles.indexOf(f) !== -1 || testFiles.indexOf(f) !== -1 || docFiles.indexOf(f) !== -1;
        assert.ok(found, 'authorized S11-A/S11-B/S11-C/S11-D/S11-E file is present: ' + f);
      });
      var storageSrc = stripComments(readSrc('js/storage.js'));
      assert.ok(!/DB_VERSION\s*=\s*6/.test(storageSrc), 'no DB_VERSION 6');
    }); })

    // ================================================================
    // FA23 — Full regression.
    // ================================================================
    .then(function () { return gate('FA23_FULL_REGRESSION', function () {
      var testDir = path.join(ROOT, 'tests');
      var suites = fs.readdirSync(testDir).filter(function (f) { return /\.test\.js$/.test(f); });
      assert.ok(suites.indexOf('s10-final-acceptance.test.js') !== -1, 'this suite is itself included in the full regression set');
      var failures = [];
      suites.forEach(function (suite) {
        if (suite === 's10-final-acceptance.test.js') return; // do not recursively spawn self
        var res = cp.spawnSync(process.execPath, [path.join(testDir, suite)], { encoding: 'utf8' });
        if (res.status !== 0) failures.push(suite + ':\n' + res.stdout + res.stderr);
      });
      assert.deepStrictEqual(failures, [], 'every other accepted suite must pass:\n' + failures.join('\n---\n'));
    }); })

    .then(function () {
      var failed = Object.keys(gates).filter(function (k) { return !gates[k]; });
      assert.deepStrictEqual(failed, [], 'all Final Acceptance gates must pass: ' + JSON.stringify(failed));
      console.log('s10-final-acceptance.test.js: all gates passed —', Object.keys(gates).join(', '));
    });
}

run().catch(function (err) {
  console.error('s10-final-acceptance.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
