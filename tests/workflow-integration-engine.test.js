/* tests/workflow-integration-engine.test.js — S10-A: Product Workflow
 * Integration Layer
 * Run: node tests/workflow-integration-engine.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

delete require.cache[require.resolve('../js/workflow-integration-engine.js')];
var WF = require('../js/workflow-integration-engine.js');

function assertThrows(fn, label, expectedCode) {
  var threw = null;
  try { fn(); } catch (e) { threw = e; }
  assert.ok(threw instanceof Error, label + ' throws an Error');
  if (expectedCode) assert.strictEqual(threw.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + (threw && threw.code) + ')');
}

function newCycle(overrides) {
  var c = WF.createDevelopmentCycle(Object.assign({ player_id: 'p1', baseline_ref: 'asm_1' }, overrides || {})).development_cycle;
  return c;
}

// ================================================================
// Contract
// ================================================================

// 1. valid development cycle creation
(function () {
  var result = WF.createDevelopmentCycle({ player_id: 'p1', baseline_ref: 'asm_1' });
  assert.ok(result.development_cycle, 'wraps development_cycle');
  var c = result.development_cycle;
  assert.ok(c.cycle_id, 'cycle_id generated');
  assert.strictEqual(c.state, 'BASELINE_READY', 'initial state is BASELINE_READY');
  assert.deepStrictEqual(c.evidence_refs, [], 'evidence_refs starts empty');
  assert.deepStrictEqual(c.recommendation_refs, [], 'recommendation_refs starts empty');
  assert.strictEqual(c.priority_ref, null, 'priority_ref starts null');
  assert.deepStrictEqual(c.prescription_refs, [], 'prescription_refs starts empty');
  assert.deepStrictEqual(c.training_session_refs, [], 'training_session_refs starts empty');
  assert.deepStrictEqual(c.progress_evidence_refs, [], 'progress_evidence_refs starts empty');
  assert.strictEqual(c.reassessment_ref, null, 'reassessment_ref starts null');
})();

// 2. schema/version presence
(function () {
  var c = newCycle();
  assert.strictEqual(c.schema_version, '1.0', 'schema_version is 1.0');
  assert.strictEqual(WF.WORKFLOW_CONTRACT_VERSION, 'S10-A-V1', 'contract version is frozen S10-A-V1');
})();

// 3. domain references preserved
(function () {
  var c = newCycle({ player_id: 'plr_42', baseline_ref: 'asm_99' });
  assert.strictEqual(c.player_id, 'plr_42', 'player_id preserved verbatim');
  assert.strictEqual(c.baseline_ref, 'asm_99', 'baseline_ref preserved verbatim');
})();

assertThrows(function () { WF.createDevelopmentCycle({ baseline_ref: 'asm_1' }); }, 'createDevelopmentCycle missing player_id', 'INVALID_INPUT');
assertThrows(function () { WF.createDevelopmentCycle({ player_id: 'p1' }); }, 'createDevelopmentCycle missing baseline_ref', 'INVALID_INPUT');

// ================================================================
// State
// ================================================================

// 4. valid state progression (full happy path)
(function () {
  var c = newCycle();
  c = WF.transition(c, 'ADD_EVIDENCE', { evidence_ref: 'ev_1' });
  assert.strictEqual(c.state, 'EVIDENCE_AVAILABLE');
  c = WF.transition(c, 'GENERATE_RECOMMENDATION', { recommendation_refs: ['rec_1'], priority_ref: 'pri_1' });
  assert.strictEqual(c.state, 'RECOMMENDATION_READY');
  assert.deepStrictEqual(c.recommendation_refs, ['rec_1']);
  assert.strictEqual(c.priority_ref, 'pri_1');
  c = WF.transition(c, 'GENERATE_PRESCRIPTION', { prescription_refs: ['rx_1'] });
  assert.strictEqual(c.state, 'PRESCRIPTION_READY');
  c = WF.transition(c, 'START_TRAINING', {});
  assert.strictEqual(c.state, 'TRAINING_ACTIVE');
  c = WF.transition(c, 'COMPLETE_SESSION', { training_session_ref: 'tse_1', completed: true });
  assert.strictEqual(c.state, 'SESSION_COMPLETED');
  c = WF.transition(c, 'RECORD_PROGRESS', { progress_ref: 'prog_1' });
  assert.strictEqual(c.state, 'PROGRESS_RECORDED');
  c = WF.transition(c, 'COMPLETE_CYCLE', {});
  assert.strictEqual(c.state, 'CYCLE_COMPLETED');
})();

// 5. invalid transition rejected (skip straight from BASELINE_READY to prescription)
(function () {
  var c = newCycle();
  assertThrows(function () { WF.transition(c, 'GENERATE_PRESCRIPTION', { prescription_refs: ['rx_1'] }); },
    'GENERATE_PRESCRIPTION from BASELINE_READY', 'INVALID_INPUT');
})();

// 6. missing evidence rejected where required
(function () {
  var c = newCycle();
  c = Object.assign({}, c, { state: 'EVIDENCE_AVAILABLE' }); // edge-case: reached without evidence
  assertThrows(function () { WF.transition(c, 'GENERATE_RECOMMENDATION', { recommendation_refs: ['rec_1'] }); },
    'GENERATE_RECOMMENDATION with no evidence_refs', 'INSUFFICIENT_EVIDENCE');
})();

// 7. missing recommendation rejected where required
(function () {
  var c = newCycle();
  c = Object.assign({}, c, { state: 'RECOMMENDATION_READY', evidence_refs: ['ev_1'] }); // no recommendation_refs
  assertThrows(function () { WF.transition(c, 'GENERATE_PRESCRIPTION', { prescription_refs: ['rx_1'] }); },
    'GENERATE_PRESCRIPTION with no recommendation_refs', 'STALE_RECOMMENDATION');
})();

// 8. missing prescription rejected where required
(function () {
  var c = newCycle();
  c = Object.assign({}, c, { state: 'TRAINING_ACTIVE', evidence_refs: ['ev_1'], recommendation_refs: ['rec_1'] }); // no prescription_refs
  assertThrows(function () { WF.transition(c, 'COMPLETE_SESSION', { training_session_ref: 'tse_1', completed: true }); },
    'COMPLETE_SESSION with no prescription_refs', 'PRESCRIPTION_UNAVAILABLE');
  assertThrows(function () { WF.transition(Object.assign({}, c, { state: 'PRESCRIPTION_READY' }), 'START_TRAINING', {}); },
    'START_TRAINING with no prescription_refs', 'PRESCRIPTION_UNAVAILABLE');
})();

// Rule 5: New Match Evidence -> Reassessment eligibility = allow
(function () {
  var c = newCycle();
  c = WF.transition(c, 'ADD_EVIDENCE', { evidence_ref: 'ev_1' });
  c = WF.transition(c, 'GENERATE_RECOMMENDATION', { recommendation_refs: ['rec_1'] });
  c = WF.transition(c, 'GENERATE_PRESCRIPTION', { prescription_refs: ['rx_1'] });
  c = WF.transition(c, 'START_TRAINING', {});
  c = WF.transition(c, 'COMPLETE_SESSION', { training_session_ref: 'tse_1', completed: true });
  c = WF.transition(c, 'RECORD_PROGRESS', { progress_ref: 'prog_1' });
  // new match evidence arrives after the cycle already progressed
  c = WF.transition(c, 'ADD_EVIDENCE', { evidence_ref: 'ev_2' });
  assert.strictEqual(c.state, 'REASSESSMENT_READY', 'new evidence makes the cycle reassessment-eligible');
  // recommendation/prescription refs are untouched, not overwritten
  assert.deepStrictEqual(c.recommendation_refs, ['rec_1']);
  assert.deepStrictEqual(c.prescription_refs, ['rx_1']);
  // attempting to complete the cycle while reassessment is pending is rejected
  assertThrows(function () { WF.transition(c, 'COMPLETE_CYCLE', {}); }, 'COMPLETE_CYCLE while REASSESSMENT_READY', 'REASSESSMENT_REQUIRED');
  // looping back through GENERATE_RECOMMENDATION resolves it
  c = WF.transition(c, 'GENERATE_RECOMMENDATION', { recommendation_refs: ['rec_2'] });
  assert.strictEqual(c.state, 'RECOMMENDATION_READY');
  c = WF.transition(c, 'GENERATE_PRESCRIPTION', { prescription_refs: ['rx_2'] });
  assert.strictEqual(c.state, 'PRESCRIPTION_READY', 'prescription can be regenerated once recommendation is current again');
})();

// unknown action / unknown state are also explicit, testable rejections (no silent failure)
assertThrows(function () { WF.transition(newCycle(), 'DO_SOMETHING_UNKNOWN', {}); }, 'unknown action', 'INVALID_INPUT');
assertThrows(function () { WF.transition(Object.assign({}, newCycle(), { state: 'NOT_A_REAL_STATE' }), 'ADD_EVIDENCE', { evidence_ref: 'ev_1' }); }, 'unknown state', 'INVALID_INPUT');

// ================================================================
// Evidence
// ================================================================

// 9. MATCH evidence accepted
(function () {
  var e = WF.createEvidence({ source: 'MATCH', skill: 'drop', value: 0.62, context: 'match_1', confidence: 78 });
  assert.strictEqual(e.source, 'MATCH');
  assert.ok(e.evidence_id);
  assert.ok(e.timestamp);
})();

// 10. TRAINING evidence accepted
(function () {
  var e = WF.createEvidence({ source: 'TRAINING', kpi: 'EXECUTION_SUCCESS_RATE', value: 0.8 });
  assert.strictEqual(e.source, 'TRAINING');
})();

// 11. COACH evidence accepted
(function () {
  var e = WF.createEvidence({ source: 'COACH', skill: 'dink', value: 'needs more control', confidence: null });
  assert.strictEqual(e.source, 'COACH');
})();

// 12. PLAYER_SELF_REPORT evidence accepted
(function () {
  var e = WF.createEvidence({ source: 'PLAYER_SELF_REPORT', skill: 'serve', value: 3 });
  assert.strictEqual(e.source, 'PLAYER_SELF_REPORT');
})();

assertThrows(function () { WF.createEvidence({ source: 'BOGUS', skill: 'drop', value: 1 }); }, 'unsupported evidence source', 'INVALID_INPUT');
assertThrows(function () { WF.createEvidence({ source: 'MATCH', value: 1 }); }, 'evidence missing skill/kpi', 'INVALID_INPUT');
assertThrows(function () { WF.createEvidence({ source: 'MATCH', skill: 'drop' }); }, 'evidence missing value', 'INVALID_INPUT');

// ================================================================
// Training
// ================================================================

// 13. valid completed training session generates/produces training evidence
(function () {
  var out = WF.recordTrainingSession({
    prescription_id: 'rx_1', skill: 'drop', kpi: 'EXECUTION_SUCCESS_RATE',
    attempts: 50, successful_attempts: 38, result_value: 0.76, completed: true
  });
  assert.strictEqual(out.session.completed, true);
  assert.strictEqual(out.session.evidence_type, 'TRAINING');
  assert.ok(out.evidence, 'completed session produces evidence');
  assert.strictEqual(out.evidence.source, 'TRAINING');
  assert.strictEqual(out.evidence.value, 0.76);
  assert.strictEqual(out.evidence.context, 'rx_1');
})();

// incomplete session produces no evidence yet (Rule 4: only a completed session bridges to evidence)
(function () {
  var out = WF.recordTrainingSession({
    prescription_id: 'rx_1', skill: 'drop', kpi: 'EXECUTION_SUCCESS_RATE',
    attempts: 50, successful_attempts: 10, result_value: 0.2, completed: false
  });
  assert.strictEqual(out.evidence, null, 'incomplete session produces no evidence');
})();

// 14. malformed session rejected
assertThrows(function () { WF.recordTrainingSession({ skill: 'drop', kpi: 'X', attempts: 10, successful_attempts: 5, result_value: 0.5, completed: true }); },
  'session missing prescription_id', 'INVALID_INPUT');
assertThrows(function () { WF.recordTrainingSession({ prescription_id: 'rx_1', kpi: 'X', attempts: 10, successful_attempts: 5, result_value: 0.5, completed: true }); },
  'session missing skill', 'INVALID_INPUT');
assertThrows(function () { WF.recordTrainingSession({ prescription_id: 'rx_1', skill: 'drop', attempts: 10, successful_attempts: 5, result_value: 0.5, completed: 'yes' }); },
  'session non-boolean completed', 'INVALID_INPUT');

// 15. successful attempts cannot exceed attempts
assertThrows(function () {
  WF.recordTrainingSession({ prescription_id: 'rx_1', skill: 'drop', kpi: 'X', attempts: 10, successful_attempts: 11, result_value: 0.5, completed: true });
}, 'successful_attempts > attempts', 'INVALID_INPUT');

// 16. invalid numeric values rejected
assertThrows(function () {
  WF.recordTrainingSession({ prescription_id: 'rx_1', skill: 'drop', kpi: 'X', attempts: -1, successful_attempts: 0, result_value: 0.5, completed: true });
}, 'negative attempts', 'INVALID_INPUT');
assertThrows(function () {
  WF.recordTrainingSession({ prescription_id: 'rx_1', skill: 'drop', kpi: 'X', attempts: 10, successful_attempts: 5, result_value: NaN, completed: true });
}, 'NaN result_value', 'INVALID_INPUT');
assertThrows(function () {
  WF.recordTrainingSession({ prescription_id: 'rx_1', skill: 'drop', kpi: 'X', attempts: '10', successful_attempts: 5, result_value: 0.5, completed: true });
}, 'non-numeric attempts', 'INVALID_INPUT');

// ================================================================
// Progress
// ================================================================

// 17. baseline/current KPI delta calculated consistently + 18. 0.58 -> 0.71 yields 0.13 / 13pp
(function () {
  var p = WF.computeProgress({ skill: 'drop', baseline_kpi: 0.58, current_kpi: 0.71, evidence_count: 4 });
  assert.strictEqual(p.delta, 0.13, 'absolute delta is 0.13, not a relative 13%');
  assert.strictEqual(p.delta_percentage_points, 13, 'delta expressed as 13 percentage points');
  assert.strictEqual(p.trend, 'IMPROVING');
})();

// 19. evidence count preserved
(function () {
  var p = WF.computeProgress({ baseline_kpi: 0.5, current_kpi: 0.5, evidence_count: 7 });
  assert.strictEqual(p.evidence_count, 7);
  assert.strictEqual(p.trend, 'STABLE');
})();

// 20. deterministic output
(function () {
  var a = WF.computeProgress({ skill: 'drop', baseline_kpi: 0.42, current_kpi: 0.55, target_kpi: 0.6, evidence_count: 3 });
  var b = WF.computeProgress({ skill: 'drop', baseline_kpi: 0.42, current_kpi: 0.55, target_kpi: 0.6, evidence_count: 3 });
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b), 'same inputs always produce the same output');
  assert.strictEqual(a.target_status, 'IN_PROGRESS');
  var met = WF.computeProgress({ baseline_kpi: 0.42, current_kpi: 0.65, target_kpi: 0.6 });
  assert.strictEqual(met.target_status, 'MET');
  var noTarget = WF.computeProgress({ baseline_kpi: 0.42, current_kpi: 0.65 });
  assert.strictEqual(noTarget.target_status, 'NOT_SET');
})();

assertThrows(function () { WF.computeProgress({ baseline_kpi: 'x', current_kpi: 0.5 }); }, 'non-numeric baseline_kpi', 'INVALID_INPUT');
assertThrows(function () { WF.computeProgress({ baseline_kpi: 0.5, current_kpi: 0.6, target_kpi: 'x' }); }, 'non-numeric target_kpi', 'INVALID_INPUT');

// ================================================================
// Architecture protection
// ================================================================

// 21. recommendation / priority / prescription remain separate references
(function () {
  var c = newCycle();
  c = WF.transition(c, 'ADD_EVIDENCE', { evidence_ref: 'ev_1' });
  c = WF.transition(c, 'GENERATE_RECOMMENDATION', { recommendation_refs: ['rec_1', 'rec_2'], priority_ref: 'pri_1' });
  c = WF.transition(c, 'GENERATE_PRESCRIPTION', { prescription_refs: ['rx_1'] });
  assert.ok(Array.isArray(c.recommendation_refs) && c.recommendation_refs.length === 2, 'recommendation_refs is its own field');
  assert.strictEqual(typeof c.priority_ref, 'string', 'priority_ref is its own field, distinct from recommendation_refs');
  assert.ok(Array.isArray(c.prescription_refs) && c.prescription_refs.length === 1, 'prescription_refs is its own field, distinct from recommendation_refs');
  assert.notStrictEqual(c.recommendation_refs, c.prescription_refs, 'recommendation and prescription refs are never the same array/field');
})();

// 22. workflow does not recompute S9 recommendation priority — structural source scan: this
// module must never require/reference any S9 engine or storage module.
(function () {
  var src = fs.readFileSync(path.join(__dirname, '../js/workflow-integration-engine.js'), 'utf8');
  // strip comments so a mention inside a header comment (e.g. explaining what it does NOT touch)
  // can't accidentally satisfy or fail the scan
  var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  var forbidden = ['PBMatchObservation', 'PBPerformanceAnalysis', 'PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'PBStore', 'require('];
  forbidden.forEach(function (token) {
    assert.ok(stripped.indexOf(token) === -1, 'workflow-integration-engine.js must never reference ' + token + ' (found outside comments)');
  });
})();

// 23. existing relevant S9 tests remain green — run the actual accepted S9 suites, not a re-implementation.
(function () {
  var cp = require('child_process');
  var s9Suites = [
    'match-observation-engine.test.js', 'performance-analysis-engine.test.js',
    'diagnosis-engine.test.js', 'recommendation-priority-engine.test.js',
    'training-prescription-engine.test.js', 's9-full-system-qa.test.js'
  ];
  s9Suites.forEach(function (suite) {
    var res = cp.spawnSync(process.execPath, [path.join(__dirname, suite)], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, 'accepted suite ' + suite + ' must still pass unmodified:\n' + res.stdout + res.stderr);
  });
})();

console.log('workflow-integration-engine.test.js: all assertions passed');
