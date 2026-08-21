/* ============================================================
 * progress-reassessment-adapter.js — Pickleball App 2.0 Alpha · S11-D
 * Progress / Reassessment Experience — VIEW MODEL ADAPTER.
 *
 * Turns already-existing S10-E Progress/Reassessment truth plus S11-A
 * Journey truth into one disposable presentation View Model. This file
 * is READ -> PROJECT -> EXPLAIN -> ROUTE. It is not a Progress Engine,
 * Reassessment Engine, Diagnosis Engine, Recommendation Engine, or
 * Level Promotion Engine.
 *
 * Frozen boundary (do not cross):
 *   - Never calculates baseline, current KPI, delta, trend, or
 *     readiness itself. The only progress-producing call is
 *     PBProgressReassessmentPersistence.getCurrentProgressDurable —
 *     the already-accepted S10-E-R1 read+project composition (reads
 *     the immutable persisted cycle_kpi_baseline + persisted
 *     training_evidence, then calls PBProgressTracking's pure
 *     computeProgressSnapshot; it writes nothing). This file never
 *     calls PBProgressReassessmentPersistence.captureBaselineDurable
 *     (that would create/persist a baseline — forbidden: baseline is
 *     read-only here) and never calls PBProgressTracking or
 *     PBCycleBaseline's own compute/capture entry points directly.
 *   - Zero runtime dependency on PBDiagnosis/PBRecommendationPriority/
 *     PBTrainingPrescription (no S9 rerun) and on any S10 mutation
 *     entry point (PBWorkflow.transition, PBPrescriptionWorkflow
 *     .transition/startTraining, PBSessionEvidence.transition,
 *     PBSessionEvidencePersistence.completeSessionDurable,
 *     PBProgressReassessmentPersistence.runReassessmentDurable/
 *     supersedePrescriptionWorkflowDurable/completeCycleDurable) — this
 *     file is read-side only.
 *   - TRAINING and MATCH progress are always two independent fields
 *     (`training_progress` / `match_transfer`) — never merged, never
 *     one substituted for the other.
 *   - Reassessment readiness is read verbatim from the same
 *     authoritative signal S11-A/S11-C already use
 *     (`development_cycle.state === 'REASSESSMENT_READY'` /
 *     `journey.stage === 'READY_TO_REASSESS'`) — never recomputed.
 *   - `next_action` is copied verbatim from PBProductJourney's own
 *     journey.next_action — this file never invents a second primary
 *     action.
 *   - No new persistence: every PBStore call here is a read; nothing is
 *     ever put()/created. The composed View Model is disposable.
 *
 * See docs/S11-D-PROGRESS-REASSESSMENT-EXPERIENCE.md for the full field
 * reference and known-limitation writeup.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBProgressReassessmentAdapter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function AdapterError(code, message) {
    var err = new Error(message || code);
    err.name = 'ProgressReassessmentAdapterError';
    err.code = code;
    return err;
  }

  var CONTRACT_VERSION = 'S11-D-V1';
  var SCHEMA_VERSION = '1.0';
  var RESOLVED_TRENDS = ['IMPROVING', 'DECLINING', 'STABLE'];

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

  // ================================================================
  // Pure composer — combines already-fetched plain records (never
  // recomputing any of them) into the Progress/Reassessment View Model.
  // Testable with plain-object fixtures (no DOM, no PBStore).
  // ================================================================

  function composeProgressReassessment(opts) {
    opts = opts || {};
    if (!isPlainObject(opts)) throw AdapterError('INVALID_INPUT', 'opts must be an object');
    if (opts.player_id == null) throw AdapterError('INVALID_INPUT', 'player_id is required');
    var journey = opts.journey;
    if (!isPlainObject(journey) || !isPlainObject(journey.next_action)) throw AdapterError('INVALID_INPUT', 'journey (PBProductJourney output) is required');

    var cycle = isPlainObject(opts.cycle) ? opts.cycle : null;
    var workflow = isPlainObject(opts.workflow) ? opts.workflow : null;
    var snapshot = workflow && isPlainObject(workflow.prescription_snapshot) ? workflow.prescription_snapshot : null;
    var flags = Array.isArray(journey.presentation_flags) ? journey.presentation_flags.slice() : [];

    // §24 Cycle Summary — read-only passthrough from the current Prescription Workflow's own
    // snapshot (S10-C's frozen field set); never regenerates a Recommendation/Prescription.
    var cycleOut = cycle ? {
      cycle_id: cycle.cycle_id,
      state: cycle.state,
      kpi_profile_code: snapshot && snapshot.kpi_profile_code != null ? snapshot.kpi_profile_code : null,
      training_objective_code: snapshot && snapshot.training_objective_code != null ? snapshot.training_objective_code : null,
      training_mode: snapshot && snapshot.training_mode != null ? snapshot.training_mode : null,
      workflow_state: workflow ? workflow.state : null
    } : null;

    // §13/§26: Baseline belongs to S10-E and is read-only here — a missing baseline is always
    // honest ("BASELINE_UNRESOLVED"), never a fabricated one from the first Session Result.
    var training_progress = null;
    var match_transfer = null;
    if (cycle) {
      if (!opts.baselineCaptured) {
        training_progress = { status: 'BASELINE_UNRESOLVED', baseline: null, current: null, delta: null, trend: 'UNRESOLVED', evidence_count: 0, source: 'TRAINING' };
        match_transfer = { status: 'BASELINE_UNRESOLVED', numeric_progress: null, validated: false };
        if (flags.indexOf('BASELINE_UNRESOLVED') === -1) flags.push('BASELINE_UNRESOLVED');
      } else {
        var t = isPlainObject(opts.training_snapshot) ? opts.training_snapshot : null;
        if (t) {
          var tResolved = t.baseline_value != null && t.trend !== 'INSUFFICIENT_DATA';
          training_progress = {
            status: tResolved ? 'RESOLVED' : (t.baseline_value == null ? 'BASELINE_UNRESOLVED' : 'INSUFFICIENT_DATA'),
            baseline: t.baseline_value != null ? t.baseline_value : null,
            current: t.current_value != null ? t.current_value : null,
            delta: t.absolute_delta != null ? t.absolute_delta : null,
            trend: t.trend != null ? t.trend : 'UNRESOLVED',
            evidence_count: t.evidence_count != null ? t.evidence_count : 0,
            source: 'TRAINING'
          };
          if (training_progress.status !== 'RESOLVED' && flags.indexOf('PROGRESS_NOT_YET_AVAILABLE') === -1) flags.push('PROGRESS_NOT_YET_AVAILABLE');
        } else {
          training_progress = { status: 'UNAVAILABLE', baseline: null, current: null, delta: null, trend: 'UNRESOLVED', evidence_count: 0, source: 'TRAINING' };
        }

        // §15/§16: MATCH stays a fully independent field — never derived from TRAINING's own
        // trend/delta, never a fabricated number when no MATCH evidence exists.
        var m = isPlainObject(opts.match_snapshot) ? opts.match_snapshot : null;
        var mResolved = !!m && RESOLVED_TRENDS.indexOf(m.trend) !== -1;
        match_transfer = {
          status: m ? (mResolved ? 'RESOLVED' : 'INSUFFICIENT_DATA') : 'INSUFFICIENT_DATA',
          numeric_progress: mResolved ? m.current_value : null,
          validated: mResolved
        };
        if (!mResolved && flags.indexOf('MATCH_TRANSFER_NOT_VALIDATED') === -1) flags.push('MATCH_TRANSFER_NOT_VALIDATED');
      }
    }

    // §19/§28: the sole authoritative stale/reassessment signal — never recomputed, never
    // displayed as "ready" unless this authority actually says so.
    var reassessmentRequired = journey.stage === 'READY_TO_REASSESS' || (cycle && cycle.state === 'REASSESSMENT_READY');
    var reassessmentRecord = isPlainObject(opts.reassessmentRecord) ? opts.reassessmentRecord : null;

    var next_action = {
      code: journey.next_action.code,
      enabled: journey.next_action.enabled === true,
      target_ref: journey.next_action.target_ref != null ? journey.next_action.target_ref : null
    };

    return {
      progress_reassessment: {
        player_id: opts.player_id,

        cycle: cycleOut,
        training_progress: training_progress,
        match_transfer: match_transfer,

        reassessment: {
          required: !!reassessmentRequired,
          state: reassessmentRecord && reassessmentRecord.status != null ? reassessmentRecord.status : null
        },

        journey: { stage: journey.stage, status: journey.status },
        next_action: next_action,

        flags: flags,

        schema_version: SCHEMA_VERSION,
        view_version: CONTRACT_VERSION
      }
    };
  }

  // ================================================================
  // IO orchestration (browser-only; reads persisted S10 records +
  // the already-accepted S10-E-R1 read+project composition only).
  // ================================================================

  function storeEngine() {
    if (typeof PBStore === 'undefined') throw AdapterError('DEP_MISSING', 'PBStore not loaded');
    return PBStore;
  }
  function baselineEngine() {
    if (typeof PBCycleBaseline === 'undefined') throw AdapterError('DEP_MISSING', 'PBCycleBaseline not loaded');
    return PBCycleBaseline;
  }
  function progressPersistenceEngine() {
    if (typeof PBProgressReassessmentPersistence === 'undefined') throw AdapterError('DEP_MISSING', 'PBProgressReassessmentPersistence not loaded');
    return PBProgressReassessmentPersistence;
  }
  function journeyEngine() {
    if (typeof PBProductJourney === 'undefined') throw AdapterError('DEP_MISSING', 'PBProductJourney not loaded');
    return PBProductJourney;
  }

  function ioEnginesReady() {
    return typeof PBStore !== 'undefined' && typeof PBCycleBaseline !== 'undefined' &&
      typeof PBProgressReassessmentPersistence !== 'undefined' && typeof PBProductJourney !== 'undefined';
  }

  // Same "most recently updated wins" tie-break every other S11 adapter/controller uses.
  function pickCurrentCycle(cycles) {
    if (!cycles || !cycles.length) return null;
    var sorted = cycles.slice().sort(function (a, b) {
      var au = a.updated_at || a.created_at || '', bu = b.updated_at || b.created_at || '';
      return au < bu ? 1 : (au > bu ? -1 : 0);
    });
    return sorted[0];
  }

  // Prefers the workflow whose prescription_ref is the cycle's own current prescription_refs
  // entry (a real FK link, same "current" definition js/product-journey-orchestrator.js's own
  // findCurrentWorkflow uses), falling back to the most-recently-updated workflow for the player.
  function pickWorkflowForCycle(workflows, cycle) {
    workflows = workflows || [];
    if (!workflows.length) return null;
    if (cycle && Array.isArray(cycle.prescription_refs) && cycle.prescription_refs.length) {
      var targetRef = cycle.prescription_refs[cycle.prescription_refs.length - 1];
      var matches = workflows.filter(function (w) { return w.prescription_ref === targetRef; });
      if (matches.length) {
        var live = matches.filter(function (w) { return w.state !== 'SUPERSEDED'; });
        return live.length ? live[live.length - 1] : matches[matches.length - 1];
      }
    }
    var sorted = workflows.slice().sort(function (a, b) {
      var au = a.updated_at || a.created_at || '', bu = b.updated_at || b.created_at || '';
      return au < bu ? 1 : (au > bu ? -1 : 0);
    });
    return sorted[0];
  }

  // §29: only the latest reassessment summary for this cycle — never a full history browser.
  function pickLatestReassessment(list, cycle) {
    var candidates = (list || []).filter(function (r) { return !cycle || r.cycle_id === cycle.cycle_id; });
    if (!candidates.length) return null;
    var sorted = candidates.slice().sort(function (a, b) {
      var ac = a.created_at || '', bc = b.created_at || '';
      return ac < bc ? 1 : (ac > bc ? -1 : 0);
    });
    return sorted[0];
  }

  function loadProgressContext(cycle, kpi_profile_code, player_id) {
    var store = storeEngine();
    var baseline_id = baselineEngine().baselineId(cycle.cycle_id);
    return store.getCycleKpiBaseline(baseline_id).then(function (baseline) {
      if (!baseline) return { baselineCaptured: false, training_snapshot: null, match_snapshot: null };
      var pp = progressPersistenceEngine();
      return Promise.all([
        pp.getCurrentProgressDurable({ cycle_id: cycle.cycle_id, player_id: player_id, kpi_profile_code: kpi_profile_code, source: 'TRAINING' }),
        pp.getCurrentProgressDurable({ cycle_id: cycle.cycle_id, player_id: player_id, kpi_profile_code: kpi_profile_code, source: 'MATCH', match_evidence: [] })
      ]).then(function (snaps) {
        return { baselineCaptured: true, training_snapshot: snaps[0], match_snapshot: snaps[1] };
      });
    }).catch(function () {
      // A read-pipeline failure must never blank the whole page — degrade to the same honest
      // "baseline not available" state as a genuinely missing baseline.
      return { baselineCaptured: false, training_snapshot: null, match_snapshot: null };
    });
  }

  function loadProgressReassessment(player_id) {
    if (!ioEnginesReady()) return Promise.reject(AdapterError('DEP_MISSING', 'required modules not loaded'));
    if (player_id == null) return Promise.reject(AdapterError('INVALID_INPUT', 'player_id is required'));
    var store = storeEngine();

    return store.listDevelopmentCyclesByPlayer(player_id).then(function (cycles) {
      var cycle = pickCurrentCycle(cycles || []);
      return Promise.all([
        store.listPrescriptionWorkflowsByPlayer(player_id),
        store.listSessionResultsByPlayer(player_id),
        store.listReassessmentsByPlayer(player_id)
      ]).then(function (r) {
        var workflows = r[0] || [], sessionResults = r[1] || [], reassessments = r[2] || [];
        var workflow = pickWorkflowForCycle(workflows, cycle);
        var reassessmentRecord = pickLatestReassessment(reassessments, cycle);
        var kpi = workflow && workflow.prescription_snapshot ? workflow.prescription_snapshot.kpi_profile_code : null;

        var progressPromise = (cycle && kpi != null)
          ? loadProgressContext(cycle, kpi, player_id)
          : Promise.resolve({ baselineCaptured: false, training_snapshot: null, match_snapshot: null });

        return progressPromise.then(function (progressCtx) {
          var progressArray = [];
          if (progressCtx.training_snapshot) progressArray.push(progressCtx.training_snapshot);
          if (progressCtx.match_snapshot) progressArray.push(progressCtx.match_snapshot);

          var journeyOpts = {
            player: { player_id: player_id },
            recommendations: [], prescriptions: [],
            prescription_workflows: workflows,
            session_results: sessionResults,
            progress: progressArray,
            reassessment: reassessments
          };
          if (cycle) journeyOpts.development_cycle = cycle;

          var journeyResult;
          try {
            journeyResult = journeyEngine().projectJourney(journeyOpts);
          } catch (e) {
            journeyResult = journeyEngine().projectJourney({ player: { player_id: player_id } });
          }

          return composeProgressReassessment({
            player_id: player_id, cycle: cycle, workflow: workflow,
            baselineCaptured: progressCtx.baselineCaptured,
            training_snapshot: progressCtx.training_snapshot, match_snapshot: progressCtx.match_snapshot,
            reassessmentRecord: reassessmentRecord,
            journey: journeyResult.journey
          });
        });
      });
    });
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,

    // pure (Node-testable, no DOM/PBStore)
    composeProgressReassessment: composeProgressReassessment,
    pickCurrentCycle: pickCurrentCycle,
    pickWorkflowForCycle: pickWorkflowForCycle,
    pickLatestReassessment: pickLatestReassessment,

    // IO orchestration (browser-only)
    loadProgressReassessment: loadProgressReassessment
  };
});
