/* ============================================================
 * guided-training-action-controller.js — Pickleball App 2.0 Alpha · S11-C
 * Guided Training Action Flow — ACTION ORCHESTRATION LAYER.
 *
 * Takes a legitimate S11-B `next_action` (ACTIVATE_PRESCRIPTION /
 * START_TRAINING / CONTINUE_TRAINING / RESUME_SESSION) through the
 * already-accepted S10-C / S10-D execution chain:
 *
 *   Prescription Workflow -> Session Intent -> Session Execution ->
 *   Session Result -> TRAINING Evidence -> S10-A ADD_EVIDENCE ->
 *   refreshed S11-A Journey
 *
 * This file orchestrates mutation; it does not own any mutation rule.
 * Every domain decision (activation eligibility, transition validity,
 * numeric validation, the Evidence Eligibility Gate, evidence identity,
 * ADD_EVIDENCE / resulting cycle state, journey stage/next-action) is
 * delegated verbatim to PBPrescriptionWorkflow (S10-C) /
 * PBSessionEvidence (S10-D) / PBSessionEvidencePersistence (S10-D-R1) /
 * PBProductJourney (S11-A) — this file never assigns
 * `workflow.state`/`execution.state`/`cycle.state` directly, never
 * creates TRAINING Evidence itself, never reruns the S9 decision
 * pipeline (PBDiagnosis/PBRecommendationPriority/PBTrainingPrescription
 * are never referenced), and never routes through the old S8
 * TrainingCycle/WeeklyPlan/SessionPlan/session-execution-engine.js
 * lineage (a different FK lineage than S9/S10's Prescription Workflow —
 * see docs/S10-C-PRESCRIPTION-WORKFLOW.md's own bridge-decision
 * evidence, carried forward unchanged here).
 *
 * Frozen boundary (do not cross):
 *   - Before every mutating Activate/Start action, the Development
 *     Cycle is re-read from persistence (never trusted from stale
 *     in-memory/UI state); `development_cycle.state ===
 *     'REASSESSMENT_READY'` is the sole authoritative stale signal at
 *     mutation time, passed to PBPrescriptionWorkflow as
 *     `{ stale: <boolean> }` — this file never regenerates a
 *     Prescription when stale, it only blocks the mutation and lets
 *     S10-C's own STALE_RECOMMENDATION rejection surface.
 *   - Exactly one in-memory active Session Execution is held at a time
 *     (never persisted — no new IndexedDB store, no localStorage/
 *     sessionStorage workaround). A page reload loses it; this is
 *     documented as a non-blocking limitation, never silently
 *     "recovered" from workflow.session_refs/session_result/session
 *     intent id (that would be fabricating a resume).
 *   - Session completion delegates entirely to
 *     PBSessionEvidencePersistence.completeSessionDurable — this file
 *     never independently calculates result_value, creates/persists
 *     Evidence, calls ADD_EVIDENCE, or changes Development Cycle state.
 *   - No S10-C-owned result-driven completion transition
 *     (`workflow.state = COMPLETED/EVALUATED`) is ever performed here —
 *     S10-C intentionally does not own that transition; a workflow
 *     legitimately stays IN_PROGRESS after a session completes.
 *
 * See docs/S11-C-GUIDED-TRAINING-ACTION-FLOW.md for the full field
 * reference and the reload-limitation writeup.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBGuidedTrainingController = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function ControllerError(code, message) {
    var err = new Error(message || code);
    err.name = 'GuidedTrainingControllerError';
    err.code = code;
    return err;
  }

  var CONTRACT_VERSION = 'S11-C-V1';

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

  function storeEngine() {
    if (typeof PBStore === 'undefined') throw ControllerError('DEP_MISSING', 'PBStore not loaded');
    return PBStore;
  }
  function pwfEngine() {
    if (typeof PBPrescriptionWorkflow === 'undefined') throw ControllerError('DEP_MISSING', 'PBPrescriptionWorkflow not loaded');
    return PBPrescriptionWorkflow;
  }
  function seEngine() {
    if (typeof PBSessionEvidence === 'undefined') throw ControllerError('DEP_MISSING', 'PBSessionEvidence not loaded');
    return PBSessionEvidence;
  }
  function persistenceEngine() {
    if (typeof PBSessionEvidencePersistence === 'undefined') throw ControllerError('DEP_MISSING', 'PBSessionEvidencePersistence not loaded');
    return PBSessionEvidencePersistence;
  }
  function journeyEngine() {
    if (typeof PBProductJourney === 'undefined') throw ControllerError('DEP_MISSING', 'PBProductJourney not loaded');
    return PBProductJourney;
  }

  // Preserves an existing domain error code (from S10-C/S10-D/S10-D-R1) verbatim (§27 "preserve
  // raw codes"); only wraps a genuinely unexpected/non-domain failure.
  function readStep(promise, label) {
    return promise.catch(function (e) {
      if (e instanceof Error && e.code) throw e;
      throw ControllerError('PERSISTENCE_READ_FAILED', label + ' failed: ' + (e && e.message));
    });
  }

  // ================================================================
  // Exactly one in-memory active Session Execution (§12) — never persisted.
  // ================================================================
  var ACTIVE_SESSION = null; // null | { workflow_id, session_execution }

  function getActiveSession() { return ACTIVE_SESSION; }
  function clearActiveSession() { ACTIVE_SESSION = null; }

  // ================================================================
  // Shared read helpers.
  // ================================================================

  // §9: the sole authoritative stale signal at mutation time.
  function isCycleStale(cycle) { return !!cycle && cycle.state === 'REASSESSMENT_READY'; }

  // Same "most recently updated wins" tie-break used elsewhere in the S11 layer (e.g.
  // js/home-dashboard-adapter.js's own pickCurrentCycle) — a generic, non-decision read-side
  // selection, kept as its own local copy per this repo's zero-cross-dependency convention among
  // peer S11 files.
  function pickCurrentCycle(cycles) {
    if (!cycles || !cycles.length) return null;
    var sorted = cycles.slice().sort(function (a, b) {
      var au = a.updated_at || a.created_at || '', bu = b.updated_at || b.created_at || '';
      return au < bu ? 1 : (au > bu ? -1 : 0);
    });
    return sorted[0];
  }

  function loadWorkflowAndCycle(workflow_id) {
    var store = storeEngine();
    return readStep(store.getPrescriptionWorkflow(workflow_id), 'getPrescriptionWorkflow').then(function (workflow) {
      if (!workflow) throw ControllerError('PRESCRIPTION_WORKFLOW_NOT_FOUND', 'no persisted prescription workflow for ' + workflow_id);
      return readStep(store.listDevelopmentCyclesByPlayer(workflow.player_id), 'listDevelopmentCyclesByPlayer').then(function (cycles) {
        return { workflow: workflow, cycle: pickCurrentCycle(cycles || []) };
      });
    });
  }

  // ================================================================
  // §8/§9 ACTIVATE_PRESCRIPTION — re-reads the persisted workflow +
  // cycle, derives `stale` from the authoritative persisted cycle only,
  // and delegates the entire activation-eligibility decision to S10-C.
  // ================================================================

  function activatePrescription(opts) {
    opts = opts || {};
    if (!opts.workflow_id) return Promise.reject(ControllerError('INVALID_INPUT', 'workflow_id is required'));

    return loadWorkflowAndCycle(opts.workflow_id).then(function (ctx) {
      var stale = isCycleStale(ctx.cycle);
      // Throws naturally (STALE_RECOMMENDATION, or one of S10-C's own MISSING_*/
      // INVALID_PRESCRIPTION_STATUS activation-gate codes) — never duplicated here.
      var updated = pwfEngine().transition(ctx.workflow, 'ACTIVATE', { stale: stale });
      return persistenceEngine().persistPrescriptionWorkflow(updated).then(function () {
        return { workflow: updated };
      });
    });
  }

  // ================================================================
  // §10/§13 START_TRAINING — re-reads persisted workflow + cycle,
  // double-start protection via the persisted workflow.state (never a
  // second session_intent), delegates the transition+session_intent
  // build to S10-C, then creates+starts the Session Execution via S10-D
  // (never Evidence/Result — those belong to completeSession()).
  // ================================================================

  function startTraining(opts) {
    opts = opts || {};
    if (!opts.workflow_id) return Promise.reject(ControllerError('INVALID_INPUT', 'workflow_id is required'));

    return loadWorkflowAndCycle(opts.workflow_id).then(function (ctx) {
      // §13: double-start protection — a workflow already IN_PROGRESS never gets a second
      // session_intent; this is a presentation/controller-level state, not an S10 domain code.
      if (ctx.workflow.state === 'IN_PROGRESS') {
        throw ControllerError('ALREADY_IN_PROGRESS', 'prescription workflow ' + opts.workflow_id + ' is already IN_PROGRESS');
      }
      var stale = isCycleStale(ctx.cycle);
      // Throws naturally (STALE_RECOMMENDATION, or INVALID_INPUT if not ACTIVE) — never
      // duplicated here.
      var result = pwfEngine().startTraining(ctx.workflow, { stale: stale });
      return persistenceEngine().persistPrescriptionWorkflow(result.workflow).then(function () {
        var execution = seEngine().createSessionExecution({
          session_intent: result.session_intent,
          recommendation_ref: opts.recommendation_ref != null ? opts.recommendation_ref : ctx.workflow.recommendation_ref
        }).session_execution;
        var started = seEngine().transition(execution, 'START', {});
        ACTIVE_SESSION = { workflow_id: opts.workflow_id, session_execution: started };
        return { workflow: result.workflow, session_execution: started };
      });
    });
  }

  // ================================================================
  // §14/§15/§28 CONTINUE_TRAINING / RESUME_SESSION support — never
  // reconstructs an active execution from session_refs/session_result/
  // session_intent id. If the persisted workflow says IN_PROGRESS but
  // no matching in-memory execution survives, that is reported as the
  // honest ACTIVE_SESSION_LOST presentation state, never a fabricated
  // resume.
  // ================================================================

  // Returned `state` uses its own presentation vocabulary — 'SESSION_ACTIVE' (a live in-memory
  // execution) and 'ACTIVE_SESSION_LOST' are controller/presentation states, deliberately
  // distinct from the raw `workflow.state` value (which is passed through verbatim otherwise,
  // e.g. 'DRAFTED'/'ACTIVE'/'DEFERRED'/...) so a workflow legitimately in S10-C's own 'ACTIVE'
  // state (activated, not yet started) is never confused with "has a live session".
  function resolveSessionState(opts) {
    opts = opts || {};
    if (!opts.workflow_id) return Promise.reject(ControllerError('INVALID_INPUT', 'workflow_id is required'));
    return readStep(storeEngine().getPrescriptionWorkflow(opts.workflow_id), 'getPrescriptionWorkflow').then(function (workflow) {
      if (!workflow) throw ControllerError('PRESCRIPTION_WORKFLOW_NOT_FOUND', 'no persisted prescription workflow for ' + opts.workflow_id);
      if (ACTIVE_SESSION && ACTIVE_SESSION.workflow_id === opts.workflow_id && ACTIVE_SESSION.session_execution.state === 'ACTIVE') {
        return { state: 'SESSION_ACTIVE', workflow: workflow, session_execution: ACTIVE_SESSION.session_execution };
      }
      if (workflow.state === 'IN_PROGRESS') {
        return { state: 'ACTIVE_SESSION_LOST', workflow: workflow, session_execution: null };
      }
      return { state: workflow.state, workflow: workflow, session_execution: null };
    });
  }

  // Resolves the current development_cycle_id for a player — used by the UI right before
  // Complete & Save, so it never has to be threaded through HOME's routing context. Read-only,
  // same tie-break as everywhere else in this file; never decides anything.
  function resolveCurrentCycle(opts) {
    opts = opts || {};
    if (!opts.player_id) return Promise.reject(ControllerError('INVALID_INPUT', 'player_id is required'));
    return readStep(storeEngine().listDevelopmentCyclesByPlayer(opts.player_id), 'listDevelopmentCyclesByPlayer').then(function (cycles) {
      return pickCurrentCycle(cycles || []);
    });
  }

  // ================================================================
  // §20-§27 COMPLETE TRAINING — delegates entirely to
  // PBSessionEvidencePersistence.completeSessionDurable; no independent
  // result_value/Evidence/ADD_EVIDENCE/cycle-state logic here. Clears
  // the in-memory active session only on success (§24 step 1) — a
  // rejected attempt (e.g. INVALID_ATTEMPTS, DUPLICATE_FINALIZATION)
  // leaves it intact so the caller can retry/correct.
  // ================================================================

  function completeSession(opts) {
    opts = opts || {};
    if (!ACTIVE_SESSION || !ACTIVE_SESSION.session_execution) {
      return Promise.reject(ControllerError('ACTIVE_SESSION_LOST', 'no active in-memory session to complete'));
    }
    if (!opts.development_cycle_id) return Promise.reject(ControllerError('MISSING_DEVELOPMENT_CYCLE', 'development_cycle_id is required'));

    var execution = ACTIVE_SESSION.session_execution;
    return persistenceEngine().completeSessionDurable({
      session_execution: execution,
      attempts: opts.attempts,
      successful_attempts: opts.successful_attempts,
      development_cycle_id: opts.development_cycle_id,
      completed_at: opts.completed_at
    }).then(function (result) {
      ACTIVE_SESSION = null;
      return result; // { session_result, evidence, development_cycle }
    });
  }

  // ================================================================
  // §24 Post-completion Journey refresh — reads only persisted S10
  // records and delegates the entire stage/next-action decision to
  // PBProductJourney (S11-A); never decided locally. Recommendations/
  // prescriptions stay [] (no durable S9 output store exists yet — same
  // honest limitation js/home-dashboard-adapter.js already documents),
  // which PBProductJourney itself already handles gracefully.
  // ================================================================

  function refreshJourney(opts) {
    opts = opts || {};
    if (!opts.player_id) return Promise.reject(ControllerError('INVALID_INPUT', 'player_id is required'));
    var store = storeEngine();

    var cyclePromise = opts.development_cycle_id
      ? readStep(store.getDevelopmentCycle(opts.development_cycle_id), 'getDevelopmentCycle')
      : readStep(store.listDevelopmentCyclesByPlayer(opts.player_id), 'listDevelopmentCyclesByPlayer').then(function (cycles) { return pickCurrentCycle(cycles || []); });

    return Promise.all([
      cyclePromise,
      readStep(store.listPrescriptionWorkflowsByPlayer(opts.player_id), 'listPrescriptionWorkflowsByPlayer'),
      readStep(store.listSessionResultsByPlayer(opts.player_id), 'listSessionResultsByPlayer'),
      readStep(store.listReassessmentsByPlayer(opts.player_id), 'listReassessmentsByPlayer')
    ]).then(function (r) {
      var cycle = r[0], prescriptionWorkflows = r[1] || [], sessionResults = r[2] || [], reassessments = r[3] || [];
      var journeyOpts = {
        player: { player_id: opts.player_id },
        recommendations: [], prescriptions: [],
        prescription_workflows: prescriptionWorkflows,
        session_results: sessionResults,
        progress: [],
        reassessment: reassessments
      };
      if (cycle) journeyOpts.development_cycle = cycle;
      return journeyEngine().projectJourney(journeyOpts);
    });
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,

    activatePrescription: activatePrescription,
    startTraining: startTraining,
    resolveSessionState: resolveSessionState,
    resolveCurrentCycle: resolveCurrentCycle,
    completeSession: completeSession,
    refreshJourney: refreshJourney,

    getActiveSession: getActiveSession,
    clearActiveSession: clearActiveSession,

    // exposed for test setup only (never used to fabricate a resume in production code paths)
    pickCurrentCycle: pickCurrentCycle,
    isCycleStale: isCycleStale
  };
});
