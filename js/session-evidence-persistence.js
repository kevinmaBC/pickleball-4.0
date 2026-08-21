/* ============================================================
 * session-evidence-persistence.js — Pickleball App 2.0 Alpha · S10-D-R1
 * Durable S10 Persistence + Reload Idempotency — thin orchestration
 * layer over the already-accepted pure engines.
 *
 * Composes js/storage.js (S10-D-R1's four new stores),
 * js/workflow-integration-engine.js (PBWorkflow, S10-A), and
 * js/session-evidence-engine.js (PBSessionEvidence, S10-D) to make
 * Session Result / TRAINING Evidence / Development Cycle durable across
 * reload, with idempotent replay after partial interruption. This file
 * implements NO new business rule: every domain decision (numeric
 * validation, the Evidence Eligibility Gate, evidence identity,
 * ADD_EVIDENCE / resulting workflow state) is delegated verbatim to
 * PBSessionEvidence/PBWorkflow — this file only decides *whether a
 * given step needs to run at all* by checking what is already
 * persisted, per §14's Cases A/B/C.
 *
 * js/prescription-workflow-engine.js (PBPrescriptionWorkflow, S10-C) is
 * NOT modified or wrapped by a parallel orchestration path here —
 * §8 of the frozen package prefers a caller simply calling
 * PBStore.putPrescriptionWorkflow(...)/getPrescriptionWorkflow(...)
 * directly with the plain object PBPrescriptionWorkflow already
 * produces (no business logic sits between them), so this file only
 * re-exports thin pass-through helpers for symmetry/documentation.
 *
 * Persistence-layer consistency strategy (§13): IndexedDB transactions
 * here are NOT wrapped in a single multi-store transaction — the repo's
 * existing tx()/put() helpers in js/storage.js operate one store at a
 * time, and this file does not invent a new cross-store transaction
 * framework. Steps run in the documented deterministic order (verify no
 * existing Session Result -> generate -> persist -> verify no existing
 * Evidence -> generate/persist -> ADD_EVIDENCE -> persist updated
 * cycle); if a later step fails, earlier successfully-persisted records
 * are never deleted (no invented rollback), and the failure is surfaced
 * explicitly rather than reported as success. A retried call after a
 * partial failure is idempotent (§14) because every step first checks
 * what is already durably persisted before creating anything new.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBSessionEvidencePersistence = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function PersistenceError(code, message) {
    var err = new Error(message || code);
    err.name = 'SessionEvidencePersistenceError';
    err.code = code;
    return err;
  }

  function storeEngine() {
    if (typeof PBStore === 'undefined') throw PersistenceError('DEP_MISSING', 'PBStore not loaded');
    return PBStore;
  }
  function wfEngine() {
    if (typeof PBWorkflow === 'undefined') throw PersistenceError('DEP_MISSING', 'PBWorkflow not loaded');
    return PBWorkflow;
  }
  function seEngine() {
    if (typeof PBSessionEvidence === 'undefined') throw PersistenceError('DEP_MISSING', 'PBSessionEvidence not loaded');
    return PBSessionEvidence;
  }

  var CONTRACT_VERSION = 'S10-D-R1-V1';

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

  // Wraps a PBStore promise so an underlying IndexedDB failure is never mistaken for "not
  // found" / silently swallowed — surfaced with an explicit, documented code (§24).
  function readStep(promise, label) {
    return promise.catch(function (e) {
      throw PersistenceError('PERSISTENCE_READ_FAILED', label + ' failed: ' + (e && e.message));
    });
  }
  function writeStep(promise, label) {
    return promise.catch(function (e) {
      throw PersistenceError('PERSISTENCE_WRITE_FAILED', label + ' failed: ' + (e && e.message));
    });
  }

  // ================================================================
  // §9 Development Cycle durability — load existing, or legitimately
  // create+persist a new one (never fabricated without real inputs).
  // ================================================================

  function ensureDevelopmentCycle(opts) {
    opts = opts || {};
    var store = storeEngine();
    if (opts.cycle_id) {
      return readStep(store.getDevelopmentCycle(opts.cycle_id), 'getDevelopmentCycle').then(function (existing) {
        if (existing) return existing;
        if (!opts.player_id || !opts.baseline_ref) {
          throw PersistenceError('MISSING_DEVELOPMENT_CYCLE', 'no persisted cycle for cycle_id ' + opts.cycle_id + ' and no player_id/baseline_ref given to legitimately create one');
        }
        return createAndPersistCycle(opts);
      });
    }
    if (!opts.player_id || !opts.baseline_ref) {
      throw PersistenceError('MISSING_DEVELOPMENT_CYCLE', 'player_id and baseline_ref are required to create a development_cycle (none fabricated)');
    }
    return createAndPersistCycle(opts);
  }

  function createAndPersistCycle(opts) {
    var created = wfEngine().createDevelopmentCycle({ player_id: opts.player_id, baseline_ref: opts.baseline_ref, cycle_id: opts.cycle_id }).development_cycle;
    return writeStep(storeEngine().putDevelopmentCycle(created), 'putDevelopmentCycle').then(function () { return created; });
  }

  // ================================================================
  // §8/§20 Prescription Workflow durability — thin pass-through only,
  // no business logic (per §8's own instruction).
  // ================================================================

  function persistPrescriptionWorkflow(workflow) {
    if (!isPlainObject(workflow) || workflow.workflow_id == null) throw PersistenceError('INVALID_INPUT', 'workflow.workflow_id is required');
    return writeStep(storeEngine().putPrescriptionWorkflow(workflow), 'putPrescriptionWorkflow');
  }
  function reloadPrescriptionWorkflow(workflow_id) {
    return readStep(storeEngine().getPrescriptionWorkflow(workflow_id), 'getPrescriptionWorkflow');
  }

  // ================================================================
  // §10-§19 Durable session completion: Session Result -> TRAINING
  // Evidence -> S10-A ADD_EVIDENCE -> persisted Development Cycle.
  // Idempotent per §14 Cases A/B/C — every step checks what already
  // exists durably before creating anything.
  // ================================================================

  function payloadsMatch(a, b) {
    return a.attempts === b.attempts && a.successful_attempts === b.successful_attempts;
  }

  function completeSessionDurable(opts) {
    opts = opts || {};
    var se = seEngine();
    var store = storeEngine();
    var wf = wfEngine();

    if (!isPlainObject(opts.session_execution) || opts.session_execution.session_id == null) {
      throw PersistenceError('INVALID_INPUT', 'session_execution is required');
    }
    var session_id = opts.session_execution.session_id;

    // Step 1: verify no existing Session Result (§13 step 1 / §14 Case A).
    return readStep(store.getSessionResult(session_id), 'getSessionResult').then(function (existingResult) {
      if (existingResult) {
        // §17: identical replay reuses the existing result; conflicting payload rejects.
        if (opts.attempts != null && !payloadsMatch(existingResult, opts)) {
          throw PersistenceError('DUPLICATE_FINALIZATION', 'session ' + session_id + ' is already finalized with a different attempts/successful_attempts payload');
        }
        return existingResult;
      }
      // Step 2: generate a valid Session Result via the pure engine (never re-implemented here).
      var result = se.completeSession(opts.session_execution, {
        attempts: opts.attempts, successful_attempts: opts.successful_attempts, completed_at: opts.completed_at
      }).session_result;
      // Step 3: persist it.
      return writeStep(store.putSessionResult(result), 'putSessionResult').then(function () { return result; });
    }).then(function (session_result) {
      // Step 4: verify no existing Evidence for this session/KPI identity (§14 Case A/B).
      var evidence_id = 'ev:' + session_result.session_id + ':' + session_result.kpi_profile_code;
      return readStep(store.getTrainingEvidence(evidence_id), 'getTrainingEvidence').then(function (existingEvidence) {
        var evidencePromise;
        if (existingEvidence) {
          evidencePromise = Promise.resolve(existingEvidence);
        } else {
          // Step 5: build (Evidence Eligibility Gate, §13 — throws explicitly if ineligible,
          // e.g. a 0-attempt session) and persist.
          var built = se.buildTrainingEvidence(session_result).evidence;
          evidencePromise = writeStep(store.putTrainingEvidence(built), 'putTrainingEvidence').then(function () { return built; });
        }
        return evidencePromise.then(function (evidence) {
          return { session_result: session_result, evidence: evidence };
        });
      });
    }).then(function (partial) {
      // Step 6/7: apply ADD_EVIDENCE against the durably-persisted cycle (never the caller's
      // possibly-stale in-memory copy), then persist the updated cycle. Idempotent: if the
      // persisted cycle already references this evidence_id, nothing more happens (§14 Case C).
      if (!opts.development_cycle_id) throw PersistenceError('MISSING_DEVELOPMENT_CYCLE', 'development_cycle_id is required to submit TRAINING evidence');
      return readStep(store.getDevelopmentCycle(opts.development_cycle_id), 'getDevelopmentCycle').then(function (persistedCycle) {
        if (!persistedCycle) throw PersistenceError('MISSING_DEVELOPMENT_CYCLE', 'no persisted development_cycle found for ' + opts.development_cycle_id);

        if (persistedCycle.evidence_refs.indexOf(partial.evidence.evidence_id) !== -1) {
          return { session_result: partial.session_result, evidence: partial.evidence, development_cycle: persistedCycle };
        }

        // Rule 4 (carried from S10-D core): the ADD_EVIDENCE call happens here explicitly;
        // PBWorkflow alone determines the resulting state (including REASSESSMENT_READY).
        var updatedCycle = wf.transition(persistedCycle, 'ADD_EVIDENCE', { evidence_ref: partial.evidence.evidence_id });
        return writeStep(store.putDevelopmentCycle(updatedCycle), 'putDevelopmentCycle').then(function () {
          return { session_result: partial.session_result, evidence: partial.evidence, development_cycle: updatedCycle };
        });
      });
    });
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    ensureDevelopmentCycle: ensureDevelopmentCycle,
    persistPrescriptionWorkflow: persistPrescriptionWorkflow,
    reloadPrescriptionWorkflow: reloadPrescriptionWorkflow,
    completeSessionDurable: completeSessionDurable
  };
});
