/* ============================================================
 * performance-analysis-engine.js — Pickleball App 2.0 Alpha · S9-C
 * Performance Analysis & Pattern Detection Engine — MEASURE + DETECT
 * PATTERN ONLY.
 *
 * Consumes S9-B's structured ASMT-10 rally observations
 * (test_sessions + trial_events, reused exactly as-is — this file never
 * modifies js/match-observation-engine.js or its semantics) and produces
 * an AnalysisSummary: match/shot/situation/sequence metrics plus
 * deterministic pattern candidates with severity and confidence.
 *
 * Frozen boundary (do not cross):
 *   - Measure + Detect Pattern only. NOT Diagnosis, NOT Recommendation,
 *     NOT a Strength/Weakness engine, NOT training prescription.
 *   - No LLM, no ML, no randomness — pure deterministic transforms of
 *     already-persisted data. Same input -> same output.
 *   - 0 (a real measured zero) is never conflated with null (no data /
 *     not computable). No NaN, no Infinity, anywhere in public output.
 *   - sample_size 0-2 never becomes a normal PatternCandidate.
 *   - Severity and Confidence are computed by independent formulas —
 *     never derived from one another.
 *   - Never reads/writes match_validation_state, validated_training_level,
 *     CAP, or Hard Gate decisions (those remain S9-C's future sibling
 *     and the existing review-engine.js, untouched here).
 *
 * See docs/S9-C-PERFORMANCE-ANALYSIS-ENGINE.md for the full field
 * reference and the documented rationale behind every metric/pattern
 * mapping and threshold below.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBPerformanceAnalysis = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function AnalysisError(code, message) {
    var err = new Error(message || code);
    err.name = 'AnalysisError';
    err.code = code;
    return err;
  }

  function store() {
    if (typeof PBStore === 'undefined') throw AnalysisError('DEP_MISSING', 'PBStore not loaded');
    return PBStore;
  }
  function ns() {
    if (typeof PBNamespace === 'undefined') throw AnalysisError('DEP_MISSING', 'PBNamespace not loaded');
    return PBNamespace;
  }
  function moEngine() {
    if (typeof PBMatchObservation === 'undefined') throw AnalysisError('DEP_MISSING', 'PBMatchObservation not loaded');
    return PBMatchObservation;
  }

  function round1(x) { return Math.round(x * 10) / 10; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  // §9 Zero/Null rule: a zero denominator (or missing numerator context) is null, never NaN/Infinity/0.
  function pct(numerator, denominator) {
    if (!denominator) return null;
    return round1(numerator / denominator * 100);
  }

  function rowsOf(trials) { return trials.map(function (t) { return t.raw_json || {}; }); }

  // ================================================================
  // §3 loadValidatedSession — a deliberately small, standalone re-check
  // (mirrors, does not import, match-observation-engine.js's own guard)
  // so this file never modifies S9-B.
  // ================================================================
  function loadValidatedSession(session_id) {
    return store().get('test_sessions', session_id).then(function (session) {
      if (!session) return Promise.reject(AnalysisError('SESSION_NOT_FOUND', 'test_session not found: ' + session_id));
      var canon = ns().toCanonical(session.test_id);
      if (canon !== 'ASMT-10') {
        return Promise.reject(AnalysisError('NOT_MATCH_SESSION', 'session.test_id must canonicalize to ASMT-10 (got ' + session.test_id + ')'));
      }
      return session;
    });
  }

  // ================================================================
  // §8 Match Metrics
  // ================================================================

  // A rally's `result` (S9-B/rally_event_schema_v2_3_1.json) determines whether the observed
  // player won or lost that point. 'continue'/'weak_reply' are non-terminal at rally-level
  // granularity (1 trial_event = 1 rally, not 1 shot) and are deliberately excluded from
  // points_won/points_lost rather than guessed — total_points still counts every rally.
  var POINT_WON_RESULTS = ['winner', 'forced_error_created', 'opponent_ue', 'attack_converted'];
  var POINT_LOST_RESULTS = ['ue', 'transition_lost'];

  function calculateMatchMetrics(trials) {
    var rows = rowsOf(trials);
    var total_points = rows.length;
    var points_won = rows.filter(function (r) { return POINT_WON_RESULTS.indexOf(r.result) !== -1; }).length;
    var points_lost = rows.filter(function (r) { return POINT_LOST_RESULTS.indexOf(r.result) !== -1; }).length;
    var winner_count = rows.filter(function (r) { return r.result === 'winner'; }).length;
    var unforced_error_count = rows.filter(function (r) { return r.result === 'ue'; }).length;
    var forced_error_count = rows.filter(function (r) { return r.result === 'forced_error_created'; }).length;

    return {
      total_points: total_points,
      points_won: points_won,
      points_lost: points_lost,
      winner_count: winner_count,
      unforced_error_count: unforced_error_count,
      forced_error_count: forced_error_count,
      error_rate: pct(unforced_error_count, total_points),
      winner_rate: pct(winner_count, total_points),
      // Rally length (shots per rally) has no field anywhere in the frozen S9-B rally schema —
      // 1 trial_event = 1 rally, not 1 shot, so no shot-count-per-rally is ever captured. Always
      // null rather than fabricated; see docs/S9-C-PERFORMANCE-ANALYSIS-ENGINE.md.
      rally_length_average: null,
      short_rally_rate: null,
      medium_rally_rate: null,
      long_rally_rate: null
    };
  }

  // ================================================================
  // §10 Shot Metrics — grouped by the existing S9-B `shot` field
  // ================================================================

  function calculateShotMetrics(trials) {
    var rows = rowsOf(trials);
    var byShot = {};
    rows.forEach(function (r) {
      if (r.shot == null) return; // unknown/missing shot -> excluded from this metric only (§27)
      (byShot[r.shot] = byShot[r.shot] || []).push(r);
    });
    return Object.keys(byShot).sort().map(function (shotType) {
      var rs = byShot[shotType];
      var attempts = rs.length;
      var successful = rs.filter(function (r) { return r.quality === 'good' || r.quality === 'neutral'; }).length;
      var winner_count = rs.filter(function (r) { return r.result === 'winner'; }).length;
      var error_count = rs.filter(function (r) { return r.result === 'ue'; }).length;
      return {
        shot_type: shotType,
        attempts: attempts,
        successful: successful,
        failed: attempts - successful,
        success_rate: pct(successful, attempts),
        winner_count: winner_count,
        winner_rate: pct(winner_count, attempts),
        error_count: error_count,
        error_rate: pct(error_count, attempts)
      };
    });
  }

  // ================================================================
  // §11 Situation Metrics — the frozen rally schema's only existing
  // context/situation-equivalent dimension is `phase` (serve/return/
  // third/transition/nvz/defense/finish). The spec's suggested category
  // names (offense/neutral/baseline/under_pressure) have no directly
  // coded equivalent, so per §11 ("if not existing, don't invent") this
  // uses the real existing dimension instead of a fabricated one.
  // ================================================================

  function calculateSituationMetrics(trials) {
    var rows = rowsOf(trials);
    var byPhase = {};
    rows.forEach(function (r) {
      if (r.phase == null) return;
      (byPhase[r.phase] = byPhase[r.phase] || []).push(r);
    });
    return Object.keys(byPhase).sort().map(function (situation) {
      var rs = byPhase[situation];
      var sample_size = rs.length;
      var success = rs.filter(function (r) { return r.quality === 'good' || r.quality === 'neutral'; }).length;
      var errors = rs.filter(function (r) { return r.result === 'ue'; }).length;
      return {
        situation: situation,
        sample_size: sample_size,
        success_rate: pct(success, sample_size),
        error_rate: pct(errors, sample_size)
      };
    });
  }

  // ================================================================
  // §12 Sequence Metrics — only the 6 "优先输出" fields; every other
  // named sequence (NVZ Exchange, Speed-up->Counter, Defense->Reset,
  // Reset->Kitchen Recovery) requires intra-rally shot-order data that
  // does not exist at S9-B's rally-level granularity and is therefore
  // omitted entirely rather than emitted as a fabricated placeholder.
  // ================================================================

  function calculateSequenceMetrics(trials) {
    var rows = rowsOf(trials);

    var thirdRows = rows.filter(function (r) { return r.phase === 'third'; });
    var thirdSuccess = thirdRows.filter(function (r) { return r.quality === 'good' || r.quality === 'neutral'; }).length;

    var transitionRows = rows.filter(function (r) { return r.phase === 'transition'; });
    var transitionSurvive = transitionRows.filter(function (r) { return r.result !== 'transition_lost' && r.result !== 'ue'; }).length;

    return [
      {
        sequence_type: 'third_shot',
        attempts: thirdRows.length,
        success_rate: pct(thirdSuccess, thirdRows.length)
      },
      {
        sequence_type: 'third_to_fifth_continuation',
        attempts: null,
        continuation_rate: null,
        unavailable_reason: 'requires intra-rally shot-sequence data not present in S9-B (1 trial_event = 1 rally, not 1 shot)'
      },
      {
        sequence_type: 'transition',
        attempts: transitionRows.length,
        survival_rate: pct(transitionSurvive, transitionRows.length)
      },
      {
        // S9-C Semantic Correction V1: `phase === 'nvz'` alone does not reliably prove
        // baseline/transition -> successful NVZ arrival (a rally can be coded 'nvz' without
        // the intra-rally progression that "arrival" implies). Per GPT QA correction #3, this
        // is no longer computed as nvz-phase-rallies/total-rallies; it is unavailable,
        // consistent with the third_to_fifth_continuation policy above. True NVZ arrival
        // requires intra-rally progression data S9-B does not capture.
        sequence_type: 'nvz_arrival',
        attempts: null,
        arrival_rate: null,
        unavailable_reason: 'phase===nvz alone does not reliably prove baseline/transition -> successful NVZ arrival; requires intra-rally progression data not present in S9-B'
      }
    ];
  }

  // ================================================================
  // §13/§14 Pattern types, categories, and the single centralized
  // Impact Weight configuration (§19 — one place, deterministic,
  // documented, never scattered magic numbers).
  // ================================================================

  // Full V1 vocabulary (§13). Three of these — repeated_positioning_error, pressure_failure,
  // sequence_breakdown — have NO active trigger rule as of the S9-C Semantic Correction V1 pass
  // (see UNSUPPORTED_PATTERN_TYPES below): their prior proxies were judged semantically invalid
  // by GPT QA and removed rather than left in place. They remain valid, selectable pattern_type
  // values (the vocabulary itself is preserved) but detectPatterns() never emits them until a
  // later stage adds a genuine, S9-B-field-backed rule for each.
  var PATTERN_TYPES = [
    'low_success_rate', 'high_error_rate', 'poor_shot_selection', 'repeated_positioning_error',
    'transition_breakdown', 'pressure_failure', 'inconsistency', 'sequence_breakdown'
  ];

  // S9-C Semantic Correction V1 (GPT QA, corrections #1-#3): documents which vocabulary entries
  // currently have no active detection rule, and exactly why, so this isn't silently rediscovered.
  var UNSUPPORTED_PATTERN_TYPES = {
    pressure_failure: 'intent === \'pressure\' means the player intends to pressure the opponent, ' +
      'not that the player is under pressure. No direct S9-B field represents "player is in a ' +
      'defensive/disadvantaged state" at the pattern-detection layer (§24/neutralize_opportunity ' +
      'is a per-rally coded judgment, not a situational bucket usable here without inventing a ' +
      'formula). Left unsupported in V1 rather than mislabeled.',
    repeated_positioning_error: 'A high UE/error rate in a phase does not by itself prove a ' +
      'positioning error (it could be shot selection, execution, or pressure). Left unsupported ' +
      'in V1 until a later frozen rule explicitly maps S9-B movement evidence to positioning.',
    sequence_breakdown: 'Its only V1 trigger was the nvz_arrival proxy, itself removed for the ' +
      'same reason nvz_arrival_rate is now unavailable (see calculateSequenceMetrics) — no other ' +
      'S9-B-backed trigger exists yet.'
  };

  // §19 Impact Weight — single source of truth. 0.0-1.0. Point-ending/structural failures score
  // highest; ordinary single-shot execution misses score lowest. Deterministic, no LLM judgment.
  // Kept complete for all 8 vocabulary entries (including the currently-unsupported three) so the
  // config is ready the moment a genuine trigger rule is added for any of them.
  var IMPACT_WEIGHTS = {
    transition_breakdown: 0.90,        // point-ending / critical structural failure
    pressure_failure: 0.80,            // high-leverage situational failure
    sequence_breakdown: 0.75,          // rally plan breaks down before reaching the front
    high_error_rate: 0.70,             // directly and repeatedly costs points
    poor_shot_selection: 0.65,
    repeated_positioning_error: 0.60,
    low_success_rate: 0.50,            // ordinary execution miss
    inconsistency: 0.45
  };

  // S9-C Semantic Correction V1 (GPT QA, correction #4): centralized, provisional pattern-TRIGGER
  // thresholds — previously scattered as magic numbers inline in detectPatterns(). These are S9-C
  // V1 detection heuristics for this measurement layer ONLY. They are NOT 3.0/3.5/4.0/4.5/5.0
  // player-level benchmarks, NOT Master Control V2 Hard Gate thresholds, and NOT rating standards
  // of any kind. Do not wire them into player-level benchmark/rating logic.
  var PATTERN_THRESHOLDS = {
    LOW_SUCCESS_RATE_MAX: 50,                  // success_rate below this -> low_success_rate
    HIGH_ERROR_RATE_MIN: 30,                   // error_rate above this -> high_error_rate
    POOR_SHOT_SELECTION_WINNER_RATE_MAX: 10,   // winner_rate below this AND ...
    POOR_SHOT_SELECTION_ERROR_RATE_MIN: 20,    // ... error_rate above this -> poor_shot_selection
    INCONSISTENCY_MIN: 40,                     // success_rate within [MIN, MAX] -> inconsistency
    INCONSISTENCY_MAX: 60,
    TRANSITION_BREAKDOWN_SURVIVAL_MAX: 50      // transition survival_rate below this -> transition_breakdown
  };

  // ================================================================
  // §15/§16 Minimum sample rule + confidence (frozen formulas)
  // ================================================================

  var MIN_SAMPLE_FOR_CANDIDATE = 2; // sample_size <= this -> insufficient, no candidate (§15)

  function baseSampleConfidence(sampleSize) {
    if (sampleSize <= 2) return 0.00;
    if (sampleSize <= 5) return 0.35;
    if (sampleSize <= 10) return 0.65;
    return 0.90;
  }

  function confidenceBand(score) {
    if (score < 40) return 'LOW';
    if (score < 70) return 'MEDIUM';
    return 'HIGH';
  }

  // §17 DataCompletenessFactor — present/expected ratio over the fields a given computation
  // actually reads. Deterministic, no statistical modeling. Under S9-B's own validation
  // guarantees (validateObservation requires all core fields non-null), this evaluates to 1.0
  // for every V1 pattern rule below (all read only core fields) — documented, not hardcoded;
  // it genuinely drops below 1.0 for any field set with missing values (see unit tests).
  function dataCompleteness(rows, fields) {
    if (!rows.length || !fields.length) return 1.0;
    var expected = rows.length * fields.length;
    var present = 0;
    rows.forEach(function (r) {
      fields.forEach(function (f) { if (r[f] != null) present++; });
    });
    return clamp(present / expected, 0, 1);
  }

  function computeConfidence(sampleSize, completenessFactor) {
    var base = baseSampleConfidence(sampleSize);
    var score = round1(clamp(base * completenessFactor * 100, 0, 100));
    return { confidence_score: score, confidence_band: confidenceBand(score) };
  }

  // §18 Severity (frozen formula), independent of confidence.
  function computeSeverity(patternType, failureRate, sampleSize) {
    var frequencyFactor = Math.min(sampleSize / 10, 1.0);
    var impactWeight = (IMPACT_WEIGHTS[patternType] != null) ? IMPACT_WEIGHTS[patternType] : 0.50;
    var raw = 100 * (0.50 * clamp(failureRate, 0, 1) + 0.30 * frequencyFactor + 0.20 * impactWeight);
    return round1(clamp(raw, 0, 100));
  }

  // Deterministic id: same (match, pattern_type, dimension) -> same pattern_id every run (AC-02).
  function patternId(match_id, pattern_type, dimension) {
    return ['pat', match_id, pattern_type, dimension || 'match'].join(':');
  }

  function buildCandidate(ctx) {
    if (ctx.sample_size <= MIN_SAMPLE_FOR_CANDIDATE) return null; // §15 frozen
    var completeness = dataCompleteness(ctx.completeness_rows, ctx.completeness_fields);
    var confidence = computeConfidence(ctx.sample_size, completeness);
    var severity_score = computeSeverity(ctx.pattern_type, ctx.failure_rate, ctx.sample_size);
    return {
      pattern_id: patternId(ctx.match_id, ctx.pattern_type, ctx.shot_type || ctx.situation),
      match_id: ctx.match_id,
      player_id: ctx.player_id,
      pattern_type: ctx.pattern_type,
      category: ctx.category,
      shot_type: ctx.shot_type || null,
      situation: ctx.situation || null,
      sample_size: ctx.sample_size,
      success_rate: (ctx.success_rate == null ? null : ctx.success_rate),
      error_rate: (ctx.error_rate == null ? null : ctx.error_rate),
      severity_score: severity_score,
      confidence_score: confidence.confidence_score,
      confidence_band: confidence.confidence_band,
      evidence: ctx.evidence,
      data_status: 'sufficient'
    };
  }

  // ================================================================
  // §21 Pattern Detection Pipeline (steps 3-9; steps 1-2/10 happen in
  // analyzeMatch). Deterministic rule evaluation only — never diagnosis.
  // ================================================================

  function detectPatterns(match_id, player_id, trials) {
    var rows = rowsOf(trials);
    function evidenceFor(predicate) {
      var out = [];
      trials.forEach(function (t) { if (predicate(t.raw_json || {})) out.push(t.trial_event_id); });
      return out;
    }

    var candidates = [];

    // ---- Shot-level (execution): low_success_rate, high_error_rate, poor_shot_selection, inconsistency ----
    var completenessFieldsShot = ['shot', 'quality', 'result'];
    calculateShotMetrics(trials).forEach(function (sm) {
      var shotRows = rows.filter(function (r) { return r.shot === sm.shot_type; });
      var evidence = evidenceFor(function (r) { return r.shot === sm.shot_type; });

      if (sm.success_rate != null && sm.success_rate < PATTERN_THRESHOLDS.LOW_SUCCESS_RATE_MAX) {
        candidates.push(buildCandidate({
          match_id: match_id, player_id: player_id, pattern_type: 'low_success_rate', category: 'execution',
          shot_type: sm.shot_type, sample_size: sm.attempts, success_rate: sm.success_rate, error_rate: sm.error_rate,
          failure_rate: (100 - sm.success_rate) / 100, evidence: evidence,
          completeness_rows: shotRows, completeness_fields: completenessFieldsShot
        }));
      }
      if (sm.error_rate != null && sm.error_rate > PATTERN_THRESHOLDS.HIGH_ERROR_RATE_MIN) {
        candidates.push(buildCandidate({
          match_id: match_id, player_id: player_id, pattern_type: 'high_error_rate', category: 'execution',
          shot_type: sm.shot_type, sample_size: sm.attempts, success_rate: sm.success_rate, error_rate: sm.error_rate,
          failure_rate: sm.error_rate / 100, evidence: evidence,
          completeness_rows: shotRows, completeness_fields: completenessFieldsShot
        }));
      }
      if (sm.winner_rate != null && sm.winner_rate < PATTERN_THRESHOLDS.POOR_SHOT_SELECTION_WINNER_RATE_MAX &&
          sm.error_rate != null && sm.error_rate > PATTERN_THRESHOLDS.POOR_SHOT_SELECTION_ERROR_RATE_MIN) {
        candidates.push(buildCandidate({
          match_id: match_id, player_id: player_id, pattern_type: 'poor_shot_selection', category: 'execution',
          shot_type: sm.shot_type, sample_size: sm.attempts, success_rate: sm.success_rate, error_rate: sm.error_rate,
          failure_rate: sm.error_rate / 100, evidence: evidence,
          completeness_rows: shotRows, completeness_fields: completenessFieldsShot
        }));
      }
      if (sm.success_rate != null && sm.success_rate >= PATTERN_THRESHOLDS.INCONSISTENCY_MIN && sm.success_rate <= PATTERN_THRESHOLDS.INCONSISTENCY_MAX) {
        candidates.push(buildCandidate({
          match_id: match_id, player_id: player_id, pattern_type: 'inconsistency', category: 'execution',
          shot_type: sm.shot_type, sample_size: sm.attempts, success_rate: sm.success_rate, error_rate: sm.error_rate,
          failure_rate: (100 - sm.success_rate) / 100, evidence: evidence,
          completeness_rows: shotRows, completeness_fields: completenessFieldsShot
        }));
      }
    });

    // ---- Situation-level: repeated_positioning_error is UNSUPPORTED in V1 (see
    // UNSUPPORTED_PATTERN_TYPES) — S9-C Semantic Correction V1, GPT QA correction #2. A high
    // UE/error rate in a phase does not by itself prove a positioning error, so no trigger is
    // implemented here. calculateSituationMetrics() itself is untouched and still measures
    // per-phase success_rate/error_rate; only the pattern-detection use of it was removed.

    // ---- Sequence-level: transition_breakdown (active — untouched by this correction pass) ----
    var seqMetrics = calculateSequenceMetrics(trials);
    var transitionSeq = seqMetrics.filter(function (s) { return s.sequence_type === 'transition'; })[0];
    if (transitionSeq && transitionSeq.survival_rate != null && transitionSeq.survival_rate < PATTERN_THRESHOLDS.TRANSITION_BREAKDOWN_SURVIVAL_MAX) {
      var transRows = rows.filter(function (r) { return r.phase === 'transition'; });
      var evidence = evidenceFor(function (r) { return r.phase === 'transition'; });
      candidates.push(buildCandidate({
        match_id: match_id, player_id: player_id, pattern_type: 'transition_breakdown', category: 'sequence',
        situation: 'transition', sample_size: transitionSeq.attempts, success_rate: transitionSeq.survival_rate,
        error_rate: round1(100 - transitionSeq.survival_rate), failure_rate: (100 - transitionSeq.survival_rate) / 100,
        evidence: evidence, completeness_rows: transRows, completeness_fields: ['phase', 'result']
      }));
    }
    // sequence_breakdown is UNSUPPORTED in V1 (see UNSUPPORTED_PATTERN_TYPES) — S9-C Semantic
    // Correction V1, GPT QA correction #3. Its only V1 trigger was the nvz_arrival proxy
    // (phase==='nvz' rallies / total rallies), which GPT QA judged unreliable as proof of actual
    // NVZ arrival; nvz_arrival is now unavailable (null) in calculateSequenceMetrics, so there is
    // no S9-B-backed signal left to trigger sequence_breakdown from in V1.

    // pressure_failure is UNSUPPORTED in V1 (see UNSUPPORTED_PATTERN_TYPES) — S9-C Semantic
    // Correction V1, GPT QA correction #1. intent==='pressure' means the player intends to
    // pressure the opponent, not that the player is under pressure; no direct S9-B field
    // represents "player is in a defensive/disadvantaged state" at this layer, so no
    // under_pressure proxy is used and no trigger is implemented here.

    return candidates.filter(function (c) { return c != null; });
  }

  // ================================================================
  // §26 Public entry point
  // ================================================================

  function analyzeMatch(session_id, player_id) {
    if (!session_id) return Promise.reject(AnalysisError('INVALID_INPUT', 'session_id is required'));

    return loadValidatedSession(session_id).then(function (session) {
      return store().get('assessments', session.assessment_id).then(function (assessment) {
        if (!assessment) return Promise.reject(AnalysisError('ASSESSMENT_NOT_FOUND', 'assessment not found: ' + session.assessment_id));
        if (player_id != null && assessment.player_id !== player_id) {
          return Promise.reject(AnalysisError('PLAYER_MISMATCH', 'session does not belong to player_id: ' + player_id));
        }
        return store().trialsBySession(session_id);
      });
    }).then(function (trials) {
      var overall = calculateMatchMetrics(trials);
      var shot_metrics = calculateShotMetrics(trials);
      var situation_metrics = calculateSituationMetrics(trials);
      var sequence_metrics = calculateSequenceMetrics(trials);
      var pattern_candidates = detectPatterns(session_id, player_id, trials);

      var rallies_observed = trials.length;
      var overallCompleteness = dataCompleteness(rowsOf(trials), ['phase', 'intent', 'shot', 'quality', 'movement', 'result', 'control_state']);
      var analysis_confidence = round1(clamp(baseSampleConfidence(rallies_observed) * overallCompleteness * 100, 0, 100));

      if (rallies_observed === 0) {
        return {
          match_id: session_id, player_id: (player_id || null), data_status: 'insufficient',
          overall: overall, shot_metrics: shot_metrics, situation_metrics: situation_metrics,
          sequence_metrics: sequence_metrics, pattern_candidates: pattern_candidates,
          analysis_confidence: analysis_confidence
        };
      }

      return moEngine().getObservationCompleteness(session_id).then(function (completeness) {
        var dataStatus = (completeness.sample_complete === true) ? 'complete' : 'partial';
        return {
          match_id: session_id,
          player_id: (player_id || null),
          data_status: dataStatus,
          overall: overall,
          shot_metrics: shot_metrics,
          situation_metrics: situation_metrics,
          sequence_metrics: sequence_metrics,
          pattern_candidates: pattern_candidates,
          analysis_confidence: analysis_confidence
        };
      });
    });
  }

  return {
    PATTERN_TYPES: PATTERN_TYPES.slice(),
    UNSUPPORTED_PATTERN_TYPES: JSON.parse(JSON.stringify(UNSUPPORTED_PATTERN_TYPES)),
    IMPACT_WEIGHTS: JSON.parse(JSON.stringify(IMPACT_WEIGHTS)),
    PATTERN_THRESHOLDS: JSON.parse(JSON.stringify(PATTERN_THRESHOLDS)),
    MIN_SAMPLE_FOR_CANDIDATE: MIN_SAMPLE_FOR_CANDIDATE,

    // Pure, individually testable calculation functions (§25/§28).
    calculateMatchMetrics: calculateMatchMetrics,
    calculateShotMetrics: calculateShotMetrics,
    calculateSituationMetrics: calculateSituationMetrics,
    calculateSequenceMetrics: calculateSequenceMetrics,
    detectPatterns: detectPatterns,
    baseSampleConfidence: baseSampleConfidence,
    computeConfidence: computeConfidence,
    computeSeverity: computeSeverity,
    dataCompleteness: dataCompleteness,
    clamp: clamp,

    // Storage-backed entry point (§26).
    analyzeMatch: analyzeMatch
  };
});
