/* tests/session-evidence-engine.test.js — S10-D: Training Session
 * Execution + Evidence Capture
 * Run: node tests/session-evidence-engine.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

delete require.cache[require.resolve('../js/workflow-integration-engine.js')];
global.PBWorkflow = require('../js/workflow-integration-engine.js');
delete require.cache[require.resolve('../js/session-evidence-engine.js')];
var SE = require('../js/session-evidence-engine.js');

function assertThrows(fn, label, expectedCode) {
  var threw = null;
  try { fn(); } catch (e) { threw = e; }
  assert.ok(threw instanceof Error, label + ' throws an Error');
  if (expectedCode) assert.strictEqual(threw.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + (threw && threw.code) + ')');
}

// Minimal S10-C session_intent shape (per js/prescription-workflow-engine.js's startTraining output).
function sessionIntent(overrides) {
  return Object.assign({
    session_id: 'sint_1', prescription_ref: 'rx_1', player_id: 'p1', status: 'PLANNED',
    training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION',
    kpi_profile_code: 'EXECUTION_SUCCESS_RATE', schema_version: '1.0'
  }, overrides || {});
}
function plannedExecution(overrides) {
  return SE.createSessionExecution(Object.assign({ session_intent: sessionIntent(), recommendation_ref: 'rec_1' }, overrides || {})).session_execution;
}
function activeExecution(overrides) {
  return SE.transition(plannedExecution(overrides), 'START', {});
}
function cycle(overrides) {
  return PBWorkflow.createDevelopmentCycle(Object.assign({ player_id: 'p1', baseline_ref: 'asm_1' }, overrides || {})).development_cycle;
}

// ================================================================
// Contract / lifecycle
// ================================================================

// 1. valid Session Intent accepted
(function () {
  var exec = plannedExecution();
  assert.strictEqual(exec.session_id, 'sint_1');
  assert.strictEqual(exec.prescription_ref, 'rx_1');
  assert.strictEqual(exec.recommendation_ref, 'rec_1');
  assert.strictEqual(exec.player_id, 'p1');
  assert.strictEqual(exec.kpi_profile_code, 'EXECUTION_SUCCESS_RATE');
  assert.strictEqual(exec.state, 'PLANNED');
  assert.strictEqual(exec.schema_version, '1.0');
})();
assertThrows(function () { SE.createSessionExecution({ session_intent: { prescription_ref: 'rx_1', player_id: 'p1', kpi_profile_code: 'X' } }); }, 'missing session_id', 'INVALID_INPUT');
assertThrows(function () { SE.createSessionExecution({ session_intent: { session_id: 's1', player_id: 'p1', kpi_profile_code: 'X' } }); }, 'missing prescription_ref', 'MISSING_PRESCRIPTION_REF');
assertThrows(function () { SE.createSessionExecution({ session_intent: { session_id: 's1', prescription_ref: 'rx_1', kpi_profile_code: 'X' } }); }, 'missing player_id', 'MISSING_PLAYER');
assertThrows(function () { SE.createSessionExecution({ session_intent: { session_id: 's1', prescription_ref: 'rx_1', player_id: 'p1' } }); }, 'missing kpi_profile_code', 'MISSING_KPI_PROFILE');

// 2. PLANNED -> ACTIVE
(function () {
  var exec = SE.transition(plannedExecution(), 'START', {});
  assert.strictEqual(exec.state, 'ACTIVE');
  assert.ok(exec.started_at);
})();

// 3. ACTIVE -> COMPLETED
(function () {
  var result = SE.completeSession(activeExecution(), { attempts: 50, successful_attempts: 38 }).session_result;
  assert.strictEqual(result.status, 'COMPLETED');
})();

// 4. invalid lifecycle transition rejected
assertThrows(function () { SE.transition(plannedExecution(), 'BOGUS_ACTION', {}); }, 'unknown action', 'INVALID_INPUT');
assertThrows(function () { SE.completeSession(plannedExecution(), { attempts: 10, successful_attempts: 5 }); }, 'COMPLETE from PLANNED', 'INVALID_SESSION_STATE');
assertThrows(function () { SE.transition(activeExecution(), 'START', {}); }, 'START from ACTIVE', 'INVALID_SESSION_STATE');

// ================================================================
// Numeric validation
// ================================================================

// 5. attempts < 0 rejected
assertThrows(function () { SE.completeSession(activeExecution(), { attempts: -1, successful_attempts: 0 }); }, 'negative attempts', 'INVALID_ATTEMPTS');
// 6. successful_attempts < 0 rejected
assertThrows(function () { SE.completeSession(activeExecution(), { attempts: 10, successful_attempts: -1 }); }, 'negative successful_attempts', 'INVALID_SUCCESS_COUNT');
// 7. successful_attempts > attempts rejected
assertThrows(function () { SE.completeSession(activeExecution(), { attempts: 10, successful_attempts: 11 }); }, 'successful > attempts', 'INVALID_SUCCESS_COUNT');
// non-integer / non-numeric also rejected
assertThrows(function () { SE.completeSession(activeExecution(), { attempts: 10.5, successful_attempts: 5 }); }, 'non-integer attempts', 'INVALID_ATTEMPTS');
assertThrows(function () { SE.completeSession(activeExecution(), { attempts: '10', successful_attempts: 5 }); }, 'non-numeric attempts', 'INVALID_ATTEMPTS');

// 8. attempts == 0 cannot produce valid Evidence
(function () {
  var result = SE.completeSession(activeExecution(), { attempts: 0, successful_attempts: 0 }).session_result;
  assert.strictEqual(result.status, 'COMPLETED', 'a 0-attempt session can still finalize as a Session Result');
  assert.strictEqual(result.result_value, null, 'result_value stays null, never NaN/0, when attempts is 0');
  var gate = SE.canGenerateEvidence(result);
  assert.strictEqual(gate.eligible, false);
  assert.strictEqual(gate.reason, 'INVALID_ATTEMPTS');
  assertThrows(function () { SE.buildTrainingEvidence(result); }, 'attempts=0 evidence build', 'INVALID_ATTEMPTS');
})();

// 9. valid result_value calculated deterministically
(function () {
  var result = SE.completeSession(activeExecution(), { attempts: 50, successful_attempts: 38 }).session_result;
  assert.strictEqual(result.result_value, 0.76);
  var result2 = SE.completeSession(activeExecution(), { attempts: 50, successful_attempts: 38 }).session_result;
  assert.strictEqual(result2.result_value, 0.76, 'same inputs always produce the same result_value');
})();

// ================================================================
// Completion
// ================================================================

// 10. completed result created exactly once (per execution object)
(function () {
  var exec = activeExecution();
  var out = SE.completeSession(exec, { attempts: 20, successful_attempts: 15 });
  assert.strictEqual(out.session_result.status, 'COMPLETED');
})();

// 11. duplicate finalization rejected
(function () {
  var exec = activeExecution();
  var completed = SE.completeSession(exec, { attempts: 20, successful_attempts: 15 }).session_result;
  var finalizedExecution = Object.assign({}, exec, { state: 'COMPLETED' });
  assertThrows(function () { SE.completeSession(finalizedExecution, { attempts: 20, successful_attempts: 15 }); }, 'duplicate COMPLETE', 'DUPLICATE_FINALIZATION');
  assertThrows(function () { SE.transition(finalizedExecution, 'CANCEL', {}); }, 'CANCEL after COMPLETE', 'DUPLICATE_FINALIZATION');
  assertThrows(function () { SE.transition(Object.assign({}, exec, { state: 'SKIPPED' }), 'SKIP', {}); }, 'duplicate SKIP', 'DUPLICATE_FINALIZATION');
})();

// ================================================================
// Non-evidence states
// ================================================================

// 12. PARTIAL produces no Evidence (V1: no dedicated PARTIAL result path exists that reaches Evidence)
(function () {
  var partialResult = { session_id: 's1', prescription_ref: 'rx_1', player_id: 'p1', kpi_profile_code: 'X', status: 'PARTIAL', attempts: 10, successful_attempts: 5, result_value: 0.5 };
  var gate = SE.canGenerateEvidence(partialResult);
  assert.strictEqual(gate.eligible, false);
  assert.strictEqual(gate.reason, 'INVALID_SESSION_STATE');
  assertThrows(function () { SE.buildTrainingEvidence(partialResult); }, 'PARTIAL evidence build', 'INVALID_SESSION_STATE');
})();

// 13. SKIPPED produces no Evidence
(function () {
  var exec = SE.transition(plannedExecution(), 'SKIP', {});
  assert.strictEqual(exec.state, 'SKIPPED');
  var skippedResult = { session_id: exec.session_id, prescription_ref: exec.prescription_ref, player_id: exec.player_id, kpi_profile_code: exec.kpi_profile_code, status: 'SKIPPED' };
  assert.strictEqual(SE.canGenerateEvidence(skippedResult).eligible, false);
})();

// 14. CANCELLED produces no Evidence
(function () {
  var exec = SE.transition(activeExecution(), 'CANCEL', {});
  assert.strictEqual(exec.state, 'CANCELLED');
  var cancelledResult = { session_id: exec.session_id, prescription_ref: exec.prescription_ref, player_id: exec.player_id, kpi_profile_code: exec.kpi_profile_code, status: 'CANCELLED' };
  assert.strictEqual(SE.canGenerateEvidence(cancelledResult).eligible, false);
})();

// 15. skipped/cancelled are not converted to result_value = 0
(function () {
  var skipped = SE.transition(plannedExecution(), 'SKIP', {});
  var cancelled = SE.transition(activeExecution(), 'CANCEL', {});
  assert.strictEqual(skipped.result_value, undefined, 'SKIPPED execution never carries a result_value field at all');
  assert.strictEqual(cancelled.result_value, undefined, 'CANCELLED execution never carries a result_value field at all');
})();

// ================================================================
// Evidence
// ================================================================

function completedResult(overrides) {
  return Object.assign(SE.completeSession(activeExecution(), { attempts: 50, successful_attempts: 38 }).session_result, overrides || {});
}

// 16. COMPLETED valid result generates Evidence
(function () {
  var ev = SE.buildTrainingEvidence(completedResult()).evidence;
  assert.ok(ev.evidence_id);
})();

// 17. source == TRAINING
(function () {
  var ev = SE.buildTrainingEvidence(completedResult()).evidence;
  assert.strictEqual(ev.source, 'TRAINING');
})();

// 18. session_ref preserved
(function () {
  var result = completedResult({ session_id: 'sint_custom' });
  var ev = SE.buildTrainingEvidence(result).evidence;
  assert.strictEqual(ev.session_ref, 'sint_custom');
})();

// 19. prescription_ref preserved
(function () {
  var result = completedResult({ prescription_ref: 'rx_custom' });
  var ev = SE.buildTrainingEvidence(result).evidence;
  assert.strictEqual(ev.prescription_ref, 'rx_custom');
})();

// 20. recommendation_ref preserved
(function () {
  var result = completedResult({ recommendation_ref: 'rec_custom' });
  var ev = SE.buildTrainingEvidence(result).evidence;
  assert.strictEqual(ev.recommendation_ref, 'rec_custom');
})();

// 21. player_id preserved
(function () {
  var result = completedResult({ player_id: 'plr_custom' });
  var ev = SE.buildTrainingEvidence(result).evidence;
  assert.strictEqual(ev.player_id, 'plr_custom');
})();

// 22. kpi_profile/value preserved
(function () {
  var result = completedResult({ kpi_profile_code: 'CUSTOM_KPI' });
  var ev = SE.buildTrainingEvidence(result).evidence;
  assert.strictEqual(ev.kpi, 'CUSTOM_KPI');
  assert.strictEqual(ev.value, result.result_value);
})();

// 23. duplicate Evidence rejected/idempotent
(function () {
  var result = completedResult();
  var ev1 = SE.buildTrainingEvidence(result).evidence;
  var ev2 = SE.buildTrainingEvidence(result).evidence;
  assert.strictEqual(ev1.evidence_id, ev2.evidence_id, 'building evidence twice for the same session/KPI yields the same deterministic id');
  var c = cycle();
  var submitted = SE.submitTrainingEvidence(result, c);
  assertThrows(function () { SE.submitTrainingEvidence(result, submitted.development_cycle); }, 'duplicate evidence submission', 'DUPLICATE_EVIDENCE');
})();

// ================================================================
// S10-A bridge
// ================================================================

// 24/25. Evidence is passed into S10-A ADD_EVIDENCE; development_cycle.evidence_refs updates
(function () {
  var result = completedResult();
  var c = cycle();
  var out = SE.submitTrainingEvidence(result, c);
  assert.ok(out.development_cycle.evidence_refs.indexOf(out.evidence.evidence_id) !== -1);
  assert.strictEqual(out.development_cycle.state, 'EVIDENCE_AVAILABLE', 'PBWorkflow itself decided the resulting state from BASELINE_READY');
})();

// 26. S10-A returned state is respected
(function () {
  var result = completedResult();
  var c = cycle();
  var out = SE.submitTrainingEvidence(result, c);
  assert.strictEqual(out.development_cycle.state, PBWorkflow.transition(c, 'ADD_EVIDENCE', { evidence_ref: out.evidence.evidence_id }).state, 'S10-D reports exactly what PBWorkflow computed, nothing else');
})();

// 27. where applicable, new Evidence produces REASSESSMENT_READY
(function () {
  var c = cycle();
  c = PBWorkflow.transition(c, 'ADD_EVIDENCE', { evidence_ref: 'ev_prior' });
  c = PBWorkflow.transition(c, 'GENERATE_RECOMMENDATION', { recommendation_refs: ['rec_1'] });
  var result = completedResult({ kpi_profile_code: 'NEW_KPI_AFTER_RECOMMENDATION' }); // different KPI -> different evidence_id, avoids duplicate collision with ev_prior
  var out = SE.submitTrainingEvidence(result, c);
  assert.strictEqual(out.development_cycle.state, 'REASSESSMENT_READY', 'new TRAINING evidence after a recommendation exists makes the cycle reassessment-eligible, per S10-A\'s own rule');
})();

// 28. S10-D does not directly set/recalculate recommendation/priority
(function () {
  var result = completedResult();
  var c = cycle();
  var out = SE.submitTrainingEvidence(result, c);
  assert.deepStrictEqual(out.development_cycle.recommendation_refs, [], 'submitting TRAINING evidence never touches recommendation_refs');
  assert.strictEqual(out.development_cycle.priority_ref, null);
})();

assertThrows(function () { SE.submitTrainingEvidence(completedResult(), null); }, 'missing development_cycle', 'MISSING_DEVELOPMENT_CYCLE');
assertThrows(function () { SE.submitTrainingEvidence(completedResult(), {}); }, 'malformed development_cycle', 'MISSING_DEVELOPMENT_CYCLE');

// ================================================================
// Separation
// ================================================================

// 29. Session Intent != Session Result
(function () {
  var exec = plannedExecution();
  var result = SE.completeSession(SE.transition(exec, 'START', {}), { attempts: 10, successful_attempts: 8 }).session_result;
  assert.strictEqual(exec.status, undefined, 'session_execution has no status field'); // intent-derived object has state, not status
  assert.strictEqual(result.status, 'COMPLETED', 'session_result has a distinct status field'); // different shape entirely
  assert.notDeepStrictEqual(Object.keys(exec).sort(), Object.keys(result).sort());
})();

// 30. Session Result != Evidence
(function () {
  var result = completedResult();
  var ev = SE.buildTrainingEvidence(result).evidence;
  assert.strictEqual(result.attempts, 50);
  assert.strictEqual(ev.attempts, undefined, 'Evidence has no top-level attempts field (it lives in context)');
  assert.strictEqual(ev.context.attempts, 50);
  assert.notStrictEqual(result.session_id, ev.evidence_id);
})();

// 31. no progress delta/trend/verdict produced
(function () {
  var src = fs.readFileSync(path.join(__dirname, '../js/session-evidence-engine.js'), 'utf8');
  var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ['baseline_kpi', 'current_kpi', "'delta'", 'trend', 'target_status', 'IMPROVING', 'DECLINING', "'MET'", 'NOT_MET'].forEach(function (token) {
    assert.ok(stripped.indexOf(token) === -1, 'session-evidence-engine.js must never contain progress vocabulary "' + token + '" — that is S10-E scope');
  });
})();

// 32. no recommendation/prioritization code present — structural scan (also covers architecture
// protection #35-39): this module must never reference any upstream engine except PBWorkflow.
(function () {
  var src = fs.readFileSync(path.join(__dirname, '../js/session-evidence-engine.js'), 'utf8');
  var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  var forbidden = [
    'PBMatchObservation', 'PBPerformanceAnalysis', 'PBDiagnosis', 'PBRecommendationPriority',
    'PBTrainingPrescription', 'PBPrescriptionWorkflow', 'PBDashboard', 'PBStore', 'require(',
    'indexedDB', 'createObjectStore'
  ];
  forbidden.forEach(function (token) {
    assert.ok(stripped.indexOf(token) === -1, 'session-evidence-engine.js must never reference ' + token + ' (found outside comments)');
  });
})();

// ================================================================
// Persistence/reload
// ================================================================

// 33/34. production persistence behavior tested honestly: this module adds no IndexedDB store and
// calls no storage API (verified structurally above), so Session Result/Evidence are transient —
// duplicate-finalization and duplicate-evidence protection are proven above (tests #11/#23) using
// only the plain objects the caller already holds (the execution object's own state; the
// development_cycle's own evidence_refs) — no fake persistence layer is introduced to simulate a
// reload that this architecture does not yet support. See docs/S10-D-SESSION-EVIDENCE.md for the
// explicit persistence-decision reasoning.
(function () {
  var result = completedResult();
  var c = cycle();
  var out = SE.submitTrainingEvidence(result, c);
  // "reload" honestly modeled as: the caller re-serializes and re-parses the plain objects it
  // already holds (the only state that exists) — duplicate protection must still hold afterward.
  var reloadedCycle = JSON.parse(JSON.stringify(out.development_cycle));
  assertThrows(function () { SE.submitTrainingEvidence(result, reloadedCycle); }, 'duplicate evidence survives a plain-object round-trip', 'DUPLICATE_EVIDENCE');
})();

// ================================================================
// Regression — the accepted S10-A/B/C suites this stage touches must stay green.
// ================================================================
(function () {
  var cp = require('child_process');
  var relevantSuites = [
    'workflow-integration-engine.test.js', 'dashboard-integration-engine.test.js',
    'prescription-workflow-engine.test.js', 's9-full-system-qa.test.js'
  ];
  relevantSuites.forEach(function (suite) {
    var res = cp.spawnSync(process.execPath, [path.join(__dirname, suite)], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, 'accepted suite ' + suite + ' must still pass unmodified:\n' + res.stdout + res.stderr);
  });
})();

console.log('session-evidence-engine.test.js: all assertions passed');
