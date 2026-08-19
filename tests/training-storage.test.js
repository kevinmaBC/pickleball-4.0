/* tests/training-storage.test.js — S8-A: Training Cycle data architecture
 * Verifies the five new IndexedDB stores (training_cycles / weekly_plans /
 * session_plans / session_logs / cycle_summaries): CRUD, parent/source
 * validation (no orphans), enum/level validation, and the architectural
 * invariants carried over from docs/S8-ENTRY-SPEC.md.
 * Run: node tests/training-storage.test.js
 */
var assert = require('assert');
var createFakeIndexedDB = require('./fake-indexeddb');

global.indexedDB = createFakeIndexedDB();
delete require.cache[require.resolve('../js/storage.js')];
var PBStore = require('../js/storage.js');

function assertRejects(promise, label) {
  return promise.then(
    function () { throw new Error('expected rejection but resolved: ' + label); },
    function (err) { assert.ok(err instanceof Error, label + ' rejects with an Error'); }
  );
}

function run() {
  var playerId, assessmentId, snapshotId, prescriptionId;
  var cycleId, weekPlanId, sessionPlanId, sessionLogId, cycleSummaryId;

  // ---- Seed a minimal S1/S7 chain so training_cycles has real upstream sources ----
  return PBStore.createPlayer('Bob').then(function (p) {
    playerId = p.player_id;
    return PBStore.createAssessment({ player_id: playerId, assessment_tier: 'lite', target_training_level: 4.0 });
  }).then(function (a) {
    assessmentId = a.assessment_id;
    return PBStore.createReviewSnapshot({ assessment_id: assessmentId, data: { note: 'seed' } });
  }).then(function (snap) {
    snapshotId = snap.review_snapshot_id;
    return PBStore.createPrescription({ assessment_id: assessmentId, data: {} });
  }).then(function (rx) {
    prescriptionId = rx.prescription_id;

    // ---- 1. TrainingCycle: reject when upstream sources don't exist (no orphans / fake IDs) ----
    return assertRejects(PBStore.createTrainingCycle({
      source_review_snapshot_id: 'rev_does_not_exist',
      source_prescription_id: prescriptionId
    }), 'createTrainingCycle with missing review_snapshot');
  }).then(function () {
    return assertRejects(PBStore.createTrainingCycle({
      source_review_snapshot_id: snapshotId,
      source_prescription_id: 'rx_does_not_exist'
    }), 'createTrainingCycle with missing prescription');
  }).then(function () {
    // ---- 2. Validated level safety: reject non-canonical decimal levels ----
    return assertRejects(PBStore.createTrainingCycle({
      source_review_snapshot_id: snapshotId,
      source_prescription_id: prescriptionId,
      validated_level_at_start: 3.87
    }), 'createTrainingCycle with invalid validated_level_at_start (3.87)');
  }).then(function () {
    return assertRejects(PBStore.createTrainingCycle({
      source_review_snapshot_id: snapshotId,
      source_prescription_id: prescriptionId,
      target_level: 4.2
    }), 'createTrainingCycle with invalid target_level (4.2)');
  }).then(function () {
    // ---- 3. Invalid status rejected ----
    return assertRejects(PBStore.createTrainingCycle({
      source_review_snapshot_id: snapshotId,
      source_prescription_id: prescriptionId,
      status: 'IN_PROGRESS'
    }), 'createTrainingCycle with invalid status');
  }).then(function () {
    // ---- 4. Create/get/update TrainingCycle (happy path) ----
    return PBStore.createTrainingCycle({
      source_review_snapshot_id: snapshotId,
      source_prescription_id: prescriptionId,
      validated_level_at_start: 3.5,
      target_level: 4.0,
      primary_bottleneck: 'decision_speed'
    });
  }).then(function (cycle) {
    cycleId = cycle.cycle_id;
    assert.ok(cycleId.indexOf('tc_') === 0, 'cycle_id uses tc_ prefix');
    assert.strictEqual(cycle.status, 'PLANNED', 'default status is PLANNED');
    assert.strictEqual(cycle.schema_version, 1);
    assert.strictEqual(cycle.source_review_snapshot_id, snapshotId);
    assert.strictEqual(cycle.source_prescription_id, prescriptionId);
    assert.strictEqual(cycle.validated_level_at_start, 3.5);
    assert.strictEqual(cycle.target_level, 4.0);
    return PBStore.getTrainingCycle(cycleId);
  }).then(function (fetched) {
    assert.strictEqual(fetched.primary_bottleneck, 'decision_speed');
    return PBStore.updateTrainingCycle(cycleId, { status: 'ACTIVE' });
  }).then(function (updated) {
    assert.strictEqual(updated.status, 'ACTIVE');
    assert.ok(updated.updated_at);
    // Invariant: S8 storage must never accept a direct write to validated_training_level.
    return assertRejects(PBStore.updateTrainingCycle(cycleId, { validated_training_level: 4.0 }), 'updateTrainingCycle must reject validated_training_level');
  }).then(function () {
    return assertRejects(PBStore.updateTrainingCycle(cycleId, { status: 'BOGUS' }), 'updateTrainingCycle rejects invalid status');
  }).then(function () {
    return PBStore.listTrainingCycles();
  }).then(function (cycles) {
    assert.strictEqual(cycles.length, 1);

    // ---- 5. WeeklyPlan: orphan rejected (bad cycle_id) ----
    return assertRejects(PBStore.createWeeklyPlan({ cycle_id: 'tc_does_not_exist', week_number: 1 }), 'createWeeklyPlan orphan rejected');
  }).then(function () {
    return assertRejects(PBStore.createWeeklyPlan({ cycle_id: cycleId, week_number: 1, phase: 'NOT_A_PHASE' }), 'createWeeklyPlan invalid phase rejected');
  }).then(function () {
    return PBStore.createWeeklyPlan({ cycle_id: cycleId, week_number: 1, phase: 'ACQUISITION', planned_sessions: 3 });
  }).then(function (wp) {
    weekPlanId = wp.week_plan_id;
    assert.ok(weekPlanId.indexOf('wp_') === 0);
    assert.strictEqual(wp.status, 'PLANNED');
    assert.strictEqual(wp.cycle_id, cycleId);
    return PBStore.getWeeklyPlan(weekPlanId);
  }).then(function (fetched) {
    assert.strictEqual(fetched.week_number, 1);
    return PBStore.listWeeklyPlansByCycle(cycleId);
  }).then(function (plans) {
    assert.strictEqual(plans.length, 1);
    assert.strictEqual(plans[0].week_plan_id, weekPlanId);
    // Deterministic retrieval of week N for a given cycle.
    return PBStore.getWeeklyPlanByCycleWeek(cycleId, 1);
  }).then(function (wp) {
    assert.ok(wp, 'getWeeklyPlanByCycleWeek finds week 1');
    assert.strictEqual(wp.week_plan_id, weekPlanId);
    return PBStore.updateWeeklyPlan(weekPlanId, { status: 'ACTIVE' });
  }).then(function (updated) {
    assert.strictEqual(updated.status, 'ACTIVE');
    return assertRejects(PBStore.updateWeeklyPlan(weekPlanId, { status: 'NOPE' }), 'updateWeeklyPlan rejects invalid status');
  }).then(function () {
    // ---- 6. SessionPlan: orphan rejected (bad week_plan_id) ----
    return assertRejects(PBStore.createSessionPlan({ week_plan_id: 'wp_does_not_exist', sequence: 1 }), 'createSessionPlan orphan rejected');
  }).then(function () {
    // SessionPlan must not accept execution-result fields (Plan != Execution Log).
    return assertRejects(PBStore.createSessionPlan({ week_plan_id: weekPlanId, sequence: 1, results: [{ ok: true }] }), 'createSessionPlan rejects execution-result field (results)');
  }).then(function () {
    return PBStore.createSessionPlan({ week_plan_id: weekPlanId, sequence: 1, objective: 'dinking control' });
  }).then(function (sp) {
    sessionPlanId = sp.session_plan_id;
    assert.ok(sessionPlanId.indexOf('sp_') === 0);
    assert.strictEqual(sp.cycle_id, cycleId, 'cycle_id is derived from the parent WeeklyPlan');
    assert.strictEqual(sp.status, 'PLANNED');
    return PBStore.getSessionPlan(sessionPlanId);
  }).then(function (fetched) {
    assert.strictEqual(fetched.objective, 'dinking control');
    return PBStore.listSessionPlansByWeek(weekPlanId);
  }).then(function (rows) {
    assert.strictEqual(rows.length, 1);
    return PBStore.listSessionPlansByCycle(cycleId);
  }).then(function (rows) {
    assert.strictEqual(rows.length, 1);
    return PBStore.updateSessionPlan(sessionPlanId, { status: 'AVAILABLE' });
  }).then(function (updated) {
    assert.strictEqual(updated.status, 'AVAILABLE');
    // Invariant: SessionPlan must remain intent-only, even via update.
    return assertRejects(PBStore.updateSessionPlan(sessionPlanId, { notes: 'tried to log results here' }), 'updateSessionPlan rejects execution-result field (notes)');
  }).then(function () {
    return assertRejects(PBStore.updateSessionPlan(sessionPlanId, { status: 'DONE' }), 'updateSessionPlan rejects invalid status');
  }).then(function () {
    // ---- 7. SessionLog: orphan rejected (bad session_plan_id) ----
    return assertRejects(PBStore.createSessionLog({ session_plan_id: 'sp_does_not_exist', status: 'COMPLETE' }), 'createSessionLog orphan rejected');
  }).then(function () {
    return assertRejects(PBStore.createSessionLog({ session_plan_id: sessionPlanId, status: 'DONE_MAYBE' }), 'createSessionLog rejects invalid status');
  }).then(function () {
    return PBStore.createSessionLog({
      session_plan_id: sessionPlanId,
      status: 'COMPLETE',
      started_at: '2026-08-19T10:00:00.000Z',
      completed_at: '2026-08-19T10:30:00.000Z',
      results: [{ drill: 'dink_rally', outcome: 'S' }],
      notes: 'felt good'
    });
  }).then(function (sl) {
    sessionLogId = sl.session_log_id;
    assert.ok(sessionLogId.indexOf('sl_') === 0);
    assert.strictEqual(sl.session_plan_id, sessionPlanId);
    assert.strictEqual(sl.week_plan_id, weekPlanId, 'week_plan_id is derived from the parent SessionPlan');
    assert.strictEqual(sl.cycle_id, cycleId, 'cycle_id is derived from the parent SessionPlan');
    return PBStore.getSessionLog(sessionLogId);
  }).then(function (fetched) {
    assert.strictEqual(fetched.notes, 'felt good');
    return PBStore.listSessionLogsBySessionPlan(sessionPlanId);
  }).then(function (rows) {
    assert.strictEqual(rows.length, 1);
    return PBStore.listSessionLogsByCycle(cycleId);
  }).then(function (rows) {
    assert.strictEqual(rows.length, 1);

    // Invariant check: SessionPlan and SessionLog remain fully separate records.
    return PBStore.getSessionPlan(sessionPlanId);
  }).then(function (planStillIntent) {
    assert.strictEqual(planStillIntent.results, undefined, 'SessionPlan record never gained a results field from the SessionLog');
    assert.ok(!Object.prototype.hasOwnProperty.call(planStillIntent, 'completed_at'), 'SessionPlan record never gained completed_at');

    // ---- 8. CycleSummary: orphan rejected (bad cycle_id) ----
    return assertRejects(PBStore.createCycleSummary({ cycle_id: 'tc_does_not_exist' }), 'createCycleSummary orphan rejected');
  }).then(function () {
    return assertRejects(PBStore.createCycleSummary({ cycle_id: cycleId, retest_readiness: 'MAYBE' }), 'createCycleSummary rejects invalid retest_readiness');
  }).then(function () {
    return assertRejects(PBStore.createCycleSummary({ cycle_id: cycleId, next_action: 'PANIC' }), 'createCycleSummary rejects invalid next_action');
  }).then(function () {
    return PBStore.createCycleSummary({ cycle_id: cycleId });
  }).then(function (cs) {
    cycleSummaryId = cs.cycle_summary_id;
    assert.ok(cycleSummaryId.indexOf('cs_') === 0);
    // S8-A only stores these fields — it must not compute them (all null/placeholder by default).
    assert.strictEqual(cs.planned_sessions, null);
    assert.strictEqual(cs.completed_sessions, null);
    assert.strictEqual(cs.adherence, null);
    assert.deepStrictEqual(cs.training_exposure, {});
    assert.strictEqual(cs.retest_readiness, 'INCOMPLETE', 'retest_readiness defaults to INCOMPLETE, never auto-computed to READY');
    assert.strictEqual(cs.next_action, 'NONE');
    return PBStore.getCycleSummary(cycleSummaryId);
  }).then(function (fetched) {
    assert.strictEqual(fetched.cycle_id, cycleId);
    return PBStore.getCycleSummaryByCycle(cycleId);
  }).then(function (byCycle) {
    assert.ok(byCycle);
    assert.strictEqual(byCycle.cycle_summary_id, cycleSummaryId);
    return PBStore.updateCycleSummary(cycleSummaryId, { retest_readiness: 'READY', next_action: 'RETEST' });
  }).then(function (updated) {
    assert.strictEqual(updated.retest_readiness, 'READY');
    assert.strictEqual(updated.next_action, 'RETEST');
    return assertRejects(PBStore.updateCycleSummary(cycleSummaryId, { retest_readiness: 'ALMOST' }), 'updateCycleSummary rejects invalid retest_readiness');
  }).then(function () {
    // ---- 9. Global invariants: no C0, CAP unaffected, Match Transfer untouched by S8 API surface ----
    assert.ok(!PBStore.S8_ENUMS.RETEST_READINESS_VALUES.length || PBStore.S8_ENUMS.RETEST_READINESS_VALUES.indexOf('C0') === -1);
    assert.deepStrictEqual(PBStore.S8_ENUMS.VALID_LEVELS, [3.0, 3.5, 4.0, 4.5, 5.0], 'validated levels remain exactly the Master Control V2 set');
    assert.strictEqual(typeof PBStore.createCycleSummary, 'function');
    // CAP / Match Transfer / capability_score fields are never touched by any S8-A function —
    // structural check: none of the S8-A store keyPaths or field names reference them.
    var forbiddenTerms = ['capability_score', 'match_transfer', 'CAP'];
    var storageSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'storage.js'), 'utf8');
    var s8Section = storageSrc.slice(storageSrc.indexOf('S8-A：Training Cycle'));
    forbiddenTerms.forEach(function (term) {
      assert.strictEqual(s8Section.indexOf(term), -1, 'S8-A storage code must not reference ' + term);
    });

    console.log('training-storage.test.js: all assertions passed');
  });
}

run().catch(function (err) {
  console.error('training-storage.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
