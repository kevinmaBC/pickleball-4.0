/* tests/progress-reassessment-adapter.test.js — S11-D: Progress /
 * Reassessment Experience Adapter
 * Run: node tests/progress-reassessment-adapter.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var createFakeIndexedDB = require('./fake-indexeddb');

function assertThrows(fn, label, expectedCode) {
  var threw = null;
  try { fn(); } catch (e) { threw = e; }
  assert.ok(threw instanceof Error, label + ' throws an Error');
  if (expectedCode) assert.strictEqual(threw.code, expectedCode, label + ' code should be ' + expectedCode);
}

delete require.cache[require.resolve('../js/progress-reassessment-adapter.js')];
var A = require('../js/progress-reassessment-adapter.js');
delete require.cache[require.resolve('../js/product-journey-orchestrator.js')];
var PJ = require('../js/product-journey-orchestrator.js');

// ================================================================
// Fixtures — minimal shapes matching js/progress-tracking-engine.js's own
// progress_snapshot contract and PBProductJourney's own journey contract.
// ================================================================

function progressSnapshot(overrides) {
  return Object.assign({
    progress_id: 'pg:cyc_1:TRAINING:EXECUTION_SUCCESS_RATE', cycle_id: 'cyc_1', player_id: 'p1',
    kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'TRAINING',
    baseline_value: 0.62, current_value: 0.74, absolute_delta: 0.12, percentage_point_delta: 12,
    relative_change: 0.1935, evidence_count: 4, trend: 'IMPROVING', target_status: 'UNRESOLVED',
    baseline_ref: 'cb:cyc_1', current_evidence_ref: 'ev_4', schema_version: '1.0', contract_version: 'S10-E-R1-V1'
  }, overrides || {});
}

function workflow(overrides) {
  return Object.assign({
    workflow_id: 'pwf_1', prescription_ref: 'rx_1', recommendation_ref: 'rec_1', player_id: 'p1',
    state: 'IN_PROGRESS', session_refs: [],
    prescription_snapshot: { kpi_profile_code: 'EXECUTION_SUCCESS_RATE', training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION' }
  }, overrides || {});
}

function cycle(overrides) {
  return Object.assign({ cycle_id: 'cyc_1', player_id: 'p1', state: 'PROGRESS_RECORDED', prescription_refs: ['rx_1'], recommendation_refs: ['rec_1'] }, overrides || {});
}

function journeyFor(overrides) {
  return Object.assign({
    player_id: 'p1', cycle_ref: 'cyc_1', stage: 'REVIEW_PROGRESS', status: 'READY', headline_code: 'PROGRESS_RECORDED',
    next_action: { code: 'REVIEW_PROGRESS', enabled: true, target_ref: 'cyc_1' },
    secondary_actions: [], current_focus: { recommendation_ref: 'rec_1', priority_rank: null, prescription_ref: 'rx_1' },
    workflow_context: { development_cycle_state: 'PROGRESS_RECORDED', prescription_workflow_state: 'IN_PROGRESS' },
    progress_context: null, reassessment: { required: false, match_required: false, reassessment_ref: null },
    presentation_flags: [], schema_version: '1.0', journey_version: 'S11-A-V1'
  }, overrides || {});
}

// ================================================================
// D-T02/D-T03/D-T04/D-T05/D-T06/D-T07 — S10-E progress output consumed verbatim
// ================================================================
(function () {
  var out = A.composeProgressReassessment({
    player_id: 'p1', cycle: cycle(), workflow: workflow(),
    baselineCaptured: true, training_snapshot: progressSnapshot(), match_snapshot: null,
    journey: journeyFor()
  });
  var tp = out.progress_reassessment.training_progress;
  assert.strictEqual(tp.baseline, 0.62, 'D-T03 baseline preserved verbatim');
  assert.strictEqual(tp.current, 0.74, 'D-T04 current preserved verbatim');
  assert.strictEqual(tp.delta, 0.12, 'D-T05 delta preserved verbatim (absolute, never recomputed)');
  assert.strictEqual(tp.trend, 'IMPROVING', 'D-T06 trend preserved verbatim');
  assert.strictEqual(tp.evidence_count, 4, 'D-T07 evidence_count preserved verbatim');
  assert.strictEqual(tp.status, 'RESOLVED', 'D-T02 consumes the prepared S10-E snapshot');
  assert.strictEqual(tp.source, 'TRAINING');
})();

// ================================================================
// D-T08/D-T09/D-T10 — TRAINING/MATCH separation, MATCH never fabricated
// ================================================================
(function () {
  var out = A.composeProgressReassessment({
    player_id: 'p1', cycle: cycle(), workflow: workflow(),
    baselineCaptured: true, training_snapshot: progressSnapshot({ current_value: 0.9, trend: 'IMPROVING' }), match_snapshot: null,
    journey: journeyFor()
  });
  var pr = out.progress_reassessment;
  assert.strictEqual(pr.training_progress.trend, 'IMPROVING', 'D-T08 training resolved independently');
  assert.strictEqual(pr.match_transfer.status, 'INSUFFICIENT_DATA', 'D-T09 missing MATCH evidence -> INSUFFICIENT_DATA, never fabricated');
  assert.strictEqual(pr.match_transfer.validated, false);
  assert.strictEqual(pr.match_transfer.numeric_progress, null, 'D-T10 TRAINING current_value (0.9) never leaks into match_transfer.numeric_progress');
  assert.ok(pr.flags.indexOf('MATCH_TRANSFER_NOT_VALIDATED') !== -1);
})();
(function () {
  // MATCH genuinely resolved must not be conflated with TRAINING's own separate value.
  var out = A.composeProgressReassessment({
    player_id: 'p1', cycle: cycle(), workflow: workflow(),
    baselineCaptured: true,
    training_snapshot: progressSnapshot({ current_value: 0.74, trend: 'IMPROVING' }),
    match_snapshot: progressSnapshot({ source: 'MATCH', current_value: 0.55, trend: 'STABLE' }),
    journey: journeyFor()
  });
  var pr = out.progress_reassessment;
  assert.strictEqual(pr.match_transfer.validated, true, 'D-T08 MATCH resolved independently of TRAINING');
  assert.strictEqual(pr.match_transfer.numeric_progress, 0.55, 'D-T10 match value is its own, never overwritten by TRAINING');
  assert.notStrictEqual(pr.match_transfer.numeric_progress, pr.training_progress.current, 'D-T10 TRAINING/MATCH values never equal by substitution');
})();

// ================================================================
// D-T16 — missing Baseline handled honestly
// ================================================================
(function () {
  var out = A.composeProgressReassessment({
    player_id: 'p1', cycle: cycle(), workflow: workflow(),
    baselineCaptured: false, training_snapshot: null, match_snapshot: null,
    journey: journeyFor()
  });
  var pr = out.progress_reassessment;
  assert.strictEqual(pr.training_progress.status, 'BASELINE_UNRESOLVED', 'D-T16 honest baseline-missing state');
  assert.strictEqual(pr.training_progress.baseline, null, 'D-T16 never uses a Session Result as baseline');
  assert.strictEqual(pr.match_transfer.status, 'BASELINE_UNRESOLVED');
  assert.ok(pr.flags.indexOf('BASELINE_UNRESOLVED') !== -1);
})();

// No cycle at all -> fully empty state, never fabricated.
(function () {
  var out = A.composeProgressReassessment({ player_id: 'p1', cycle: null, workflow: null, baselineCaptured: false, journey: PJ.projectJourney({ player: { player_id: 'p1' } }).journey });
  var pr = out.progress_reassessment;
  assert.strictEqual(pr.cycle, null);
  assert.strictEqual(pr.training_progress, null, 'no cycle -> no fabricated training progress');
  assert.strictEqual(pr.match_transfer, null);
})();

// ================================================================
// D-T11 — Progress never promotes Validated Level
// ================================================================
(function () {
  var out = A.composeProgressReassessment({
    player_id: 'p1', cycle: cycle(), workflow: workflow(),
    baselineCaptured: true, training_snapshot: progressSnapshot({ current_value: 0.95, trend: 'IMPROVING' }), match_snapshot: null,
    journey: journeyFor()
  });
  var json = JSON.stringify(out);
  ['validated_level', 'validated_training_level', '"level"', '4.0', '4.5', '5.0'].forEach(function (needle) {
    assert.strictEqual(json.indexOf(needle), -1, 'D-T11 no validated-level field/value ever appears: ' + needle);
  });
})();

// ================================================================
// D-T12 — REASSESSMENT_READY reflected correctly (both authoritative signals)
// ================================================================
(function () {
  var out1 = A.composeProgressReassessment({
    player_id: 'p1', cycle: cycle({ state: 'REASSESSMENT_READY' }), workflow: workflow(),
    baselineCaptured: false, journey: journeyFor({ stage: 'READY_TO_REASSESS', next_action: { code: 'RECORD_REAL_MATCH', enabled: true, target_ref: 'cyc_1' } })
  });
  assert.strictEqual(out1.progress_reassessment.reassessment.required, true, 'D-T12 cycle.state REASSESSMENT_READY -> required');

  var out2 = A.composeProgressReassessment({
    player_id: 'p1', cycle: cycle({ state: 'PROGRESS_RECORDED' }), workflow: workflow(),
    baselineCaptured: false, journey: journeyFor({ stage: 'REVIEW_PROGRESS' })
  });
  assert.strictEqual(out2.progress_reassessment.reassessment.required, false, 'D-T12 not required when neither signal fires');

  // §28: never displayed as ready when the authority does not indicate it, even with training data.
  assert.strictEqual(out2.progress_reassessment.journey.stage, 'REVIEW_PROGRESS');
})();

// ================================================================
// D-T13 — next_action comes from S11-A verbatim
// ================================================================
(function () {
  var j = journeyFor({ next_action: { code: 'CONTINUE_TRAINING', enabled: true, target_ref: 'pwf_9' } });
  var out = A.composeProgressReassessment({ player_id: 'p1', cycle: cycle(), workflow: workflow(), baselineCaptured: false, journey: j });
  assert.deepStrictEqual(out.progress_reassessment.next_action, { code: 'CONTINUE_TRAINING', enabled: true, target_ref: 'pwf_9' }, 'D-T13 next_action copied verbatim from journey');
})();

// ================================================================
// Structurally invalid input -> explicit error, never a silent guess
// ================================================================
(function () {
  assertThrows(function () { A.composeProgressReassessment({}); }, 'missing player_id', 'INVALID_INPUT');
  assertThrows(function () { A.composeProgressReassessment({ player_id: 'p1' }); }, 'missing journey', 'INVALID_INPUT');
})();

// ================================================================
// pickCurrentCycle / pickWorkflowForCycle / pickLatestReassessment — pure selection helpers
// ================================================================
(function () {
  var cycles = [
    { cycle_id: 'a', updated_at: '2026-01-01T00:00:00.000Z' },
    { cycle_id: 'b', updated_at: '2026-02-01T00:00:00.000Z' }
  ];
  assert.strictEqual(A.pickCurrentCycle(cycles).cycle_id, 'b');
  assert.strictEqual(A.pickCurrentCycle([]), null);

  var workflows = [
    { workflow_id: 'w1', prescription_ref: 'rx_old', state: 'SUPERSEDED', updated_at: '2026-01-01T00:00:00.000Z' },
    { workflow_id: 'w2', prescription_ref: 'rx_1', state: 'IN_PROGRESS', updated_at: '2026-02-01T00:00:00.000Z' }
  ];
  var picked = A.pickWorkflowForCycle(workflows, cycle({ prescription_refs: ['rx_1'] }));
  assert.strictEqual(picked.workflow_id, 'w2', 'prefers the workflow matching the cycle\'s current prescription_refs');
  assert.strictEqual(A.pickWorkflowForCycle([], cycle()), null);

  var reassessments = [
    { reassessment_id: 'r1', cycle_id: 'cyc_1', created_at: '2026-01-01T00:00:00.000Z', status: 'COMPLETED' },
    { reassessment_id: 'r2', cycle_id: 'cyc_1', created_at: '2026-02-01T00:00:00.000Z', status: 'COMPLETED' },
    { reassessment_id: 'r3', cycle_id: 'cyc_other', created_at: '2026-03-01T00:00:00.000Z', status: 'COMPLETED' }
  ];
  assert.strictEqual(A.pickLatestReassessment(reassessments, cycle()).reassessment_id, 'r2', 'latest reassessment for the cycle, never cross-cycle');
  assert.strictEqual(A.pickLatestReassessment([], cycle()), null);
})();

// ================================================================
// Determinism — same input twice -> identical output
// ================================================================
(function () {
  var input = { player_id: 'p1', cycle: cycle(), workflow: workflow(), baselineCaptured: true, training_snapshot: progressSnapshot(), match_snapshot: null, journey: journeyFor() };
  var out1 = A.composeProgressReassessment(input);
  var out2 = A.composeProgressReassessment(input);
  assert.strictEqual(JSON.stringify(out1), JSON.stringify(out2));
})();

// ================================================================
// D-T14/D-T15 — structural source scan: no S9, no S10 mutation
// ================================================================
var SRC = fs.readFileSync(path.join(__dirname, '../js/progress-reassessment-adapter.js'), 'utf8');
var STRIPPED = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
(function () {
  // D-T14: no S9 invocation.
  ['PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'diagnoseMatch', 'prioritizeDiagnosis', 'prescribeRecommendations'].forEach(function (token) {
    assert.strictEqual(STRIPPED.indexOf(token), -1, 'D-T14: must never reference ' + token);
  });
  // D-T15: no S10 mutation ownership.
  [
    'PBWorkflow.transition', 'PBPrescriptionWorkflow.transition', 'PBPrescriptionWorkflow.startTraining',
    'PBSessionEvidence.transition', 'PBSessionEvidencePersistence.completeSessionDurable',
    'runReassessmentDurable', 'supersedePrescriptionWorkflowDurable', 'completeCycleDurable',
    'captureBaselineDurable', 'computeProgressSnapshot', '.transition('
  ].forEach(function (token) {
    assert.strictEqual(STRIPPED.indexOf(token), -1, 'D-T15: must never call the mutation/compute entry point ' + token);
  });
  // The only legitimate read+project engine call.
  assert.ok(STRIPPED.indexOf('getCurrentProgressDurable') !== -1, 'must consume the accepted S10-E-R1 read+project composition');
})();

// ================================================================
// No persistence — every PBStore call is a read; nothing is ever written.
// ================================================================
(function () {
  ['PBStore.put', 'PBStore.createPlayer', 'PBStore.createAssessment', 'PBStore.del(', 'createObjectStore', 'deleteObjectStore'].forEach(function (token) {
    assert.strictEqual(STRIPPED.indexOf(token), -1, 'must never write to PBStore: ' + token);
  });
})();

// ================================================================
// D-T01 — reads current Development Cycle (real IO, fake IndexedDB, real S10-E-R1 engines)
// ================================================================
var fakeIDB = createFakeIndexedDB();
global.indexedDB = fakeIDB;
function freshRuntime() {
  delete require.cache[require.resolve('../js/storage.js')];
  global.PBStore = require('../js/storage.js');
  delete require.cache[require.resolve('../js/workflow-integration-engine.js')];
  global.PBWorkflow = require('../js/workflow-integration-engine.js');
  delete require.cache[require.resolve('../js/prescription-workflow-engine.js')];
  global.PBPrescriptionWorkflow = require('../js/prescription-workflow-engine.js');
  delete require.cache[require.resolve('../js/cycle-baseline-engine.js')];
  global.PBCycleBaseline = require('../js/cycle-baseline-engine.js');
  delete require.cache[require.resolve('../js/progress-tracking-engine.js')];
  global.PBProgressTracking = require('../js/progress-tracking-engine.js');
  delete require.cache[require.resolve('../js/reassessment-engine.js')];
  global.PBReassessment = require('../js/reassessment-engine.js');
  delete require.cache[require.resolve('../js/progress-reassessment-persistence.js')];
  global.PBProgressReassessmentPersistence = require('../js/progress-reassessment-persistence.js');
  delete require.cache[require.resolve('../js/product-journey-orchestrator.js')];
  global.PBProductJourney = require('../js/product-journey-orchestrator.js');
  delete require.cache[require.resolve('../js/progress-reassessment-adapter.js')];
  global.PBProgressReassessmentAdapter = require('../js/progress-reassessment-adapter.js');
  return global.PBProgressReassessmentAdapter;
}
var IO = freshRuntime();

function run() {
  return PBStore.open().then(function () {
    var cyc = PBWorkflow.createDevelopmentCycle({ player_id: 'p_io', baseline_ref: 'asm_io' }).development_cycle;
    return PBStore.putDevelopmentCycle(cyc).then(function () { return cyc; });
  }).then(function (cyc) {
    var pwf = PBPrescriptionWorkflow.createPrescriptionWorkflow({
      prescription: {
        prescription_id: 'rx_io', source_recommendation_id: 'rec_io', status: 'prescribed',
        priority_rank: 1, priority_score: 74, priority_tier: 'HIGH',
        training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION', kpi_profile_code: 'EXECUTION_SUCCESS_RATE'
      }, player_id: 'p_io'
    }).prescription_workflow;
    return PBStore.putPrescriptionWorkflow(pwf).then(function () { return { cyc: cyc, pwf: pwf }; });
  }).then(function (ctx) {
    // No baseline captured yet -> IO must honestly report BASELINE_UNRESOLVED (never fabricate).
    return IO.loadProgressReassessment('p_io').then(function (out) {
      var pr = out.progress_reassessment;
      assert.strictEqual(pr.cycle.cycle_id, ctx.cyc.cycle_id, 'D-T01 reads the real persisted current Development Cycle');
      assert.strictEqual(pr.cycle.kpi_profile_code, 'EXECUTION_SUCCESS_RATE', 'D-T01 cycle summary reads the real workflow snapshot');
      assert.strictEqual(pr.training_progress.status, 'BASELINE_UNRESOLVED', 'no baseline captured yet -> honest, never fabricated');
      return ctx;
    });
  }).then(function (ctx) {
    // Now capture a real baseline + evidence via the accepted S10-E-R1 engines, then re-read.
    var evidence = [{ evidence_id: 'ev_pre', source: 'TRAINING', kpi: 'EXECUTION_SUCCESS_RATE', player_id: 'p_io', value: 0.6, timestamp: '2026-01-01T00:00:00.000Z' }];
    var baseline = PBCycleBaseline.captureBaselineSnapshot({
      cycle_id: ctx.cyc.cycle_id, player_id: 'p_io', kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'],
      captured_at: '2026-01-02T00:00:00.000Z', evidence: evidence
    }).cycle_kpi_baseline;
    return PBStore.putCycleKpiBaseline(baseline).then(function () {
      var trainingEvidence = { evidence_id: 'ev_post', source: 'TRAINING', kpi: 'EXECUTION_SUCCESS_RATE', player_id: 'p_io', value: 0.8, timestamp: '2026-01-03T00:00:00.000Z' };
      return PBStore.putTrainingEvidence(trainingEvidence);
    }).then(function () { return IO.loadProgressReassessment('p_io'); });
  }).then(function (out) {
    var pr = out.progress_reassessment;
    assert.strictEqual(pr.training_progress.status, 'RESOLVED', 'D-T01 real baseline+evidence -> RESOLVED, consumed via getCurrentProgressDurable');
    assert.strictEqual(pr.training_progress.baseline, 0.6);
    assert.strictEqual(pr.training_progress.current, 0.8);
    assert.strictEqual(pr.match_transfer.status, 'INSUFFICIENT_DATA', 'no MATCH evidence store -> honest, never fabricated');
    assert.strictEqual(pr.match_transfer.validated, false);
  }).then(function () {
    console.log('progress-reassessment-adapter.test.js: all assertions passed');
  });
}

run().catch(function (err) {
  console.error('progress-reassessment-adapter.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
