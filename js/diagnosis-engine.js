/* ============================================================
 * diagnosis-engine.js — Pickleball App 2.0 Alpha · S9-D
 * Diagnosis / Skill Gap Engine — DIAGNOSIS SOURCE OF TRUTH.
 *
 * Consumes S9-C's AnalysisSummary / PatternCandidate[] exclusively —
 * never re-reads raw observations, never recomputes shot metrics, never
 * recomputes pattern thresholds, never bypasses S9-C to "find its own"
 * problems. js/performance-analysis-engine.js and
 * js/match-observation-engine.js are both untouched by this file.
 *
 * Answers: "what Skill Gap does this evidence-supported Performance
 * Pattern represent?" Does NOT answer what to practice, how long, or
 * what's next in a lesson — that is explicitly out of scope (S9-E+).
 *
 * Frozen boundary (do not cross):
 *   - Pure, deterministic mapping only. No LLM, no ML, no randomness.
 *     Same AnalysisSummary -> same DiagnosisResult.
 *   - pattern.confidence_score < 40 can never become a supported
 *     SkillGap (Evidence Gate, §14).
 *   - A pattern_type with no entry in PATTERN_TO_DIAGNOSIS (the three
 *     S9-C-unsupported types: pressure_failure, repeated_positioning_error,
 *     sequence_breakdown) can never become a supported SkillGap either —
 *     absence from the map IS the guard, not a separate check to bypass.
 *   - No root-cause fabrication (paddle angle, grip, swing path, late
 *     contact, mental, footwork, positioning) — V1 only diagnoses
 *     execution / control / selection / consistency / transition.
 *   - No player-level benchmark (3.0-5.0) creation or interpretation.
 *   - priority_signal is a signal, not a recommendation, drill choice,
 *     training plan, or rating change.
 *
 * See docs/S9-D-DIAGNOSIS-ENGINE.md for the full field reference and
 * the documented rationale behind the pattern -> diagnosis mapping.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBDiagnosis = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function DiagnosisError(code, message) {
    var err = new Error(message || code);
    err.name = 'DiagnosisError';
    err.code = code;
    return err;
  }

  function paEngine() {
    if (typeof PBPerformanceAnalysis === 'undefined') throw DiagnosisError('DEP_MISSING', 'PBPerformanceAnalysis not loaded');
    return PBPerformanceAnalysis;
  }

  function round1(x) { return Math.round(x * 10) / 10; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

  var DIAGNOSIS_VERSION = 'S9-D-V1';

  // §14 Evidence Gate (frozen): a pattern with confidence below this can never become a
  // supported SkillGap, regardless of severity.
  var EVIDENCE_GATE_MIN_CONFIDENCE = 40;

  // §10/§11 frozen V1 taxonomy — existence in this list is not evidence support; only the
  // mapping table below (which patterns are actually wired) determines what gets diagnosed.
  var GAP_DOMAINS = ['shot_execution', 'consistency', 'shot_selection', 'transition', 'rally_management', 'pressure_recovery'];
  var GAP_TYPES = ['execution', 'consistency', 'selection', 'transition', 'control', 'recovery'];

  // §9/§12 frozen Pattern -> Diagnosis mapping. diagnosis_code stays shot-agnostic (no
  // DROP_EXECUTION_GAP/RESET_EXECUTION_GAP explosion) — `skill` (from the pattern's shot_type)
  // carries the specific shot separately. Deliberately excludes S9-C's three unsupported pattern
  // types (repeated_positioning_error, pressure_failure, sequence_breakdown, per S9-C's own
  // UNSUPPORTED_PATTERN_TYPES) — their absence here IS the "no supported diagnosis" guard (§13).
  var PATTERN_TO_DIAGNOSIS = {
    low_success_rate:     { diagnosis_code: 'SHOT_EXECUTION_GAP',      gap_domain: 'shot_execution', gap_type: 'execution' },
    high_error_rate:      { diagnosis_code: 'SHOT_CONTROL_GAP',        gap_domain: 'shot_execution', gap_type: 'control' },
    poor_shot_selection:  { diagnosis_code: 'SHOT_SELECTION_GAP',      gap_domain: 'shot_selection',  gap_type: 'selection' },
    inconsistency:        { diagnosis_code: 'SHOT_CONSISTENCY_GAP',    gap_domain: 'consistency',     gap_type: 'consistency' },
    transition_breakdown: { diagnosis_code: 'TRANSITION_EXECUTION_GAP', gap_domain: 'transition',     gap_type: 'execution' }
  };

  // §21 Traceability: a lightweight reference to which S9-C metric bucket backs this pattern,
  // never a copy of the metric/candidate payload.
  function metricRefFor(pattern) {
    if (pattern.category === 'execution' && pattern.shot_type) return 'shot_metrics:' + pattern.shot_type;
    if (pattern.category === 'sequence' && pattern.situation) return 'sequence_metrics:' + pattern.situation;
    if (pattern.category === 'situational' && pattern.situation) return 'situation_metrics:' + pattern.situation;
    return 'overall';
  }

  function average(nums) {
    if (!nums.length) return null;
    var sum = nums.reduce(function (a, b) { return a + b; }, 0);
    return sum / nums.length;
  }

  // §19 Deduplication identity: player_id + match_id + diagnosis_code + skill + context.
  function identityKey(g) {
    return [g.player_id, g.match_id, g.diagnosis_code, g.skill, g.context]
      .map(function (v) { return v == null ? '-' : String(v); }).join('|');
  }

  function skillGapId(match_id, diagnosis_code, skill, context) {
    return ['gap', match_id, diagnosis_code, (skill || '-'), (context || '-')].join(':');
  }

  // §16/§17/§18/§19: merges duplicate-identity raw gaps (max severity, max confidence, unioned
  // evidence), then computes the frozen Priority Signal per finalized gap.
  function dedupeAndAggregate(rawGaps) {
    var byKey = {};
    var order = [];
    rawGaps.forEach(function (g) {
      var key = identityKey(g);
      if (!byKey[key]) {
        byKey[key] = {
          match_id: g.match_id, player_id: g.player_id,
          gap_domain: g.gap_domain, gap_type: g.gap_type,
          skill: g.skill, context: g.context, diagnosis_code: g.diagnosis_code,
          severity_score: g.severity_score, confidence_score: g.confidence_score,
          evidence_pattern_ids: g.evidence_pattern_ids.slice(),
          evidence_metric_refs: g.evidence_metric_refs.slice()
        };
        order.push(key);
      } else {
        var existing = byKey[key];
        existing.severity_score = Math.max(existing.severity_score, g.severity_score); // §16 frozen: max, never sum
        existing.confidence_score = Math.max(existing.confidence_score, g.confidence_score); // §17 frozen: max, never sum
        g.evidence_pattern_ids.forEach(function (id) { if (existing.evidence_pattern_ids.indexOf(id) === -1) existing.evidence_pattern_ids.push(id); });
        g.evidence_metric_refs.forEach(function (r) { if (existing.evidence_metric_refs.indexOf(r) === -1) existing.evidence_metric_refs.push(r); });
      }
    });
    return order.map(function (key) {
      var g = byKey[key];
      // §18 frozen: PrioritySignal = 0.60*Severity + 0.40*Confidence, clamped [0,100]. Recomputed
      // post-merge, per §19 ("priority_signal = recompute").
      var priority_signal = round1(clamp(0.60 * g.severity_score + 0.40 * g.confidence_score, 0, 100));
      return {
        skill_gap_id: skillGapId(g.match_id, g.diagnosis_code, g.skill, g.context),
        match_id: g.match_id,
        player_id: g.player_id,
        gap_domain: g.gap_domain,
        gap_type: g.gap_type,
        skill: g.skill,
        context: g.context,
        diagnosis_code: g.diagnosis_code,
        severity_score: g.severity_score,
        confidence_score: g.confidence_score,
        priority_signal: priority_signal,
        evidence_pattern_ids: g.evidence_pattern_ids,
        evidence_metric_refs: g.evidence_metric_refs,
        status: 'supported'
      };
    });
  }

  // ================================================================
  // §24 Public pure entry point
  // ================================================================

  function diagnoseAnalysis(analysisSummary) {
    if (!analysisSummary) throw DiagnosisError('INVALID_INPUT', 'analysisSummary is required');
    if (analysisSummary.match_id == null) throw DiagnosisError('INVALID_INPUT', 'analysisSummary.match_id is required');
    if (analysisSummary.pattern_candidates != null && !Array.isArray(analysisSummary.pattern_candidates)) {
      throw DiagnosisError('INVALID_INPUT', 'analysisSummary.pattern_candidates must be an array');
    }

    var match_id = analysisSummary.match_id;
    var player_id = (analysisSummary.player_id != null) ? analysisSummary.player_id : null;
    var candidates = analysisSummary.pattern_candidates || []; // partial S9-C data degrades safely (§25)

    var insufficient_evidence = [];
    var rawGaps = [];

    candidates.forEach(function (pattern) {
      if (!pattern || pattern.pattern_type == null) return; // malformed candidate entry — skip, never crash (§25)

      var mapping = PATTERN_TO_DIAGNOSIS[pattern.pattern_type];
      if (!mapping) {
        // §13 frozen: an S9-C-unsupported pattern type can never become a supported diagnosis.
        insufficient_evidence.push({
          pattern_id: (pattern.pattern_id != null ? pattern.pattern_id : null),
          reason: 'UNSUPPORTED_PATTERN',
          confidence_score: (pattern.confidence_score != null ? pattern.confidence_score : null),
          required_status: null
        });
        return;
      }

      if (pattern.confidence_score == null || pattern.confidence_score < EVIDENCE_GATE_MIN_CONFIDENCE) {
        // §14 frozen Evidence Gate.
        insufficient_evidence.push({
          pattern_id: (pattern.pattern_id != null ? pattern.pattern_id : null),
          reason: 'LOW_CONFIDENCE',
          confidence_score: (pattern.confidence_score != null ? pattern.confidence_score : null),
          required_status: 'MEDIUM_OR_HIGH'
        });
        return;
      }

      rawGaps.push({
        match_id: match_id,
        player_id: player_id,
        gap_domain: mapping.gap_domain,
        gap_type: mapping.gap_type,
        skill: pattern.shot_type || null,      // §20: skill <- shot_type where applicable, never invented
        context: pattern.situation || null,    // §20: context <- situation where applicable, never invented
        diagnosis_code: mapping.diagnosis_code,
        severity_score: (pattern.severity_score != null ? pattern.severity_score : 0),
        confidence_score: pattern.confidence_score,
        evidence_pattern_ids: (pattern.pattern_id != null ? [pattern.pattern_id] : []),
        evidence_metric_refs: [metricRefFor(pattern)]
      });
    });

    var skill_gaps = dedupeAndAggregate(rawGaps);

    // §23 frozen: no supported gaps -> null, never 0. Otherwise average of supported confidences.
    var diagnosis_confidence = skill_gaps.length
      ? round1(clamp(average(skill_gaps.map(function (g) { return g.confidence_score; })), 0, 100))
      : null;

    return {
      match_id: match_id,
      player_id: player_id,
      data_status: (analysisSummary.data_status != null ? analysisSummary.data_status : null), // §22: inherited from S9-C, never redefined
      skill_gaps: skill_gaps,
      insufficient_evidence: insufficient_evidence,
      diagnosis_confidence: diagnosis_confidence,
      diagnosis_version: DIAGNOSIS_VERSION
    };
  }

  // ================================================================
  // Storage-backed convenience entry point (§24)
  // ================================================================

  function diagnoseMatch(matchId, playerId) {
    return paEngine().analyzeMatch(matchId, playerId).then(function (summary) {
      return diagnoseAnalysis(summary);
    });
  }

  return {
    DIAGNOSIS_VERSION: DIAGNOSIS_VERSION,
    EVIDENCE_GATE_MIN_CONFIDENCE: EVIDENCE_GATE_MIN_CONFIDENCE,
    GAP_DOMAINS: GAP_DOMAINS.slice(),
    GAP_TYPES: GAP_TYPES.slice(),
    PATTERN_TO_DIAGNOSIS: JSON.parse(JSON.stringify(PATTERN_TO_DIAGNOSIS)),

    diagnoseAnalysis: diagnoseAnalysis,
    diagnoseMatch: diagnoseMatch
  };
});
