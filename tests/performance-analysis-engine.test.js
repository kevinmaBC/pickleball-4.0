/* tests/performance-analysis-engine.test.js — S9-C: Performance Analysis
 * & Pattern Detection Engine
 * Run: node tests/performance-analysis-engine.test.js
 */
var assert = require('assert');
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
  return global.PBPerformanceAnalysis;
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

function baseRally(overrides) {
  return Object.assign({
    game_number: 1, rally_number: 1,
    phase: 'transition', intent: 'neutralize', shot: 'reset', target: 'middle',
    quality: 'good', movement: 'balanced', result: 'continue',
    control_state: 'neutral'
  }, overrides || {});
}

function seedSession(PBMatchObservation, tier) {
  return global.PBStore.createPlayer('S9-C Test Player').then(function (player) {
    return global.PBStore.createAssessment({ player_id: player.player_id, assessment_tier: tier || 'lite', target_training_level: 4.0 }).then(function (assessment) {
      return { player: player, assessment: assessment };
    });
  }).then(function (ctx) {
    return PBMatchObservation.createMatchSession({
      assessment_id: ctx.assessment.assessment_id, assessment_tier: tier || 'lite',
      match_context: { observer_role: 'SELF' }
    }).then(function (session) {
      ctx.session = session;
      return ctx;
    });
  });
}

function addRallies(PBMatchObservation, session_id, rallies) {
  var chain = Promise.resolve();
  rallies.forEach(function (r) {
    chain = chain.then(function () { return PBMatchObservation.addRallyObservation(session_id, baseRally(r)); });
  });
  return chain;
}

function findNoNanOrInfinity(obj, path, bad) {
  path = path || '$'; bad = bad || [];
  if (obj == null) return bad;
  if (typeof obj === 'number') {
    if (Number.isNaN(obj) || !Number.isFinite(obj)) bad.push(path + ' = ' + obj);
    return bad;
  }
  if (Array.isArray(obj)) {
    obj.forEach(function (v, i) { findNoNanOrInfinity(v, path + '[' + i + ']', bad); });
    return bad;
  }
  if (typeof obj === 'object') {
    Object.keys(obj).forEach(function (k) { findNoNanOrInfinity(obj[k], path + '.' + k, bad); });
    return bad;
  }
  return bad;
}

