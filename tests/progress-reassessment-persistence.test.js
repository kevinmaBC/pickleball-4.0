/* tests/progress-reassessment-persistence.test.js — S10-E-R1: Durable
 * Progress Tracking + Reassessment Loop
 * Run: node tests/progress-reassessment-persistence.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var createFakeIndexedDB = require('./fake-indexeddb');

function assertRejects(promise, label, expectedCode) {
  return promise.then(function () {
    throw new Error(label + ' should have rejected but resolved');
  }, function (e) {
    assert.ok(e instanceof Error, label + ' rejects with an Error');
    if (expectedCode) assert.strictEqual(e.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + e.code + ')');
  });
}

// Shared fake IndexedDB across the whole run — "reload" means discarding the JS runtime
// (re-require every module) while this instance's own closure state survives, exactly like a
// real browser surviving a page reload, matching the genuine-reload methodology established in
// tests/session-evidence-persistence.test.js (S10-D-R1).
var fakeIDB = createFakeIndexedDB();
global.indexedDB = fakeIDB;

function freshRuntime() {
  delete require.cache[require.resolve('../js/namespace.js')];
  global.PBNamespace = require('../js/namespace.js');
  delete require.cache[require.resolve('../js/storage.js')];
  global.PBStore = require('../js/storage.js');
  delete require.cache[require.resolve('../js/match-observation-engine.js')];
  global.PBMatchObservation = require('../js/match-observation-engine.js');
  delete require.cache[require.resolve('../js/performance-analysis-engine.js')];
  global.PBPerformanceAnalysis = require('../js/performance-analysis-engine.js');
  delete require.cache[require.resolve('../js/diagnosis-engine.js')];
  global.PBDiagnosis = require('../js/diagnosis-engine.js');
  delete require.cache[require.resolve('../js/recommendation-priority-engine.js')];
  global.PBRecommendationPriority = require('../js/recommendation-priority-engine.js');
  delete require.cache[require.resolve('../js/training-prescription-engine.js')];
  global.PBTrainingPrescription = require('../js/training-prescription-engine.js');
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
  return global.PBProgressReassessmentPersistence;
}

var O = freshRuntime();

function baseRally(overrides) {
  return Object.assign({
    game_number: 1, rally_number: 1, phase: 'transition', intent: 'neutralize', shot: 'reset',
    target: 'middle', quality: 'good', movement: 'balanced', result: 'continue', control_state: 'neutral'
  }, overrides || {});
}
function seedMatchSession(player_id_hint) {
  return PBStore.createPlayer(player_id_hint || 'S10-E-R1 QA Player').then(function (player) {
    return PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 }).then(function (assessment) {
      return PBMatchObservation.createMatchSession({ assessment_id: assessment.assessment_id, assessment_tier: 'lite', match_context: { observer_role: 'SELF' } })
        .then(function (session) { return { player: player, assessment: assessment, session: session }; });
    });
  });
}
function addRallies(session_id, rallies) {
  var chain = Promise.resolve();
  rallies.forEach(function (r) { chain = chain.then(function () { return PBMatchObservation.addRallyObservation(session_id, baseRally(r)); }); });
  return chain;
}
// Same fixture tests/s9-full-system-qa.test.js's own FA-06 uses: 8 failed-drop rallies -> a real
// IMPROVE_SHOT_EXECUTION recommendation with kpi_profile_code EXECUTION_SUCCESS_RATE.
function seedRealMatchWithRecommendation(playerHint) {
  return seedMatchSession(playerHint).then(function (ctx) {
    var rallies = [];
    for (var i = 1; i <= 8; i++) rallies.push({ game_number: 1, rally_number: i, shot: 'drop', quality: 'error', result: 'continue' });
    return addRallies(ctx.session.test_session_id, rallies).then(function () { return ctx; });
  });
}

function trainingEvidence(overrides) {
  return Object.assign({
    evidence_id: 'ev_x', source: 'TRAINING', player_id: 'p1', session_ref: 'sint_x', prescription_ref: 'rx_1',
    recommendation_ref: 'rec_1', skill: null, kpi: 'EXECUTION_SUCCESS_RATE', value: 0.5, context: {}, timestamp: '2026-02-05T00:00:00.000Z', confidence: null, schema_version: '1.0'
  }, overrides || {});
}

function run() {
  return PBStore.open().then(function () {

    // ================================================================
    // Schema / migration
    // ================================================================
    // 1. DB_VERSION == 5
    assert.strictEqual(PBStore.DB_VERSION, 5);
    var dump = fakeIDB._dump()['pb_v2'];
    // 2. all v1-v4 stores still exist
    ['players', 'assessments', 'test_sessions', 'trial_events', 'review_snapshots', 'prescriptions', 'retests',
     'training_cycles', 'weekly_plans', 'session_plans', 'session_logs', 'cycle_summaries',
     'development_cycles', 'prescription_workflows', 'session_results', 'training_evidence'].forEach(function (name) {
      assert.ok(dump.stores[name], 'pre-existing store preserved: ' + name);
    });
    // 3/4. new stores exist
    assert.ok(dump.stores.cycle_kpi_baselines, 'cycle_kpi_baselines exists');
    assert.ok(dump.stores.reassessments, 'reassessments exists');
    // 5. required indexes exist
    assert.ok(dump.stores.cycle_kpi_baselines.indexes.by_cycle);
    assert.ok(dump.stores.cycle_kpi_baselines.indexes.by_player);
    assert.ok(dump.stores.reassessments.indexes.by_cycle);
    assert.ok(dump.stores.reassessments.indexes.by_player);
    assert.ok(dump.stores.reassessments.indexes.by_status);

    return Promise.resolve();
  }).then(function () {
    // 6/7. v4 records survive upgrade unchanged; migration is additive only — seed a fresh v4
    // database with a real record and confirm it upgrades to v5 byte-identical.
    var seeded = createFakeIndexedDB();
    var savedIDB = global.indexedDB;
    global.indexedDB = seeded;
    delete require.cache[require.resolve('../js/storage.js')];
    var SeedStore = require('../js/storage.js');
    seeded._seed(SeedStore.DB_NAME, 4, {
      players: { keyPath: 'player_id', records: [{ player_id: 'plr_seed', display_name: 'Seed Player v4' }] },
      training_evidence: { keyPath: 'evidence_id', indexes: [['by_player', 'player_id']], records: [{ evidence_id: 'ev_seed', player_id: 'plr_seed', source: 'TRAINING' }] }
    });
    return SeedStore.open().then(function () {
      var d = seeded._dump()[SeedStore.DB_NAME];
      assert.strictEqual(d.version, 5, 'seeded v4 database upgrades to v5');
      assert.strictEqual(d.stores.players.data.get('plr_seed').display_name, 'Seed Player v4', 'v4 record survives unchanged');
      assert.strictEqual(d.stores.training_evidence.data.get('ev_seed').source, 'TRAINING', 'v4 training_evidence record survives unchanged');
      assert.ok(d.stores.cycle_kpi_baselines, 'cycle_kpi_baselines created on the upgrade');
      assert.strictEqual(d.stores.cycle_kpi_baselines.data.size, 0, 'new store starts empty');
      global.indexedDB = savedIDB;
      O = freshRuntime();
    });
  }).then(function () {

    // ================================================================
    // Baseline: capture, immutability, reload
    // ================================================================
    var cyc, playerId;
    return (function () {
      var c = PBWorkflow.createDevelopmentCycle({ player_id: 'p_base', baseline_ref: 'asm_base' }).development_cycle;
      return PBStore.putDevelopmentCycle(c).then(function () { cyc = c; playerId = 'p_base'; });
    })().then(function () {
      var ev1 = trainingEvidence({ evidence_id: 'ev_pre1', player_id: playerId, value: 0.4, timestamp: '2026-01-01T00:00:00.000Z' });
      var ev2 = trainingEvidence({ evidence_id: 'ev_pre2', player_id: playerId, value: 0.58, timestamp: '2026-01-20T00:00:00.000Z' }); // latest pre-cutoff
      return Promise.all([PBStore.putTrainingEvidence(ev1), PBStore.putTrainingEvidence(ev2)]);
    }).then(function () {
      return O.captureBaselineDurable({ cycle_id: cyc.cycle_id, player_id: playerId, kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z' });
    }).then(function (baseline) {
      assert.strictEqual(baseline.tracks.TRAINING.EXECUTION_SUCCESS_RATE.value, 0.58, 'baseline captured from real persisted pre-cutoff evidence, latest value');
      assert.strictEqual(baseline.tracks.MATCH.EXECUTION_SUCCESS_RATE.status, 'UNRESOLVED', 'no durable MATCH evidence source exists yet — honestly UNRESOLVED');

      // 16. baseline immutable after new evidence
      var postCutoffEvidence = trainingEvidence({ evidence_id: 'ev_post', player_id: playerId, value: 0.99, timestamp: '2026-02-10T00:00:00.000Z' });
      return PBStore.putTrainingEvidence(postCutoffEvidence).then(function () {
        return O.captureBaselineDurable({ cycle_id: cyc.cycle_id, player_id: playerId, kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-02-01T00:00:00.000Z' });
      }).then(function (recaptured) {
        assert.strictEqual(recaptured.tracks.TRAINING.EXECUTION_SUCCESS_RATE.value, 0.58, 'recapture with the same cutoff reuses the original immutable snapshot, never backfilled with newer evidence');
        assert.deepStrictEqual(recaptured.tracks.TRAINING.EXECUTION_SUCCESS_RATE.evidence_refs.indexOf('ev_post'), -1, 'post-cutoff evidence never enters baseline evidence_refs');
      });
    }).then(function () {
      // conflicting recapture (different cutoff) rejects explicitly
      return assertRejects(
        O.captureBaselineDurable({ cycle_id: cyc.cycle_id, player_id: playerId, kpi_profile_codes: ['EXECUTION_SUCCESS_RATE'], captured_at: '2026-03-01T00:00:00.000Z' }),
        'conflicting baseline recapture', 'BASELINE_ALREADY_CAPTURED'
      );
    }).then(function () {
      // 15. baseline snapshot persists across reload
      O = freshRuntime();
      return PBStore.getCycleKpiBaseline('cb:' + cyc.cycle_id);
    }).then(function (reloaded) {
      assert.ok(reloaded, 'baseline survives a genuine reload');
      assert.strictEqual(reloaded.tracks.TRAINING.EXECUTION_SUCCESS_RATE.value, 0.58);
      assert.strictEqual(reloaded.captured_at, '2026-02-01T00:00:00.000Z');
      assert.deepStrictEqual(reloaded.tracks.TRAINING.EXECUTION_SUCCESS_RATE.evidence_refs, ['ev_pre1', 'ev_pre2'].sort());
      return { cyc: cyc, playerId: playerId };
    });
  }).then(function (ctx) {

    // ================================================================
    // Progress: durable current-value computation
    // ================================================================
    // Note: ev_post (value 0.99, timestamp 2026-02-10) from the earlier baseline-immutability
    // check is also in-window for this same player/KPI — this evidence, timestamped clearly
    // later, is the one that should win the latest-value selection; evidence_count reflects both.
    var inCycleEvidence = trainingEvidence({ evidence_id: 'ev_in_cycle', player_id: ctx.playerId, value: 0.71, timestamp: '2026-02-15T00:00:00.000Z' });
    return PBStore.putTrainingEvidence(inCycleEvidence).then(function () {
      return O.getCurrentProgressDurable({ cycle_id: ctx.cyc.cycle_id, player_id: ctx.playerId, kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'TRAINING' });
    }).then(function (progress) {
      assert.strictEqual(progress.baseline_value, 0.58);
      assert.strictEqual(progress.current_value, 0.71, 'the latest-timestamped in-window evidence wins, not the highest value');
      assert.strictEqual(progress.absolute_delta, 0.13);
      assert.strictEqual(progress.percentage_point_delta, 13);
      assert.strictEqual(progress.trend, 'IMPROVING');
      assert.strictEqual(progress.evidence_count, 2, 'both in-window TRAINING evidence records (ev_post and ev_in_cycle) count');
    });
  }).then(function () {
    return assertRejects(O.getCurrentProgressDurable({ cycle_id: 'no_such_cycle', player_id: 'p_x', kpi_profile_code: 'X', source: 'TRAINING' }), 'progress with no baseline', 'INVALID_BASELINE');
  }).then(function () {

    // ================================================================
    // Reassessment: real-Match-only, S9 reuse, idempotency, reload
    // ================================================================
    var cyc, playerId, matchSessionId, previousRecs;
    return seedRealMatchWithRecommendation('S10-E-R1 Reassess Player').then(function (matchCtx) {
      playerId = matchCtx.player.player_id;
      matchSessionId = matchCtx.session.test_session_id;
      var c = PBWorkflow.createDevelopmentCycle({ player_id: playerId, baseline_ref: matchCtx.assessment.assessment_id }).development_cycle;
      c = PBWorkflow.transition(c, 'ADD_EVIDENCE', { evidence_ref: 'ev_seed_1' });
      c = PBWorkflow.transition(c, 'GENERATE_RECOMMENDATION', { recommendation_refs: ['rec_prior_1'] });
      previousRecs = [{ recommendation_id: 'rec_prior_1', recommendation_code: 'IMPROVE_SHOT_EXECUTION', skill: 'drop', context: null, rank: 1, priority_score: 40, priority_tier: 'MEDIUM' }];
      c = PBWorkflow.transition(c, 'ADD_EVIDENCE', { evidence_ref: 'ev_seed_2' }); // -> REASSESSMENT_READY
      cyc = c;
      return PBStore.putDevelopmentCycle(cyc);
    }).then(function () {
      // 33/21 (gate). non-ready cycle rejected
      var draftCycle = PBWorkflow.createDevelopmentCycle({ player_id: playerId, baseline_ref: 'asm_x' }).development_cycle;
      return PBStore.putDevelopmentCycle(draftCycle).then(function () {
        return assertRejects(O.runReassessmentDurable({ cycle_id: draftCycle.cycle_id, player_id: playerId, real_match_session_id: matchSessionId }), 'non-ready cycle', 'REASSESSMENT_NOT_READY');
      });
    }).then(function () {
      // 34 (protection slice)/cross-player: a real match session that legitimately belongs to
      // playerId, but requested under a different caller-asserted player_id, must reject —
      // never trust the caller's player_id over the session's own owning assessment.
      return PBStore.createPlayer('Other Player').then(function (otherPlayer) {
        return assertRejects(O.runReassessmentDurable({ cycle_id: cyc.cycle_id, player_id: otherPlayer.player_id, real_match_session_id: matchSessionId }), 'cross-player reassessment', 'PLAYER_MISMATCH');
      });
    }).then(function () {
      // 34/36/37/38. real valid S9 Match Observation accepted; S9 diagnosis/priority/prescription reused
      return O.runReassessmentDurable({ cycle_id: cyc.cycle_id, player_id: playerId, real_match_session_id: matchSessionId, previous_recommendations: previousRecs });
    }).then(function (reassessment) {
      assert.strictEqual(reassessment.status, 'COMPLETED');
      assert.strictEqual(reassessment.trigger, 'REAL_MATCH_OBSERVATION');
      assert.strictEqual(reassessment.match_session_id, matchSessionId);
      assert.ok(reassessment.recommendationResult.recommendations.some(function (r) { return r.recommendation_code === 'IMPROVE_SHOT_EXECUTION'; }), 'real S9 recommendation produced');
      assert.ok(reassessment.prescriptionResult.prescriptions.length >= 1, 'real S9 prescription produced');
      assert.deepStrictEqual(reassessment.previous_recommendation_refs, ['rec_prior_1']);
      assert.ok(reassessment.new_recommendation_refs.length >= 1);
      // comparison reflects the real pipeline output
      var cmp = reassessment.comparison.filter(function (c) { return c.identity === 'IMPROVE_SHOT_EXECUTION|drop|-'; })[0];
      assert.ok(cmp, 'comparison includes the drop/IMPROVE_SHOT_EXECUTION identity');
      assert.ok(cmp.status === 'UNCHANGED' || cmp.status === 'REPRIORITIZED', 'same identity present before and after -> UNCHANGED or REPRIORITIZED, never NEW/RESOLVED');

      // 40/41. deterministic id + duplicate reassessment reused, not duplicated
      return O.runReassessmentDurable({ cycle_id: cyc.cycle_id, player_id: playerId, real_match_session_id: matchSessionId, previous_recommendations: previousRecs }).then(function (again) {
        assert.strictEqual(again.reassessment_id, reassessment.reassessment_id);
        assert.strictEqual(again.created_at, reassessment.created_at, 'the exact same persisted record is reused, not recomputed');
        return PBStore.listReassessmentsByCycle(cyc.cycle_id);
      });
    }).then(function (list) {
      assert.strictEqual(list.length, 1, 'no duplicate reassessment record was created');
      return { cyc: cyc, playerId: playerId, matchSessionId: matchSessionId };
    });
  }).then(function (ctx) {
    // 42/43. reassessment persists across reload; repeated post-reload invocation stays idempotent
    O = freshRuntime();
    return PBStore.getReassessment('re:' + ctx.cyc.cycle_id + ':' + ctx.matchSessionId).then(function (reloaded) {
      assert.ok(reloaded, 'reassessment survives a genuine reload');
      assert.strictEqual(reloaded.status, 'COMPLETED');
      assert.strictEqual(reloaded.match_session_id, ctx.matchSessionId);
      return O.runReassessmentDurable({ cycle_id: ctx.cyc.cycle_id, player_id: ctx.playerId, real_match_session_id: ctx.matchSessionId });
    }).then(function (afterReload) {
      assert.strictEqual(afterReload.reassessment_id, 're:' + ctx.cyc.cycle_id + ':' + ctx.matchSessionId);
      return PBStore.listReassessmentsByCycle(ctx.cyc.cycle_id);
    }).then(function (list) {
      assert.strictEqual(list.length, 1, 'post-reload repeated invocation creates no duplicate recommendation/prescription chain');
    });
  }).then(function () {

    // ================================================================
    // Supersession (§28/§48/§49)
    // ================================================================
    var rxOld = { prescription_id: 'rx_old_1', source_recommendation_id: 'rec_old_1', status: 'prescribed', priority_rank: 1, priority_score: 60, priority_tier: 'HIGH', training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION', kpi_profile_code: 'EXECUTION_SUCCESS_RATE' };
    var oldWorkflow = PBPrescriptionWorkflow.createPrescriptionWorkflow({ prescription: rxOld, player_id: 'p_sup' }).prescription_workflow;
    oldWorkflow = PBPrescriptionWorkflow.transition(oldWorkflow, 'ACTIVATE', {});
    var rxNew = { prescription_id: 'rx_new_1', source_recommendation_id: 'rec_new_1', status: 'prescribed', priority_rank: 1, priority_score: 75, priority_tier: 'HIGH', training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION', kpi_profile_code: 'EXECUTION_SUCCESS_RATE' };
    return PBStore.putPrescriptionWorkflow(oldWorkflow).then(function () {
      return O.supersedePrescriptionWorkflowDurable(oldWorkflow, { prescription: rxNew, player_id: 'p_sup' });
    }).then(function (result) {
      assert.strictEqual(result.superseded_workflow.state, 'SUPERSEDED');
      assert.strictEqual(result.prescription_workflow.state, 'DRAFTED');
      assert.strictEqual(result.superseded_workflow.superseded_by, result.prescription_workflow.workflow_id);
      // 49. prior workflow history preserved (original prescription_ref/activated_at intact)
      assert.strictEqual(result.superseded_workflow.prescription_ref, 'rx_old_1');
      assert.ok(result.superseded_workflow.activated_at, 'history retained, not wiped');
      return PBStore.getPrescriptionWorkflow(oldWorkflow.workflow_id);
    }).then(function (reloadedOld) {
      assert.strictEqual(reloadedOld.state, 'SUPERSEDED', 'supersession is durably persisted');
    });
  }).then(function () {

    // ================================================================
    // Cycle completion boundary (§29) — reuses S10-A's own transition;
    // documents (does not invent a shortcut for) the case where it's invalid.
    // ================================================================
    var cyc = PBWorkflow.createDevelopmentCycle({ player_id: 'p_close', baseline_ref: 'asm_close' }).development_cycle;
    // RECOMMENDATION_READY state (typical post-reassessment state) cannot legally reach
    // CYCLE_COMPLETED directly — S10-A's own contract requires PROGRESS_RECORDED first.
    cyc = PBWorkflow.transition(cyc, 'ADD_EVIDENCE', { evidence_ref: 'ev1' });
    cyc = PBWorkflow.transition(cyc, 'GENERATE_RECOMMENDATION', { recommendation_refs: ['rec1'] });
    return PBStore.putDevelopmentCycle(cyc).then(function () {
      assert.throws(function () { O.completeCycleDurable(cyc); }, function (e) { return e.code === 'INVALID_INPUT'; }, 'cycle completion from RECOMMENDATION_READY correctly rejects — S10-A owns this transition, not silently mutated');
    });
  }).then(function () {

    // ================================================================
    // Protection: no fabricated Match Observation, no S7/S8 KPI mapping,
    // no S9 internal logic, no level mutation, no S10-F logic.
    // ================================================================
    var files = ['cycle-baseline-engine.js', 'progress-tracking-engine.js', 'reassessment-engine.js', 'progress-reassessment-persistence.js'];
    files.forEach(function (f) {
      var src = fs.readFileSync(path.join(__dirname, '../js/' + f), 'utf8');
      var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      // 50. no validated_training_level mutation
      assert.ok(stripped.indexOf('validated_training_level') === -1, f + ' must never reference validated_training_level');
      // 51. no fabricated Match Observation (no direct trial_events/createObjectStore writes)
      assert.ok(stripped.indexOf('trial_events') === -1, f + ' must never construct trial_events directly');
      assert.ok(stripped.indexOf('createObjectStore') === -1, f + ' must never touch IndexedDB schema directly');
      // 52. no S7/S8 approximate KPI mapping
      ['technical_score', 'capability_score', 'reset_ball_quality_pct'].forEach(function (t) {
        assert.ok(stripped.indexOf(t) === -1, f + ' must never reference S7/S8 vocabulary "' + t + '"');
      });
      // 54. no S10-F logic (no such vocabulary should exist yet)
      ['S10-F', 'S10_F'].forEach(function (t) {
        assert.ok(stripped.indexOf(t) === -1, f + ' must never reference S10-F');
      });
    });
    // 39. no S9 internal logic copied — reassessment-engine.js/cycle-baseline-engine.js/
    // progress-tracking-engine.js have zero coupling to S9 (only the orchestrator legitimately
    // calls the S9 public pipeline).
    ['cycle-baseline-engine.js', 'progress-tracking-engine.js', 'reassessment-engine.js'].forEach(function (f) {
      var src = fs.readFileSync(path.join(__dirname, '../js/' + f), 'utf8');
      var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      ['PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'PBMatchObservation', 'PBPerformanceAnalysis'].forEach(function (t) {
        assert.ok(stripped.indexOf(t) === -1, f + ' must never reference ' + t);
      });
    });
    // 35. synthetic/training-derived match input not used — the orchestrator never builds a
    // fabricated match session; it only ever reads a real, pre-existing test_sessions record.
    var orchSrc = fs.readFileSync(path.join(__dirname, '../js/progress-reassessment-persistence.js'), 'utf8');
    var orchStripped = orchSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(orchStripped.indexOf('createMatchSession') === -1 && orchStripped.indexOf('createMatchObservationSession') === -1, 'progress-reassessment-persistence.js must never create a Match Observation session itself');
    assert.ok(orchStripped.indexOf("store.get('test_sessions'") !== -1, 'progress-reassessment-persistence.js only ever reads an existing real test_sessions record');
  }).then(function () {

    // ================================================================
    // Regression — the accepted suites this stage's inputs/outputs touch must stay green.
    // ================================================================
    var cp = require('child_process');
    var relevantSuites = [
      'cycle-baseline-engine.test.js', 'progress-tracking-engine.test.js', 'reassessment-engine.test.js',
      's9-full-system-qa.test.js', 'workflow-integration-engine.test.js', 'prescription-workflow-engine.test.js',
      'session-evidence-persistence.test.js'
    ];
    relevantSuites.forEach(function (suite) {
      var res = cp.spawnSync(process.execPath, [path.join(__dirname, suite)], { encoding: 'utf8' });
      assert.strictEqual(res.status, 0, 'accepted suite ' + suite + ' must still pass unmodified:\n' + res.stdout + res.stderr);
    });
  });
}

run().then(function () {
  console.log('progress-reassessment-persistence.test.js: all assertions passed');
}).catch(function (err) {
  console.error('progress-reassessment-persistence.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
