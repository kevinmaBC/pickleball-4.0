/* tests/home-dashboard-adapter.test.js — S11-B: Home / Priority
 * Dashboard Experience Adapter
 * Run: node tests/home-dashboard-adapter.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

delete require.cache[require.resolve('../js/home-dashboard-adapter.js')];
var A = require('../js/home-dashboard-adapter.js');
delete require.cache[require.resolve('../js/product-journey-orchestrator.js')];
var PJ = require('../js/product-journey-orchestrator.js');
delete require.cache[require.resolve('../js/dashboard-integration-engine.js')];
var DB = require('../js/dashboard-integration-engine.js');

function assertThrows(fn, label, expectedCode) {
  var threw = null;
  try { fn(); } catch (e) { threw = e; }
  assert.ok(threw instanceof Error, label + ' throws an Error');
  if (expectedCode) assert.strictEqual(threw.code, expectedCode, label + ' code should be ' + expectedCode);
}

// ================================================================
// Fixtures — minimal shapes matching PBDashboard's own dashboard_item
// contract (per tests/dashboard-integration-engine.test.js) and
// PBProductJourney's own journey contract (per
// tests/product-journey-orchestrator.test.js).
// ================================================================

function dashboardItem(overrides) {
  return Object.assign({
    recommendation_id: 'rec:m1:IMPROVE_SHOT_EXECUTION:drop:-',
    rank: 1, rank_status: 'RESOLVED', priority_tier: 'HIGH', priority_score: 74,
    skill: 'drop', context: null, recommendation_code: 'IMPROVE_SHOT_EXECUTION',
    status: 'ACTIVE', engine_status: 'recommended',
    traceability: { source_skill_gap_ids: ['gap_1'], evidence_pattern_ids: ['pat_1'], evidence_refs: ['ev_1'] },
    prescription_ref: null, prescription_status: 'NOT_AVAILABLE', prescription_summary: null,
    workflow_state: 'UNRESOLVED', reassessment_pending: false, presentation_notes: [],
    schema_version: '1.0', dashboard_version: 'S10-B-V1'
  }, overrides || {});
}

function prescriptionSummary(overrides) {
  return Object.assign({
    prescription_id: 'rx_1', training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION',
    drill_family_code: 'SHOT_EXECUTION', kpi_profile_code: 'EXECUTION_SUCCESS_RATE',
    kpi_target_value: null, kpi_target_status: 'BENCHMARK_NOT_RESOLVED', kpi_target_status_label: null,
    dosage_profile_code: 'PRIMARY_FOCUS', resolved_drill_ids: [], drill_resolution_status: 'UNRESOLVED',
    drill_resolution_status_label: null, reassessment_profile_code: 'MATCH_RECHECK', status: 'prescribed'
  }, overrides || {});
}

function dashboard(items) { return { items: items || [], item_count: (items || []).length, schema_version: '1.0', dashboard_version: 'S10-B-V1' }; }

function journeyFor(overrides) {
  return {
    player_id: 'p1', cycle_ref: null, stage: 'NEEDS_ASSESSMENT', status: 'READY', headline_code: 'NO_ACTIVE_CYCLE',
    next_action: { code: 'START_ASSESSMENT', enabled: true, target_ref: null },
    secondary_actions: [], current_focus: { recommendation_ref: null, priority_rank: null, prescription_ref: null },
    workflow_context: { development_cycle_state: null, prescription_workflow_state: null },
    progress_context: null, reassessment: { required: false, match_required: false, reassessment_ref: null },
    presentation_flags: [], schema_version: '1.0', journey_version: 'S11-A-V1'
  };
}

// ================================================================
// A1 — New player: no cycle, no recommendation -> honest empty state
// ================================================================
(function () {
  var journey = PJ.projectJourney({ player: { player_id: 'p1' } }).journey;
  var out = A.composeHomeDashboard({ player_id: 'p1', journey: journey, dashboard: dashboard([]) });
  var h = out.home_dashboard;
  assert.strictEqual(h.journey.stage, 'NEEDS_ASSESSMENT', 'A1 stage');
  assert.strictEqual(h.next_action.code, 'START_ASSESSMENT', 'A1 next_action preserved from S11-A');
  assert.strictEqual(h.next_action.enabled, true, 'A1 enabled');
  assert.strictEqual(h.focus, null, 'A1 no fabricated focus');
  assert.strictEqual(h.why, null, 'A1 no fabricated why');
  assert.strictEqual(h.training, null, 'A1 no fabricated training');
})();

// ================================================================
// A2 — Recommendation ready: S10-B focus available, no prescription yet
// ================================================================
(function () {
  var cycle = { cycle_id: 'cyc_1', player_id: 'p1', baseline_ref: 'asm_1', evidence_refs: ['ev_1'], recommendation_refs: ['rec:m1:IMPROVE_SHOT_EXECUTION:drop:-'], priority_ref: null, prescription_refs: [], training_session_refs: [], progress_evidence_refs: [], reassessment_ref: null, state: 'RECOMMENDATION_READY', schema_version: '1.0' };
  var journey = PJ.projectJourney({ player: { player_id: 'p1' }, development_cycle: cycle }).journey;
  var db = DB.projectDashboardList([{ recommendation: { recommendation_id: 'rec:m1:IMPROVE_SHOT_EXECUTION:drop:-', rank: 1, status: 'recommended', skill: 'drop', context: null, recommendation_code: 'IMPROVE_SHOT_EXECUTION', priority_tier: 'HIGH', source_skill_gap_ids: ['gap_1'] }, skill_gaps: [{ skill_gap_id: 'gap_1', evidence_pattern_ids: ['pat_1'] }] }]).dashboard;
  var out = A.composeHomeDashboard({ player_id: 'p1', journey: journey, dashboard: db });
  var h = out.home_dashboard;
  assert.strictEqual(h.journey.stage, 'REVIEW_RECOMMENDATION', 'A2 stage');
  assert.ok(h.focus, 'A2 focus available');
  assert.strictEqual(h.focus.recommendation_code, 'IMPROVE_SHOT_EXECUTION', 'A2 focus recommendation_code');
  assert.strictEqual(h.training, null, 'A2 training not yet available (section 22)');
})();

// ================================================================
// A3 — Prescription ready: training direction available
// ================================================================
(function () {
  var cycle = { cycle_id: 'cyc_1', player_id: 'p1', baseline_ref: 'asm_1', evidence_refs: ['ev_1'], recommendation_refs: ['rec_1'], priority_ref: null, prescription_refs: ['rx_1'], training_session_refs: [], progress_evidence_refs: [], reassessment_ref: null, state: 'PRESCRIPTION_READY', schema_version: '1.0' };
  var workflow = { workflow_id: 'pwf_1', prescription_ref: 'rx_1', recommendation_ref: 'rec_1', player_id: 'p1', state: 'DRAFTED' };
  var journey = PJ.projectJourney({ player: { player_id: 'p1' }, development_cycle: cycle, prescriptions: [{ prescription_id: 'rx_1', source_recommendation_id: 'rec_1', status: 'prescribed' }], prescription_workflows: [workflow] }).journey;
  var db = DB.projectDashboardList([{ recommendation: { recommendation_id: 'rec_1', rank: 1, status: 'recommended' }, prescription: { prescription_id: 'rx_1', training_objective_code: 'SHOT_EXECUTION', drill_resolution_status: 'RESOLVED', kpi_target_status: 'AT_TARGET', status: 'prescribed' } }]).dashboard;
  var out = A.composeHomeDashboard({ player_id: 'p1', journey: journey, dashboard: db });
  var h = out.home_dashboard;
  assert.strictEqual(h.journey.stage, 'READY_TO_TRAIN', 'A3 stage');
  assert.strictEqual(h.next_action.code, 'ACTIVATE_PRESCRIPTION', 'A3 next_action');
  assert.ok(h.training, 'A3 training available');
  assert.strictEqual(h.training.objective, 'SHOT_EXECUTION', 'A3 training objective');
})();

// ================================================================
// A4 — Training active: rank ordering preserved (S10-B upstream rank, never re-sorted)
// ================================================================
(function () {
  var cycle = { cycle_id: 'cyc_1', player_id: 'p1', baseline_ref: 'asm_1', evidence_refs: ['ev_1'], recommendation_refs: ['rec_1'], priority_ref: null, prescription_refs: ['rx_1'], training_session_refs: [], progress_evidence_refs: [], reassessment_ref: null, state: 'TRAINING_ACTIVE', schema_version: '1.0' };
  var journey = PJ.projectJourney({ player: { player_id: 'p1' }, development_cycle: cycle, prescription_workflows: [{ workflow_id: 'pwf_1', prescription_ref: 'rx_1', player_id: 'p1', state: 'ACTIVE' }] }).journey;
  var db = DB.projectDashboardList([
    { recommendation: { recommendation_id: 'rec_2', rank: 2, status: 'recommended', skill: 'serve' } },
    { recommendation: { recommendation_id: 'rec_1', rank: 1, status: 'recommended', skill: 'drop' } }
  ]).dashboard;
  var out = A.composeHomeDashboard({ player_id: 'p1', journey: journey, dashboard: db });
  var h = out.home_dashboard;
  assert.strictEqual(h.journey.stage, 'TRAINING_IN_PROGRESS', 'A4 stage');
  assert.strictEqual(h.next_action.code, 'CONTINUE_TRAINING', 'A4 next_action');
  assert.strictEqual(h.focus.skill, 'drop', 'A4 focus is dashboard.items[0] (rank 1), never re-sorted by the adapter');
})();

// ================================================================
// A5 — Progress recorded
// ================================================================
(function () {
  var cycle = { cycle_id: 'cyc_1', player_id: 'p1', baseline_ref: 'asm_1', evidence_refs: ['ev_1', 'ev_2'], recommendation_refs: ['rec_1'], priority_ref: null, prescription_refs: ['rx_1'], training_session_refs: [], progress_evidence_refs: ['pg_1'], reassessment_ref: null, state: 'PROGRESS_RECORDED', schema_version: '1.0' };
  var journey = PJ.projectJourney({ player: { player_id: 'p1' }, development_cycle: cycle }).journey;
  var out = A.composeHomeDashboard({ player_id: 'p1', journey: journey, dashboard: dashboard([]) });
  assert.strictEqual(out.home_dashboard.journey.stage, 'REVIEW_PROGRESS', 'A5 stage');
  assert.strictEqual(out.home_dashboard.next_action.code, 'REVIEW_PROGRESS', 'A5 next_action');
  assert.ok(out.home_dashboard.flags.indexOf('PROGRESS_NOT_YET_AVAILABLE') !== -1, 'A5 honest flag when no progress supplied');
})();

// ================================================================
// A6 — Reassessment ready: never Start/Continue Training as primary
// ================================================================
(function () {
  var cycle = { cycle_id: 'cyc_1', player_id: 'p1', baseline_ref: 'asm_1', evidence_refs: ['ev_1', 'ev_2', 'ev_3'], recommendation_refs: ['rec_1'], priority_ref: null, prescription_refs: ['rx_1'], training_session_refs: [], progress_evidence_refs: [], reassessment_ref: null, state: 'REASSESSMENT_READY', schema_version: '1.0' };
  var journey = PJ.projectJourney({ player: { player_id: 'p1' }, development_cycle: cycle, prescription_workflows: [{ workflow_id: 'pwf_1', prescription_ref: 'rx_1', player_id: 'p1', state: 'ACTIVE' }] }).journey;
  var out = A.composeHomeDashboard({ player_id: 'p1', journey: journey, dashboard: dashboard([]) });
  var h = out.home_dashboard;
  assert.strictEqual(h.journey.stage, 'READY_TO_REASSESS', 'A6 stage');
  assert.strictEqual(h.next_action.code, 'RECORD_REAL_MATCH', 'A6 next_action');
  assert.notStrictEqual(h.next_action.code, 'START_TRAINING', 'A6 never Start Training as primary');
  assert.notStrictEqual(h.next_action.code, 'CONTINUE_TRAINING', 'A6 never Continue Training as primary');
  assert.ok(h.flags.indexOf('REASSESSMENT_REQUIRED') !== -1, 'A6 REASSESSMENT_REQUIRED flag');
  assert.ok(h.flags.indexOf('STALE_PRESCRIPTION') !== -1, 'A6 STALE_PRESCRIPTION flag');
})();

// ================================================================
// A7 — Drill unresolved: preserved verbatim, never hidden/fabricated/FAILED
// ================================================================
(function () {
  var journey = journeyFor();
  var db = dashboard([dashboardItem({ prescription_ref: 'rx_1', prescription_status: 'AVAILABLE', prescription_summary: prescriptionSummary({ drill_resolution_status: 'UNRESOLVED' }) })]);
  var out = A.composeHomeDashboard({ player_id: 'p1', journey: journey, dashboard: db });
  assert.strictEqual(out.home_dashboard.training.drill_resolution_status, 'UNRESOLVED', 'A7 raw code preserved');
  assert.notStrictEqual(out.home_dashboard.training.drill_resolution_status, 'FAILED', 'A7 never translated to FAILED');
})();

// ================================================================
// A8 — MATCH insufficient data: TRAINING/MATCH stay separated
// ================================================================
(function () {
  var journey = journeyFor({});
  journey.progress_context = {
    training: { source: 'TRAINING', trend: 'IMPROVING', baseline_value: 0.5, current_value: 0.6 },
    match: { source: 'MATCH', trend: 'INSUFFICIENT_DATA', baseline_value: null, current_value: null }
  };
  var out = A.composeHomeDashboard({ player_id: 'p1', journey: journey, dashboard: dashboard([]) });
  assert.ok(out.home_dashboard.flags.indexOf('MATCH_TRANSFER_NOT_VALIDATED') !== -1, 'A8 match transfer honesty flag');
  // No numeric MATCH value is ever surfaced in the Home View Model schema itself (§20) —
  // confirms TRAINING's own resolved trend never substitutes for it.
  assert.strictEqual(JSON.stringify(out.home_dashboard).indexOf('0.6'), -1, 'A8 no fabricated/leaked numeric MATCH value');
})();

// ================================================================
// MATCH already resolved -> honesty flag must NOT fire
// ================================================================
(function () {
  var journey = journeyFor({});
  journey.progress_context = { training: null, match: { source: 'MATCH', trend: 'IMPROVING', baseline_value: 0.4, current_value: 0.5 } };
  var out = A.composeHomeDashboard({ player_id: 'p1', journey: journey, dashboard: dashboard([]) });
  assert.strictEqual(out.home_dashboard.flags.indexOf('MATCH_TRANSFER_NOT_VALIDATED'), -1, 'flag must not fire when MATCH progress is genuinely resolved');
})();

// ================================================================
// Structurally invalid input -> explicit error, never a silent guess
// ================================================================
(function () {
  assertThrows(function () { A.composeHomeDashboard({}); }, 'missing player_id', 'INVALID_INPUT');
  assertThrows(function () { A.composeHomeDashboard({ player_id: 'p1' }); }, 'missing journey', 'INVALID_INPUT');
})();

// ================================================================
// pickCurrentCycle — most recently updated cycle wins, regardless of state
// ================================================================
(function () {
  var cycles = [
    { cycle_id: 'a', state: 'CYCLE_COMPLETED', updated_at: '2026-01-01T00:00:00.000Z' },
    { cycle_id: 'b', state: 'TRAINING_ACTIVE', updated_at: '2026-02-01T00:00:00.000Z' }
  ];
  assert.strictEqual(A.pickCurrentCycle(cycles).cycle_id, 'b', 'most recently updated cycle wins');
  assert.strictEqual(A.pickCurrentCycle([]), null);
})();

// ================================================================
// Determinism — same input twice -> identical output
// ================================================================
(function () {
  var journey = journeyFor();
  var db = dashboard([dashboardItem()]);
  var out1 = A.composeHomeDashboard({ player_id: 'p1', journey: journey, dashboard: db });
  var out2 = A.composeHomeDashboard({ player_id: 'p1', journey: journey, dashboard: db });
  assert.strictEqual(JSON.stringify(out1), JSON.stringify(out2), 'identical input yields identical output');
})();

// ================================================================
// Architecture protection — structural source scan. The adapter's only legitimate decision
// engines are the same accepted S9 public entry points js/review-ui.js's own loadDashboardData
// already uses, plus the two accepted projection layers (PBDashboard/PBProductJourney) — it must
// never call a workflow transition, session-evidence, progress, or reassessment engine.
// ================================================================
var SRC = fs.readFileSync(path.join(__dirname, '../js/home-dashboard-adapter.js'), 'utf8');
var STRIPPED = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
(function () {
  var forbidden = [
    'PBWorkflow', 'PBPrescriptionWorkflow', 'PBSessionEvidence', 'PBProgressTracking',
    'PBReassessment', 'PBProgressReassessmentPersistence', 'PBCycleBaseline',
    '.transition(', 'startTraining(', 'supersede(', 'computeProgress', 'runReassessment',
    'checkReassessmentEligibility'
  ];
  forbidden.forEach(function (token) {
    assert.ok(STRIPPED.indexOf(token) === -1, 'home-dashboard-adapter.js must never reference ' + token);
  });
  // The only legitimate S9/S10/S11-A engine calls (mirrors js/review-ui.js's own accepted chain).
  ['PBDiagnosis.diagnoseMatch', 'PBRecommendationPriority.prioritizeDiagnosis', 'PBTrainingPrescription.prescribeRecommendations', 'PBDashboard', 'PBProductJourney', 'PBStore'].forEach(function (token) {
    assert.ok(STRIPPED.indexOf(token) !== -1, 'home-dashboard-adapter.js should reference ' + token);
  });
})();

// ================================================================
// No persistence — every PBStore call is a read; nothing is ever written.
// ================================================================
(function () {
  var writeTokens = ['PBStore.put', 'PBStore.createPlayer', 'PBStore.createAssessment', 'PBStore.del(', 'createObjectStore', 'deleteObjectStore'];
  writeTokens.forEach(function (token) {
    assert.ok(STRIPPED.indexOf(token) === -1, 'home-dashboard-adapter.js must never write to PBStore: ' + token);
  });
})();

// ================================================================
// Regression — the accepted suites this stage's inputs are shaped from must stay green.
// ================================================================
(function () {
  var cp = require('child_process');
  var relevantSuites = ['product-journey-orchestrator.test.js', 'dashboard-integration-engine.test.js'];
  relevantSuites.forEach(function (suite) {
    var res = cp.spawnSync(process.execPath, [path.join(__dirname, suite)], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, 'accepted suite ' + suite + ' must still pass unmodified:\n' + res.stdout + res.stderr);
  });
})();

console.log('home-dashboard-adapter.test.js: all assertions passed');
