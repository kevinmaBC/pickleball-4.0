/* tests/reassessment-engine.test.js — S10-E-R1: Reassessment Gate +
 * Recommendation Comparison
 * Run: node tests/reassessment-engine.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

delete require.cache[require.resolve('../js/reassessment-engine.js')];
var R = require('../js/reassessment-engine.js');

function assertThrows(fn, label, expectedCode) {
  var threw = null;
  try { fn(); } catch (e) { threw = e; }
  assert.ok(threw instanceof Error, label + ' throws an Error');
  if (expectedCode) assert.strictEqual(threw.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + (threw && threw.code) + ')');
}

function rec(overrides) {
  return Object.assign({ recommendation_id: 'rec_x', recommendation_code: 'IMPROVE_SHOT_EXECUTION', skill: 'drop', context: null, rank: 1, priority_score: 70, priority_tier: 'HIGH' }, overrides || {});
}

// ================================================================
// Gate
// ================================================================

// 20 (from S10-E core carry-forward, re-verified here). REASSESSMENT_READY permits reassessment
(function () {
  var cycle = { state: 'REASSESSMENT_READY' };
  var gate = R.checkReassessmentEligibility(cycle, { real_match_session_id: 'mses_1' });
  assert.strictEqual(gate.eligible, true);
  assert.strictEqual(gate.reason, 'DEVELOPMENT_CYCLE_REASSESSMENT_READY');
})();

// 33. non-REASSESSMENT_READY cycle rejected
(function () {
  ['BASELINE_READY', 'ACTIVE', 'PRESCRIPTION_READY', 'PROGRESS_RECORDED'].forEach(function (state) {
    var gate = R.checkReassessmentEligibility({ state: state }, { real_match_session_id: 'mses_1' });
    assert.strictEqual(gate.eligible, false);
    assert.strictEqual(gate.reason, 'REASSESSMENT_NOT_READY');
  });
})();
(function () {
  var gate = R.checkReassessmentEligibility({ state: 'REASSESSMENT_READY' }, {});
  assert.strictEqual(gate.eligible, false);
  assert.strictEqual(gate.reason, 'INVALID_MATCH_SESSION', 'missing real_match_session_id rejects even when the cycle is ready');
})();
(function () {
  var gate = R.checkReassessmentEligibility(null, { real_match_session_id: 'mses_1' });
  assert.strictEqual(gate.eligible, false);
  assert.strictEqual(gate.reason, 'MISSING_DEVELOPMENT_CYCLE');
})();

// ================================================================
// Identity
// ================================================================

// 40. deterministic reassessment_id
(function () {
  var id1 = R.reassessmentIdentity('cyc_1', 'mses_1');
  var id2 = R.reassessmentIdentity('cyc_1', 'mses_1');
  assert.strictEqual(id1, id2);
  assert.strictEqual(id1, 're:cyc_1:mses_1');
  assert.notStrictEqual(R.reassessmentIdentity('cyc_1', 'mses_2'), id1);
})();
assertThrows(function () { R.reassessmentIdentity(null, 'mses_1'); }, 'missing cycle_id', 'INVALID_INPUT');

// ================================================================
// Comparison
// ================================================================

// 44. UNCHANGED comparison correct
(function () {
  var oldRec = rec({ recommendation_id: 'rec_old', rank: 1, priority_score: 70, priority_tier: 'HIGH' });
  var newRec = rec({ recommendation_id: 'rec_new', rank: 1, priority_score: 70, priority_tier: 'HIGH' });
  var results = R.compareRecommendations([oldRec], [newRec]);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].status, 'UNCHANGED');
  assert.strictEqual(results[0].previous_recommendation_id, 'rec_old');
  assert.strictEqual(results[0].new_recommendation_id, 'rec_new');
})();

// 45. NEW comparison correct
(function () {
  var newRec = rec({ recommendation_id: 'rec_new', recommendation_code: 'IMPROVE_SHOT_CONTROL', skill: 'reset' });
  var results = R.compareRecommendations([], [newRec]);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].status, 'NEW');
  assert.strictEqual(results[0].previous_recommendation_id, null);
})();

// 46. RESOLVED comparison correct
(function () {
  var oldRec = rec({ recommendation_id: 'rec_old' });
  var results = R.compareRecommendations([oldRec], []);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].status, 'RESOLVED');
  assert.strictEqual(results[0].new_recommendation_id, null);
})();

// 47. REPRIORITIZED reflects upstream S9 rank/tier change only
(function () {
  var oldRec = rec({ recommendation_id: 'rec_old', rank: 2, priority_score: 45, priority_tier: 'MEDIUM' });
  var newRec = rec({ recommendation_id: 'rec_new', rank: 1, priority_score: 78, priority_tier: 'HIGH' });
  var results = R.compareRecommendations([oldRec], [newRec]);
  assert.strictEqual(results[0].status, 'REPRIORITIZED');
  assert.deepStrictEqual(results[0].previous_priority, { rank: 2, priority_score: 45, priority_tier: 'MEDIUM' });
  assert.deepStrictEqual(results[0].new_priority, { rank: 1, priority_score: 78, priority_tier: 'HIGH' });
})();
// same identity, same priority fields -> UNCHANGED, not REPRIORITIZED (proves it's not always-REPRIORITIZED)
(function () {
  var oldRec = rec({ recommendation_id: 'rec_old_m1' });
  var newRec = rec({ recommendation_id: 'rec_new_m2' }); // different match, same code/skill/context/priority
  var results = R.compareRecommendations([oldRec], [newRec]);
  assert.strictEqual(results[0].status, 'UNCHANGED', 'identity across different match_id/recommendation_id, same priority -> UNCHANGED');
})();

// mixed batch: UNCHANGED + NEW + RESOLVED + REPRIORITIZED together, deterministic order
(function () {
  var old = [
    rec({ recommendation_id: 'r1', recommendation_code: 'IMPROVE_SHOT_EXECUTION', skill: 'drop', rank: 1, priority_score: 70, priority_tier: 'HIGH' }),
    rec({ recommendation_id: 'r2', recommendation_code: 'IMPROVE_SHOT_CONTROL', skill: 'reset', rank: 2, priority_score: 50, priority_tier: 'MEDIUM' }),
    rec({ recommendation_id: 'r3', recommendation_code: 'IMPROVE_SHOT_SELECTION', skill: 'third_shot', rank: 3, priority_score: 30, priority_tier: 'LOW' })
  ];
  var next = [
    rec({ recommendation_id: 'r1b', recommendation_code: 'IMPROVE_SHOT_EXECUTION', skill: 'drop', rank: 1, priority_score: 70, priority_tier: 'HIGH' }), // UNCHANGED
    rec({ recommendation_id: 'r2b', recommendation_code: 'IMPROVE_SHOT_CONTROL', skill: 'reset', rank: 1, priority_score: 80, priority_tier: 'HIGH' }),  // REPRIORITIZED
    rec({ recommendation_id: 'r4', recommendation_code: 'IMPROVE_TRANSITION_EXECUTION', skill: 'transition', rank: 3, priority_score: 40, priority_tier: 'LOW' }) // NEW
    // r3 (IMPROVE_SHOT_SELECTION/third_shot) absent -> RESOLVED
  ];
  var results = R.compareRecommendations(old, next);
  var byIdentity = {};
  results.forEach(function (r) { byIdentity[r.identity] = r.status; });
  assert.strictEqual(byIdentity['IMPROVE_SHOT_EXECUTION|drop|-'], 'UNCHANGED');
  assert.strictEqual(byIdentity['IMPROVE_SHOT_CONTROL|reset|-'], 'REPRIORITIZED');
  assert.strictEqual(byIdentity['IMPROVE_SHOT_SELECTION|third_shot|-'], 'RESOLVED');
  assert.strictEqual(byIdentity['IMPROVE_TRANSITION_EXECUTION|transition|-'], 'NEW');
  assert.strictEqual(results.length, 4);
})();

// malformed input degrades safely
(function () {
  var results = R.compareRecommendations(null, undefined);
  assert.deepStrictEqual(results, []);
})();

// 55 (partial, pure-engine slice). deterministic output
(function () {
  var old = [rec({ recommendation_id: 'r1' })];
  var next = [rec({ recommendation_id: 'r2', rank: 2 })];
  assert.strictEqual(JSON.stringify(R.compareRecommendations(old, next)), JSON.stringify(R.compareRecommendations(old, next)));
})();

// Architecture protection: no S9 recommendation/priority formula, zero coupling
(function () {
  var src = fs.readFileSync(path.join(__dirname, '../js/reassessment-engine.js'), 'utf8');
  var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ['PBStore', 'PBWorkflow', 'PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'PBPrescriptionWorkflow', 'PBDashboard', 'require(', 'PBCycleBaseline', 'PBProgressTracking'].forEach(function (token) {
    assert.ok(stripped.indexOf(token) === -1, 'reassessment-engine.js must never reference ' + token);
  });
  ['DIAGNOSIS_TO_RECOMMENDATION', 'PRIORITY_TIER_THRESHOLDS', 'RECOMMENDATION_TO_PRESCRIPTION', '0.60 *', '0.40 *'].forEach(function (token) {
    assert.ok(stripped.indexOf(token) === -1, 'reassessment-engine.js must never contain S9 mapping/formula token "' + token + '"');
  });
})();

console.log('reassessment-engine.test.js: all assertions passed');
