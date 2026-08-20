/* ============================================================
 * dashboard-integration-engine.js — Pickleball App 2.0 Alpha · S10-B
 * Recommendation / Priority Dashboard Integration Layer —
 * DASHBOARD VIEW MODEL SOURCE OF TRUTH.
 *
 * Decision Presentation Layer, NOT a Decision Engine. Projects
 * already-computed S9 Recommendation / Priority / Training Prescription
 * output and S10-A Workflow state into a deterministic,
 * presentation-safe Dashboard View Model. Never recomputes rank,
 * priority_score, priority_tier, a diagnosis, a recommendation mapping,
 * a prescription mapping, or a workflow state.
 *
 * This file has ZERO runtime dependency on js/match-observation-engine.js,
 * js/performance-analysis-engine.js, js/diagnosis-engine.js,
 * js/recommendation-priority-engine.js, js/training-prescription-engine.js,
 * js/workflow-integration-engine.js or js/storage.js — it never
 * requires/reads global PBMatchObservation / PBPerformanceAnalysis /
 * PBDiagnosis / PBRecommendationPriority / PBTrainingPrescription /
 * PBWorkflow / PBStore. It only accepts already-computed
 * Recommendation / Prescription / SkillGap / Workflow-cycle objects (or
 * plain reference values) from the caller and projects them; the same
 * zero-coupling guarantee js/workflow-integration-engine.js (S10-A)
 * uses to structurally prove it never recalculates an upstream
 * decision — see docs/S10-B-DASHBOARD-INTEGRATION.md.
 *
 * Frozen boundary (do not cross):
 *   - Pure, deterministic, regenerable projection only. No LLM, no ML,
 *     no randomness, no Date.now()/timestamp fields — the View Model is
 *     disposable and must be exactly reproducible from the same input.
 *   - rank / priority_score / priority_tier are copied verbatim from
 *     the input Recommendation. A missing rank is reported as
 *     rank_status: 'UNRESOLVED', never guessed or defaulted to 0/1.
 *   - Recommendation / Priority / Prescription stay on distinct fields
 *     (recommendation_code vs. rank/priority_score/priority_tier vs.
 *     prescription_ref/prescription_summary) — never collapsed into one
 *     merged object that could be mistaken for a new source of truth.
 *   - UNRESOLVED / BENCHMARK_NOT_RESOLVED / UNSUPPORTED_* machine codes
 *     are always preserved verbatim alongside an optional humanized
 *     label — never translated away into FAILED/ERROR/NO_TRAINING.
 *   - A workflow state of REASSESSMENT_READY is always surfaced
 *     (reassessment_pending: true + an explicit presentation note) —
 *     the existing recommendation/prescription stay visible for
 *     history, but are never implied to still be unquestionably fresh.
 *   - List ordering follows the upstream rank only (ascending; missing
 *     rank sorts last) — never confidence, evidence count, skill, or
 *     any new UI heuristic.
 *
 * See docs/S10-B-DASHBOARD-INTEGRATION.md for the full field reference.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBDashboard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function DashboardError(code, message) {
    var err = new Error(message || code);
    err.name = 'DashboardError';
    err.code = code;
    return err;
  }

  var DASHBOARD_VIEW_VERSION = 'S10-B-V1';
  var SCHEMA_VERSION = '1.0';

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

  // §13/§14 frozen — machine codes are always preserved verbatim; this is an additive, optional
  // humanized label only, never a replacement for the raw code.
  var PRESENTATION_LABELS = {
    UNRESOLVED: 'Not yet resolved',
    BENCHMARK_NOT_RESOLVED: 'Benchmark not yet resolved',
    UNSUPPORTED_DIAGNOSIS: 'Not supported by current diagnosis rules',
    UNSUPPORTED_RECOMMENDATION: 'Not supported by current recommendation rules',
    MISSING_PRIORITY_SIGNAL: 'Priority not yet available'
  };
  function humanize(code) {
    if (code == null) return null;
    return Object.prototype.hasOwnProperty.call(PRESENTATION_LABELS, code) ? PRESENTATION_LABELS[code] : code;
  }

  // §15 frozen empty/partial-state messages — deterministic text, never implies "everything is fine".
  var PRESENTATION_NOTES = {
    NO_RECOMMENDATION: 'No active recommendation available',
    PRESCRIPTION_MISSING: 'Recommendation available. Training prescription not yet available.',
    DRILL_UNRESOLVED: 'Training direction available. Specific drill unresolved.',
    REASSESSMENT_REQUIRED: 'New evidence available. Reassessment required.'
  };

  // ================================================================
  // §8/§9 Single dashboard_item projection.
  // ================================================================

  function projectRecommendation(opts) {
    opts = opts || {};
    var recommendation = opts.recommendation;
    if (!isPlainObject(recommendation)) throw DashboardError('INVALID_INPUT', 'recommendation is required');
    if (recommendation.recommendation_id == null) throw DashboardError('INVALID_INPUT', 'recommendation.recommendation_id is required');

    var prescription = isPlainObject(opts.prescription) ? opts.prescription : null;
    var workflow = isPlainObject(opts.workflow) ? opts.workflow : null;
    var skillGaps = Array.isArray(opts.skill_gaps) ? opts.skill_gaps : [];

    // §10 frozen: rank/priority_score/priority_tier are read verbatim, never recomputed. A
    // missing rank is UNRESOLVED, never inferred.
    var rank = recommendation.rank != null ? recommendation.rank : null;
    var priority_score = recommendation.priority_score != null ? recommendation.priority_score : null;
    var priority_tier = recommendation.priority_tier != null ? recommendation.priority_tier : null;
    var rank_status = rank == null ? 'UNRESOLVED' : 'RESOLVED';

    // §13: only the one known upstream value is given a friendlier presentation label; every
    // other engine_status value (deferred, or anything else) passes through verbatim, never
    // invented as FAILED/ERROR/NO_TRAINING.
    var status = recommendation.status === 'recommended' ? 'ACTIVE' : (recommendation.status != null ? recommendation.status : 'UNKNOWN');

    // §12 traceability — evidence_pattern_ids are only ever derived from explicitly supplied
    // SkillGap objects; if none are supplied, they stay [] rather than being fabricated.
    var sourceSkillGapIds = Array.isArray(recommendation.source_skill_gap_ids) ? recommendation.source_skill_gap_ids.slice() : [];
    var evidencePatternIds = [];
    sourceSkillGapIds.forEach(function (gapId) {
      var gap = skillGaps.filter(function (g) { return g && g.skill_gap_id === gapId; })[0];
      if (gap && Array.isArray(gap.evidence_pattern_ids)) {
        gap.evidence_pattern_ids.forEach(function (pid) { if (evidencePatternIds.indexOf(pid) === -1) evidencePatternIds.push(pid); });
      }
    });
    var evidenceRefs = Array.isArray(opts.evidence_refs)
      ? opts.evidence_refs.slice()
      : (workflow && Array.isArray(workflow.evidence_refs) ? workflow.evidence_refs.slice() : []);

    // §D Workflow status — presentation passthrough only, never a competing calculation.
    var workflow_state = workflow && workflow.state != null ? workflow.state : 'UNRESOLVED';
    var reassessment_pending = workflow_state === 'REASSESSMENT_READY';

    // §C Prescription summary — projection only; UNRESOLVED/BENCHMARK_NOT_RESOLVED preserved
    // verbatim, no drill/reps/minutes/KPI target ever fabricated here.
    var prescription_summary = null;
    if (prescription) {
      var drill_resolution_status = prescription.drill_resolution_status != null ? prescription.drill_resolution_status : 'UNRESOLVED';
      var kpi_target_status = prescription.kpi_target_status != null ? prescription.kpi_target_status : 'BENCHMARK_NOT_RESOLVED';
      prescription_summary = {
        prescription_id: prescription.prescription_id != null ? prescription.prescription_id : null,
        training_objective_code: prescription.training_objective_code != null ? prescription.training_objective_code : null,
        training_mode: prescription.training_mode != null ? prescription.training_mode : null,
        drill_family_code: prescription.drill_family_code != null ? prescription.drill_family_code : null,
        kpi_profile_code: prescription.kpi_profile_code != null ? prescription.kpi_profile_code : null,
        kpi_target_value: prescription.kpi_target_value != null ? prescription.kpi_target_value : null,
        kpi_target_status: kpi_target_status,
        kpi_target_status_label: humanize(kpi_target_status),
        dosage_profile_code: prescription.dosage_profile_code != null ? prescription.dosage_profile_code : null,
        resolved_drill_ids: Array.isArray(prescription.resolved_drill_ids) ? prescription.resolved_drill_ids.slice() : [],
        drill_resolution_status: drill_resolution_status,
        drill_resolution_status_label: humanize(drill_resolution_status),
        reassessment_profile_code: prescription.reassessment_profile_code != null ? prescription.reassessment_profile_code : null,
        status: prescription.status != null ? prescription.status : null
      };
    }

    // §15 deterministic empty/partial presentation notes — additive, never replaces raw fields.
    var presentation_notes = [];
    if (!prescription) {
      presentation_notes.push({ code: 'PRESCRIPTION_MISSING', message: PRESENTATION_NOTES.PRESCRIPTION_MISSING });
    } else if (prescription_summary.drill_resolution_status === 'UNRESOLVED') {
      presentation_notes.push({ code: 'DRILL_UNRESOLVED', message: PRESENTATION_NOTES.DRILL_UNRESOLVED });
    }
    if (reassessment_pending) {
      presentation_notes.push({ code: 'REASSESSMENT_REQUIRED', message: PRESENTATION_NOTES.REASSESSMENT_REQUIRED });
    }

    return {
      dashboard_item: {
        recommendation_id: recommendation.recommendation_id,
        rank: rank,
        rank_status: rank_status,
        priority_tier: priority_tier,
        priority_score: priority_score,
        skill: recommendation.skill != null ? recommendation.skill : null,
        context: recommendation.context != null ? recommendation.context : null,
        recommendation_code: recommendation.recommendation_code != null ? recommendation.recommendation_code : null,
        status: status,
        engine_status: recommendation.status != null ? recommendation.status : null,

        traceability: {
          source_skill_gap_ids: sourceSkillGapIds,
          evidence_pattern_ids: evidencePatternIds,
          evidence_refs: evidenceRefs
        },

        prescription_ref: prescription ? (prescription.prescription_id != null ? prescription.prescription_id : null) : null,
        prescription_status: prescription ? 'AVAILABLE' : 'NOT_AVAILABLE',
        prescription_summary: prescription_summary,

        workflow_state: workflow_state,
        reassessment_pending: reassessment_pending,

        presentation_notes: presentation_notes,

        schema_version: SCHEMA_VERSION,
        dashboard_version: DASHBOARD_VIEW_VERSION
      }
    };
  }

  // ================================================================
  // §10 Dashboard list projection — sorts by upstream rank ascending
  // only; missing rank sorts last. Relies on Array#sort's ES2019+
  // stable-sort guarantee (true of every Node/browser this repo targets)
  // so equal/missing ranks preserve input order rather than reshuffling.
  // ================================================================

  function projectDashboardList(items) {
    if (!Array.isArray(items)) throw DashboardError('INVALID_INPUT', 'items must be an array');

    var projected = items.map(function (it) { return projectRecommendation(it).dashboard_item; });

    projected.sort(function (a, b) {
      if (a.rank == null && b.rank == null) return 0;
      if (a.rank == null) return 1;   // unresolved rank sorts last
      if (b.rank == null) return -1;
      return a.rank - b.rank;         // §11 frozen: upstream rank ascending, no other heuristic
    });

    var dashboard = {
      items: projected,
      item_count: projected.length,
      schema_version: SCHEMA_VERSION,
      dashboard_version: DASHBOARD_VIEW_VERSION
    };

    // §15 Case A: no recommendations must never be presented as "everything is fine".
    if (projected.length === 0) {
      dashboard.message_code = 'NO_RECOMMENDATION';
      dashboard.message = PRESENTATION_NOTES.NO_RECOMMENDATION;
    }

    return { dashboard: dashboard };
  }

  return {
    DASHBOARD_VIEW_VERSION: DASHBOARD_VIEW_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    PRESENTATION_LABELS: JSON.parse(JSON.stringify(PRESENTATION_LABELS)),
    PRESENTATION_NOTES: JSON.parse(JSON.stringify(PRESENTATION_NOTES)),

    humanize: humanize,
    projectRecommendation: projectRecommendation,
    projectDashboardList: projectDashboardList
  };
});
