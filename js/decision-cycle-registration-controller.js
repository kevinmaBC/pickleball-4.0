/* ============================================================
 * decision-cycle-registration-controller.js — Pickleball App 2.0 Alpha
 * S11-F0-R1 Production Decision Registration Entry
 *
 * The single production caller that turns an already-computed, in-memory
 * S9 Recommendation + matching Prescription (js/review-ui.js's own
 * loadDashboardData pipeline, itself unchanged) into a durable S10-A
 * Development Cycle / S10-C Prescription Workflow pair, by delegating to
 * js/session-evidence-persistence.js's registerDecisionCycleDurable.
 *
 * This closes the gap docs/S11-F0-PRESCRIPTION-LINEAGE-AUDIT.md found:
 * no production code ever durably registered a Prescription Workflow —
 * only test fixtures and manual QA console calls did.
 *
 * Frozen boundary (do not cross):
 *   - Zero runtime dependency on js/diagnosis-engine.js,
 *     js/recommendation-priority-engine.js or
 *     js/training-prescription-engine.js (PBDiagnosis /
 *     PBRecommendationPriority / PBTrainingPrescription) — this file
 *     never reruns S9. It only accepts an already-computed
 *     recommendation/prescription pair from its caller.
 *   - Zero runtime dependency on js/workflow-integration-engine.js or
 *     js/prescription-workflow-engine.js directly (PBWorkflow /
 *     PBPrescriptionWorkflow) — every transition/creation is delegated
 *     to js/session-evidence-persistence.js, the single S10 durability
 *     orchestration layer, never duplicated here.
 *   - Never assigns cycle.state / prescription_refs / recommendation_refs
 *     directly — those remain PBWorkflow.transition's own decision.
 *   - Never calls START_TRAINING / activates the Prescription Workflow —
 *     ends at cycle.state PRESCRIPTION_READY / workflow.state DRAFTED.
 *     Activation and training start remain S11-C Guided Training's own
 *     separate, later, explicit action.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBDecisionCycleRegistration = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function ControllerError(code, message) {
    var err = new Error(message || code);
    err.name = 'DecisionCycleRegistrationError';
    err.code = code;
    return err;
  }

  var CONTROLLER_VERSION = 'S11-F0-R1-V1';

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

  function persistenceEngine() {
    if (typeof PBSessionEvidencePersistence === 'undefined') throw ControllerError('DEP_MISSING', 'PBSessionEvidencePersistence not loaded');
    return PBSessionEvidencePersistence;
  }

  // registerDecisionCycle({player_id, source_match_session_id, recommendation, prescription})
  // -> Promise<{development_cycle, prescription_workflow, was_existing}>
  //
  // Validates shape only (identity/state-machine rules live in
  // js/session-evidence-persistence.js, the single source of truth for
  // that business logic — never duplicated here).
  function registerDecisionCycle(opts) {
    opts = opts || {};
    if (!opts.player_id) return Promise.reject(ControllerError('INVALID_INPUT', 'player_id is required'));
    if (!opts.source_match_session_id) return Promise.reject(ControllerError('INVALID_INPUT', 'source_match_session_id is required'));
    if (!isPlainObject(opts.recommendation) || opts.recommendation.recommendation_id == null) {
      return Promise.reject(ControllerError('INVALID_INPUT', 'recommendation.recommendation_id is required'));
    }
    if (!isPlainObject(opts.prescription) || opts.prescription.prescription_id == null) {
      return Promise.reject(ControllerError('INVALID_INPUT', 'prescription.prescription_id is required'));
    }

    // js/session-evidence-persistence.js validates identity/state-machine rules with a
    // synchronous throw before it ever returns a promise (the same convention
    // completeSessionDurable already uses) — wrapped here so registerDecisionCycle's own
    // contract is a plain, always-a-promise call for its caller (js/review-ui.js's click
    // handler chains .then/.catch directly off it).
    try {
      return persistenceEngine().registerDecisionCycleDurable({
        player_id: opts.player_id,
        source_match_session_id: opts.source_match_session_id,
        recommendation: opts.recommendation,
        prescription: opts.prescription
      });
    } catch (e) {
      return Promise.reject(e);
    }
  }

  return {
    CONTROLLER_VERSION: CONTROLLER_VERSION,
    registerDecisionCycle: registerDecisionCycle
  };
});
