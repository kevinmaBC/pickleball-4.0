/* ============================================================
 * assessment-journey-bridge.js — Pickleball App 2.0 Alpha · POST-S11-R3B-2
 * Assessment -> Journey Integration Bridge — READ-SIDE ONLY.
 *
 * Answers "does this player have assessment evidence, how complete is
 * it, and can Journey/HOME point to it?" by reading the existing
 * Assessment Data Core (js/storage.js: players / assessments /
 * test_sessions / trial_events) and the existing, unmodified Readiness
 * Preview engine (js/preview.js — PBPreview.forAssessment, itself
 * calling js/metrics.js — PBMetrics.computeAssessment), then projecting
 * a single normalized Assessment Context object.
 *
 * Frozen boundary (do not cross):
 *   - READ -> NORMALIZE -> PROJECT only. Never writes to any store
 *     (no PBStore.put/createPlayer/createAssessment/del/create* calls).
 *   - Never calls PBPreview's internals directly or reimplements gate
 *     comparison — it only reads PBPreview.forAssessment()'s own
 *     already-computed tally/rows verbatim (no recalculation).
 *   - Never creates a development_cycle, never writes
 *     validated_training_level, never calls the S9 decision pipeline
 *     (diagnosis/recommendation-priority/training-prescription) or any
 *     S10 workflow/session-evidence/progress/reassessment engine — this
 *     file has zero runtime dependency on any of them.
 *   - `recommendation_eligible` is a structural evidence-completeness
 *     signal only ("has enough evidence been collected to be considered
 *     downstream") — it is NOT a recommendation, NOT a rating, and NOT
 *     a re-run of the Recommendation/Priority Engine.
 *   - `assessment_status` distinguishes NO_ASSESSMENT from
 *     ASSESSMENT_IN_PROGRESS/ASSESSMENT_EVIDENCE_READY — an incomplete
 *     assessment is never reported as if no assessment exists.
 *   - Player identity is always player_id (assessment.player_id FK);
 *     display_name is never used to join/select records.
 *
 * See POST-S11-R3B-2 implementation package for the full field
 * reference and the UAT-R3 acceptance scenario this module resolves.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBAssessmentJourneyBridge = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function BridgeError(code, message) {
    var err = new Error(message || code);
    err.name = 'AssessmentJourneyBridgeError';
    err.code = code;
    return err;
  }

  var CONTRACT_VERSION = 'POST-S11-R3B-2-V1';
  var SCHEMA_VERSION = '1.0';

  var ASSESSMENT_STATUS = ['NO_ASSESSMENT', 'ASSESSMENT_IN_PROGRESS', 'ASSESSMENT_EVIDENCE_READY'];
  var EVIDENCE_STATUS = ['NONE', 'PARTIAL', 'SUFFICIENT'];
  var READINESS_DATA_STATUS = ['NOT_AVAILABLE', 'AVAILABLE'];

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

  // ================================================================
  // Pure — deterministic latest-assessment selection (B2-02). Sorted by
  // created_at descending; assessment_id is an explicit tie-break so two
  // assessments created in the same millisecond still resolve to exactly
  // one deterministic winner (never "first in store-iteration order").
  // player_id is never consulted here — the caller already scoped the
  // input array by assessment.player_id (B2-01).
  // ================================================================
  function pickLatestAssessment(assessments) {
    if (!Array.isArray(assessments) || !assessments.length) return null;
    var sorted = assessments.slice().sort(function (a, b) {
      var ac = (a && a.created_at) || '', bc = (b && b.created_at) || '';
      if (ac !== bc) return ac < bc ? 1 : -1;
      var aid = (a && a.assessment_id) || '', bid = (b && b.assessment_id) || '';
      return aid < bid ? 1 : (aid > bid ? -1 : 0);
    });
    return sorted[0];
  }

  // ================================================================
  // Pure — evidence lineage pointers (B2-04 T01-T09 test sessions,
  // B2-05 T10 match evidence). Pointers only (test_session_id /
  // assessment_id references) — never a copy of the underlying
  // trial_events/assessment records. SSOT stays exactly where
  // js/storage.js already puts it.
  // ================================================================
  function buildEvidenceRefs(assessment, sessions, trialCountsBySessionId) {
    var refs = [];
    (sessions || []).forEach(function (s) {
      if (!isPlainObject(s)) return;
      refs.push({
        type: 'test_session',
        test_id: s.test_id,
        test_session_id: s.test_session_id,
        feed_mode: s.feed_mode != null ? s.feed_mode : null,
        trial_count: (trialCountsBySessionId && trialCountsBySessionId[s.test_session_id] != null)
          ? trialCountsBySessionId[s.test_session_id] : 0
      });
    });
    if (assessment && (assessment.ue || assessment.match_transfer)) {
      refs.push({ type: 'match_evidence', assessment_id: assessment.assessment_id, source: 'T10_lite' });
    }
    return refs;
  }

  // ================================================================
  // Pure — classifies evidence completeness from PBPreview.forAssessment()'s
  // own already-computed tally (B2-06: consumed verbatim, never
  // recalculated here). No pass/fail judgment is made — "SUFFICIENT" means
  // evidence collection is complete enough for every comparable gate to
  // have a real sample, not that any threshold was met.
  // ================================================================
  function classifyEvidence(previewResult) {
    if (!previewResult || previewResult.unsupported) {
      return { evidence_status: 'NONE', readiness_data_status: 'NOT_AVAILABLE' };
    }
    var t = previewResult.tally || {};
    var comparable = t.total || 0;
    if (!comparable) return { evidence_status: 'NONE', readiness_data_status: 'AVAILABLE' };
    var recorded = comparable - (t.no_data || 0) - (t.not_captured || 0);
    var gaps = (t.no_data || 0) + (t.sample_short || 0);
    var evidence_status;
    if (recorded <= 0) evidence_status = 'NONE';
    else if (gaps === 0) evidence_status = 'SUFFICIENT';
    else evidence_status = 'PARTIAL';
    return { evidence_status: evidence_status, readiness_data_status: 'AVAILABLE' };
  }

  // ================================================================
  // Pure composer — combines an assessment record + its evidence refs +
  // the existing Readiness Preview output into one Assessment Context
  // projection. Never computes a rating, never decides a recommendation,
  // never writes validated_training_level.
  // ================================================================
  function composeAssessmentContext(opts) {
    opts = opts || {};
    if (opts.player_id == null) throw BridgeError('INVALID_INPUT', 'player_id is required');
    var player_id = opts.player_id;
    var assessment = isPlainObject(opts.assessment) ? opts.assessment : null;

    if (!assessment) {
      return {
        player_id: player_id,
        assessment_id: null, assessment_tier: null, target_training_level: null,
        assessment_status: 'NO_ASSESSMENT', assessment_exists: false,
        evidence_status: 'NONE', readiness_data_status: 'NOT_AVAILABLE',
        traceability_available: false, recommendation_eligible: false,
        evidence_refs: [], flags: [],
        schema_version: SCHEMA_VERSION, contract_version: CONTRACT_VERSION
      };
    }

    var evidenceRefs = Array.isArray(opts.evidence_refs) ? opts.evidence_refs : [];
    var cls = classifyEvidence(opts.preview || null);
    var assessmentStatus = cls.evidence_status === 'SUFFICIENT' ? 'ASSESSMENT_EVIDENCE_READY' : 'ASSESSMENT_IN_PROGRESS';
    var flags = [];
    if (assessmentStatus === 'ASSESSMENT_IN_PROGRESS') flags.push('EVIDENCE_INCOMPLETE');
    if (cls.readiness_data_status === 'NOT_AVAILABLE') flags.push('READINESS_PREVIEW_UNAVAILABLE');

    return {
      player_id: player_id,
      assessment_id: assessment.assessment_id,
      assessment_tier: assessment.assessment_tier != null ? assessment.assessment_tier : null,
      target_training_level: assessment.target_training_level != null ? assessment.target_training_level : null,
      assessment_status: assessmentStatus,
      assessment_exists: true,
      evidence_status: cls.evidence_status,
      readiness_data_status: cls.readiness_data_status,
      traceability_available: evidenceRefs.length > 0,
      recommendation_eligible: assessmentStatus === 'ASSESSMENT_EVIDENCE_READY',
      evidence_refs: evidenceRefs,
      flags: flags,
      schema_version: SCHEMA_VERSION, contract_version: CONTRACT_VERSION
    };
  }

  // ================================================================
  // IO orchestration (browser-only). READ existing SSOT (players /
  // assessments / test_sessions / trial_events via PBStore) and the
  // existing Readiness engine (PBPreview) — NORMALIZE — PROJECT. Every
  // call below is a read; nothing is ever put()/created/deleted.
  // ================================================================
  function storeEngine() {
    if (typeof PBStore === 'undefined') throw BridgeError('DEP_MISSING', 'PBStore not loaded');
    return PBStore;
  }
  function previewEngine() {
    if (typeof PBPreview === 'undefined') throw BridgeError('DEP_MISSING', 'PBPreview not loaded');
    return PBPreview;
  }
  function ioEnginesReady() {
    return typeof PBStore !== 'undefined' && typeof PBPreview !== 'undefined';
  }

  function loadAssessmentContext(player_id) {
    if (!ioEnginesReady()) return Promise.reject(BridgeError('DEP_MISSING', 'required modules not loaded'));
    if (player_id == null) return Promise.reject(BridgeError('INVALID_INPUT', 'player_id is required'));

    var store = storeEngine();
    // Identity contract (B2-01): selection is scoped strictly by assessment.player_id via the
    // existing by_player index — never by display_name.
    return store.assessmentsByPlayer(player_id).then(function (assessments) {
      var assessment = pickLatestAssessment(assessments || []);
      if (!assessment) return composeAssessmentContext({ player_id: player_id, assessment: null });

      return store.sessionsByAssessment(assessment.assessment_id).then(function (sessions) {
        sessions = sessions || [];
        return Promise.all(sessions.map(function (s) { return store.trialsBySession(s.test_session_id); }))
          .then(function (trialArrays) {
            var trialCountsBySessionId = {};
            sessions.forEach(function (s, i) { trialCountsBySessionId[s.test_session_id] = (trialArrays[i] || []).length; });
            var evidenceRefs = buildEvidenceRefs(assessment, sessions, trialCountsBySessionId);

            return previewEngine().forAssessment(assessment.assessment_id)
              .then(function (preview) {
                return composeAssessmentContext({ player_id: player_id, assessment: assessment, evidence_refs: evidenceRefs, preview: preview });
              })
              .catch(function () {
                // Readiness Preview is best-effort context here (e.g. no gate table yet for this
                // target level) — its absence must never hide that the assessment/evidence exist.
                return composeAssessmentContext({ player_id: player_id, assessment: assessment, evidence_refs: evidenceRefs, preview: null });
              });
          });
      });
    });
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    ASSESSMENT_STATUS: ASSESSMENT_STATUS.slice(),
    EVIDENCE_STATUS: EVIDENCE_STATUS.slice(),
    READINESS_DATA_STATUS: READINESS_DATA_STATUS.slice(),

    // pure (Node-testable, no DOM/PBStore/PBPreview/fetch)
    pickLatestAssessment: pickLatestAssessment,
    buildEvidenceRefs: buildEvidenceRefs,
    classifyEvidence: classifyEvidence,
    composeAssessmentContext: composeAssessmentContext,

    // IO orchestration (browser-only)
    loadAssessmentContext: loadAssessmentContext
  };
});
