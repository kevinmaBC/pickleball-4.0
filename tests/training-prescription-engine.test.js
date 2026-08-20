/* tests/training-prescription-engine.test.js — S9-F: Training
 * Prescription Integration
 * Run: node tests/training-prescription-engine.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var createFakeIndexedDB = require('./fake-indexeddb');

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
  return global.PBTrainingPrescription;
}

function assertThrows(fn, label, expectedCode) {
  var threw = null;
  try { fn(); } catch (e) { threw = e; }
  assert.ok(threw instanceof Error, label + ' throws an Error');
  if (expectedCode) assert.strictEqual(threw.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + threw.code + ')');
}

// Minimal `recommended` Recommendation builder matching js/recommendation-priority-engine.js's shape.
function rec(overrides) {
  return Object.assign({
    recommendation_id: 'rec_x', match_id: 'm1', player_id: 'p1',
    diagnosis_code: 'SHOT_EXECUTION_GAP',
    skill: 'drop', context: null,
    recommendation_code: 'IMPROVE_SHOT_EXECUTION',
    source_skill_gap_ids: ['gap_1'],
    severity_score: 60, confidence_score: 65,
    diagnosis_priority_signal: 62, priority_score: 62, priority_tier: 'MEDIUM',
    reason_signals: [], rank: 1, status: 'recommended'
  }, overrides || {});
}

function recResult(overrides) {
  return Object.assign({
    match_id: 'm1', player_id: 'p1',
    recommendations: [], deferred_recommendations: [],
    top_recommendation_id: null, recommendation_count: 0, recommendation_version: 'S9-E-V1'
  }, overrides || {});
}

function baseRally(overrides) {
  return Object.assign({
    game_number: 1, rally_number: 1,
    phase: 'transition', intent: 'neutralize', shot: 'reset', target: 'middle',
    quality: 'good', movement: 'balanced', result: 'continue',
    control_state: 'neutral'
  }, overrides || {});
}

function run() {
  var P = freshEnv();

  return Promise.resolve()

    // ==== Input validation ====
    .then(function () {
      assertThrows(function () { P.prescribeRecommendations(null); }, 'null recommendationResult', 'INVALID_INPUT');
      assertThrows(function () { P.prescribeRecommendations({}); }, 'missing match_id', 'INVALID_INPUT');
      assertThrows(function () { P.prescribeRecommendations({ match_id: 'm1', recommendations: 'nope' }); }, 'non-array recommendations', 'INVALID_INPUT');
    })

    // ==== §38 All six frozen mappings ====
    .then(function () {
      var cases = [
        ['IMPROVE_SHOT_EXECUTION', 'SHOT_EXECUTION', 'TECHNICAL_REPETITION', 'SHOT_EXECUTION', 'EXECUTION_SUCCESS_RATE'],
        ['IMPROVE_SHOT_CONTROL', 'SHOT_CONTROL', 'CONTROL_REPETITION', 'SHOT_CONTROL', 'ERROR_RATE'],
        ['IMPROVE_SHOT_SELECTION', 'SHOT_SELECTION', 'DECISION_SCENARIO', 'SHOT_SELECTION', 'DECISION_SUCCESS_RATE'],
        ['IMPROVE_SHOT_CONSISTENCY', 'SHOT_CONSISTENCY', 'CONSISTENCY_BLOCK', 'SHOT_CONSISTENCY', 'CONSISTENCY_RATE'],
        ['IMPROVE_TRANSITION_EXECUTION', 'TRANSITION_EXECUTION', 'TRANSITION_SCENARIO', 'TRANSITION_EXECUTION', 'TRANSITION_SUCCESS_RATE'],
        ['IMPROVE_TRANSITION_CONTROL', 'TRANSITION_CONTROL', 'TRANSITION_SCENARIO', 'TRANSITION_CONTROL', 'TRANSITION_CONTROL_RATE']
      ];
      cases.forEach(function (c) {
        var result = P.prescribeRecommendations(recResult({ recommendations: [rec({ recommendation_code: c[0] })] }));
        assert.strictEqual(result.prescriptions.length, 1, c[0] + ' -> exactly one prescription');
        var p = result.prescriptions[0];
        assert.strictEqual(p.training_objective_code, c[1], c[0] + ' training_objective_code');
        assert.strictEqual(p.training_mode, c[2], c[0] + ' training_mode');
        assert.strictEqual(p.drill_family_code, c[3], c[0] + ' drill_family_code');
        assert.strictEqual(p.kpi_profile_code, c[4], c[0] + ' kpi_profile_code');
        assert.strictEqual(p.status, 'prescribed');
      });
    })

    // ==== §39 Unsupported recommendation: unknown code -> deferred, no guessing ====
    .then(function () {
      var result = P.prescribeRecommendations(recResult({ recommendations: [rec({ recommendation_code: 'UNKNOWN_RECOMMENDATION' })] }));
      assert.strictEqual(result.prescriptions.length, 0);
      assert.strictEqual(result.deferred_prescriptions.length, 1);
      assert.strictEqual(result.deferred_prescriptions[0].reason, 'UNSUPPORTED_RECOMMENDATION');
      assert.strictEqual(result.deferred_prescriptions[0].status, 'deferred');
    })

    // ==== §40 Priority inheritance: rank/score/tier carried through unchanged, never recomputed ====
    .then(function () {
      var result = P.prescribeRecommendations(recResult({ recommendations: [rec({ rank: 2, priority_score: 68, priority_tier: 'MEDIUM' })] }));
      var p = result.prescriptions[0];
      assert.strictEqual(p.priority_rank, 2);
      assert.strictEqual(p.priority_score, 68);
      assert.strictEqual(p.priority_tier, 'MEDIUM');
    })

    // ==== §41 Dosage profile: direct upstream-tier mapping, no re-derivation ====
    .then(function () {
      [['HIGH', 'PRIMARY_FOCUS'], ['MEDIUM', 'STANDARD_FOCUS'], ['LOW', 'LIGHT_FOCUS']].forEach(function (pair) {
        var result = P.prescribeRecommendations(recResult({ recommendations: [rec({ priority_tier: pair[0] })] }));
        assert.strictEqual(result.prescriptions[0].dosage_profile_code, pair[1], pair[0] + ' -> ' + pair[1]);
      });
    })

    // ==== §42 No drill resource: resolved_drill_ids empty, status still prescribed ====
    .then(function () {
      var result = P.prescribeRecommendations(recResult({ recommendations: [rec()] }));
      var p = result.prescriptions[0];
      assert.deepStrictEqual(p.resolved_drill_ids, []);
      assert.strictEqual(p.drill_resolution_status, 'UNRESOLVED');
      assert.strictEqual(p.status, 'prescribed', 'unresolved drill resource is not prescription failure');
    })

    // ==== §43 KPI target unresolved: no fabricated number ====
    .then(function () {
      var result = P.prescribeRecommendations(recResult({ recommendations: [rec()] }));
      var p = result.prescriptions[0];
      assert.strictEqual(p.kpi_target_value, null);
      assert.strictEqual(p.kpi_target_status, 'BENCHMARK_NOT_RESOLVED');
    })

    // ==== Reassessment profile: default, always MATCH_RECHECK ====
    .then(function () {
      var result = P.prescribeRecommendations(recResult({ recommendations: [rec()] }));
      assert.strictEqual(result.prescriptions[0].reassessment_profile_code, 'MATCH_RECHECK');
    })

    // ==== §44 Malformed recommendation tests: safe defer, never a crash ====
    .then(function () {
      var nullEntry = P.prescribeRecommendations(recResult({ recommendations: [null] }));
      assert.strictEqual(nullEntry.deferred_prescriptions[0].reason, 'INVALID_RECOMMENDATION');

      var emptyEntry = P.prescribeRecommendations(recResult({ recommendations: [{}] }));
      assert.strictEqual(emptyEntry.deferred_prescriptions[0].reason, 'INVALID_RECOMMENDATION');

      var wrongStatus = P.prescribeRecommendations(recResult({ recommendations: [rec({ status: 'something_else' })] }));
      assert.strictEqual(wrongStatus.deferred_prescriptions[0].reason, 'INVALID_RECOMMENDATION');

      var missingCode = P.prescribeRecommendations(recResult({ recommendations: [rec({ recommendation_code: null })] }));
      assert.strictEqual(missingCode.deferred_prescriptions[0].reason, 'INVALID_RECOMMENDATION');

      var missingRank = P.prescribeRecommendations(recResult({ recommendations: [rec({ rank: null })] }));
      assert.strictEqual(missingRank.deferred_prescriptions[0].reason, 'MISSING_PRIORITY');

      var missingScore = P.prescribeRecommendations(recResult({ recommendations: [rec({ priority_score: null })] }));
      assert.strictEqual(missingScore.deferred_prescriptions[0].reason, 'MISSING_PRIORITY');

      var missingTier = P.prescribeRecommendations(recResult({ recommendations: [rec({ priority_tier: null })] }));
      assert.strictEqual(missingTier.deferred_prescriptions[0].reason, 'MISSING_PRIORITY');
    })

    // ==== §45 No recommendations -> empty result ====
    .then(function () {
      var result = P.prescribeRecommendations(recResult({ recommendations: [] }));
      assert.deepStrictEqual(result.prescriptions, []);
      assert.strictEqual(result.prescription_count, 0);
      assert.strictEqual(result.primary_prescription_id, null);
    })

    // ==== §46 Primary prescription: source Recommendation.rank === 1 ====
    .then(function () {
      var recs = [
        rec({ recommendation_id: 'r1', rank: 1, skill: 'drop' }),
        rec({ recommendation_id: 'r2', rank: 2, skill: 'dink' }),
        rec({ recommendation_id: 'r3', rank: 3, skill: 'lob' })
      ];
      var result = P.prescribeRecommendations(recResult({ recommendations: recs }));
      var rank1 = result.prescriptions.filter(function (p) { return p.priority_rank === 1; })[0];
      assert.strictEqual(result.primary_prescription_id, rank1.prescription_id);
      assert.strictEqual(rank1.source_recommendation_id, 'r1');
    })

    // ==== §47 All eligible recommendations retained, no truncation ====
    .then(function () {
      var codes = ['IMPROVE_SHOT_EXECUTION', 'IMPROVE_SHOT_CONTROL', 'IMPROVE_SHOT_SELECTION', 'IMPROVE_SHOT_CONSISTENCY', 'IMPROVE_TRANSITION_EXECUTION'];
      var recs = codes.map(function (c, i) { return rec({ recommendation_id: 'r' + i, recommendation_code: c, rank: i + 1, skill: 'shot' + i }); });
      var result = P.prescribeRecommendations(recResult({ recommendations: recs }));
      assert.strictEqual(result.prescription_count, 5);
      assert.strictEqual(result.prescriptions.length, 5, 'no top-3/top-5 truncation');
    })

    // ==== §48 Determinism: same RecommendationResult twice -> identical output ====
    .then(function () {
      var input = recResult({ recommendations: [
        rec({ recommendation_id: 'r1', recommendation_code: 'IMPROVE_SHOT_EXECUTION' }),
        rec({ recommendation_id: 'r2', recommendation_code: 'IMPROVE_SHOT_CONTROL', rank: 2 })
      ] });
      var out1 = JSON.stringify(P.prescribeRecommendations(input));
      var out2 = JSON.stringify(P.prescribeRecommendations(input));
      assert.strictEqual(out1, out2);
    })

    // ==== §49 Traceability: source_recommendation_id maps back, no payload copy ====
    .then(function () {
      var result = P.prescribeRecommendations(recResult({ recommendations: [rec({ recommendation_id: 'rec_trace_me' })] }));
      var p = result.prescriptions[0];
      assert.strictEqual(p.source_recommendation_id, 'rec_trace_me');
      assert.strictEqual(Object.prototype.hasOwnProperty.call(p, 'source_skill_gap_ids'), false, 'S9-F never copies the recommendation payload (e.g. its source_skill_gap_ids) onto the prescription');
    })

    // ================================================================
    // Integration tests A/B/C
    // ================================================================

    // ==== A. Full loop: S9-B -> S9-C -> S9-D -> S9-E -> S9-F ====
    .then(function () {
      var MO = global.PBMatchObservation;
      var PA = global.PBPerformanceAnalysis;
      var D = global.PBDiagnosis;
      var Pr = global.PBRecommendationPriority;
      return global.PBStore.createPlayer('S9-F Test Player').then(function (player) {
        return global.PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 }).then(function (assessment) {
          return MO.createMatchSession({ assessment_id: assessment.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF' } })
            .then(function (session) {
              var chain = Promise.resolve();
              for (var i = 1; i <= 8; i++) { // 8 rallies -> S9-C 6-10 band, confidence 65, clears S9-D gate
                (function (i) {
                  chain = chain.then(function () {
                    return MO.addRallyObservation(session.test_session_id, baseRally({ game_number: 1, rally_number: i, shot: 'drop', quality: 'error', result: 'continue' }));
                  });
                })(i);
              }
              return chain.then(function () { return { session: session, player: player }; });
            });
        });
      }).then(function (ctx) {
        return PA.analyzeMatch(ctx.session.test_session_id, ctx.player.player_id).then(function (analysisSummary) {
          var diagnosis = D.diagnoseAnalysis(analysisSummary);
          var recommendationResult = Pr.prioritizeDiagnosis(diagnosis);
          var dropRec = recommendationResult.recommendations.filter(function (r) { return r.skill === 'drop'; })[0];
          assert.ok(dropRec, 'precondition: S9-E produced a drop recommendation');
          var prescriptionResult = P.prescribeRecommendations(recommendationResult);
          var rx = prescriptionResult.prescriptions.filter(function (p) { return p.skill === 'drop'; })[0];
          assert.ok(rx, 'A: full S9-B -> S9-C -> S9-D -> S9-E -> S9-F chain produces a prescription');
          assert.strictEqual(rx.recommendation_code, 'IMPROVE_SHOT_EXECUTION');
          assert.strictEqual(rx.training_objective_code, 'SHOT_EXECUTION');
          assert.strictEqual(rx.training_mode, 'TECHNICAL_REPETITION');
          assert.strictEqual(rx.kpi_profile_code, 'EXECUTION_SUCCESS_RATE');
          assert.strictEqual(rx.source_recommendation_id, dropRec.recommendation_id);

          // Also exercise the storage-backed convenience entry point end-to-end.
          return P.prescribeMatch(ctx.session.test_session_id, ctx.player.player_id).then(function (viaConvenience) {
            assert.deepStrictEqual(viaConvenience.prescriptions.map(function (p) { return p.recommendation_code; }).sort(),
              prescriptionResult.prescriptions.map(function (p) { return p.recommendation_code; }).sort());
          });
        });
      });
    })

    // ==== B. Low evidence: S9-C low confidence -> S9-D no gap -> S9-E no recommendation -> S9-F no prescription ====
    .then(function () {
      var MO = global.PBMatchObservation;
      var PA = global.PBPerformanceAnalysis;
      var D = global.PBDiagnosis;
      var Pr = global.PBRecommendationPriority;
      return global.PBStore.createPlayer('LowConfPlayer').then(function (player) {
        return global.PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 }).then(function (assessment) {
          return MO.createMatchSession({ assessment_id: assessment.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF' } })
            .then(function (session) {
              var chain = Promise.resolve();
              for (var i = 1; i <= 3; i++) { // 3 rallies -> LOW confidence band (35, < 40 S9-D gate)
                (function (i) {
                  chain = chain.then(function () {
                    return MO.addRallyObservation(session.test_session_id, baseRally({ game_number: 1, rally_number: i, shot: 'lob', quality: 'error', result: 'ue' }));
                  });
                })(i);
              }
              return chain.then(function () { return { session: session, player: player }; });
            });
        });
      }).then(function (ctx) {
        return PA.analyzeMatch(ctx.session.test_session_id, ctx.player.player_id).then(function (analysisSummary) {
          var diagnosis = D.diagnoseAnalysis(analysisSummary);
          var recommendationResult = Pr.prioritizeDiagnosis(diagnosis);
          assert.strictEqual(recommendationResult.recommendations.filter(function (r) { return r.skill === 'lob'; }).length, 0, 'precondition: no lob recommendation reached S9-F');
          var prescriptionResult = P.prescribeRecommendations(recommendationResult);
          assert.strictEqual(prescriptionResult.prescriptions.filter(function (p) { return p.skill === 'lob'; }).length, 0,
            'B: low upstream confidence never resurfaces as an S9-F prescription');
        });
      });
    })

    // ==== C. Unsupported semantics: unsupported upstream pattern -> deferred prescription, never a generic plan ====
    .then(function () {
      var D = global.PBDiagnosis;
      var Pr = global.PBRecommendationPriority;
      var analysisSummary = {
        match_id: 'm_unsupported', player_id: 'p1', data_status: 'complete',
        overall: {}, shot_metrics: [], situation_metrics: [], sequence_metrics: [],
        pattern_candidates: [{
          pattern_id: 'pat_unsupported', match_id: 'm_unsupported', player_id: 'p1',
          pattern_type: 'repeated_positioning_error', category: 'situational',
          shot_type: null, situation: 'defense', sample_size: 8,
          success_rate: 20, error_rate: 80, severity_score: 60, confidence_score: 90,
          confidence_band: 'HIGH', evidence: ['trl_1'], data_status: 'sufficient'
        }],
        analysis_confidence: 65
      };
      var diagnosis = D.diagnoseAnalysis(analysisSummary);
      var recommendationResult = Pr.prioritizeDiagnosis(diagnosis);
      assert.strictEqual(recommendationResult.recommendations.length, 0, 'precondition: no active S9-E recommendation for an unsupported pattern');
      var prescriptionResult = P.prescribeRecommendations(recommendationResult);
      assert.strictEqual(prescriptionResult.prescriptions.length, 0, 'C: unsupported upstream semantics never reach an S9-F prescription');
      assert.strictEqual(prescriptionResult.deferred_prescriptions.length, 0, 'S9-E already filtered it out before S9-F ever saw a recommendation for it');
    })

    // ==== Structural non-scope checks ====
    .then(function () {
      var src = fs.readFileSync(path.join(__dirname, '..', 'js', 'training-prescription-engine.js'), 'utf8');
      var codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      ['openai', 'anthropic', 'Math.random', 'rating_upgrade', 'rating_downgrade',
       'validated_training_level', 'weekly_schedule', 'training_calendar', 'session_duration', 'repetition_count',
       'PBStore', 'PBMatchObservation', 'PBPerformanceAnalysis', 'PBDiagnosis'].forEach(function (token) {
        assert.strictEqual(codeOnly.indexOf(token), -1, 'AC-F17/F18/F30: engine code must never reference ' + token);
      });
      assert.strictEqual(/\b[3-5]\.[05]\b/.test(codeOnly), false, 'AC-F35: no 3.0/3.5/4.0/4.5/5.0 benchmark literal in actual code');
      ['grip issue', 'paddle face issue', 'late contact', 'footwork issue', 'mental issue'].forEach(function (phrase) {
        assert.strictEqual(codeOnly.toLowerCase().indexOf(phrase), -1, 'AC-F36: no root-cause/biomechanics phrase "' + phrase + '"');
      });
    })

    .then(function () {
      console.log('training-prescription-engine.test.js: all assertions passed');
    });
}

run().catch(function (err) {
  console.error('training-prescription-engine.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
