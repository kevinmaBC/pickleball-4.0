/* tests/storage.test.js — S7-A/S8-A/S10-D-R1/S10-E-R1: Safe IndexedDB upgrade (v1 -> v5)
 * Verifies: existing S1-S6 stores/records survive the upgrade untouched,
 * review_snapshots / prescriptions / retests (S7-A) are created empty,
 * training_cycles / weekly_plans / session_plans / session_logs /
 * cycle_summaries (S8-A) are created empty, development_cycles /
 * prescription_workflows / session_results / training_evidence (S10-D-R1)
 * are created empty, and cycle_kpi_baselines / reassessments (S10-E-R1)
 * are created empty — all in a single additive upgrade from a
 * pre-existing v1 database (as a real user's device would see, having
 * never opened the app between S1 and now).
 * Run: node tests/storage.test.js
 */
var assert = require('assert');
var createFakeIndexedDB = require('./fake-indexeddb');

var fakeIDB = createFakeIndexedDB();

// Seed a pre-existing v1 database, as if a real user already has S1-S6 data
// on disk before this upgrade ships.
fakeIDB._seed('pb_v2', 1, {
  players: {
    keyPath: 'player_id',
    records: [{ player_id: 'plr_1', display_name: 'Alice', created_at: '2026-01-01T00:00:00.000Z' }]
  },
  assessments: {
    keyPath: 'assessment_id',
    indexes: [['by_player', 'player_id']],
    records: [{ assessment_id: 'asm_1', player_id: 'plr_1', assessment_tier: 'lite', created_at: '2026-01-01T00:00:00.000Z' }]
  },
  test_sessions: {
    keyPath: 'test_session_id',
    indexes: [['by_assessment', 'assessment_id']],
    records: [{ test_session_id: 'ses_1', assessment_id: 'asm_1', test_id: 'T01', started_at: '2026-01-01T00:00:00.000Z' }]
  },
  trial_events: {
    keyPath: 'trial_event_id',
    indexes: [['by_session', 'test_session_id']],
    records: [{ trial_event_id: 'trl_1', test_session_id: 'ses_1', trial_no: 1, outcome: 'S', created_at: '2026-01-01T00:00:00.000Z' }]
  }
});

global.indexedDB = fakeIDB;
delete require.cache[require.resolve('../js/storage.js')];
var PBStore = require('../js/storage.js');

