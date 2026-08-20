/* ============================================================
 * workflow-integration-engine.js — Pickleball App 2.0 Alpha · S10-A
 * Product Workflow Integration Layer — WORKFLOW CONTRACT / STATE
 * MACHINE SOURCE OF TRUTH.
 *
 * Connects existing accepted domain outputs (Player Profile, Assessment
 * / Match Observation, Evidence, Findings, Recommendation, Priority,
 * Training Prescription, Training Session, Progress, Reassessment) into
 * one Development Cycle contract and state model:
 *   Evidence -> Decision -> Action -> Evidence
 *
 * This file has ZERO runtime dependency on js/match-observation-engine.js,
 * js/performance-analysis-engine.js, js/diagnosis-engine.js,
 * js/recommendation-priority-engine.js, js/training-prescription-engine.js
 * or js/storage.js — it never requires/reads global PBMatchObservation /
 * PBPerformanceAnalysis / PBDiagnosis / PBRecommendationPriority /
 * PBTrainingPrescription / PBStore, and never recomputes anything those
 * engines already decided. It only accepts already-computed reference
 * IDs and values (recommendation_refs, prescription_refs, priority_ref,
 * priority_score, etc.) supplied by the caller and stores them as opaque
 * references. This is what "workflow references existing domain
 * outputs, never recalculates them" means structurally, not just by
 * convention — see docs/S10-A-WORKFLOW-INTEGRATION.md.
 *
 * Frozen boundary (do not cross):
 *   - Pure, deterministic functions only. No LLM, no ML, no randomness
 *     in any computed field (createEvidence/createDevelopmentCycle's
 *     generated ids and timestamps are the only non-deterministic
 *     inputs, exactly as js/storage.js's own uid()/nowISO() are).
 *   - Recommendation / Priority / Prescription are three distinct
 *     reference fields on the Development Cycle contract
 *     (recommendation_refs / priority_ref / prescription_refs) and are
 *     never merged into one field or re-derived from one another.
 *   - A completed Training Session always produces TRAINING evidence;
 *     an incomplete one never does (Rule 4).
 *   - New evidence added after a recommendation exists always makes the
 *     cycle reassessment-eligible; it never silently overwrites the
 *     existing recommendation/prescription refs (Rule 5).
 *   - Invalid transitions never fail silently — every rejection throws
 *     a WorkflowError with one of the five frozen codes below.
 *
 * See docs/S10-A-WORKFLOW-INTEGRATION.md for the full contract/state
 * reference.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBWorkflow = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function WorkflowError(code, message) {
    var err = new Error(message || code);
    err.name = 'WorkflowError';
    err.code = code;
    return err;
  }

  var WORKFLOW_CONTRACT_VERSION = 'S10-A-V1';
  var SCHEMA_VERSION = '1.0';

  // §5 frozen state model.
  var NORMAL_STATES = [
    'BASELINE_READY', 'EVIDENCE_AVAILABLE', 'RECOMMENDATION_READY',
    'PRESCRIPTION_READY', 'TRAINING_ACTIVE', 'SESSION_COMPLETED',
    'PROGRESS_RECORDED', 'REASSESSMENT_READY', 'CYCLE_COMPLETED'
  ];
  var ERROR_CONDITIONS = [
    'INSUFFICIENT_EVIDENCE', 'INVALID_INPUT', 'STALE_RECOMMENDATION',
    'PRESCRIPTION_UNAVAILABLE', 'REASSESSMENT_REQUIRED'
  ];

  var EVIDENCE_SOURCES = ['MATCH', 'TRAINING', 'COACH', 'PLAYER_SELF_REPORT'];

  var ACTIONS = [
    'ADD_EVIDENCE', 'GENERATE_RECOMMENDATION', 'GENERATE_PRESCRIPTION',
    'START_TRAINING', 'COMPLETE_SESSION', 'RECORD_PROGRESS', 'COMPLETE_CYCLE'
  ];

  // §5/§12 frozen transition table: state -> action -> next state. Any (state, action) pair
  // absent from this table is an invalid transition (rejected with INVALID_INPUT). Reassessment
  // (Rule 5) is reachable from every state that already has a recommendation on file — new
  // evidence never overwrites recommendation_refs/prescription_refs, it only flags staleness.
  var VALID_TRANSITIONS = {
    BASELINE_READY:       { ADD_EVIDENCE: 'EVIDENCE_AVAILABLE' },
    EVIDENCE_AVAILABLE:   { ADD_EVIDENCE: 'EVIDENCE_AVAILABLE', GENERATE_RECOMMENDATION: 'RECOMMENDATION_READY' },
    RECOMMENDATION_READY: { ADD_EVIDENCE: 'REASSESSMENT_READY', GENERATE_PRESCRIPTION: 'PRESCRIPTION_READY' },
    PRESCRIPTION_READY:   { ADD_EVIDENCE: 'REASSESSMENT_READY', START_TRAINING: 'TRAINING_ACTIVE' },
    TRAINING_ACTIVE:      { ADD_EVIDENCE: 'REASSESSMENT_READY', COMPLETE_SESSION: 'SESSION_COMPLETED' },
    SESSION_COMPLETED:    { ADD_EVIDENCE: 'REASSESSMENT_READY', RECORD_PROGRESS: 'PROGRESS_RECORDED' },
    PROGRESS_RECORDED:    { ADD_EVIDENCE: 'REASSESSMENT_READY', COMPLETE_CYCLE: 'CYCLE_COMPLETED' },
    REASSESSMENT_READY:   { GENERATE_RECOMMENDATION: 'RECOMMENDATION_READY' },
    CYCLE_COMPLETED:      {}
  };

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
  function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }
  function round(n, decimals) { var f = Math.pow(10, decimals); return Math.round(n * f) / f; }

  function uid(prefix) {
    var rnd = Math.random().toString(36).slice(2, 8);
    return prefix + '_' + Date.now().toString(36) + rnd;
  }
  function nowISO() { return new Date().toISOString(); }

  // ================================================================
  // §6 Development Cycle Contract — versioned, reference-based only.
  // ================================================================

  function createDevelopmentCycle(opts) {
    opts = opts || {};
    if (!isPlainObject(opts)) throw WorkflowError('INVALID_INPUT', 'opts must be an object');
    if (!opts.player_id) throw WorkflowError('INVALID_INPUT', 'player_id is required');
    if (!opts.baseline_ref) throw WorkflowError('INVALID_INPUT', 'baseline_ref is required');

    var now = nowISO();
    return {
      development_cycle: {
        cycle_id: opts.cycle_id || uid('cyc'),
        player_id: opts.player_id,
        baseline_ref: opts.baseline_ref,
        evidence_refs: [],
        recommendation_refs: [],
        priority_ref: null,
        prescription_refs: [],
        training_session_refs: [],
        progress_evidence_refs: [],
        reassessment_ref: null,
        // Bookkeeping used by GENERATE_PRESCRIPTION to detect a stale recommendation (§12); not
        // part of the literal example contract in §6, additive only per §6's "adapt naming/style".
        evidence_ref_count_at_last_recommendation: 0,
        state: 'BASELINE_READY',
        schema_version: SCHEMA_VERSION,
        created_at: now,
        updated_at: now
      }
    };
  }

  // ================================================================
  // §12 Deterministic state transitions. Operates on the bare
  // development_cycle object (not the {development_cycle:...} wrapper).
  // Never mutates the input — returns a new cycle object or throws.
  // ================================================================

  function transition(cycle, action, payload) {
    payload = payload || {};
    if (!isPlainObject(cycle)) throw WorkflowError('INVALID_INPUT', 'cycle must be an object');
    if (NORMAL_STATES.indexOf(cycle.state) === -1) {
      throw WorkflowError('INVALID_INPUT', 'cycle.state is not a recognized workflow state: ' + cycle.state);
    }
    if (ACTIONS.indexOf(action) === -1) {
      throw WorkflowError('INVALID_INPUT', 'unknown workflow action: ' + action);
    }

    // Completing a cycle while a reassessment is pending is explicitly rejected (§12/Rule 5) —
    // checked ahead of the generic table lookup so it reports the specific frozen code.
    if (action === 'COMPLETE_CYCLE' && cycle.state === 'REASSESSMENT_READY') {
      throw WorkflowError('REASSESSMENT_REQUIRED', 'cycle has pending reassessment evidence; regenerate the recommendation before completing');
    }

    var nextState = VALID_TRANSITIONS[cycle.state] && VALID_TRANSITIONS[cycle.state][action];
    if (!nextState) {
      throw WorkflowError('INVALID_INPUT', 'invalid transition: action ' + action + ' is not valid from state ' + cycle.state);
    }

    var next = Object.assign({}, cycle, { updated_at: nowISO() });

    if (action === 'ADD_EVIDENCE') {
      if (!payload.evidence_ref) throw WorkflowError('INVALID_INPUT', 'ADD_EVIDENCE requires payload.evidence_ref');
      next.evidence_refs = cycle.evidence_refs.slice();
      if (next.evidence_refs.indexOf(payload.evidence_ref) === -1) next.evidence_refs.push(payload.evidence_ref);
      next.state = nextState;
      return next;
    }

    if (action === 'GENERATE_RECOMMENDATION') {
      // §12 example 1: no evidence -> recommendation is rejected.
      if (cycle.evidence_refs.length === 0) {
        throw WorkflowError('INSUFFICIENT_EVIDENCE', 'cannot generate a recommendation reference with no evidence_refs');
      }
      if (!Array.isArray(payload.recommendation_refs) || payload.recommendation_refs.length === 0) {
        throw WorkflowError('INVALID_INPUT', 'GENERATE_RECOMMENDATION requires a non-empty payload.recommendation_refs array');
      }
      next.recommendation_refs = payload.recommendation_refs.slice();
      next.priority_ref = payload.priority_ref != null ? payload.priority_ref : null;
      next.evidence_ref_count_at_last_recommendation = cycle.evidence_refs.length;
      next.state = nextState;
      return next;
    }

    if (action === 'GENERATE_PRESCRIPTION') {
      // §12 example 2: no (current) recommendation -> prescription is rejected. A recommendation
      // generated before evidence that has since been added is treated the same as "no current
      // recommendation" — never prescribe off a stale one.
      var recommendationCurrent = cycle.recommendation_refs.length > 0 &&
        cycle.evidence_refs.length === cycle.evidence_ref_count_at_last_recommendation;
      if (!recommendationCurrent) {
        throw WorkflowError('STALE_RECOMMENDATION', 'no current recommendation reference to prescribe from — regenerate the recommendation first');
      }
      if (!Array.isArray(payload.prescription_refs) || payload.prescription_refs.length === 0) {
        throw WorkflowError('INVALID_INPUT', 'GENERATE_PRESCRIPTION requires a non-empty payload.prescription_refs array');
      }
      next.prescription_refs = payload.prescription_refs.slice();
      next.state = nextState;
      return next;
    }

    if (action === 'START_TRAINING') {
      if (cycle.prescription_refs.length === 0) {
        throw WorkflowError('PRESCRIPTION_UNAVAILABLE', 'cannot start training with no prescription_refs');
      }
      next.state = nextState;
      return next;
    }

    if (action === 'COMPLETE_SESSION') {
      // §12 example 3: no prescription -> complete training session is rejected.
      if (cycle.prescription_refs.length === 0) {
        throw WorkflowError('PRESCRIPTION_UNAVAILABLE', 'cannot complete a training session with no prescription_refs');
      }
      if (!payload.training_session_ref) throw WorkflowError('INVALID_INPUT', 'COMPLETE_SESSION requires payload.training_session_ref');
      if (payload.completed !== true) throw WorkflowError('INVALID_INPUT', 'COMPLETE_SESSION requires payload.completed === true');
      next.training_session_refs = cycle.training_session_refs.slice();
      if (next.training_session_refs.indexOf(payload.training_session_ref) === -1) next.training_session_refs.push(payload.training_session_ref);
      next.state = nextState;
      return next;
    }

    if (action === 'RECORD_PROGRESS') {
      if (!payload.progress_ref) throw WorkflowError('INVALID_INPUT', 'RECORD_PROGRESS requires payload.progress_ref');
      next.progress_evidence_refs = cycle.progress_evidence_refs.slice();
      if (next.progress_evidence_refs.indexOf(payload.progress_ref) === -1) next.progress_evidence_refs.push(payload.progress_ref);
      next.state = nextState;
      return next;
    }

    // action === 'COMPLETE_CYCLE'
    next.state = nextState;
    return next;
  }

  // ================================================================
  // §7 Evidence Source Contract.
  // ================================================================

  function createEvidence(opts) {
    opts = opts || {};
    if (!isPlainObject(opts)) throw WorkflowError('INVALID_INPUT', 'evidence opts must be an object');
    if (EVIDENCE_SOURCES.indexOf(opts.source) === -1) {
      throw WorkflowError('INVALID_INPUT', 'evidence.source must be one of ' + EVIDENCE_SOURCES.join('/'));
    }
    if (opts.skill == null && opts.kpi == null) {
      throw WorkflowError('INVALID_INPUT', 'evidence requires skill or kpi');
    }
    if (opts.value === undefined) throw WorkflowError('INVALID_INPUT', 'evidence.value is required');

    return {
      evidence_id: opts.evidence_id || uid('ev'),
      source: opts.source,
      timestamp: opts.timestamp || nowISO(),
      skill: opts.skill != null ? opts.skill : null,
      kpi: opts.kpi != null ? opts.kpi : null,
      value: opts.value,
      context: opts.context != null ? opts.context : null,
      confidence: opts.confidence != null ? opts.confidence : null
    };
  }

  // ================================================================
  // §8 Training Session Contract + Rule 4 (completed session -> evidence).
  // ================================================================

  function recordTrainingSession(opts) {
    opts = opts || {};
    if (!isPlainObject(opts)) throw WorkflowError('INVALID_INPUT', 'opts must be an object');
    if (!opts.prescription_id) throw WorkflowError('INVALID_INPUT', 'prescription_id is required');
    if (!opts.skill) throw WorkflowError('INVALID_INPUT', 'skill is required');
    if (!opts.kpi) throw WorkflowError('INVALID_INPUT', 'kpi is required');
    if (!isFiniteNumber(opts.attempts) || opts.attempts < 0) throw WorkflowError('INVALID_INPUT', 'attempts must be a non-negative number');
    if (!isFiniteNumber(opts.successful_attempts) || opts.successful_attempts < 0) throw WorkflowError('INVALID_INPUT', 'successful_attempts must be a non-negative number');
    if (opts.successful_attempts > opts.attempts) throw WorkflowError('INVALID_INPUT', 'successful_attempts cannot exceed attempts');
    if (!isFiniteNumber(opts.result_value)) throw WorkflowError('INVALID_INPUT', 'result_value must be a number');
    if (typeof opts.completed !== 'boolean') throw WorkflowError('INVALID_INPUT', 'completed must be a boolean');

    var session = {
      session_id: opts.session_id || uid('tse'),
      prescription_id: opts.prescription_id,
      skill: opts.skill,
      kpi: opts.kpi,
      attempts: opts.attempts,
      successful_attempts: opts.successful_attempts,
      result_value: opts.result_value,
      completed: opts.completed,
      evidence_type: 'TRAINING'
    };

    // Rule 4: only a completed session produces training evidence.
    var evidence = null;
    if (opts.completed === true) {
      evidence = createEvidence({
        source: 'TRAINING',
        timestamp: opts.timestamp || nowISO(),
        skill: opts.skill,
        kpi: opts.kpi,
        value: opts.result_value,
        context: opts.prescription_id,
        confidence: null
      });
    }

    return { session: session, evidence: evidence };
  }

  // ================================================================
  // §9 Progress Contract.
  // ================================================================

  function computeProgress(opts) {
    opts = opts || {};
    if (!isPlainObject(opts)) throw WorkflowError('INVALID_INPUT', 'opts must be an object');
    if (!isFiniteNumber(opts.baseline_kpi)) throw WorkflowError('INVALID_INPUT', 'baseline_kpi must be a number');
    if (!isFiniteNumber(opts.current_kpi)) throw WorkflowError('INVALID_INPUT', 'current_kpi must be a number');
    if (opts.target_kpi != null && !isFiniteNumber(opts.target_kpi)) {
      throw WorkflowError('INVALID_INPUT', 'target_kpi must be a number when provided');
    }

    // Absolute delta only — 0.58 -> 0.71 is +0.13 (13 percentage points), never a 13% relative
    // change. Rounded to avoid binary floating-point artifacts (e.g. 0.71-0.58 !== 0.13 in raw IEEE754).
    var delta = round(opts.current_kpi - opts.baseline_kpi, 4);
    var delta_percentage_points = round(delta * 100, 2);
    var trend = delta > 0 ? 'IMPROVING' : (delta < 0 ? 'DECLINING' : 'STABLE');

    var target_status = 'NOT_SET';
    if (opts.target_kpi != null) {
      target_status = opts.current_kpi >= opts.target_kpi ? 'MET' : 'IN_PROGRESS';
    }

    return {
      skill: opts.skill != null ? opts.skill : null,
      kpi: opts.kpi != null ? opts.kpi : null,
      baseline_kpi: opts.baseline_kpi,
      current_kpi: opts.current_kpi,
      delta: delta,
      delta_percentage_points: delta_percentage_points,
      trend: trend,
      target_kpi: opts.target_kpi != null ? opts.target_kpi : null,
      target_status: target_status,
      evidence_count: opts.evidence_count != null ? opts.evidence_count : 0
    };
  }

  return {
    WORKFLOW_CONTRACT_VERSION: WORKFLOW_CONTRACT_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    NORMAL_STATES: NORMAL_STATES.slice(),
    ERROR_CONDITIONS: ERROR_CONDITIONS.slice(),
    EVIDENCE_SOURCES: EVIDENCE_SOURCES.slice(),
    ACTIONS: ACTIONS.slice(),
    VALID_TRANSITIONS: JSON.parse(JSON.stringify(VALID_TRANSITIONS)),

    createDevelopmentCycle: createDevelopmentCycle,
    transition: transition,
    createEvidence: createEvidence,
    recordTrainingSession: recordTrainingSession,
    computeProgress: computeProgress
  };
});
