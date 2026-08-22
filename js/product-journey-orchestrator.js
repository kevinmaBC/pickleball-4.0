/* ============================================================
 * product-journey-orchestrator.js — Pickleball App 2.0 Alpha · S11-A
 * Product Journey Orchestrator / User State Contract — PRODUCT JOURNEY
 * PROJECTION SOURCE OF TRUTH.
 *
 * Answers "what stage of the product journey is the player currently
 * in, and what is the single primary next user action?" by projecting
 * already-computed S9/S10 domain objects into one deterministic,
 * disposable Journey View Model. Never decides a diagnosis,
 * recommendation, priority, prescription, workflow transition,
 * progress value, or reassessment outcome — those stay exactly where
 * S9/S10 already put them (see docs/S11-A-PRODUCT-JOURNEY-ORCHESTRATOR.md
 * for the full authority-boundary table).
 *
 * This file has ZERO runtime dependency on js/diagnosis-engine.js,
 * js/recommendation-priority-engine.js, js/training-prescription-engine.js,
 * js/workflow-integration-engine.js, js/dashboard-integration-engine.js,
 * js/prescription-workflow-engine.js, js/session-evidence-engine.js,
 * js/progress-tracking-engine.js, js/progress-reassessment-persistence.js,
 * js/reassessment-engine.js or js/storage.js — it never requires/reads
 * any of their globals. It only accepts already-computed plain objects
 * (development_cycle, recommendations, prescriptions,
 * prescription_workflows, session_results, progress snapshots,
 * reassessment records) from the caller and projects them; the same
 * zero-coupling guarantee js/dashboard-integration-engine.js (S10-B)
 * uses to structurally prove it never recalculates an upstream
 * decision.
 *
 * Frozen boundary (do not cross):
 *   - Pure, deterministic, regenerable projection only. No LLM, no ML,
 *     no randomness, no Date.now()/timestamp fields — the Journey View
 *     Model is disposable and must be exactly reproducible from the
 *     same input (never persisted — see docs/S11-A... §"Persistence").
 *   - development_cycle.state is read verbatim as the primary/strongest
 *     signal for stage — never recomputed, never second-guessed by
 *     looking at prescription/recommendation objects instead.
 *   - Journey Stage is a presentation/product concept, distinct from
 *     development_cycle.state / prescription_workflow.state, which stay
 *     verbatim in workflow_context — never mutated to a Journey Stage
 *     value.
 *   - REASSESSMENT_READY always outranks a still-ACTIVE/IN_PROGRESS
 *     prescription workflow — the primary next_action is always
 *     RECORD_REAL_MATCH in that case, never START_TRAINING/
 *     CONTINUE_TRAINING (Rule: reassessment precedence).
 *   - UNRESOLVED / BENCHMARK_NOT_RESOLVED / INSUFFICIENT_DATA machine
 *     codes are always preserved verbatim in presentation_flags —
 *     never translated into FAILED/ERROR/NO_TRAINING/SUCCESS.
 *   - TRAINING and MATCH progress are always surfaced as two
 *     independent fields (progress_context.training /
 *     progress_context.match) — never merged into one number.
 *   - Exactly one primary next_action is always emitted, drawn only
 *     from the frozen NEXT_ACTIONS vocabulary below.
 *
 * See docs/S11-A-PRODUCT-JOURNEY-ORCHESTRATOR.md for the full field
 * reference and stage-mapping evidence.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBProductJourney = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function JourneyError(code, message) {
    var err = new Error(message || code);
    err.name = 'ProductJourneyError';
    err.code = code;
    return err;
  }

  var CONTRACT_VERSION = 'S11-A-V1';
  var SCHEMA_VERSION = '1.0';

  // Frozen §7 Product Journey Stages — presentation/product stages, never written back onto
  // development_cycle.state or prescription_workflow.state.
  var JOURNEY_STAGES = [
    'NEEDS_ASSESSMENT', 'REVIEW_RECOMMENDATION', 'READY_TO_TRAIN', 'TRAINING_IN_PROGRESS',
    'REVIEW_PROGRESS', 'READY_TO_REASSESS', 'CYCLE_COMPLETE'
  ];

  // Frozen §8 Journey Status vocabulary — additive status/flags only, never an eighth stage.
  var JOURNEY_STATUSES = ['READY', 'PARTIAL', 'UNRESOLVED', 'BLOCKED'];

  // Frozen §11 Next Action vocabulary — navigation/UX intent only, never domain execution.
  var NEXT_ACTIONS = [
    'START_ASSESSMENT', 'REVIEW_RECOMMENDATION', 'ACTIVATE_PRESCRIPTION', 'START_TRAINING',
    'CONTINUE_TRAINING', 'RESUME_SESSION', 'REVIEW_PROGRESS', 'RECORD_REAL_MATCH',
    'REVIEW_REASSESSMENT', 'START_NEXT_CYCLE', 'NONE'
  ];

  // Local, frozen copy of js/workflow-integration-engine.js's (S10-A) §5 NORMAL_STATES — kept as
  // a hardcoded literal (never read from PBWorkflow.NORMAL_STATES at runtime) to preserve this
  // file's zero-runtime-dependency guarantee. Any drift between the two lists is a repository
  // regression to be caught by tests, not resolved by coupling to PBWorkflow.
  var CYCLE_STATES = [
    'BASELINE_READY', 'EVIDENCE_AVAILABLE', 'RECOMMENDATION_READY', 'PRESCRIPTION_READY',
    'TRAINING_ACTIVE', 'SESSION_COMPLETED', 'PROGRESS_RECORDED', 'REASSESSMENT_READY', 'CYCLE_COMPLETED'
  ];

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

  function findLast(arr) {
    if (!Array.isArray(arr) || !arr.length) return null;
    return arr[arr.length - 1];
  }

  function findById(arr, idField, id) {
    if (!Array.isArray(arr) || id == null) return null;
    for (var i = 0; i < arr.length; i++) {
      if (isPlainObject(arr[i]) && arr[i][idField] === id) return arr[i];
    }
    return null;
  }

  // §12/Case D helper: the current, non-terminal prescription workflow for a given
  // prescription_ref, preferring a non-SUPERSEDED match but falling back to the most recent
  // SUPERSEDED one so history is never simply invisible.
  function findCurrentWorkflow(workflows, prescriptionRef) {
    if (!Array.isArray(workflows) || prescriptionRef == null) return null;
    var matches = workflows.filter(function (w) { return isPlainObject(w) && w.prescription_ref === prescriptionRef; });
    if (!matches.length) return null;
    var live = matches.filter(function (w) { return w.state !== 'SUPERSEDED'; });
    return live.length ? live[live.length - 1] : matches[matches.length - 1];
  }

  // §12/Case E helper: a resumable in-flight session is one the caller supplied with
  // state === 'ACTIVE' (the session_execution shape js/session-evidence-engine.js's own
  // createSessionExecution/transition produce — S11-A never fabricates or infers this).
  function findResumableSession(sessionResults, playerId, prescriptionRef) {
    if (!Array.isArray(sessionResults)) return null;
    var matches = sessionResults.filter(function (s) {
      return isPlainObject(s) && s.state === 'ACTIVE'
        && (playerId == null || s.player_id === playerId)
        && (prescriptionRef == null || s.prescription_ref === prescriptionRef);
    });
    return matches.length ? matches[matches.length - 1] : null;
  }

  function findProgressBySource(progressList, cycleId, source) {
    if (!Array.isArray(progressList)) return null;
    for (var i = 0; i < progressList.length; i++) {
      var p = progressList[i];
      if (isPlainObject(p) && p.cycle_id === cycleId && p.source === source) return p;
    }
    return null;
  }

  function findReassessment(reassessment, cycleId) {
    if (Array.isArray(reassessment)) {
      for (var i = 0; i < reassessment.length; i++) {
        if (isPlainObject(reassessment[i]) && reassessment[i].cycle_id === cycleId) return reassessment[i];
      }
      return null;
    }
    if (isPlainObject(reassessment) && reassessment.cycle_id === cycleId) return reassessment;
    return null;
  }

  function nextAction(code, enabled, targetRef) {
    if (NEXT_ACTIONS.indexOf(code) === -1) throw JourneyError('INVALID_NEXT_ACTION', 'unknown next_action code: ' + code);
    return { code: code, enabled: enabled === true, target_ref: targetRef != null ? targetRef : null };
  }

  // ================================================================
  // §12/§13 Stage + next_action derivation. development_cycle.state is the sole primary signal;
  // prescription_workflow/session_results/progress objects only ever choose BETWEEN next_actions
  // already implied by that state — they never upgrade or override the stage itself.
  // ================================================================

  function deriveStage(cycle, ctx) {
    if (!cycle) {
      return {
        stage: 'NEEDS_ASSESSMENT', status: 'READY', headline_code: 'NO_ACTIVE_CYCLE',
        next_action: nextAction('START_ASSESSMENT', true, null), presentation_flags: []
      };
    }

    var flags = [];
    var recRef = findLast(cycle.recommendation_refs);
    var prescRef = findLast(cycle.prescription_refs);
    var workflow = findCurrentWorkflow(ctx.prescriptionWorkflows, prescRef);

    switch (cycle.state) {
      case 'BASELINE_READY':
      case 'EVIDENCE_AVAILABLE':
        return {
          stage: 'NEEDS_ASSESSMENT', status: 'READY', headline_code: cycle.state,
          next_action: nextAction('START_ASSESSMENT', true, cycle.cycle_id), presentation_flags: flags
        };

      case 'RECOMMENDATION_READY': {
        var recPrescription = findById(ctx.prescriptions, 'source_recommendation_id', recRef);
        var recWorkflow = recPrescription ? findCurrentWorkflow(ctx.prescriptionWorkflows, recPrescription.prescription_id) : null;
        var na = (recWorkflow && (recWorkflow.state === 'DRAFTED' || recWorkflow.state === 'ACTIVE'))
          ? nextAction('ACTIVATE_PRESCRIPTION', true, recWorkflow.workflow_id)
          : nextAction('REVIEW_RECOMMENDATION', true, recRef);
        return { stage: 'REVIEW_RECOMMENDATION', status: 'READY', headline_code: cycle.state, next_action: na, presentation_flags: flags };
      }

      case 'PRESCRIPTION_READY': {
        if (workflow && workflow.state === 'DRAFTED') {
          return {
            stage: 'READY_TO_TRAIN', status: 'READY', headline_code: cycle.state,
            next_action: nextAction('ACTIVATE_PRESCRIPTION', true, workflow.workflow_id), presentation_flags: flags
          };
        }
        if (workflow && workflow.state === 'ACTIVE') {
          return {
            stage: 'READY_TO_TRAIN', status: 'READY', headline_code: cycle.state,
            next_action: nextAction('START_TRAINING', true, workflow.workflow_id), presentation_flags: flags
          };
        }
        flags.push('PRESCRIPTION_WORKFLOW_UNAVAILABLE');
        return {
          stage: 'READY_TO_TRAIN', status: 'PARTIAL', headline_code: cycle.state,
          next_action: nextAction('ACTIVATE_PRESCRIPTION', false, workflow ? workflow.workflow_id : null), presentation_flags: flags
        };
      }

      case 'TRAINING_ACTIVE': {
        var resumable = findResumableSession(ctx.sessionResults, cycle.player_id, prescRef);
        var trainingAction = resumable
          ? nextAction('RESUME_SESSION', true, resumable.session_id)
          : nextAction('CONTINUE_TRAINING', true, workflow ? workflow.workflow_id : prescRef);
        return { stage: 'TRAINING_IN_PROGRESS', status: 'READY', headline_code: cycle.state, next_action: trainingAction, presentation_flags: flags };
      }

      case 'SESSION_COMPLETED':
      case 'PROGRESS_RECORDED': {
        var trainingProgress = findProgressBySource(ctx.progress, cycle.cycle_id, 'TRAINING');
        var status = trainingProgress ? 'READY' : 'PARTIAL';
        if (!trainingProgress) flags.push('PROGRESS_NOT_YET_AVAILABLE');
        return {
          stage: 'REVIEW_PROGRESS', status: status, headline_code: cycle.state,
          next_action: nextAction('REVIEW_PROGRESS', true, cycle.cycle_id), presentation_flags: flags
        };
      }

      case 'REASSESSMENT_READY': {
        flags.push('REASSESSMENT_REQUIRED');
        if (recRef) flags.push('STALE_RECOMMENDATION');
        if (prescRef) flags.push('STALE_PRESCRIPTION');
        return {
          stage: 'READY_TO_REASSESS', status: 'READY', headline_code: cycle.state,
          next_action: nextAction('RECORD_REAL_MATCH', true, cycle.cycle_id), presentation_flags: flags
        };
      }

      case 'CYCLE_COMPLETED':
        return {
          stage: 'CYCLE_COMPLETE', status: 'READY', headline_code: cycle.state,
          next_action: nextAction('START_NEXT_CYCLE', true, cycle.player_id), presentation_flags: flags
        };

      default:
        throw JourneyError('INVALID_CYCLE_STATE', 'development_cycle.state is not a recognized workflow state: ' + cycle.state);
    }
  }

  // ================================================================
  // §10 Public pure entry point — one call per player/cycle snapshot.
  // ================================================================

  function projectJourney(input) {
    input = input || {};
    if (!isPlainObject(input)) throw JourneyError('INVALID_INPUT', 'input must be an object');

    var cycle = isPlainObject(input.development_cycle) ? input.development_cycle : null;
    if (cycle && cycle.cycle_id == null) throw JourneyError('INVALID_INPUT', 'development_cycle.cycle_id is required when development_cycle is supplied');

    var playerId = (isPlainObject(input.player) && input.player.player_id != null) ? input.player.player_id
      : (cycle && cycle.player_id != null ? cycle.player_id : null);
    if (playerId == null) throw JourneyError('MISSING_PLAYER_ID', 'a player_id is required (via input.player.player_id or development_cycle.player_id)');

    // POST-S11-R3B-2: assessment_context (from js/assessment-journey-bridge.js) is passed through
    // verbatim, additive-only — it is never consulted by deriveStage/CYCLE_STATES and never
    // influences stage/next_action/current_focus/workflow_context. It exists solely so a
    // consumer (e.g. HOME) can know assessment/evidence facts even while cycle is null.
    var assessmentContext = isPlainObject(input.assessment_context) ? input.assessment_context : null;

    var recommendations = Array.isArray(input.recommendations) ? input.recommendations : [];
    var prescriptions = Array.isArray(input.prescriptions) ? input.prescriptions : [];
    var prescriptionWorkflows = Array.isArray(input.prescription_workflows) ? input.prescription_workflows : [];
    var sessionResults = Array.isArray(input.session_results) ? input.session_results : [];
    var progress = Array.isArray(input.progress) ? input.progress : [];

    var ctx = { prescriptions: prescriptions, prescriptionWorkflows: prescriptionWorkflows, sessionResults: sessionResults, progress: progress };
    var derived = deriveStage(cycle, ctx);

    var recRef = cycle ? findLast(cycle.recommendation_refs) : null;
    var prescRef = cycle ? findLast(cycle.prescription_refs) : null;
    var matchedRecommendation = findById(recommendations, 'recommendation_id', recRef);
    var workflow = cycle ? findCurrentWorkflow(prescriptionWorkflows, prescRef) : null;

    var flags = derived.presentation_flags.slice();
    if (matchedRecommendation && matchedRecommendation.rank == null) flags.push('RECOMMENDATION_RANK_UNRESOLVED');

    var matchedPrescription = findById(prescriptions, 'prescription_id', prescRef);
    if (matchedPrescription) {
      if (matchedPrescription.drill_resolution_status === 'UNRESOLVED') flags.push('DRILL_UNRESOLVED');
      if (matchedPrescription.kpi_target_status === 'BENCHMARK_NOT_RESOLVED') flags.push('KPI_TARGET_UNRESOLVED');
    }

    var trainingProgress = cycle ? findProgressBySource(progress, cycle.cycle_id, 'TRAINING') : null;
    var matchProgress = cycle ? findProgressBySource(progress, cycle.cycle_id, 'MATCH') : null;
    if (matchProgress && matchProgress.trend === 'INSUFFICIENT_DATA') flags.push('MATCH_PROGRESS_INSUFFICIENT_DATA');
    var progressContext = (trainingProgress || matchProgress) ? { training: trainingProgress || null, match: matchProgress || null } : null;

    var reassessmentRecord = cycle ? findReassessment(input.reassessment, cycle.cycle_id) : null;
    var reassessmentRequired = derived.stage === 'READY_TO_REASSESS';

    var journey = {
      player_id: playerId,
      cycle_ref: cycle ? cycle.cycle_id : null,

      stage: derived.stage,
      status: derived.status,

      headline_code: derived.headline_code,

      next_action: derived.next_action,
      secondary_actions: [],

      current_focus: {
        recommendation_ref: recRef,
        priority_rank: matchedRecommendation && matchedRecommendation.rank != null ? matchedRecommendation.rank : null,
        prescription_ref: prescRef
      },

      workflow_context: {
        development_cycle_state: cycle ? cycle.state : null,
        prescription_workflow_state: workflow ? workflow.state : null
      },

      progress_context: progressContext,

      reassessment: {
        required: reassessmentRequired,
        match_required: reassessmentRequired,
        reassessment_ref: reassessmentRecord ? reassessmentRecord.reassessment_id : (cycle && cycle.reassessment_ref != null ? cycle.reassessment_ref : null)
      },

      presentation_flags: flags,

      assessment_context: assessmentContext,

      schema_version: SCHEMA_VERSION,
      journey_version: CONTRACT_VERSION
    };

    return { journey: journey };
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    JOURNEY_STAGES: JOURNEY_STAGES.slice(),
    JOURNEY_STATUSES: JOURNEY_STATUSES.slice(),
    NEXT_ACTIONS: NEXT_ACTIONS.slice(),
    CYCLE_STATES: CYCLE_STATES.slice(),

    projectJourney: projectJourney
  };
});