function run() {
  return PBStore.open().then(function () {
    // 1. DB version bumped to 5 (S10-E-R1), without destroying prior data.
    assert.strictEqual(PBStore.DB_VERSION, 5);

    var dump = fakeIDB._dump()['pb_v2'];
    assert.strictEqual(dump.version, 5);

    // 2. Existing S1-S6 stores preserved with their original records intact.
    ['players', 'assessments', 'test_sessions', 'trial_events'].forEach(function (name) {
      assert.ok(dump.stores[name], 'store preserved: ' + name);
    });
    assert.strictEqual(dump.stores.players.data.get('plr_1').display_name, 'Alice');
    assert.strictEqual(dump.stores.assessments.data.get('asm_1').player_id, 'plr_1');
    assert.strictEqual(dump.stores.test_sessions.data.get('ses_1').test_id, 'T01');
    assert.strictEqual(dump.stores.trial_events.data.get('trl_1').outcome, 'S');

    // 3. New S7 stores created, empty, no destructive migration performed.
    ['review_snapshots', 'prescriptions', 'retests'].forEach(function (name) {
      assert.ok(dump.stores[name], 'store created: ' + name);
      assert.strictEqual(dump.stores[name].data.size, 0, name + ' starts empty');
    });

    // 3b. New S8-A stores created, empty, in the same single additive upgrade.
    ['training_cycles', 'weekly_plans', 'session_plans', 'session_logs', 'cycle_summaries'].forEach(function (name) {
      assert.ok(dump.stores[name], 'store created: ' + name);
      assert.strictEqual(dump.stores[name].data.size, 0, name + ' starts empty');
    });
    // Required indexes exist on each new S8-A store.
    assert.ok(dump.stores.training_cycles.indexes.by_prescription, 'training_cycles.by_prescription index exists');
    assert.ok(dump.stores.training_cycles.indexes.by_review_snapshot, 'training_cycles.by_review_snapshot index exists');
    assert.ok(dump.stores.training_cycles.indexes.by_status, 'training_cycles.by_status index exists');
    assert.ok(dump.stores.weekly_plans.indexes.by_cycle, 'weekly_plans.by_cycle index exists');
    assert.ok(dump.stores.weekly_plans.indexes.by_cycle_week, 'weekly_plans.by_cycle_week index exists');
    assert.ok(dump.stores.session_plans.indexes.by_week, 'session_plans.by_week index exists');
    assert.ok(dump.stores.session_plans.indexes.by_cycle, 'session_plans.by_cycle index exists');
    assert.ok(dump.stores.session_plans.indexes.by_status, 'session_plans.by_status index exists');
    assert.ok(dump.stores.session_logs.indexes.by_session_plan, 'session_logs.by_session_plan index exists');
    assert.ok(dump.stores.session_logs.indexes.by_week, 'session_logs.by_week index exists');
    assert.ok(dump.stores.session_logs.indexes.by_cycle, 'session_logs.by_cycle index exists');
    assert.ok(dump.stores.session_logs.indexes.by_status, 'session_logs.by_status index exists');
    assert.ok(dump.stores.cycle_summaries.indexes.by_cycle, 'cycle_summaries.by_cycle index exists');
    assert.ok(dump.stores.cycle_summaries.indexes.by_retest_readiness, 'cycle_summaries.by_retest_readiness index exists');

    // 3c. New S10-D-R1 stores created, empty, in the same single additive upgrade.
    ['development_cycles', 'prescription_workflows', 'session_results', 'training_evidence'].forEach(function (name) {
      assert.ok(dump.stores[name], 'store created: ' + name);
      assert.strictEqual(dump.stores[name].data.size, 0, name + ' starts empty');
    });
    // Required indexes exist on each new S10-D-R1 store.
    assert.ok(dump.stores.development_cycles.indexes.by_player, 'development_cycles.by_player index exists');
    assert.ok(dump.stores.development_cycles.indexes.by_state, 'development_cycles.by_state index exists');
    assert.ok(dump.stores.prescription_workflows.indexes.by_player, 'prescription_workflows.by_player index exists');
    assert.ok(dump.stores.prescription_workflows.indexes.by_prescription, 'prescription_workflows.by_prescription index exists');
    assert.ok(dump.stores.prescription_workflows.indexes.by_state, 'prescription_workflows.by_state index exists');
    assert.ok(dump.stores.session_results.indexes.by_player, 'session_results.by_player index exists');
    assert.ok(dump.stores.session_results.indexes.by_prescription, 'session_results.by_prescription index exists');
    assert.ok(dump.stores.session_results.indexes.by_status, 'session_results.by_status index exists');
    assert.ok(dump.stores.training_evidence.indexes.by_player, 'training_evidence.by_player index exists');
    assert.ok(dump.stores.training_evidence.indexes.by_session, 'training_evidence.by_session index exists');
    assert.ok(dump.stores.training_evidence.indexes.by_prescription, 'training_evidence.by_prescription index exists');
    assert.ok(dump.stores.training_evidence.indexes.by_source, 'training_evidence.by_source index exists');

    // 3d. New S10-E-R1 stores created, empty, in the same single additive upgrade.
    ['cycle_kpi_baselines', 'reassessments'].forEach(function (name) {
      assert.ok(dump.stores[name], 'store created: ' + name);
      assert.strictEqual(dump.stores[name].data.size, 0, name + ' starts empty');
    });
    assert.ok(dump.stores.cycle_kpi_baselines.indexes.by_cycle, 'cycle_kpi_baselines.by_cycle index exists');
    assert.ok(dump.stores.cycle_kpi_baselines.indexes.by_player, 'cycle_kpi_baselines.by_player index exists');
    assert.ok(dump.stores.reassessments.indexes.by_cycle, 'reassessments.by_cycle index exists');
    assert.ok(dump.stores.reassessments.indexes.by_player, 'reassessments.by_player index exists');
    assert.ok(dump.stores.reassessments.indexes.by_status, 'reassessments.by_status index exists');

    // 4. Existing S1-S6 reads/writes still work post-upgrade.
    return PBStore.listPlayers();
  }).then(function (players) {
    assert.strictEqual(players.length, 1);
    assert.strictEqual(players[0].player_id, 'plr_1');
    return PBStore.trialsBySession('ses_1');
  }).then(function (trials) {
    assert.strictEqual(trials.length, 1);
    assert.strictEqual(trials[0].trial_event_id, 'trl_1');

    // 5. Minimal CRUD helpers for the new S7 stores work end-to-end.
    return PBStore.createReviewSnapshot({ assessment_id: 'asm_1', data: { note: 'placeholder' } });
  }).then(function (snapshot) {
    assert.ok(snapshot.review_snapshot_id);
    assert.strictEqual(snapshot.assessment_id, 'asm_1');
    assert.ok(snapshot.schema_version);
    assert.ok(snapshot.generated_at);
    return PBStore.reviewSnapshotsByAssessment('asm_1');
  }).then(function (snapshots) {
    assert.strictEqual(snapshots.length, 1);
    return PBStore.createPrescription({ assessment_id: 'asm_1', data: {} });
  }).then(function (rx) {
    assert.ok(rx.prescription_id);
    return PBStore.createRetest({ assessment_id: 'asm_1', prescription_id: rx.prescription_id, data: {} });
  }).then(function (rt) {
    assert.ok(rt.retest_id);
    assert.ok(rt.prescription_id);
    return PBStore.retestsByAssessment('asm_1');
  }).then(function (retests) {
    assert.strictEqual(retests.length, 1);

    // 6. Minimal CRUD helpers for the new S10-D-R1 stores work end-to-end.
    return PBStore.putDevelopmentCycle({ cycle_id: 'cyc_1', player_id: 'plr_1', baseline_ref: 'asm_1', evidence_refs: [], state: 'BASELINE_READY', schema_version: '1.0' });
  }).then(function () {
    return PBStore.getDevelopmentCycle('cyc_1');
  }).then(function (cyc) {
    assert.strictEqual(cyc.player_id, 'plr_1');
    assert.strictEqual(cyc.state, 'BASELINE_READY');
    return PBStore.listDevelopmentCyclesByPlayer('plr_1');
  }).then(function (list) {
    assert.strictEqual(list.length, 1);
    return PBStore.listDevelopmentCyclesByState('BASELINE_READY');
  }).then(function (list) {
    assert.strictEqual(list.length, 1);
    return PBStore.putPrescriptionWorkflow({ workflow_id: 'wf_1', player_id: 'plr_1', prescription_ref: 'rx_1', state: 'DRAFTED', schema_version: '1.0' });
  }).then(function () {
    return PBStore.getPrescriptionWorkflow('wf_1');
  }).then(function (wf) {
    assert.strictEqual(wf.prescription_ref, 'rx_1');
    return PBStore.listPrescriptionWorkflowsByPlayer('plr_1');
  }).then(function (list) {
    assert.strictEqual(list.length, 1);
    return PBStore.listPrescriptionWorkflowsByPrescription('rx_1');
  }).then(function (list) {
    assert.strictEqual(list.length, 1);
    return PBStore.listPrescriptionWorkflowsByState('DRAFTED');
  }).then(function (list) {
    assert.strictEqual(list.length, 1);
    return PBStore.putSessionResult({ session_id: 'sint_1', player_id: 'plr_1', prescription_ref: 'rx_1', status: 'COMPLETED', schema_version: '1.0' });
  }).then(function () {
    return PBStore.getSessionResult('sint_1');
  }).then(function (sr) {
    assert.strictEqual(sr.status, 'COMPLETED');
    return PBStore.listSessionResultsByPlayer('plr_1');
  }).then(function (list) {
    assert.strictEqual(list.length, 1);
    return PBStore.listSessionResultsByPrescription('rx_1');
  }).then(function (list) {
    assert.strictEqual(list.length, 1);
    return PBStore.listSessionResultsByStatus('COMPLETED');
  }).then(function (list) {
    assert.strictEqual(list.length, 1);
    return PBStore.putTrainingEvidence({ evidence_id: 'ev:sint_1:KPI', player_id: 'plr_1', session_ref: 'sint_1', prescription_ref: 'rx_1', source: 'TRAINING', schema_version: '1.0' });
  }).then(function () {
    return PBStore.getTrainingEvidence('ev:sint_1:KPI');
  }).then(function (ev) {
    assert.strictEqual(ev.source, 'TRAINING');
    return PBStore.listTrainingEvidenceByPlayer('plr_1');
  }).then(function (list) {
    assert.strictEqual(list.length, 1);
    return PBStore.listTrainingEvidenceBySession('sint_1');
  }).then(function (list) {
    assert.strictEqual(list.length, 1);
    return PBStore.listTrainingEvidenceByPrescription('rx_1');
  }).then(function (list) {
    assert.strictEqual(list.length, 1);
    return PBStore.listTrainingEvidenceBySource('TRAINING');
  }).then(function (list) {
    assert.strictEqual(list.length, 1);
    // 7. Minimal CRUD helpers for the new S10-E-R1 stores work end-to-end.
    return PBStore.putCycleKpiBaseline({ baseline_id: 'cb:cyc_1', cycle_id: 'cyc_1', player_id: 'plr_1', tracks: {}, schema_version: '1.0' });
  }).then(function () {
    return PBStore.getCycleKpiBaseline('cb:cyc_1');
  }).then(function (b) {
    assert.strictEqual(b.cycle_id, 'cyc_1');
    return Promise.all([
      PBStore.listCycleKpiBaselinesByCycle('cyc_1'),
      PBStore.listCycleKpiBaselinesByPlayer('plr_1')
    ]);
  }).then(function (r) {
    assert.strictEqual(r[0].length, 1);
    assert.strictEqual(r[1].length, 1);
    return PBStore.putReassessment({ reassessment_id: 're:cyc_1:mses_1', cycle_id: 'cyc_1', player_id: 'plr_1', status: 'COMPLETED', schema_version: '1.0' });
  }).then(function () {
    return PBStore.getReassessment('re:cyc_1:mses_1');
  }).then(function (r) {
    assert.strictEqual(r.status, 'COMPLETED');
    return Promise.all([
      PBStore.listReassessmentsByCycle('cyc_1'),
      PBStore.listReassessmentsByPlayer('plr_1'),
      PBStore.listReassessmentsByStatus('COMPLETED')
    ]);
  }).then(function (r) {
    r.forEach(function (list) { assert.strictEqual(list.length, 1); });
    return Promise.all([
      PBStore.putDevelopmentCycle({ player_id: 'plr_1' }).catch(function (e) { return e; }),
      PBStore.putPrescriptionWorkflow({ player_id: 'plr_1' }).catch(function (e) { return e; }),
      PBStore.putSessionResult({ player_id: 'plr_1' }).catch(function (e) { return e; }),
      PBStore.putTrainingEvidence({ player_id: 'plr_1' }).catch(function (e) { return e; }),
      PBStore.putCycleKpiBaseline({ player_id: 'plr_1' }).catch(function (e) { return e; }),
      PBStore.putReassessment({ player_id: 'plr_1' }).catch(function (e) { return e; })
    ]);
  }).then(function (errs) {
    errs.forEach(function (e) { assert.ok(e instanceof Error, 'missing keyPath field must reject, never silently write a keyless record'); });
    console.log('storage.test.js: all assertions passed');
  });
}

run().catch(function (err) {
  console.error('storage.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
