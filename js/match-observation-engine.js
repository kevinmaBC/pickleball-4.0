/* ============================================================
 * match-observation-engine.js — Pickleball App 2.0 Alpha · S9-B
 * Match Observation Engine — MEASUREMENT LAYER ONLY.
 *
 * Converts real-match rally observations (canonical ASMT-10 / legacy
 * alias T10) into structured rally records, sample completeness, and
 * descriptive Full-T10 metrics. Reuses the S9-A storage plumbing
 * (test_sessions + trial_events) exactly — no new store, no DB_VERSION
 * bump, no schema redesign.
 *
 * Frozen boundary (Master Control V2 / S9-B task spec, do not cross):
 *   - This engine NEVER computes/persists match_validation_state,
 *     MET/NOT_MET, validated_training_level, CAP, or Hard Gate pass/fail.
 *     Those remain S9-C's (future) and the existing review-engine's.
 *   - 1 trial_event = 1 observed rally, never 1 shot.
 *   - Legacy T10-lite (assessments.match_transfer, js/assessment.js
 *     saveMatch()) is never read or written here.
 *   - WIN/LOSS context is storable but never enters any metric formula.
 *   - No automatic C1-C4 evidence-rank assignment; observer_role is
 *     provenance only.
 *   - Deterministic, pure-data transforms only: no LLM, no randomness,
 *     no external calls, no hidden judgment — every judgment field
 *     (intent, quality, movement, control_state, adaptation_success,
 *     neutralize_success) must arrive as explicit recorded data.
 *
 * See docs/S9-B-MATCH-OBSERVATION-ENGINE.md for the full field
 * reference and the documented deterministic mapping used for each
 * descriptive metric formula.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBMatchObservation = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function MatchObservationError(code, message) {
    var err = new Error(message || code);
    err.name = 'MatchObservationError';
    err.code = code;
    return err;
  }

  function ns() {
    if (typeof PBNamespace === 'undefined') throw MatchObservationError('DEP_MISSING', 'PBNamespace not loaded');
    return PBNamespace;
  }
  function store() {
    if (typeof PBStore === 'undefined') throw MatchObservationError('DEP_MISSING', 'PBStore not loaded');
    return PBStore;
  }

  function round1(x) { return Math.round(x * 10) / 10; }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v; }

  // ---- Canonical protocol (frozen — reuses S9-A, never a second namespace) ----
  var MATCH_TEST_ID = 'ASMT-10';
  var MATCH_FEED_MODE = 'live_match';

  // ---- Frozen sample plan — mirrors data/test_definitions_v2_3_1.json T10.sample_plan
  // exactly (guarded by tests/match-observation-engine.test.js). Do not diverge here. ----
  var SAMPLE_PLAN = {
    lite:     { min_games: 1, min_rallies: 20 },
    standard: { min_games: 3, min_rallies: 60 },
    full:     { min_games: 5, min_rallies: 100 }
  };

  // ---- Rally-level enums — reuse schemas/rally_event_schema_v2_3_1.json exactly.
  // Do not invent parallel v2 fields, do not rename canonical T10 fields. ----
  var CORE_ENUM = {
    phase:  ['serve', 'return', 'third', 'transition', 'nvz', 'defense', 'finish'],
    intent: ['neutralize', 'pressure', 'attack'],
    shot:   ['serve', 'return', 'drive', 'drop', 'reset', 'dink', 'roll', 'speedup', 'counter', 'volley', 'lob', 'overhead', 'leave'],
    target: ['middle', 'body', 'feet', 'bh', 'fh', 'line', 'cross', 'open_court', 'none'],
    quality:  ['good', 'neutral', 'attackable', 'pop_up', 'error'],
    movement: ['balanced', 'split_ready', 'moving_contact', 'jammed', 'late'],
    result: ['continue', 'weak_reply', 'forced_error_created', 'winner', 'ue', 'opponent_ue', 'transition_lost', 'attack_converted'],
    control_state: ['none', 'neutral', 'pressure', 'attack']
  };
  var CORE_FIELDS = ['phase', 'intent', 'shot', 'target', 'quality', 'movement', 'result'];
  // Eligible-for-rally_control phase set: "reaches at least third-shot/transition phase" (frozen T10 definition).
  var ELIGIBLE_CONTROL_PHASES = ['third', 'transition', 'nvz', 'defense', 'finish'];

  // ---- Match Context enums (S9-B §4) ----
  var MATCH_TYPES = ['REC', 'LEAGUE', 'TOURNAMENT', 'PRACTICE_MATCH'];
  var FORMATS = ['DOUBLES', 'SINGLES'];
  var OBSERVER_ROLES = ['SELF', 'COACH', 'ANALYST'];
  var MATCH_RESULTS = ['WIN', 'LOSS']; // contextual only — never a metric/validation input (§25)
  var MATCH_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  // ================================================================
  // Validation
  // ================================================================

  // Pure function: validates one rally observation payload. No storage access.
  function validateObservation(raw) {
    raw = raw || {};
    var errors = [];

    CORE_FIELDS.forEach(function (f) {
      if (raw[f] == null || CORE_ENUM[f].indexOf(raw[f]) === -1) {
        errors.push(f + ' must be one of: ' + CORE_ENUM[f].join('|'));
      }
    });
    if (raw.control_state == null || CORE_ENUM.control_state.indexOf(raw.control_state) === -1) {
      errors.push('control_state must be one of: ' + CORE_ENUM.control_state.join('|'));
    }

    if (!isInt(raw.game_number) || raw.game_number < 1) errors.push('game_number must be a positive integer (>=1)');
    if (!isInt(raw.rally_number) || raw.rally_number < 1) errors.push('rally_number must be a positive integer (>=1)');

    if (raw.player_score_before != null && (!isInt(raw.player_score_before) || raw.player_score_before < 0)) {
      errors.push('player_score_before must be a non-negative integer when provided');
    }
    if (raw.opponent_score_before != null && (!isInt(raw.opponent_score_before) || raw.opponent_score_before < 0)) {
      errors.push('opponent_score_before must be a non-negative integer when provided');
    }

    if (raw.pattern_id != null && typeof raw.pattern_id !== 'string') errors.push('pattern_id must be a string or null');

    ['adaptation_opportunity', 'adaptation_success', 'neutralize_opportunity', 'neutralize_success'].forEach(function (f) {
      if (raw[f] != null && typeof raw[f] !== 'boolean') errors.push(f + ' must be boolean or null');
    });
    // §8: success cannot be true/present when its opportunity is not explicitly true. Missing stays null, never guessed.
    if (raw.adaptation_success === true && raw.adaptation_opportunity !== true) {
      errors.push('adaptation_success cannot be true when adaptation_opportunity is not true');
    }
    if (raw.neutralize_success === true && raw.neutralize_opportunity !== true) {
      errors.push('neutralize_success cannot be true when neutralize_opportunity is not true');
    }

    return { valid: errors.length === 0, errors: errors };
  }

  // Pure function: validates optional Match Context metadata. No storage access.
  function validateMatchContext(ctx) {
    ctx = ctx || {};
    var errors = [];
    if (ctx.match_type != null && MATCH_TYPES.indexOf(ctx.match_type) === -1) errors.push('match_type must be one of: ' + MATCH_TYPES.join('|'));
    if (ctx.format != null && FORMATS.indexOf(ctx.format) === -1) errors.push('format must be one of: ' + FORMATS.join('|'));
    if (ctx.observer_role != null && OBSERVER_ROLES.indexOf(ctx.observer_role) === -1) errors.push('observer_role must be one of: ' + OBSERVER_ROLES.join('|'));
    if (ctx.match_date != null && !MATCH_DATE_RE.test(ctx.match_date)) errors.push('match_date must be YYYY-MM-DD');
    if (ctx.match_result != null && ctx.match_result.result != null && MATCH_RESULTS.indexOf(ctx.match_result.result) === -1) {
      errors.push('match_result.result must be one of: ' + MATCH_RESULTS.join('|'));
    }
    return { valid: errors.length === 0, errors: errors };
  }

  // ================================================================
  // Session loading / guarding (shared by every storage-touching function)
  // ================================================================

  function loadValidatedSession(session_id) {
    return store().get('test_sessions', session_id).then(function (session) {
      if (!session) return Promise.reject(MatchObservationError('SESSION_NOT_FOUND', 'test_session not found: ' + session_id));
      var canon = ns().toCanonical(session.test_id);
      if (canon !== MATCH_TEST_ID) {
        return Promise.reject(MatchObservationError('NOT_MATCH_SESSION', 'session.test_id must canonicalize to ' + MATCH_TEST_ID + ' (got ' + session.test_id + ')'));
      }
      if (session.feed_mode !== MATCH_FEED_MODE) {
        return Promise.reject(MatchObservationError('NOT_LIVE_MATCH', 'Match Observation requires feed_mode=' + MATCH_FEED_MODE + ' (got ' + session.feed_mode + ')'));
      }
      return session;
    });
  }

  function distinctGameNumbers(rows) {
    var seen = {};
    rows.forEach(function (r) { if (r && r.game_number != null) seen[r.game_number] = true; });
    return Object.keys(seen);
  }

  // ================================================================
  // Session creation (thin validated wrapper around the S9-A storage helper)
  // ================================================================

  function createMatchSession(opts) {
    opts = opts || {};
    var v = validateMatchContext(opts.match_context || {});
    if (!v.valid) return Promise.reject(MatchObservationError('INVALID_MATCH_CONTEXT', v.errors.join('; ')));
    return store().createMatchObservationSession(opts);
  }

  function getMatchContext(session_id) {
    return loadValidatedSession(session_id).then(function (session) {
      var ctx = session.match_context || {};
      return {
        session_id: session_id,
        observer_role: ctx.observer_role || null,
        match_type: ctx.match_type || null,
        format: ctx.format || null,
        opponent_level: (ctx.opponent_level != null ? ctx.opponent_level : null),
        partner_level: (ctx.partner_level != null ? ctx.partner_level : null),
        event_name: ctx.event_name || null,
        match_date: ctx.match_date || null,
        match_result: ctx.match_result || null // contextual only — never consumed by computeMatchMetrics
      };
    });
  }

  // ================================================================
  // Rally capture
  // ================================================================

  function addRallyObservation(session_id, raw) {
    return loadValidatedSession(session_id).then(function () {
      var v = validateObservation(raw);
      if (!v.valid) return Promise.reject(MatchObservationError('INVALID_OBSERVATION', v.errors.join('; ')));

      return store().trialsBySession(session_id).then(function (existing) {
        var dup = existing.some(function (t) {
          var r = t.raw_json || {};
          return r.game_number === raw.game_number && r.rally_number === raw.rally_number;
        });
        if (dup) {
          return Promise.reject(MatchObservationError('DUPLICATE_RALLY',
            'A rally observation already exists for game_number=' + raw.game_number + ' rally_number=' + raw.rally_number));
        }

        // 1 trial_event = 1 observed rally (frozen, §3) — never 1 shot.
        var rawJson = {
          game_number: raw.game_number,
          rally_number: raw.rally_number,
          player_score_before: (raw.player_score_before == null ? null : raw.player_score_before),
          opponent_score_before: (raw.opponent_score_before == null ? null : raw.opponent_score_before),
          phase: raw.phase, intent: raw.intent, shot: raw.shot, target: raw.target,
          quality: raw.quality, movement: raw.movement, result: raw.result,
          pattern_id: (raw.pattern_id == null ? null : raw.pattern_id),
          adaptation_opportunity: (raw.adaptation_opportunity == null ? null : raw.adaptation_opportunity),
          adaptation_success: (raw.adaptation_success == null ? null : raw.adaptation_success),
          neutralize_opportunity: (raw.neutralize_opportunity == null ? null : raw.neutralize_opportunity),
          neutralize_success: (raw.neutralize_success == null ? null : raw.neutralize_success),
          control_state: raw.control_state
        };

        return store().addTrialEvent({
          test_session_id: session_id,
          trial_no: existing.length + 1,
          scenario_id: null,
          // S/P/F/I ball-quality outcome does not apply to Full-T10 rally coding (which uses
          // `result`, not S/P/F/I) — left null rather than inventing an unrequested mapping;
          // score_weight stays null too, so this row is inert to the existing S/P/F/I scoring
          // path in js/metrics.js (never contributes to any quality_pct/sample_target there).
          outcome: null,
          score_weight: null,
          raw_json: rawJson,
          review_flag: !!raw.review_flag,
          video_timestamp_ms: (raw.video_timestamp_ms == null ? null : raw.video_timestamp_ms)
        });
      });
    });
  }

  // ================================================================
  // Sample completeness
  // ================================================================

  function getObservationCompleteness(session_id) {
    return loadValidatedSession(session_id).then(function (session) {
      return store().trialsBySession(session_id).then(function (trials) {
        var rows = trials.map(function (t) { return t.raw_json || {}; });
        var games = distinctGameNumbers(rows);
        var tier = session.assessment_tier;
        var target = (tier && SAMPLE_PLAN[tier]) ? SAMPLE_PLAN[tier] : null;
        // sample_complete means only "minimum sample quantity satisfied" — never Match Validation MET (§13).
        var complete = target ? (games.length >= target.min_games && rows.length >= target.min_rallies) : null;
        return {
          session_id: session_id,
          assessment_tier: (tier || null),
          games_observed: games.length,
          rallies_observed: rows.length,
          sample_target: target,
          sample_complete: complete
        };
      });
    });
  }

  // ================================================================
  // Descriptive Full-T10 metrics — deterministic, documented mapping.
  // No match_transfer_score, no MET/NOT_MET, no CAP, no Hard Gate decision.
  // See docs/S9-B-MATCH-OBSERVATION-ENGINE.md for the rationale behind
  // every denominator/numerator choice below.
  // ================================================================

  function computeMatchMetrics(session_id) {
    return loadValidatedSession(session_id).then(function () {
      return store().trialsBySession(session_id).then(function (trials) {
        var rows = trials.map(function (t) { return t.raw_json || {}; });
        var gamesObserved = distinctGameNumbers(rows).length;
        var ralliesObserved = rows.length;

        // ue_per_game = total_ue / games (§18)
        var totalUE = rows.filter(function (r) { return r.result === 'ue'; }).length;
        var ue_per_game = gamesObserved > 0 ? round1(totalUE / gamesObserved) : null;

        // match_decision_pct (§16): decision_opportunities = every coded rally (quality is
        // always coded on a persisted rally); correct_match_decisions = quality in {good, neutral}
        // — the narrowest reading of "the decision did not produce an error/attackable-for-opponent
        // outcome," using only the explicit `quality` field, no invented decision-correctness field.
        var correctDecisions = rows.filter(function (r) { return r.quality === 'good' || r.quality === 'neutral'; }).length;
        var match_decision_pct = ralliesObserved > 0 ? round1(correctDecisions / ralliesObserved * 100) : null;

        // match_transition_pct (§17): transition_opportunities = phase === 'transition';
        // success = NOT explicitly coded as failed (`result` !== 'transition_lost') and not a
        // self-inflicted error (`result` !== 'ue'). Never inferred from rally win/loss.
        var transitionRows = rows.filter(function (r) { return r.phase === 'transition'; });
        var transitionSuccess = transitionRows.filter(function (r) { return r.result !== 'transition_lost' && r.result !== 'ue'; }).length;
        var match_transition_pct = transitionRows.length > 0 ? round1(transitionSuccess / transitionRows.length * 100) : null;

        // attack_conversion_pct (§19): attack_opportunities = intent === 'attack';
        // successful_attack_conversions = result === 'attack_converted' (explicit enum value).
        var attackRows = rows.filter(function (r) { return r.intent === 'attack'; });
        var attackSuccess = attackRows.filter(function (r) { return r.result === 'attack_converted'; }).length;
        var attack_conversion_pct = attackRows.length > 0 ? round1(attackSuccess / attackRows.length * 100) : null;

        // pattern_success_pct (§20): pattern_attempts = pattern_id != null;
        // successful_pattern_attempts = quality === 'good'.
        var patternRows = rows.filter(function (r) { return r.pattern_id != null; });
        var patternSuccess = patternRows.filter(function (r) { return r.quality === 'good'; }).length;
        var pattern_success_pct = patternRows.length > 0 ? round1(patternSuccess / patternRows.length * 100) : null;

        // wrong_attack_pct (§21): attack_decision_opportunities = intent === 'attack' (same
        // population as attack_conversion_pct); wrong_attack_attempts = quality in {error, pop_up}
        // — an attack decision that produced an implementation mistake or a gift pop-up, not
        // every lost attack.
        var wrongAttacks = attackRows.filter(function (r) { return r.quality === 'error' || r.quality === 'pop_up'; }).length;
        var wrong_attack_pct = attackRows.length > 0 ? round1(wrongAttacks / attackRows.length * 100) : null;

        // rally_control_pct (§22): eligible_rallies = phase reaches at least third-shot/transition
        // (phase in ELIGIBLE_CONTROL_PHASES). The frozen definition's exact ">=2 consecutive
        // opponent contacts" cannot be proven at rally-level granularity (1 trial_event = 1 rally,
        // not 1 shot) — per §22 this must return null rather than fabricate, UNLESS the observation
        // includes explicit control_state coding sufficient to support the result. We use exactly
        // that: rallies_with_intended_state_control = eligible rallies coded control_state in
        // {pressure, attack} (the observer's own coded judgment of the rally's final control state).
        var eligibleRows = rows.filter(function (r) { return ELIGIBLE_CONTROL_PHASES.indexOf(r.phase) !== -1; });
        var controlled = eligibleRows.filter(function (r) { return r.control_state === 'pressure' || r.control_state === 'attack'; }).length;
        var rally_control_pct = eligibleRows.length > 0 ? round1(controlled / eligibleRows.length * 100) : null;

        // pattern_adaptation_pct (§23): uses only explicit adaptation_opportunity/adaptation_success.
        var adaptOpp = rows.filter(function (r) { return r.adaptation_opportunity === true; });
        var adaptSuccess = adaptOpp.filter(function (r) { return r.adaptation_success === true; }).length;
        var pattern_adaptation_pct = adaptOpp.length > 0 ? round1(adaptSuccess / adaptOpp.length * 100) : null;

        // neutralize_under_pressure_pct (§24): uses only explicit neutralize_opportunity/neutralize_success.
        var neutOpp = rows.filter(function (r) { return r.neutralize_opportunity === true; });
        var neutSuccess = neutOpp.filter(function (r) { return r.neutralize_success === true; }).length;
        var neutralize_under_pressure_pct = neutOpp.length > 0 ? round1(neutSuccess / neutOpp.length * 100) : null;

        return {
          session_id: session_id,
          games_observed: gamesObserved,
          rallies_observed: ralliesObserved,
          match_decision_pct: match_decision_pct,
          match_transition_pct: match_transition_pct,
          ue_per_game: ue_per_game,
          attack_conversion_pct: attack_conversion_pct,
          pattern_success_pct: pattern_success_pct,
          wrong_attack_pct: wrong_attack_pct,
          rally_control_pct: rally_control_pct,
          pattern_adaptation_pct: pattern_adaptation_pct,
          neutralize_under_pressure_pct: neutralize_under_pressure_pct,
          note: 'Descriptive Full-T10 metrics only (S9-B measurement layer). No match_transfer_score, ' +
                'no match_validation_state/MET/NOT_MET, no CAP input, no Hard Gate pass/fail. ' +
                'See docs/S9-B-MATCH-OBSERVATION-ENGINE.md for the exact deterministic mapping used per formula.'
        };
      });
    });
  }

  return {
    MATCH_TEST_ID: MATCH_TEST_ID,
    MATCH_FEED_MODE: MATCH_FEED_MODE,
    SAMPLE_PLAN: JSON.parse(JSON.stringify(SAMPLE_PLAN)),
    CORE_ENUM: JSON.parse(JSON.stringify(CORE_ENUM)),

    validateObservation: validateObservation,
    validateMatchContext: validateMatchContext,
    createMatchSession: createMatchSession,
    getMatchContext: getMatchContext,
    addRallyObservation: addRallyObservation,
    computeMatchMetrics: computeMatchMetrics,
    getObservationCompleteness: getObservationCompleteness
  };
});
