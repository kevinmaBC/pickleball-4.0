/* ============================================================
 * reassessment-engine.js — Pickleball App 2.0 Alpha · S10-E-R1
 * Reassessment Gate + Recommendation Comparison — PURE DECISION LOGIC.
 *
 * Answers "is this cycle eligible for reassessment right now" and
 * "how does the new S9 recommendation set compare to the old one" —
 * never "what should the new recommendation be" (that stays S9's job,
 * invoked only by js/progress-reassessment-persistence.js, never here).
 *
 * This file has ZERO runtime dependency on ANY other engine, including
 * PBWorkflow/PBDiagnosis/PBRecommendationPriority/PBTrainingPrescription/
 * PBStore — it never requires/reads any of their globals. It only
 * accepts already-computed plain objects (a development_cycle-shaped
 * object, Recommendation arrays) from the caller. This is the
 * strongest available proof that this file implements no S9
 * recommendation/priority mapping and no S10-A state-transition logic
 * of its own — it structurally cannot, since it never even reaches the
 * code that would compute either.
 *
 * Frozen boundary (do not cross):
 *   - Eligibility's primary/strongest source of truth is
 *     development_cycle.state === 'REASSESSMENT_READY' (§24) — this
 *     file reads that field, never recomputes or second-guesses it.
 *   - Reassessment identity is deterministic: cycle_id + real match
 *     session id, never a random id (§25) — a second call with the
 *     same two inputs always yields the same identity string.
 *   - Recommendation comparison never calculates a new priority score/
 *     rank/tier — REPRIORITIZED only means "the same recommendation
 *     identity is present in both sets, but its already-computed
 *     upstream priority fields differ" (§27).
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBReassessment = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function ReassessmentError(code, message) {
    var err = new Error(message || code);
    err.name = 'ReassessmentError';
    err.code = code;
    return err;
  }

  var CONTRACT_VERSION = 'S10-E-R1-V1';

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }

  // ================================================================
  // §18/§24 Reassessment Gate.
  // ================================================================

  function checkReassessmentEligibility(development_cycle, opts) {
    opts = opts || {};
    if (!isPlainObject(development_cycle)) return { eligible: false, reason: 'MISSING_DEVELOPMENT_CYCLE' };
    if (development_cycle.state !== 'REASSESSMENT_READY') return { eligible: false, reason: 'REASSESSMENT_NOT_READY' };
    if (!opts.real_match_session_id) return { eligible: false, reason: 'INVALID_MATCH_SESSION' };
    return { eligible: true, reason: 'DEVELOPMENT_CYCLE_REASSESSMENT_READY' };
  }

  // ================================================================
  // §25 Deterministic reassessment identity.
  // ================================================================

  function reassessmentIdentity(cycle_id, match_session_id) {
    if (!cycle_id || !match_session_id) throw ReassessmentError('INVALID_INPUT', 'cycle_id and match_session_id are both required');
    return 're:' + cycle_id + ':' + match_session_id;
  }

  // ================================================================
  // §27 Recommendation Comparison. Identity spans matches (recommendation
  // objects carry a match-specific recommendation_id, so raw ids can never
  // line up across two different matches) — the same underlying
  // recommendation lineage is identified by recommendation_code + skill +
  // context, exactly the fields S9-E's own identityKey() already uses
  // minus match_id/player_id (which are expected to legitimately change
  // between the old and new match).
  // ================================================================

  function recIdentity(r) {
    return [r.recommendation_code, r.skill, r.context].map(function (v) { return v == null ? '-' : String(v); }).join('|');
  }

  function compareRecommendations(previousRecommendations, newRecommendations) {
    var prev = Array.isArray(previousRecommendations) ? previousRecommendations : [];
    var next = Array.isArray(newRecommendations) ? newRecommendations : [];

    var prevByIdentity = {}, nextByIdentity = {};
    prev.forEach(function (r) { if (isPlainObject(r)) prevByIdentity[recIdentity(r)] = r; });
    next.forEach(function (r) { if (isPlainObject(r)) nextByIdentity[recIdentity(r)] = r; });

    var identities = {};
    Object.keys(prevByIdentity).forEach(function (id) { identities[id] = true; });
    Object.keys(nextByIdentity).forEach(function (id) { identities[id] = true; });

    var results = Object.keys(identities).sort().map(function (id) {
      var o = prevByIdentity[id], n = nextByIdentity[id];
      var status;
      if (o && !n) status = 'RESOLVED';
      else if (!o && n) status = 'NEW';
      else {
        // §27: REPRIORITIZED reflects only an upstream S9 change (rank/score/tier) — never
        // recomputed here, only compared.
        var changed = o.rank !== n.rank || o.priority_score !== n.priority_score || o.priority_tier !== n.priority_tier;
        status = changed ? 'REPRIORITIZED' : 'UNCHANGED';
      }
      return {
        identity: id,
        status: status,
        previous_recommendation_id: o ? o.recommendation_id : null,
        new_recommendation_id: n ? n.recommendation_id : null,
        previous_priority: o ? { rank: o.rank, priority_score: o.priority_score, priority_tier: o.priority_tier } : null,
        new_priority: n ? { rank: n.rank, priority_score: n.priority_score, priority_tier: n.priority_tier } : null
      };
    });

    return results;
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    checkReassessmentEligibility: checkReassessmentEligibility,
    reassessmentIdentity: reassessmentIdentity,
    compareRecommendations: compareRecommendations
  };
});
