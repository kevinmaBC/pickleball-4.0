/* tests/recommendation-priority-engine.test.js — S9-E: Recommendation
 * Prioritization Engine
 * Run: node tests/recommendation-priority-engine.test.js
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
  return global.PBRecommendationPriority;
}

function assertThrows(fn, label, expectedCode) {
  var threw = null;
  try { fn(); } catch (e) { threw = e; }
  assert.ok(threw instanceof Error, label + ' throws an Error');
  if (expectedCode) assert.strictEqual(threw.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + threw.code + ')');
}

// Minimal supported SkillGap builder matching js/diagnosis-engine.js's shape.
function gap(overrides) {
  return Object.assign({
    skill_gap_id: 'gap_x', match_id: 'm1', player_id: 'p1',
    gap_domain: 'shot_execution', gap_type: 'execution',
    skill: 'drop', context: null,
    diagnosis_code: 'SHOT_EXECUTION_GAP',
    severity_score: 60, confidence_score: 65, priority_signal: 62,
    evidence_pattern_ids: ['pat_1'], evidence_metric_refs: ['shot_metrics:drop'],
    status: 'supported'
  }, overrides || {});
}

function diagnosisResult(overrides) {
  return Object.assign({
    match_id: 'm1', player_id: 'p1', data_status: 'complete',
    skill_gaps: [], insufficient_evidence: [], diagnosis_confidence: null,
    diagnosis_version: 'S9-D-V1'
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
  var R = freshEnv();

  return Promise.resolve()

    // ==== Input validation ====
    .then(function () {
      assertThrows(function () { R.prioritizeDiagnosis(null); }, 'null diagnosisResult', 'INVALID_INPUT');
      assertThrows(function () { R.prioritizeDiagnosis({}); }, 'missing match_id', 'INVALID_INPUT');
      assertThrows(function () { R.prioritizeDiagnosis({ match_id: 'm1', skill_gaps: 'nope' }); }, 'non-array skill_gaps', 'INVALID_INPUT');
    })

    // ==== §36 Diagnosis -> Recommendation mapping (all 4 S9-D-producible codes) ====
    .then(function () {
      var cases = [
        ['SHOT_EXECUTION_GAP', 'IMPROVE_SHOT_EXECUTION'],
        ['SHOT_CONTROL_GAP', 'IMPROVE_SHOT_CONTROL'],
        ['SHOT_SELECTION_GAP', 'IMPROVE_SHOT_SELECTION'],
        ['SHOT_CONSISTENCY_GAP', 'IMPROVE_SHOT_CONSISTENCY'],
        ['TRANSITION_EXECUTION_GAP', 'IMPROVE_TRANSITION_EXECUTION']
      ];
      cases.forEach(function (pair) {
        var result = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [gap({ diagnosis_code: pair[0] })] }));
        assert.strictEqual(result.recommendations.length, 1, pair[0] + ' -> exactly one recommendation');
        assert.strictEqual(result.recommendations[0].recommendation_code, pair[1], pair[0] + ' -> ' + pair[1]);
      });
    })

    // ==== TRANSITION_CONTROL_GAP mapping is wired even though S9-D never produces it yet ====
    .then(function () {
      var result = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [gap({ diagnosis_code: 'TRANSITION_CONTROL_GAP', skill: null, context: 'transition' })] }));
      assert.strictEqual(result.recommendations[0].recommendation_code, 'IMPROVE_TRANSITION_CONTROL');
    })

    // ==== Unsupported diagnosis test: unknown code -> deferred UNSUPPORTED_DIAGNOSIS, no guess ====
    .then(function () {
      var result = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [gap({ diagnosis_code: 'UNKNOWN_GAP' })] }));
      assert.strictEqual(result.recommendations.length, 0);
      assert.strictEqual(result.deferred_recommendations.length, 1);
      assert.strictEqual(result.deferred_recommendations[0].reason, 'UNSUPPORTED_DIAGNOSIS');
      assert.strictEqual(result.deferred_recommendations[0].status, 'deferred');
    })

    // ==== Missing priority_signal test: null is never converted to 0 ====
    .then(function () {
      var result = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [gap({ priority_signal: null })] }));
      assert.strictEqual(result.recommendations.length, 0);
      assert.strictEqual(result.deferred_recommendations[0].reason, 'MISSING_PRIORITY_SIGNAL');
      assert.notStrictEqual(result.deferred_recommendations[0].priority_score, 0);
      assert.strictEqual(Object.prototype.hasOwnProperty.call(result.deferred_recommendations[0], 'priority_score'), false, 'deferred entries never carry a fabricated priority_score field');
    })

    // ==== status !== supported -> deferred INVALID_SKILL_GAP ====
    .then(function () {
      var result = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [gap({ status: 'something_else' })] }));
      assert.strictEqual(result.recommendations.length, 0);
      assert.strictEqual(result.deferred_recommendations[0].reason, 'INVALID_SKILL_GAP');
    })

    // ==== §39 Priority tier boundaries ====
    .then(function () {
      var cases = [[70, 'HIGH'], [69.9, 'MEDIUM'], [40, 'MEDIUM'], [39.9, 'LOW'], [0, 'LOW']];
      cases.forEach(function (pair) {
        var result = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [gap({ priority_signal: pair[0] })] }));
        assert.strictEqual(result.recommendations[0].priority_tier, pair[1], 'priority_signal=' + pair[0] + ' -> ' + pair[1]);
      });
    })

    // ==== §40 Deduplication: same recommendation identity merges into one ====
    .then(function () {
      var gaps = [
        gap({ skill_gap_id: 'gap_a', diagnosis_code: 'SHOT_EXECUTION_GAP', skill: 'drop', context: null }),
        gap({ skill_gap_id: 'gap_b', diagnosis_code: 'SHOT_EXECUTION_GAP', skill: 'drop', context: null })
      ];
      var result = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: gaps }));
      assert.strictEqual(result.recommendations.length, 1, 'same identity (code+skill+context) merges into one recommendation');
      assert.deepStrictEqual(result.recommendations[0].source_skill_gap_ids.slice().sort(), ['gap_a', 'gap_b']);
    })

    // ==== §41 Merge aggregation: exact worked example from the design freeze ====
    .then(function () {
      var gaps = [
        gap({ skill_gap_id: 'gap_a', severity_score: 70, confidence_score: 65, priority_signal: 68 }),
        gap({ skill_gap_id: 'gap_b', severity_score: 90, confidence_score: 50, priority_signal: 74 })
      ];
      var result = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: gaps }));
      var rec = result.recommendations[0];
      assert.strictEqual(rec.severity_score, 90, 'severity = max(70,90) = 90');
      assert.strictEqual(rec.confidence_score, 65, 'confidence = max(65,50) = 65 (fields aggregate independently, not paired)');
      assert.strictEqual(rec.diagnosis_priority_signal, 74, 'diagnosis_priority_signal = max(68,74) = 74');
      assert.strictEqual(rec.priority_score, 74, 'priority_score = max(68,74) = 74');
    })

    // ==== Different skill/context -> NOT merged ====
    .then(function () {
      var gaps = [
        gap({ skill_gap_id: 'gap_a', skill: 'drop' }),
        gap({ skill_gap_id: 'gap_b', skill: 'dink' })
      ];
      var result = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: gaps }));
      assert.strictEqual(result.recommendations.length, 2, 'different skill -> distinct identity, not merged');
    })

    // ==== §42 Reason signal tests ====
    .then(function () {
      var high = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [gap({ severity_score: 70, confidence_score: 30, priority_signal: 30 })] })).recommendations[0];
      assert.ok(high.reason_signals.indexOf('HIGH_SEVERITY') !== -1);
      assert.strictEqual(high.reason_signals.indexOf('HIGH_CONFIDENCE'), -1);

      var conf = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [gap({ severity_score: 30, confidence_score: 70, priority_signal: 30 })] })).recommendations[0];
      assert.ok(conf.reason_signals.indexOf('HIGH_CONFIDENCE') !== -1);

      var prio = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [gap({ severity_score: 30, confidence_score: 30, priority_signal: 70 })] })).recommendations[0];
      assert.ok(prio.reason_signals.indexOf('HIGH_PRIORITY_SIGNAL') !== -1);

      var multi = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [
        gap({ skill_gap_id: 'gap_a', severity_score: 30, confidence_score: 30, priority_signal: 30 }),
        gap({ skill_gap_id: 'gap_b', severity_score: 30, confidence_score: 30, priority_signal: 30 })
      ] })).recommendations[0];
      assert.ok(multi.reason_signals.indexOf('MULTIPLE_EVIDENCE') !== -1);

      var none = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [gap({ severity_score: 30, confidence_score: 30, priority_signal: 30 })] })).recommendations[0];
      assert.deepStrictEqual(none.reason_signals, []);

      var all = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [
        gap({ skill_gap_id: 'gap_a', severity_score: 90, confidence_score: 90, priority_signal: 90 }),
        gap({ skill_gap_id: 'gap_b', severity_score: 90, confidence_score: 90, priority_signal: 90 })
      ] })).recommendations[0];
      assert.deepStrictEqual(all.reason_signals.slice().sort(), ['HIGH_CONFIDENCE', 'HIGH_PRIORITY_SIGNAL', 'HIGH_SEVERITY', 'MULTIPLE_EVIDENCE'].sort(), 'reason signals deduplicated (each appears once)');
    })

    // ==== §43 Ranking test: priority DESC, confidence DESC, severity DESC, code/skill/context ASC ====
    .then(function () {
      var gaps = [
        gap({ skill_gap_id: 'g1', skill: 'reset', priority_signal: 50, confidence_score: 50, severity_score: 50, diagnosis_code: 'SHOT_EXECUTION_GAP' }),
        gap({ skill_gap_id: 'g2', skill: 'drop', priority_signal: 80, confidence_score: 50, severity_score: 50, diagnosis_code: 'SHOT_EXECUTION_GAP' }),
        gap({ skill_gap_id: 'g3', skill: 'dink', priority_signal: 80, confidence_score: 90, severity_score: 50, diagnosis_code: 'SHOT_EXECUTION_GAP' }),
        gap({ skill_gap_id: 'g4', skill: 'lob', priority_signal: 80, confidence_score: 90, severity_score: 90, diagnosis_code: 'SHOT_EXECUTION_GAP' })
      ];
      var result = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: gaps }));
      var order = result.recommendations.map(function (r) { return r.skill; });
      assert.deepStrictEqual(order, ['lob', 'dink', 'drop', 'reset'], 'priority DESC, then confidence DESC, then severity DESC');
      result.recommendations.forEach(function (r, i) { assert.strictEqual(r.rank, i + 1); });
    })

    // ==== Ranking tie-break by recommendation_code ASC, then skill ASC ====
    .then(function () {
      var gaps = [
        gap({ skill_gap_id: 'g1', diagnosis_code: 'SHOT_SELECTION_GAP', skill: 'a', priority_signal: 50, confidence_score: 50, severity_score: 50 }),
        gap({ skill_gap_id: 'g2', diagnosis_code: 'SHOT_CONTROL_GAP', skill: 'z', priority_signal: 50, confidence_score: 50, severity_score: 50 }),
        gap({ skill_gap_id: 'g3', diagnosis_code: 'SHOT_CONTROL_GAP', skill: 'a', priority_signal: 50, confidence_score: 50, severity_score: 50 })
      ];
      var result = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: gaps }));
      var order = result.recommendations.map(function (r) { return r.recommendation_code + ':' + r.skill; });
      assert.deepStrictEqual(order, ['IMPROVE_SHOT_CONTROL:a', 'IMPROVE_SHOT_CONTROL:z', 'IMPROVE_SHOT_SELECTION:a'], 'all scores equal -> code ASC then skill ASC');
    })

    // ==== null skill/context sort last, stably ====
    .then(function () {
      var gaps = [
        gap({ skill_gap_id: 'g1', diagnosis_code: 'TRANSITION_EXECUTION_GAP', skill: null, context: 'transition', priority_signal: 50, confidence_score: 50, severity_score: 50 }),
        gap({ skill_gap_id: 'g2', diagnosis_code: 'SHOT_EXECUTION_GAP', skill: 'drop', context: null, priority_signal: 50, confidence_score: 50, severity_score: 50 })
      ];
      var result = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: gaps }));
      // codes: IMPROVE_SHOT_EXECUTION < IMPROVE_TRANSITION_EXECUTION alphabetically -> shot one first anyway
      assert.strictEqual(result.recommendations[0].recommendation_code, 'IMPROVE_SHOT_EXECUTION');
      assert.strictEqual(result.recommendations[1].skill, null, 'null skill sorts deterministically, not randomly');
    })

    // ==== §44 No truncation: 5 eligible recommendations all retained ====
    .then(function () {
      var gaps = [];
      var codes = ['SHOT_EXECUTION_GAP', 'SHOT_CONTROL_GAP', 'SHOT_SELECTION_GAP', 'SHOT_CONSISTENCY_GAP', 'TRANSITION_EXECUTION_GAP'];
      codes.forEach(function (code, i) {
        gaps.push(gap({ skill_gap_id: 'g' + i, diagnosis_code: code, skill: (code === 'TRANSITION_EXECUTION_GAP' ? null : 'shot' + i), context: (code === 'TRANSITION_EXECUTION_GAP' ? 'transition' : null) }));
      });
      var result = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: gaps }));
      assert.strictEqual(result.recommendation_count, 5);
      assert.strictEqual(result.recommendations.length, 5, 'all eligible recommendations retained, not truncated to top-3/top-5');
    })

    // ==== §45 top_recommendation_id ====
    .then(function () {
      var withGaps = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [gap({ priority_signal: 80 })] }));
      assert.strictEqual(withGaps.top_recommendation_id, withGaps.recommendations[0].recommendation_id);
      var noGaps = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [] }));
      assert.strictEqual(noGaps.top_recommendation_id, null);
    })

    // ==== §46 Partial data: missing skill, malformed gap, no gaps at all ====
    .then(function () {
      var missingSkill = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [gap({ diagnosis_code: 'TRANSITION_EXECUTION_GAP', skill: null, context: 'transition' })] }));
      assert.strictEqual(missingSkill.recommendations[0].skill, null, 'null skill is allowed where semantically valid (sequence-level gap)');

      var malformed = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [null, {}, gap()] }));
      assert.strictEqual(malformed.recommendations.length, 1, 'malformed entries are deferred safely, not crashed on');
      assert.strictEqual(malformed.deferred_recommendations.filter(function (d) { return d.reason === 'INVALID_SKILL_GAP'; }).length, 2);

      var empty = R.prioritizeDiagnosis(diagnosisResult({ skill_gaps: [] }));
      assert.deepStrictEqual(empty.recommendations, []);
      assert.strictEqual(empty.recommendation_count, 0);
    })

    // ==== §47 Determinism: same DiagnosisResult twice -> identical output ====
    .then(function () {
      var input = diagnosisResult({ skill_gaps: [
        gap({ skill_gap_id: 'g1', diagnosis_code: 'SHOT_EXECUTION_GAP', skill: 'drop' }),
        gap({ skill_gap_id: 'g2', diagnosis_code: 'SHOT_CONTROL_GAP', skill: 'dink', priority_signal: 80 })
      ] });
      var r1 = JSON.stringify(R.prioritizeDiagnosis(input));
      var r2 = JSON.stringify(R.prioritizeDiagnosis(input));
      assert.strictEqual(r1, r2);
    })

    // ================================================================
    // Integration tests A/B/C
    // ================================================================

    // ==== A. Full chain: S9-B rallies -> S9-C pattern -> S9-D SkillGap -> S9-E Recommendation ====
    .then(function () {
      var MO = global.PBMatchObservation;
      var PA = global.PBPerformanceAnalysis;
      var D = global.PBDiagnosis;
      return global.PBStore.createPlayer('S9-E Test Player').then(function (player) {
        return global.PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 }).then(function (assessment) {
          return MO.createMatchSession({ assessment_id: assessment.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF' } })
            .then(function (session) {
              // 8 rallies of drop/error (low success rate, quality=error): S9-C 6-10 sample band
              // -> confidence 65, comfortably clearing S9-D's evidence gate.
              var chain = Promise.resolve();
              for (var i = 1; i <= 8; i++) {
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
          var dropGap = diagnosis.skill_gaps.filter(function (g) { return g.skill === 'drop'; })[0];
          assert.ok(dropGap, 'precondition: S9-D produced a supported drop SkillGap');
          var recResult = R.prioritizeDiagnosis(diagnosis);
          var rec = recResult.recommendations.filter(function (r) { return r.skill === 'drop'; })[0];
          assert.ok(rec, 'A: full S9-B -> S9-C -> S9-D -> S9-E chain produces a recommendation');
          assert.strictEqual(rec.recommendation_code, 'IMPROVE_SHOT_EXECUTION', 'low_success_rate pattern -> SHOT_EXECUTION_GAP -> IMPROVE_SHOT_EXECUTION');
          assert.deepStrictEqual(rec.source_skill_gap_ids, [dropGap.skill_gap_id]);

          // Also exercise the storage-backed convenience entry point end-to-end.
          return R.prioritizeMatch(ctx.session.test_session_id, ctx.player.player_id).then(function (viaConvenience) {
            assert.deepStrictEqual(viaConvenience.recommendations.map(function (r) { return r.recommendation_code; }).sort(),
              recResult.recommendations.map(function (r) { return r.recommendation_code; }).sort());
          });
        });
      });
    })

    // ==== B. Low confidence: S9-C LOW confidence -> S9-D no supported gap -> S9-E no active recommendation ====
    .then(function () {
      var MO = global.PBMatchObservation;
      var PA = global.PBPerformanceAnalysis;
      var D = global.PBDiagnosis;
      return global.PBStore.createPlayer('LowConfPlayer').then(function (player) {
        return global.PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 }).then(function (assessment) {
          return MO.createMatchSession({ assessment_id: assessment.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF' } })
            .then(function (session) {
              var chain = Promise.resolve();
              for (var i = 1; i <= 3; i++) { // 3 rallies -> LOW confidence band (35, < 40 gate)
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
          assert.strictEqual(diagnosis.skill_gaps.filter(function (g) { return g.skill === 'lob'; }).length, 0, 'precondition: S9-D produced no supported lob SkillGap');
          var recResult = R.prioritizeDiagnosis(diagnosis);
          assert.strictEqual(recResult.recommendations.filter(function (r) { return r.skill === 'lob'; }).length, 0,
            'B: low S9-C confidence -> no S9-D supported gap -> no S9-E active recommendation (the downstream block is never bypassed)');
        });
      });
    })

    // ==== C. Unsupported semantics: unsupported S9-C pattern -> S9-D insufficient -> S9-E no active recommendation ====
    .then(function () {
      var D = global.PBDiagnosis;
      // S9-C V1 has no active trigger for repeated_positioning_error/pressure_failure/
      // sequence_breakdown at all (per the S9-C Semantic Correction pass), so a live end-to-end
      // fixture cannot exist for this case — construct the AnalysisSummary directly, exactly as
      // S9-D's own integration test C does for the same reason.
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
      assert.strictEqual(diagnosis.skill_gaps.length, 0, 'precondition: S9-D produced no supported gap for an unsupported pattern type');
      var recResult = R.prioritizeDiagnosis(diagnosis);
      assert.strictEqual(recResult.recommendations.length, 0, 'C: unsupported upstream semantics never reach an active S9-E recommendation');
      assert.strictEqual(recResult.deferred_recommendations.length, 0, 'S9-D already filtered it out before S9-E ever saw a skill_gap for it');
    })

    // ==== Structural non-scope checks ====
    .then(function () {
      var src = fs.readFileSync(path.join(__dirname, '..', 'js', 'recommendation-priority-engine.js'), 'utf8');
      var codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      ['drill:', 'training_plan:', 'prescription:', 'repetition', 'duration', 'weekly_frequency',
       'validated_training_level:', 'rating_upgrade:', 'rating_downgrade:', 'openai', 'anthropic', 'Math.random',
       'PBStore', 'PBMatchObservation', 'PBPerformanceAnalysis'].forEach(function (token) {
        assert.strictEqual(codeOnly.indexOf(token), -1, 'AC-E14/E15/E16/E18/E32/E33: engine code must never reference ' + token);
      });
      assert.strictEqual(/\b[3-5]\.[05]\b/.test(codeOnly), false, 'AC-E17: no 3.0/3.5/4.0/4.5/5.0 benchmark literal in actual code');
      ['foundational_skill', 'level_limiting', 'blocks_advancement', 'match_critical', 'tactically_urgent', 'mental_weakness'].forEach(function (phrase) {
        assert.strictEqual(codeOnly.toLowerCase().indexOf(phrase), -1, 'no invented reason signal "' + phrase + '"');
      });
    })

    .then(function () {
      console.log('recommendation-priority-engine.test.js: all assertions passed');
    });
}

run().catch(function (err) {
  console.error('recommendation-priority-engine.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
