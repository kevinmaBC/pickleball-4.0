/* ============================================================
 * history-explainability-adapter.js — Pickleball App 2.0 Alpha · S11-E
 * History / Explainability / Recovery — DERIVED VIEW ADAPTER.
 *
 * Reconstructs a presentation-only cycle history, timeline,
 * explainability, evidence lineage, recovery status, and integrity
 * flags entirely from already-durable S9/S10 records. It never
 * reruns S9, never recalculates S10-E Progress/Reassessment, never
 * mutates any S10 domain state, never creates Evidence, and never
 * writes anything — every PBStore call here is a read. History is
 * reconstructed from durable records; it is not recreated by rerunning
 * business logic.
 *
 * Frozen boundary (do not cross):
 *   - Zero runtime dependency on PBDiagnosis/PBRecommendationPriority/
 *     PBTrainingPrescription (no S9 rerun) and on any S10/S11-C
 *     mutation entry point (PBWorkflow.transition,
 *     PBPrescriptionWorkflow.transition/startTraining,
 *     PBSessionEvidence.transition,
 *     PBSessionEvidencePersistence.completeSessionDurable,
 *     PBProgressReassessmentPersistence.runReassessmentDurable/
 *     captureBaselineDurable/supersedePrescriptionWorkflowDurable/
 *     completeCycleDurable) — this file is read-side only.
 *   - A timeline event is only ever created when persisted records
 *     actually prove it happened (§13) — never guessed. Timestamps
 *     come only from real persisted fields (created_at/updated_at/
 *     activated_at/started_at/completed_at/captured_at/timestamp) —
 *     never Date.now()/new Date(). A genuinely unavailable timestamp
 *     stays `occurred_at: null, time_status: 'UNKNOWN_TIME'`, never a
 *     fabricated current time.
 *   - The only progress-producing call is the already-accepted S10-E-R1
 *     read+project composition
 *     (PBProgressReassessmentPersistence.getCurrentProgressDurable) —
 *     never PBProgressTracking.computeProgressSnapshot directly, never
 *     a duplicated formula.
 *   - Integrity checks are read-only: CHECK -> FLAG, never CHECK ->
 *     MODIFY. No record is ever deleted, rewritten, or backfilled.
 *   - ACTIVE_SESSION_EXECUTION, FULL_S9_RECOMMENDATION_DETAIL, and
 *     MATCH_KPI_EVIDENCE are always reported unrecoverable — never
 *     reconstructed from refs/ids.
 *
 * See docs/S11-E-HISTORY-EXPLAINABILITY-RECOVERY.md for the full field
 * reference and known-limitation writeup.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBHistoryExplainabilityAdapter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function AdapterError(code, message) {
    var err = new Error(message || code);
    err.name = 'HistoryExplainabilityAdapterError';
    err.code = code;
    return err;
  }

  var CONTRACT_VERSION = 'S11-E-V1';
  var SCHEMA_VERSION = '1.0';
  var RESOLVED_TRENDS = ['IMPROVING', 'DECLINING', 'STABLE'];

  // §12/§15 frozen timeline vocabulary + fixed presentation order (tie-break for equal/missing
  // timestamps) — never object-enumeration/random order.
  var EVENT_ORDER = [
    'CYCLE_CREATED', 'BASELINE_AVAILABLE', 'PRESCRIPTION_WORKFLOW_CREATED', 'PRESCRIPTION_ACTIVATED',
    'TRAINING_STARTED', 'SESSION_COMPLETED', 'TRAINING_EVIDENCE_RECORDED', 'PROGRESS_AVAILABLE',
    'REASSESSMENT_REQUIRED', 'REASSESSMENT_COMPLETED', 'CYCLE_COMPLETED'
  ];

  // Fixed, architecture-level statements (§25/§26) — what this repo's durable stores can/cannot
  // ever reconstruct, independent of any one player's actual data.
  var RECOVERABLE_CATEGORIES = ['DEVELOPMENT_CYCLE', 'PRESCRIPTION_WORKFLOW', 'SESSION_RESULTS', 'TRAINING_EVIDENCE', 'BASELINE', 'REASSESSMENT'];
  var UNRECOVERABLE_CATEGORIES = ['ACTIVE_SESSION_EXECUTION', 'FULL_S9_RECOMMENDATION_DETAIL', 'MATCH_KPI_EVIDENCE'];

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

  function timelineEvent(type, occurred_at, ref, detail) {
    return { type: type, occurred_at: occurred_at || null, time_status: occurred_at ? 'KNOWN' : 'UNKNOWN_TIME', ref: ref != null ? ref : null, detail: detail || {} };
  }

  function compareTimelineEvents(a, b) {
    var ta = a.occurred_at ? Date.parse(a.occurred_at) : NaN;
    var tb = b.occurred_at ? Date.parse(b.occurred_at) : NaN;
    if (!isNaN(ta) && !isNaN(tb) && ta !== tb) return ta - tb;
    var oa = EVENT_ORDER.indexOf(a.type), ob = EVENT_ORDER.indexOf(b.type);
    if (oa !== ob) return oa - ob;
    var ka = String(a.ref || ''), kb = String(b.ref || '');
    return ka < kb ? -1 : (ka > kb ? 1 : 0);
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

  function findWorkflowsForCycle(workflows, cycle) {
    var refs = Array.isArray(cycle.prescription_refs) ? cycle.prescription_refs : [];
    return (workflows || []).filter(function (w) { return refs.indexOf(w.prescription_ref) !== -1; });
  }

  // Prefers the non-SUPERSEDED, most-recently-updated workflow among the ones belonging to this
  // cycle — same "current" definition js/product-journey-orchestrator.js's own findCurrentWorkflow
  // and js/progress-reassessment-adapter.js's own pickWorkflowForCycle already use.
  function pickCurrentWorkflow(workflowsForCycle) {
    if (!workflowsForCycle || !workflowsForCycle.length) return null;
    var live = workflowsForCycle.filter(function (w) { return w.state !== 'SUPERSEDED'; });
    var pool = live.length ? live : workflowsForCycle;
    var sorted = pool.slice().sort(function (a, b) {
      var au = a.updated_at || a.created_at || '', bu = b.updated_at || b.created_at || '';
      return au < bu ? 1 : (au > bu ? -1 : 0);
    });
    return sorted[0];
  }

  function findSessionResultsForWorkflows(sessionResults, workflowsForCycle) {
    var prescRefs = workflowsForCycle.map(function (w) { return w.prescription_ref; });
    return (sessionResults || []).filter(function (sr) { return prescRefs.indexOf(sr.prescription_ref) !== -1; });
  }

  function findEvidenceForCycle(trainingEvidence, cycle) {
    var refs = Array.isArray(cycle.evidence_refs) ? cycle.evidence_refs : [];
    return (trainingEvidence || []).filter(function (e) { return refs.indexOf(e.evidence_id) !== -1; });
  }

  function findReassessmentsForCycle(reassessments, cycle) {
    return (reassessments || []).filter(function (r) { return r.cycle_id === cycle.cycle_id; });
  }

  // §29 History Boundary: only the latest reassessment summary for a cycle — never a full
  // history browser (that belongs to a future stage, not S11-E).
  function pickLatestReassessment(reassessmentsForCycle) {
    if (!reassessmentsForCycle.length) return null;
    var sorted = reassessmentsForCycle.slice().sort(function (a, b) {
      var ac = a.created_at || '', bc = b.created_at || '';
      return ac < bc ? 1 : (ac > bc ? -1 : 0);
    });
    return sorted[0].status != null ? sorted[0].status : null;
  }

  // §16/§17 Prescription Workflow / Snapshot traceability — copied verbatim, nothing regenerated.
  function buildWorkflowSummary(workflow) {
    if (!workflow) return null;
    var snap = isPlainObject(workflow.prescription_snapshot) ? workflow.prescription_snapshot : {};
    return {
      workflow_id: workflow.workflow_id,
      workflow_state: workflow.state,
      recommendation_ref: snap.source_recommendation_id != null ? snap.source_recommendation_id : (workflow.recommendation_ref != null ? workflow.recommendation_ref : null),
      priority_rank: snap.priority_rank != null ? snap.priority_rank : null,
      priority_score: snap.priority_score != null ? snap.priority_score : null,
      priority_tier: snap.priority_tier != null ? snap.priority_tier : null,
      training_objective_code: snap.training_objective_code != null ? snap.training_objective_code : null,
      training_mode: snap.training_mode != null ? snap.training_mode : null,
      kpi_profile_code: snap.kpi_profile_code != null ? snap.kpi_profile_code : null,
      drill_family_code: snap.drill_family_code != null ? snap.drill_family_code : null,
      drill_resolution_status: snap.drill_resolution_status != null ? snap.drill_resolution_status : null,
      kpi_target_status: snap.kpi_target_status != null ? snap.kpi_target_status : null,
      reassessment_profile_code: snap.reassessment_profile_code != null ? snap.reassessment_profile_code : null
    };
  }

  // §19/§20 Evidence lineage — Session Result -> TRAINING Evidence -> cycle.evidence_refs, only
  // existing fields, source always preserved verbatim (never interpreted as MATCH).
  function buildEvidenceLineage(sessionResultsForCycle, evidenceForCycle) {
    return sessionResultsForCycle.map(function (sr) {
      var ev = evidenceForCycle.filter(function (e) { return e.session_ref === sr.session_id; })[0] || null;
      return {
        session_result_id: sr.session_id,
        prescription_ref: sr.prescription_ref != null ? sr.prescription_ref : null,
        recommendation_ref: sr.recommendation_ref != null ? sr.recommendation_ref : null,
        attempts: sr.attempts != null ? sr.attempts : null,
        successful_attempts: sr.successful_attempts != null ? sr.successful_attempts : null,
        result_value: sr.result_value != null ? sr.result_value : null,
        evidence_id: ev ? ev.evidence_id : null,
        kpi_profile_code: ev ? ev.kpi : (sr.kpi_profile_code != null ? sr.kpi_profile_code : null),
        source: ev ? ev.source : null
      };
    });
  }

  // §12-§15 Timeline — one event per durably-proven occurrence only; TRAINING_STARTED's timestamp
  // is only ever trusted while workflow.state === 'IN_PROGRESS' (no later transition has
  // overwritten updated_at since startTraining); once the workflow moves on (e.g. CANCELLED) the
  // original start time is genuinely lost, so time_status honestly becomes UNKNOWN_TIME rather
  // than reusing a now-stale updated_at.
  function buildTimeline(ctx) {
    var cycle = ctx.cycle, events = [];
    events.push(timelineEvent('CYCLE_CREATED', cycle.created_at, cycle.cycle_id));

    if (ctx.baseline) events.push(timelineEvent('BASELINE_AVAILABLE', ctx.baseline.captured_at, ctx.baseline.baseline_id));

    ctx.workflowsForCycle.forEach(function (w) {
      events.push(timelineEvent('PRESCRIPTION_WORKFLOW_CREATED', w.created_at, w.workflow_id));
      if (w.activated_at) events.push(timelineEvent('PRESCRIPTION_ACTIVATED', w.activated_at, w.workflow_id));
      if (Array.isArray(w.session_refs) && w.session_refs.length) {
        var trustedTime = w.state === 'IN_PROGRESS' ? w.updated_at : null;
        events.push(timelineEvent('TRAINING_STARTED', trustedTime, w.workflow_id));
      }
    });

    ctx.sessionResultsForCycle.forEach(function (sr) { events.push(timelineEvent('SESSION_COMPLETED', sr.completed_at, sr.session_id)); });
    ctx.evidenceForCycle.forEach(function (e) { events.push(timelineEvent('TRAINING_EVIDENCE_RECORDED', e.timestamp, e.evidence_id)); });

    // Same "resolved" test buildProgressSummary uses — checked directly against the raw
    // progress_snapshot's own fields, which carries no separate `status` property of its own.
    if (ctx.progress && ctx.progress.baseline_value != null && ctx.progress.trend !== 'INSUFFICIENT_DATA') {
      var matchingEvidence = ctx.evidenceForCycle.filter(function (e) { return e.evidence_id === ctx.progress.current_evidence_ref; })[0];
      events.push(timelineEvent('PROGRESS_AVAILABLE', matchingEvidence ? matchingEvidence.timestamp : null, ctx.progress.progress_id));
    }

    if (cycle.state === 'REASSESSMENT_READY') events.push(timelineEvent('REASSESSMENT_REQUIRED', cycle.updated_at, cycle.cycle_id));
    ctx.reassessmentsForCycle.forEach(function (r) {
      if (r.status) events.push(timelineEvent('REASSESSMENT_COMPLETED', r.created_at, r.reassessment_id));
    });
    if (cycle.state === 'CYCLE_COMPLETED') events.push(timelineEvent('CYCLE_COMPLETED', cycle.updated_at, cycle.cycle_id));

    return events.sort(compareTimelineEvents);
  }

  // §22/§23 Progress explainability — consumes an already-computed progress_snapshot verbatim
  // (never recalculated here); the caller supplies it (already obtained via the accepted S10-E-R1
  // read API).
  function buildProgressSummary(progress) {
    if (!isPlainObject(progress)) return { status: 'BASELINE_UNAVAILABLE', baseline: null, current: null, delta: null, trend: 'UNRESOLVED', evidence_count: 0, authority: 'S10-E' };
    var resolved = progress.baseline_value != null && progress.trend !== 'INSUFFICIENT_DATA';
    return {
      status: resolved ? 'RESOLVED' : (progress.baseline_value == null ? 'BASELINE_UNAVAILABLE' : 'INSUFFICIENT_DATA'),
      baseline: progress.baseline_value != null ? progress.baseline_value : null,
      current: progress.current_value != null ? progress.current_value : null,
      delta: progress.absolute_delta != null ? progress.absolute_delta : null,
      trend: progress.trend != null ? progress.trend : 'UNRESOLVED',
      evidence_count: progress.evidence_count != null ? progress.evidence_count : 0,
      authority: 'S10-E'
    };
  }

  // ================================================================
  // Pure composer — combines already-fetched plain records (never
  // recomputing any of them) into the History/Explainability/Recovery
  // View Model. Testable with plain-object fixtures (no DOM, no
  // PBStore).
  // ================================================================

  function composeHistoryExplainability(opts) {
    opts = opts || {};
    if (!isPlainObject(opts)) throw AdapterError('INVALID_INPUT', 'opts must be an object');
    if (opts.player_id == null) throw AdapterError('INVALID_INPUT', 'player_id is required');

    var cycles = Array.isArray(opts.cycles) ? opts.cycles : [];
    var workflows = Array.isArray(opts.workflows) ? opts.workflows : [];
    var sessionResults = Array.isArray(opts.sessionResults) ? opts.sessionResults : [];
    var trainingEvidence = Array.isArray(opts.trainingEvidence) ? opts.trainingEvidence : [];
    var reassessments = Array.isArray(opts.reassessments) ? opts.reassessments : [];
    var baselinesByCycle = isPlainObject(opts.baselinesByCycle) ? opts.baselinesByCycle : {};
    var progressByCycle = isPlainObject(opts.progressByCycle) ? opts.progressByCycle : {};
    var activeSessionLive = isPlainObject(opts.activeSessionLive) ? opts.activeSessionLive : null;

    var currentCycle = pickCurrentCycle(cycles);
    // Deterministic listing order (§E05/§15): most-recently-updated first, ties broken by cycle_id.
    var orderedCycles = cycles.slice().sort(function (a, b) {
      var au = a.updated_at || a.created_at || '', bu = b.updated_at || b.created_at || '';
      if (au !== bu) return au < bu ? 1 : -1;
      return String(a.cycle_id) < String(b.cycle_id) ? -1 : 1;
    });

    var recoveryFlags = [];
    var cycleViews = orderedCycles.map(function (cycle) {
      var workflowsForCycle = findWorkflowsForCycle(workflows, cycle);
      var currentWorkflow = pickCurrentWorkflow(workflowsForCycle);
      var sessionResultsForCycle = findSessionResultsForWorkflows(sessionResults, workflowsForCycle);
      var evidenceForCycle = findEvidenceForCycle(trainingEvidence, cycle);
      var reassessmentsForCycle = findReassessmentsForCycle(reassessments, cycle);
      var baseline = baselinesByCycle[cycle.cycle_id] || null;
      var progress = progressByCycle[cycle.cycle_id] || null;

      var progressSummary = buildProgressSummary(progress);
      if (progressSummary.status !== 'RESOLVED') recoveryFlags.push('BASELINE_UNAVAILABLE');
      if (baseline) recoveryFlags.push('MATCH_PROGRESS_UNRESOLVED'); // §21/§27: MATCH stays unresolved even once TRAINING is tracked

      var activeSessionForThisWorkflow = activeSessionLive && currentWorkflow && activeSessionLive.workflow_id === currentWorkflow.workflow_id
        && activeSessionLive.session_execution && activeSessionLive.session_execution.state === 'ACTIVE';
      if (currentWorkflow && currentWorkflow.state === 'IN_PROGRESS' && !activeSessionForThisWorkflow) recoveryFlags.push('ACTIVE_SESSION_NOT_DURABLE');

      return {
        cycle_id: cycle.cycle_id,
        state: cycle.state,
        created_at: cycle.created_at != null ? cycle.created_at : null,
        updated_at: cycle.updated_at != null ? cycle.updated_at : null,
        is_current: !!currentCycle && cycle.cycle_id === currentCycle.cycle_id,
        timeline: buildTimeline({ cycle: cycle, workflowsForCycle: workflowsForCycle, sessionResultsForCycle: sessionResultsForCycle, evidenceForCycle: evidenceForCycle, reassessmentsForCycle: reassessmentsForCycle, baseline: baseline, progress: progress }),
        workflow_summary: buildWorkflowSummary(currentWorkflow),
        evidence_lineage: buildEvidenceLineage(sessionResultsForCycle, evidenceForCycle),
        progress_summary: progressSummary,
        reassessment_summary: {
          required: cycle.state === 'REASSESSMENT_READY',
          state: pickLatestReassessment(reassessmentsForCycle)
        }
      };
    });

    // §16/§17 current_explanation is the current cycle's own current workflow snapshot.
    var currentCycleView = cycleViews.filter(function (c) { return c.is_current; })[0] || null;
    var currentExplanation = currentCycleView && currentCycleView.workflow_summary ? Object.assign({ source: 'PRESCRIPTION_WORKFLOW_SNAPSHOT' }, currentCycleView.workflow_summary) : null;
    if (currentCycleView) recoveryFlags.push('S9_DETAIL_NOT_DURABLE'); // §18: always true once a training explanation is being shown at all

    // §30/§31 Read-only integrity checks — CHECK -> FLAG only, never CHECK -> MODIFY.
    var integrityFlags = [];
    var allCyclePrescriptionRefs = [];
    cycles.forEach(function (c) { (c.prescription_refs || []).forEach(function (r) { allCyclePrescriptionRefs.push(r); }); });
    var allCycleEvidenceRefs = [];
    cycles.forEach(function (c) { (c.evidence_refs || []).forEach(function (r) { allCycleEvidenceRefs.push(r); }); });

    workflows.forEach(function (w) {
      if (allCyclePrescriptionRefs.indexOf(w.prescription_ref) === -1 && integrityFlags.indexOf('ORPHAN_WORKFLOW_REF') === -1) integrityFlags.push('ORPHAN_WORKFLOW_REF');
    });
    trainingEvidence.forEach(function (e) {
      if (allCycleEvidenceRefs.indexOf(e.evidence_id) === -1 && integrityFlags.indexOf('ORPHAN_EVIDENCE_REF') === -1) integrityFlags.push('ORPHAN_EVIDENCE_REF');
    });
    sessionResults.forEach(function (sr) {
      var hasEvidence = trainingEvidence.some(function (e) { return e.session_ref === sr.session_id; });
      if (!hasEvidence && integrityFlags.indexOf('SESSION_RESULT_WITHOUT_EVIDENCE') === -1) integrityFlags.push('SESSION_RESULT_WITHOUT_EVIDENCE');
    });

    // §27/§28 Recovery status — LIMITED when key durable context (the cycle itself) is missing;
    // PARTIAL when core durable state exists but a known non-durable detail or integrity mismatch
    // is present; FULL otherwise. Normal known limitations are never labeled as corruption.
    var uniqueRecoveryFlags = recoveryFlags.filter(function (f, i) { return recoveryFlags.indexOf(f) === i; });
    var status;
    if (!currentCycle) status = 'LIMITED';
    else if (uniqueRecoveryFlags.length || integrityFlags.length) status = 'PARTIAL';
    else status = 'FULL';

    return {
      history_explainability: {
        player_id: opts.player_id,
        cycles: cycleViews,
        current_explanation: currentExplanation,
        recovery: {
          status: status,
          recoverable: RECOVERABLE_CATEGORIES.slice(),
          unrecoverable: UNRECOVERABLE_CATEGORIES.slice(),
          flags: uniqueRecoveryFlags
        },
        integrity_flags: integrityFlags,
        schema_version: SCHEMA_VERSION,
        view_version: CONTRACT_VERSION
      }
    };
  }

  // ================================================================
  // IO orchestration (browser-only; reads persisted S10 records +
  // the already-accepted S10-E-R1 read+project composition, plus a
  // read-only check of the S11-C controller's in-memory active
  // session — never S9, never a mutation entry point).
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

  function ioEnginesReady() {
    return typeof PBStore !== 'undefined' && typeof PBCycleBaseline !== 'undefined' && typeof PBProgressReassessmentPersistence !== 'undefined';
  }

  function loadHistoryExplainability(player_id) {
    if (!ioEnginesReady()) return Promise.reject(AdapterError('DEP_MISSING', 'required modules not loaded'));
    if (player_id == null) return Promise.reject(AdapterError('INVALID_INPUT', 'player_id is required'));
    var store = storeEngine();

    return Promise.all([
      store.listDevelopmentCyclesByPlayer(player_id),
      store.listPrescriptionWorkflowsByPlayer(player_id),
      store.listSessionResultsByPlayer(player_id),
      store.listTrainingEvidenceByPlayer(player_id),
      store.listReassessmentsByPlayer(player_id)
    ]).then(function (r) {
      var cycles = r[0] || [], workflows = r[1] || [], sessionResults = r[2] || [], trainingEvidence = r[3] || [], reassessments = r[4] || [];

      return Promise.all(cycles.map(function (cycle) {
        var baseline_id = baselineEngine().baselineId(cycle.cycle_id);
        return store.getCycleKpiBaseline(baseline_id).then(function (baseline) {
          if (!baseline) return { cycle_id: cycle.cycle_id, baseline: null, progress: null };
          var workflowsForCycle = findWorkflowsForCycle(workflows, cycle);
          var currentWorkflow = pickCurrentWorkflow(workflowsForCycle);
          var kpi = currentWorkflow && currentWorkflow.prescription_snapshot ? currentWorkflow.prescription_snapshot.kpi_profile_code : null;
          if (kpi == null) return { cycle_id: cycle.cycle_id, baseline: baseline, progress: null };
          return progressPersistenceEngine().getCurrentProgressDurable({ cycle_id: cycle.cycle_id, player_id: player_id, kpi_profile_code: kpi, source: 'TRAINING' })
            .then(function (progress) { return { cycle_id: cycle.cycle_id, baseline: baseline, progress: progress }; })
            .catch(function () { return { cycle_id: cycle.cycle_id, baseline: baseline, progress: null }; });
        }).catch(function () { return { cycle_id: cycle.cycle_id, baseline: null, progress: null }; });
      })).then(function (perCycle) {
        var baselinesByCycle = {}, progressByCycle = {};
        perCycle.forEach(function (r2) { baselinesByCycle[r2.cycle_id] = r2.baseline; progressByCycle[r2.cycle_id] = r2.progress; });

        // Read-only: the live in-memory active session, if the S11-C controller happens to be
        // loaded on this page — never reconstructed, never required.
        var activeSessionLive = (typeof PBGuidedTrainingController !== 'undefined' && typeof PBGuidedTrainingController.getActiveSession === 'function')
          ? PBGuidedTrainingController.getActiveSession() : null;

        return composeHistoryExplainability({
          player_id: player_id, cycles: cycles, workflows: workflows, sessionResults: sessionResults,
          trainingEvidence: trainingEvidence, reassessments: reassessments,
          baselinesByCycle: baselinesByCycle, progressByCycle: progressByCycle, activeSessionLive: activeSessionLive
        });
      });
    });
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    EVENT_ORDER: EVENT_ORDER.slice(),

    // pure (Node-testable, no DOM/PBStore)
    composeHistoryExplainability: composeHistoryExplainability,
    pickCurrentCycle: pickCurrentCycle,
    pickCurrentWorkflow: pickCurrentWorkflow,
    compareTimelineEvents: compareTimelineEvents,

    // IO orchestration (browser-only)
    loadHistoryExplainability: loadHistoryExplainability
  };
});
