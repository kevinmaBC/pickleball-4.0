/* tests/decision-cycle-registration-controller.test.js — S11-F0-R1:
 * Production Decision Registration Entry
 * Run: node tests/decision-cycle-registration-controller.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var createFakeIndexedDB = require('./fake-indexeddb');

function assertThrows(promiseOrFn, label, expectedCode) {
  var p = typeof promiseOrFn === 'function' ? Promise.resolve().then(promiseOrFn) : promiseOrFn;
  return p.then(function () {
    throw new Error(label + ' should have rejected but resolved');
  }, function (e) {
    assert.ok(e instanceof Error, label + ' rejects with an Error');
    if (expectedCode) assert.strictEqual(e.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + e.code + ')');
  });
}

// Same "genuine reload" fake IndexedDB convention this repo's other persistence tests use.
var fakeIDB = createFakeIndexedDB();
global.indexedDB = fakeIDB;

function freshRuntime() {
  delete require.cache[require.resolve('../js/storage.js')];
  global.PBStore = require('../js/storage.js');
  delete require.cache[require.resolve('../js/workflow-integration-engine.js')];
  global.PBWorkflow = require('../js/workflow-integration-engine.js');
  delete require.cache[require.resolve('../js/prescription-workflow-engine.js')];
  global.PBPrescriptionWorkflow = require('../js/prescription-workflow-engine.js');
  delete require.cache[require.resolve('../js/session-evidence-engine.js')];
  global.PBSessionEvidence = require('../js/session-evidence-engine.js');
  delete require.cache[require.resolve('../js/session-evidence-persistence.js')];
  global.PBSessionEvidencePersistence = require('../js/session-evidence-persistence.js');
  delete require.cache[require.resolve('../js/decision-cycle-registration-controller.js')];
  global.PBDecisionCycleRegistration = require('../js/decision-cycle-registration-controller.js');
  return global.PBDecisionCycleRegistration;
}

var C = freshRuntime();
var idCounter = 0;
function uid(prefix) { idCounter += 1; return prefix + '_' + idCounter; }

// Minimal in-memory S9 recommendation/prescription fixtures — shape matches what
// js/recommendation-priority-engine.js / js/training-prescription-engine.js actually produce,
// but built directly here since this controller never invokes those engines itself.
function recommendation(overrides) {
  return Object.assign({
    recommendation_id: uid('rec'), rank: 1, priority_score: 74, priority_tier: 'HIGH',
    skill: 'third_shot_drop', context: 'match', recommendation_code: 'RC_THIRD_SHOT_DROP',
    status: 'recommended', source_skill_gap_ids: []
  }, overrides || {});
}
function prescription(rec, overrides) {
  return Object.assign({
    prescription_id: uid('rx'), source_recommendation_id: rec.recommendation_id, status: 'prescribed',
    priority_rank: rec.rank, priority_score: rec.priority_score, priority_tier: rec.priority_tier,
    training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION',
    kpi_profile_code: 'EXECUTION_SUCCESS_RATE', drill_family_code: 'SHOT_EXECUTION',
    dosage_profile_code: 'PRIMARY_FOCUS', resolved_drill_ids: [], drill_resolution_status: 'RESOLVED',
    kpi_target_value: 0.7, kpi_target_status: 'AT_TARGET', reassessment_profile_code: 'MATCH_RECHECK'
  }, overrides || {});
}

function run() {
  return PBStore.open().then(function () {

    // ================================================================
    // R1-T01 — valid registration: BASELINE_READY -> PRESCRIPTION_READY cycle
    // + DRAFTED workflow, both durably persisted, ends without training started.
    // ================================================================
    var player1 = uid('p'); var match1 = uid('match');
    var rec1 = recommendation(); var rx1 = prescription(rec1);
    return C.registerDecisionCycle({
      player_id: player1, source_match_session_id: match1, recommendation: rec1, prescription: rx1
    }).then(function (result) {
      assert.strictEqual(result.development_cycle.state, 'PRESCRIPTION_READY', 'R1-T01 cycle reaches PRESCRIPTION_READY');
      assert.strictEqual(result.development_cycle.player_id, player1);
      assert.strictEqual(result.development_cycle.baseline_ref, match1);
      assert.deepStrictEqual(result.development_cycle.evidence_refs, [match1], 'R1-T01 match session registered as evidence_ref');
      assert.deepStrictEqual(result.development_cycle.recommendation_refs, [rec1.recommendation_id]);
      assert.deepStrictEqual(result.development_cycle.prescription_refs, [rx1.prescription_id]);
      assert.strictEqual(result.prescription_workflow.state, 'DRAFTED', 'R1-T01 workflow never auto-activated');
      assert.strictEqual(result.prescription_workflow.prescription_ref, rx1.prescription_id);
      assert.strictEqual(result.was_existing, false, 'R1-T01 newly created, not a replay');
      return PBStore.getDevelopmentCycle(result.development_cycle.cycle_id).then(function (persistedCycle) {
        assert.ok(persistedCycle, 'R1-T01 cycle durably persisted');
        assert.strictEqual(persistedCycle.state, 'PRESCRIPTION_READY');
        return PBStore.getPrescriptionWorkflow(result.prescription_workflow.workflow_id).then(function (persistedWf) {
          assert.ok(persistedWf, 'R1-T01 workflow durably persisted');
          assert.strictEqual(persistedWf.state, 'DRAFTED');
        });
      });
    });
  }).then(function () {

    // ================================================================
    // R1-T02 — idempotent replay: identical inputs a second time return the same durable
    // pair, was_existing:true, no duplicate cycle/workflow created.
    // ================================================================
    var player2 = uid('p'); var match2 = uid('match');
    var rec2 = recommendation(); var rx2 = prescription(rec2);
    var opts2 = { player_id: player2, source_match_session_id: match2, recommendation: rec2, prescription: rx2 };
    return C.registerDecisionCycle(opts2).then(function (first) {
      return C.registerDecisionCycle(opts2).then(function (second) {
        assert.strictEqual(second.development_cycle.cycle_id, first.development_cycle.cycle_id, 'R1-T02 same cycle_id on replay');
        assert.strictEqual(second.prescription_workflow.workflow_id, first.prescription_workflow.workflow_id, 'R1-T02 same workflow_id on replay');
        assert.strictEqual(second.was_existing, true, 'R1-T02 replay reports was_existing');
        return PBStore.listDevelopmentCyclesByPlayer(player2).then(function (cycles) {
          assert.strictEqual(cycles.length, 1, 'R1-T02 no duplicate development_cycle created');
        });
      });
    });
  }).then(function () {

    // ================================================================
    // R1-T03 — conflict: same player/match/recommendation, but a different prescription_id
    // -> REGISTRATION_CONFLICT, existing registration left untouched.
    // ================================================================
    var player3 = uid('p'); var match3 = uid('match');
    var rec3 = recommendation();
    var rxA = prescription(rec3); var rxB = prescription(rec3); // two distinct prescription_ids, same recommendation
    return C.registerDecisionCycle({ player_id: player3, source_match_session_id: match3, recommendation: rec3, prescription: rxA }).then(function (first) {
      return assertThrows(
        C.registerDecisionCycle({ player_id: player3, source_match_session_id: match3, recommendation: rec3, prescription: rxB }),
        'R1-T03 conflicting prescription', 'REGISTRATION_CONFLICT'
      ).then(function () {
        return PBStore.getDevelopmentCycle(first.development_cycle.cycle_id).then(function (persisted) {
          assert.deepStrictEqual(persisted.prescription_refs, [rxA.prescription_id], 'R1-T03 original prescription_refs never overwritten');
        });
      });
    });
  }).then(function () {

    // ================================================================
    // R1-T04 — identity mismatch: prescription.source_recommendation_id does not match
    // recommendation.recommendation_id -> RECOMMENDATION_PRESCRIPTION_MISMATCH, nothing persisted.
    // ================================================================
    var player4 = uid('p'); var match4 = uid('match');
    var rec4 = recommendation(); var rec4b = recommendation();
    var rx4 = prescription(rec4b); // mismatched on purpose
    return assertThrows(
      C.registerDecisionCycle({ player_id: player4, source_match_session_id: match4, recommendation: rec4, prescription: rx4 }),
      'R1-T04 mismatched recommendation/prescription', 'RECOMMENDATION_PRESCRIPTION_MISMATCH'
    ).then(function () {
      return PBStore.listDevelopmentCyclesByPlayer(player4).then(function (cycles) {
        assert.strictEqual(cycles.length, 0, 'R1-T04 no cycle created on identity mismatch');
      });
    });
  }).then(function () {

    // ================================================================
    // R1-T05 — missing required fields -> INVALID_INPUT, never a silent guess.
    // ================================================================
    var rec5 = recommendation(); var rx5 = prescription(rec5);
    return assertThrows(C.registerDecisionCycle({ source_match_session_id: 'm', recommendation: rec5, prescription: rx5 }), 'R1-T05 missing player_id', 'INVALID_INPUT')
      .then(function () { return assertThrows(C.registerDecisionCycle({ player_id: 'p', recommendation: rec5, prescription: rx5 }), 'R1-T05 missing source_match_session_id', 'INVALID_INPUT'); })
      .then(function () { return assertThrows(C.registerDecisionCycle({ player_id: 'p', source_match_session_id: 'm', prescription: rx5 }), 'R1-T05 missing recommendation', 'INVALID_INPUT'); })
      .then(function () { return assertThrows(C.registerDecisionCycle({ player_id: 'p', source_match_session_id: 'm', recommendation: rec5 }), 'R1-T05 missing prescription', 'INVALID_INPUT'); });
  }).then(function () {

    // ================================================================
    // R1-T06 — a cycle that has since accumulated newer evidence (REASSESSMENT_READY) is never
    // silently prescribed from -> STALE_RECOMMENDATION, matching S10-A's own frozen semantics.
    // ================================================================
    var player6 = uid('p'); var match6 = uid('match');
    var rec6 = recommendation(); var rx6 = prescription(rec6);
    var cycle_id6 = PBSessionEvidencePersistence.decisionCycleId(player6, match6, rec6.recommendation_id);
    var staleCycle = Object.assign(
      PBWorkflow.createDevelopmentCycle({ cycle_id: cycle_id6, player_id: player6, baseline_ref: match6 }).development_cycle,
      { state: 'REASSESSMENT_READY', evidence_refs: [match6, uid('ev')], recommendation_refs: [rec6.recommendation_id] }
    );
    return PBStore.putDevelopmentCycle(staleCycle).then(function () {
      return assertThrows(
        C.registerDecisionCycle({ player_id: player6, source_match_session_id: match6, recommendation: rec6, prescription: rx6 }),
        'R1-T06 stale cycle blocks registration', 'STALE_RECOMMENDATION'
      );
    });
  }).then(function () {

    // ================================================================
    // R1-T07 — never advances past PRESCRIPTION_READY / DRAFTED: no START_TRAINING call, no
    // ACTIVATE call, regardless of how many times registration is (idempotently) retried.
    // ================================================================
    var player7 = uid('p'); var match7 = uid('match');
    var rec7 = recommendation(); var rx7 = prescription(rec7);
    var opts7 = { player_id: player7, source_match_session_id: match7, recommendation: rec7, prescription: rx7 };
    return C.registerDecisionCycle(opts7).then(function () {
      return C.registerDecisionCycle(opts7);
    }).then(function () {
      return C.registerDecisionCycle(opts7);
    }).then(function (result) {
      assert.strictEqual(result.development_cycle.state, 'PRESCRIPTION_READY', 'R1-T07 cycle never advances to TRAINING_ACTIVE on repeated calls');
      assert.strictEqual(result.prescription_workflow.state, 'DRAFTED', 'R1-T07 workflow never advances to ACTIVE on repeated calls');
      assert.strictEqual(result.prescription_workflow.activated_at, null, 'R1-T07 never activated');
    });
  }).then(function () {

    // ================================================================
    // R1-T08 — resumability: a cycle already durably created but only partially advanced
    // (EVIDENCE_AVAILABLE, e.g. an earlier attempt that crashed after step 1) is resumed from
    // where it left off, not restarted or duplicated.
    // ================================================================
    var player8 = uid('p'); var match8 = uid('match');
    var rec8 = recommendation(); var rx8 = prescription(rec8);
    var cycle_id8 = PBSessionEvidencePersistence.decisionCycleId(player8, match8, rec8.recommendation_id);
    var partialCycle = Object.assign(
      PBWorkflow.createDevelopmentCycle({ cycle_id: cycle_id8, player_id: player8, baseline_ref: match8 }).development_cycle,
      { state: 'EVIDENCE_AVAILABLE', evidence_refs: [match8] }
    );
    return PBStore.putDevelopmentCycle(partialCycle).then(function () {
      return C.registerDecisionCycle({ player_id: player8, source_match_session_id: match8, recommendation: rec8, prescription: rx8 }).then(function (result) {
        assert.strictEqual(result.development_cycle.state, 'PRESCRIPTION_READY', 'R1-T08 resumed to completion');
        assert.deepStrictEqual(result.development_cycle.evidence_refs, [match8], 'R1-T08 evidence_refs not duplicated by resuming');
        assert.deepStrictEqual(result.development_cycle.prescription_refs, [rx8.prescription_id]);
      });
    });
  }).then(function () {

    // ================================================================
    // R1-T09 — two distinct recommendations from the same match session register as two
    // independent development cycles (no accidental id collision).
    // ================================================================
    var player9 = uid('p'); var match9 = uid('match');
    var recA = recommendation(); var rxA9 = prescription(recA);
    var recB = recommendation(); var rxB9 = prescription(recB);
    return C.registerDecisionCycle({ player_id: player9, source_match_session_id: match9, recommendation: recA, prescription: rxA9 }).then(function (resultA) {
      return C.registerDecisionCycle({ player_id: player9, source_match_session_id: match9, recommendation: recB, prescription: rxB9 }).then(function (resultB) {
        assert.notStrictEqual(resultA.development_cycle.cycle_id, resultB.development_cycle.cycle_id, 'R1-T09 distinct recommendations get distinct cycles');
        return PBStore.listDevelopmentCyclesByPlayer(player9).then(function (cycles) {
          assert.strictEqual(cycles.length, 2, 'R1-T09 two separate cycles persisted, no collision');
        });
      });
    });
  }).then(function () {

    // ================================================================
    // R1-T10 — deterministic id derivation: same inputs always derive the same cycle_id/workflow_id.
    // ================================================================
    var cid1 = PBSessionEvidencePersistence.decisionCycleId('pX', 'mX', 'rX');
    var cid2 = PBSessionEvidencePersistence.decisionCycleId('pX', 'mX', 'rX');
    assert.strictEqual(cid1, cid2, 'R1-T10 cycle id derivation is deterministic');
    var wid1 = PBSessionEvidencePersistence.decisionWorkflowId('rxX');
    var wid2 = PBSessionEvidencePersistence.decisionWorkflowId('rxX');
    assert.strictEqual(wid1, wid2, 'R1-T10 workflow id derivation is deterministic');
  }).then(function () {

    // ================================================================
    // R1-T11/T12/T13/T14 — structural source scan on the new controller.
    // ================================================================
    var SRC = fs.readFileSync(path.join(__dirname, '../js/decision-cycle-registration-controller.js'), 'utf8');
    var STRIPPED = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // R1-T11: never reruns S9.
    ['PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'diagnoseMatch', 'prioritizeDiagnosis', 'prescribeRecommendations'].forEach(function (token) {
      assert.strictEqual(STRIPPED.indexOf(token), -1, 'R1-T11: must never reference ' + token);
    });

    // R1-T12: never touches PBWorkflow/PBPrescriptionWorkflow directly — delegates only to
    // PBSessionEvidencePersistence, the single S10 durability orchestration layer.
    ['PBWorkflow', 'PBPrescriptionWorkflow', '.transition(', 'createDevelopmentCycle(', 'createPrescriptionWorkflow('].forEach(function (token) {
      assert.strictEqual(STRIPPED.indexOf(token), -1, 'R1-T12: must never reference ' + token + ' directly');
    });

    // R1-T13: never directly assigns cycle/workflow state or ref arrays.
    assert.strictEqual(/\.\s*state\s*=\s*['"]/.test(STRIPPED), false, 'R1-T13: must never directly assign .state = \'...\'');
    ['.prescription_refs =', '.recommendation_refs =', '.evidence_refs ='].forEach(function (token) {
      assert.strictEqual(STRIPPED.indexOf(token), -1, 'R1-T13: must never directly assign ' + token);
    });

    // R1-T14: never activates/starts training from this registration entry.
    ['ACTIVATE', 'START_TRAINING', 'activatePrescription', 'startTraining'].forEach(function (token) {
      assert.strictEqual(STRIPPED.indexOf(token), -1, 'R1-T14: must never reference ' + token + ' — registration ends at PRESCRIPTION_READY/DRAFTED');
    });
  }).then(function () {

    console.log('decision-cycle-registration-controller.test.js: all assertions passed');
  });
}

run().catch(function (err) {
  console.error('decision-cycle-registration-controller.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
