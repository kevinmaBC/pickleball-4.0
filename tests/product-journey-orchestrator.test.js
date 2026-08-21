/* tests/product-journey-orchestrator.test.js — S11-A: Product Journey
 * Orchestrator / User State Contract
 * Run: node tests/product-journey-orchestrator.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

delete require.cache[require.resolve('../js/product-journey-orchestrator.js')];
var PJ = require('../js/product-journey-orchestrator.js');

function assertThrows(fn, label, expectedCode) {
  var threw = null;
  try { fn(); } catch (e) { threw = e; }
  assert.ok(threw instanceof Error, label + ' throws an Error');
  if (expectedCode) assert.strictEqual(threw.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + (threw && threw.code) + ')');
}

// ================================================================
// Fixtures — minimal upstream shapes matching the real S9/S10 engines'
// accepted output (per docs/S9-E/F, S10-A/C/D/E-R1), same convention
// tests/dashboard-integration-engine.test.js already uses.
// ================================================================

function player(overrides) {
  return Object.assign({ player_id: 'p1', name: 'Test Player' }, overrides || {});
}

function cycle(overrides) {
  return Object.assign({
    cycle_id: 'cyc_1', player_id: 'p1', baseline_ref: 'asm_1',
    evidence_refs: [], recommendation_refs: [], priority_ref: null, prescription_refs: [],
    training_session_refs: [], progress_evidence_refs: [], reassessment_ref: null,
    state: 'BASELINE_READY', schema_version: '1.0'
  }, overrides || {});
}

var REC_ID = 'rec:m1:IMPROVE_SHOT_EXECUTION:drop:-';
var RX_ID = 'rx:m1:rec:m1:IMPROVE_SHOT_EXECUTION:drop:-';

function rec(overrides) {
  return Object.assign({
    recommendation_id: REC_ID, match_id: 'm1', player_id: 'p1',
    diagnosis_code: 'SHOT_EXECUTION_GAP', skill: 'drop', context: null,
    recommendation_code: 'IMPROVE_SHOT_EXECUTION', source_skill_gap_ids: ['gap_1'],
    severity_score: 60, confidence_score: 65, diagnosis_priority_signal: 74,
    priority_score: 74, priority_tier: 'HIGH', reason_signals: ['HIGH_SEVERITY'],
    rank: 1, status: 'recommended'
  }, overrides || {});
}

function rx(overrides) {
  return Object.assign({
    prescription_id: RX_ID, match_id: 'm1', player_id: 'p1',
    source_recommendation_id: REC_ID, recommendation_code: 'IMPROVE_SHOT_EXECUTION',
    skill: 'drop', context: null,
    training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION',
    drill_family_code: 'SHOT_EXECUTION', priority_rank: 1, priority_score: 74, priority_tier: 'HIGH',
    kpi_profile_code: 'EXECUTION_SUCCESS_RATE', kpi_target_value: null, kpi_target_status: 'BENCHMARK_NOT_RESOLVED',
    dosage_profile_code: 'PRIMARY_FOCUS', reassessment_profile_code: 'MATCH_RECHECK',
    resolved_drill_ids: [], drill_resolution_status: 'UNRESOLVED', status: 'prescribed'
  }, overrides || {});
}

function workflow(overrides) {
  return Object.assign({
    workflow_id: 'pwf_1', prescription_ref: RX_ID, recommendation_ref: REC_ID, player_id: 'p1',
    state: 'DRAFTED', session_refs: [], activated_at: null, completed_at: null, superseded_by: null,
    prescription_snapshot: {}, schema_version: '1.0', contract_version: 'S10-C-V1'
  }, overrides || {});
}

function sessionExecution(overrides) {
  return Object.assign({
    session_id: 'sint_1', prescription_ref: RX_ID, player_id: 'p1', state: 'ACTIVE',
    training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION',
    kpi_profile_code: 'EXECUTION_SUCCESS_RATE', started_at: '2026-01-01T00:00:00.000Z', completed_at: null
  }, overrides || {});
}

function progressSnapshot(overrides) {
  return Object.assign({
    progress_id: 'pg:cyc_1:TRAINING:EXECUTION_SUCCESS_RATE', cycle_id: 'cyc_1', player_id: 'p1',
    kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'TRAINING',
    baseline_value: 0.5, current_value: 0.6, absolute_delta: 0.1, percentage_point_delta: 10,
    relative_change: 0.2, evidence_count: 1, trend: 'IMPROVING', target_status: 'UNRESOLVED',
    baseline_ref: 'bl_1', current_evidence_ref: 'ev_1', schema_version: '1.0', contract_version: 'S10-E-R1-V1'
  }, overrides || {});
}

function reassessmentRecord(overrides) {
  return Object.assign({
    reassessment_id: 're:cyc_1:sess_x', cycle_id: 'cyc_1', player_id: 'p1',
    trigger: 'REAL_MATCH_OBSERVATION', match_session_id: 'sess_x',
    input_evidence_refs: [], previous_recommendation_refs: [], new_recommendation_refs: [],
    comparison: [], status: 'COMPLETED', created_at: '2026-01-01T00:00:00.000Z',
    schema_version: '1.0', contract_version: 'S10-E-R1-V1'
  }, overrides || {});
}

// ================================================================
// T01 — New Player: no active cycle -> NEEDS_ASSESSMENT / START_ASSESSMENT
// ================================================================
(function () {
  var out = PJ.projectJourney({ player: player() });
  var j = out.journey;
  assert.strictEqual(j.stage, 'NEEDS_ASSESSMENT', 'T01 stage');
  assert.strictEqual(j.cycle_ref, null, 'T01 no cycle_ref');
  assert.strictEqual(j.next_action.code, 'START_ASSESSMENT', 'T01 next_action');
  assert.strictEqual(j.next_action.enabled, true, 'T01 enabled');
  assert.strictEqual(j.status, 'READY', 'T01 status');
})();

// ================================================================
// T02 — Baseline Ready -> NEEDS_ASSESSMENT
// ================================================================
(function () {
  var out = PJ.projectJourney({ player: player(), development_cycle: cycle({ state: 'BASELINE_READY' }) });
  assert.strictEqual(out.journey.stage, 'NEEDS_ASSESSMENT', 'T02 stage');
  assert.strictEqual(out.journey.next_action.code, 'START_ASSESSMENT', 'T02 next_action');
  assert.strictEqual(out.journey.headline_code, 'BASELINE_READY', 'T02 headline preserves raw state');
})();

// ================================================================
// T03 — Evidence Available -> NEEDS_ASSESSMENT, no recommendation fabrication
// ================================================================
(function () {
  var out = PJ.projectJourney({
    player: player(),
    development_cycle: cycle({ state: 'EVIDENCE_AVAILABLE', evidence_refs: ['ev_1'] }),
    recommendations: [rec()] // present in input but must NOT be adopted — cycle has no recommendation_refs yet
  });
  assert.strictEqual(out.journey.stage, 'NEEDS_ASSESSMENT', 'T03 stage');
  assert.strictEqual(out.journey.next_action.code, 'START_ASSESSMENT', 'T03 next_action');
  assert.strictEqual(out.journey.current_focus.recommendation_ref, null, 'T03 no recommendation fabricated');
})();

// ================================================================
// T04 — Recommendation Ready -> REVIEW_RECOMMENDATION
// ================================================================
(function () {
  var out = PJ.projectJourney({
    player: player(),
    development_cycle: cycle({ state: 'RECOMMENDATION_READY', evidence_refs: ['ev_1'], recommendation_refs: [REC_ID] }),
    recommendations: [rec()]
  });
  assert.strictEqual(out.journey.stage, 'REVIEW_RECOMMENDATION', 'T04 stage');
  assert.strictEqual(out.journey.next_action.code, 'REVIEW_RECOMMENDATION', 'T04 next_action');
  assert.strictEqual(out.journey.current_focus.recommendation_ref, REC_ID, 'T04 current_focus');
  assert.strictEqual(out.journey.current_focus.priority_rank, 1, 'T04 rank copied verbatim');
})();

// ================================================================
// T05 — Prescription Ready -> READY_TO_TRAIN (DRAFTED -> ACTIVATE_PRESCRIPTION,
// ACTIVE -> START_TRAINING; never S10-C's own activation-gate logic re-implemented)
// ================================================================
(function () {
  var baseCycle = cycle({
    state: 'PRESCRIPTION_READY', evidence_refs: ['ev_1'], recommendation_refs: [REC_ID], prescription_refs: [RX_ID]
  });

  var outDrafted = PJ.projectJourney({
    player: player(), development_cycle: baseCycle,
    recommendations: [rec()], prescriptions: [rx()], prescription_workflows: [workflow({ state: 'DRAFTED' })]
  });
  assert.strictEqual(outDrafted.journey.stage, 'READY_TO_TRAIN', 'T05 DRAFTED stage');
  assert.strictEqual(outDrafted.journey.next_action.code, 'ACTIVATE_PRESCRIPTION', 'T05 DRAFTED next_action');
  assert.strictEqual(outDrafted.journey.next_action.target_ref, 'pwf_1', 'T05 DRAFTED target_ref');

  var outActive = PJ.projectJourney({
    player: player(), development_cycle: baseCycle,
    recommendations: [rec()], prescriptions: [rx()], prescription_workflows: [workflow({ state: 'ACTIVE' })]
  });
  assert.strictEqual(outActive.journey.next_action.code, 'START_TRAINING', 'T05 ACTIVE next_action');
})();

// ================================================================
// T06 — Training Active -> TRAINING_IN_PROGRESS
// ================================================================
(function () {
  var baseCycle = cycle({
    state: 'TRAINING_ACTIVE', evidence_refs: ['ev_1'], recommendation_refs: [REC_ID], prescription_refs: [RX_ID]
  });

  var outNoResume = PJ.projectJourney({
    player: player(), development_cycle: baseCycle,
    recommendations: [rec()], prescriptions: [rx()], prescription_workflows: [workflow({ state: 'ACTIVE' })]
  });
  assert.strictEqual(outNoResume.journey.stage, 'TRAINING_IN_PROGRESS', 'T06 stage');
  assert.strictEqual(outNoResume.journey.next_action.code, 'CONTINUE_TRAINING', 'T06 no-resume next_action');

  var outResume = PJ.projectJourney({
    player: player(), development_cycle: baseCycle,
    recommendations: [rec()], prescriptions: [rx()], prescription_workflows: [workflow({ state: 'ACTIVE' })],
    session_results: [sessionExecution({ state: 'ACTIVE' })]
  });
  assert.strictEqual(outResume.journey.next_action.code, 'RESUME_SESSION', 'T06 resume next_action');
  assert.strictEqual(outResume.journey.next_action.target_ref, 'sint_1', 'T06 resume target_ref');
})();

// ================================================================
// T07 — Session Completed -> REVIEW_PROGRESS
// ================================================================
(function () {
  var out = PJ.projectJourney({
    player: player(),
    development_cycle: cycle({ state: 'SESSION_COMPLETED', evidence_refs: ['ev_1', 'ev_2'], recommendation_refs: [REC_ID], prescription_refs: [RX_ID] })
  });
  assert.strictEqual(out.journey.stage, 'REVIEW_PROGRESS', 'T07 stage');
  assert.strictEqual(out.journey.next_action.code, 'REVIEW_PROGRESS', 'T07 next_action');
})();

// ================================================================
// T08 — Progress Recorded -> REVIEW_PROGRESS
// ================================================================
(function () {
  var out = PJ.projectJourney({
    player: player(),
    development_cycle: cycle({ state: 'PROGRESS_RECORDED', evidence_refs: ['ev_1', 'ev_2'], recommendation_refs: [REC_ID], prescription_refs: [RX_ID], progress_evidence_refs: ['pg_1'] }),
    progress: [progressSnapshot()]
  });
  assert.strictEqual(out.journey.stage, 'REVIEW_PROGRESS', 'T08 stage');
  assert.strictEqual(out.journey.next_action.code, 'REVIEW_PROGRESS', 'T08 next_action');
  assert.strictEqual(out.journey.status, 'READY', 'T08 status READY when progress available');
})();

// ================================================================
// T09 — Reassessment Precedence: REASSESSMENT_READY + an old ACTIVE/IN_PROGRESS
// prescription workflow must still yield READY_TO_REASSESS / RECORD_REAL_MATCH,
// never an enabled Start/Continue Training action.
// ================================================================
(function () {
  var out = PJ.projectJourney({
    player: player(),
    development_cycle: cycle({
      state: 'REASSESSMENT_READY', evidence_refs: ['ev_1', 'ev_2', 'ev_3'],
      recommendation_refs: [REC_ID], prescription_refs: [RX_ID]
    }),
    recommendations: [rec()], prescriptions: [rx()],
    prescription_workflows: [workflow({ state: 'ACTIVE' })],
    session_results: [sessionExecution({ state: 'ACTIVE' })]
  });
  var j = out.journey;
  assert.strictEqual(j.stage, 'READY_TO_REASSESS', 'T09 stage');
  assert.strictEqual(j.next_action.code, 'RECORD_REAL_MATCH', 'T09 next_action');
  assert.notStrictEqual(j.next_action.code, 'START_TRAINING', 'T09 never Start Training as primary');
  assert.notStrictEqual(j.next_action.code, 'CONTINUE_TRAINING', 'T09 never Continue Training as primary');
  assert.strictEqual(j.secondary_actions.length, 0, 'T09 no enabled secondary training action either');
  assert.strictEqual(j.reassessment.required, true, 'T09 reassessment.required');
  assert.strictEqual(j.reassessment.match_required, true, 'T09 reassessment.match_required');
  assert.ok(j.presentation_flags.indexOf('REASSESSMENT_REQUIRED') !== -1, 'T09 REASSESSMENT_REQUIRED flag');
  assert.ok(j.presentation_flags.indexOf('STALE_PRESCRIPTION') !== -1, 'T09 STALE_PRESCRIPTION flag');
  assert.ok(j.presentation_flags.indexOf('STALE_RECOMMENDATION') !== -1, 'T09 STALE_RECOMMENDATION flag');
  // historical references remain visible, not erased (T20 overlaps here)
  assert.strictEqual(j.current_focus.recommendation_ref, REC_ID, 'T09 historical recommendation still visible');
  assert.strictEqual(j.current_focus.prescription_ref, RX_ID, 'T09 historical prescription still visible');
})();

// ================================================================
// T10 — Cycle Complete -> CYCLE_COMPLETE
// ================================================================
(function () {
  var out = PJ.projectJourney({
    player: player(),
    development_cycle: cycle({ state: 'CYCLE_COMPLETED', evidence_refs: ['ev_1'], recommendation_refs: [REC_ID], prescription_refs: [RX_ID], progress_evidence_refs: ['pg_1'] })
  });
  assert.strictEqual(out.journey.stage, 'CYCLE_COMPLETE', 'T10 stage');
  assert.strictEqual(out.journey.next_action.code, 'START_NEXT_CYCLE', 'T10 next_action');
})();

// ================================================================
// T11 — Exactly One Primary Action across every stage
// ================================================================
(function () {
  var cases = [
    { player: player() },
    { player: player(), development_cycle: cycle({ state: 'BASELINE_READY' }) },
    { player: player(), development_cycle: cycle({ state: 'EVIDENCE_AVAILABLE' }) },
    { player: player(), development_cycle: cycle({ state: 'RECOMMENDATION_READY', recommendation_refs: [REC_ID] }), recommendations: [rec()] },
    { player: player(), development_cycle: cycle({ state: 'PRESCRIPTION_READY', recommendation_refs: [REC_ID], prescription_refs: [RX_ID] }), recommendations: [rec()], prescriptions: [rx()], prescription_workflows: [workflow()] },
    { player: player(), development_cycle: cycle({ state: 'TRAINING_ACTIVE', recommendation_refs: [REC_ID], prescription_refs: [RX_ID] }), prescriptions: [rx()], prescription_workflows: [workflow({ state: 'ACTIVE' })] },
    { player: player(), development_cycle: cycle({ state: 'SESSION_COMPLETED' }) },
    { player: player(), development_cycle: cycle({ state: 'PROGRESS_RECORDED' }) },
    { player: player(), development_cycle: cycle({ state: 'REASSESSMENT_READY', recommendation_refs: [REC_ID], prescription_refs: [RX_ID] }) },
    { player: player(), development_cycle: cycle({ state: 'CYCLE_COMPLETED' }) }
  ];
  cases.forEach(function (input, i) {
    var j = PJ.projectJourney(input).journey;
    assert.ok(j.next_action && typeof j.next_action === 'object' && !Array.isArray(j.next_action), 'T11[' + i + '] next_action is a single object');
    assert.ok(PJ.NEXT_ACTIONS.indexOf(j.next_action.code) !== -1, 'T11[' + i + '] next_action.code is in frozen vocabulary');
    assert.ok(Array.isArray(j.secondary_actions), 'T11[' + i + '] secondary_actions is an array');
  });
})();

// ================================================================
// Architecture protection (T12-T14, T17) — structural source scan, the same
// technique tests/dashboard-integration-engine.test.js's own test #26-28 uses.
// ================================================================
var ORCHESTRATOR_SRC = fs.readFileSync(path.join(__dirname, '../js/product-journey-orchestrator.js'), 'utf8');
var STRIPPED_SRC = ORCHESTRATOR_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

// T12 — No S9 Decision Invocation
(function () {
  var forbidden = ['PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'diagnoseMatch', 'prioritizeDiagnosis', 'prescribeRecommendations'];
  forbidden.forEach(function (token) {
    assert.ok(STRIPPED_SRC.indexOf(token) === -1, 'T12: must never reference ' + token);
  });
})();

// T13 — No Progress/Reassessment Recalculation
(function () {
  var forbidden = ['PBProgressTracking', 'PBReassessment', 'PBCycleBaseline', 'computeProgress', 'computeProgressSnapshot', 'runReassessment', 'checkReassessmentEligibility'];
  forbidden.forEach(function (token) {
    assert.ok(STRIPPED_SRC.indexOf(token) === -1, 'T13: must never reference ' + token);
  });
})();

// T14 — No Workflow Transition Ownership
(function () {
  var forbidden = ['PBWorkflow', 'PBPrescriptionWorkflow', 'PBSessionEvidence', '.transition(', 'startTraining(', 'supersede('];
  forbidden.forEach(function (token) {
    assert.ok(STRIPPED_SRC.indexOf(token) === -1, 'T14: must never reference ' + token);
  });
})();

// T17 — No Persistence
(function () {
  var forbidden = ['PBStore', 'indexedDB', 'IDBKeyRange', 'localStorage', 'require('];
  forbidden.forEach(function (token) {
    assert.ok(STRIPPED_SRC.indexOf(token) === -1, 'T17: must never reference ' + token);
  });
})();

// ================================================================
// T15 — UNRESOLVED Preservation
// ================================================================
(function () {
  var out = PJ.projectJourney({
    player: player(),
    development_cycle: cycle({ state: 'PRESCRIPTION_READY', recommendation_refs: [REC_ID], prescription_refs: [RX_ID] }),
    recommendations: [rec()],
    prescriptions: [rx({ drill_resolution_status: 'UNRESOLVED', kpi_target_status: 'BENCHMARK_NOT_RESOLVED' })],
    prescription_workflows: [workflow({ state: 'DRAFTED' })]
  });
  assert.ok(out.journey.presentation_flags.indexOf('DRILL_UNRESOLVED') !== -1, 'T15 DRILL_UNRESOLVED preserved');
  assert.ok(out.journey.presentation_flags.indexOf('KPI_TARGET_UNRESOLVED') !== -1, 'T15 KPI_TARGET_UNRESOLVED preserved');

  var outProgress = PJ.projectJourney({
    player: player(),
    development_cycle: cycle({ state: 'PROGRESS_RECORDED' }),
    progress: [progressSnapshot({ trend: 'INSUFFICIENT_DATA', baseline_value: null, current_value: null, target_status: 'UNRESOLVED' })]
  });
  assert.strictEqual(outProgress.journey.progress_context.training.trend, 'INSUFFICIENT_DATA', 'T15 INSUFFICIENT_DATA preserved verbatim');
  assert.strictEqual(outProgress.journey.progress_context.training.target_status, 'UNRESOLVED', 'T15 UNRESOLVED target_status preserved verbatim');
})();

// ================================================================
// T16 — TRAINING / MATCH Separation
// ================================================================
(function () {
  var out = PJ.projectJourney({
    player: player(),
    development_cycle: cycle({ state: 'PROGRESS_RECORDED' }),
    progress: [
      progressSnapshot({ source: 'TRAINING', trend: 'IMPROVING' }),
      progressSnapshot({ progress_id: 'pg:cyc_1:MATCH:EXECUTION_SUCCESS_RATE', source: 'MATCH', trend: 'INSUFFICIENT_DATA', baseline_value: null, current_value: null })
    ]
  });
  var pc = out.journey.progress_context;
  assert.strictEqual(pc.training.trend, 'IMPROVING', 'T16 training trend independent');
  assert.strictEqual(pc.match.trend, 'INSUFFICIENT_DATA', 'T16 match trend independent');
  assert.ok(out.journey.presentation_flags.indexOf('MATCH_PROGRESS_INSUFFICIENT_DATA') !== -1, 'T16 match unresolved flag');
  assert.notStrictEqual(pc.training.trend, pc.match.trend, 'T16 TRAINING never substitutes for MATCH');
})();

// ================================================================
// T18 — DB_VERSION / stores unaffected (regression guard — S11-A must never touch schema).
// Async (real IndexedDB.open is async even against the fake) — deferred to the Promise chain
// at the bottom of this file so a failure here still fails the whole suite (exit code 1).
// ================================================================
function checkDbVersionAndStores() {
  delete require.cache[require.resolve('../js/storage.js')];
  var Store = require('../js/storage.js');
  assert.strictEqual(Store.DB_VERSION, 5, 'T18 DB_VERSION remains 5');

  var EXPECTED_STORES = [
    'players', 'assessments', 'test_sessions', 'trial_events',
    'review_snapshots', 'prescriptions', 'retests',
    'training_cycles', 'weekly_plans', 'session_plans', 'session_logs', 'cycle_summaries',
    'development_cycles', 'prescription_workflows', 'session_results', 'training_evidence',
    'cycle_kpi_baselines', 'reassessments'
  ];
  assert.strictEqual(EXPECTED_STORES.length, 18, 'T18 fixture store list itself is 18 entries');

  var createFakeIndexedDB = require('./fake-indexeddb');
  var savedIDB = global.indexedDB;
  global.indexedDB = createFakeIndexedDB();
  delete require.cache[require.resolve('../js/storage.js')];
  var StoreFresh = require('../js/storage.js');
  return StoreFresh.open().then(function (db) {
    EXPECTED_STORES.forEach(function (name) {
      assert.ok(db.objectStoreNames.contains(name), 'T18 store present: ' + name);
    });
    global.indexedDB = savedIDB;
  });
}

// ================================================================
// T19 — Deterministic Regeneration
// ================================================================
(function () {
  var input = {
    player: player(),
    development_cycle: cycle({ state: 'PRESCRIPTION_READY', recommendation_refs: [REC_ID], prescription_refs: [RX_ID] }),
    recommendations: [rec()], prescriptions: [rx()], prescription_workflows: [workflow({ state: 'ACTIVE' })]
  };
  var out1 = PJ.projectJourney(input);
  var out2 = PJ.projectJourney(input);
  assert.strictEqual(JSON.stringify(out1), JSON.stringify(out2), 'T19 identical input yields identical output');
})();

// ================================================================
// T20 — Historical References Preserved during REASSESSMENT_READY
// (covered primarily by T09's dedicated assertions above; this test checks the
// workflow_context stays a verbatim passthrough rather than being cleared)
// ================================================================
(function () {
  var out = PJ.projectJourney({
    player: player(),
    development_cycle: cycle({ state: 'REASSESSMENT_READY', recommendation_refs: [REC_ID], prescription_refs: [RX_ID] }),
    recommendations: [rec()], prescriptions: [rx()],
    prescription_workflows: [workflow({ state: 'IN_PROGRESS' })]
  });
  assert.strictEqual(out.journey.workflow_context.development_cycle_state, 'REASSESSMENT_READY', 'T20 workflow_context verbatim');
  assert.strictEqual(out.journey.workflow_context.prescription_workflow_state, 'IN_PROGRESS', 'T20 stale workflow state still visible');
  assert.ok(out.journey.presentation_flags.indexOf('STALE_PRESCRIPTION') !== -1, 'T20 stale flag present');
})();

// ================================================================
// Journey Stage != Domain State — structural/behavioral check
// ================================================================
(function () {
  var out = PJ.projectJourney({
    player: player(),
    development_cycle: cycle({ state: 'PRESCRIPTION_READY', recommendation_refs: [REC_ID], prescription_refs: [RX_ID] }),
    prescriptions: [rx()], prescription_workflows: [workflow({ state: 'ACTIVE' })]
  });
  assert.notStrictEqual(out.journey.stage, out.journey.workflow_context.development_cycle_state, 'journey stage is a distinct vocabulary from development_cycle.state');
  assert.strictEqual(PJ.JOURNEY_STAGES.indexOf(out.journey.stage) !== -1, true, 'stage is a frozen Journey Stage');
  assert.strictEqual(PJ.CYCLE_STATES.indexOf(out.journey.stage) === -1, true, 'stage is never a development_cycle state value');
})();

// ================================================================
// Structurally invalid input -> explicit deterministic error, never a guess
// ================================================================
(function () {
  assertThrows(function () { PJ.projectJourney('not-an-object'); }, 'non-object input', 'INVALID_INPUT');
  assertThrows(function () { PJ.projectJourney({}); }, 'missing player_id entirely', 'MISSING_PLAYER_ID');
  assertThrows(function () { PJ.projectJourney({ player: player(), development_cycle: { player_id: 'p1', state: 'BASELINE_READY' } }); }, 'missing cycle_id', 'INVALID_INPUT');
  assertThrows(function () { PJ.projectJourney({ player: player(), development_cycle: cycle({ state: 'NOT_A_REAL_STATE' }) }); }, 'unrecognized cycle state', 'INVALID_CYCLE_STATE');
})();

// ================================================================
// Regression — the accepted S9/S10 suites this stage's inputs are shaped from must stay green.
// ================================================================
checkDbVersionAndStores().then(function () {
  var cp = require('child_process');
  var relevantSuites = [
    'recommendation-priority-engine.test.js', 'training-prescription-engine.test.js',
    'workflow-integration-engine.test.js', 'prescription-workflow-engine.test.js',
    'session-evidence-engine.test.js', 'progress-tracking-engine.test.js',
    'reassessment-engine.test.js'
  ];
  relevantSuites.forEach(function (suite) {
    var res = cp.spawnSync(process.execPath, [path.join(__dirname, suite)], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, 'accepted suite ' + suite + ' must still pass unmodified:\n' + res.stdout + res.stderr);
  });

  console.log('product-journey-orchestrator.test.js: all assertions passed');
}).catch(function (e) {
  console.error(e);
  process.exit(1);
});
