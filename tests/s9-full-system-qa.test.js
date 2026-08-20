/* tests/s9-full-system-qa.test.js — S9-FINAL: Full-System QA / Final
 * Acceptance for the accepted S9-B -> S9-F pipeline.
 *
 * This is a system-level acceptance suite, not a unit-test duplicate of
 * each stage's own tests. It proves: dependency direction, source-of-
 * truth boundaries (statically via source inspection AND dynamically by
 * running downstream pure functions with upstream globals removed),
 * full happy-path/low-evidence/unsupported-semantics end-to-end flows,
 * null-vs-zero semantics, cross-stage traceability, determinism against
 * a fixed persisted input, priority/rank inheritance, no score
 * inflation, no fabricated KPI/drill/dosage, no rating leakage, and
 * partial-data resilience across the whole chain.
 *
 * FA-01/FA-02 (accepted HEAD, clean starting tree) and FA-23/FA-24
 * (full regression, production-code diff) are procedural/meta checks
 * performed once via git at QA time and recorded in
 * docs/S9-FINAL-ACCEPTANCE.md -- they are not asserted here, since a
 * hardcoded HEAD-SHA assertion would go stale the moment this file's
 * own commit lands. Every other gate (FA-03 through FA-22) is a real,
 * re-runnable regression assertion.
 *
 * Run: node tests/s9-full-system-qa.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var createFakeIndexedDB = require('./fake-indexeddb');

var ROOT = path.join(__dirname, '..');

function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); }

function freshEnv() {
  global.indexedDB = createFakeIndexedDB();
  delete require.cache[require.resolve('../js/namespace.js')];
  global.PBNamespace = require('../js/namespace.js');
  delete require.cache[require.resolve('../js/storage.js')];
  global.PBStore = require('../js/storage.js');
  delete require.cache[require.resolve('../js/match-observation-engine.js')];
  global.PBMatchObservation = require('../js/match-observation-engine.js');
  delete require.cache[require.resolve('../js/performance-analysis-engine.js')];
  global.PBPerformanceAnalysis = require('../js/performance-analysis-engine.js');
  delete require.cache[require.resolve('../js/diagnosis-engine.js')];
  global.PBDiagnosis = require('../js/diagnosis-engine.js');
  delete require.cache[require.resolve('../js/recommendation-priority-engine.js')];
  global.PBRecommendationPriority = require('../js/recommendation-priority-engine.js');
  delete require.cache[require.resolve('../js/training-prescription-engine.js')];
  global.PBTrainingPrescription = require('../js/training-prescription-engine.js');
}

function baseRally(overrides) {
  return Object.assign({
    game_number: 1, rally_number: 1,
    phase: 'transition', intent: 'neutralize', shot: 'reset', target: 'middle',
    quality: 'good', movement: 'balanced', result: 'continue',
    control_state: 'neutral'
  }, overrides || {});
}

function seedMatchSession(tier) {
  return global.PBStore.createPlayer('S9-FINAL QA Player').then(function (player) {
    return global.PBStore.createAssessment({ player_id: player.player_id, assessment_tier: tier || 'lite', target_training_level: 4.0 }).then(function (assessment) {
      return global.PBMatchObservation.createMatchSession({
        assessment_id: assessment.assessment_id, assessment_tier: tier || 'lite',
        match_context: { observer_role: 'SELF' }
      }).then(function (session) { return { player: player, assessment: assessment, session: session }; });
    });
  });
}

function addRallies(session_id, rallies) {
  var chain = Promise.resolve();
  rallies.forEach(function (r) {
    chain = chain.then(function () { return global.PBMatchObservation.addRallyObservation(session_id, baseRally(r)); });
  });
  return chain;
}

function findNoNanOrInfinity(obj, p, bad) {
  p = p || '$'; bad = bad || [];
  if (obj == null) return bad;
  if (typeof obj === 'number') { if (Number.isNaN(obj) || !Number.isFinite(obj)) bad.push(p + ' = ' + obj); return bad; }
  if (Array.isArray(obj)) { obj.forEach(function (v, i) { findNoNanOrInfinity(v, p + '[' + i + ']', bad); }); return bad; }
  if (typeof obj === 'object') { Object.keys(obj).forEach(function (k) { findNoNanOrInfinity(obj[k], p + '.' + k, bad); }); return bad; }
  return bad;
}

function runFullChain(session_id, player_id) {
  return global.PBPerformanceAnalysis.analyzeMatch(session_id, player_id).then(function (analysis) {
    var diagnosis = global.PBDiagnosis.diagnoseAnalysis(analysis);
    var recommendation = global.PBRecommendationPriority.prioritizeDiagnosis(diagnosis);
    var prescription = global.PBTrainingPrescription.prescribeRecommendations(recommendation);
    return { analysis: analysis, diagnosis: diagnosis, recommendation: recommendation, prescription: prescription };
  });
}

function run() {
  freshEnv();

  return Promise.resolve()

    // ================================================================
    // FA-03: Repository integrity -- accepted modules + their expected
    // API surface + accepted test files all present.
    // ================================================================
    .then(function () {
      var modules = [
        ['js/match-observation-engine.js', global.PBMatchObservation, ['createMatchSession', 'addRallyObservation', 'computeMatchMetrics', 'getObservationCompleteness']],
        ['js/performance-analysis-engine.js', global.PBPerformanceAnalysis, ['analyzeMatch', 'detectPatterns', 'PATTERN_TYPES']],
        ['js/diagnosis-engine.js', global.PBDiagnosis, ['diagnoseAnalysis', 'diagnoseMatch', 'PATTERN_TO_DIAGNOSIS', 'DIAGNOSIS_VERSION']],
        ['js/recommendation-priority-engine.js', global.PBRecommendationPriority, ['prioritizeDiagnosis', 'prioritizeMatch', 'DIAGNOSIS_TO_RECOMMENDATION', 'RECOMMENDATION_VERSION']],
        ['js/training-prescription-engine.js', global.PBTrainingPrescription, ['prescribeRecommendations', 'prescribeMatch', 'RECOMMENDATION_TO_PRESCRIPTION', 'PRESCRIPTION_VERSION']]
      ];
      modules.forEach(function (m) {
        assert.ok(fs.existsSync(path.join(ROOT, m[0])), 'FA-03: ' + m[0] + ' must exist');
        m[2].forEach(function (key) {
          assert.ok(Object.prototype.hasOwnProperty.call(m[1], key), 'FA-03: ' + m[0] + ' must still export ' + key);
        });
      });
      var testFiles = ['match-observation-engine.test.js', 'performance-analysis-engine.test.js', 'diagnosis-engine.test.js', 'recommendation-priority-engine.test.js', 'training-prescription-engine.test.js'];
      testFiles.forEach(function (t) {
        assert.ok(fs.existsSync(path.join(ROOT, 'tests', t)), 'FA-03: accepted test file tests/' + t + ' must exist (not removed)');
      });

      // §27 Version contracts: exist and are unrenamed.
      assert.strictEqual(global.PBDiagnosis.DIAGNOSIS_VERSION, 'S9-D-V1', 'FA-03: DIAGNOSIS_VERSION unrenamed');
      assert.strictEqual(global.PBRecommendationPriority.RECOMMENDATION_VERSION, 'S9-E-V1', 'FA-03: RECOMMENDATION_VERSION unrenamed');
      assert.strictEqual(global.PBTrainingPrescription.PRESCRIPTION_VERSION, 'S9-F-V1', 'FA-03: PRESCRIPTION_VERSION unrenamed');
      // S9-C's AnalysisSummary contract has no dedicated version constant (predates the *_VERSION
      // convention introduced at S9-D) -- its "still consumable downstream" property is proven
      // structurally by the full happy-path chain below, not by a version literal.
    })

    // ================================================================
    // FA-04: Dependency direction correct (static source inspection,
    // comment-stripped to avoid false positives from boundary-
    // documenting prose that names forbidden symbols on purpose).
    // ================================================================
    .then(function () {
      var expectations = [
        // [file, symbols that MAY appear as PBXxx. actual usage, symbols that must NOT appear at all]
        ['js/performance-analysis-engine.js', ['PBStore', 'PBNamespace', 'PBMatchObservation'], ['PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription']],
        ['js/diagnosis-engine.js', ['PBPerformanceAnalysis'], ['PBStore', 'PBMatchObservation', 'PBRecommendationPriority', 'PBTrainingPrescription']],
        ['js/recommendation-priority-engine.js', ['PBDiagnosis'], ['PBStore', 'PBMatchObservation', 'PBPerformanceAnalysis', 'PBTrainingPrescription']],
        ['js/training-prescription-engine.js', ['PBRecommendationPriority'], ['PBStore', 'PBMatchObservation', 'PBPerformanceAnalysis', 'PBDiagnosis']]
      ];
      expectations.forEach(function (e) {
        var code = stripComments(readSrc(e[0]));
        e[1].forEach(function (allowed) {
          assert.ok(code.indexOf(allowed + '.') !== -1 || code.indexOf('typeof ' + allowed) !== -1,
            'FA-04: ' + e[0] + ' must reference its one legitimate upstream dependency ' + allowed);
        });
        e[2].forEach(function (forbidden) {
          assert.strictEqual(code.indexOf(forbidden), -1, 'FA-04: ' + e[0] + ' must never reference ' + forbidden + ' (wrong dependency direction / bypasses a Source of Truth)');
        });
      });
    })

    // ================================================================
    // FA-05: Source-of-truth boundaries intact -- dynamic proof, not
    // just static grep. Delete every upstream-of-S9-D global and prove
    // S9-D/S9-E/S9-F's PURE functions still work correctly using only
    // the argument object passed to them -- zero runtime dependency on
    // anything above their one legitimate Source of Truth.
    // ================================================================
    .then(function () {
      var savedStore = global.PBStore, savedMO = global.PBMatchObservation, savedPA = global.PBPerformanceAnalysis, savedD = global.PBDiagnosis;
      delete global.PBStore; delete global.PBMatchObservation; delete global.PBPerformanceAnalysis; delete global.PBDiagnosis;
      try {
        var fakeAnalysis = {
          match_id: 'm_iso', player_id: 'p_iso', data_status: 'complete',
          overall: {}, shot_metrics: [], situation_metrics: [], sequence_metrics: [],
          pattern_candidates: [{
            pattern_id: 'pat_iso', match_id: 'm_iso', player_id: 'p_iso',
            pattern_type: 'low_success_rate', category: 'execution', shot_type: 'drop', situation: null,
            sample_size: 8, success_rate: 20, error_rate: 10, severity_score: 55, confidence_score: 65,
            confidence_band: 'MEDIUM', evidence: ['trl_iso_1'], data_status: 'sufficient'
          }],
          analysis_confidence: 65
        };
        // PBDiagnosis was required earlier and captured no reference to PBPerformanceAnalysis at
        // require-time (the guard checks `typeof` at call-time) -- diagnoseAnalysis (pure) must
        // still work with PBPerformanceAnalysis deleted.
        var diagnosis = savedD.diagnoseAnalysis(fakeAnalysis);
        assert.strictEqual(diagnosis.skill_gaps.length, 1, 'FA-05: PBDiagnosis.diagnoseAnalysis works with PBStore/PBMatchObservation/PBPerformanceAnalysis all removed from global scope');

        delete global.PBDiagnosis; // now also remove S9-D itself before exercising S9-E/S9-F
        var recommendation = global.PBRecommendationPriority.prioritizeDiagnosis(diagnosis);
        assert.strictEqual(recommendation.recommendations.length, 1, 'FA-05: PBRecommendationPriority.prioritizeDiagnosis works with every upstream-of-S9-D global (and PBDiagnosis itself) removed');

        var prescription = global.PBTrainingPrescription.prescribeRecommendations(recommendation);
        assert.strictEqual(prescription.prescriptions.length, 1, 'FA-05: PBTrainingPrescription.prescribeRecommendations works with every upstream-of-S9-E global removed');
      } finally {
        global.PBStore = savedStore; global.PBMatchObservation = savedMO; global.PBPerformanceAnalysis = savedPA; global.PBDiagnosis = savedD;
      }
    })

    // ================================================================
    // FA-06: Full happy-path E2E -- constructed with real system rules,
    // no upstream threshold changed, per §11's SHOT_EXECUTION_GAP target.
    // ================================================================
    .then(function () {
      return seedMatchSession('lite');
    }).then(function (ctx) {
      // 8 rallies of a failed drop (quality='error', result != 'ue') -> S9-C 6-10 sample band
      // (confidence 65) with success_rate 0% (< 50) -> low_success_rate only (not high_error_rate,
      // since result stays non-'ue') -> S9-D SHOT_EXECUTION_GAP -> S9-E IMPROVE_SHOT_EXECUTION.
      var rallies = [];
      for (var i = 1; i <= 8; i++) rallies.push({ game_number: 1, rally_number: i, shot: 'drop', quality: 'error', result: 'continue' });
      return addRallies(ctx.session.test_session_id, rallies).then(function () { return ctx; });
    }).then(function (ctx) {
      global.__qaHappyPathCtx = ctx; // reused by FA-10/FA-11/FA-12/FA-13
      return runFullChain(ctx.session.test_session_id, ctx.player.player_id);
    }).then(function (chain) {
      global.__qaHappyPathChain = chain;
      var pattern = chain.analysis.pattern_candidates.filter(function (p) { return p.pattern_type === 'low_success_rate' && p.shot_type === 'drop'; })[0];
      assert.ok(pattern, 'FA-06: PatternCandidate exists (low_success_rate, drop)');
      var gap = chain.diagnosis.skill_gaps.filter(function (g) { return g.diagnosis_code === 'SHOT_EXECUTION_GAP' && g.skill === 'drop'; })[0];
      assert.ok(gap, 'FA-06: SkillGap exists (SHOT_EXECUTION_GAP)');
      var rec = chain.recommendation.recommendations.filter(function (r) { return r.recommendation_code === 'IMPROVE_SHOT_EXECUTION'; })[0];
      assert.ok(rec, 'FA-06: Recommendation exists (IMPROVE_SHOT_EXECUTION)');
      var rx = chain.prescription.prescriptions.filter(function (p) { return p.recommendation_code === 'IMPROVE_SHOT_EXECUTION'; })[0];
      assert.ok(rx, 'FA-06: Prescription exists');
      assert.strictEqual(rx.training_objective_code, 'SHOT_EXECUTION');
      assert.strictEqual(rx.training_mode, 'TECHNICAL_REPETITION');
      assert.strictEqual(rx.kpi_profile_code, 'EXECUTION_SUCCESS_RATE');
      assert.strictEqual(rx.source_recommendation_id, rec.recommendation_id, 'FA-06: Prescription.source_recommendation_id -> Recommendation.recommendation_id');
      assert.deepStrictEqual(findNoNanOrInfinity(chain.prescription), [], 'FA-06: no NaN/Infinity anywhere in the happy-path chain output');
    })

    // ================================================================
    // FA-07: Low-evidence path -- NO EVIDENCE != BAD PERFORMANCE.
    // ================================================================
    .then(function () {
      return seedMatchSession('lite');
    }).then(function (ctx) {
      var rallies = [];
      for (var i = 1; i <= 3; i++) rallies.push({ game_number: 1, rally_number: i, shot: 'lob', quality: 'error', result: 'ue' }); // 3 rallies -> LOW confidence (35, < 40 gate)
      return addRallies(ctx.session.test_session_id, rallies).then(function () { return ctx; });
    }).then(function (ctx) {
      return runFullChain(ctx.session.test_session_id, ctx.player.player_id);
    }).then(function (chain) {
      var pattern = chain.analysis.pattern_candidates.filter(function (p) { return p.shot_type === 'lob'; })[0];
      assert.ok(pattern && pattern.confidence_score < 40, 'FA-07: precondition -- a low-confidence pattern exists for lob');
      assert.strictEqual(chain.diagnosis.skill_gaps.filter(function (g) { return g.skill === 'lob'; }).length, 0, 'FA-07: S9-D produces no supported SkillGap for low-confidence evidence');
      assert.strictEqual(chain.recommendation.recommendations.filter(function (r) { return r.skill === 'lob'; }).length, 0, 'FA-07: S9-E produces no active Recommendation');
      assert.strictEqual(chain.prescription.prescriptions.filter(function (p) { return p.skill === 'lob'; }).length, 0, 'FA-07: S9-F produces no Prescription');
    })

    // ================================================================
    // FA-08: Unsupported semantics at every stage -- no generic fallback.
    // ================================================================
    .then(function () {
      // unsupported pattern -> no supported diagnosis
      var analysisSummary = {
        match_id: 'm_unsupported', player_id: 'p1', data_status: 'complete',
        overall: {}, shot_metrics: [], situation_metrics: [], sequence_metrics: [],
        pattern_candidates: [{
          pattern_id: 'pat_unsupported', match_id: 'm_unsupported', player_id: 'p1',
          pattern_type: 'repeated_positioning_error', category: 'situational', shot_type: null, situation: 'defense',
          sample_size: 8, success_rate: 20, error_rate: 80, severity_score: 60, confidence_score: 90,
          confidence_band: 'HIGH', evidence: ['trl_1'], data_status: 'sufficient'
        }],
        analysis_confidence: 65
      };
      var diagnosis = global.PBDiagnosis.diagnoseAnalysis(analysisSummary);
      assert.strictEqual(diagnosis.skill_gaps.length, 0, 'FA-08: unsupported pattern -> no supported diagnosis');
      assert.strictEqual(diagnosis.insufficient_evidence[0].reason, 'UNSUPPORTED_PATTERN');

      // unsupported diagnosis_code -> deferred recommendation
      var diagnosisResult = {
        match_id: 'm2', player_id: 'p1', data_status: 'complete',
        skill_gaps: [{
          skill_gap_id: 'gap_x', match_id: 'm2', player_id: 'p1', gap_domain: 'shot_execution', gap_type: 'execution',
          skill: 'drop', context: null, diagnosis_code: 'UNKNOWN_GAP_CODE',
          severity_score: 60, confidence_score: 65, priority_signal: 62,
          evidence_pattern_ids: ['pat_x'], evidence_metric_refs: ['shot_metrics:drop'], status: 'supported'
        }],
        insufficient_evidence: [], diagnosis_confidence: 65, diagnosis_version: 'S9-D-V1'
      };
      var recommendation = global.PBRecommendationPriority.prioritizeDiagnosis(diagnosisResult);
      assert.strictEqual(recommendation.recommendations.length, 0, 'FA-08: unsupported diagnosis_code -> no active recommendation');
      assert.strictEqual(recommendation.deferred_recommendations[0].reason, 'UNSUPPORTED_DIAGNOSIS', 'FA-08: unsupported diagnosis_code defers with UNSUPPORTED_DIAGNOSIS');

      // unsupported recommendation_code -> deferred prescription
      var recommendationResult = {
        match_id: 'm3', player_id: 'p1', recommendations: [{
          recommendation_id: 'rec_x', match_id: 'm3', player_id: 'p1', diagnosis_code: 'SHOT_EXECUTION_GAP',
          skill: 'drop', context: null, recommendation_code: 'UNKNOWN_RECOMMENDATION_CODE',
          source_skill_gap_ids: ['gap_x'], severity_score: 60, confidence_score: 65,
          diagnosis_priority_signal: 62, priority_score: 62, priority_tier: 'MEDIUM',
          reason_signals: [], rank: 1, status: 'recommended'
        }], deferred_recommendations: [], top_recommendation_id: 'rec_x', recommendation_count: 1, recommendation_version: 'S9-E-V1'
      };
      var prescription = global.PBTrainingPrescription.prescribeRecommendations(recommendationResult);
      assert.strictEqual(prescription.prescriptions.length, 0, 'FA-08: unsupported recommendation_code -> no prescription');
      assert.strictEqual(prescription.deferred_prescriptions[0].reason, 'UNSUPPORTED_RECOMMENDATION');
    })

    // ================================================================
    // FA-09: null != zero semantics, end to end.
    // ================================================================
    .then(function () {
      // missing priority_signal -> deferred, never treated as 0
      var diagnosisResult = {
        match_id: 'm4', player_id: 'p1', data_status: 'complete',
        skill_gaps: [{
          skill_gap_id: 'gap_np', match_id: 'm4', player_id: 'p1', gap_domain: 'shot_execution', gap_type: 'execution',
          skill: 'drop', context: null, diagnosis_code: 'SHOT_EXECUTION_GAP',
          severity_score: 60, confidence_score: 65, priority_signal: null,
          evidence_pattern_ids: ['pat_np'], evidence_metric_refs: [], status: 'supported'
        }],
        insufficient_evidence: [], diagnosis_confidence: 65, diagnosis_version: 'S9-D-V1'
      };
      var recommendation = global.PBRecommendationPriority.prioritizeDiagnosis(diagnosisResult);
      assert.strictEqual(recommendation.recommendations.length, 0, 'FA-09: null priority_signal never becomes an active recommendation');
      assert.strictEqual(recommendation.deferred_recommendations[0].reason, 'MISSING_PRIORITY_SIGNAL');

      // unresolved KPI/drill on a legitimately prescribed recommendation must stay null/[]/'UNRESOLVED', never 0/false
      var recommendationResult = {
        match_id: 'm5', player_id: 'p1', recommendations: [{
          recommendation_id: 'rec_np', match_id: 'm5', player_id: 'p1', diagnosis_code: 'SHOT_EXECUTION_GAP',
          skill: 'drop', context: null, recommendation_code: 'IMPROVE_SHOT_EXECUTION',
          source_skill_gap_ids: ['gap_np'], severity_score: 60, confidence_score: 65,
          diagnosis_priority_signal: 62, priority_score: 62, priority_tier: 'MEDIUM',
          reason_signals: [], rank: 1, status: 'recommended'
        }], deferred_recommendations: [], top_recommendation_id: 'rec_np', recommendation_count: 1, recommendation_version: 'S9-E-V1'
      };
      var prescription = global.PBTrainingPrescription.prescribeRecommendations(recommendationResult);
      var rx = prescription.prescriptions[0];
      assert.strictEqual(rx.kpi_target_value, null, 'FA-09: kpi_target_value is null, never 0/fabricated');
      assert.strictEqual(rx.kpi_target_status, 'BENCHMARK_NOT_RESOLVED');
      assert.deepStrictEqual(rx.resolved_drill_ids, [], 'FA-09: resolved_drill_ids is [], never fabricated');
      assert.strictEqual(rx.drill_resolution_status, 'UNRESOLVED');
      assert.notStrictEqual(rx.status, 'failed');
      assert.strictEqual(rx.status, 'prescribed', 'FA-09: unresolved KPI/drill does not become status=false/failed');
    })

    // ================================================================
    // FA-10: Traceability -- full ID chain, happy path.
    // ================================================================
    .then(function () {
      var chain = global.__qaHappyPathChain;
      var rx = chain.prescription.prescriptions.filter(function (p) { return p.recommendation_code === 'IMPROVE_SHOT_EXECUTION'; })[0];
      var rec = chain.recommendation.recommendations.filter(function (r) { return r.recommendation_id === rx.source_recommendation_id; })[0];
      assert.ok(rec, 'FA-10: Prescription.source_recommendation_id resolves to a real Recommendation');
      var gap = chain.diagnosis.skill_gaps.filter(function (g) { return rec.source_skill_gap_ids.indexOf(g.skill_gap_id) !== -1; })[0];
      assert.ok(gap, 'FA-10: Recommendation.source_skill_gap_ids resolves to a real SkillGap');
      var pattern = chain.analysis.pattern_candidates.filter(function (p) { return gap.evidence_pattern_ids.indexOf(p.pattern_id) !== -1; })[0];
      assert.ok(pattern, 'FA-10: SkillGap.evidence_pattern_ids resolves to a real PatternCandidate');
      return global.PBStore.trialsBySession(global.__qaHappyPathCtx.session.test_session_id).then(function (trials) {
        var trialIds = trials.map(function (t) { return t.trial_event_id; });
        pattern.evidence.forEach(function (evId) {
          assert.ok(trialIds.indexOf(evId) !== -1, 'FA-10: PatternCandidate.evidence[' + evId + '] resolves to a real persisted trial_event (Observation evidence)');
        });
      });
    })

    // ================================================================
    // FA-11: Determinism against a fixed persisted input -- run the
    // downstream pipeline twice on the SAME already-persisted match.
    // ================================================================
    .then(function () {
      var ctx = global.__qaHappyPathCtx;
      return runFullChain(ctx.session.test_session_id, ctx.player.player_id).then(function (runA) {
        return runFullChain(ctx.session.test_session_id, ctx.player.player_id).then(function (runB) {
          assert.strictEqual(JSON.stringify(runA.analysis), JSON.stringify(runB.analysis), 'FA-11: Analysis deterministic across runs');
          assert.strictEqual(JSON.stringify(runA.diagnosis), JSON.stringify(runB.diagnosis), 'FA-11: Diagnosis deterministic across runs');
          assert.strictEqual(JSON.stringify(runA.recommendation), JSON.stringify(runB.recommendation), 'FA-11: Recommendation deterministic across runs');
          assert.strictEqual(JSON.stringify(runA.prescription), JSON.stringify(runB.prescription), 'FA-11: Prescription deterministic across runs');
        });
      });
    })

    // ================================================================
    // FA-12/FA-13: Priority + rank inheritance, exact equality end to end.
    // ================================================================
    .then(function () {
      var chain = global.__qaHappyPathChain;
      var gap = chain.diagnosis.skill_gaps.filter(function (g) { return g.diagnosis_code === 'SHOT_EXECUTION_GAP'; })[0];
      var rec = chain.recommendation.recommendations.filter(function (r) { return r.source_skill_gap_ids.indexOf(gap.skill_gap_id) !== -1; })[0];
      var rx = chain.prescription.prescriptions.filter(function (p) { return p.source_recommendation_id === rec.recommendation_id; })[0];

      assert.strictEqual(gap.priority_signal, rec.priority_score, 'FA-12: SkillGap.priority_signal === Recommendation.priority_score');
      assert.strictEqual(rec.priority_score, rx.priority_score, 'FA-12: Recommendation.priority_score === Prescription.priority_score');
      assert.strictEqual(rec.rank, rx.priority_rank, 'FA-13: Recommendation.rank === Prescription.priority_rank');
      assert.strictEqual(rec.priority_tier, rx.priority_tier, 'FA-13: Recommendation.priority_tier === Prescription.priority_tier');
    })

    // ================================================================
    // FA-14: No score inflation on dedup -- max aggregation, never sum.
    // ================================================================
    .then(function () {
      var diagnosisResult = {
        match_id: 'm_inflate', player_id: 'p1', data_status: 'complete',
        skill_gaps: [
          {
            skill_gap_id: 'gap_a', match_id: 'm_inflate', player_id: 'p1', gap_domain: 'shot_execution', gap_type: 'execution',
            skill: 'drop', context: null, diagnosis_code: 'SHOT_EXECUTION_GAP',
            severity_score: 70, confidence_score: 65, priority_signal: 68,
            evidence_pattern_ids: ['pat_a'], evidence_metric_refs: [], status: 'supported'
          },
          {
            skill_gap_id: 'gap_b', match_id: 'm_inflate', player_id: 'p1', gap_domain: 'shot_execution', gap_type: 'execution',
            skill: 'drop', context: null, diagnosis_code: 'SHOT_EXECUTION_GAP',
            severity_score: 90, confidence_score: 50, priority_signal: 74,
            evidence_pattern_ids: ['pat_b'], evidence_metric_refs: [], status: 'supported'
          }
        ],
        insufficient_evidence: [], diagnosis_confidence: 65, diagnosis_version: 'S9-D-V1'
      };
      var recommendation = global.PBRecommendationPriority.prioritizeDiagnosis(diagnosisResult);
      assert.strictEqual(recommendation.recommendations.length, 1, 'FA-14: same identity -> one merged recommendation');
      assert.strictEqual(recommendation.recommendations[0].priority_score, 74, 'FA-14: priority_score = max(68,74) = 74, never 68+74=142');
      assert.notStrictEqual(recommendation.recommendations[0].priority_score, 142);
    })

    // ================================================================
    // FA-15/FA-16/FA-17: No arbitrary KPI benchmark / training dosage /
    // fabricated drill, anywhere in S9-C~F production source (structural
    // scan, comment-stripped) and behaviorally on the happy-path output.
    // ================================================================
    .then(function () {
      var files = ['js/performance-analysis-engine.js', 'js/diagnosis-engine.js', 'js/recommendation-priority-engine.js', 'js/training-prescription-engine.js'];
      var forbidden = ['reps', 'balls', 'minutes', 'sessions/week', 'session_duration', 'weekly_frequency', 'repetition_count', 'training_calendar', 'weekly_schedule'];
      files.forEach(function (f) {
        var code = stripComments(readSrc(f)).toLowerCase();
        forbidden.forEach(function (token) {
          assert.strictEqual(code.indexOf(token), -1, 'FA-15/16/17: ' + f + ' code must never contain "' + token + '"');
        });
      });
      var chain = global.__qaHappyPathChain;
      var rx = chain.prescription.prescriptions[0];
      assert.strictEqual(rx.kpi_target_value, null, 'FA-15: no invented numerical KPI target on a real prescription');
      assert.ok(['PRIMARY_FOCUS', 'STANDARD_FOCUS', 'LIGHT_FOCUS'].indexOf(rx.dosage_profile_code) !== -1, 'FA-16: dosage_profile_code is one of the three relative labels, never a number');
      assert.deepStrictEqual(rx.resolved_drill_ids, [], 'FA-17: no fabricated drill id on a real prescription');
    })

    // ================================================================
    // FA-18: No rating leakage anywhere in S9-B~F production source.
    // ================================================================
    .then(function () {
      var files = ['js/match-observation-engine.js', 'js/performance-analysis-engine.js', 'js/diagnosis-engine.js', 'js/recommendation-priority-engine.js', 'js/training-prescription-engine.js'];
      var forbidden = ['rating_upgrade', 'rating_downgrade', 'validated_training_level', 'dupr_prediction'];
      files.forEach(function (f) {
        var code = stripComments(readSrc(f)).toLowerCase();
        forbidden.forEach(function (token) {
          assert.strictEqual(code.indexOf(token), -1, 'FA-18: ' + f + ' code must never reference ' + token);
        });
      });
    })

    // ================================================================
    // FA-19/FA-20: Drill/KPI unresolved semantics are legal, non-failure
    // states (re-asserted explicitly, distinct from FA-09's null check).
    // ================================================================
    .then(function () {
      var chain = global.__qaHappyPathChain;
      var rx = chain.prescription.prescriptions[0];
      assert.deepStrictEqual(rx.resolved_drill_ids, []);
      assert.strictEqual(rx.drill_resolution_status, 'UNRESOLVED');
      assert.strictEqual(rx.kpi_target_value, null);
      assert.strictEqual(rx.kpi_target_status, 'BENCHMARK_NOT_RESOLVED');
      assert.strictEqual(rx.status, 'prescribed', 'FA-19/FA-20: unresolved drill AND unresolved KPI coexist with a fully valid prescribed status');
    })

    // ================================================================
    // FA-21: Reassessment loop valid -- MATCH_RECHECK only, no auto
    // progression anywhere in production source.
    // ================================================================
    .then(function () {
      var chain = global.__qaHappyPathChain;
      chain.prescription.prescriptions.forEach(function (p) {
        assert.strictEqual(p.reassessment_profile_code, 'MATCH_RECHECK');
      });
      var files = ['js/diagnosis-engine.js', 'js/recommendation-priority-engine.js', 'js/training-prescription-engine.js'];
      files.forEach(function (f) {
        var code = stripComments(readSrc(f)).toLowerCase();
        ['auto_progression', 'auto_promote', 'auto_success'].forEach(function (token) {
          assert.strictEqual(code.indexOf(token), -1, 'FA-21: ' + f + ' must never implement ' + token);
        });
      });
    })

    // ================================================================
    // FA-22: Partial-data resilience across the whole chain.
    // ================================================================
    .then(function () {
      // Empty arrays at every stage boundary.
      var emptyDiagnosis = global.PBDiagnosis.diagnoseAnalysis({ match_id: 'm_empty', player_id: 'p1', data_status: 'insufficient', pattern_candidates: [] });
      assert.deepStrictEqual(emptyDiagnosis.skill_gaps, []);
      var emptyRec = global.PBRecommendationPriority.prioritizeDiagnosis({ match_id: 'm_empty', player_id: 'p1', skill_gaps: [] });
      assert.deepStrictEqual(emptyRec.recommendations, []);
      var emptyRx = global.PBTrainingPrescription.prescribeRecommendations({ match_id: 'm_empty', player_id: 'p1', recommendations: [] });
      assert.deepStrictEqual(emptyRx.prescriptions, []);

      // null optional skill/context, malformed downstream objects, missing optional fields.
      var recommendationResult = {
        match_id: 'm_partial', player_id: null, recommendations: [
          null, {}, { status: 'not_recommended' },
          {
            recommendation_id: 'rec_ok', match_id: 'm_partial', player_id: null, diagnosis_code: 'TRANSITION_EXECUTION_GAP',
            skill: null, context: 'transition', recommendation_code: 'IMPROVE_TRANSITION_EXECUTION',
            source_skill_gap_ids: ['gap_ok'], severity_score: 60, confidence_score: 65,
            diagnosis_priority_signal: 62, priority_score: 62, priority_tier: 'MEDIUM',
            reason_signals: [], rank: 1, status: 'recommended'
          }
        ], deferred_recommendations: [], top_recommendation_id: null, recommendation_count: 4, recommendation_version: 'S9-E-V1'
      };
      var prescription = global.PBTrainingPrescription.prescribeRecommendations(recommendationResult);
      assert.strictEqual(prescription.prescriptions.length, 1, 'FA-22: 3 malformed entries deferred safely, 1 valid null-skill entry still prescribed');
      assert.strictEqual(prescription.prescriptions[0].skill, null, 'FA-22: null skill is legal, not a crash');
      assert.strictEqual(prescription.deferred_prescriptions.length, 3);
      assert.deepStrictEqual(findNoNanOrInfinity(prescription), []);
    })

    .then(function () {
      console.log('s9-full-system-qa.test.js: all assertions passed');
    });
}

run().catch(function (err) {
  console.error('s9-full-system-qa.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
