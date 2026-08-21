/* ============================================================
 * progress-tracking-engine.js — Pickleball App 2.0 Alpha · S10-E-R1
 * Progress Snapshot — TRAINING/MATCH PROGRESS SOURCE OF TRUTH.
 *
 * Consumes an immutable Cycle KPI Baseline Snapshot track entry (from
 * js/cycle-baseline-engine.js) plus in-cycle evidence and produces one
 * Progress Snapshot per (cycle, kpi_profile_code, source) — TRAINING
 * and MATCH are always computed and returned independently; this file
 * never combines them into one mixed-source number (Rule 4).
 *
 * This file has ZERO runtime dependency on any other engine or on
 * js/storage.js — pure functions over plain objects the caller
 * supplies.
 *
 * Frozen boundary (do not cross):
 *   - Current KPI = the latest valid in-cycle evidence value (by
 *     timestamp, evidence_id as a stable tie-breaker) — never mean/
 *     median/weighted-mean/EMA/best-value (§14, same "latest value"
 *     methodology js/cycle-baseline-engine.js and js/trend-engine.js
 *     both already use).
 *   - Minimum trend rule: a resolved baseline PLUS at least one valid
 *     in-cycle evidence point (§16) — fewer than that always yields
 *     'INSUFFICIENT_DATA', never a guessed direction.
 *   - For 0-1 ratio KPI values: absolute_delta > 0 -> IMPROVING, < 0 ->
 *     DECLINING, === 0 -> STABLE. No band/tolerance (§17) — this is
 *     the same "band = 0 for non-0-100-scale metrics" rule
 *     js/trend-engine.js's own classifyTrend() already documents as
 *     its fallback for metrics outside the 0-100 CAP-score scale.
 *   - relative_change is null (never a divide-by-zero shortcut) when
 *     baseline_value is exactly 0.
 *   - percentage_point_delta is never confused with relative_change —
 *     both are always computed and returned as distinct fields.
 *   - No benchmark is ever invented: target_status is 'UNRESOLVED'
 *     whenever no accepted numeric target is supplied.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBProgressTracking = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function ProgressError(code, message) {
    var err = new Error(message || code);
    err.name = 'ProgressTrackingError';
    err.code = code;
    return err;
  }

  var CONTRACT_VERSION = 'S10-E-R1-V1';
  var SCHEMA_VERSION = '1.0';

  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
  function isFiniteNumber(v) { return typeof v === 'number' && isFinite(v); }
  function round(n, decimals) { var f = Math.pow(10, decimals); return Math.round(n * f) / f; }

  function selectLatest(entries) {
    var sorted = entries.slice().sort(function (a, b) {
      var ta = Date.parse(a.timestamp), tb = Date.parse(b.timestamp);
      if (ta !== tb) return ta - tb;
      return String(a.evidence_id) < String(b.evidence_id) ? -1 : (String(a.evidence_id) > String(b.evidence_id) ? 1 : 0);
    });
    return sorted[sorted.length - 1];
  }

  function isValidInCycleEvidence(e, source, kpi_profile_code, player_id, windowStartMs) {
    if (!isPlainObject(e)) return false;
    if (e.source !== source) return false;
    if (e.kpi !== kpi_profile_code) return false;
    if (e.player_id !== player_id) return false;
    if (!isFiniteNumber(e.value)) return false;
    if (e.evidence_id == null || e.timestamp == null) return false;
    var t = Date.parse(e.timestamp);
    if (isNaN(t)) return false;
    return t >= windowStartMs; // §15: only evidence at/after baseline capture
  }

  function computeTargetStatus(target, current_value) {
    if (!isPlainObject(target)) return 'UNRESOLVED';
    if (target.status === 'BENCHMARK_NOT_RESOLVED') return 'UNRESOLVED';
    if (!isFiniteNumber(target.value) || current_value == null) return 'UNRESOLVED';
    if (current_value > target.value) return 'ABOVE_TARGET';
    if (current_value < target.value) return 'BELOW_TARGET';
    return 'AT_TARGET';
  }

  // ================================================================
  // §20 Public pure entry point — one call per (cycle, kpi, source).
  // ================================================================

  function computeProgressSnapshot(opts) {
    opts = opts || {};
    if (!isPlainObject(opts)) throw ProgressError('INVALID_INPUT', 'opts must be an object');
    if (!opts.cycle_id) throw ProgressError('INVALID_INPUT', 'cycle_id is required');
    if (!opts.player_id) throw ProgressError('INVALID_INPUT', 'player_id is required');
    if (!opts.kpi_profile_code) throw ProgressError('INVALID_INPUT', 'kpi_profile_code is required');
    if (opts.source !== 'TRAINING' && opts.source !== 'MATCH') throw ProgressError('INVALID_INPUT', 'source must be TRAINING or MATCH');
    if (!opts.window_start) throw ProgressError('INVALID_INPUT', 'window_start is required');
    var windowStartMs = Date.parse(opts.window_start);
    if (isNaN(windowStartMs)) throw ProgressError('INVALID_INPUT', 'window_start must be a valid ISO 8601 timestamp');

    var baselineEntry = isPlainObject(opts.baseline_entry) ? opts.baseline_entry : { value: null, evidence_refs: [], status: 'UNRESOLVED' };
    var baselineResolved = baselineEntry.status === 'RESOLVED' && isFiniteNumber(baselineEntry.value);
    var baseline_value = baselineResolved ? baselineEntry.value : null;

    var evidence = Array.isArray(opts.in_cycle_evidence) ? opts.in_cycle_evidence : [];
    var matches = evidence.filter(function (e) { return isValidInCycleEvidence(e, opts.source, opts.kpi_profile_code, opts.player_id, windowStartMs); });
    var current_value = null, current_evidence_ref = null;
    if (matches.length) {
      var latest = selectLatest(matches);
      current_value = latest.value;
      current_evidence_ref = latest.evidence_id;
    }

    // §16 minimum trend rule: resolved baseline + at least one valid in-cycle point.
    var canCompute = baselineResolved && matches.length >= 1;
    var absolute_delta = null, percentage_point_delta = null, relative_change = null, trend = 'INSUFFICIENT_DATA';
    if (canCompute) {
      absolute_delta = round(current_value - baseline_value, 4);
      percentage_point_delta = round(absolute_delta * 100, 2);
      relative_change = (baseline_value === 0) ? null : round(absolute_delta / baseline_value, 4);
      trend = absolute_delta > 0 ? 'IMPROVING' : (absolute_delta < 0 ? 'DECLINING' : 'STABLE');
    }

    return {
      progress_snapshot: {
        progress_id: 'pg:' + opts.cycle_id + ':' + opts.source + ':' + opts.kpi_profile_code,
        cycle_id: opts.cycle_id,
        player_id: opts.player_id,
        kpi_profile_code: opts.kpi_profile_code,
        source: opts.source,

        baseline_value: baseline_value,
        current_value: current_value,

        absolute_delta: absolute_delta,
        percentage_point_delta: percentage_point_delta,
        relative_change: relative_change,

        evidence_count: matches.length,
        trend: trend,
        target_status: computeTargetStatus(opts.target, current_value),

        baseline_ref: opts.baseline_ref != null ? opts.baseline_ref : null,
        current_evidence_ref: current_evidence_ref,

        schema_version: SCHEMA_VERSION,
        contract_version: CONTRACT_VERSION
      }
    };
  }

  // ================================================================
  // §17/§21 Match Transfer Status — a derived, presentation-safe
  // comparison of two independent Progress Snapshots. Never resolves a
  // recommendation, promotes a level, or alters priority.
  // ================================================================

  function matchTransferStatus(trainingSnapshot, matchSnapshot) {
    var t = (trainingSnapshot && trainingSnapshot.trend) || 'INSUFFICIENT_DATA';
    var m = (matchSnapshot && matchSnapshot.trend) || 'INSUFFICIENT_DATA';

    if (t === 'INSUFFICIENT_DATA' && m === 'INSUFFICIENT_DATA') return 'INSUFFICIENT_DATA';
    if (t === 'IMPROVING' && m === 'INSUFFICIENT_DATA') return 'TRAINING_IMPROVING_MATCH_UNCONFIRMED';
    if (t === 'IMPROVING' && m === 'STABLE') return 'TRAINING_IMPROVING_MATCH_STABLE';
    if (t === 'IMPROVING' && m === 'DECLINING') return 'TRAINING_IMPROVING_MATCH_DECLINING';
    if (t === 'IMPROVING' && m === 'IMPROVING') return 'TRAINING_IMPROVING_MATCH_IMPROVING';
    if (m === 'IMPROVING') return 'MATCH_IMPROVING';
    if (t === 'INSUFFICIENT_DATA') return 'MATCH_' + m + '_TRAINING_UNCONFIRMED';
    if (m === 'INSUFFICIENT_DATA') return 'TRAINING_' + t + '_MATCH_UNCONFIRMED';
    return 'TRAINING_' + t + '_MATCH_' + m;
  }

  return {
    CONTRACT_VERSION: CONTRACT_VERSION,
    SCHEMA_VERSION: SCHEMA_VERSION,
    computeProgressSnapshot: computeProgressSnapshot,
    matchTransferStatus: matchTransferStatus
  };
});
