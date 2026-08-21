/* tests/history-explainability-adapter.test.js — S11-E: History /
 * Explainability / Recovery Adapter
 * Run: node tests/history-explainability-adapter.test.js
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

delete require.cache[require.resolve('../js/history-explainability-adapter.js')];
var A = require('../js/history-explainability-adapter.js');

// ================================================================
// Fixtures
// ================================================================

function cycle(overrides) {
  return Object.assign({
    cycle_id: 'cyc_1', player_id: 'p1', state: 'PROGRESS_RECORDED',
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-05T00:00:00.000Z',
    prescription_refs: ['rx_1'], evidence_refs: ['ev_1']
  }, overrides || {});
}
function workflow(overrides) {
  return Object.assign({
    workflow_id: 'pwf_1', prescription_ref: 'rx_1', recommendation_ref: 'rec_1', player_id: 'p1',
    state: 'IN_PROGRESS', created_at: '2026-01-02T00:00:00.000Z', updated_at: '2026-01-04T00:00:00.000Z',
    activated_at: '2026-01-03T00:00:00.000Z', session_refs: ['sint_1'],
    prescription_snapshot: {
      source_recommendation_id: 'rec_1', kpi_profile_code: 'EXECUTION_SUCCESS_RATE', training_objective_code: 'SHOT_EXECUTION',
      training_mode: 'TECHNICAL_REPETITION', priority_rank: 1, priority_score: 74, priority_tier: 'HIGH',
      drill_family_code: 'SHOT_EXECUTION', drill_resolution_status: 'RESOLVED', kpi_target_status: 'AT_TARGET',
      reassessment_profile_code: 'MATCH_RECHECK'
    }
  }, overrides || {});
}
function sessionResult(overrides) {
  return Object.assign({ session_id: 'sint_1', prescription_ref: 'rx_1', recommendation_ref: 'rec_1', attempts: 20, successful_attempts: 15, result_value: 0.75, completed_at: '2026-01-04T00:00:00.000Z' }, overrides || {});
}
function evidence(overrides) {
  return Object.assign({ evidence_id: 'ev_1', session_ref: 'sint_1', prescription_ref: 'rx_1', source: 'TRAINING', kpi: 'EXECUTION_SUCCESS_RATE', timestamp: '2026-01-04T00:00:00.000Z' }, overrides || {});
}
function progressSnapshot(overrides) {
  return Object.assign({
    progress_id: 'pg:cyc_1:TRAINING:EXECUTION_SUCCESS_RATE', cycle_id: 'cyc_1', player_id: 'p1',
    kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'TRAINING', baseline_value: 0.62, current_value: 0.75,
    absolute_delta: 0.13, evidence_count: 1, trend: 'IMPROVING', current_evidence_ref: 'ev_1'
  }, overrides || {});
}
function baselineRecord(overrides) { return Object.assign({ baseline_id: 'cb:cyc_1', cycle_id: 'cyc_1', player_id: 'p1', captured_at: '2026-01-01T12:00:00.000Z' }, overrides || {}); }

function fullOpts(overrides) {
  return Object.assign({
    player_id: 'p1', cycles: [cycle()], workflows: [workflow()], sessionResults: [sessionResult()],
    trainingEvidence: [evidence()], reassessments: [],
    baselinesByCycle: { cyc_1: baselineRecord() }, progressByCycle: { cyc_1: progressSnapshot() },
    activeSessionLive: null
  }, overrides || {});
}

// ================================================================
// E-T01 — lists Development Cycles deterministically
// ================================================================
(function () {
  var out = A.composeHistoryExplainability({
    player_id: 'p1',
    cycles: [
      cycle({ cycle_id: 'a', updated_at: '2026-01-01T00:00:00.000Z' }),
      cycle({ cycle_id: 'b', updated_at: '2026-02-01T00:00:00.000Z' }),
      cycle({ cycle_id: 'c', updated_at: '2026-02-01T00:00:00.000Z' })
    ]
  });
  var ids = out.history_explainability.cycles.map(function (c) { return c.cycle_id; });
  assert.deepStrictEqual(ids, ['b', 'c', 'a'], 'E-T01 most-recently-updated first, ties broken by cycle_id');
  var out2 = A.composeHistoryExplainability({ player_id: 'p1', cycles: [cycle({ cycle_id: 'a', updated_at: '2026-01-01T00:00:00.000Z' }), cycle({ cycle_id: 'b', updated_at: '2026-02-01T00:00:00.000Z' }), cycle({ cycle_id: 'c', updated_at: '2026-02-01T00:00:00.000Z' })] });
  assert.deepStrictEqual(out2.history_explainability.cycles.map(function (c) { return c.cycle_id; }), ids, 'E-T01 deterministic across repeated calls');
})();

// ================================================================
// E-T02 — marks current cycle correctly
// ================================================================
(function () {
  var out = A.composeHistoryExplainability({
    player_id: 'p1',
    cycles: [cycle({ cycle_id: 'old', updated_at: '2026-01-01T00:00:00.000Z' }), cycle({ cycle_id: 'new', updated_at: '2026-03-01T00:00:00.000Z' })]
  });
  var byId = {};
  out.history_explainability.cycles.forEach(function (c) { byId[c.cycle_id] = c; });
  assert.strictEqual(byId['new'].is_current, true, 'E-T02 most recently updated cycle is current');
  assert.strictEqual(byId['old'].is_current, false);
})();

// ================================================================
// E-T03 — timeline derived only from persisted facts (no evidence -> no event)
// ================================================================
(function () {
  var bareCycle = cycle({ prescription_refs: [], evidence_refs: [] });
  var out = A.composeHistoryExplainability({ player_id: 'p1', cycles: [bareCycle], workflows: [], sessionResults: [], trainingEvidence: [], reassessments: [] });
  var timeline = out.history_explainability.cycles[0].timeline;
  var types = timeline.map(function (e) { return e.type; });
  assert.deepStrictEqual(types, ['CYCLE_CREATED'], 'E-T03 no workflow/session/evidence -> only the one event actually proven by persisted data');
})();
(function () {
  // Full fixture -> every proven event present, nothing extra guessed (e.g. no REASSESSMENT_* since cycle.state doesn't warrant it).
  var out = A.composeHistoryExplainability(fullOpts());
  var types = out.history_explainability.cycles[0].timeline.map(function (e) { return e.type; });
  assert.deepStrictEqual(types, ['CYCLE_CREATED', 'BASELINE_AVAILABLE', 'PRESCRIPTION_WORKFLOW_CREATED', 'PRESCRIPTION_ACTIVATED', 'TRAINING_STARTED', 'SESSION_COMPLETED', 'TRAINING_EVIDENCE_RECORDED', 'PROGRESS_AVAILABLE'], 'E-T03/E-T15 chronological, matches fixed vocabulary order');
})();

// ================================================================
// E-T04/E-T05 — Prescription Snapshot / recommendation_ref preserved verbatim
// ================================================================
(function () {
  var out = A.composeHistoryExplainability(fullOpts());
  var ws = out.history_explainability.cycles[0].workflow_summary;
  assert.strictEqual(ws.recommendation_ref, 'rec_1', 'E-T05 recommendation_ref preserved');
  assert.strictEqual(ws.priority_rank, 1);
  assert.strictEqual(ws.priority_tier, 'HIGH');
  assert.strictEqual(ws.training_objective_code, 'SHOT_EXECUTION', 'E-T04 snapshot field preserved verbatim');
  assert.strictEqual(ws.kpi_profile_code, 'EXECUTION_SUCCESS_RATE');
  assert.strictEqual(ws.drill_resolution_status, 'RESOLVED');
  assert.strictEqual(ws.kpi_target_status, 'AT_TARGET');
  var ce = out.history_explainability.current_explanation;
  assert.strictEqual(ce.source, 'PRESCRIPTION_WORKFLOW_SNAPSHOT');
  assert.strictEqual(ce.recommendation_ref, 'rec_1', 'E-T05 current_explanation traces to recommendation_ref');
})();

// ================================================================
// E-T06/E-T07 — Session Result -> Evidence lineage, TRAINING source preserved
// ================================================================
(function () {
  var out = A.composeHistoryExplainability(fullOpts());
  var lineage = out.history_explainability.cycles[0].evidence_lineage;
  assert.strictEqual(lineage.length, 1);
  assert.strictEqual(lineage[0].session_result_id, 'sint_1');
  assert.strictEqual(lineage[0].evidence_id, 'ev_1', 'E-T06 lineage links session result to its evidence');
  assert.strictEqual(lineage[0].attempts, 20);
  assert.strictEqual(lineage[0].successful_attempts, 15);
  assert.strictEqual(lineage[0].result_value, 0.75);
  assert.strictEqual(lineage[0].source, 'TRAINING', 'E-T07 source preserved verbatim');
})();

// ================================================================
// E-T08 — MATCH remains unresolved when unavailable (no MATCH evidence store exists)
// ================================================================
(function () {
  var out = A.composeHistoryExplainability(fullOpts());
  var flags = out.history_explainability.recovery.flags;
  assert.ok(flags.indexOf('MATCH_PROGRESS_UNRESOLVED') !== -1, 'E-T08 MATCH progress flagged unresolved, never fabricated');
  assert.strictEqual(JSON.stringify(out).indexOf('"MATCH"'), -1, 'no MATCH-sourced value ever appears — no MATCH evidence store exists');
})();

// ================================================================
// E-T09 — no S9 rerun (behavioral: same input twice -> identical output; no live computation)
// ================================================================
(function () {
  var opts = fullOpts();
  var out1 = A.composeHistoryExplainability(opts);
  var out2 = A.composeHistoryExplainability(opts);
  assert.strictEqual(JSON.stringify(out1), JSON.stringify(out2), 'E-T09/determinism: pure function, no hidden S9 recomputation');
})();

// ================================================================
// E-T10 — no Progress recomputation: progress_summary mirrors the supplied snapshot verbatim
// ================================================================
(function () {
  var out = A.composeHistoryExplainability(fullOpts());
  var ps = out.history_explainability.cycles[0].progress_summary;
  assert.strictEqual(ps.baseline, 0.62, 'E-T10 baseline copied verbatim, never recalculated');
  assert.strictEqual(ps.current, 0.75);
  assert.strictEqual(ps.delta, 0.13);
  assert.strictEqual(ps.trend, 'IMPROVING');
  assert.strictEqual(ps.evidence_count, 1);
  assert.strictEqual(ps.authority, 'S10-E');
})();

// ================================================================
// E-T11 — no mutation / no write: structural source scan (see below) + behavioral: composer
// never touches any store-like object passed in (pure function of its inputs).
// ================================================================
(function () {
  var opts = fullOpts();
  var frozenCycle = JSON.stringify(opts.cycles[0]);
  A.composeHistoryExplainability(opts);
  assert.strictEqual(JSON.stringify(opts.cycles[0]), frozenCycle, 'E-T11 input records are never mutated by the composer');
})();

// ================================================================
// E-T12 — active session marked non-durable
// ================================================================
(function () {
  var outLost = A.composeHistoryExplainability(fullOpts({ activeSessionLive: null }));
  assert.ok(outLost.history_explainability.recovery.flags.indexOf('ACTIVE_SESSION_NOT_DURABLE') !== -1, 'E-T12 IN_PROGRESS workflow with no live session -> flagged non-durable');
  assert.ok(outLost.history_explainability.recovery.unrecoverable.indexOf('ACTIVE_SESSION_EXECUTION') !== -1, 'ACTIVE_SESSION_EXECUTION is always structurally unrecoverable');

  var outLive = A.composeHistoryExplainability(fullOpts({ activeSessionLive: { workflow_id: 'pwf_1', session_execution: { state: 'ACTIVE' } } }));
  assert.strictEqual(outLive.history_explainability.recovery.flags.indexOf('ACTIVE_SESSION_NOT_DURABLE'), -1, 'a genuinely live in-memory session for this exact workflow suppresses the flag');
})();

// ================================================================
// E-T13 — missing S9 detail represented honestly
// ================================================================
(function () {
  var out = A.composeHistoryExplainability(fullOpts());
  assert.ok(out.history_explainability.recovery.unrecoverable.indexOf('FULL_S9_RECOMMENDATION_DETAIL') !== -1, 'E-T13 always structurally unrecoverable');
  assert.ok(out.history_explainability.recovery.flags.indexOf('S9_DETAIL_NOT_DURABLE') !== -1, 'flagged whenever an explanation is actually shown');
})();

// ================================================================
// E-T14 — integrity mismatch produces flag only, never a repair
// ================================================================
(function () {
  var orphanWorkflow = workflow({ workflow_id: 'pwf_orphan', prescription_ref: 'rx_orphan' });
  var out = A.composeHistoryExplainability(fullOpts({ workflows: [workflow(), orphanWorkflow] }));
  assert.ok(out.history_explainability.integrity_flags.indexOf('ORPHAN_WORKFLOW_REF') !== -1, 'E-T14 orphan workflow ref flagged');
  // The orphan workflow itself is untouched/unremoved from the input.
  assert.strictEqual(orphanWorkflow.prescription_ref, 'rx_orphan', 'no repair/rewrite ever happens');

  var orphanEvidence = evidence({ evidence_id: 'ev_orphan' });
  var out2 = A.composeHistoryExplainability(fullOpts({ trainingEvidence: [evidence(), orphanEvidence] }));
  assert.ok(out2.history_explainability.integrity_flags.indexOf('ORPHAN_EVIDENCE_REF') !== -1, 'orphan evidence ref flagged');

  var srWithoutEvidence = sessionResult({ session_id: 'sint_no_ev' });
  var out3 = A.composeHistoryExplainability(fullOpts({ sessionResults: [sessionResult(), srWithoutEvidence], trainingEvidence: [evidence()] }));
  assert.ok(out3.history_explainability.integrity_flags.indexOf('SESSION_RESULT_WITHOUT_EVIDENCE') !== -1, 'a session result with no matching evidence (e.g. 0-attempt session) is flagged, not treated as corruption');
})();

// ================================================================
// E-T15 — timeline timestamps deterministic, UNKNOWN_TIME never fabricated
// ================================================================
(function () {
  var wf = workflow({ state: 'CANCELLED' }); // training started at some point, but exact time is now lost
  var out = A.composeHistoryExplainability(fullOpts({ workflows: [wf] }));
  var started = out.history_explainability.cycles[0].timeline.filter(function (e) { return e.type === 'TRAINING_STARTED'; })[0];
  assert.strictEqual(started.occurred_at, null, 'E-T15 no longer trustable once workflow.updated_at reflects a later transition');
  assert.strictEqual(started.time_status, 'UNKNOWN_TIME');

  var noCreatedAt = cycle({ created_at: null });
  var out2 = A.composeHistoryExplainability({ player_id: 'p1', cycles: [noCreatedAt] });
  var created = out2.history_explainability.cycles[0].timeline[0];
  assert.strictEqual(created.occurred_at, null);
  assert.strictEqual(created.time_status, 'UNKNOWN_TIME', 'never Date.now()/new Date() fills a missing timestamp');
})();

// ================================================================
// Structurally invalid input -> explicit error, never a silent guess
// ================================================================
(function () {
  assertThrows(function () { A.composeHistoryExplainability({}); }, 'missing player_id', 'INVALID_INPUT');
})();

// ================================================================
// compareTimelineEvents / pickCurrentCycle / pickCurrentWorkflow — pure helpers
// ================================================================
(function () {
  assert.strictEqual(A.pickCurrentCycle([]), null);
  assert.strictEqual(A.pickCurrentWorkflow([]), null);
  var a = { type: 'CYCLE_CREATED', occurred_at: null, ref: 'x' };
  var b = { type: 'CYCLE_COMPLETED', occurred_at: null, ref: 'y' };
  assert.ok(A.compareTimelineEvents(a, b) < 0, 'fixed vocabulary order used when both timestamps unknown');
})();

// ================================================================
// D-T14/D-T15-equivalent structural source scan — no S9, no S10/S11-C mutation
// ================================================================
var SRC = fs.readFileSync(path.join(__dirname, '../js/history-explainability-adapter.js'), 'utf8');
var STRIPPED = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
(function () {
  ['PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'diagnoseMatch', 'prioritizeDiagnosis', 'prescribeRecommendations'].forEach(function (token) {
    assert.strictEqual(STRIPPED.indexOf(token), -1, 'must never reference ' + token);
  });
  [
    'PBWorkflow.transition', 'PBPrescriptionWorkflow.transition', 'PBPrescriptionWorkflow.startTraining',
    'PBSessionEvidence.transition', 'PBSessionEvidencePersistence.completeSessionDurable',
    'runReassessmentDurable', 'captureBaselineDurable', 'completeCycleDurable', 'supersedePrescriptionWorkflowDurable',
    'computeProgressSnapshot', '.transition(', 'PBStore.put', 'PBStore.create', 'PBStore.del(',
    'createObjectStore', 'deleteObjectStore'
  ].forEach(function (token) {
    assert.strictEqual(STRIPPED.indexOf(token), -1, 'must never call the mutation/write entry point ' + token);
  });
  assert.ok(STRIPPED.indexOf('getCurrentProgressDurable') !== -1, 'must consume the accepted S10-E-R1 read+project composition');
})();

// ================================================================
// E-T01 (IO)/E-T16 — real IO test: reads real persisted records, no new persistence
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
  delete require.cache[require.resolve('../js/history-explainability-adapter.js')];
  global.PBHistoryExplainabilityAdapter = require('../js/history-explainability-adapter.js');
  return global.PBHistoryExplainabilityAdapter;
}
var IO = freshRuntime();

function run() {
  return PBStore.open().then(function () {
    var cyc = PBWorkflow.createDevelopmentCycle({ player_id: 'p_io', baseline_ref: 'asm_io' }).development_cycle;
    return PBStore.putDevelopmentCycle(cyc).then(function () { return cyc; });
  }).then(function (cyc) {
    return IO.loadHistoryExplainability('p_io').then(function (out) {
      var he = out.history_explainability;
      assert.strictEqual(he.cycles.length, 1, 'E-T01(IO) reads the real persisted Development Cycle');
      assert.strictEqual(he.cycles[0].cycle_id, cyc.cycle_id);
      assert.strictEqual(he.cycles[0].is_current, true);
      assert.deepStrictEqual(he.cycles[0].timeline.map(function (e) { return e.type; }), ['CYCLE_CREATED'], 'no fabricated events for a bare cycle');
      return cyc;
    });
  }).then(function (cyc) {
    // Confirm this stage created no new store: DB_VERSION/store count unaffected.
    assert.strictEqual(PBStore.DB_VERSION, 5, 'E-T16 DB_VERSION remains 5');
    return cyc;
  }).then(function () {
    console.log('history-explainability-adapter.test.js: all assertions passed');
  });
}

run().catch(function (err) {
  console.error('history-explainability-adapter.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
