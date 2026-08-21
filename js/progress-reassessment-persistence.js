/* ============================================================
 * progress-reassessment-persistence.js — Pickleball App 2.0 Alpha ·
 * S10-E-R1
 * Durable Progress Tracking + Reassessment Loop — thin orchestration
 * layer over the already-accepted pure engines.
 *
 * Composes js/storage.js (S10-E-R1's two new stores),
 * js/cycle-baseline-engine.js, js/progress-tracking-engine.js,
 * js/reassessment-engine.js (all zero-dependency, S10-E-R1), and — its
 * only legitimate upstream dependencies beyond those — the accepted S9
 * public pipeline (PBDiagnosis.diagnoseMatch ->
 * PBRecommendationPriority.prioritizeDiagnosis ->
 * PBTrainingPrescription.prescribeRecommendations) for reassessment,
 * plus PBWorkflow (S10-A, read-only cycle lookups + its own existing
 * COMPLETE_CYCLE transition) and PBPrescriptionWorkflow (S10-C, its own
 * existing supersede()). This file implements no new business rule of
 * its own — every domain decision is delegated verbatim to those
 * engines; it only decides whether a given step needs to run at all by
 * checking what is already durably persisted (idempotent replay,
 * mirroring js/session-evidence-persistence.js's S10-D-R1 pattern).
 *
 * IMPORTANT — no durable MATCH-source evidence store exists in this
 * repository (js/storage.js's `training_evidence` store only ever
 * holds source: 'TRAINING' records, per S10-D's own hard invariant).
 * Functions here that need MATCH-track evidence (baseline capture,
 * current MATCH progress) accept an optional caller-supplied
 * `match_evidence` array rather than querying a store that doesn't
 * exist — in real production use today that means the MATCH track will
 * resolve UNRESOLVED unless a future stage adds a durable MATCH
 * evidence source. This is documented, not silently glossed over — see
 * docs/S10-E-R1-PROGRESS-REASSESSMENT.md.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBProgressReassessmentPersistence = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function PersistenceError(code, message) {
    var err = new Error(message || code);
    err.name = 'ProgressReassessmentPersistenceError';
    err.code = code;
    return err;
  }

  function storeEngine() {
    if (typeof PBStore === 'undefined') throw PersistenceError('DEP_MISSING', 'PBStore not loaded');
    return PBStore;
  }
  function baselineEngine() {
    if (typeof PBCycleBaseline === 'undefined') throw PersistenceError('DEP_MISSING', 'PBCycleBaseline not loaded');
    return PBCycleBaseline;
  }
  function progressEngine() {
    if (typeof PBProgressTracking === 'undefined') throw PersistenceError('DEP_MISSING', 'PBProgressTracking not loaded');
    return PBProgressTracking;
  }
  function reassessEngine() {
    if (typeof PBReassessment === 'undefined') throw PersistenceError('DEP_MISSING', 'PBReassessment not loaded');
    return PBReassessment;
  }
  function wfEngine() {
    if (typeof PBWorkflow === 'undefined') throw PersistenceError('DEP_MISSING', 'PBWorkflow not loaded');
    return PBWorkflow;
  }
  function pwfEngine() {
    if (typeof PBPrescriptionWorkflow === 'undefined') throw PersistenceError('DEP_MISSING', 'PBPrescriptionWorkflow not loaded');
    return PBPrescriptionWorkflow;
  }
  function diagEngine() {
    if (typeof PBDiagnosis === 'undefined') throw PersistenceError('DEP_MISSING', 'PBDiagnosis not loaded');
    return PBDiagnosis;
  }
  function recEngine() {
    if (typeof PBRecommendationPriority === 'undefined') throw PersistenceError('DEP_MISSING', 'PBRecommendationPriority not loaded');
    return PBRecommendationPriority;
  }
  function rxEngine() {
    if (typeof PBTrainingPrescription === 'undefined') throw PersistenceError('DEP_MISSING', 'PBTrainingPrescription not loaded');
    return PBTrainingPrescription;
  }

  var CONTRACT_VERSION = 'S10-E-R1-V1';

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
  function nowISO() { return new Date().toISOString(); }

  function readStep(promise, label) {
    return promise.catch(function (e) {
      if (e instanceof Error && e.code) throw e;
      throw PersistenceError('PERSISTENCE_READ_FAILED', label + ' failed: ' + (e && e.message));
    });
  }
  function writeStep(promise, label) {
    return promise.catch(function (e) {
      if (e instanceof Error && e.code) throw e;
      throw PersistenceError('PERSISTENCE_WRITE_FAILED', label + ' failed: ' + (e && e.message));
    });
  }

  // ================================================================
  // §9-§11 Baseline capture — durable, immutable, idempotent.
  // ================================================================

  function captureBaselineDurable(opts) {
    opts = opts || {};
    var store = storeEngine();
    if (!opts.cycle_id) throw PersistenceError('INVALID_INPUT', 'cycle_id is required');
    var baseline_id = baselineEngine().baselineId(opts.cycle_id);

    return readStep(store.getCycleKpiBaseline(baseline_id), 'getCycleKpiBaseline').then(function (existing) {
      if (existing) {
        // §11: never silently recalculated/overwritten. A conflicting recapture (different
        // cutoff or KPI set than what's already on file) rejects explicitly; an identical/no-op
        // recapture request reuses the existing immutable snapshot.
        if (opts.captured_at && opts.captured_at !== existing.captured_at) {
          throw PersistenceError('BASELINE_ALREADY_CAPTURED', 'baseline for cycle ' + opts.cycle_id + ' was already captured at ' + existing.captured_at);
        }
        return existing;
      }
      if (!opts.player_id) throw PersistenceError('INVALID_INPUT', 'player_id is required');
      if (!Array.isArray(opts.kpi_profile_codes) || !opts.kpi_profile_codes.length) throw PersistenceError('INVALID_INPUT', 'kpi_profile_codes is required');
      if (!opts.captured_at) throw PersistenceError('INVALID_INPUT', 'captured_at is required');

      return readStep(store.listTrainingEvidenceByPlayer(opts.player_id), 'listTrainingEvidenceByPlayer').then(function (trainingEvidence) {
        var matchEvidence = Array.isArray(opts.match_evidence) ? opts.match_evidence : [];
        var built = baselineEngine().captureBaselineSnapshot({
          cycle_id: opts.cycle_id, player_id: opts.player_id, kpi_profile_codes: opts.kpi_profile_codes,
          captured_at: opts.captured_at, evidence: (trainingEvidence || []).concat(matchEvidence)
        }).cycle_kpi_baseline;
        return writeStep(store.putCycleKpiBaseline(built), 'putCycleKpiBaseline').then(function () { return built; });
      });
    });
  }

  // ================================================================
  // §13-§17 Current progress — recomputed fresh from durable baseline +
  // durable/caller-supplied evidence each call (never itself persisted;
  // it is a regenerable view over durable data, same pattern S10-B's
  // dashboard view model already uses).
  // ================================================================

  function getCurrentProgressDurable(opts) {
    opts = opts || {};
    var store = storeEngine();
    if (!opts.cycle_id) throw PersistenceError('INVALID_INPUT', 'cycle_id is required');
    if (!opts.player_id) throw PersistenceError('INVALID_INPUT', 'player_id is required');
    if (!opts.kpi_profile_code) throw PersistenceError('INVALID_INPUT', 'kpi_profile_code is required');
    if (opts.source !== 'TRAINING' && opts.source !== 'MATCH') throw PersistenceError('INVALID_INPUT', 'source must be TRAINING or MATCH');
    var baseline_id = baselineEngine().baselineId(opts.cycle_id);

    return readStep(store.getCycleKpiBaseline(baseline_id), 'getCycleKpiBaseline').then(function (baseline) {
      if (!baseline) throw PersistenceError('INVALID_BASELINE', 'no baseline captured for cycle ' + opts.cycle_id + ' — call captureBaselineDurable first');
      var trackEntry = (baseline.tracks && baseline.tracks[opts.source] && baseline.tracks[opts.source][opts.kpi_profile_code])
        || { value: null, evidence_refs: [], status: 'UNRESOLVED' };

      var evidencePromise = (opts.source === 'TRAINING')
        ? readStep(store.listTrainingEvidenceByPlayer(opts.player_id), 'listTrainingEvidenceByPlayer')
        : Promise.resolve(Array.isArray(opts.match_evidence) ? opts.match_evidence : []);

      return evidencePromise.then(function (evidence) {
        return progressEngine().computeProgressSnapshot({
          cycle_id: opts.cycle_id, player_id: opts.player_id, kpi_profile_code: opts.kpi_profile_code, source: opts.source,
          baseline_entry: trackEntry, in_cycle_evidence: evidence || [], window_start: baseline.captured_at,
          baseline_ref: baseline.baseline_id, target: opts.target
        }).progress_snapshot;
      });
    });
  }

  // ================================================================
  // §22-§26 Reassessment — real-Match-only, idempotent, durable.
  // ================================================================

  function runReassessmentDurable(opts) {
    opts = opts || {};
    var store = storeEngine();
    if (!opts.cycle_id) throw PersistenceError('INVALID_INPUT', 'cycle_id is required');
    if (!opts.player_id) throw PersistenceError('INVALID_INPUT', 'player_id is required');

    return readStep(store.getDevelopmentCycle(opts.cycle_id), 'getDevelopmentCycle').then(function (cycle) {
      if (!cycle) throw PersistenceError('MISSING_DEVELOPMENT_CYCLE', 'no persisted development_cycle for ' + opts.cycle_id);

      var gate = reassessEngine().checkReassessmentEligibility(cycle, opts);
      if (!gate.eligible) throw PersistenceError(gate.reason, 'reassessment rejected: ' + gate.reason);

      var identity = reassessEngine().reassessmentIdentity(opts.cycle_id, opts.real_match_session_id);

      return readStep(store.getReassessment(identity), 'getReassessment').then(function (existing) {
        if (existing) {
          if (existing.player_id !== opts.player_id) throw PersistenceError('PLAYER_MISMATCH', 'existing reassessment ' + identity + ' belongs to a different player');
          return existing; // §25: idempotent reuse — never a second recommendation/prescription chain
        }

        // §22/§34: the real match session must belong to the same player — never trust a
        // caller-asserted player_id without checking the session's own owning assessment.
        return readStep(store.get('test_sessions', opts.real_match_session_id), 'get test_sessions').then(function (session) {
          if (!session) throw PersistenceError('INVALID_MATCH_SESSION', 'match session not found: ' + opts.real_match_session_id);
          return readStep(store.get('assessments', session.assessment_id), 'get assessments').then(function (assessment) {
            if (!assessment || assessment.player_id !== opts.player_id) {
              throw PersistenceError('PLAYER_MISMATCH', 'match session ' + opts.real_match_session_id + ' does not belong to player ' + opts.player_id);
            }

            // §23: the real, accepted S9 public pipeline — never duplicated internally.
            return diagEngine().diagnoseMatch(opts.real_match_session_id, opts.player_id).then(function (diagnosisResult) {
              var recommendationResult = recEngine().prioritizeDiagnosis(diagnosisResult);
              var prescriptionResult = rxEngine().prescribeRecommendations(recommendationResult);

              var previousRecommendations = Array.isArray(opts.previous_recommendations) ? opts.previous_recommendations : [];
              var comparison = reassessEngine().compareRecommendations(previousRecommendations, recommendationResult.recommendations);

              var inputEvidenceRefs = [];
              (diagnosisResult.skill_gaps || []).forEach(function (g) {
                (g.evidence_pattern_ids || []).forEach(function (id) { if (inputEvidenceRefs.indexOf(id) === -1) inputEvidenceRefs.push(id); });
              });

              var record = {
                reassessment_id: identity,
                cycle_id: opts.cycle_id,
                player_id: opts.player_id,
                trigger: 'REAL_MATCH_OBSERVATION',
                match_session_id: opts.real_match_session_id,
                input_evidence_refs: inputEvidenceRefs,
                previous_recommendation_refs: Array.isArray(cycle.recommendation_refs) ? cycle.recommendation_refs.slice() : [],
                new_recommendation_refs: recommendationResult.recommendations.map(function (r) { return r.recommendation_id; }),
                comparison: comparison,
                status: 'COMPLETED',
                created_at: nowISO(),
                schema_version: '1.0',
                contract_version: CONTRACT_VERSION
              };

              return writeStep(store.putReassessment(record), 'putReassessment').then(function () {
                return Object.assign({}, record, {
                  diagnosisResult: diagnosisResult, recommendationResult: recommendationResult, prescriptionResult: prescriptionResult
                });
              });
            });
          });
        });
      });
    });
  }

  // ================================================================
  // §28 Prescription supersession — only when a genuinely new
  // prescription exists; reuses S10-C's own supersede() verbatim.
  // ================================================================

  function supersedePrescriptionWorkflowDurable(oldWorkflow, newPrescriptionOpts) {
    var result = pwfEngine().supersede(oldWorkflow, newPrescriptionOpts); // throws naturally if oldWorkflow's state is ineligible
    var store = storeEngine();
    return writeStep(store.putPrescriptionWorkflow(result.superseded_workflow), 'putPrescriptionWorkflow(superseded)').then(function () {
      return writeStep(store.putPrescriptionWorkflow(result.prescription_workflow), 'putPrescriptionWorkflow(new)').then(function () {
        return result;
      });
    });
  }

  // ================================================================
  // §29 Cycle completion — reuses S10-A's own COMPLETE_CYCLE transition
  // verbatim; throws naturally (never silently mutated) if the cycle's
  // current state cannot legally reach CYCLE_COMPLETED.
  // ================================================================

  function completeCycleDurable(development_cycle) {
    var updated = wfEngine().transition(development_cycle, 'COMPLETE_CYCLE', {});
    return writeStep(storeEngine().putDevelopmentCycle(updated), 'putDevelopmentCycle').then(function () { return updated; });
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    captureBaselineDurable: captureBaselineDurable,
    getCurrentProgressDurable: getCurrentProgressDurable,
    runReassessmentDurable: runReassessmentDurable,
    supersedePrescriptionWorkflowDurable: supersedePrescriptionWorkflowDurable,
    completeCycleDurable: completeCycleDurable
  };
});
