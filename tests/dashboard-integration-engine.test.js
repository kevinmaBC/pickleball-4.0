/* tests/dashboard-integration-engine.test.js — S10-B: Recommendation /
 * Priority Dashboard Integration
 * Run: node tests/dashboard-integration-engine.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

delete require.cache[require.resolve('../js/dashboard-integration-engine.js')];
var DB = require('../js/dashboard-integration-engine.js');

function assertThrows(fn, label, expectedCode) {
  var threw = null;
  try { fn(); } catch (e) { threw = e; }
  assert.ok(threw instanceof Error, label + ' throws an Error');
  if (expectedCode) assert.strictEqual(threw.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + (threw && threw.code) + ')');
}

// Minimal upstream fixtures matching js/recommendation-priority-engine.js and
// js/training-prescription-engine.js's real output shapes (per docs/S9-E/F).
function rec(overrides) {
  return Object.assign({
    recommendation_id: 'rec:m1:IMPROVE_SHOT_EXECUTION:drop:-',
    match_id: 'm1', player_id: 'p1',
    diagnosis_code: 'SHOT_EXECUTION_GAP',
    skill: 'drop', context: null,
    recommendation_code: 'IMPROVE_SHOT_EXECUTION',
    source_skill_gap_ids: ['gap_1'],
    severity_score: 60, confidence_score: 65,
    diagnosis_priority_signal: 74, priority_score: 74, priority_tier: 'HIGH',
    reason_signals: ['HIGH_SEVERITY'], rank: 1, status: 'recommended'
  }, overrides || {});
}

function rx(overrides) {
  return Object.assign({
    prescription_id: 'rx:m1:rec:m1:IMPROVE_SHOT_EXECUTION:drop:-',
    match_id: 'm1', player_id: 'p1',
    source_recommendation_id: 'rec:m1:IMPROVE_SHOT_EXECUTION:drop:-',
    recommendation_code: 'IMPROVE_SHOT_EXECUTION',
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

function skillGap(overrides) {
  return Object.assign({
    skill_gap_id: 'gap_1', match_id: 'm1', player_id: 'p1',
    diagnosis_code: 'SHOT_EXECUTION_GAP', skill: 'drop', context: null,
    severity_score: 60, confidence_score: 65, priority_signal: 74,
    evidence_pattern_ids: ['pat_1'], evidence_metric_refs: ['shot_metrics:drop'],
    status: 'supported'
  }, overrides || {});
}

function cycle(overrides) {
  return Object.assign({
    cycle_id: 'cyc_1', player_id: 'p1', baseline_ref: 'asm_1',
    evidence_refs: ['ev_1'], recommendation_refs: ['rec:m1:IMPROVE_SHOT_EXECUTION:drop:-'],
    priority_ref: null, prescription_refs: ['rx:m1:rec:m1:IMPROVE_SHOT_EXECUTION:drop:-'],
    training_session_refs: [], progress_evidence_refs: [], reassessment_ref: null,
    state: 'PRESCRIPTION_READY', schema_version: '1.0'
  }, overrides || {});
}

// ================================================================
// Projection
// ================================================================

// 1. valid recommendation projects correctly
(function () {
  var out = DB.projectRecommendation({ recommendation: rec(), prescription: rx(), workflow: cycle(), skill_gaps: [skillGap()] });
  var item = out.dashboard_item;
  assert.strictEqual(item.recommendation_id, rec().recommendation_id);
  assert.strictEqual(item.skill, 'drop');
  assert.strictEqual(item.recommendation_code, 'IMPROVE_SHOT_EXECUTION');
  assert.strictEqual(item.status, 'ACTIVE');
  assert.strictEqual(item.engine_status, 'recommended');
})();

// 2. schema/version exists
(function () {
  var item = DB.projectRecommendation({ recommendation: rec() }).dashboard_item;
  assert.strictEqual(item.schema_version, '1.0');
  assert.strictEqual(item.dashboard_version, 'S10-B-V1');
})();

// 3. recommendation ID/reference preserved
(function () {
  var item = DB.projectRecommendation({ recommendation: rec({ recommendation_id: 'rec_custom_id' }) }).dashboard_item;
  assert.strictEqual(item.recommendation_id, 'rec_custom_id');
})();

assertThrows(function () { DB.projectRecommendation({}); }, 'missing recommendation', 'INVALID_INPUT');
assertThrows(function () { DB.projectRecommendation({ recommendation: { skill: 'drop' } }); }, 'recommendation missing recommendation_id', 'INVALID_INPUT');

// ================================================================
// Priority
// ================================================================

// 4. rank inherited verbatim
(function () {
  var item = DB.projectRecommendation({ recommendation: rec({ rank: 3 }) }).dashboard_item;
  assert.strictEqual(item.rank, 3);
  assert.strictEqual(item.rank_status, 'RESOLVED');
})();

// 5. priority_score inherited verbatim
(function () {
  var item = DB.projectRecommendation({ recommendation: rec({ priority_score: 61.5 }) }).dashboard_item;
  assert.strictEqual(item.priority_score, 61.5);
})();

// 6. priority_tier inherited verbatim
(function () {
  var item = DB.projectRecommendation({ recommendation: rec({ priority_tier: 'LOW' }) }).dashboard_item;
  assert.strictEqual(item.priority_tier, 'LOW');
})();

// 7. ordering follows upstream rank (not confidence/evidence-count/skill/heuristic)
(function () {
  var items = [
    { recommendation: rec({ recommendation_id: 'r_c', rank: 3, confidence_score: 99, skill: 'aaa' }) },
    { recommendation: rec({ recommendation_id: 'r_a', rank: 1, confidence_score: 10, skill: 'zzz' }) },
    { recommendation: rec({ recommendation_id: 'r_b', rank: 2, confidence_score: 50, skill: 'mmm' }) }
  ];
  var out = DB.projectDashboardList(items);
  assert.deepStrictEqual(out.dashboard.items.map(function (i) { return i.recommendation_id; }), ['r_a', 'r_b', 'r_c']);
})();

// 8. missing rank is not guessed
(function () {
  var items = [
    { recommendation: rec({ recommendation_id: 'r_ranked', rank: 1 }) },
    { recommendation: rec({ recommendation_id: 'r_unranked', rank: null }) }
  ];
  var out = DB.projectDashboardList(items);
  var unranked = out.dashboard.items.filter(function (i) { return i.recommendation_id === 'r_unranked'; })[0];
  assert.strictEqual(unranked.rank, null, 'missing rank stays null, never defaulted');
  assert.strictEqual(unranked.rank_status, 'UNRESOLVED');
  assert.deepStrictEqual(out.dashboard.items.map(function (i) { return i.recommendation_id; }), ['r_ranked', 'r_unranked'], 'unresolved rank sorts last');
})();

// ================================================================
// Separation
// ================================================================

// 9/10/11. recommendation / priority / prescription remain distinct fields
(function () {
  var item = DB.projectRecommendation({ recommendation: rec(), prescription: rx() }).dashboard_item;
  assert.strictEqual(item.recommendation_code, 'IMPROVE_SHOT_EXECUTION', 'recommendation lives on its own field');
  assert.ok(item.priority_score != null && item.priority_tier != null && item.rank != null, 'priority lives on its own fields');
  assert.strictEqual(item.prescription_ref, rx().prescription_id, 'prescription lives on its own field');
  assert.ok(isPlainObject(item.prescription_summary), 'prescription_summary is its own nested object');
  assert.notStrictEqual(item.recommendation_code, item.prescription_ref, 'recommendation and prescription are not collapsed into one value');
  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
})();

// ================================================================
// Traceability
// ================================================================

// 12. evidence references preserved
(function () {
  var item = DB.projectRecommendation({ recommendation: rec(), evidence_refs: ['ev_1', 'ev_2'] }).dashboard_item;
  assert.deepStrictEqual(item.traceability.evidence_refs, ['ev_1', 'ev_2']);
})();

// 13. finding/skill-gap references preserved where upstream provides them
(function () {
  var item = DB.projectRecommendation({ recommendation: rec(), skill_gaps: [skillGap()] }).dashboard_item;
  assert.deepStrictEqual(item.traceability.source_skill_gap_ids, ['gap_1']);
  assert.deepStrictEqual(item.traceability.evidence_pattern_ids, ['pat_1'], 'evidence_pattern_ids resolved through the supplied SkillGap');
})();

// 14. missing upstream references are not fabricated
(function () {
  var item = DB.projectRecommendation({ recommendation: rec() }).dashboard_item; // no skill_gaps, no evidence_refs supplied
  assert.deepStrictEqual(item.traceability.evidence_pattern_ids, [], 'no SkillGap supplied -> no fabricated evidence_pattern_ids');
  assert.deepStrictEqual(item.traceability.evidence_refs, [], 'no evidence_refs supplied -> empty, not fabricated');
  assert.deepStrictEqual(item.traceability.source_skill_gap_ids, ['gap_1'], 'source_skill_gap_ids still comes straight from the Recommendation itself');
})();

// ================================================================
// Prescription
// ================================================================

// 15. existing prescription summary projects correctly
(function () {
  var item = DB.projectRecommendation({ recommendation: rec(), prescription: rx() }).dashboard_item;
  assert.strictEqual(item.prescription_summary.training_objective_code, 'SHOT_EXECUTION');
  assert.strictEqual(item.prescription_summary.training_mode, 'TECHNICAL_REPETITION');
  assert.strictEqual(item.prescription_summary.drill_family_code, 'SHOT_EXECUTION');
  assert.strictEqual(item.prescription_summary.kpi_profile_code, 'EXECUTION_SUCCESS_RATE');
  assert.strictEqual(item.prescription_summary.dosage_profile_code, 'PRIMARY_FOCUS');
})();

// 16. unresolved drill remains UNRESOLVED
(function () {
  var item = DB.projectRecommendation({ recommendation: rec(), prescription: rx() }).dashboard_item;
  assert.strictEqual(item.prescription_summary.drill_resolution_status, 'UNRESOLVED');
  assert.deepStrictEqual(item.prescription_summary.resolved_drill_ids, []);
  assert.strictEqual(item.prescription_summary.drill_resolution_status_label, 'Not yet resolved', 'humanized label is additive, raw code unchanged');
})();

// 17. BENCHMARK_NOT_RESOLVED remains explicit
(function () {
  var item = DB.projectRecommendation({ recommendation: rec(), prescription: rx() }).dashboard_item;
  assert.strictEqual(item.prescription_summary.kpi_target_status, 'BENCHMARK_NOT_RESOLVED');
  assert.strictEqual(item.prescription_summary.kpi_target_value, null);
})();

// 18. Dashboard does not generate drill/KPI targets — a resolved-looking prescription still only
// ever reflects exactly what was passed in, nothing invented on top.
(function () {
  var item = DB.projectRecommendation({
    recommendation: rec(),
    prescription: rx({ resolved_drill_ids: ['drill_9'], drill_resolution_status: 'RESOLVED', kpi_target_value: 0.8, kpi_target_status: 'RESOLVED' })
  }).dashboard_item;
  assert.deepStrictEqual(item.prescription_summary.resolved_drill_ids, ['drill_9'], 'passthrough only, not generated');
  assert.strictEqual(item.prescription_summary.kpi_target_value, 0.8, 'passthrough only, not generated');
})();

// ================================================================
// Workflow
// ================================================================

// 19. normal workflow state projects correctly
(function () {
  var item = DB.projectRecommendation({ recommendation: rec(), workflow: cycle({ state: 'TRAINING_ACTIVE' }) }).dashboard_item;
  assert.strictEqual(item.workflow_state, 'TRAINING_ACTIVE');
  assert.strictEqual(item.reassessment_pending, false);
})();

// 20. REASSESSMENT_READY is visible
(function () {
  var item = DB.projectRecommendation({ recommendation: rec(), prescription: rx(), workflow: cycle({ state: 'REASSESSMENT_READY' }) }).dashboard_item;
  assert.strictEqual(item.workflow_state, 'REASSESSMENT_READY');
  assert.strictEqual(item.reassessment_pending, true);
})();

// 21. stale recommendation is not presented as unquestionably fresh
(function () {
  var item = DB.projectRecommendation({ recommendation: rec(), prescription: rx(), workflow: cycle({ state: 'REASSESSMENT_READY' }) }).dashboard_item;
  var codes = item.presentation_notes.map(function (n) { return n.code; });
  assert.ok(codes.indexOf('REASSESSMENT_REQUIRED') !== -1, 'explicit reassessment-required note present');
  // the prior recommendation/prescription remain visible for audit, not deleted
  assert.strictEqual(item.recommendation_code, 'IMPROVE_SHOT_EXECUTION');
  assert.ok(item.prescription_summary, 'prior prescription summary remains visible for history');
})();

// ================================================================
// Empty / Partial
// ================================================================

// 22. no recommendation != everything good
(function () {
  var out = DB.projectDashboardList([]);
  assert.strictEqual(out.dashboard.item_count, 0);
  assert.strictEqual(out.dashboard.message_code, 'NO_RECOMMENDATION');
  assert.strictEqual(out.dashboard.message, 'No active recommendation available');
})();

// 23. recommendation without prescription handled
(function () {
  var item = DB.projectRecommendation({ recommendation: rec() }).dashboard_item; // no prescription
  assert.strictEqual(item.prescription_status, 'NOT_AVAILABLE');
  assert.strictEqual(item.prescription_ref, null);
  assert.strictEqual(item.prescription_summary, null);
  var codes = item.presentation_notes.map(function (n) { return n.code; });
  assert.ok(codes.indexOf('PRESCRIPTION_MISSING') !== -1);
})();

// 24. unresolved drill handled
(function () {
  var item = DB.projectRecommendation({ recommendation: rec(), prescription: rx() }).dashboard_item; // UNRESOLVED drill
  var codes = item.presentation_notes.map(function (n) { return n.code; });
  assert.ok(codes.indexOf('DRILL_UNRESOLVED') !== -1);
})();

// ================================================================
// Determinism
// ================================================================

// 25. same inputs produce identical output
(function () {
  var input = { recommendation: rec(), prescription: rx(), workflow: cycle(), skill_gaps: [skillGap()], evidence_refs: ['ev_1'] };
  var a = DB.projectRecommendation(input);
  var b = DB.projectRecommendation(input);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  var listA = DB.projectDashboardList([input, { recommendation: rec({ recommendation_id: 'rec_2', rank: 2 }) }]);
  var listB = DB.projectDashboardList([input, { recommendation: rec({ recommendation_id: 'rec_2', rank: 2 }) }]);
  assert.strictEqual(JSON.stringify(listA), JSON.stringify(listB));
})();

// ================================================================
// Architecture protection
// ================================================================

// 26/27/28. Dashboard adapter implements no priority formula, no recommendation engine, no
// prescription engine — structural source scan: this module must never require/reference any
// S9/S10-A engine or storage module (the same technique js/workflow-integration-engine.js's own
// test #22 uses to prove it never recalculates an upstream decision).
(function () {
  var src = fs.readFileSync(path.join(__dirname, '../js/dashboard-integration-engine.js'), 'utf8');
  var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  var forbidden = [
    'PBMatchObservation', 'PBPerformanceAnalysis', 'PBDiagnosis',
    'PBRecommendationPriority', 'PBTrainingPrescription', 'PBWorkflow', 'PBStore', 'require('
  ];
  forbidden.forEach(function (token) {
    assert.ok(stripped.indexOf(token) === -1, 'dashboard-integration-engine.js must never reference ' + token + ' (found outside comments)');
  });
})();

// ================================================================
// Regression — the accepted S9 + S10-A suites this stage's inputs come from must stay green.
// ================================================================
(function () {
  var cp = require('child_process');
  var relevantSuites = [
    'recommendation-priority-engine.test.js', 'training-prescription-engine.test.js',
    's9-full-system-qa.test.js', 'workflow-integration-engine.test.js'
  ];
  relevantSuites.forEach(function (suite) {
    var res = cp.spawnSync(process.execPath, [path.join(__dirname, suite)], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, 'accepted suite ' + suite + ' must still pass unmodified:\n' + res.stdout + res.stderr);
  });
})();

console.log('dashboard-integration-engine.test.js: all assertions passed');
