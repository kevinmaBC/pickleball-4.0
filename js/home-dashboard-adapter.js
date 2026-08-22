/* ============================================================
 * home-dashboard-adapter.js — Pickleball App 2.0 Alpha · S11-B / S11-B-R1
 * Home / Priority Dashboard Experience — HOME VIEW MODEL ADAPTER.
 *
 * Thin product/presentation integration layer: reads already-persisted
 * S10 workflow/session/reassessment records (js/storage.js) and
 * composes S10-B's Dashboard Projection (js/dashboard-integration-
 * engine.js) together with S11-A's Journey Projection (js/product-
 * journey-orchestrator.js) into one disposable Home Experience View
 * Model. It never decides a diagnosis, recommendation, priority,
 * prescription, progress value, reassessment outcome, workflow
 * transition, or product journey stage — those stay exactly where
 * S9/S10/S11-A already put them.
 *
 * S11-B-R1 architecture repair: this file no longer calls the S9
 * decision pipeline (PBDiagnosis.diagnoseMatch /
 * PBRecommendationPriority.prioritizeDiagnosis /
 * PBTrainingPrescription.prescribeRecommendations) under any
 * circumstance — regenerating a Recommendation/Prescription on every
 * Home render was itself a form of deciding them, not merely
 * projecting already-decided output. There is currently no accepted
 * durable S9 Recommendation/Prescription store in this repository for
 * S11-B to read (confirmed: js/storage.js has no such store); this file
 * does not invent one, does not add a cache/localStorage workaround,
 * and does not reconstruct a recommendation from unrelated data. When
 * no prepared Dashboard data is available, `dashboard.items` is simply
 * `[]` (via PBDashboard.projectDashboardList([]), never invented) and
 * Home renders an honest partial state (`focus`/`training` = null) —
 * see docs/S11-B-HOME-PRIORITY-DASHBOARD.md's "Known Limitation".
 *
 * Frozen boundary (do not cross):
 *   - No LLM, no ML, no randomness, no re-ranking. dashboard.items[0]
 *     (already sorted by PBDashboard's own upstream-rank-only ordering)
 *     is always the sole source for `focus`/`why`/`training` — never
 *     re-sorted by confidence, evidence count, recency, or any UI
 *     heuristic.
 *   - `next_action` is copied verbatim from PBProductJourney's own
 *     journey.next_action — this file never invents a second primary
 *     action and never decides CTA enablement itself.
 *   - This file has ZERO runtime dependency on PBDiagnosis,
 *     PBRecommendationPriority, PBTrainingPrescription, PBWorkflow,
 *     PBPrescriptionWorkflow, PBSessionEvidence, PBProgressTracking, or
 *     PBReassessment/PBProgressReassessmentPersistence — it never
 *     requires/reads any of their globals, and never calls
 *     diagnoseMatch/prioritizeDiagnosis/prescribeRecommendations/
 *     .transition/startTraining/supersede/computeProgress/
 *     computeProgressSnapshot/runReassessment. No domain mutation and
 *     no S9/progress/reassessment recalculation happen here.
 *   - The only engines invoked are the two accepted projection layers
 *     (PBDashboard.projectDashboardList, PBProductJourney.projectJourney)
 *     — never a duplicated/local reimplementation of either.
 *   - No new persistence: every PBStore call here is a read; nothing is
 *     ever put()/created. The composed Home View Model itself is never
 *     persisted (disposable, regenerable from the same accepted data).
 *
 * POST-S11-R3B-2: `assessment` (from js/assessment-journey-bridge.js's read-only Assessment
 * Context, threaded through S11-A as journey.assessment_context — a third accepted read-only
 * source alongside PBDashboard/PBProductJourney) is added to the Home View Model. It is read
 * verbatim and never allowed to influence focus/why/training/next_action — see
 * js/assessment-journey-bridge.js's own frozen-boundary comment for what it may/may not do.
 *
 * See docs/S11-B-HOME-PRIORITY-DASHBOARD.md for the full field
 * reference and the known-limitation writeup.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBHomeDashboardAdapter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function AdapterError(code, message) {
    var err = new Error(message || code);
    err.name = 'HomeDashboardAdapterError';
    err.code = code;
    return err;
  }

  var CONTRACT_VERSION = 'S11-B-V1';
  var SCHEMA_VERSION = '1.0';

  // Match-transfer trend values that count as a genuinely resolved MATCH progress signal.
  var RESOLVED_TRENDS = ['IMPROVING', 'DECLINING', 'STABLE'];

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

  // ================================================================
  // Pure composer — combines an already-computed PBDashboard `dashboard`
  // and PBProductJourney `journey` into one Home View Model. Never
  // recomputes either; only reads fields already present on them.
  // Testable with plain-object fixtures (no DOM, no PBStore).
  // ================================================================

  function composeHomeDashboard(opts) {
    opts = opts || {};
    if (!isPlainObject(opts)) throw AdapterError('INVALID_INPUT', 'opts must be an object');
    if (opts.player_id == null) throw AdapterError('INVALID_INPUT', 'player_id is required');
    var journey = opts.journey;
    if (!isPlainObject(journey)) throw AdapterError('INVALID_INPUT', 'journey (PBProductJourney output) is required');
    if (!isPlainObject(journey.next_action)) throw AdapterError('INVALID_INPUT', 'journey.next_action is required');
    var dashboard = isPlainObject(opts.dashboard) ? opts.dashboard : { items: [] };
    var items = Array.isArray(dashboard.items) ? dashboard.items : [];

    // §11: current focus is always dashboard.items[0] — S10-B's own upstream-rank ordering,
    // never re-sorted here. An empty/unavailable dashboard (§6/§10) yields focus/why/training =
    // null, never a fabricated recommendation.
    var focusItem = items.length ? items[0] : null;

    var focus = focusItem ? {
      recommendation_id: focusItem.recommendation_id != null ? focusItem.recommendation_id : null,
      rank: focusItem.rank != null ? focusItem.rank : null,
      priority_tier: focusItem.priority_tier != null ? focusItem.priority_tier : null,
      skill: focusItem.skill != null ? focusItem.skill : null,
      context: focusItem.context != null ? focusItem.context : null,
      recommendation_code: focusItem.recommendation_code != null ? focusItem.recommendation_code : null
    } : null;

    // §12: traceability only — never a free-form causal explanation.
    var trace = focusItem && isPlainObject(focusItem.traceability) ? focusItem.traceability : null;
    var why = focusItem ? {
      source_skill_gap_ids: trace && Array.isArray(trace.source_skill_gap_ids) ? trace.source_skill_gap_ids.slice() : [],
      evidence_pattern_ids: trace && Array.isArray(trace.evidence_pattern_ids) ? trace.evidence_pattern_ids.slice() : [],
      evidence_refs: trace && Array.isArray(trace.evidence_refs) ? trace.evidence_refs.slice() : []
    } : null;

    // §13: training direction — never reps/minutes/dosage/calendar, only the prescription
    // summary fields S10-B already projected.
    var summary = focusItem && isPlainObject(focusItem.prescription_summary) ? focusItem.prescription_summary : null;
    var training = summary ? {
      prescription_ref: focusItem.prescription_ref != null ? focusItem.prescription_ref : null,
      objective: summary.training_objective_code != null ? summary.training_objective_code : null,
      mode: summary.training_mode != null ? summary.training_mode : null,
      drill_family: summary.drill_family_code != null ? summary.drill_family_code : null,
      kpi_profile: summary.kpi_profile_code != null ? summary.kpi_profile_code : null,
      drill_resolution_status: summary.drill_resolution_status != null ? summary.drill_resolution_status : 'UNRESOLVED',
      kpi_target_status: summary.kpi_target_status != null ? summary.kpi_target_status : 'BENCHMARK_NOT_RESOLVED'
    } : null;

    // §15: exactly one primary next_action, copied verbatim from S11-A — never invented here.
    // §11: REASSESSMENT_READY overrides a training CTA structurally, via S11-A's own frozen
    // precedence, regardless of whether a Dashboard focus is available at all.
    var next_action = {
      code: journey.next_action.code,
      enabled: journey.next_action.enabled === true,
      target_ref: journey.next_action.target_ref != null ? journey.next_action.target_ref : null
    };

    // §10/§15: journey.presentation_flags are copied verbatim (S11-A already decided them);
    // additive, presentation-only flags are appended, never replacing or reinterpreting them.
    var flags = Array.isArray(journey.presentation_flags) ? journey.presentation_flags.slice() : [];
    if (dashboard.message_code && flags.indexOf(dashboard.message_code) === -1) flags.push(dashboard.message_code);

    // §12/§20: MATCH Transfer honesty — a resolved MATCH progress snapshot (already computed
    // upstream, never here) must show IMPROVING/DECLINING/STABLE; anything else (absent,
    // UNRESOLVED, INSUFFICIENT_DATA) surfaces this additive flag so the UI never implies MATCH
    // transfer has been validated. TRAINING progress is read from a completely separate field
    // and never substituted in.
    var progressContext = isPlainObject(journey.progress_context) ? journey.progress_context : null;
    var matchProgress = progressContext && isPlainObject(progressContext.match) ? progressContext.match : null;
    var matchResolved = !!matchProgress && RESOLVED_TRENDS.indexOf(matchProgress.trend) !== -1;
    if (!matchResolved && flags.indexOf('MATCH_TRANSFER_NOT_VALIDATED') === -1) flags.push('MATCH_TRANSFER_NOT_VALIDATED');

    // POST-S11-R3B-2: assessment (from js/assessment-journey-bridge.js, passed through verbatim by
    // S11-A as journey.assessment_context) is read here only — never recomputed, never allowed to
    // influence focus/why/training/next_action, which stay exactly as derived above. It exists so
    // HOME can tell "assessment exists with partial evidence" apart from "no traceability at all"
    // without fabricating a recommendation.
    var assessment = isPlainObject(journey.assessment_context) ? journey.assessment_context : null;

    return {
      home_dashboard: {
        player_id: opts.player_id,

        journey: {
          stage: journey.stage,
          status: journey.status,
          headline_code: journey.headline_code != null ? journey.headline_code : null
        },

        assessment: assessment,

        focus: focus,
        why: why,
        training: training,

        next_action: next_action,

        flags: flags,

        schema_version: SCHEMA_VERSION,
        view_version: CONTRACT_VERSION
      }
    };
  }

  // ================================================================
  // IO orchestration (browser-only; reads persisted S10 records only —
  // never re-runs S9). No new query/store, no duplicated S9/S10/S11-A
  // logic.
  // ================================================================

  function storeEngine() {
    if (typeof PBStore === 'undefined') throw AdapterError('DEP_MISSING', 'PBStore not loaded');
    return PBStore;
  }
  function dashboardEngine() {
    if (typeof PBDashboard === 'undefined') throw AdapterError('DEP_MISSING', 'PBDashboard not loaded');
    return PBDashboard;
  }
  function journeyEngine() {
    if (typeof PBProductJourney === 'undefined') throw AdapterError('DEP_MISSING', 'PBProductJourney not loaded');
    return PBProductJourney;
  }
  // POST-S11-R3B-2: soft dependency (never added to ioEnginesReady's hard-required list) so a
  // page/test that loads this adapter without the bridge degrades to assessment_context = null
  // rather than failing to load Home at all.
  function bridgeEngine() {
    return (typeof PBAssessmentJourneyBridge === 'undefined') ? null : PBAssessmentJourneyBridge;
  }

  function ioEnginesReady() {
    return typeof PBStore !== 'undefined' && typeof PBDashboard !== 'undefined' && typeof PBProductJourney !== 'undefined';
  }

  // §6/§7: no accepted durable S9 Recommendation/Prescription store exists yet in this
  // repository, so there is currently no "genuinely available prepared Dashboard data" for this
  // file to read — it honestly projects an empty item list (PBDashboard's own accepted empty-
  // state contract) rather than regenerating one via the S9 pipeline. When a future stage adds
  // durable S9 output, this is the single place that would start reading it.
  function loadDashboard() {
    return dashboardEngine().projectDashboardList([]);
  }

  // Picks the most recently updated development_cycle for the player (or none). All 9 workflow
  // states are handled by PBProductJourney itself — no filtering by state here.
  function pickCurrentCycle(cycles) {
    if (!cycles || !cycles.length) return null;
    var sorted = cycles.slice().sort(function (a, b) {
      var au = a.updated_at || a.created_at || '', bu = b.updated_at || b.created_at || '';
      return au < bu ? 1 : (au > bu ? -1 : 0);
    });
    return sorted[0];
  }

  // Reads only already-persisted, already-accepted records (adapter may read PBStore, never
  // decide). No cycle_kpi_baselines/reassessment progress is recomputed here — since no
  // development_cycle writer exists in this app yet, `progress` stays [] (an honest read of what
  // is actually persisted), which PBProductJourney itself already handles gracefully
  // (PARTIAL/PROGRESS_NOT_YET_AVAILABLE, never fabricated).
  function loadJourneyInputs(player_id) {
    var store = storeEngine();
    var bridge = bridgeEngine();
    // POST-S11-R3B-2: read-only Assessment Context from js/assessment-journey-bridge.js — a
    // failure here (e.g. no gate table for this target level) must never fail the whole Home
    // load, so it degrades to null exactly like the try/catch around projectJourney below does.
    var assessmentContextPromise = bridge ? bridge.loadAssessmentContext(player_id).catch(function () { return null; }) : Promise.resolve(null);
    return Promise.all([
      store.listDevelopmentCyclesByPlayer(player_id),
      store.listPrescriptionWorkflowsByPlayer(player_id),
      store.listSessionResultsByPlayer(player_id),
      store.listReassessmentsByPlayer(player_id),
      assessmentContextPromise
    ]).then(function (r) {
      return {
        development_cycle: pickCurrentCycle(r[0] || []),
        prescription_workflows: r[1] || [],
        session_results: r[2] || [],
        reassessment: r[3] || [],
        assessment_context: r[4] || null
      };
    });
  }

  function loadHomeDashboard(player_id) {
    if (!ioEnginesReady()) return Promise.reject(AdapterError('DEP_MISSING', 'required modules not loaded'));
    if (player_id == null) return Promise.reject(AdapterError('INVALID_INPUT', 'player_id is required'));

    return loadJourneyInputs(player_id).then(function (journeyInputs) {
      var dashboardResult = loadDashboard();
      var items = dashboardResult.dashboard.items;
      // If a future stage supplies prepared Dashboard items, their already-computed
      // recommendation/prescription refs are read verbatim into the journey input — never
      // recomputed. Today `items` is always [], so these are always [] too.
      var recommendations = items.map(function (it) {
        return { recommendation_id: it.recommendation_id, rank: it.rank, status: it.engine_status, source_skill_gap_ids: (it.traceability || {}).source_skill_gap_ids };
      });
      var prescriptions = items.filter(function (it) { return it.prescription_ref; }).map(function (it) {
        return Object.assign({ prescription_id: it.prescription_ref, source_recommendation_id: it.recommendation_id }, it.prescription_summary || {});
      });

      var journeyOpts = {
        player: { player_id: player_id },
        recommendations: recommendations,
        prescriptions: prescriptions,
        prescription_workflows: journeyInputs.prescription_workflows,
        session_results: journeyInputs.session_results,
        progress: [],
        reassessment: journeyInputs.reassessment
      };
      if (journeyInputs.development_cycle) journeyOpts.development_cycle = journeyInputs.development_cycle;
      // POST-S11-R3B-2: additive-only — see js/product-journey-orchestrator.js's own comment at
      // its assessment_context read site; never influences stage/next_action derivation.
      journeyOpts.assessment_context = journeyInputs.assessment_context;

      var journeyResult;
      try {
        journeyResult = journeyEngine().projectJourney(journeyOpts);
      } catch (e) {
        // A malformed/legacy persisted cycle must never crash the Home panel — degrade to the
        // honest "no active cycle" projection rather than surfacing a raw engine error.
        journeyResult = journeyEngine().projectJourney({ player: { player_id: player_id } });
      }

      return composeHomeDashboard({ player_id: player_id, journey: journeyResult.journey, dashboard: dashboardResult.dashboard });
    });
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,

    // pure (Node-testable, no DOM/PBStore)
    composeHomeDashboard: composeHomeDashboard,
    pickCurrentCycle: pickCurrentCycle,

    // IO orchestration (browser-only)
    loadHomeDashboard: loadHomeDashboard
  };
});
