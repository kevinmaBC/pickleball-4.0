/* tests/cycle-baseline-engine.test.js — S10-E-R1: Cycle KPI Baseline Snapshot
 * Run: node tests/cycle-baseline-engine.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

delete require.cache[require.resolve('../js/cycle-baseline-engine.js')];
var B = require('../js/cycle-baseline-engine.js');

function assertThrows(fn, label, expectedCode) {
  var threw = null;
  try { fn(); } catch (e) { threw = e; }
  assert.ok(threw instanceof Error, label + ' throws an Error');
  if (expectedCode) assert.strictEqual(threw.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + (threw && threw.code) + ')');
}

function ev(overrides) {
  return Object.assign({ evidence_id: 'ev_x', source: 'TRAINING', kpi: 'EXECUTION_SUCCESS_RATE', value: 0.5, player_id: 'p1', timestamp: '2026-01-01T00:00:00.000Z' }, overrides || {});
}

// 8. valid pre-cycle TRAINING baseline captured
(function () {
  var out = B.captureBaselineSnapshot({
    cycle_id: 'cyc_1', player_id: 'p1', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z',
    evidence: [ev({ evidence_id: 'ev1', source: 'TRAINING', value: 0.58, timestamp: '2026-01-15T00:00:00.000Z' })]
  }).cycle_kpi_baseline;
  assert.strictEqual(out.baseline_id, 'cb:cyc_1');
  assert.strictEqual(out.tracks.TRAINING.EXECUTION_SUCCESS_RATE.value, 0.58);
  assert.strictEqual(out.tracks.TRAINING.EXECUTION_SUCCESS_RATE.status, 'RESOLVED');
  assert.deepStrictEqual(out.tracks.TRAINING.EXECUTION_SUCCESS_RATE.evidence_refs, ['ev1']);
})();

// 9. valid pre-cycle MATCH baseline captured
(function () {
  var out = B.captureBaselineSnapshot({
    cycle_id: 'cyc_1', player_id: 'p1', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z',
    evidence: [ev({ evidence_id: 'ev1', source: 'MATCH', value: 0.61, timestamp: '2026-01-15T00:00:00.000Z' })]
  }).cycle_kpi_baseline;
  assert.strictEqual(out.tracks.MATCH.EXECUTION_SUCCESS_RATE.value, 0.61);
  assert.strictEqual(out.tracks.MATCH.EXECUTION_SUCCESS_RATE.status, 'RESOLVED');
})();

// 10. tracks remain separate
(function () {
  var out = B.captureBaselineSnapshot({
    cycle_id: 'cyc_1', player_id: 'p1', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z',
    evidence: [
      ev({ evidence_id: 'ev1', source: 'TRAINING', value: 0.58, timestamp: '2026-01-15T00:00:00.000Z' }),
      ev({ evidence_id: 'ev2', source: 'MATCH', value: 0.61, timestamp: '2026-01-16T00:00:00.000Z' })
    ]
  }).cycle_kpi_baseline;
  assert.strictEqual(out.tracks.TRAINING.EXECUTION_SUCCESS_RATE.value, 0.58);
  assert.strictEqual(out.tracks.MATCH.EXECUTION_SUCCESS_RATE.value, 0.61);
  assert.notDeepStrictEqual(out.tracks.TRAINING, out.tracks.MATCH);
})();

// 11. exact KPI matching enforced
(function () {
  var out = B.captureBaselineSnapshot({
    cycle_id: 'cyc_1', player_id: 'p1', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z',
    evidence: [ev({ evidence_id: 'ev1', kpi: 'execution_success_rate', value: 0.9, timestamp: '2026-01-15T00:00:00.000Z' })] // wrong case, not exact
  }).cycle_kpi_baseline;
  assert.strictEqual(out.tracks.TRAINING.EXECUTION_SUCCESS_RATE.status, 'UNRESOLVED', 'case-mismatched kpi never approximately matches');
})();

// 12. incompatible KPI remains UNRESOLVED (S7/S8 vocabulary never approximately mapped)
(function () {
  var out = B.captureBaselineSnapshot({
    cycle_id: 'cyc_1', player_id: 'p1', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z',
    evidence: [ev({ evidence_id: 'ev1', kpi: 'technical_score', value: 82, timestamp: '2026-01-15T00:00:00.000Z' })]
  }).cycle_kpi_baseline;
  assert.strictEqual(out.tracks.TRAINING.EXECUTION_SUCCESS_RATE.status, 'UNRESOLVED');
  assert.strictEqual(out.tracks.TRAINING.EXECUTION_SUCCESS_RATE.value, null);
})();

// 13. missing baseline remains UNRESOLVED (no evidence at all)
(function () {
  var out = B.captureBaselineSnapshot({
    cycle_id: 'cyc_1', player_id: 'p1', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z', evidence: []
  }).cycle_kpi_baseline;
  assert.strictEqual(out.tracks.TRAINING.EXECUTION_SUCCESS_RATE.status, 'UNRESOLVED');
  assert.deepStrictEqual(out.tracks.TRAINING.EXECUTION_SUCCESS_RATE.evidence_refs, []);
})();

// 14. cross-player evidence rejected (never contributes)
(function () {
  var out = B.captureBaselineSnapshot({
    cycle_id: 'cyc_1', player_id: 'p1', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z',
    evidence: [ev({ evidence_id: 'ev1', player_id: 'p_other', value: 0.99, timestamp: '2026-01-15T00:00:00.000Z' })]
  }).cycle_kpi_baseline;
  assert.strictEqual(out.tracks.TRAINING.EXECUTION_SUCCESS_RATE.status, 'UNRESOLVED', 'evidence belonging to a different player never contributes');
})();

// 17. post-start Training Evidence cannot backfill baseline (at/after cutoff excluded)
(function () {
  var out = B.captureBaselineSnapshot({
    cycle_id: 'cyc_1', player_id: 'p1', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z',
    evidence: [
      ev({ evidence_id: 'ev_at_cutoff', value: 0.9, timestamp: '2026-02-01T00:00:00.000Z' }), // exactly at cutoff
      ev({ evidence_id: 'ev_after', value: 0.95, timestamp: '2026-02-02T00:00:00.000Z' })      // after cutoff
    ]
  }).cycle_kpi_baseline;
  assert.strictEqual(out.tracks.TRAINING.EXECUTION_SUCCESS_RATE.status, 'UNRESOLVED', 'at-or-after-cutoff evidence never backfills baseline');
})();

// latest-value selection among multiple valid pre-cutoff points (deterministic tie-break)
(function () {
  var out = B.captureBaselineSnapshot({
    cycle_id: 'cyc_1', player_id: 'p1', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z',
    evidence: [
      ev({ evidence_id: 'ev_early', value: 0.4, timestamp: '2026-01-01T00:00:00.000Z' }),
      ev({ evidence_id: 'ev_late', value: 0.55, timestamp: '2026-01-20T00:00:00.000Z' })
    ]
  }).cycle_kpi_baseline;
  var entry = out.tracks.TRAINING.EXECUTION_SUCCESS_RATE;
  assert.strictEqual(entry.value, 0.55, 'baseline uses the latest valid pre-cutoff value, not mean/median/first');
  assert.deepStrictEqual(entry.evidence_refs, ['ev_early', 'ev_late'].sort());
})();

// 55 (partial, pure-engine slice). deterministic output
(function () {
  var input = { cycle_id: 'cyc_det', player_id: 'p1', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z', evidence: [ev({ evidence_id: 'ev1', value: 0.5, timestamp: '2026-01-01T00:00:00.000Z' })] };
  var a = B.captureBaselineSnapshot(input);
  var b = B.captureBaselineSnapshot(input);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
})();

assertThrows(function () { B.captureBaselineSnapshot({}); }, 'missing cycle_id', 'INVALID_INPUT');
assertThrows(function () { B.captureBaselineSnapshot({ cycle_id: 'c', player_id: 'p1', kpi_profile_codes: [], captured_at: '2026-01-01T00:00:00.000Z' }); }, 'empty kpi_profile_codes', 'INVALID_INPUT');
assertThrows(function () { B.captureBaselineSnapshot({ cycle_id: 'c', player_id: 'p1', kpi_profile_codes: ['X'] }); }, 'missing captured_at', 'INVALID_INPUT');

// Architecture protection: zero dependency on any other engine/storage.
(function () {
  var src = fs.readFileSync(path.join(__dirname, '../js/cycle-baseline-engine.js'), 'utf8');
  var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ['PBStore', 'PBWorkflow', 'PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'PBPrescriptionWorkflow', 'require('].forEach(function (token) {
    assert.ok(stripped.indexOf(token) === -1, 'cycle-baseline-engine.js must never reference ' + token);
  });
  ['technical_score', 'capability_score', 'reset_ball_quality_pct', 'validated_training_level'].forEach(function (token) {
    assert.ok(stripped.indexOf(token) === -1, 'cycle-baseline-engine.js must never reference S7/S8 vocabulary "' + token + '"');
  });
})();

console.log('cycle-baseline-engine.test.js: all assertions passed');
