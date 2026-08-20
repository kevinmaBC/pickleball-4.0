/* ============================================================
 * training-prescription-engine.js — Pickleball App 2.0 Alpha · S9-F
 * Training Prescription Integration — TRAINING PRESCRIPTION CONTRACT
 * SOURCE OF TRUTH.
 *
 * Consumes S9-E's RecommendationResult / Recommendation[] exclusively —
 * never reads raw observations, never recomputes S9-C metrics/patterns,
 * never recreates an S9-D diagnosis, never reprioritizes. Every scored
 * field (priority_rank/priority_score/priority_tier) is read verbatim
 * off the Recommendation S9-E already produced. js/match-observation-
 * engine.js, js/performance-analysis-engine.js, js/diagnosis-engine.js,
 * and js/recommendation-priority-engine.js are all untouched by this
 * file, and this file never calls PBDiagnosis/PBPerformanceAnalysis/
 * PBMatchObservation/PBStore directly — only PBRecommendationPriority,
 * and only from the optional storage-backed convenience entry point.
 *
 * Answers: "what training contract should correspond to this ranked
 * recommendation?" Does NOT answer specific ball/rep counts, minutes,
 * weekly frequency, or session structure — that is S9-G Session
 * Builder, explicitly out of scope here. Deterministic mapping only;
 * no free-form coaching, no LLM-authored plan.
 *
 * Frozen boundary (do not cross):
 *   - Pure, deterministic mapping only. No LLM, no ML, no randomness.
 *     Same RecommendationResult -> same TrainingPrescriptionResult.
 *   - priority_rank/priority_score/priority_tier are inherited
 *     unchanged from the source Recommendation — never recomputed.
 *   - A recommendation_code with no entry in
 *     RECOMMENDATION_TO_PRESCRIPTION is never guessed — it defers.
 *   - dosage_profile_code is a relative label (PRIMARY_FOCUS /
 *     STANDARD_FOCUS / LIGHT_FOCUS) only — never reps, minutes,
 *     sessions/week, or a training calendar.
 *   - drill_family_code identifies a family only; a specific drill_id
 *     is resolved only through an existing, exact-semantic-match
 *     registry (none found for this taxonomy — see docs) — never
 *     fabricated to fill the field.
 *   - kpi_profile_code identifies what to measure; kpi_target_value
 *     is never a fabricated number (no exact-match benchmark registry
 *     exists for this taxonomy) and must never be read as a
 *     3.0-5.0 player-level standard.
 *   - reassessment_profile_code never implies rating promotion/
 *     demotion — it only means "re-enter the Observation -> Analysis
 *     -> Diagnosis -> Priority loop."
 *   - Drill/KPI unresolved is NOT prescription failure — status stays
 *     'prescribed' as long as the recommendation mapping itself
 *     resolves.
 *   - All eligible recommendations retained — never truncated.
 *
 * See docs/S9-F-TRAINING-PRESCRIPTION-ENGINE.md for the full field
 * reference, the frozen mapping table, and the repo-mapping finding
 * that justifies why drill/KPI resolution stays UNRESOLVED in V1.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBTrainingPrescription = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function PrescriptionError(code, message) {
    var err = new Error(message || code);
    err.name = 'PrescriptionError';
    err.code = code;
    return err;
  }

  function recEngine() {
    if (typeof PBRecommendationPriority === 'undefined') throw PrescriptionError('DEP_MISSING', 'PBRecommendationPriority not loaded');
    return PBRecommendationPriority;
  }

  var PRESCRIPTION_VERSION = 'S9-F-V1';

  // §9 frozen Recommendation -> Prescription mapping, single centralized config.
  var RECOMMENDATION_TO_PRESCRIPTION = {
    IMPROVE_SHOT_EXECUTION: {
      training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION',
      drill_family_code: 'SHOT_EXECUTION', kpi_profile_code: 'EXECUTION_SUCCESS_RATE'
    },
    IMPROVE_SHOT_CONTROL: {
      training_objective_code: 'SHOT_CONTROL', training_mode: 'CONTROL_REPETITION',
      drill_family_code: 'SHOT_CONTROL', kpi_profile_code: 'ERROR_RATE'
    },
    IMPROVE_SHOT_SELECTION: {
      training_objective_code: 'SHOT_SELECTION', training_mode: 'DECISION_SCENARIO',
      drill_family_code: 'SHOT_SELECTION', kpi_profile_code: 'DECISION_SUCCESS_RATE'
    },
    IMPROVE_SHOT_CONSISTENCY: {
      training_objective_code: 'SHOT_CONSISTENCY', training_mode: 'CONSISTENCY_BLOCK',
      drill_family_code: 'SHOT_CONSISTENCY', kpi_profile_code: 'CONSISTENCY_RATE'
    },
    IMPROVE_TRANSITION_EXECUTION: {
      training_objective_code: 'TRANSITION_EXECUTION', training_mode: 'TRANSITION_SCENARIO',
      drill_family_code: 'TRANSITION_EXECUTION', kpi_profile_code: 'TRANSITION_SUCCESS_RATE'
    },
    IMPROVE_TRANSITION_CONTROL: {
      training_objective_code: 'TRANSITION_CONTROL', training_mode: 'TRANSITION_SCENARIO',
      drill_family_code: 'TRANSITION_CONTROL', kpi_profile_code: 'TRANSITION_CONTROL_RATE'
    }
  };

  // §17 frozen — relative dosage profile only (never reps/minutes/frequency/calendar).
  var PRIORITY_TO_DOSAGE_PROFILE = {
    HIGH: 'PRIMARY_FOCUS',
    MEDIUM: 'STANDARD_FOCUS',
    LOW: 'LIGHT_FOCUS'
  };

  // §19 frozen default — no repo-registered, more specific reassessment registry was found during
  // minimal repository mapping, so every V1 prescription uses this single value.
  var DEFAULT_REASSESSMENT_PROFILE = 'MATCH_RECHECK';

  function isPlainObject(v) { return v != null && typeof v === 'object'; }

  // ================================================================
  // §28 Public pure entry point
  // ================================================================

  function prescribeRecommendations(recommendationResult) {
    if (!recommendationResult) throw PrescriptionError('INVALID_INPUT', 'recommendationResult is required');
    if (recommendationResult.match_id == null) throw PrescriptionError('INVALID_INPUT', 'recommendationResult.match_id is required');
    if (recommendationResult.recommendations != null && !Array.isArray(recommendationResult.recommendations)) {
      throw PrescriptionError('INVALID_INPUT', 'recommendationResult.recommendations must be an array');
    }

    var match_id = recommendationResult.match_id;
    var player_id = (recommendationResult.player_id != null) ? recommendationResult.player_id : null;
    var recs = recommendationResult.recommendations || []; // partial S9-E data degrades safely

    var deferred_prescriptions = [];
    var prescriptions = [];

    recs.forEach(function (rec) {
      // ---- §21/§23/§31/§44: malformed / ineligible input never crashes, always defers ----
      if (!isPlainObject(rec)) {
        deferred_prescriptions.push({ recommendation_id: null, recommendation_code: null, reason: 'INVALID_RECOMMENDATION', status: 'deferred' });
        return;
      }
      if (rec.status !== 'recommended') {
        deferred_prescriptions.push({
          recommendation_id: (rec.recommendation_id != null ? rec.recommendation_id : null),
          recommendation_code: (rec.recommendation_code != null ? rec.recommendation_code : null),
          reason: 'INVALID_RECOMMENDATION', status: 'deferred'
        });
        return;
      }
      if (rec.recommendation_code == null) {
        deferred_prescriptions.push({
          recommendation_id: (rec.recommendation_id != null ? rec.recommendation_id : null),
          recommendation_code: null, reason: 'INVALID_RECOMMENDATION', status: 'deferred'
        });
        return;
      }

      // §9/§39 frozen: an unmapped recommendation_code is never guessed.
      var mapping = RECOMMENDATION_TO_PRESCRIPTION[rec.recommendation_code];
      if (!mapping) {
        deferred_prescriptions.push({
          recommendation_id: (rec.recommendation_id != null ? rec.recommendation_id : null),
          recommendation_code: rec.recommendation_code, reason: 'UNSUPPORTED_RECOMMENDATION', status: 'deferred'
        });
        return;
      }

      // §16/§21 frozen: rank/priority_score/priority_tier must all be present, and the tier must
      // resolve to a known dosage profile, to inherit priority unchanged.
      var dosageProfile = (rec.priority_tier != null) ? PRIORITY_TO_DOSAGE_PROFILE[rec.priority_tier] : null;
      if (rec.rank == null || rec.priority_score == null || rec.priority_tier == null || !dosageProfile) {
        deferred_prescriptions.push({
          recommendation_id: (rec.recommendation_id != null ? rec.recommendation_id : null),
          recommendation_code: rec.recommendation_code, reason: 'MISSING_PRIORITY', status: 'deferred'
        });
        return;
      }

      // §24 Prescription Identity: one Recommendation -> one Prescription (no re-merging here;
      // S9-E already deduplicated at the recommendation layer).
      prescriptions.push({
        prescription_id: ['rx', match_id, rec.recommendation_id].join(':'),
        match_id: match_id,
        player_id: player_id,

        source_recommendation_id: rec.recommendation_id,
        recommendation_code: rec.recommendation_code,

        skill: (rec.skill != null ? rec.skill : null),
        context: (rec.context != null ? rec.context : null),

        training_objective_code: mapping.training_objective_code,
        training_mode: mapping.training_mode,
        drill_family_code: mapping.drill_family_code,

        priority_rank: rec.rank,                 // §16 hard rule: inherited unchanged
        priority_score: rec.priority_score,       // §16 hard rule: inherited unchanged
        priority_tier: rec.priority_tier,         // §16 hard rule: inherited unchanged

        kpi_profile_code: mapping.kpi_profile_code,
        kpi_target_value: null,                            // §15: no exact-match benchmark registry exists (see docs)
        kpi_target_status: 'BENCHMARK_NOT_RESOLVED',

        dosage_profile_code: dosageProfile,

        reassessment_profile_code: DEFAULT_REASSESSMENT_PROFILE,

        resolved_drill_ids: [],                            // §12/§13: no exact-match drill registry exists (see docs);
        drill_resolution_status: 'UNRESOLVED',              // unresolved != prescription failure

        status: 'prescribed'
      });
    });

    var primary = prescriptions.filter(function (p) { return p.priority_rank === 1; })[0];

    return {
      match_id: match_id,
      player_id: player_id,
      prescriptions: prescriptions,               // §25: all eligible retained, never truncated
      deferred_prescriptions: deferred_prescriptions,
      primary_prescription_id: primary ? primary.prescription_id : null,
      prescription_count: prescriptions.length,
      prescription_version: PRESCRIPTION_VERSION
    };
  }

  // ================================================================
  // §29 Storage-backed convenience entry point — reaches storage only
  // through PBRecommendationPriority, never PBDiagnosis/
  // PBPerformanceAnalysis/PBMatchObservation/PBStore directly.
  // ================================================================

  function prescribeMatch(matchId, playerId) {
    return recEngine().prioritizeMatch(matchId, playerId).then(function (recommendationResult) {
      return prescribeRecommendations(recommendationResult);
    });
  }

  return {
    PRESCRIPTION_VERSION: PRESCRIPTION_VERSION,
    RECOMMENDATION_TO_PRESCRIPTION: JSON.parse(JSON.stringify(RECOMMENDATION_TO_PRESCRIPTION)),
    PRIORITY_TO_DOSAGE_PROFILE: JSON.parse(JSON.stringify(PRIORITY_TO_DOSAGE_PROFILE)),
    DEFAULT_REASSESSMENT_PROFILE: DEFAULT_REASSESSMENT_PROFILE,

    prescribeRecommendations: prescribeRecommendations,
    prescribeMatch: prescribeMatch
  };
});
