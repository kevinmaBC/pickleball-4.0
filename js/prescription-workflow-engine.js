/* ============================================================
 * prescription-workflow-engine.js — Pickleball App 2.0 Alpha · S10-C
 * Training Prescription Workflow Integration — PRESCRIPTION WORKFLOW
 * LIFECYCLE SOURCE OF TRUTH.
 *
 * Wraps an S9-F Training Prescription (js/training-prescription-engine.js
 * output) in a lifecycle: DRAFTED -> ACTIVE -> IN_PROGRESS (+ DEFERRED /
 * UNRESOLVED / CANCELLED / SUPERSEDED). Answers "what prescription is
 * active, can it be activated, can training start, which existing
 * training structure should receive it" — never "what should the
 * recommendation/priority/prescription be" (that stays S9-F's job) and
 * never "what happened in the session" (that is explicitly S10-D).
 *
 * This file has ZERO runtime dependency on js/match-observation-engine.js,
 * js/performance-analysis-engine.js, js/diagnosis-engine.js,
 * js/recommendation-priority-engine.js, js/training-prescription-engine.js,
 * js/workflow-integration-engine.js, js/dashboard-integration-engine.js,
 * js/training-plan-engine.js, js/session-execution-engine.js,
 * js/training-readiness-engine.js or js/storage.js — it never
 * requires/reads any of their globals. It only accepts an
 * already-computed S9-F Prescription object (or plain reference values)
 * from the caller and wraps it; the same zero-coupling guarantee
 * js/workflow-integration-engine.js (S10-A) and
 * js/dashboard-integration-engine.js (S10-B) use to structurally prove
 * they never recalculate an upstream decision — see
 * docs/S10-C-PRESCRIPTION-WORKFLOW.md.
 *
 * S8/S9 bridge decision (§6 of the frozen package, evidence in the doc):
 * existing S8 TrainingCycle/WeeklyPlan/SessionPlan
 * (js/training-plan-engine.js, js/storage.js) are NOT reused directly.
 * That chain is FK-rooted in S7-A review_snapshots/prescriptions records
 * (an entirely different CAP/bottleneck lineage than S9-F's per-match
 * recommendation pipeline) and js/training-plan-engine.js's own
 * buildWeeklyPlanFrom... throws INCOMPLETE_MAPPING when no drill
 * resolves — the opposite of S9-F/S10-C's frozen "UNRESOLVED is valid,
 * never fabricate a drill" rule. Forcing S9-F prescriptions through that
 * chain would corrupt semantics on both sides, so this file is a MINIMAL
 * BRIDGE: a transient, unpersisted session_intent reference (§15) that
 * borrows S8 SessionPlan's field vocabulary for familiarity without
 * touching its FK-validated storage.
 *
 * Frozen boundary (do not cross):
 *   - Pure, deterministic functions only. No LLM, no ML, no randomness
 *     in any decision field.
 *   - Every field listed in §7 of the frozen package is copied verbatim
 *     from the input Prescription into prescription_snapshot and never
 *     recomputed, mutated, or reinterpreted afterward.
 *   - prescription_snapshot.status stays exactly what S9-F set — it is
 *     never read as, or confused with, workflow.state (§18).
 *   - drill_resolution_status === 'UNRESOLVED' and kpi_target_status ===
 *     'BENCHMARK_NOT_RESOLVED' never block activation and are never
 *     replaced with a fabricated drill id or numeric target (§11/§12).
 *   - dosage_profile_code is read, never converted into reps/minutes/
 *     sessions-per-week/a calendar (§13).
 *   - No attempts/successful_attempts/result_value/completion outcome/
 *     TRAINING evidence is ever produced here — session_intent is
 *     PLANNED intent only, never a result (§14/§21).
 *   - A `stale: true` signal blocks both ACTIVATE and startTraining
 *     with STALE_RECOMMENDATION — S10-C never decides staleness itself,
 *     it only honors whatever the caller (e.g. S10-A's workflow state)
 *     already determined (§16).
 *   - SUPERSEDE never deletes the prior workflow/session references —
 *     it only flips state and records superseded_by (§17).
 *
 * See docs/S10-C-PRESCRIPTION-WORKFLOW.md for the full field reference
 * and the S8/S9 bridge-decision evidence.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBPrescriptionWorkflow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function WorkflowError(code, message) {
    var err = new Error(message || code);
    err.name = 'PrescriptionWorkflowError';
    err.code = code;
    return err;
  }

  var CONTRACT_VERSION = 'S10-C-V1';
  var SCHEMA_VERSION = '1.0';

  // §9 frozen state model.
  var MAIN_STATES = ['DRAFTED', 'ACTIVE', 'IN_PROGRESS', 'COMPLETED', 'EVALUATED'];
  var AUX_STATES = ['DEFERRED', 'UNRESOLVED', 'CANCELLED', 'SUPERSEDED'];
  var ALL_STATES = MAIN_STATES.concat(AUX_STATES);

  // COMPLETED/EVALUATED are part of the frozen state vocabulary (so they must exist as valid
  // `state` values) but no S10-C action transitions into them — reaching COMPLETED requires a
  // real session result, which is explicitly S10-D's job (§3/§14), not this file's.
  var ACTIONS = ['ACTIVATE', 'MARK_UNRESOLVED', 'DEFER', 'RESUME', 'CANCEL'];
  var VALID_TRANSITIONS = {
    DRAFTED:     { ACTIVATE: 'ACTIVE', MARK_UNRESOLVED: 'UNRESOLVED', DEFER: 'DEFERRED', CANCEL: 'CANCELLED' },
    ACTIVE:      { DEFER: 'DEFERRED', CANCEL: 'CANCELLED' },
    IN_PROGRESS: { CANCEL: 'CANCELLED' },
    DEFERRED:    { RESUME: 'DRAFTED', CANCEL: 'CANCELLED' },
    UNRESOLVED:  {},
    CANCELLED:   {},
    SUPERSEDED:  {},
    COMPLETED:   {},
    EVALUATED:   {}
  };
  // §10 frozen activation-gate rejection codes, in check order.
  var ACTIVATION_GATE_ORDER = [
    'MISSING_PRESCRIPTION', 'MISSING_RECOMMENDATION_REF', 'INVALID_PRESCRIPTION_STATUS',
    'MISSING_PRIORITY', 'MISSING_TRAINING_OBJECTIVE', 'MISSING_TRAINING_MODE', 'MISSING_KPI_PROFILE'
  ];

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
  function uid(prefix) {
    var rnd = Math.random().toString(36).slice(2, 8);
    return prefix + '_' + Date.now().toString(36) + rnd;
  }
  function nowISO() { return new Date().toISOString(); }

  // ================================================================
  // §7 Prescription Input Contract — verbatim snapshot, nothing recomputed.
  // ================================================================

  function snapshotPrescription(p) {
    return {
      prescription_id: p.prescription_id,
      source_recommendation_id: p.source_recommendation_id != null ? p.source_recommendation_id : null,
      training_objective_code: p.training_objective_code != null ? p.training_objective_code : null,
      training_mode: p.training_mode != null ? p.training_mode : null,
      drill_family_code: p.drill_family_code != null ? p.drill_family_code : null,
      priority_rank: p.priority_rank != null ? p.priority_rank : null,
      priority_score: p.priority_score != null ? p.priority_score : null,
      priority_tier: p.priority_tier != null ? p.priority_tier : null,
      kpi_profile_code: p.kpi_profile_code != null ? p.kpi_profile_code : null,
      kpi_target_value: p.kpi_target_value != null ? p.kpi_target_value : null,
      kpi_target_status: p.kpi_target_status != null ? p.kpi_target_status : null,
      dosage_profile_code: p.dosage_profile_code != null ? p.dosage_profile_code : null,
      resolved_drill_ids: Array.isArray(p.resolved_drill_ids) ? p.resolved_drill_ids.slice() : [],
      drill_resolution_status: p.drill_resolution_status != null ? p.drill_resolution_status : null,
      reassessment_profile_code: p.reassessment_profile_code != null ? p.reassessment_profile_code : null,
      status: p.status != null ? p.status : null
    };
  }

  // ================================================================
  // §8 Prescription Workflow Contract — lifecycle + references only.
  // ================================================================

  function createPrescriptionWorkflow(opts) {
    opts = opts || {};
    if (!isPlainObject(opts)) throw WorkflowError('INVALID_INPUT', 'opts must be an object');
    var p = opts.prescription;
    if (!isPlainObject(p)) throw WorkflowError('INVALID_INPUT', 'prescription is required');
    if (p.prescription_id == null) throw WorkflowError('INVALID_INPUT', 'prescription.prescription_id is required');

    var snapshot = snapshotPrescription(p);
    var now = nowISO();
    return {
      prescription_workflow: {
        workflow_id: opts.workflow_id || uid('pwf'),
        prescription_ref: snapshot.prescription_id,
        recommendation_ref: snapshot.source_recommendation_id,
        player_id: opts.player_id != null ? opts.player_id : (p.player_id != null ? p.player_id : null),
        state: 'DRAFTED',
        session_refs: [],
        activated_at: null,
        completed_at: null,
        superseded_by: null,
        prescription_snapshot: snapshot,
        schema_version: SCHEMA_VERSION,
        contract_version: CONTRACT_VERSION,
        created_at: now,
        updated_at: now
      }
    };
  }

  // ================================================================
  // §10 Activation Gate — deterministic, explicit rejection, no silent
  // activation. §11/§12: UNRESOLVED drill / BENCHMARK_NOT_RESOLVED KPI
  // are never checked here — they never block eligibility.
  // ================================================================

  function canActivate(snapshot) {
    if (!isPlainObject(snapshot)) return { eligible: false, reason: 'MISSING_PRESCRIPTION' };
    if (snapshot.source_recommendation_id == null) return { eligible: false, reason: 'MISSING_RECOMMENDATION_REF' };
    if (snapshot.status !== 'prescribed') return { eligible: false, reason: 'INVALID_PRESCRIPTION_STATUS' };
    if (snapshot.priority_rank == null || snapshot.priority_score == null || snapshot.priority_tier == null) {
      return { eligible: false, reason: 'MISSING_PRIORITY' };
    }
    if (snapshot.training_objective_code == null) return { eligible: false, reason: 'MISSING_TRAINING_OBJECTIVE' };
    if (snapshot.training_mode == null) return { eligible: false, reason: 'MISSING_TRAINING_MODE' };
    if (snapshot.kpi_profile_code == null) return { eligible: false, reason: 'MISSING_KPI_PROFILE' };
    return { eligible: true, reason: null };
  }

  // ================================================================
  // §9/§16 Generic lifecycle transitions (everything except
  // START_TRAINING and SUPERSEDE, which have richer return shapes — see
  // startTraining()/supersede() below).
  // ================================================================

  function transition(workflow, action, payload) {
    payload = payload || {};
    if (!isPlainObject(workflow)) throw WorkflowError('INVALID_INPUT', 'workflow must be an object');
    if (ALL_STATES.indexOf(workflow.state) === -1) throw WorkflowError('INVALID_INPUT', 'unrecognized workflow state: ' + workflow.state);
    if (ACTIONS.indexOf(action) === -1) throw WorkflowError('INVALID_INPUT', 'unknown workflow action: ' + action);

    var nextState = VALID_TRANSITIONS[workflow.state] && VALID_TRANSITIONS[workflow.state][action];
    if (!nextState) throw WorkflowError('INVALID_INPUT', 'invalid transition: action ' + action + ' is not valid from state ' + workflow.state);

    if (action === 'ACTIVATE') {
      // §16 Rule 5: a stale prescription cannot be (re-)activated either.
      if (payload.stale === true) throw WorkflowError('STALE_RECOMMENDATION', 'prescription is stale (reassessment pending) — cannot activate');
      var gate = canActivate(workflow.prescription_snapshot);
      if (!gate.eligible) throw WorkflowError(gate.reason, 'activation rejected: ' + gate.reason);
    }

    var next = Object.assign({}, workflow, { updated_at: nowISO(), state: nextState });
    if (action === 'ACTIVATE') next.activated_at = nowISO();
    return next;
  }

  // ================================================================
  // §14/§15 START_TRAINING — its own function (not the generic
  // transition table) because it both changes state AND produces a
  // session_intent reference. Never records attempts/results/evidence.
  // ================================================================

  function startTraining(workflow, payload) {
    payload = payload || {};
    if (!isPlainObject(workflow)) throw WorkflowError('INVALID_INPUT', 'workflow must be an object');
    if (workflow.state !== 'ACTIVE') {
      throw WorkflowError('INVALID_INPUT', 'START_TRAINING is only valid from state ACTIVE (current: ' + workflow.state + ')');
    }
    // §16 Rule 5: a stale prescription cannot start new training.
    if (payload.stale === true) throw WorkflowError('STALE_RECOMMENDATION', 'prescription is stale (reassessment pending) — cannot start training');

    var snap = workflow.prescription_snapshot || {};
    var session_intent = {
      session_id: payload.session_id || uid('sint'),
      prescription_ref: workflow.prescription_ref,
      player_id: workflow.player_id,
      status: 'PLANNED',
      training_objective_code: snap.training_objective_code != null ? snap.training_objective_code : null,
      training_mode: snap.training_mode != null ? snap.training_mode : null,
      kpi_profile_code: snap.kpi_profile_code != null ? snap.kpi_profile_code : null,
      schema_version: SCHEMA_VERSION
    };

    var next = Object.assign({}, workflow, { updated_at: nowISO(), state: 'IN_PROGRESS' });
    next.session_refs = workflow.session_refs.slice();
    next.session_refs.push(session_intent.session_id);

    return { workflow: next, session_intent: session_intent };
  }

  // ================================================================
  // §17 Supersession — old workflow -> SUPERSEDED (history/refs kept,
  // nothing deleted); new prescription starts fresh at DRAFTED.
  // ================================================================

  function supersede(oldWorkflow, newPrescriptionOpts) {
    if (!isPlainObject(oldWorkflow)) throw WorkflowError('INVALID_INPUT', 'oldWorkflow must be an object');
    if (['DRAFTED', 'ACTIVE', 'IN_PROGRESS', 'DEFERRED'].indexOf(oldWorkflow.state) === -1) {
      throw WorkflowError('INVALID_INPUT', 'SUPERSEDE is not valid from state ' + oldWorkflow.state);
    }
    var carryPlayer = (newPrescriptionOpts && newPrescriptionOpts.player_id != null) ? newPrescriptionOpts.player_id : oldWorkflow.player_id;
    var created = createPrescriptionWorkflow(Object.assign({}, newPrescriptionOpts, { player_id: carryPlayer }));

    var superseded_workflow = Object.assign({}, oldWorkflow, {
      state: 'SUPERSEDED',
      superseded_by: created.prescription_workflow.workflow_id,
      updated_at: nowISO()
    });

    return { superseded_workflow: superseded_workflow, prescription_workflow: created.prescription_workflow };
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    MAIN_STATES: MAIN_STATES.slice(),
    AUX_STATES: AUX_STATES.slice(),
    ACTIONS: ACTIONS.slice(),
    VALID_TRANSITIONS: JSON.parse(JSON.stringify(VALID_TRANSITIONS)),
    ACTIVATION_GATE_ORDER: ACTIVATION_GATE_ORDER.slice(),

    createPrescriptionWorkflow: createPrescriptionWorkflow,
    canActivate: canActivate,
    transition: transition,
    startTraining: startTraining,
    supersede: supersede
  };
});
