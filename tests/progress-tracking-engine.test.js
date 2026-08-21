/* tests/progress-tracking-engine.test.js — S10-E-R1: Progress Snapshot
 * Run: node tests/progress-tracking-engine.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

delete require.cache[require.resolve('../js/progress-tracking-engine.js')];
var P = require('../js/progress-tracking-engine.js');

function assertThrows(fn, label, expectedCode) {
  var threw = null;
  try { fn(); } catch (e) { threw = e; }
  assert.ok(threw instanceof Error, label + ' throws an Error');
  if (expectedCode) assert.strictEqual(threw.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + (threw && threw.code) + ')');
}

function ev(overrides) {
  return Object.assign({ evidence_id: 'ev_x', source: 'TRAINING', kpi: 'EXECUTION_SUCCESS_RATE', value: 0.5, player_id: 'p1', timestamp: '2026-02-05T00:00:00.000Z' }, overrides || {});
}
function resolvedBaseline(value) { return { value: value, evidence_refs: ['ev_base'], status: 'RESOLVED' }; }
var UNRESOLVED_BASELINE = { value: null, evidence_refs: [], status: 'UNRESOLVED' };
var WINDOW_START = '2026-02-01T00:00:00.000Z';

function snapshot(overrides) {
  return P.computeProgressSnapshot(Object.assign({
    cycle_id: 'cyc_1', player_id: 'p1', kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'TRAINING',
    baseline_entry: resolvedBaseline(0.58), in_cycle_evidence: [ev({ evidence_id: 'ev1', value: 0.71 })],
    window_start: WINDOW_START, baseline_ref: 'cb:cyc_1'
  }, overrides || {})).progress_snapshot;
}

// 18. current = latest valid in-cycle TRAINING evidence
(function () {
  var s = snapshot({ in_cycle_evidence: [
    ev({ evidence_id: 'ev1', value: 0.6, timestamp: '2026-02-05T00:00:00.000Z' }),
    ev({ evidence_id: 'ev2', value: 0.71, timestamp: '2026-02-10T00:00:00.000Z' })
  ] });
  assert.strictEqual(s.current_value, 0.71);
  assert.strictEqual(s.current_evidence_ref, 'ev2');
  assert.strictEqual(s.evidence_count, 2);
})();

// 19. current = latest valid in-cycle MATCH evidence
(function () {
  var s = snapshot({
    source: 'MATCH',
    in_cycle_evidence: [ev({ evidence_id: 'evm1', source: 'MATCH', value: 0.4, timestamp: '2026-02-05T00:00:00.000Z' }), ev({ evidence_id: 'evm2', source: 'MATCH', value: 0.5, timestamp: '2026-02-06T00:00:00.000Z' })]
  });
  assert.strictEqual(s.current_value, 0.5);
  assert.strictEqual(s.current_evidence_ref, 'evm2');
})();

// 20. prior-cycle evidence excluded (before window_start)
(function () {
  var s = snapshot({ in_cycle_evidence: [
    ev({ evidence_id: 'ev_prior', value: 0.99, timestamp: '2026-01-01T00:00:00.000Z' }), // before window
    ev({ evidence_id: 'ev1', value: 0.71, timestamp: '2026-02-05T00:00:00.000Z' })
  ] });
  assert.strictEqual(s.current_value, 0.71, 'prior-window evidence never selected');
  assert.strictEqual(s.evidence_count, 1);
})();

// 21/22/23. delta math correct
(function () {
  var s = snapshot({ baseline_entry: resolvedBaseline(0.58), in_cycle_evidence: [ev({ evidence_id: 'ev1', value: 0.71 })] });
  assert.strictEqual(s.absolute_delta, 0.13);
  assert.strictEqual(s.percentage_point_delta, 13);
  assert.strictEqual(s.relative_change, 0.2241);
})();

// 24. baseline zero -> relative_change null
(function () {
  var s = snapshot({ baseline_entry: resolvedBaseline(0), in_cycle_evidence: [ev({ evidence_id: 'ev1', value: 0.2 })] });
  assert.strictEqual(s.relative_change, null, 'divide-by-zero never shortcut, always null');
  assert.strictEqual(s.absolute_delta, 0.2, 'absolute_delta and percentage_point_delta still compute normally');
})();

// 25. baseline only -> INSUFFICIENT_DATA (no in-cycle evidence)
(function () {
  var s = snapshot({ in_cycle_evidence: [] });
  assert.strictEqual(s.trend, 'INSUFFICIENT_DATA');
  assert.strictEqual(s.current_value, null);
  assert.strictEqual(s.absolute_delta, null);
})();
// unresolved baseline -> also INSUFFICIENT_DATA even with in-cycle evidence
(function () {
  var s = snapshot({ baseline_entry: UNRESOLVED_BASELINE, in_cycle_evidence: [ev({ evidence_id: 'ev1', value: 0.71 })] });
  assert.strictEqual(s.trend, 'INSUFFICIENT_DATA');
  assert.strictEqual(s.baseline_value, null);
})();

// 26. baseline + one new evidence -> trend allowed (minimum 2-point rule satisfied)
(function () {
  var s = snapshot({ in_cycle_evidence: [ev({ evidence_id: 'ev1', value: 0.71 })] });
  assert.notStrictEqual(s.trend, 'INSUFFICIENT_DATA');
})();

// 27/28/29. trend direction
(function () {
  assert.strictEqual(snapshot({ baseline_entry: resolvedBaseline(0.5), in_cycle_evidence: [ev({ value: 0.6 })] }).trend, 'IMPROVING');
  assert.strictEqual(snapshot({ baseline_entry: resolvedBaseline(0.5), in_cycle_evidence: [ev({ value: 0.5 })] }).trend, 'STABLE');
  assert.strictEqual(snapshot({ baseline_entry: resolvedBaseline(0.5), in_cycle_evidence: [ev({ value: 0.4 })] }).trend, 'DECLINING');
})();

// 30. TRAINING improvement does not imply MATCH improvement
(function () {
  var training = snapshot({ source: 'TRAINING', baseline_entry: resolvedBaseline(0.5), in_cycle_evidence: [ev({ value: 0.7 })] });
  var match = snapshot({ source: 'MATCH', baseline_entry: UNRESOLVED_BASELINE, in_cycle_evidence: [] });
  assert.strictEqual(training.trend, 'IMPROVING');
  assert.strictEqual(match.trend, 'INSUFFICIENT_DATA');
  var status = P.matchTransferStatus(training, match);
  assert.strictEqual(status, 'TRAINING_IMPROVING_MATCH_UNCONFIRMED');
  assert.notStrictEqual(status, 'RESOLVED', 'match transfer status is presentation-only, never a recommendation/promotion decision');
})();
(function () {
  var training = snapshot({ source: 'TRAINING', baseline_entry: resolvedBaseline(0.5), in_cycle_evidence: [ev({ value: 0.7 })] });
  var matchStable = snapshot({ source: 'MATCH', baseline_entry: resolvedBaseline(0.5), in_cycle_evidence: [ev({ source: 'MATCH', value: 0.5 })] });
  assert.strictEqual(P.matchTransferStatus(training, matchStable), 'TRAINING_IMPROVING_MATCH_STABLE');
})();

// 31. unresolved target remains unresolved
(function () {
  var s = snapshot({ target: { status: 'BENCHMARK_NOT_RESOLVED' } });
  assert.strictEqual(s.target_status, 'UNRESOLVED');
  var s2 = snapshot({ target: undefined });
  assert.strictEqual(s2.target_status, 'UNRESOLVED');
})();

// 32. no benchmark invented — resolved target only when explicitly supplied
(function () {
  var below = snapshot({ baseline_entry: resolvedBaseline(0.5), in_cycle_evidence: [ev({ value: 0.6 })], target: { value: 0.8 } });
  var at = snapshot({ baseline_entry: resolvedBaseline(0.5), in_cycle_evidence: [ev({ value: 0.8 })], target: { value: 0.8 } });
  var above = snapshot({ baseline_entry: resolvedBaseline(0.5), in_cycle_evidence: [ev({ value: 0.9 })], target: { value: 0.8 } });
  assert.strictEqual(below.target_status, 'BELOW_TARGET');
  assert.strictEqual(at.target_status, 'AT_TARGET');
  assert.strictEqual(above.target_status, 'ABOVE_TARGET');
})();

// 53 (partial, pure-engine slice). no mixed TRAINING+MATCH aggregation
(function () {
  var mixedEvidence = [ev({ evidence_id: 'evt', source: 'TRAINING', value: 0.9 }), ev({ evidence_id: 'evm', source: 'MATCH', value: 0.1 })];
  var training = snapshot({ source: 'TRAINING', in_cycle_evidence: mixedEvidence });
  assert.strictEqual(training.current_value, 0.9, 'TRAINING snapshot never picks up a MATCH-source value');
  var match = snapshot({ source: 'MATCH', in_cycle_evidence: mixedEvidence });
  assert.strictEqual(match.current_value, 0.1, 'MATCH snapshot never picks up a TRAINING-source value');
})();

// 55 (partial, pure-engine slice). deterministic output
(function () {
  var opts = { cycle_id: 'cyc_det', player_id: 'p1', kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'TRAINING', baseline_entry: resolvedBaseline(0.5), in_cycle_evidence: [ev({ value: 0.6 })], window_start: WINDOW_START, baseline_ref: 'cb:cyc_det' };
  var a = P.computeProgressSnapshot(opts);
  var b = P.computeProgressSnapshot(opts);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
})();

assertThrows(function () { P.computeProgressSnapshot({}); }, 'missing cycle_id', 'INVALID_INPUT');
assertThrows(function () { snapshot({ source: 'BOGUS' }); }, 'invalid source', 'INVALID_INPUT');
assertThrows(function () { P.computeProgressSnapshot({ cycle_id: 'c', player_id: 'p1', kpi_profile_code: 'X', source: 'TRAINING' }); }, 'missing window_start', 'INVALID_INPUT');

// Architecture protection
(function () {
  var src = fs.readFileSync(path.join(__dirname, '../js/progress-tracking-engine.js'), 'utf8');
  var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ['PBStore', 'PBWorkflow', 'PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'PBPrescriptionWorkflow', 'require('].forEach(function (token) {
    assert.ok(stripped.indexOf(token) === -1, 'progress-tracking-engine.js must never reference ' + token);
  });
  ['technical_score', 'capability_score', 'validated_training_level', 'PROMOTED', 'DEMOTED'].forEach(function (token) {
    assert.ok(stripped.indexOf(token) === -1, 'progress-tracking-engine.js must never reference "' + token + '"');
  });
})();

console.log('progress-tracking-engine.test.js: all assertions passed');
