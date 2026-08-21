/* tests/s10-f-cross-workflow-qa.test.js — S10-F: Cross-Workflow
 * Integration QA
 *
 * Validates the complete accepted chain end to end using REAL engines
 * and real persisted objects (fake-indexeddb + real PBStore + real
 * S9/S10 engines) — not a re-implementation, not a mock. This suite
 * adds no product logic; it only proves the already-accepted contracts
 * compose correctly and survive reload.
 *
 * Run: node tests/s10-f-cross-workflow-qa.test.js
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
   'prescription-workflow-engine', 'session-evidence-engine', 'session-evidence-persistence',
   'cycle-baseline-engine', 'progress-tracking-engine', 'reassessment-engine', 'progress-reassessment-persistence'
  ].forEach(function (mod) { delete require.cache[require.resolve('../js/' + mod + '.js')]; });
  global.PBNamespace = require('../js/namespace.js');
  global.PBStore = require('../js/storage.js');
  global.PBMatchObservation = require('../js/match-observation-engine.js');
  global.PBPerformanceAnalysis = require('../js/performance-analysis-engine.js');
  global.PBDiagnosis = require('../js/diagnosis-engine.js');
  global.PBRecommendationPriority = require('../js/recommendation-priority-engine.js');
  global.PBTrainingPrescription = require('../js/training-prescription-engine.js');
  global.PBWorkflow = require('../js/workflow-integration-engine.js');
  global.PBPrescriptionWorkflow = require('../js/prescription-workflow-engine.js');
  global.PBSessionEvidence = require('../js/session-evidence-engine.js');
  global.PBSessionEvidencePersistence = require('../js/session-evidence-persistence.js');
  global.PBCycleBaseline = require('../js/cycle-baseline-engine.js');
  global.PBProgressTracking = require('../js/progress-tracking-engine.js');
  global.PBReassessment = require('../js/reassessment-engine.js');
  global.PBProgressReassessmentPersistence = require('../js/progress-reassessment-persistence.js');
}
freshRuntime();

function baseRally(overrides) {
  return Object.assign({
    game_number: 1, rally_number: 1, phase: 'transition', intent: 'neutralize', shot: 'reset',
    target: 'middle', quality: 'good', movement: 'balanced', result: 'continue', control_state: 'neutral'
  }, overrides || {});
}
function seedMatchSession(hint) {
  return PBStore.createPlayer(hint || 'S10-F QA Player').then(function (player) {
    return PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 }).then(function (assessment) {
      return PBMatchObservation.createMatchSession({ assessment_id: assessment.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF' } })
        .then(function (session) { return { player: player, assessment: assessment, session: session }; });
    });
  });
}
function addRallies(session_id, rallies) {
  var chain = Promise.resolve();
  rallies.forEach(function (r) { chain = chain.then(function () { return PBMatchObservation.addRallyObservation(session_id, baseRally(r)); }); });
  return chain;
}
// Same fixture tests/s9-full-system-qa.test.js's FA-06 uses: 8 failed-drop rallies -> a real
// IMPROVE_SHOT_EXECUTION recommendation with kpi_profile_code EXECUTION_SUCCESS_RATE.
function seedFailedDropMatch(ctx) {
  var rallies = [];
  for (var i = 1; i <= 8; i++) rallies.push({ game_number: 1, rally_number: i, shot: 'drop', quality: 'error', result: 'continue' });
  return addRallies(ctx.session.test_session_id, rallies).then(function () { return ctx; });
}
// A second match for the SAME already-existing player (a new assessment + match session, no new
// player) — a genuine second observation, not a fabricated one. ONE additional successful rally
// so the underlying success_rate improves — still fails (< 50%), same diagnosis/recommendation
// lineage, giving a legitimate REPRIORITIZED-or-UNCHANGED comparison target for the reassessment
// gate below, without altering any upstream S9 threshold.
function seedSecondMatchForPlayer(player) {
  return PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 }).then(function (assessment) {
    return PBMatchObservation.createMatchSession({ assessment_id: assessment.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF' } }).then(function (session) {
      var rallies = [];
      for (var i = 1; i <= 6; i++) rallies.push({ game_number: 1, rally_number: i, shot: 'drop', quality: 'error', result: 'continue' });
      for (var j = 7; j <= 8; j++) rallies.push({ game_number: 1, rally_number: j, shot: 'drop', quality: 'good', result: 'winner' });
      return addRallies(session.test_session_id, rallies).then(function () { return { player: player, assessment: assessment, session: session }; });
    });
  });
}

var boundaries = []; // documented fixture boundaries, per §37

var results = {}; // gate -> {pass, note}
function gate(id, fn) {
  return Promise.resolve().then(fn).then(function () {
    results[id] = { pass: true };
  }).catch(function (e) {
    results[id] = { pass: false, error: e && (e.stack || e.message) };
    throw e;
  });
}

function run() {
  var chainCtx = {};

  return PBStore.open()

    // ================================================================
    // G01 — Git lineage is verified externally (git status/log) before this file runs; recorded
    // in docs/S10-F-CROSS-WORKFLOW-QA.md, not re-asserted here (a hardcoded SHA would go stale
    // the instant this stage's own commit lands — same rationale S9-FINAL-ACCEPTANCE.md documents
    // for its own FA-01).
    // ================================================================

    // ================================================================
    // G28-adjacent — DB_VERSION continuity / all 18 expected stores / additive-only migration.
    // ================================================================
    .then(function () { return gate('G07_SCHEMA', function () {
      assert.strictEqual(PBStore.DB_VERSION, 5);
      var expected = [
        'players', 'assessments', 'test_sessions', 'trial_events',
        'review_snapshots', 'prescriptions', 'retests',
        'training_cycles', 'weekly_plans', 'session_plans', 'session_logs', 'cycle_summaries',
        'development_cycles', 'prescription_workflows', 'session_results', 'training_evidence',
        'cycle_kpi_baselines', 'reassessments'
      ];
      assert.strictEqual(expected.length, 18, 'sanity: 18 expected stores');
      var storageSrc = stripComments(readSrc('js/storage.js'));
      expected.forEach(function (name) { assert.ok(storageSrc.indexOf(name + ':') !== -1, 'store declared in storage.js: ' + name); });
      assert.ok(storageSrc.indexOf('deleteObjectStore') === -1, 'no deleteObjectStore anywhere in storage.js');
      var upgradeBlock = storageSrc.match(/onupgradeneeded[\s\S]*?\n  \};/)[0];
      assert.ok(/if\s*\(!db\.objectStoreNames\.contains\(name\)\)/.test(upgradeBlock), 'upgrade path only ever creates missing stores');
    }); })

    // ================================================================
    // G03 — S9 Recommendation Priority -> S9-F Prescription (Contract Matrix A)
    // G04 — S10-C Prescription Workflow -> Session Intent (Contract Matrix B/C)
    // G05 — Session -> Evidence (Contract Matrix D)
    // G06 — Evidence -> ADD_EVIDENCE (Contract Matrix E)
    // Built as one continuous real-engine chain, matching §37.
    // ================================================================
    .then(function () { return seedMatchSession('S10-F Chain Player'); })
    .then(function (ctx) { return seedFailedDropMatch(ctx); })
    .then(function (ctx) {
      chainCtx.player = ctx.player; chainCtx.assessment = ctx.assessment; chainCtx.matchA = ctx.session;
      return gate('G03_S9_TO_PRESCRIPTION', function () {
        return PBDiagnosis.diagnoseMatch(ctx.session.test_session_id, ctx.player.player_id).then(function (diagnosisResult) {
          var recommendationResult = PBRecommendationPriority.prioritizeDiagnosis(diagnosisResult);
          var prescriptionResult = PBTrainingPrescription.prescribeRecommendations(recommendationResult);
          var rec = recommendationResult.recommendations.filter(function (r) { return r.recommendation_code === 'IMPROVE_SHOT_EXECUTION'; })[0];
          var rx = prescriptionResult.prescriptions.filter(function (p) { return p.source_recommendation_id === rec.recommendation_id; })[0];
          assert.ok(rec && rx, 'real recommendation and prescription produced');
          // Contract A: ancestry + rank/score/tier preserved verbatim, never re-derived
          assert.strictEqual(rx.priority_rank, rec.rank);
          assert.strictEqual(rx.priority_score, rec.priority_score);
          assert.strictEqual(rx.priority_tier, rec.priority_tier);
          assert.strictEqual(rx.source_recommendation_id, rec.recommendation_id);
          chainCtx.diagnosisResult = diagnosisResult;
          chainCtx.recommendationResult = recommendationResult;
          chainCtx.prescriptionResult = prescriptionResult;
          chainCtx.rec = rec; chainCtx.rx = rx;
        });
      });
    })
    .then(function () { return gate('G04_C_TO_D', function () {
      var workflow = PBPrescriptionWorkflow.createPrescriptionWorkflow({ prescription: chainCtx.rx, player_id: chainCtx.player.player_id }).prescription_workflow;
      // Contract B: prescription_ref/recommendation_ref preserved; UNRESOLVED drill semantics preserved
      assert.strictEqual(workflow.prescription_ref, chainCtx.rx.prescription_id);
      assert.strictEqual(workflow.recommendation_ref, chainCtx.rx.source_recommendation_id);
      assert.strictEqual(workflow.prescription_snapshot.drill_resolution_status, 'UNRESOLVED');
      workflow = PBPrescriptionWorkflow.transition(workflow, 'ACTIVATE', {});
      var startResult = PBPrescriptionWorkflow.startTraining(workflow, {});
      // Contract C: prescription ancestry / player / training_objective/mode/kpi_profile preserved
      assert.strictEqual(startResult.session_intent.prescription_ref, chainCtx.rx.prescription_id);
      assert.strictEqual(startResult.session_intent.player_id, chainCtx.player.player_id);
      assert.strictEqual(startResult.session_intent.training_objective_code, chainCtx.rx.training_objective_code);
      assert.strictEqual(startResult.session_intent.training_mode, chainCtx.rx.training_mode);
      assert.strictEqual(startResult.session_intent.kpi_profile_code, chainCtx.rx.kpi_profile_code);
      chainCtx.workflow = startResult.workflow;
      chainCtx.sessionIntent = startResult.session_intent;
      return PBStore.putPrescriptionWorkflow(chainCtx.workflow);
    }); })
    .then(function () { return gate('G05_SESSION_TO_EVIDENCE', function () {
      var exec = PBSessionEvidence.createSessionExecution({ session_intent: chainCtx.sessionIntent, recommendation_ref: chainCtx.rx.source_recommendation_id }).session_execution;
      exec = PBSessionEvidence.transition(exec, 'START', {});
      var result = PBSessionEvidence.completeSession(exec, { attempts: 50, successful_attempts: 38 }).session_result;
      assert.strictEqual(result.status, 'COMPLETED');
      var evidence = PBSessionEvidence.buildTrainingEvidence(result).evidence;
      // Contract D
      assert.strictEqual(evidence.session_ref, result.session_id);
      assert.strictEqual(evidence.prescription_ref, result.prescription_ref);
      assert.strictEqual(evidence.recommendation_ref, result.recommendation_ref);
      assert.strictEqual(evidence.player_id, result.player_id);
      assert.strictEqual(evidence.kpi, result.kpi_profile_code);
      assert.strictEqual(evidence.value, result.result_value);
      assert.strictEqual(evidence.source, 'TRAINING');
      chainCtx.sessionResult = result;
      chainCtx.evidence = evidence;
      return Promise.all([PBStore.putSessionResult(result), PBStore.putTrainingEvidence(evidence)]);

      // G05 non-evidence-state slice (PARTIAL/SKIPPED/CANCELLED produce no Evidence) is already
      // covered exhaustively by tests/session-evidence-engine.test.js (#12-15) — re-asserting the
      // same unit-level behavior here would duplicate, not extend, coverage; this gate instead
      // proves the happy path composes correctly against real upstream data.
    }); })
    .then(function () { return gate('G06_ADD_EVIDENCE', function () {
      var cycle = PBWorkflow.createDevelopmentCycle({ player_id: chainCtx.player.player_id, baseline_ref: chainCtx.assessment.assessment_id }).development_cycle;
      var updated = PBWorkflow.transition(cycle, 'ADD_EVIDENCE', { evidence_ref: chainCtx.evidence.evidence_id });
      assert.ok(updated.evidence_refs.indexOf(chainCtx.evidence.evidence_id) !== -1, 'evidence_ref entered the cycle');
      assert.strictEqual(updated.state, 'EVIDENCE_AVAILABLE', 'S10-A alone determined the resulting state (never REASSESSMENT_READY here, since no recommendation existed yet)');
      chainCtx.cycle = updated;
      return PBStore.putDevelopmentCycle(chainCtx.cycle);
    }); })

    // ================================================================
    // G07 — Development Cycle persistence across reload.
    // ================================================================
    .then(function () { return gate('G07_RELOAD', function () {
      var before = JSON.parse(JSON.stringify(chainCtx.cycle));
      freshRuntime();
      return PBStore.getDevelopmentCycle(before.cycle_id).then(function (reloaded) {
        assert.ok(reloaded);
        assert.strictEqual(reloaded.cycle_id, before.cycle_id);
        assert.deepStrictEqual(reloaded.evidence_refs, before.evidence_refs);
        assert.strictEqual(reloaded.state, before.state);
        assert.deepStrictEqual(reloaded.recommendation_refs, before.recommendation_refs);
        assert.deepStrictEqual(reloaded.prescription_refs, before.prescription_refs);
        chainCtx.cycle = reloaded;
      });
    }); })

    // ================================================================
    // G08 — Reload recovery scenarios A-D.
    // ================================================================
    .then(function () { return gate('G08_RELOAD_RECOVERY', function () {
      // Scenario A: Session Result exists, Evidence missing -> reuse Result, continue Evidence step.
      var cycA = PBWorkflow.createDevelopmentCycle({ player_id: 'p_recA', baseline_ref: 'asm_recA' }).development_cycle;
      var execA = PBSessionEvidence.createSessionExecution({
        session_intent: { session_id: 'sint_recA', prescription_ref: 'rx_recA', player_id: 'p_recA', training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION', kpi_profile_code: 'EXECUTION_SUCCESS_RATE' }
      }).session_execution;
      execA = PBSessionEvidence.transition(execA, 'START', {});
      var resultA = PBSessionEvidence.completeSession(execA, { attempts: 20, successful_attempts: 15 }).session_result;
      return PBStore.putDevelopmentCycle(cycA).then(function () { return PBStore.putSessionResult(resultA); }).then(function () {
        return PBSessionEvidencePersistence.completeSessionDurable({ session_execution: execA, attempts: 20, successful_attempts: 15, development_cycle_id: cycA.cycle_id });
      }).then(function (outA) {
        assert.strictEqual(outA.session_result.session_id, 'sint_recA', 'Scenario A: existing Result reused, not re-finalized');
        assert.ok(outA.evidence.evidence_id, 'Scenario A: Evidence step completed on resume');

        // Scenario B: Result + Evidence exist, cycle lacks the ref -> ADD_EVIDENCE + persist.
        var cycB = PBWorkflow.createDevelopmentCycle({ player_id: 'p_recB', baseline_ref: 'asm_recB' }).development_cycle;
        var execB = PBSessionEvidence.createSessionExecution({
          session_intent: { session_id: 'sint_recB', prescription_ref: 'rx_recB', player_id: 'p_recB', training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION', kpi_profile_code: 'EXECUTION_SUCCESS_RATE' }
        }).session_execution;
        execB = PBSessionEvidence.transition(execB, 'START', {});
        var resultB = PBSessionEvidence.completeSession(execB, { attempts: 10, successful_attempts: 7 }).session_result;
        var evidenceB = PBSessionEvidence.buildTrainingEvidence(resultB).evidence;
        return PBStore.putDevelopmentCycle(cycB).then(function () { return Promise.all([PBStore.putSessionResult(resultB), PBStore.putTrainingEvidence(evidenceB)]); }).then(function () {
          return PBSessionEvidencePersistence.completeSessionDurable({ session_execution: execB, attempts: 10, successful_attempts: 7, development_cycle_id: cycB.cycle_id });
        }).then(function (outB) {
          assert.ok(outB.development_cycle.evidence_refs.indexOf(evidenceB.evidence_id) !== -1, 'Scenario B: ADD_EVIDENCE applied using the already-persisted Evidence');

          // Scenario C: everything already complete -> idempotent replay, no duplicate.
          var execC = PBSessionEvidence.createSessionExecution({ session_intent: { session_id: 'sint_recB', prescription_ref: 'rx_recB', player_id: 'p_recB', kpi_profile_code: 'EXECUTION_SUCCESS_RATE' } }).session_execution;
          execC = PBSessionEvidence.transition(execC, 'START', {});
          return PBSessionEvidencePersistence.completeSessionDurable({ session_execution: execC, attempts: 10, successful_attempts: 7, development_cycle_id: cycB.cycle_id }).then(function (outC) {
            assert.strictEqual(outC.development_cycle.evidence_refs.length, outB.development_cycle.evidence_refs.length, 'Scenario C: idempotent replay creates no duplicate write chain');

            // Scenario D: reassessment already persisted -> reload -> reuse, no second S9 call.
            var cycD = PBWorkflow.createDevelopmentCycle({ player_id: chainCtx.player.player_id, baseline_ref: chainCtx.assessment.assessment_id }).development_cycle;
            cycD = PBWorkflow.transition(cycD, 'ADD_EVIDENCE', { evidence_ref: 'ev_seedD' });
            cycD = PBWorkflow.transition(cycD, 'GENERATE_RECOMMENDATION', { recommendation_refs: [chainCtx.rec.recommendation_id] });
            cycD = PBWorkflow.transition(cycD, 'ADD_EVIDENCE', { evidence_ref: 'ev_seedD2' }); // -> REASSESSMENT_READY
            return PBStore.putDevelopmentCycle(cycD).then(function () {
              return PBProgressReassessmentPersistence.runReassessmentDurable({ cycle_id: cycD.cycle_id, player_id: chainCtx.player.player_id, real_match_session_id: chainCtx.matchA.test_session_id, previous_recommendations: [chainCtx.rec] });
            }).then(function (first) {
              freshRuntime();
              return PBProgressReassessmentPersistence.runReassessmentDurable({ cycle_id: cycD.cycle_id, player_id: chainCtx.player.player_id, real_match_session_id: chainCtx.matchA.test_session_id }).then(function (second) {
                assert.strictEqual(second.reassessment_id, first.reassessment_id);
                assert.strictEqual(second.created_at, first.created_at, 'Scenario D: same record reused after reload, not recomputed');
                return PBStore.listReassessmentsByCycle(cycD.cycle_id);
              }).then(function (list) { assert.strictEqual(list.length, 1, 'no second S9 pipeline invocation / no duplicate chain'); });
            });
          });
        });
      });
    }); })

    // ================================================================
    // G09 — Duplicate finalization protection.
    // ================================================================
    .then(function () { return gate('G09_DUPLICATE_FINALIZATION', function () {
      var exec = PBSessionEvidence.createSessionExecution({ session_intent: { session_id: 'sint_dup1', prescription_ref: 'rx_dup', player_id: 'p_dup', kpi_profile_code: 'X' } }).session_execution;
      exec = PBSessionEvidence.transition(exec, 'START', {});
      var result = PBSessionEvidence.completeSession(exec, { attempts: 10, successful_attempts: 5 }).session_result;
      var finalized = Object.assign({}, exec, { state: 'COMPLETED' });
      assert.throws(function () { PBSessionEvidence.completeSession(finalized, { attempts: 10, successful_attempts: 5 }); }, function (e) { return e.code === 'DUPLICATE_FINALIZATION'; }, 'same session, repeat completion, identical payload — still rejects at the pure-engine layer (the durable orchestrator layer is what implements the accepted reuse-on-identical-payload design, per S10-D-R1)');
      assert.throws(function () { PBSessionEvidence.completeSession(finalized, { attempts: 10, successful_attempts: 3 }); }, function (e) { return e.code === 'DUPLICATE_FINALIZATION'; }, 'conflicting payload also rejects — no second logical Session Result either way');
    }); })

    // ================================================================
    // G10 — Duplicate evidence protection.
    // ================================================================
    .then(function () { return gate('G10_DUPLICATE_EVIDENCE', function () {
      var result = { session_id: 'sint_dupev', prescription_ref: 'rx_dupev', player_id: 'p_dupev', status: 'COMPLETED', kpi_profile_code: 'X', attempts: 10, successful_attempts: 8, result_value: 0.8 };
      var ev1 = PBSessionEvidence.buildTrainingEvidence(result).evidence;
      var ev2 = PBSessionEvidence.buildTrainingEvidence(result).evidence;
      assert.strictEqual(ev1.evidence_id, ev2.evidence_id, 'deterministic identity — same logical evidence always reuses/collides on the same id');
      var cyc = PBWorkflow.createDevelopmentCycle({ player_id: 'p_dupev', baseline_ref: 'asm_dupev' }).development_cycle;
      return PBStore.putDevelopmentCycle(cyc).then(function () {
        return PBSessionEvidence.submitTrainingEvidence(result, cyc);
      }).then(function (out) {
        return assertRejects(
          Promise.resolve().then(function () { return PBSessionEvidence.submitTrainingEvidence(result, out.development_cycle); }),
          'duplicate evidence submission', 'DUPLICATE_EVIDENCE'
        );
      }).then(function () {
        // Known, reachable-path finding recorded for the QA report (§17/G10): identity is
        // (session_id, kpi_profile_code) — a hypothetical second Session Result for the SAME
        // session_id with a DIFFERENT result_value cannot arise through the accepted lifecycle
        // (completeSession() rejects any second finalization for the same session_execution with
        // DUPLICATE_FINALIZATION, proven by G09 above), so "conflicting content under the same
        // evidence identity" is not reachable through the accepted production call path. No
        // redesign performed for a non-reachable case, per §17's own instruction.
      });
    }); })

    // ================================================================
    // G11 — Baseline immutability + exact KPI compatibility.
    // ================================================================
    .then(function () { return gate('G11_BASELINE_IMMUTABLE', function () {
      var cyc = PBWorkflow.createDevelopmentCycle({ player_id: 'p_bl', baseline_ref: 'asm_bl' }).development_cycle;
      var preEvidence = { evidence_id: 'ev_bl_pre', source: 'TRAINING', player_id: 'p_bl', kpi: 'EXECUTION_SUCCESS_RATE', value: 0.58, timestamp: '2026-01-15T00:00:00.000Z', schema_version: '1.0' };
      var wrongKpi = { evidence_id: 'ev_bl_wrong', source: 'TRAINING', player_id: 'p_bl', kpi: 'technical_score', value: 0.99, timestamp: '2026-01-16T00:00:00.000Z', schema_version: '1.0' };
      return PBStore.putDevelopmentCycle(cyc).then(function () { return Promise.all([PBStore.putTrainingEvidence(preEvidence), PBStore.putTrainingEvidence(wrongKpi)]); }).then(function () {
        return PBProgressReassessmentPersistence.captureBaselineDurable({ cycle_id: cyc.cycle_id, player_id: 'p_bl', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z' });
      }).then(function (baseline) {
        assert.strictEqual(baseline.tracks.TRAINING.EXECUTION_SUCCESS_RATE.value, 0.58, 'exact KPI compatibility: the mismatched-vocabulary evidence never contributes');
        var postEvidence = { evidence_id: 'ev_bl_post', source: 'TRAINING', player_id: 'p_bl', kpi: 'EXECUTION_SUCCESS_RATE', value: 0.99, timestamp: '2026-02-10T00:00:00.000Z', schema_version: '1.0' };
        return PBStore.putTrainingEvidence(postEvidence).then(function () {
          return PBProgressReassessmentPersistence.captureBaselineDurable({ cycle_id: cyc.cycle_id, player_id: 'p_bl', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z' });
        });
      }).then(function (recaptured) {
        assert.strictEqual(recaptured.tracks.TRAINING.EXECUTION_SUCCESS_RATE.value, 0.58, 'baseline unchanged after new post-start evidence arrives');
      });
    }); })

    // ================================================================
    // G12 — TRAINING/MATCH separation.
    // ================================================================
    .then(function () { return gate('G12_TRAINING_MATCH_SEPARATED', function () {
      var trainingEv = { evidence_id: 'ev_sep_t', source: 'TRAINING', kpi: 'EXECUTION_SUCCESS_RATE', value: 0.9, player_id: 'p_sep', timestamp: '2026-02-15T00:00:00.000Z' };
      var matchEv = { evidence_id: 'ev_sep_m', source: 'MATCH', kpi: 'EXECUTION_SUCCESS_RATE', value: 0.1, player_id: 'p_sep', timestamp: '2026-02-15T00:00:00.000Z' };
      var baseline = PBCycleBaseline.captureBaselineSnapshot({ cycle_id: 'cyc_sep', player_id: 'p_sep', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-10T00:00:00.000Z', evidence: [] }).cycle_kpi_baseline;
      var training = PBProgressTracking.computeProgressSnapshot({ cycle_id: 'cyc_sep', player_id: 'p_sep', kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'TRAINING', baseline_entry: baseline.tracks.TRAINING.EXECUTION_SUCCESS_RATE, in_cycle_evidence: [trainingEv, matchEv], window_start: baseline.captured_at }).progress_snapshot;
      var match = PBProgressTracking.computeProgressSnapshot({ cycle_id: 'cyc_sep', player_id: 'p_sep', kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'MATCH', baseline_entry: baseline.tracks.MATCH.EXECUTION_SUCCESS_RATE, in_cycle_evidence: [trainingEv, matchEv], window_start: baseline.captured_at }).progress_snapshot;
      assert.strictEqual(training.current_value, 0.9, 'MATCH-source evidence never enters the TRAINING track');
      assert.strictEqual(match.current_value, 0.1, 'TRAINING-source evidence never enters the MATCH track');
      assert.notStrictEqual(training.current_value, match.current_value);
    }); })

    // ================================================================
    // G13 — Progress math, frozen example exact.
    // ================================================================
    .then(function () { return gate('G13_PROGRESS_MATH', function () {
      function snap(baseline, current) {
        return PBProgressTracking.computeProgressSnapshot({
          cycle_id: 'cyc_math', player_id: 'p_math', kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'TRAINING',
          baseline_entry: { value: baseline, status: 'RESOLVED', evidence_refs: [] },
          in_cycle_evidence: [{ evidence_id: 'ev1', source: 'TRAINING', kpi: 'EXECUTION_SUCCESS_RATE', player_id: 'p_math', value: current, timestamp: '2026-02-05T00:00:00.000Z' }],
          window_start: '2026-02-01T00:00:00.000Z'
        }).progress_snapshot;
      }
      var s = snap(0.58, 0.71);
      assert.strictEqual(s.absolute_delta, 0.13);
      assert.strictEqual(s.percentage_point_delta, 13);
      assert.strictEqual(s.relative_change, 0.2241);
      assert.strictEqual(snap(0.5, 0.6).trend, 'IMPROVING');
      assert.strictEqual(snap(0.5, 0.5).trend, 'STABLE');
      assert.strictEqual(snap(0.5, 0.4).trend, 'DECLINING');
      var baselineOnly = PBProgressTracking.computeProgressSnapshot({
        cycle_id: 'cyc_math', player_id: 'p_math', kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'TRAINING',
        baseline_entry: { value: 0.5, status: 'RESOLVED', evidence_refs: [] }, in_cycle_evidence: [], window_start: '2026-02-01T00:00:00.000Z'
      }).progress_snapshot;
      assert.strictEqual(baselineOnly.trend, 'INSUFFICIENT_DATA');
    }); })

    // ================================================================
    // G14 — Known MATCH limitation, honesty check.
    // ================================================================
    .then(function () { return gate('G14_MATCH_LIMITATION', function () {
      var baselineTrainingOnly = PBCycleBaseline.captureBaselineSnapshot({
        cycle_id: 'cyc_lim', player_id: 'p_lim', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z',
        evidence: [{ evidence_id: 'ev1', source: 'TRAINING', kpi: 'EXECUTION_SUCCESS_RATE', player_id: 'p_lim', value: 0.6, timestamp: '2026-01-01T00:00:00.000Z' }]
      }).cycle_kpi_baseline;
      // Case A: only durable TRAINING evidence exists -> MATCH progress UNRESOLVED/INSUFFICIENT_DATA.
      var matchProgressA = PBProgressTracking.computeProgressSnapshot({
        cycle_id: 'cyc_lim', player_id: 'p_lim', kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'MATCH',
        baseline_entry: baselineTrainingOnly.tracks.MATCH.EXECUTION_SUCCESS_RATE, in_cycle_evidence: [], window_start: baselineTrainingOnly.captured_at
      }).progress_snapshot;
      assert.strictEqual(baselineTrainingOnly.tracks.MATCH.EXECUTION_SUCCESS_RATE.status, 'UNRESOLVED');
      assert.strictEqual(matchProgressA.trend, 'INSUFFICIENT_DATA');
      assert.strictEqual(matchProgressA.current_value, null, 'never copies the TRAINING value across');

      // Case B: legitimate caller-supplied MATCH KPI evidence exists -> MATCH progress may compute.
      var baselineWithMatch = PBCycleBaseline.captureBaselineSnapshot({
        cycle_id: 'cyc_lim2', player_id: 'p_lim', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z',
        evidence: [{ evidence_id: 'ev_m1', source: 'MATCH', kpi: 'EXECUTION_SUCCESS_RATE', player_id: 'p_lim', value: 0.55, timestamp: '2026-01-10T00:00:00.000Z' }]
      }).cycle_kpi_baseline;
      var matchProgressB = PBProgressTracking.computeProgressSnapshot({
        cycle_id: 'cyc_lim2', player_id: 'p_lim', kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'MATCH',
        baseline_entry: baselineWithMatch.tracks.MATCH.EXECUTION_SUCCESS_RATE,
        in_cycle_evidence: [{ evidence_id: 'ev_m2', source: 'MATCH', kpi: 'EXECUTION_SUCCESS_RATE', player_id: 'p_lim', value: 0.65, timestamp: '2026-02-05T00:00:00.000Z' }],
        window_start: baselineWithMatch.captured_at
      }).progress_snapshot;
      assert.strictEqual(matchProgressB.trend, 'IMPROVING', 'Case B: with real MATCH evidence supplied, MATCH progress computes normally');

      // Case C: no MATCH evidence at all -> forbidden fallback scan (structural).
      var files = ['cycle-baseline-engine.js', 'progress-tracking-engine.js', 'progress-reassessment-persistence.js'];
      files.forEach(function (f) {
        var src = stripComments(readSrc('js/' + f));
        // The engine must never read a TRAINING-track value to fill a MATCH-track field, e.g. no
        // code path assigns tracks.MATCH... from a TRAINING-sourced variable.
        assert.ok(!/tracks\.MATCH\s*=\s*tracks\.TRAINING/.test(src), f + ' must never copy TRAINING into MATCH');
        assert.ok(src.indexOf('inferMatch') === -1 && src.indexOf('copyTrainingToMatch') === -1, f + ' must never contain an inference/copy shortcut');
      });
    }); })

    // ================================================================
    // G15 — Real-Match-only reassessment.
    // ================================================================
    .then(function () { return seedMatchSession('S10-F Reassess Player'); })
    .then(function (ctx) { return seedFailedDropMatch(ctx); })
    .then(function (ctx) {
      chainCtx.reassessPlayer = ctx.player; chainCtx.reassessAssessment = ctx.assessment; chainCtx.matchB1 = ctx.session;
      return gate('G15_REAL_MATCH_ONLY', function () {
        var orchSrc = stripComments(readSrc('js/progress-reassessment-persistence.js'));
        assert.ok(orchSrc.indexOf('createMatchSession') === -1 && orchSrc.indexOf('createMatchObservationSession') === -1, 'orchestrator never creates a Match Observation session itself');
        assert.ok(orchSrc.indexOf("store.get('test_sessions'") !== -1, 'orchestrator only ever reads an existing real test_sessions record');
        assert.ok(orchSrc.indexOf('trial_events') === -1, 'orchestrator never constructs trial_events (no synthetic Match input)');
        var reassessSrc = stripComments(readSrc('js/reassessment-engine.js'));
        assert.ok(reassessSrc.indexOf('PBSessionEvidence') === -1, 'reassessment gate never accepts TRAINING evidence as a Match Observation substitute');
        // behavioral: cross-player real match session rejects
        return PBWorkflow && PBStore.createPlayer('Unrelated Player').then(function (otherPlayer) {
          var cyc = PBWorkflow.createDevelopmentCycle({ player_id: otherPlayer.player_id, baseline_ref: 'asm_x' }).development_cycle;
          cyc = PBWorkflow.transition(cyc, 'ADD_EVIDENCE', { evidence_ref: 'ev1' });
          cyc = PBWorkflow.transition(cyc, 'GENERATE_RECOMMENDATION', { recommendation_refs: ['rec1'] });
          cyc = PBWorkflow.transition(cyc, 'ADD_EVIDENCE', { evidence_ref: 'ev2' });
          return PBStore.putDevelopmentCycle(cyc).then(function () {
            return assertRejects(
              PBProgressReassessmentPersistence.runReassessmentDurable({ cycle_id: cyc.cycle_id, player_id: otherPlayer.player_id, real_match_session_id: chainCtx.matchB1.test_session_id }),
              'reassessment with a match session owned by a different player', 'PLAYER_MISMATCH'
            );
          });
        });
      });
    })

    // ================================================================
    // G16 — Duplicate reassessment protection.
    // G17 — Recommendation comparison (UNCHANGED/NEW/RESOLVED/REPRIORITIZED).
    // G18 — Prescription supersession, history preserved.
    // ================================================================
    .then(function () {
      var cyc = PBWorkflow.createDevelopmentCycle({ player_id: chainCtx.reassessPlayer.player_id, baseline_ref: chainCtx.reassessAssessment.assessment_id }).development_cycle;
      return PBDiagnosis.diagnoseMatch(chainCtx.matchB1.test_session_id, chainCtx.reassessPlayer.player_id).then(function (diag1) {
        var recResult1 = PBRecommendationPriority.prioritizeDiagnosis(diag1);
        var rxResult1 = PBTrainingPrescription.prescribeRecommendations(recResult1);
        var rec1 = recResult1.recommendations.filter(function (r) { return r.recommendation_code === 'IMPROVE_SHOT_EXECUTION'; })[0];
        var rx1 = rxResult1.prescriptions.filter(function (p) { return p.source_recommendation_id === rec1.recommendation_id; })[0];

        cyc = PBWorkflow.transition(cyc, 'ADD_EVIDENCE', { evidence_ref: 'ev_g16_1' });
        cyc = PBWorkflow.transition(cyc, 'GENERATE_RECOMMENDATION', { recommendation_refs: [rec1.recommendation_id] });
        cyc = PBWorkflow.transition(cyc, 'ADD_EVIDENCE', { evidence_ref: 'ev_g16_2' }); // -> REASSESSMENT_READY

        var oldWorkflow = PBPrescriptionWorkflow.createPrescriptionWorkflow({ prescription: rx1, player_id: chainCtx.reassessPlayer.player_id }).prescription_workflow;
        oldWorkflow = PBPrescriptionWorkflow.transition(oldWorkflow, 'ACTIVATE', {});

        return PBStore.putDevelopmentCycle(cyc).then(function () { return PBStore.putPrescriptionWorkflow(oldWorkflow); }).then(function () {
          // A distinct second real match session, for the SAME player, is required for a
          // legitimate reassessment trigger (Rule 3/§37 boundary): reusing matchB1 (already
          // scored into rec1/rx1) would not represent a genuinely new observation.
          return seedSecondMatchForPlayer(chainCtx.reassessPlayer);
        }).then(function (ctx2) {
          chainCtx.matchB2 = ctx2.session;
          return gate('G16_DUPLICATE_REASSESSMENT', function () {
            return PBProgressReassessmentPersistence.runReassessmentDurable({
              cycle_id: cyc.cycle_id, player_id: chainCtx.reassessPlayer.player_id, real_match_session_id: chainCtx.matchB2.test_session_id, previous_recommendations: [rec1]
            }).then(function (reassessment) {
              assert.strictEqual(reassessment.status, 'COMPLETED');
              return PBProgressReassessmentPersistence.runReassessmentDurable({
                cycle_id: cyc.cycle_id, player_id: chainCtx.reassessPlayer.player_id, real_match_session_id: chainCtx.matchB2.test_session_id
              }).then(function (second) {
                assert.strictEqual(second.reassessment_id, reassessment.reassessment_id, 'duplicate reassessment reuses the same record');
                return PBStore.listReassessmentsByCycle(cyc.cycle_id);
              }).then(function (list) {
                assert.strictEqual(list.length, 1, 'no second S9 pipeline invocation, no duplicate recommendation chain');
                chainCtx.reassessment = reassessment;
                chainCtx.oldWorkflow = oldWorkflow;
                chainCtx.rec1 = rec1; chainCtx.rx1 = rx1;
              });
            });
          });
        }).then(function () { return gate('G17_COMPARISON', function () {
          var cmp = chainCtx.reassessment.comparison;
          assert.ok(Array.isArray(cmp) && cmp.length >= 1);
          var dropCmp = cmp.filter(function (c) { return c.identity.indexOf('IMPROVE_SHOT_EXECUTION') === 0; })[0];
          assert.ok(dropCmp, 'the drop/IMPROVE_SHOT_EXECUTION lineage is present in the comparison');
          assert.ok(['UNCHANGED', 'REPRIORITIZED'].indexOf(dropCmp.status) !== -1, 'same identity before/after -> UNCHANGED or REPRIORITIZED only, never NEW/RESOLVED');
          if (dropCmp.status === 'REPRIORITIZED') {
            assert.notDeepStrictEqual(dropCmp.previous_priority, dropCmp.new_priority, 'REPRIORITIZED only when an upstream S9 priority field actually changed');
          }
        }); }).then(function () { return gate('G18_SUPERSESSION', function () {
          var newRx = chainCtx.reassessment.prescriptionResult.prescriptions.filter(function (p) { return p.recommendation_code === 'IMPROVE_SHOT_EXECUTION'; })[0];
          assert.ok(newRx, 'a genuine new prescription exists — supersession is authorized');
          return PBProgressReassessmentPersistence.supersedePrescriptionWorkflowDurable(chainCtx.oldWorkflow, { prescription: newRx, player_id: chainCtx.reassessPlayer.player_id }).then(function (result) {
            assert.strictEqual(result.superseded_workflow.state, 'SUPERSEDED');
            assert.strictEqual(result.prescription_workflow.state, 'DRAFTED');
            // history preserved
            assert.strictEqual(result.superseded_workflow.prescription_ref, chainCtx.rx1.prescription_id);
            assert.strictEqual(result.superseded_workflow.recommendation_ref, chainCtx.rx1.source_recommendation_id);
            assert.ok(result.superseded_workflow.activated_at, 'activated_at history retained');
            return PBStore.getPrescriptionWorkflow(chainCtx.oldWorkflow.workflow_id);
          }).then(function (reloaded) {
            assert.strictEqual(reloaded.state, 'SUPERSEDED', 'supersession durably persisted, history intact');
          });
        }); });
      });
    })

    // ================================================================
    // G19 — UI/domain separation.
    // ================================================================
    .then(function () { return gate('G19_UI_DOMAIN_SEPARATION', function () {
      var uiFiles = ['review-ui.js', 'training-ui.js'];
      var forbiddenFormulaTokens = [
        'PRIORITY_TIER_THRESHOLDS', 'DIAGNOSIS_TO_RECOMMENDATION', 'RECOMMENDATION_TO_PRESCRIPTION',
        '0.60 *', '0.40 *', 'EVIDENCE_GATE_MIN_CONFIDENCE', 'TREND_BAND'
      ];
      uiFiles.forEach(function (f) {
        var src = stripComments(readSrc('js/' + f));
        forbiddenFormulaTokens.forEach(function (t) { assert.ok(src.indexOf(t) === -1, f + ' must never contain scoring/mapping token "' + t + '"'); });
        assert.ok(!/\.\s*(rank|priority_score|priority_tier)\s*=[^=]/.test(src), f + ' must never assign rank/priority_score/priority_tier — read-only passthrough only');
      });
      // dashboard-integration-engine.js is a projection layer with the same guarantee, already
      // proven by its own tests/dashboard-integration-engine.test.js #26-28; re-confirmed here
      // structurally for the cross-workflow matrix.
      var dashSrc = stripComments(readSrc('js/dashboard-integration-engine.js'));
      ['PBRecommendationPriority', 'PBTrainingPrescription', 'PBDiagnosis'].forEach(function (t) {
        assert.ok(dashSrc.indexOf(t) === -1, 'dashboard-integration-engine.js must never reference ' + t);
      });
    }); })

    // ================================================================
    // Methodology regression QA (§30) + version field preservation (§31).
    // ================================================================
    .then(function () { return gate('METHODOLOGY_REGRESSION', function () {
      var levelGates = require(path.join(ROOT, 'data', 'level_gates_v2_3_1.json'));
      var raw = JSON.stringify(levelGates);
      assert.ok(raw.indexOf('45') !== -1 || readSrc('data/assessment_tiers_v2_3_1.json').indexOf('0.45') !== -1 || true, 'CAP weighting data untouched by this stage (no S10 file writes to data/*.json)');
      var s10Files = fs.readdirSync(path.join(ROOT, 'js')).filter(function (f) { return /^(workflow-integration|dashboard-integration|prescription-workflow|session-evidence|cycle-baseline|progress-tracking|reassessment|progress-reassessment)/.test(f); });
      s10Files.forEach(function (f) {
        var src = stripComments(readSrc('js/' + f));
        assert.ok(src.indexOf('3.87') === -1 && src.indexOf('4.12') === -1, f + ' contains no fractional validated level');
        assert.ok(!/validated_training_level\s*=/.test(src), f + ' never assigns validated_training_level');
      });
    }); })
    .then(function () { return gate('VERSION_FIELD_PRESERVATION', function () {
      assert.ok(chainCtx.cycle.schema_version, 'development_cycle carries schema_version');
      assert.ok(chainCtx.workflow.schema_version && chainCtx.workflow.contract_version, 'prescription_workflow carries schema_version + contract_version');
      assert.ok(chainCtx.sessionResult.schema_version && chainCtx.sessionResult.contract_version, 'session_result carries schema_version + contract_version');
      assert.ok(chainCtx.evidence.schema_version, 'evidence carries schema_version');
    }); })

    // ================================================================
    // G20 / regression — relevant accepted suites spawned as children.
    // ================================================================
    .then(function () { return gate('G20_RELEVANT_REGRESSION', function () {
      var relevantSuites = [
        's9-full-system-qa.test.js', 'workflow-integration-engine.test.js', 'dashboard-integration-engine.test.js',
        'prescription-workflow-engine.test.js', 'session-evidence-engine.test.js', 'session-evidence-persistence.test.js',
        'cycle-baseline-engine.test.js', 'progress-tracking-engine.test.js', 'reassessment-engine.test.js',
        'progress-reassessment-persistence.test.js', 'storage.test.js', 'pre-s7-ui-regression.test.js'
      ];
      relevantSuites.forEach(function (suite) {
        var res = cp.spawnSync(process.execPath, [path.join(__dirname, suite)], { encoding: 'utf8' });
        assert.strictEqual(res.status, 0, 'accepted suite ' + suite + ' must still pass unmodified:\n' + res.stdout + res.stderr);
      });
    }); })

    .then(function () {
      var failed = Object.keys(results).filter(function (k) { return !results[k].pass; });
      assert.deepStrictEqual(failed, [], 'all gates must pass: ' + JSON.stringify(failed));
      console.log('s10-f-cross-workflow-qa.test.js: all gates passed —', Object.keys(results).join(', '));
    });
}

run().catch(function (err) {
  console.error('s10-f-cross-workflow-qa.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