function run() {
  var PA = freshEnv();
  var MO = global.PBMatchObservation;

  return Promise.resolve()

    // ==== Unit: calculateMatchMetrics ====
    .then(function () {
      var trials = [
        { trial_event_id: 't1', raw_json: baseRally({ result: 'winner' }) },
        { trial_event_id: 't2', raw_json: baseRally({ result: 'ue' }) },
        { trial_event_id: 't3', raw_json: baseRally({ result: 'forced_error_created' }) },
        { trial_event_id: 't4', raw_json: baseRally({ result: 'continue' }) }
      ];
      var m = PA.calculateMatchMetrics(trials);
      assert.strictEqual(m.total_points, 4, 'total_points counts every rally, including non-terminal ones');
      assert.strictEqual(m.points_won, 2, 'winner + forced_error_created count as points won');
      assert.strictEqual(m.points_lost, 1, 'ue counts as points lost');
      assert.strictEqual(m.winner_count, 1);
      assert.strictEqual(m.unforced_error_count, 1);
      assert.strictEqual(m.forced_error_count, 1);
      assert.strictEqual(m.error_rate, 25, 'error_rate = 1/4*100');
      assert.strictEqual(m.winner_rate, 25, 'winner_rate = 1/4*100');
      assert.strictEqual(m.rally_length_average, null, 'rally length is never fabricated — no shot-count field exists in S9-B');
      assert.strictEqual(m.short_rally_rate, null);
    })

    // ==== Unit: zero denominator -> null, never NaN/Infinity ====
    .then(function () {
      var m = PA.calculateMatchMetrics([]);
      assert.strictEqual(m.total_points, 0);
      assert.strictEqual(m.error_rate, null, 'zero total_points -> error_rate null, not NaN');
      assert.strictEqual(m.winner_rate, null);
      assert.deepStrictEqual(findNoNanOrInfinity(m), []);
    })

    // ==== Unit: shot aggregation ====
    .then(function () {
      var trials = [
        { trial_event_id: 't1', raw_json: baseRally({ shot: 'drive', quality: 'good', result: 'winner' }) },
        { trial_event_id: 't2', raw_json: baseRally({ shot: 'drive', quality: 'error', result: 'ue' }) },
        { trial_event_id: 't3', raw_json: baseRally({ shot: 'dink', quality: 'good', result: 'continue' }) }
      ];
      var sm = PA.calculateShotMetrics(trials);
      assert.strictEqual(sm.length, 2);
      var drive = sm.filter(function (s) { return s.shot_type === 'drive'; })[0];
      assert.strictEqual(drive.attempts, 2);
      assert.strictEqual(drive.successful, 1);
      assert.strictEqual(drive.failed, 1);
      assert.strictEqual(drive.success_rate, 50);
      assert.strictEqual(drive.winner_count, 1);
      assert.strictEqual(drive.error_count, 1);
      assert.strictEqual(drive.error_rate, 50);
    })

    // ==== Unit: situation aggregation ====
    .then(function () {
      var trials = [
        { trial_event_id: 't1', raw_json: baseRally({ phase: 'nvz', quality: 'good', result: 'winner' }) },
        { trial_event_id: 't2', raw_json: baseRally({ phase: 'nvz', quality: 'error', result: 'ue' }) },
        { trial_event_id: 't3', raw_json: baseRally({ phase: 'third', quality: 'good', result: 'continue' }) }
      ];
      var sitm = PA.calculateSituationMetrics(trials);
      var nvz = sitm.filter(function (s) { return s.situation === 'nvz'; })[0];
      assert.strictEqual(nvz.sample_size, 2);
      assert.strictEqual(nvz.success_rate, 50);
      assert.strictEqual(nvz.error_rate, 50);
    })

    // ==== Unit: sequence calculation where supported, null where not ====
    .then(function () {
      var trials = [
        { trial_event_id: 't1', raw_json: baseRally({ phase: 'third', quality: 'good' }) },
        { trial_event_id: 't2', raw_json: baseRally({ phase: 'transition', result: 'transition_lost' }) },
        { trial_event_id: 't3', raw_json: baseRally({ phase: 'transition', result: 'winner' }) },
        { trial_event_id: 't4', raw_json: baseRally({ phase: 'nvz' }) }
      ];
      var seq = PA.calculateSequenceMetrics(trials);
      var third = seq.filter(function (s) { return s.sequence_type === 'third_shot'; })[0];
      assert.strictEqual(third.attempts, 1);
      assert.strictEqual(third.success_rate, 100);
      var continuation = seq.filter(function (s) { return s.sequence_type === 'third_to_fifth_continuation'; })[0];
      assert.strictEqual(continuation.attempts, null, 'third_to_fifth_continuation is always unavailable, never fabricated');
      assert.strictEqual(continuation.continuation_rate, null);
      var transition = seq.filter(function (s) { return s.sequence_type === 'transition'; })[0];
      assert.strictEqual(transition.attempts, 2);
      assert.strictEqual(transition.survival_rate, 50, '1 of 2 transition rallies survives (not transition_lost/ue)');
      // S9-C Semantic Correction V1 (GPT QA #3): nvz_arrival is no longer computed as
      // nvz-phase-rallies/total-rallies — phase==='nvz' alone does not reliably prove
      // baseline/transition -> successful NVZ arrival. Always unavailable now.
      var nvzArrival = seq.filter(function (s) { return s.sequence_type === 'nvz_arrival'; })[0];
      assert.strictEqual(nvzArrival.attempts, null, 'nvz_arrival is unavailable, never computed from the phase===nvz proxy');
      assert.strictEqual(nvzArrival.arrival_rate, null);
      assert.ok(nvzArrival.unavailable_reason, 'nvz_arrival documents why it is unavailable');
    })

    // ==== Unit: partial data — unknown shot excluded from shot metric only, does not crash ====
    .then(function () {
      var trials = [
        { trial_event_id: 't1', raw_json: baseRally({ shot: 'drive' }) },
        { trial_event_id: 't2', raw_json: baseRally({ shot: null }) } // simulates an incomplete observation
      ];
      var sm = PA.calculateShotMetrics(trials);
      assert.strictEqual(sm.length, 1, 'a rally with unknown shot is excluded from shot_metrics only, not fabricated as a bucket');
      var overall = PA.calculateMatchMetrics(trials);
      assert.strictEqual(overall.total_points, 2, 'match metrics still count the rally even though shot is unknown');
    })

    // ==== Unit: minimum sample rule boundaries (2,3,5,6,10,11) via baseSampleConfidence ====
    .then(function () {
      assert.strictEqual(PA.baseSampleConfidence(2), 0.00, 'sample=2 -> base confidence 0.00');
      assert.strictEqual(PA.baseSampleConfidence(3), 0.35, 'sample=3 -> base confidence 0.35');
      assert.strictEqual(PA.baseSampleConfidence(5), 0.35, 'sample=5 -> base confidence 0.35');
      assert.strictEqual(PA.baseSampleConfidence(6), 0.65, 'sample=6 -> base confidence 0.65');
      assert.strictEqual(PA.baseSampleConfidence(10), 0.65, 'sample=10 -> base confidence 0.65');
      assert.strictEqual(PA.baseSampleConfidence(11), 0.90, 'sample=11 -> base confidence 0.90');
    })

    // ==== Unit: confidence scoring + band + clamp ====
    .then(function () {
      var c3 = PA.computeConfidence(3, 1.0);
      assert.strictEqual(c3.confidence_score, 35, '3-5 band: 0.35*1.0*100 = 35');
      assert.strictEqual(c3.confidence_band, 'LOW', '35 is LOW (0-39)');

      var c6 = PA.computeConfidence(6, 1.0);
      assert.strictEqual(c6.confidence_score, 65, '6-10 band: 0.65*1.0*100 = 65');
      assert.strictEqual(c6.confidence_band, 'MEDIUM', '65 is MEDIUM (40-69)');

      var c11 = PA.computeConfidence(11, 1.0);
      assert.strictEqual(c11.confidence_score, 90, '11+ band: 0.90*1.0*100 = 90');
      assert.strictEqual(c11.confidence_band, 'HIGH', '90 is HIGH (70-100)');

      var cHalf = PA.computeConfidence(6, 0.5);
      assert.strictEqual(cHalf.confidence_score, 32.5, 'DataCompletenessFactor genuinely scales the score: 0.65*0.5*100');
      assert.strictEqual(cHalf.confidence_band, 'LOW');

      // Clamp: an out-of-range completeness factor must never push the score outside [0,100].
      var cOver = PA.computeConfidence(11, 1.5);
      assert.strictEqual(cOver.confidence_score, 100, 'confidence_score clamped to 100');
      var cUnder = PA.computeConfidence(11, -0.5);
      assert.strictEqual(cUnder.confidence_score, 0, 'confidence_score clamped to 0');
    })

    // ==== Unit: severity scoring + clamp ====
    .then(function () {
      // failure_rate=1.0, sample=10 (frequencyFactor=1.0), high_error_rate impact=0.70
      // severity = 100*(0.5*1 + 0.3*1 + 0.2*0.70) = 100*(0.5+0.3+0.14) = 94
      var s = PA.computeSeverity('high_error_rate', 1.0, 10);
      assert.strictEqual(s, 94);

      // Out-of-range failure_rate must still clamp (failure_rate itself clamped to [0,1] before
      // use): 100*(0.5*1 + 0.3*1 + 0.2*0.90) = 98, the true maximum for transition_breakdown's
      // impact weight — proves the internal failure_rate>1 input never overshoots past what the
      // frozen formula's own weights allow.
      var sOver = PA.computeSeverity('transition_breakdown', 5.0, 100);
      assert.ok(sOver <= 100 && sOver >= 0, 'severity_score stays within [0,100]: got ' + sOver);
      assert.strictEqual(sOver, 98);

      var sUnder = PA.computeSeverity('inconsistency', -5.0, 0);
      assert.ok(sUnder >= 0, 'severity_score clamped to >=0: got ' + sUnder);
      assert.strictEqual(sUnder, 9, 'negative failure_rate clamped to 0 before use: 100*(0+0+0.2*0.45)=9');

      // Direct clamp() utility test — the actual bounding mechanism.
      assert.strictEqual(PA.clamp(150, 0, 100), 100);
      assert.strictEqual(PA.clamp(-50, 0, 100), 0);
      assert.strictEqual(PA.clamp(42, 0, 100), 42);
    })

    // ==== Unit: dataCompleteness — genuinely computes present/expected, not hardcoded ====
    .then(function () {
      var fullRows = [{ a: 1, b: 2 }, { a: 1, b: 2 }];
      assert.strictEqual(PA.dataCompleteness(fullRows, ['a', 'b']), 1, 'all fields present -> 1.0');
      var partialRows = [{ a: 1, b: null }, { a: 1, b: 2 }];
      assert.strictEqual(PA.dataCompleteness(partialRows, ['a', 'b']), 0.75, '3 of 4 expected field-values present -> 0.75');
      var emptyRows = [{ a: null, b: null }, { a: null, b: null }];
      assert.strictEqual(PA.dataCompleteness(emptyRows, ['a', 'b']), 0, 'nothing present -> 0.0');
    })

    // ================================================================
    // S9-C Semantic Correction V1 (GPT QA) — corrections #1-#4
    // ================================================================

    // ==== Correction #1: intent === 'pressure' does NOT create pressure_failure ====
    .then(function () {
      var trials = [];
      // 10 rallies, all intent==='pressure', all result==='ue' -> would have triggered the
      // old (now-removed) intent-based pressure_failure proxy at a 100% error rate.
      for (var i = 0; i < 10; i++) {
        trials.push({ trial_event_id: 't' + i, raw_json: baseRally({ intent: 'pressure', result: 'ue', quality: 'error' }) });
      }
      var patterns = PA.detectPatterns('m1', 'p1', trials);
      assert.strictEqual(patterns.filter(function (p) { return p.pattern_type === 'pressure_failure'; }).length, 0,
        'pressure_failure must never be generated from intent===\'pressure\', even at a 100% error rate');
      assert.strictEqual(patterns.some(function (p) { return p.situation === 'under_pressure'; }), false,
        'no candidate may be labeled situation=\'under_pressure\' from the removed intent-based proxy');
      assert.ok(PA.PATTERN_TYPES.indexOf('pressure_failure') !== -1, 'pressure_failure remains in the vocabulary, just unsupported');
      assert.ok(PA.UNSUPPORTED_PATTERN_TYPES.pressure_failure, 'the limitation is documented in UNSUPPORTED_PATTERN_TYPES');
    })

    // ==== Correction #2: phase error rate alone does NOT create repeated_positioning_error ====
    .then(function () {
      var trials = [];
      // 10 rallies in the same phase, all high error rate -> would have triggered the old
      // (now-removed) situation-level repeated_positioning_error proxy.
      for (var i = 0; i < 10; i++) {
        trials.push({ trial_event_id: 't' + i, raw_json: baseRally({ phase: 'defense', quality: 'error', result: 'ue' }) });
      }
      var patterns = PA.detectPatterns('m1', 'p1', trials);
      assert.strictEqual(patterns.filter(function (p) { return p.pattern_type === 'repeated_positioning_error'; }).length, 0,
        'repeated_positioning_error must never be generated from phase-level error rate alone');
      // calculateSituationMetrics itself is untouched and still legitimately measures the phase.
      var sitm = PA.calculateSituationMetrics(trials);
      var defense = sitm.filter(function (s) { return s.situation === 'defense'; })[0];
      assert.strictEqual(defense.error_rate, 100, 'the underlying situation MEASUREMENT is preserved — only the pattern trigger was removed');
      assert.ok(PA.PATTERN_TYPES.indexOf('repeated_positioning_error') !== -1, 'repeated_positioning_error remains in the vocabulary, just unsupported');
      assert.ok(PA.UNSUPPORTED_PATTERN_TYPES.repeated_positioning_error, 'the limitation is documented in UNSUPPORTED_PATTERN_TYPES');
    })

    // ==== Correction #3: nvz_arrival is unavailable/null and cannot trigger sequence_breakdown ====
    .then(function () {
      var trials = [];
      // 20 rallies, none in nvz phase -> old proxy (0/20=0% arrival, well under the old <20%
      // trigger) would have fired sequence_breakdown. Must not fire now.
      for (var i = 0; i < 20; i++) {
        trials.push({ trial_event_id: 't' + i, raw_json: baseRally({ phase: 'baseline_placeholder', result: 'continue' }) });
      }
      var seq = PA.calculateSequenceMetrics(trials);
      var nvzArrival = seq.filter(function (s) { return s.sequence_type === 'nvz_arrival'; })[0];
      assert.strictEqual(nvzArrival.attempts, null);
      assert.strictEqual(nvzArrival.arrival_rate, null);
      var patterns = PA.detectPatterns('m1', 'p1', trials);
      assert.strictEqual(patterns.filter(function (p) { return p.pattern_type === 'sequence_breakdown'; }).length, 0,
        'sequence_breakdown must never be generated from the removed nvz_arrival proxy');
      assert.ok(PA.PATTERN_TYPES.indexOf('sequence_breakdown') !== -1, 'sequence_breakdown remains in the vocabulary, just unsupported');
      assert.ok(PA.UNSUPPORTED_PATTERN_TYPES.sequence_breakdown, 'the limitation is documented in UNSUPPORTED_PATTERN_TYPES');
    })

    // ==== Correction #4: pattern thresholds come from one centralized config ====
    .then(function () {
      var required = [
        'LOW_SUCCESS_RATE_MAX', 'HIGH_ERROR_RATE_MIN',
        'POOR_SHOT_SELECTION_WINNER_RATE_MAX', 'POOR_SHOT_SELECTION_ERROR_RATE_MIN',
        'INCONSISTENCY_MIN', 'INCONSISTENCY_MAX', 'TRANSITION_BREAKDOWN_SURVIVAL_MAX'
      ];
      required.forEach(function (key) {
        assert.strictEqual(typeof PA.PATTERN_THRESHOLDS[key], 'number', 'PATTERN_THRESHOLDS.' + key + ' is a centralized numeric config value');
      });
      // Behavioral proof the detector actually reads this config, not a duplicate hardcoded copy:
      // exactly at LOW_SUCCESS_RATE_MAX (50) a shot must NOT trigger (threshold is "<", not "<=").
      var atThreshold = [];
      for (var i = 0; i < 10; i++) {
        atThreshold.push({ trial_event_id: 't' + i, raw_json: baseRally({ shot: 'reset', quality: (i < 5 ? 'good' : 'error'), result: 'continue' }) });
      }
      var patternsAt = PA.detectPatterns('m1', 'p1', atThreshold); // success_rate exactly 50
      assert.strictEqual(patternsAt.filter(function (p) { return p.pattern_type === 'low_success_rate' && p.shot_type === 'reset'; }).length, 0,
        'success_rate exactly at LOW_SUCCESS_RATE_MAX (50) must not trigger low_success_rate');
      var belowThreshold = [];
      for (var i = 0; i < 10; i++) {
        belowThreshold.push({ trial_event_id: 't' + i, raw_json: baseRally({ shot: 'reset', quality: (i < 4 ? 'good' : 'error'), result: 'continue' }) });
      }
      var patternsBelow = PA.detectPatterns('m1', 'p1', belowThreshold); // success_rate = 40, below 50
      assert.strictEqual(patternsBelow.filter(function (p) { return p.pattern_type === 'low_success_rate' && p.shot_type === 'reset'; }).length, 1,
        'success_rate below LOW_SUCCESS_RATE_MAX (50) must trigger low_success_rate');
      // Not a player-level benchmark: PATTERN_THRESHOLDS must be structurally separate from any
      // validated-level vocabulary (3.0/3.5/4.0/4.5/5.0 never appear as threshold keys/values here).
      assert.strictEqual(Object.keys(PA.PATTERN_THRESHOLDS).some(function (k) { return /^\d/.test(k); }), false);
    })

    // ==== Unit: pattern classification + severity != confidence ====
    .then(function () {
      // A shot type with only 3 samples but 100% error rate: high severity, low confidence.
      var trials = [
        { trial_event_id: 't1', raw_json: baseRally({ shot: 'drop', quality: 'error', result: 'ue' }) },
        { trial_event_id: 't2', raw_json: baseRally({ shot: 'drop', quality: 'error', result: 'ue' }) },
        { trial_event_id: 't3', raw_json: baseRally({ shot: 'drop', quality: 'error', result: 'ue' }) }
      ];
      var patterns = PA.detectPatterns('m1', 'p1', trials);
      var highErr = patterns.filter(function (p) { return p.pattern_type === 'high_error_rate'; })[0];
      assert.ok(highErr, 'high_error_rate pattern classified for a 100%-error, 3-sample shot type');
      assert.strictEqual(highErr.sample_size, 3);
      assert.strictEqual(highErr.confidence_band, 'LOW', 'only 3 samples -> LOW confidence');
      assert.ok(highErr.severity_score >= 70, 'severity is numerically high despite low confidence: got ' + highErr.severity_score);
      assert.notStrictEqual(highErr.severity_score, highErr.confidence_score, 'AC-08: severity and confidence are independent, never equal by formula');
    })

    // ==== Unit: evidence references trial_event_id, not full payload copies ====
    .then(function () {
      var trials = [
        { trial_event_id: 'trl_a', raw_json: baseRally({ shot: 'drop', quality: 'error', result: 'ue' }) },
        { trial_event_id: 'trl_b', raw_json: baseRally({ shot: 'drop', quality: 'error', result: 'ue' }) },
        { trial_event_id: 'trl_c', raw_json: baseRally({ shot: 'drop', quality: 'error', result: 'ue' }) }
      ];
      var patterns = PA.detectPatterns('m1', 'p1', trials);
      var highErr = patterns.filter(function (p) { return p.pattern_type === 'high_error_rate'; })[0];
      assert.deepStrictEqual(highErr.evidence.slice().sort(), ['trl_a', 'trl_b', 'trl_c']);
      highErr.evidence.forEach(function (e) { assert.strictEqual(typeof e, 'string', 'evidence entries are reference IDs, not payload objects'); });
    })

    // ==== AC-06: sample 0-2 never becomes a normal PatternCandidate ====
    .then(function () {
      [0, 1, 2].forEach(function (n) {
        var trials = [];
        for (var i = 0; i < n; i++) trials.push({ trial_event_id: 't' + i, raw_json: baseRally({ shot: 'drop', quality: 'error', result: 'ue' }) });
        var patterns = PA.detectPatterns('m1', 'p1', trials);
        assert.strictEqual(patterns.filter(function (p) { return p.pattern_type === 'high_error_rate'; }).length, 0, 'sample=' + n + ' must not produce a high_error_rate candidate');
      });
      var trials3 = [];
      for (var i = 0; i < 3; i++) trials3.push({ trial_event_id: 't' + i, raw_json: baseRally({ shot: 'drop', quality: 'error', result: 'ue' }) });
      var patterns3 = PA.detectPatterns('m1', 'p1', trials3);
      assert.strictEqual(patterns3.filter(function (p) { return p.pattern_type === 'high_error_rate'; }).length, 1, 'sample=3 produces exactly one candidate');
    })

    // ==== Unit: deterministic repeated execution — same input -> same output (AC-02) ====
    .then(function () {
      var trials = [
        { trial_event_id: 't1', raw_json: baseRally({ shot: 'drop', quality: 'error', result: 'ue' }) },
        { trial_event_id: 't2', raw_json: baseRally({ shot: 'drop', quality: 'error', result: 'ue' }) },
        { trial_event_id: 't3', raw_json: baseRally({ shot: 'drop', quality: 'error', result: 'ue' }) }
      ];
      var run1 = JSON.stringify(PA.detectPatterns('m1', 'p1', trials));
      var run2 = JSON.stringify(PA.detectPatterns('m1', 'p1', trials));
      assert.strictEqual(run1, run2, 'detectPatterns is a pure deterministic function of its input');
      var m1 = JSON.stringify(PA.calculateMatchMetrics(trials));
      var m2 = JSON.stringify(PA.calculateMatchMetrics(trials));
      assert.strictEqual(m1, m2);
    })

    // ==== AC-03: no NaN/Infinity anywhere in a realistic full pattern-candidate output ====
    .then(function () {
      var trials = [];
      for (var i = 0; i < 15; i++) {
        trials.push({ trial_event_id: 't' + i, raw_json: baseRally({
          shot: (i % 2 === 0) ? 'drop' : 'drive', quality: (i % 3 === 0) ? 'error' : 'good',
          result: (i % 3 === 0) ? 'ue' : 'winner', phase: (i % 4 === 0) ? 'transition' : 'nvz',
          intent: (i % 5 === 0) ? 'pressure' : 'neutralize'
        }) });
      }
      var patterns = PA.detectPatterns('m1', 'p1', trials);
      assert.deepStrictEqual(findNoNanOrInfinity(patterns), [], 'no NaN/Infinity anywhere in pattern candidates');
      assert.deepStrictEqual(findNoNanOrInfinity(PA.calculateMatchMetrics(trials)), []);
      assert.deepStrictEqual(findNoNanOrInfinity(PA.calculateShotMetrics(trials)), []);
      assert.deepStrictEqual(findNoNanOrInfinity(PA.calculateSituationMetrics(trials)), []);
      assert.deepStrictEqual(findNoNanOrInfinity(PA.calculateSequenceMetrics(trials)), []);
    })

    // ================================================================
    // Integration: Observation -> Metrics, Observation -> Pattern Candidate, Match -> AnalysisSummary
    // ================================================================
    .then(function () {
      return seedSession(MO, 'lite');
    }).then(function (ctx) {
      var rallies = [];
      // 3 rallies with the same bad shot to trigger a pattern, plus assorted others.
      for (var i = 1; i <= 3; i++) rallies.push({ game_number: 1, rally_number: i, shot: 'lob', quality: 'error', result: 'ue', phase: 'defense' });
      for (var i = 4; i <= 8; i++) rallies.push({ game_number: 1, rally_number: i, shot: 'dink', quality: 'good', result: 'winner', phase: 'nvz' });
      return addRallies(MO, ctx.session.test_session_id, rallies).then(function () { return ctx; });
    }).then(function (ctx) {
      return PA.analyzeMatch(ctx.session.test_session_id, ctx.assessment.player_id).then(function (summary) {
        assert.strictEqual(summary.match_id, ctx.session.test_session_id, 'AC-01: S9-B observation session feeds analysis as the match_id');
        assert.strictEqual(summary.overall.total_points, 8);
        assert.strictEqual(summary.shot_metrics.length, 2, 'Observation -> Metrics: shot_metrics reflects the two shot types observed');
        var lobPattern = summary.pattern_candidates.filter(function (p) { return p.shot_type === 'lob'; })[0];
        assert.ok(lobPattern, 'Observation -> Pattern Candidate: the 3-rally 100%-error lob shot produced a candidate');
        assert.strictEqual(lobPattern.sample_size, 3);
        assert.strictEqual(summary.data_status, 'partial', 'Match -> AnalysisSummary: 8 rallies on a lite session (target 20) is partial, not complete');
        assert.deepStrictEqual(findNoNanOrInfinity(summary), []);
        return ctx;
      });
    })

    // ==== AC-05 / data_status: complete once the lite sample target is met ====
    .then(function () {
      return seedSession(MO, 'lite');
    }).then(function (ctx) {
      var rallies = [];
      for (var i = 1; i <= 20; i++) rallies.push({ game_number: 1, rally_number: i, shot: 'dink', quality: 'good', result: 'winner', phase: 'nvz' });
      return addRallies(MO, ctx.session.test_session_id, rallies).then(function () { return ctx; });
    }).then(function (ctx) {
      return PA.analyzeMatch(ctx.session.test_session_id, ctx.assessment.player_id).then(function (summary) {
        assert.strictEqual(summary.data_status, 'complete', 'lite target (1 game/20 rallies) met -> complete');
      });
    })

    // ==== data_status: insufficient when there is no rally data at all ====
    .then(function () {
      return seedSession(MO, 'lite');
    }).then(function (ctx) {
      return PA.analyzeMatch(ctx.session.test_session_id, ctx.assessment.player_id).then(function (summary) {
        assert.strictEqual(summary.data_status, 'insufficient');
        assert.strictEqual(summary.overall.total_points, 0);
        assert.strictEqual(summary.pattern_candidates.length, 0);
      });
    })

    // ==== AC-05: partial/malformed session input does not crash — rejects cleanly instead ====
    .then(function () {
      return assertRejects(PA.analyzeMatch(null), 'null session_id', 'INVALID_INPUT');
    })
    .then(function () {
      return assertRejects(PA.analyzeMatch('does_not_exist'), 'unknown session_id', 'SESSION_NOT_FOUND');
    })
    .then(function () {
      return global.PBStore.createTestSession({ assessment_id: 'whatever', test_id: 'T01', feed_mode: 'machine' }).then(function (t01) {
        return assertRejects(PA.analyzeMatch(t01.test_session_id), 'non-ASMT-10 session', 'NOT_MATCH_SESSION');
      });
    })

    // ==== AC-09: no LLM/ML dependency — structural check ====
    .then(function () {
      var fs = require('fs');
      var src = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'performance-analysis-engine.js'), 'utf8');
      ['fetch(', 'XMLHttpRequest', 'Math.random(', 'openai', 'anthropic', 'require(\'http', 'WebSocket'].forEach(function (token) {
        assert.strictEqual(src.indexOf(token), -1, 'AC-09: engine source must never reference ' + token);
      });
    })

    // ==== AC-10/AC-11: no Diagnosis Engine / no training recommendation output ====
    .then(function () {
      var fs = require('fs');
      var src = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'performance-analysis-engine.js'), 'utf8');
      ['diagnosis:', 'recommendation:', 'prescription:', 'training_plan:', 'match_validation_state:', 'validated_training_level:', 'CAP_WEIGHTS'].forEach(function (token) {
        assert.strictEqual(src.indexOf(token), -1, 'AC-10/AC-11: engine source must never output ' + token);
      });
    })

    .then(function () {
      console.log('performance-analysis-engine.test.js: all assertions passed');
    });
}

run().catch(function (err) {
  console.error('performance-analysis-engine.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
