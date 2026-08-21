/* ============================================================
 * session-evidence-engine.js — Pickleball App 2.0 Alpha · S10-D
 * Training Session Execution + Evidence Capture — SESSION RESULT /
 * TRAINING EVIDENCE SOURCE OF TRUTH.
 *
 * Frozen chain: S9-F Prescription -> S10-C Prescription Workflow ->
 * Session Intent -> S10-D Session Execution -> Session Result ->
 * TRAINING Evidence -> S10-A ADD_EVIDENCE -> Reassessment Eligibility.
 * Execution produces Result. Result produces Evidence. Evidence drives
 * Reassessment. This file does not calculate progress, trends, KPI
 * verdicts, or any new recommendation/priority/prescription decision.
 *
 * This file has ZERO runtime dependency on js/match-observation-engine.js,
 * js/performance-analysis-engine.js, js/diagnosis-engine.js,
 * js/recommendation-priority-engine.js, js/training-prescription-engine.js,
 * js/prescription-workflow-engine.js, js/dashboard-integration-engine.js
 * or js/storage.js. Its ONE legitimate upstream dependency is
 * js/workflow-integration-engine.js (PBWorkflow, S10-A) — Rule 4
 * requires this file to explicitly call PBWorkflow's own accepted
 * ADD_EVIDENCE transition itself (not leave it to the caller), exactly
 * the same "only calls its one legitimate upstream" pattern
 * js/recommendation-priority-engine.js (S9-E, -> PBDiagnosis only) and
 * js/training-prescription-engine.js (S9-F, -> PBRecommendationPriority
 * only) already use. S10-A fully owns whatever resulting workflow
 * state comes back (including REASSESSMENT_READY) — this file never
 * assigns or recomputes that state itself.
 *
 * S8 execution bridge decision (evidence in docs/S10-D-SESSION-EVIDENCE.md):
 * js/session-execution-engine.js (S8-C) is NOT reused directly.
 * startSession/finalizeSession both require a persisted S8-A
 * `session_plans` record (PBStore.getSessionPlan), whose own FK chain
 * is rooted in S7-A review_snapshots/prescriptions (the same
 * CAP/bottleneck lineage js/training-plan-engine.js is rooted in — see
 * S10-C's own bridge-decision evidence). S10-C's session_intent is a
 * transient, unpersisted object with no session_plans record behind
 * it, so PBStore.getSessionPlan could never find it. This file is a
 * MINIMAL EXECUTION BRIDGE: it borrows S8-C's proven architecture
 * pattern (keep in-flight ACTIVE state as a plain in-memory/returned
 * object, only a terminal COMPLETE call produces a "real" record; one
 * finalization per session, enforced explicitly) without touching
 * S8-A's FK-validated storage.
 *
 * Persistence: this file adds NO new IndexedDB store and calls no
 * storage API at all — every function is a pure transform on plain
 * objects the caller passes in and gets back, exactly like
 * js/workflow-integration-engine.js (S10-A), js/dashboard-integration-
 * engine.js (S10-B), and js/prescription-workflow-engine.js (S10-C)
 * before it. Durable cross-reload survival of Session Result/Evidence
 * data was evaluated and found to require either corrupting a
 * wrong-lineage existing store or a new purpose-built one — neither is
 * self-authorized here; see docs/S10-D-SESSION-EVIDENCE.md for the full
 * reasoning and the resulting scope boundary.
 *
 * Frozen boundary (do not cross):
 *   - Pure, deterministic functions only. No LLM, no ML, no randomness
 *     in any decision field. evidence_id is deterministically derived
 *     from session_id + kpi_profile_code (never a random uid) so a
 *     second attempt at the same evidence naturally collides (§15).
 *   - Only a COMPLETED Session Result may become Evidence (Rule 2). A
 *     PARTIAL/SKIPPED/CANCELLED session never produces Evidence and is
 *     never coerced into attempts=0/successful=0/result_value=0
 *     (Rule 3) — "not performed" is never "performance zero".
 *   - source is always exactly 'TRAINING' — never MATCH/COACH/
 *     PLAYER_SELF_REPORT (§14).
 *   - Evidence is explicitly submitted through PBWorkflow's ADD_EVIDENCE
 *     transition inside this file (Rule 4) — this file never assigns
 *     REASSESSMENT_READY itself.
 *   - A missing development_cycle is never fabricated — submission
 *     rejects with MISSING_DEVELOPMENT_CYCLE (§17).
 *   - No baseline_kpi/current_kpi/delta/trend/target_status/IMPROVING/
 *     DECLINING/MET/NOT_MET is ever produced here — that is S10-E (§19).
 *
 * See docs/S10-D-SESSION-EVIDENCE.md for the full field reference and
 * the execution-bridge-decision evidence.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBSessionEvidence = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function SessionEvidenceError(code, message) {
    var err = new Error(message || code);
    err.name = 'SessionEvidenceError';
    err.code = code;
    return err;
  }

  function wfEngine() {
    if (typeof PBWorkflow === 'undefined') throw SessionEvidenceError('DEP_MISSING', 'PBWorkflow not loaded');
    return PBWorkflow;
  }

  var CONTRACT_VERSION = 'S10-D-V1';
  var SCHEMA_VERSION = '1.0';

  // §8 frozen state model.
  var MAIN_STATES = ['PLANNED', 'ACTIVE', 'COMPLETED'];
  var AUX_STATES = ['PARTIAL', 'SKIPPED', 'CANCELLED', 'INVALID'];
  var ALL_STATES = MAIN_STATES.concat(AUX_STATES);
  var TERMINAL_STATES = ['COMPLETED', 'PARTIAL', 'SKIPPED', 'CANCELLED', 'INVALID'];

  // Generic transitions only (everything that does NOT produce a Session Result/Evidence).
  // COMPLETE has its own dedicated function (completeSession) because it validates numerics and
  // returns a richer, distinctly-shaped session_result object — never routed through this table.
  var ACTIONS = ['START', 'SKIP', 'CANCEL'];
  var VALID_TRANSITIONS = {
    PLANNED:   { START: 'ACTIVE', SKIP: 'SKIPPED', CANCEL: 'CANCELLED' },
    ACTIVE:    { CANCEL: 'CANCELLED' },
    COMPLETED: {}, PARTIAL: {}, SKIPPED: {}, CANCELLED: {}, INVALID: {}
  };

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
  function isNonNegInt(v) { return typeof v === 'number' && isFinite(v) && v >= 0 && Math.floor(v) === v; }
  function round(n, decimals) { var f = Math.pow(10, decimals); return Math.round(n * f) / f; }
  function nowISO() { return new Date().toISOString(); }

  // ================================================================
  // §7 Session Intent Input -> §8 Session Execution.
  // ================================================================

  function createSessionExecution(opts) {
    opts = opts || {};
    if (!isPlainObject(opts)) throw SessionEvidenceError('INVALID_INPUT', 'opts must be an object');
    var si = opts.session_intent;
    if (!isPlainObject(si)) throw SessionEvidenceError('INVALID_INPUT', 'session_intent is required');
    if (si.session_id == null) throw SessionEvidenceError('INVALID_INPUT', 'session_intent.session_id is required');
    if (si.prescription_ref == null) throw SessionEvidenceError('MISSING_PRESCRIPTION_REF', 'session_intent.prescription_ref is required');
    if (si.player_id == null) throw SessionEvidenceError('MISSING_PLAYER', 'session_intent.player_id is required');
    if (si.kpi_profile_code == null) throw SessionEvidenceError('MISSING_KPI_PROFILE', 'session_intent.kpi_profile_code is required');

    return {
      session_execution: {
        session_id: si.session_id,
        prescription_ref: si.prescription_ref,
        // §9/§20: traceability to Recommendation is carried "directly or through Prescription
        // Workflow" — the caller may pass it explicitly (e.g. from the PrescriptionWorkflow
        // object it already holds); never derived here since that would require depending on
        // js/prescription-workflow-engine.js, which this file deliberately does not.
        recommendation_ref: opts.recommendation_ref != null ? opts.recommendation_ref : null,
        player_id: si.player_id,
        training_objective_code: si.training_objective_code != null ? si.training_objective_code : null,
        training_mode: si.training_mode != null ? si.training_mode : null,
        kpi_profile_code: si.kpi_profile_code,
        state: 'PLANNED',
        started_at: null,
        completed_at: null,
        schema_version: SCHEMA_VERSION,
        contract_version: CONTRACT_VERSION
      }
    };
  }

  // ================================================================
  // §8 Generic lifecycle transitions: START / SKIP / CANCEL. Pure —
  // returns a new session_execution or throws, never mutates input.
  // ================================================================

  function transition(execution, action, payload) {
    payload = payload || {};
    if (!isPlainObject(execution)) throw SessionEvidenceError('INVALID_INPUT', 'execution must be an object');
    if (ALL_STATES.indexOf(execution.state) === -1) throw SessionEvidenceError('INVALID_INPUT', 'unrecognized execution state: ' + execution.state);
    if (ACTIONS.indexOf(action) === -1) throw SessionEvidenceError('INVALID_INPUT', 'unknown execution action: ' + action);

    // §11: a duplicate finalization attempt gets its own explicit code, checked ahead of the
    // generic table lookup (which would otherwise just report a generic invalid transition).
    if ((action === 'SKIP' || action === 'CANCEL') && TERMINAL_STATES.indexOf(execution.state) !== -1) {
      throw SessionEvidenceError('DUPLICATE_FINALIZATION', 'session already finalized as ' + execution.state);
    }

    var nextState = VALID_TRANSITIONS[execution.state] && VALID_TRANSITIONS[execution.state][action];
    if (!nextState) throw SessionEvidenceError('INVALID_SESSION_STATE', 'invalid transition: action ' + action + ' is not valid from state ' + execution.state);

    var next = Object.assign({}, execution, { state: nextState });
    if (action === 'START') next.started_at = payload.started_at || nowISO();
    if (action === 'SKIP' || action === 'CANCEL') next.completed_at = nowISO();
    return next;
  }

  // ================================================================
  // §9/§10/§11 COMPLETE — the single authoritative finalization
  // operation that can produce a Session Result. Dedicated function
  // (not the generic table) because of its numeric validation and
  // distinctly-shaped return value (Rule 1: Session Result != Session
  // Intent/Execution).
  // ================================================================

  function completeSession(execution, payload) {
    payload = payload || {};
    if (!isPlainObject(execution)) throw SessionEvidenceError('INVALID_INPUT', 'execution must be an object');
    if (TERMINAL_STATES.indexOf(execution.state) !== -1) {
      throw SessionEvidenceError('DUPLICATE_FINALIZATION', 'session already finalized as ' + execution.state);
    }
    if (execution.state !== 'ACTIVE') {
      throw SessionEvidenceError('INVALID_SESSION_STATE', 'COMPLETE is only valid from ACTIVE (current: ' + execution.state + ')');
    }
    if (!isNonNegInt(payload.attempts)) throw SessionEvidenceError('INVALID_ATTEMPTS', 'attempts must be a non-negative integer');
    if (!isNonNegInt(payload.successful_attempts)) throw SessionEvidenceError('INVALID_SUCCESS_COUNT', 'successful_attempts must be a non-negative integer');
    if (payload.successful_attempts > payload.attempts) throw SessionEvidenceError('INVALID_SUCCESS_COUNT', 'successful_attempts cannot exceed attempts');

    var completed_at = payload.completed_at || nowISO();
    // §10: result_value = successful_attempts / attempts, no second UI-specific formula; when
    // attempts is 0 the ratio is undefined, so result_value stays null rather than NaN/Infinity —
    // the Evidence Eligibility Gate (§13) is what actually rejects the attempts<=0 case for
    // Evidence purposes, kept as its own separate, explicit gate (Rule 1's Result != Evidence).
    var result_value = payload.attempts > 0 ? round(payload.successful_attempts / payload.attempts, 4) : null;

    return {
      session_result: {
        session_id: execution.session_id,
        prescription_ref: execution.prescription_ref,
        recommendation_ref: execution.recommendation_ref != null ? execution.recommendation_ref : null,
        player_id: execution.player_id,
        status: 'COMPLETED',
        training_objective_code: execution.training_objective_code != null ? execution.training_objective_code : null,
        training_mode: execution.training_mode != null ? execution.training_mode : null,
        kpi_profile_code: execution.kpi_profile_code,
        attempts: payload.attempts,
        successful_attempts: payload.successful_attempts,
        result_value: result_value,
        started_at: execution.started_at != null ? execution.started_at : null,
        completed_at: completed_at,
        schema_version: SCHEMA_VERSION,
        contract_version: CONTRACT_VERSION
      }
    };
  }

  // ================================================================
  // §13 Evidence Eligibility Gate — explicit, no silent evidence creation.
  // ================================================================

  function canGenerateEvidence(session_result) {
    if (!isPlainObject(session_result)) return { eligible: false, reason: 'INVALID_INPUT' };
    if (session_result.status !== 'COMPLETED') return { eligible: false, reason: 'INVALID_SESSION_STATE' };
    if (!isNonNegInt(session_result.attempts) || session_result.attempts <= 0) return { eligible: false, reason: 'INVALID_ATTEMPTS' };
    if (!isNonNegInt(session_result.successful_attempts) || session_result.successful_attempts > session_result.attempts) {
      return { eligible: false, reason: 'INVALID_SUCCESS_COUNT' };
    }
    if (typeof session_result.result_value !== 'number' || !isFinite(session_result.result_value)) return { eligible: false, reason: 'INVALID_RESULT_VALUE' };
    if (session_result.session_id == null) return { eligible: false, reason: 'INVALID_INPUT' };
    if (session_result.prescription_ref == null) return { eligible: false, reason: 'MISSING_PRESCRIPTION_REF' };
    if (session_result.player_id == null) return { eligible: false, reason: 'MISSING_PLAYER' };
    if (session_result.kpi_profile_code == null) return { eligible: false, reason: 'MISSING_KPI_PROFILE' };
    return { eligible: true, reason: null };
  }

  // §15 deterministic identity: session_id + kpi_profile_code, never a random id — a second
  // build for the same session/KPI always yields the exact same evidence_id.
  function evidenceIdentity(session_result) {
    return 'ev:' + session_result.session_id + ':' + session_result.kpi_profile_code;
  }

  // ================================================================
  // §14 TRAINING Evidence construction.
  // ================================================================

  function buildTrainingEvidence(session_result) {
    var gate = canGenerateEvidence(session_result);
    if (!gate.eligible) throw SessionEvidenceError(gate.reason, 'evidence generation rejected: ' + gate.reason);

    return {
      evidence: {
        evidence_id: evidenceIdentity(session_result),
        source: 'TRAINING', // hard invariant — never MATCH/COACH/PLAYER_SELF_REPORT for S10-D output
        player_id: session_result.player_id,
        session_ref: session_result.session_id,
        prescription_ref: session_result.prescription_ref,
        recommendation_ref: session_result.recommendation_ref != null ? session_result.recommendation_ref : null,
        skill: null,
        kpi: session_result.kpi_profile_code,
        value: session_result.result_value,
        context: {
          attempts: session_result.attempts,
          successful_attempts: session_result.successful_attempts,
          training_mode: session_result.training_mode != null ? session_result.training_mode : null
        },
        timestamp: session_result.completed_at != null ? session_result.completed_at : nowISO(),
        confidence: null,
        schema_version: SCHEMA_VERSION
      }
    };
  }

  // ================================================================
  // §16/§17 Mandatory S10-A ADD_EVIDENCE bridge — the primary S10-D
  // acceptance gate. Explicitly calls PBWorkflow.transition(...,
  // 'ADD_EVIDENCE', ...) itself; S10-A alone determines the resulting
  // workflow state (including REASSESSMENT_READY).
  // ================================================================

  function submitTrainingEvidence(session_result, development_cycle) {
    // §17: a legitimate cycle means one with a recognized PBWorkflow state — not just any object.
    var wf = wfEngine();
    if (!isPlainObject(development_cycle) || wf.NORMAL_STATES.indexOf(development_cycle.state) === -1) {
      throw SessionEvidenceError('MISSING_DEVELOPMENT_CYCLE', 'a legitimate development_cycle is required to submit TRAINING evidence (none fabricated)');
    }

    var evidence = buildTrainingEvidence(session_result).evidence; // throws on ineligibility (§13)

    // §15: duplicate protection reuses the cycle's own evidence_refs — no new persistence needed.
    var existingRefs = Array.isArray(development_cycle.evidence_refs) ? development_cycle.evidence_refs : [];
    if (existingRefs.indexOf(evidence.evidence_id) !== -1) {
      throw SessionEvidenceError('DUPLICATE_EVIDENCE', 'evidence already recorded for this session/KPI: ' + evidence.evidence_id);
    }

    // Rule 4: the ADD_EVIDENCE call happens here, inside S10-D — never left to the caller.
    var updated_development_cycle = wf.transition(development_cycle, 'ADD_EVIDENCE', { evidence_ref: evidence.evidence_id });

    return { evidence: evidence, development_cycle: updated_development_cycle };
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    MAIN_STATES: MAIN_STATES.slice(),
    AUX_STATES: AUX_STATES.slice(),
    ACTIONS: ACTIONS.slice(),
    VALID_TRANSITIONS: JSON.parse(JSON.stringify(VALID_TRANSITIONS)),

    createSessionExecution: createSessionExecution,
    transition: transition,
    completeSession: completeSession,
    canGenerateEvidence: canGenerateEvidence,
    buildTrainingEvidence: buildTrainingEvidence,
    submitTrainingEvidence: submitTrainingEvidence
  };
});
