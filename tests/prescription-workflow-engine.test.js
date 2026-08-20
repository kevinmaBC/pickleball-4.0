/* tests/prescription-workflow-engine.test.js — S10-C: Training
 * Prescription Workflow Integration
 * Run: node tests/prescription-workflow-engine.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

delete require.cache[require.resolve('../js/prescription-workflow-engine.js')];
var PW = require('../js/prescription-workflow-engine.js');

function assertThrows(fn, label, expectedCode) {
  var threw = null;
  try { fn(); } catch (e) { threw = e; }
  assert.ok(threw instanceof Error, label + ' throws an Error');
  if (expectedCode) assert.strictEqual(threw.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + (threw && threw.code) + ')');
}

// Minimal real S9-F Prescription shape (per js/training-prescription-engine.js's own output).
function rx(overrides) {
  return Object.assign({
    prescription_id: 'rx:m1:rec_1', match_id: 'm1', player_id: 'p1',
    source_recommendation_id: 'rec_1', recommendation_code: 'IMPROVE_SHOT_EXECUTION',
    skill: 'drop', context: null,
    training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION',
    drill_family_code: 'SHOT_EXECUTION',
    priority_rank: 1, priority_score: 74, priority_tier: 'HIGH',
    kpi_profile_code: 'EXECUTION_SUCCESS_RATE', kpi_target_value: null, kpi_target_status: 'BENCHMARK_NOT_RESOLVED',
    dosage_profile_code: 'PRIMARY_FOCUS',
    reassessment_profile_code: 'MATCH_RECHECK',
    resolved_drill_ids: [], drill_resolution_status: 'UNRESOLVED',
    status: 'prescribed'
  }, overrides || {});
}

function draftWorkflow(overrides) {
  return PW.createPrescriptionWorkflow(Object.assign({ prescription: rx(), player_id: 'p1' }, overrides || {})).prescription_workflow;
}

// ================================================================
// Contract / lifecycle
// ================================================================

// 1. valid Prescription Workflow creation
(function () {
  var out = PW.createPrescriptionWorkflow({ prescription: rx(), player_id: 'p1' });
  assert.ok(out.prescription_workflow, 'wraps prescription_workflow');
  var w = out.prescription_workflow;
  assert.ok(w.workflow_id);
  assert.strictEqual(w.state, 'DRAFTED');
  assert.deepStrictEqual(w.session_refs, []);
  assert.strictEqual(w.activated_at, null);
  assert.strictEqual(w.completed_at, null);
  assert.strictEqual(w.superseded_by, null);
})();

// 2. schema/version exists
(function () {
  var w = draftWorkflow();
  assert.strictEqual(w.schema_version, '1.0');
  assert.strictEqual(w.contract_version, 'S10-C-V1');
})();

// 3. prescription_ref preserved
(function () {
  var w = draftWorkflow({ prescription: rx({ prescription_id: 'rx_custom' }) });
  assert.strictEqual(w.prescription_ref, 'rx_custom');
})();

// 4. recommendation_ref preserved
(function () {
  var w = draftWorkflow({ prescription: rx({ source_recommendation_id: 'rec_custom' }) });
  assert.strictEqual(w.recommendation_ref, 'rec_custom');
})();

// 5. main lifecycle states exist
(function () {
  ['DRAFTED', 'ACTIVE', 'IN_PROGRESS', 'COMPLETED', 'EVALUATED'].forEach(function (s) {
    assert.ok(PW.MAIN_STATES.indexOf(s) !== -1, s + ' is a recognized main state');
  });
  ['DEFERRED', 'UNRESOLVED', 'CANCELLED', 'SUPERSEDED'].forEach(function (s) {
    assert.ok(PW.AUX_STATES.indexOf(s) !== -1, s + ' is a recognized auxiliary state');
  });
})();

assertThrows(function () { PW.createPrescriptionWorkflow({}); }, 'missing prescription', 'INVALID_INPUT');
assertThrows(function () { PW.createPrescriptionWorkflow({ prescription: { skill: 'drop' } }); }, 'prescription missing prescription_id', 'INVALID_INPUT');

// ================================================================
// Activation
// ================================================================

// 6. valid prescription activates
(function () {
  var w = PW.transition(draftWorkflow(), 'ACTIVATE', {});
  assert.strictEqual(w.state, 'ACTIVE');
  assert.ok(w.activated_at);
})();

// 7. missing source recommendation rejects
(function () {
  var w = draftWorkflow({ prescription: rx({ source_recommendation_id: null }) });
  assertThrows(function () { PW.transition(w, 'ACTIVATE', {}); }, 'missing recommendation ref', 'MISSING_RECOMMENDATION_REF');
})();

// 8. invalid prescription status rejects
(function () {
  var w = draftWorkflow({ prescription: rx({ status: 'deferred' }) });
  assertThrows(function () { PW.transition(w, 'ACTIVATE', {}); }, 'invalid prescription status', 'INVALID_PRESCRIPTION_STATUS');
})();

// 9. missing priority rejects
(function () {
  ['priority_rank', 'priority_score', 'priority_tier'].forEach(function (field) {
    var patch = {}; patch[field] = null;
    var w = draftWorkflow({ prescription: rx(patch) });
    assertThrows(function () { PW.transition(w, 'ACTIVATE', {}); }, 'missing ' + field, 'MISSING_PRIORITY');
  });
})();

// 10. missing training_objective_code rejects
(function () {
  var w = draftWorkflow({ prescription: rx({ training_objective_code: null }) });
  assertThrows(function () { PW.transition(w, 'ACTIVATE', {}); }, 'missing training_objective_code', 'MISSING_TRAINING_OBJECTIVE');
})();

// 11. missing training_mode rejects
(function () {
  var w = draftWorkflow({ prescription: rx({ training_mode: null }) });
  assertThrows(function () { PW.transition(w, 'ACTIVATE', {}); }, 'missing training_mode', 'MISSING_TRAINING_MODE');
})();

// 12. missing kpi_profile_code rejects
(function () {
  var w = draftWorkflow({ prescription: rx({ kpi_profile_code: null }) });
  assertThrows(function () { PW.transition(w, 'ACTIVATE', {}); }, 'missing kpi_profile_code', 'MISSING_KPI_PROFILE');
})();

// ================================================================
// Unresolved semantics
// ================================================================

// 13. UNRESOLVED drill still activates
(function () {
  var w = draftWorkflow({ prescription: rx({ drill_resolution_status: 'UNRESOLVED', resolved_drill_ids: [] }) });
  var activated = PW.transition(w, 'ACTIVATE', {});
  assert.strictEqual(activated.state, 'ACTIVE', 'UNRESOLVED drill does not block activation');
  assert.strictEqual(activated.prescription_snapshot.drill_resolution_status, 'UNRESOLVED');
})();

// 14. no drill ID is fabricated
(function () {
  var w = draftWorkflow({ prescription: rx({ drill_resolution_status: 'UNRESOLVED', resolved_drill_ids: [] }) });
  var activated = PW.transition(w, 'ACTIVATE', {});
  assert.deepStrictEqual(activated.prescription_snapshot.resolved_drill_ids, [], 'resolved_drill_ids stays empty, never invented');
  var started = PW.startTraining(activated, {});
  assert.strictEqual(started.session_intent.drill_id, undefined, 'session_intent never carries a fabricated drill_id field');
})();

// 15. BENCHMARK_NOT_RESOLVED still activates
(function () {
  var w = draftWorkflow({ prescription: rx({ kpi_target_status: 'BENCHMARK_NOT_RESOLVED', kpi_target_value: null }) });
  var activated = PW.transition(w, 'ACTIVATE', {});
  assert.strictEqual(activated.state, 'ACTIVE', 'BENCHMARK_NOT_RESOLVED does not block activation');
  assert.strictEqual(activated.prescription_snapshot.kpi_target_status, 'BENCHMARK_NOT_RESOLVED');
})();

// 16. no KPI target is fabricated
(function () {
  var w = draftWorkflow({ prescription: rx({ kpi_target_status: 'BENCHMARK_NOT_RESOLVED', kpi_target_value: null }) });
  var activated = PW.transition(w, 'ACTIVATE', {});
  assert.strictEqual(activated.prescription_snapshot.kpi_target_value, null, 'kpi_target_value stays null, never invented (e.g. never 75/80/90)');
})();

// 17. dosage_profile_code is preserved verbatim
(function () {
  var w = draftWorkflow({ prescription: rx({ dosage_profile_code: 'LIGHT_FOCUS' }) });
  assert.strictEqual(w.prescription_snapshot.dosage_profile_code, 'LIGHT_FOCUS');
})();

// 18. no numeric dose is invented
(function () {
  var w = draftWorkflow();
  var activated = PW.transition(w, 'ACTIVATE', {});
  var started = PW.startTraining(activated, {});
  ['reps', 'minutes', 'sessions_per_week', 'dosage_value', 'duration'].forEach(function (field) {
    assert.strictEqual(started.session_intent[field], undefined, 'session_intent must never carry a numeric dosage field "' + field + '"');
  });
})();

// ================================================================
// Separation
// ================================================================

// 19. prescription.status remains distinct from workflow.state
(function () {
  var w = draftWorkflow({ prescription: rx({ status: 'prescribed' }) });
  var activated = PW.transition(w, 'ACTIVATE', {});
  var started = PW.startTraining(activated, {}).workflow;
  assert.strictEqual(started.prescription_snapshot.status, 'prescribed', 'S9-F status field never changes');
  assert.strictEqual(started.state, 'IN_PROGRESS', 'workflow.state changes independently of prescription.status');
})();

// 20. Session Plan/Intent remains distinct from Session Result
(function () {
  var activated = PW.transition(draftWorkflow(), 'ACTIVATE', {});
  var result = PW.startTraining(activated, {});
  assert.strictEqual(result.session_intent.status, 'PLANNED', 'session_intent is intent-only, never a result record');
  assert.strictEqual(result.session_intent.result_value, undefined);
})();

// 21. no attempts/success/result/evidence fields are generated by S10-C
(function () {
  var activated = PW.transition(draftWorkflow(), 'ACTIVATE', {});
  var result = PW.startTraining(activated, {});
  ['attempts', 'successful_attempts', 'result_value', 'completed', 'evidence_type', 'evidence_id'].forEach(function (field) {
    assert.strictEqual(result.session_intent[field], undefined, 'session_intent must never carry "' + field + '"');
    assert.strictEqual(result.workflow[field], undefined, 'workflow must never carry "' + field + '"');
  });
})();

// ================================================================
// S8 bridge
// ================================================================

// 22/23. bridge preserves prescription ancestry (source_recommendation_id chain intact end to end)
(function () {
  var w = draftWorkflow({ prescription: rx({ prescription_id: 'rx_1', source_recommendation_id: 'rec_1' }) });
  var activated = PW.transition(w, 'ACTIVATE', {});
  var result = PW.startTraining(activated, {});
  assert.strictEqual(result.session_intent.prescription_ref, 'rx_1', 'session_intent traces back to the exact prescription');
  assert.strictEqual(result.workflow.recommendation_ref, 'rec_1', 'workflow still traces back to the exact recommendation');
  assert.ok(result.workflow.session_refs.indexOf(result.session_intent.session_id) !== -1, 'session_refs records the new session_intent');
})();

// 24. no parallel TrainingCycle/SessionPlan system is created — structural + behavioral proof:
// this module never touches PBStore (so it cannot create competing persisted stores) and its
// session_intent is a plain returned object, never written anywhere.
(function () {
  var src = fs.readFileSync(path.join(__dirname, '../js/prescription-workflow-engine.js'), 'utf8');
  var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(stripped.indexOf('PBStore') === -1, 'no PBStore reference -> cannot create a competing persisted TrainingCycle/SessionPlan store');
  assert.ok(stripped.indexOf('indexedDB') === -1 && stripped.indexOf('createObjectStore') === -1, 'no direct persistence of any kind');
})();

// ================================================================
// Staleness / supersession
// ================================================================

// 25. stale prescription cannot START_TRAINING
(function () {
  var activated = PW.transition(draftWorkflow(), 'ACTIVATE', {});
  assertThrows(function () { PW.startTraining(activated, { stale: true }); }, 'stale START_TRAINING', 'STALE_RECOMMENDATION');
})();

// 26. reassessment-required state blocks new activation/session
(function () {
  assertThrows(function () { PW.transition(draftWorkflow(), 'ACTIVATE', { stale: true }); }, 'stale ACTIVATE', 'STALE_RECOMMENDATION');
})();

// 27. superseded workflow preserves history/reference
(function () {
  var activated = PW.transition(draftWorkflow({ prescription: rx({ prescription_id: 'rx_old' }) }), 'ACTIVATE', {});
  var result = PW.supersede(activated, { prescription: rx({ prescription_id: 'rx_new', source_recommendation_id: 'rec_2' }) });
  assert.strictEqual(result.superseded_workflow.state, 'SUPERSEDED');
  assert.strictEqual(result.superseded_workflow.prescription_ref, 'rx_old', 'old workflow keeps its original prescription reference (history preserved)');
  assert.strictEqual(result.superseded_workflow.superseded_by, result.prescription_workflow.workflow_id, 'old workflow points at the new one');
  assert.strictEqual(result.prescription_workflow.state, 'DRAFTED', 'new prescription workflow starts fresh');
  assert.strictEqual(result.prescription_workflow.prescription_ref, 'rx_new');
  // old activation timestamp/session history is not deleted
  assert.ok(result.superseded_workflow.activated_at, 'old workflow retains its activated_at history');
})();

(function () {
  var cancelled = Object.assign({}, draftWorkflow(), { state: 'CANCELLED' });
  assertThrows(function () { PW.supersede(cancelled, { prescription: rx() }); }, 'cannot supersede a cancelled workflow', 'INVALID_INPUT');
})();

// ================================================================
// Determinism
// ================================================================

// 28. same input produces same eligibility/result
(function () {
  var w1 = draftWorkflow({ workflow_id: 'wf_fixed', prescription: rx({ prescription_id: 'rx_fixed' }) });
  var w2 = draftWorkflow({ workflow_id: 'wf_fixed', prescription: rx({ prescription_id: 'rx_fixed' }) });
  // strip only the inherently-time-varying fields before comparing
  function stableView(w) { var c = Object.assign({}, w); delete c.created_at; delete c.updated_at; return c; }
  assert.strictEqual(JSON.stringify(stableView(w1)), JSON.stringify(stableView(w2)));

  var gate1 = PW.canActivate(w1.prescription_snapshot);
  var gate2 = PW.canActivate(w2.prescription_snapshot);
  assert.deepStrictEqual(gate1, gate2);

  var s1 = PW.startTraining(PW.transition(w1, 'ACTIVATE', {}), { session_id: 'sint_fixed' });
  var s2 = PW.startTraining(PW.transition(w2, 'ACTIVATE', {}), { session_id: 'sint_fixed' });
  assert.strictEqual(JSON.stringify(s1.session_intent), JSON.stringify(s2.session_intent));
})();

// ================================================================
// Architecture protection
// ================================================================

// 29/30/31/32: no recommendation formula, no priority formula, no S9-F prescription mapping, no
// session-result/evidence logic — structural source scan (same technique as S10-A test #22 and
// S10-B tests #26-28): this module must never reference any upstream engine/storage module, and
// must never contain session-result vocabulary.
(function () {
  var src = fs.readFileSync(path.join(__dirname, '../js/prescription-workflow-engine.js'), 'utf8');
  var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  var forbiddenModules = [
    'PBMatchObservation', 'PBPerformanceAnalysis', 'PBDiagnosis', 'PBRecommendationPriority',
    'PBTrainingPrescription', 'PBWorkflow', 'PBDashboard', 'PBStore', 'require('
  ];
  forbiddenModules.forEach(function (token) {
    assert.ok(stripped.indexOf(token) === -1, 'prescription-workflow-engine.js must never reference ' + token + ' (found outside comments)');
  });
  var forbiddenSessionResultVocab = ['successful_attempts', 'result_value', 'attempts:', "'attempts'", 'TRAINING_EVIDENCE'];
  forbiddenSessionResultVocab.forEach(function (token) {
    assert.ok(stripped.indexOf(token) === -1, 'prescription-workflow-engine.js must never contain session-result vocabulary "' + token + '" — that is S10-D scope');
  });
})();

// ================================================================
// Regression — the accepted S9 + S10-A/B suites this stage's inputs come from must stay green.
// ================================================================
(function () {
  var cp = require('child_process');
  var relevantSuites = [
    'training-prescription-engine.test.js', 's9-full-system-qa.test.js',
    'workflow-integration-engine.test.js', 'dashboard-integration-engine.test.js'
  ];
  relevantSuites.forEach(function (suite) {
    var res = cp.spawnSync(process.execPath, [path.join(__dirname, suite)], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, 'accepted suite ' + suite + ' must still pass unmodified:\n' + res.stdout + res.stderr);
  });
})();

console.log('prescription-workflow-engine.test.js: all assertions passed');
