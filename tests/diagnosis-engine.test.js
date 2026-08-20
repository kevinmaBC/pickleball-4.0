/* tests/diagnosis-engine.test.js — S9-D: Diagnosis / Skill Gap Engine
 * Run: node tests/diagnosis-engine.test.js
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
  return global.PBDiagnosis;
}

function assertRejects(promise, label, expectedCode) {
  return promise.then(
    function () { throw new Error('expected rejection but resolved: ' + label); },
    function (err) {
      assert.ok(err instanceof Error, label + ' rejects with an Error');
      if (expectedCode) assert.strictEqual(err.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + err.code + ')');
    }
  );
}

function assertThrows(fn, label, expectedCode) {
  var threw = null;
  try { fn(); } catch (e) { threw = e; }
  assert.ok(threw instanceof Error, label + ' throws an Error');
  if (expectedCode) assert.strictEqual(threw.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + threw.code + ')');
}

// Minimal PatternCandidate builder matching js/performance-analysis-engine.js's shape.
function pattern(overrides) {
  return Object.assign({
    pattern_id: 'pat_x', match_id: 'm1', player_id: 'p1',
    pattern_type: 'low_success_rate', category: 'execution',
    shot_type: 'drop', situation: null,
    sample_size: 5, success_rate: 30, error_rate: 40,
    severity_score: 60, confidence_score: 65, confidence_band: 'MEDIUM',
    evidence: ['trl_1', 'trl_2'], data_status: 'sufficient'
  }, overrides || {});
}

function summary(overrides) {
  return Object.assign({
    match_id: 'm1', player_id: 'p1', data_status: 'complete',
    overall: {}, shot_metrics: [], situation_metrics: [], sequence_metrics: [],
    pattern_candidates: [], analysis_confidence: 50
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
  var D = freshEnv();

  return Promise.resolve()

    // ==== AC-D01: input validation — malformed input rejected cleanly, never crashes ====
    .then(function () {
      assertThrows(function () { D.diagnoseAnalysis(null); }, 'null analysisSummary', 'INVALID_INPUT');
      assertThrows(function () { D.diagnoseAnalysis({}); }, 'missing match_id', 'INVALID_INPUT');
      assertThrows(function () { D.diagnoseAnalysis({ match_id: 'm1', pattern_candidates: 'not-an-array' }); }, 'non-array pattern_candidates', 'INVALID_INPUT');
    })

    // ==== low_success_rate + confidence >= 40 -> supported SHOT_EXECUTION_GAP ====
    .then(function () {
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: [pattern({ pattern_type: 'low_success_rate', confidence_score: 65 })] }));
      assert.strictEqual(result.skill_gaps.length, 1);
      var gap = result.skill_gaps[0];
      assert.strictEqual(gap.diagnosis_code, 'SHOT_EXECUTION_GAP');
      assert.strictEqual(gap.gap_domain, 'shot_execution');
      assert.strictEqual(gap.gap_type, 'execution');
      assert.strictEqual(gap.skill, 'drop');
      assert.strictEqual(gap.status, 'supported');
      assert.strictEqual(result.insufficient_evidence.length, 0);
    })

    // ==== low_success_rate + confidence < 40 -> insufficient LOW_CONFIDENCE ====
    .then(function () {
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: [pattern({ pattern_type: 'low_success_rate', confidence_score: 35 })] }));
      assert.strictEqual(result.skill_gaps.length, 0, 'confidence < 40 must never produce a supported SkillGap');
      assert.strictEqual(result.insufficient_evidence.length, 1);
      assert.strictEqual(result.insufficient_evidence[0].reason, 'LOW_CONFIDENCE');
      assert.strictEqual(result.insufficient_evidence[0].confidence_score, 35);
      assert.strictEqual(result.insufficient_evidence[0].required_status, 'MEDIUM_OR_HIGH');
    })

    // ==== confidence exactly 40 -> eligible (boundary: >= 40, not > 40) ====
    .then(function () {
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: [pattern({ pattern_type: 'low_success_rate', confidence_score: 40 })] }));
      assert.strictEqual(result.skill_gaps.length, 1, 'confidence exactly 40 is eligible (gate is < 40, not <= 40)');
    })

    // ==== high_error_rate -> SHOT_CONTROL_GAP ====
    .then(function () {
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: [pattern({ pattern_type: 'high_error_rate', confidence_score: 65 })] }));
      assert.strictEqual(result.skill_gaps[0].diagnosis_code, 'SHOT_CONTROL_GAP');
      assert.strictEqual(result.skill_gaps[0].gap_type, 'control');
    })

    // ==== poor_shot_selection -> SHOT_SELECTION_GAP ====
    .then(function () {
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: [pattern({ pattern_type: 'poor_shot_selection', confidence_score: 65 })] }));
      assert.strictEqual(result.skill_gaps[0].diagnosis_code, 'SHOT_SELECTION_GAP');
      assert.strictEqual(result.skill_gaps[0].gap_domain, 'shot_selection');
    })

    // ==== inconsistency -> SHOT_CONSISTENCY_GAP ====
    .then(function () {
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: [pattern({ pattern_type: 'inconsistency', confidence_score: 65 })] }));
      assert.strictEqual(result.skill_gaps[0].diagnosis_code, 'SHOT_CONSISTENCY_GAP');
      assert.strictEqual(result.skill_gaps[0].gap_domain, 'consistency');
    })

    // ==== transition_breakdown -> TRANSITION_EXECUTION_GAP ====
    .then(function () {
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: [pattern({
        pattern_type: 'transition_breakdown', category: 'sequence', shot_type: null, situation: 'transition', confidence_score: 65
      })] }));
      assert.strictEqual(result.skill_gaps[0].diagnosis_code, 'TRANSITION_EXECUTION_GAP');
      assert.strictEqual(result.skill_gaps[0].gap_domain, 'transition');
      assert.strictEqual(result.skill_gaps[0].context, 'transition');
      assert.strictEqual(result.skill_gaps[0].skill, null, 'sequence-level gap has no shot-type skill');
    })

    // ==== pressure_failure / repeated_positioning_error / sequence_breakdown -> no supported diagnosis ====
    .then(function () {
      ['pressure_failure', 'repeated_positioning_error', 'sequence_breakdown'].forEach(function (pt) {
        var result = D.diagnoseAnalysis(summary({ pattern_candidates: [pattern({ pattern_type: pt, confidence_score: 90 })] }));
        assert.strictEqual(result.skill_gaps.length, 0, pt + ' (even at confidence=90) must never produce a supported diagnosis');
        assert.strictEqual(result.insufficient_evidence.length, 1);
        assert.strictEqual(result.insufficient_evidence[0].reason, 'UNSUPPORTED_PATTERN');
        assert.strictEqual(D.PATTERN_TO_DIAGNOSIS[pt], undefined, pt + ' must not appear in PATTERN_TO_DIAGNOSIS');
      });
    })

    // ==== Duplicate diagnosis identity -> merged SkillGap; evidence IDs deduplicated ====
    .then(function () {
      var candidates = [
        pattern({ pattern_id: 'pat_1', pattern_type: 'low_success_rate', shot_type: 'drop', severity_score: 50, confidence_score: 65 }),
        pattern({ pattern_id: 'pat_2', pattern_type: 'low_success_rate', shot_type: 'drop', severity_score: 80, confidence_score: 45 })
      ];
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: candidates }));
      assert.strictEqual(result.skill_gaps.length, 1, 'two patterns with the same identity (player+match+diagnosis_code+skill+context) merge into one');
      var gap = result.skill_gaps[0];
      assert.strictEqual(gap.severity_score, 80, 'severity aggregation = max, never sum');
      assert.strictEqual(gap.confidence_score, 65, 'confidence aggregation = max, never sum (not 65+45)');
      assert.deepStrictEqual(gap.evidence_pattern_ids.slice().sort(), ['pat_1', 'pat_2'], 'evidence pattern ids combined');
    })

    // ==== Evidence IDs deduplicated (same pattern_id contributing twice must not duplicate) ====
    .then(function () {
      var candidates = [
        pattern({ pattern_id: 'pat_dup', pattern_type: 'low_success_rate', shot_type: 'drop', confidence_score: 65 }),
        pattern({ pattern_id: 'pat_dup', pattern_type: 'low_success_rate', shot_type: 'drop', confidence_score: 65 })
      ];
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: candidates }));
      assert.strictEqual(result.skill_gaps.length, 1);
      assert.deepStrictEqual(result.skill_gaps[0].evidence_pattern_ids, ['pat_dup'], 'evidence_pattern_ids must be deduplicated');
    })

    // ==== Different skill/context -> NOT merged (distinct identity) ====
    .then(function () {
      var candidates = [
        pattern({ pattern_id: 'pat_1', pattern_type: 'low_success_rate', shot_type: 'drop', confidence_score: 65 }),
        pattern({ pattern_id: 'pat_2', pattern_type: 'low_success_rate', shot_type: 'dink', confidence_score: 65 })
      ];
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: candidates }));
      assert.strictEqual(result.skill_gaps.length, 2, 'different skill (shot_type) -> distinct identity, not merged');
    })

    // ==== Priority Signal = exact deterministic formula ====
    .then(function () {
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: [pattern({ severity_score: 80, confidence_score: 50 })] }));
      assert.strictEqual(result.skill_gaps[0].priority_signal, round1(0.60 * 80 + 0.40 * 50), 'priority_signal = 0.60*severity + 0.40*confidence');
      assert.strictEqual(result.skill_gaps[0].priority_signal, 68);
    })

    // ==== Priority Signal clamp ====
    .then(function () {
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: [pattern({ severity_score: 100, confidence_score: 100 })] }));
      assert.strictEqual(result.skill_gaps[0].priority_signal, 100);
    })

    // ==== No supported gaps -> diagnosis_confidence = null (not 0) ====
    .then(function () {
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: [] }));
      assert.strictEqual(result.skill_gaps.length, 0);
      assert.strictEqual(result.diagnosis_confidence, null, 'diagnosis_confidence must be null, never 0, when there are no supported gaps');
    })

    // ==== Supported gaps -> diagnosis_confidence = average ====
    .then(function () {
      var candidates = [
        pattern({ pattern_id: 'pat_1', pattern_type: 'low_success_rate', shot_type: 'drop', confidence_score: 60 }),
        pattern({ pattern_id: 'pat_2', pattern_type: 'high_error_rate', shot_type: 'dink', confidence_score: 80 })
      ];
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: candidates }));
      assert.strictEqual(result.skill_gaps.length, 2);
      assert.strictEqual(result.diagnosis_confidence, 70, 'diagnosis_confidence = average(60,80) = 70');
    })

    // ==== data_status inherited from S9-C, not redefined ====
    .then(function () {
      ['complete', 'partial', 'insufficient'].forEach(function (status) {
        var result = D.diagnoseAnalysis(summary({ data_status: status, pattern_candidates: [] }));
        assert.strictEqual(result.data_status, status);
      });
    })

    // ==== diagnosis_version ====
    .then(function () {
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: [] }));
      assert.strictEqual(result.diagnosis_version, 'S9-D-V1');
    })

    // ==== Partial input safe: malformed candidate entries are skipped, not crashed on ====
    .then(function () {
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: [null, {}, pattern({ confidence_score: 65 })] }));
      assert.strictEqual(result.skill_gaps.length, 1, 'null/malformed candidate entries are skipped safely');
    })

    // ==== null != zero semantics preserved (AC-D17): a pattern with success_rate/error_rate=null still diagnoses on severity/confidence ====
    .then(function () {
      var result = D.diagnoseAnalysis(summary({ pattern_candidates: [pattern({ success_rate: null, error_rate: null, confidence_score: 65 })] }));
      assert.strictEqual(result.skill_gaps.length, 1, 'diagnosis is driven by severity/confidence, unaffected by unrelated null metric fields');
    })

    // ==== Same input twice -> identical output (AC-D02) ====
    .then(function () {
      var input = summary({ pattern_candidates: [
        pattern({ pattern_id: 'pat_1', pattern_type: 'low_success_rate', confidence_score: 65 }),
        pattern({ pattern_id: 'pat_2', pattern_type: 'high_error_rate', shot_type: 'dink', confidence_score: 55 })
      ] });
      var r1 = JSON.stringify(D.diagnoseAnalysis(input));
      var r2 = JSON.stringify(D.diagnoseAnalysis(input));
      assert.strictEqual(r1, r2, 'diagnoseAnalysis is a pure deterministic function of its input');
    })

    // ================================================================
    // Integration tests (A/B/C)
    // ================================================================

    // ==== A. Valid Skill Gap: S9-B rallies -> S9-C pattern -> S9-D supported SkillGap ====
    .then(function () {
      var MO = global.PBMatchObservation;
      var PA = global.PBPerformanceAnalysis;
      return global.PBStore.createPlayer('S9-D Test Player').then(function (player) {
        return global.PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 }).then(function (assessment) {
          return MO.createMatchSession({ assessment_id: assessment.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF' } })
            .then(function (session) {
              // 8 rallies -> S9-C's 6-10 sample band (base confidence 0.65 -> confidence_score 65),
              // comfortably clearing the S9-D >=40 evidence gate.
              var chain = Promise.resolve();
              for (var i = 1; i <= 8; i++) {
                (function (i) {
                  chain = chain.then(function () {
                    return MO.addRallyObservation(session.test_session_id, baseRally({ game_number: 1, rally_number: i, shot: 'drop', quality: 'error', result: 'ue' }));
                  });
                })(i);
              }
              return chain.then(function () { return { session: session, player: player }; });
            });
        });
      }).then(function (ctx) {
        return PA.analyzeMatch(ctx.session.test_session_id, ctx.player.player_id).then(function (analysisSummary) {
          var highErrPattern = analysisSummary.pattern_candidates.filter(function (p) { return p.pattern_type === 'high_error_rate'; })[0];
          assert.ok(highErrPattern, 'precondition: S9-C produced a high_error_rate pattern for the 8x drop/ue fixture');
          assert.ok(highErrPattern.confidence_score >= 40, 'precondition: this fixture clears the S9-D evidence gate (got ' + highErrPattern.confidence_score + ')');
          var diagnosis = D.diagnoseAnalysis(analysisSummary);
          var gap = diagnosis.skill_gaps.filter(function (g) { return g.diagnosis_code === 'SHOT_CONTROL_GAP' && g.skill === 'drop'; })[0];
          assert.ok(gap, 'A: Observation -> Pattern -> supported SkillGap end-to-end');
          assert.deepStrictEqual(gap.evidence_pattern_ids, [highErrPattern.pattern_id]);

          // Also exercise the storage-backed convenience entry point end-to-end.
          return D.diagnoseMatch(ctx.session.test_session_id, ctx.player.player_id).then(function (viaConvenience) {
            assert.deepStrictEqual(viaConvenience.skill_gaps.map(function (g) { return g.diagnosis_code; }).sort(),
              diagnosis.skill_gaps.map(function (g) { return g.diagnosis_code; }).sort(),
              'diagnoseMatch(matchId, playerId) produces the same diagnosis as diagnoseAnalysis(analyzeMatch(...))');
          });
        });
      });
    })

    // ==== B. Low Confidence: S9-C PatternCandidate confidence < 40 -> insufficient_evidence, no supported SkillGap ====
    .then(function () {
      var MO = global.PBMatchObservation;
      var PA = global.PBPerformanceAnalysis;
      return global.PBStore.createPlayer('LowConfPlayer').then(function (player) {
        return global.PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 }).then(function (assessment) {
          return MO.createMatchSession({ assessment_id: assessment.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF' } })
            .then(function (session) {
              // Exactly 3 rallies -> S9-C's LOW confidence band (base 0.35 -> confidence_score 35, < 40 gate).
              var chain = Promise.resolve();
              for (var i = 1; i <= 3; i++) {
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
          var lowConfPattern = analysisSummary.pattern_candidates.filter(function (p) { return p.pattern_type === 'high_error_rate'; })[0];
          assert.ok(lowConfPattern, 'precondition: a high_error_rate pattern exists');
          assert.ok(lowConfPattern.confidence_score < 40, 'precondition: pattern confidence is below the S9-D evidence gate');
          var diagnosis = D.diagnoseAnalysis(analysisSummary);
          assert.strictEqual(diagnosis.skill_gaps.filter(function (g) { return g.skill === 'lob'; }).length, 0, 'B: low-confidence pattern must not produce a supported SkillGap');
          var ie = diagnosis.insufficient_evidence.filter(function (e) { return e.pattern_id === lowConfPattern.pattern_id; })[0];
          assert.ok(ie, 'B: low-confidence pattern is recorded in insufficient_evidence');
          assert.strictEqual(ie.reason, 'LOW_CONFIDENCE');
        });
      });
    })

    // ==== C. Unsupported Semantics: unsupported pattern type -> no supported diagnosis, UNSUPPORTED_PATTERN ====
    .then(function () {
      // No live S9-B/S9-C fixture reliably produces repeated_positioning_error/pressure_failure/
      // sequence_breakdown (S9-C V1 has no active trigger for them at all — that is exactly the
      // point of the S9-C Semantic Correction pass). Construct the AnalysisSummary directly to
      // prove S9-D's own guard, matching how S9-C's own tests treat these three types.
      var analysisSummary = summary({
        pattern_candidates: [pattern({ pattern_id: 'pat_unsupported', pattern_type: 'repeated_positioning_error', confidence_score: 90 })]
      });
      var diagnosis = D.diagnoseAnalysis(analysisSummary);
      assert.strictEqual(diagnosis.skill_gaps.length, 0, 'C: unsupported pattern type produces no supported diagnosis');
      assert.strictEqual(diagnosis.insufficient_evidence[0].reason, 'UNSUPPORTED_PATTERN');
    })

    // ==== Structural non-scope checks ====
    // Comments are stripped first: this file's own boundary-documenting prose deliberately names
    // every forbidden concept (recommendation, root-cause phrases, 3.0-5.0 benchmarks, etc.) to
    // explain why none is implemented — these checks must verify actual code, not censor the doc
    // comments that describe the guard.
    .then(function () {
      var src = fs.readFileSync(path.join(__dirname, '..', 'js', 'diagnosis-engine.js'), 'utf8');
      var codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

      ['recommendation:', 'training_plan:', 'prescription:', 'drill:', 'validated_training_level:',
       'rating_upgrade:', 'rating_downgrade:', 'openai', 'anthropic', 'Math.random'].forEach(function (token) {
        assert.strictEqual(codeOnly.indexOf(token), -1, 'AC-D05/D11/D12/D13/D15: engine code must never reference ' + token);
      });
      // AC-D14: no player-level benchmark values (3.0-5.0) used as actual code.
      assert.strictEqual(/\b[3-5]\.[05]\b/.test(codeOnly), false, 'AC-D14: no 3.0/3.5/4.0/4.5/5.0 benchmark literal in actual code');
      // No root-cause fabrication vocabulary in actual code (§28).
      ['paddle angle', 'grip issue', 'swing path', 'late contact', 'footwork problem', 'positioning issue', 'mental weakness'].forEach(function (phrase) {
        assert.strictEqual(codeOnly.toLowerCase().indexOf(phrase), -1, 'AC-D05: no root-cause fabrication phrase "' + phrase + '" in actual code');
      });
    })

    .then(function () {
      console.log('diagnosis-engine.test.js: all assertions passed');
    });
}

function round1(x) { return Math.round(x * 10) / 10; }

run().catch(function (err) {
  console.error('diagnosis-engine.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
