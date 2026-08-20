/* ============================================================
 * recommendation-priority-engine.js — Pickleball App 2.0 Alpha · S9-E
 * Recommendation Prioritization Engine — RECOMMENDATION PRIORITY
 * SOURCE OF TRUTH.
 *
 * Consumes S9-D's DiagnosisResult / SkillGap[] exclusively — never
 * reads raw observations, never recomputes S9-C metrics/patterns, never
 * recreates an S9-D diagnosis, never recomputes S9-D severity/
 * confidence/priority_signal. js/match-observation-engine.js,
 * js/performance-analysis-engine.js, and js/diagnosis-engine.js are all
 * untouched by this file, and this file never calls
 * PBPerformanceAnalysis directly — only PBDiagnosis, and only from the
 * optional storage-backed convenience entry point.
 *
 * Answers: "which diagnosed Skill Gaps should be improved first?" Does
 * NOT answer how to train them — no drill selection, no repetition
 * count, no session duration/frequency, no training calendar. That is
 * S9-F Training Prescription, explicitly out of scope here.
 *
 * Frozen boundary (do not cross):
 *   - Pure, deterministic mapping only. No LLM, no ML, no randomness.
 *     Same DiagnosisResult -> same RecommendationResult.
 *   - PriorityScore = SkillGap.priority_signal, verbatim. No new
 *     weighted formula, no tactical-impact bonus, no level modifier,
 *     no player-rating input.
 *   - skill_gap.priority_signal == null is never converted to 0 — it
 *     defers with reason MISSING_PRIORITY_SIGNAL.
 *   - A diagnosis_code with no entry in DIAGNOSIS_TO_RECOMMENDATION is
 *     never guessed — it defers with reason UNSUPPORTED_DIAGNOSIS.
 *   - Merge aggregation is always max, never sum/average (avoids
 *     artificial score inflation from multiple supporting diagnoses).
 *   - No drill/dosage/frequency/duration output. No rating promotion/
 *     demotion. No 3.0-5.0 benchmark creation or reinterpretation of
 *     priority tiers as a rating standard.
 *   - Retains all eligible recommendations — never truncates to a
 *     top-N; "top" is simply rank === 1.
 *
 * See docs/S9-E-RECOMMENDATION-PRIORITY-ENGINE.md for the full field
 * reference and documented rationale.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBRecommendationPriority = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function RecommendationError(code, message) {
    var err = new Error(message || code);
    err.name = 'RecommendationError';
    err.code = code;
    return err;
  }

  function diagEngine() {
    if (typeof PBDiagnosis === 'undefined') throw RecommendationError('DEP_MISSING', 'PBDiagnosis not loaded');
    return PBDiagnosis;
  }

  var RECOMMENDATION_VERSION = 'S9-E-V1';

  // §9/§10 frozen Diagnosis -> Recommendation mapping. recommendation_code stays shot-agnostic
  // (no IMPROVE_DROP/IMPROVE_RESET/IMPROVE_DINK explosion) — `skill` (carried through from the
  // SkillGap) expresses the specific shot separately. TRANSITION_CONTROL_GAP has no S9-D producer
  // yet (S9-D's own PATTERN_TO_DIAGNOSIS never emits it) but the recommendation code is kept ready
  // per the frozen V1 vocabulary — an unknown diagnosis_code never falls back to a guessed code.
  var DIAGNOSIS_TO_RECOMMENDATION = {
    SHOT_EXECUTION_GAP: 'IMPROVE_SHOT_EXECUTION',
    SHOT_CONTROL_GAP: 'IMPROVE_SHOT_CONTROL',
    SHOT_SELECTION_GAP: 'IMPROVE_SHOT_SELECTION',
    SHOT_CONSISTENCY_GAP: 'IMPROVE_SHOT_CONSISTENCY',
    TRANSITION_EXECUTION_GAP: 'IMPROVE_TRANSITION_EXECUTION',
    TRANSITION_CONTROL_GAP: 'IMPROVE_TRANSITION_CONTROL'
  };

  // §13 frozen — Operational Recommendation Priority Bands ONLY. These are NOT 3.0/3.5/4.0/4.5/5.0
  // player-level benchmarks, NOT player/skill rating, NOT DUPR, NOT an assessment grade, and NOT a
  // Master Control V2 Hard Gate threshold. They classify a priority_score (itself inherited
  // verbatim from S9-D, which inherited it from S9-C) into an operational HIGH/MEDIUM/LOW band for
  // recommendation ordering only.
  var PRIORITY_TIER_THRESHOLDS = {
    HIGH_MIN: 70,   // priority_score >= 70 -> HIGH
    MEDIUM_MIN: 40  // 40 <= priority_score < 70 -> MEDIUM; below 40 -> LOW
  };

  // §20 frozen — centralized reason-signal thresholds. Only these four deterministic labels are
  // ever produced; no FOUNDATIONAL_SKILL/LEVEL_LIMITING/BLOCKS_ADVANCEMENT/MATCH_CRITICAL/
  // TACTICALLY_URGENT/MENTAL_WEAKNESS or any other invented reason.
  var REASON_SIGNAL_THRESHOLDS = {
    HIGH_SEVERITY_MIN: 70,
    HIGH_CONFIDENCE_MIN: 70,
    HIGH_PRIORITY_SIGNAL_MIN: 70
  };

  function priorityTier(score) {
    if (score >= PRIORITY_TIER_THRESHOLDS.HIGH_MIN) return 'HIGH';
    if (score >= PRIORITY_TIER_THRESHOLDS.MEDIUM_MIN) return 'MEDIUM';
    return 'LOW';
  }

  function reasonSignalsFor(merged) {
    var signals = [];
    if (merged.severity_score >= REASON_SIGNAL_THRESHOLDS.HIGH_SEVERITY_MIN) signals.push('HIGH_SEVERITY');
    if (merged.confidence_score >= REASON_SIGNAL_THRESHOLDS.HIGH_CONFIDENCE_MIN) signals.push('HIGH_CONFIDENCE');
    if (merged.priority_score >= REASON_SIGNAL_THRESHOLDS.HIGH_PRIORITY_SIGNAL_MIN) signals.push('HIGH_PRIORITY_SIGNAL');
    if (merged.source_skill_gap_ids.length > 1) signals.push('MULTIPLE_EVIDENCE');
    return signals; // each condition can fire at most once -> already deduplicated by construction
  }

  // §16 Recommendation Identity: player_id + match_id + recommendation_code + skill + context.
  function identityKey(r) {
    return [r.player_id, r.match_id, r.recommendation_code, r.skill, r.context]
      .map(function (v) { return v == null ? '-' : String(v); }).join('|');
  }

  function recommendationId(match_id, recommendation_code, skill, context) {
    return ['rec', match_id, recommendation_code, (skill || '-'), (context || '-')].join(':');
  }

  // §17/§18 frozen: merge duplicate-identity raw recommendations — union source_skill_gap_ids,
  // max-aggregate every score (never sum/average: max(74,72)=74, not 146).
  function dedupeAndMerge(rawRecs) {
    var byKey = {};
    var order = [];
    rawRecs.forEach(function (r) {
      var key = identityKey(r);
      if (!byKey[key]) {
        byKey[key] = {
          match_id: r.match_id, player_id: r.player_id,
          diagnosis_code: r.diagnosis_code, skill: r.skill, context: r.context,
          recommendation_code: r.recommendation_code,
          source_skill_gap_ids: r.source_skill_gap_ids.slice(),
          severity_score: r.severity_score, confidence_score: r.confidence_score,
          diagnosis_priority_signal: r.diagnosis_priority_signal, priority_score: r.priority_score
        };
        order.push(key);
      } else {
        var e = byKey[key];
        e.severity_score = Math.max(e.severity_score, r.severity_score);
        e.confidence_score = Math.max(e.confidence_score, r.confidence_score);
        e.diagnosis_priority_signal = Math.max(e.diagnosis_priority_signal, r.diagnosis_priority_signal);
        e.priority_score = Math.max(e.priority_score, r.priority_score); // §19: tier computed AFTER this final merge
        r.source_skill_gap_ids.forEach(function (id) { if (e.source_skill_gap_ids.indexOf(id) === -1) e.source_skill_gap_ids.push(id); });
      }
    });
    return order.map(function (key) { return byKey[key]; });
  }

  // §22 frozen deterministic ranking. null skill/context sort last (stable, explicit — never a
  // random tie-break); by construction no two recommendations can tie on all six keys, since
  // identity dedup already guarantees uniqueness of (player,match,code,skill,context).
  function compareNullableStringAsc(a, b) {
    if (a === b) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return a < b ? -1 : (a > b ? 1 : 0);
  }
  function compareRecommendations(a, b) {
    if (b.priority_score !== a.priority_score) return b.priority_score - a.priority_score;     // 1. priority_score DESC
    if (b.confidence_score !== a.confidence_score) return b.confidence_score - a.confidence_score; // 2. confidence_score DESC
    if (b.severity_score !== a.severity_score) return b.severity_score - a.severity_score;      // 3. severity_score DESC
    var codeCmp = compareNullableStringAsc(a.recommendation_code, b.recommendation_code);       // 4. recommendation_code ASC
    if (codeCmp !== 0) return codeCmp;
    var skillCmp = compareNullableStringAsc(a.skill, b.skill);                                  // 5. skill ASC
    if (skillCmp !== 0) return skillCmp;
    return compareNullableStringAsc(a.context, b.context);                                      // 6. context ASC
  }

  // ================================================================
  // §28 Public pure entry point
  // ================================================================

  function prioritizeDiagnosis(diagnosisResult) {
    if (!diagnosisResult) throw RecommendationError('INVALID_INPUT', 'diagnosisResult is required');
    if (diagnosisResult.match_id == null) throw RecommendationError('INVALID_INPUT', 'diagnosisResult.match_id is required');
    if (diagnosisResult.skill_gaps != null && !Array.isArray(diagnosisResult.skill_gaps)) {
      throw RecommendationError('INVALID_INPUT', 'diagnosisResult.skill_gaps must be an array');
    }

    var match_id = diagnosisResult.match_id;
    var player_id = (diagnosisResult.player_id != null) ? diagnosisResult.player_id : null;
    var skillGaps = diagnosisResult.skill_gaps || []; // partial S9-D data degrades safely (§30)

    var deferred_recommendations = [];
    var rawRecs = [];

    skillGaps.forEach(function (gap) {
      if (!gap || typeof gap !== 'object') {
        // malformed entry — never an undefined-property crash (§30)
        deferred_recommendations.push({ skill_gap_id: null, diagnosis_code: null, reason: 'INVALID_SKILL_GAP', status: 'deferred' });
        return;
      }

      // §31 frozen: only status === 'supported' is eligible. Never reinterpret upstream status.
      if (gap.status !== 'supported') {
        deferred_recommendations.push({
          skill_gap_id: (gap.skill_gap_id != null ? gap.skill_gap_id : null),
          diagnosis_code: (gap.diagnosis_code != null ? gap.diagnosis_code : null),
          reason: 'INVALID_SKILL_GAP', status: 'deferred'
        });
        return;
      }

      var recommendation_code = DIAGNOSIS_TO_RECOMMENDATION[gap.diagnosis_code];
      if (!recommendation_code) {
        // §10 frozen: unknown diagnosis_code is never guessed.
        deferred_recommendations.push({
          skill_gap_id: (gap.skill_gap_id != null ? gap.skill_gap_id : null),
          diagnosis_code: (gap.diagnosis_code != null ? gap.diagnosis_code : null),
          reason: 'UNSUPPORTED_DIAGNOSIS', status: 'deferred'
        });
        return;
      }

      if (gap.priority_signal == null) {
        // §12 frozen: null (unavailable) is never converted to 0 (measured zero).
        deferred_recommendations.push({
          skill_gap_id: (gap.skill_gap_id != null ? gap.skill_gap_id : null),
          diagnosis_code: gap.diagnosis_code,
          reason: 'MISSING_PRIORITY_SIGNAL', status: 'deferred'
        });
        return;
      }

      rawRecs.push({
        match_id: match_id, player_id: player_id,
        diagnosis_code: gap.diagnosis_code,
        skill: (gap.skill != null ? gap.skill : null),
        context: (gap.context != null ? gap.context : null),
        recommendation_code: recommendation_code,
        source_skill_gap_ids: (gap.skill_gap_id != null ? [gap.skill_gap_id] : []),
        severity_score: (gap.severity_score != null ? gap.severity_score : 0),
        confidence_score: (gap.confidence_score != null ? gap.confidence_score : 0),
        diagnosis_priority_signal: gap.priority_signal,
        priority_score: gap.priority_signal // §11 frozen: PriorityScore = SkillGap.priority_signal, verbatim
      });
    });

    var merged = dedupeAndMerge(rawRecs);

    var recommendations = merged.map(function (m) {
      return {
        recommendation_id: recommendationId(m.match_id, m.recommendation_code, m.skill, m.context),
        match_id: m.match_id,
        player_id: m.player_id,
        diagnosis_code: m.diagnosis_code,
        skill: m.skill,
        context: m.context,
        recommendation_code: m.recommendation_code,
        source_skill_gap_ids: m.source_skill_gap_ids,
        severity_score: m.severity_score,
        confidence_score: m.confidence_score,
        diagnosis_priority_signal: m.diagnosis_priority_signal,
        priority_score: m.priority_score,
        priority_tier: priorityTier(m.priority_score), // §19: computed after merge is finalized
        reason_signals: reasonSignalsFor(m),
        status: 'recommended'
      };
    });

    recommendations.sort(compareRecommendations);
    recommendations.forEach(function (r, i) { r.rank = i + 1; }); // §23

    return {
      match_id: match_id,
      player_id: player_id,
      recommendations: recommendations,           // §24: all eligible retained, never truncated
      deferred_recommendations: deferred_recommendations,
      top_recommendation_id: recommendations.length ? recommendations[0].recommendation_id : null,
      recommendation_count: recommendations.length,
      recommendation_version: RECOMMENDATION_VERSION
    };
  }

  // ================================================================
  // §29 Storage-backed convenience entry point — reaches storage only
  // through PBDiagnosis, never PBPerformanceAnalysis/PBStore directly.
  // ================================================================

  function prioritizeMatch(matchId, playerId) {
    return diagEngine().diagnoseMatch(matchId, playerId).then(function (diagnosisResult) {
      return prioritizeDiagnosis(diagnosisResult);
    });
  }

  return {
    RECOMMENDATION_VERSION: RECOMMENDATION_VERSION,
    DIAGNOSIS_TO_RECOMMENDATION: JSON.parse(JSON.stringify(DIAGNOSIS_TO_RECOMMENDATION)),
    PRIORITY_TIER_THRESHOLDS: JSON.parse(JSON.stringify(PRIORITY_TIER_THRESHOLDS)),
    REASON_SIGNAL_THRESHOLDS: JSON.parse(JSON.stringify(REASON_SIGNAL_THRESHOLDS)),

    prioritizeDiagnosis: prioritizeDiagnosis,
    prioritizeMatch: prioritizeMatch
  };
});
