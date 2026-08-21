/* ============================================================
 * cycle-baseline-engine.js — Pickleball App 2.0 Alpha · S10-E-R1
 * Cycle KPI Baseline Snapshot — IMMUTABLE BASELINE SOURCE OF TRUTH.
 *
 * Captures, once, the pre-cycle-training value of each tracked KPI for
 * a Development Cycle, kept strictly separate by evidence source track
 * (TRAINING vs. MATCH — Rule 4: tracks never share one baseline).
 * Baseline must be captured from evidence that existed BEFORE cycle
 * training began (Rule 1); nothing computed here ever mutates once
 * built — immutability itself is an orchestration/persistence concern
 * (see js/progress-reassessment-persistence.js), this file only
 * guarantees that a fresh capture over the same inputs always produces
 * the same output (pure, deterministic).
 *
 * This file has ZERO runtime dependency on any other engine or on
 * js/storage.js — it only accepts already-fetched evidence records
 * (plain objects) from the caller and projects them into a baseline
 * snapshot; it never queries storage, never calls PBWorkflow/
 * PBSessionEvidence/any S9 engine.
 *
 * Frozen boundary (do not cross):
 *   - No approximate/inferred KPI mapping. Evidence only contributes to
 *     a track's baseline when evidence.kpi === the target
 *     kpi_profile_code EXACTLY (Rule/§12 "exact KPI compatibility") —
 *     never technical_score/capability_score/hard-gate *_pct or any
 *     other S7/S8 vocabulary.
 *   - Evidence at or after the capture cutoff never contributes (Rule
 *     2: post-start evidence must never backfill baseline).
 *   - Evidence belonging to a different player never contributes.
 *   - No compatible evidence for a track -> status: 'UNRESOLVED',
 *     value: null, evidence_refs: [] — never a fabricated number.
 *   - Baseline value selection reuses the same "latest valid value"
 *     methodology js/trend-engine.js (S7-C, accepted) and
 *     js/progress-tracking-engine.js (S10-E-R1) both use for
 *     current-value aggregation — never mean/median/weighted-mean/EMA.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBCycleBaseline = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function BaselineError(code, message) {
    var err = new Error(message || code);
    err.name = 'CycleBaselineError';
    err.code = code;
    return err;
  }

  var CONTRACT_VERSION = 'S10-E-R1-V1';
  var SCHEMA_VERSION = '1.0';
  var TRACKS = ['TRAINING', 'MATCH'];

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
  function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }

  function baselineId(cycle_id) { return 'cb:' + cycle_id; }

  // §14-adjacent: deterministic "latest valid value" selection — sort by timestamp ascending,
  // evidence_id as a stable secondary tie-breaker, take the last (most recent) entry.
  function selectLatest(entries) {
    var sorted = entries.slice().sort(function (a, b) {
      var ta = Date.parse(a.timestamp), tb = Date.parse(b.timestamp);
      if (ta !== tb) return ta - tb;
      return String(a.evidence_id) < String(b.evidence_id) ? -1 : (String(a.evidence_id) > String(b.evidence_id) ? 1 : 0);
    });
    return sorted[sorted.length - 1];
  }

  function isValidPreCutoffEvidence(e, track, kpi_profile_code, player_id, cutoffMs) {
    if (!isPlainObject(e)) return false;
    if (e.source !== track) return false;
    if (e.kpi !== kpi_profile_code) return false; // §12: exact match only, never approximate
    if (e.player_id !== player_id) return false;  // never cross-player
    if (!isFiniteNumber(e.value)) return false;
    if (e.evidence_id == null || e.timestamp == null) return false;
    var t = Date.parse(e.timestamp);
    if (isNaN(t)) return false;
    return t < cutoffMs; // strictly before the cutoff — never at/after (Rule 2)
  }

  function buildTrackEntry(evidence, track, kpi_profile_code, player_id, cutoffMs) {
    var matches = (evidence || []).filter(function (e) { return isValidPreCutoffEvidence(e, track, kpi_profile_code, player_id, cutoffMs); });
    if (!matches.length) {
      return { value: null, evidence_refs: [], status: 'UNRESOLVED' };
    }
    var latest = selectLatest(matches);
    var refs = matches.map(function (m) { return m.evidence_id; }).sort();
    return { value: latest.value, evidence_refs: refs, status: 'RESOLVED' };
  }

  // ================================================================
  // §6 Public pure entry point — one snapshot per cycle, covering every
  // requested kpi_profile_code across both tracks in a single object.
  // ================================================================

  function captureBaselineSnapshot(opts) {
    opts = opts || {};
    if (!isPlainObject(opts)) throw BaselineError('INVALID_INPUT', 'opts must be an object');
    if (!opts.cycle_id) throw BaselineError('INVALID_INPUT', 'cycle_id is required');
    if (!opts.player_id) throw BaselineError('INVALID_INPUT', 'player_id is required');
    if (!Array.isArray(opts.kpi_profile_codes) || !opts.kpi_profile_codes.length) {
      throw BaselineError('INVALID_INPUT', 'kpi_profile_codes must be a non-empty array');
    }
    if (!opts.captured_at) throw BaselineError('INVALID_INPUT', 'captured_at is required');
    var cutoffMs = Date.parse(opts.captured_at);
    if (isNaN(cutoffMs)) throw BaselineError('INVALID_INPUT', 'captured_at must be a valid ISO 8601 timestamp');
    var evidence = Array.isArray(opts.evidence) ? opts.evidence : [];

    var tracks = {};
    TRACKS.forEach(function (track) {
      tracks[track] = {};
      opts.kpi_profile_codes.forEach(function (kpi) {
        tracks[track][kpi] = buildTrackEntry(evidence, track, kpi, opts.player_id, cutoffMs);
      });
    });

    return {
      cycle_kpi_baseline: {
        baseline_id: baselineId(opts.cycle_id),
        cycle_id: opts.cycle_id,
        player_id: opts.player_id,
        captured_at: opts.captured_at,
        tracks: tracks,
        schema_version: SCHEMA_VERSION,
        contract_version: CONTRACT_VERSION
      }
    };
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    TRACKS: TRACKS.slice(),
    baselineId: baselineId,
    captureBaselineSnapshot: captureBaselineSnapshot
  };
});
