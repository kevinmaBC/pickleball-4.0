/* tests/cross-layer-integration.test.js — S8-F cross-layer integration QA
 *
 * Proves the accepted conceptual chain end-to-end, using only real
 * accepted APIs (no second orchestration layer, no new formal re-test
 * engine):
 *
 *   Assessment -> Review Snapshot -> Prescription -> TrainingCycle ->
 *   WeeklyPlan -> SessionPlan -> Session Execution -> SessionLog ->
 *   CycleSummary -> Re-test Readiness -> (Measure / formal re-test path)
 *
 * Each per-layer engine already has its own deep test suite
 * (training-plan-engine.test.js, session-execution-engine.test.js,
 * training-readiness-engine.test.js, etc.); this file is a single
 * connected walkthrough proving the layers actually compose, plus the
 * S8-F required scenarios that don't already have dedicated coverage
 * elsewhere: duplicate-cycle protection observed mid-chain, duplicate
 * finalization mid-chain, and Scenario R (active-session reload
 * behavior, not exercised by any existing suite).
 *
 * Run: node tests/cross-layer-integration.test.js
 */
var assert = require('assert');
var createFakeIndexedDB = require('./fake-indexeddb');

global.PBNamespace = require('../js/namespace.js');

function freshEnv() {
  global.indexedDB = createFakeIndexedDB();
  delete require.cache[require.resolve('../js/storage.js')];
  global.PBStore = require('../js/storage.js');
  delete require.cache[require.resolve('../js/training-plan-engine.js')];
  var PBTrainingPlan = require('../js/training-plan-engine.js');
  delete require.cache[require.resolve('../js/session-execution-engine.js')];
  var PBSessionExecution = require('../js/session-execution-engine.js');
  delete require.cache[require.resolve('../js/training-readiness-engine.js')];
  var PBTrainingReadiness = require('../js/training-readiness-engine.js');
  return { PBTrainingPlan: PBTrainingPlan, PBSessionExecution: PBSessionExecution, PBTrainingReadiness: PBTrainingReadiness };
}

function assertRejects(promise, label, expectedCode) {
  return promise.then(
    function () { throw new Error('expected rejection but resolved: ' + label); },
    function (err) {
      assert.ok(err instanceof Error, label + ' rejects with an Error');
      if (expectedCode) assert.strictEqual(err.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + err.code + ')');
    }
  );
}
function iso(day, hour) { return '2026-02-' + String(day).padStart(2, '0') + 'T' + String(hour || 9).padStart(2, '0') + ':00:00.000Z'; }

function run() {
  var env = freshEnv();
  var ctx = {};

  return Promise.resolve()
    // ---- Layer 1: Assessment -> Review Snapshot (Scenario A/B) ----
    .then(function () {
      return PBStore.createPlayer('Integration QA');
    }).then(function (player) {
      ctx.player = player;
      return PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 });
    }).then(function (assessment) {
      ctx.assessment = assessment;

      // Scenario A: a snapshot with bottleneck_state INCOMPLETE (missing evidence) must never
      // let downstream layers fabricate a validated level or a usable planning target.
      return PBStore.createReviewSnapshot({ assessment_id: assessment.assessment_id, data: {} }).then(function (incompleteSnap) {
        var incomplete = Object.assign({}, incompleteSnap, {
          assessment_id: assessment.assessment_id, bottleneck_state: 'INCOMPLETE', primary_bottleneck: null, failed_hard_gates: []
        });
        return PBStore.put('review_snapshots', incomplete).then(function () {
          return PBStore.createPrescription({ assessment_id: assessment.assessment_id, data: { primary_bottleneck: null, target_level: null } });
        }).then(function (incompleteRx) {
          return assertRejects(env.PBTrainingPlan.buildTrainingCyclePlan({
            source_review_snapshot_id: incomplete.review_snapshot_id, source_prescription_id: incompleteRx.prescription_id,
            validated_level_at_start: 3.5, target_level: 4.0
          }), 'missing-evidence snapshot must not let a plan be built', 'INCOMPLETE');
        });
      });
    }).then(function () {
      // Now the valid Scenario B path: a real, complete Review Snapshot.
      return PBStore.createReviewSnapshot({ assessment_id: ctx.assessment.assessment_id, data: {} });
    }).then(function (snap) {
      var full = Object.assign({}, snap, {
        assessment_id: ctx.assessment.assessment_id, bottleneck_state: 'DETERMINED',
        primary_bottleneck: 'hard_gate:reset_ball_quality_pct',
        failed_hard_gates: [
          { metric: 'reset_ball_quality_pct', threshold: 50, direction: 'min', current_value: 40 },
          { metric: 'shot_selection_pct', threshold: 65, direction: 'min', current_value: 55 }
        ]
      });
      return PBStore.put('review_snapshots', full).then(function () { ctx.snapshot = full; });
    })
    // ---- Layer 2: Review Snapshot -> Prescription (Scenario B) ----
    .then(function () {
      return PBStore.createPrescription({ assessment_id: ctx.assessment.assessment_id, data: { primary_bottleneck: ctx.snapshot.primary_bottleneck, target_level: 4.0 } });
    }).then(function (rx) {
      ctx.prescription = rx;
      assert.strictEqual(rx.data.primary_bottleneck, ctx.snapshot.primary_bottleneck, 'Prescription carries the snapshot bottleneck verbatim, not recomputed');
    })
    // ---- Layer 3: Prescription -> TrainingCycle/WeeklyPlan/SessionPlan, valid ancestry (Scenario C) ----
    .then(function () {
      return env.PBTrainingPlan.buildTrainingCyclePlan({
        source_review_snapshot_id: ctx.snapshot.review_snapshot_id, source_prescription_id: ctx.prescription.prescription_id,
        validated_level_at_start: 3.5, target_level: 4.0, cycle_length_weeks: 4, sessions_per_week: 2, start_date: '2026-02-01'
      });
    }).then(function (plan) {
      ctx.plan = plan;
      assert.strictEqual(plan.trainingCycle.source_review_snapshot_id, ctx.snapshot.review_snapshot_id, 'TrainingCycle ancestry: correct source review snapshot');
      assert.strictEqual(plan.trainingCycle.source_prescription_id, ctx.prescription.prescription_id, 'TrainingCycle ancestry: correct source prescription');
      plan.weeklyPlans.forEach(function (wp) { assert.strictEqual(wp.cycle_id, plan.trainingCycle.cycle_id, 'WeeklyPlan ancestry'); });
      plan.sessionPlans.forEach(function (sp) {
        assert.strictEqual(sp.cycle_id, plan.trainingCycle.cycle_id, 'SessionPlan ancestry: cycle_id');
        assert.ok(plan.weeklyPlans.some(function (wp) { return wp.week_plan_id === sp.week_plan_id; }), 'SessionPlan ancestry: week_plan_id resolves to a real WeeklyPlan in this cycle');
      });
    })
    // ---- Scenario D: duplicate active/planned cycle protection, observed mid-chain ----
    .then(function () {
      return assertRejects(env.PBTrainingPlan.buildTrainingCyclePlan({
        source_review_snapshot_id: ctx.snapshot.review_snapshot_id, source_prescription_id: ctx.prescription.prescription_id,
        validated_level_at_start: 3.5, target_level: 4.0
      }), 'a second build for the same prescription while the first is PLANNED must be rejected', 'DUPLICATE_ACTIVE_CYCLE');
    })
    // ---- Layer 4/5: SessionPlan -> Session Execution -> SessionLog (Scenarios E/F/G/H) ----
    .then(function () {
      var sps = ctx.plan.sessionPlans; // 4 weeks * 2/week = 8 SessionPlans
      assert.strictEqual(sps.length, 8);
      // E: COMPLETE -> exactly one durable SessionLog.
      return env.PBSessionExecution.startSession(sps[0].session_plan_id, { started_at: iso(1, 9) }).then(function () {
        return env.PBSessionExecution.completeSession(sps[0].session_plan_id, { completed_at: iso(1, 10), results: [{ assignment_index: 0, measured_value: 60 }] });
      }).then(function (log0) {
        assert.strictEqual(log0.status, 'COMPLETE');
        return PBStore.listSessionLogsBySessionPlan(sps[0].session_plan_id);
      }).then(function (logs) {
        assert.strictEqual(logs.length, 1, 'Scenario E: exactly one durable SessionLog for a completed session');

        // H: duplicate finalization on that same, already-finalized SessionPlan must be rejected,
        // and must not create a second log.
        return assertRejects(env.PBSessionExecution.completeSession(sps[0].session_plan_id, {}), 'Scenario H: duplicate finalization', 'SESSION_ALREADY_FINALIZED');
      }).then(function () {
        return PBStore.listSessionLogsBySessionPlan(sps[0].session_plan_id);
      }).then(function (logs) {
        assert.strictEqual(logs.length, 1, 'Scenario H: still exactly one SessionLog after a rejected duplicate finalize attempt');

        // F: PARTIAL is recorded distinctly and never implies capability/assessment pass.
        return env.PBSessionExecution.partialSession(sps[1].session_plan_id, { completed_at: iso(1, 11), results: [{ assignment_index: 0, measured_value: 45 }] });
      }).then(function (logF) {
        assert.strictEqual(logF.status, 'PARTIAL');
        assert.strictEqual(JSON.stringify(logF).indexOf('capability'), -1, 'Scenario F: no capability vocabulary anywhere on a PARTIAL log');

        // G: SKIPPED is durable and never fabricates evidence.
        return env.PBSessionExecution.skipSession(sps[2].session_plan_id, { notes: 'rained out' });
      }).then(function (logG) {
        assert.strictEqual(logG.status, 'SKIPPED');
        assert.deepStrictEqual(logG.results, [], 'Scenario G: no fabricated results on a skipped session');
        assert.deepStrictEqual(logG.evidence_links, [], 'Scenario G: no fabricated evidence on a skipped session');
      });
    })
    // ---- Scenario R: active-session reload behavior — S8-C's in-memory execution state is
    // intentionally lost across a reload; this must never corrupt data or create a duplicate
    // finalized log. A page reload is simulated the same way a real reload would reset JS
    // memory: re-`require`ing session-execution-engine.js discards its in-memory `_active` map
    // while PBStore (IndexedDB-backed) and the SessionPlan's persisted status survive untouched. ----
    .then(function () {
      var sp = ctx.plan.sessionPlans[3];
      return env.PBSessionExecution.startSession(sp.session_plan_id, { started_at: iso(2, 9) }).then(function (state) {
        assert.ok(state, 'session started, active state exists pre-reload');

        // Simulate reload: fresh module instance, in-memory active state gone.
        delete require.cache[require.resolve('../js/session-execution-engine.js')];
        var PBSessionExecutionAfterReload = require('../js/session-execution-engine.js');

        assert.strictEqual(PBSessionExecutionAfterReload.getSessionExecutionState(sp.session_plan_id), null, 'active state does not survive the simulated reload (by design, documented in S8-E)');

        return PBStore.getSessionPlan(sp.session_plan_id).then(function (spAfter) {
          assert.strictEqual(spAfter.status, 'PLANNED', 'the SessionPlan itself is untouched by the lost active state -- no silent corruption');
          return PBStore.listSessionLogsBySessionPlan(sp.session_plan_id);
        }).then(function (logs) {
          assert.strictEqual(logs.length, 0, 'no phantom/duplicate SessionLog was created merely by losing the active state');

          // The user can still finalize cleanly after "reloading" -- finalize doesn't require
          // a live active state (it falls back to null started_at, or the caller can supply one).
          env.PBSessionExecution = PBSessionExecutionAfterReload;
          return env.PBSessionExecution.completeSession(sp.session_plan_id, { started_at: iso(2, 9), completed_at: iso(2, 10), results: [{ assignment_index: 0, measured_value: 55 }] });
        }).then(function (log) {
          assert.strictEqual(log.status, 'COMPLETE');
          return PBStore.listSessionLogsBySessionPlan(sp.session_plan_id);
        }).then(function (logs) {
          assert.strictEqual(logs.length, 1, 'exactly one durable SessionLog after finalizing post-reload -- no duplicate finalized logs');
        });
      });
    })
    // ---- Finish the remaining sessions so readiness can be meaningfully evaluated ----
    .then(function () {
      var remaining = ctx.plan.sessionPlans.slice(4);
      var chain = Promise.resolve();
      remaining.forEach(function (sp, i) {
        chain = chain.then(function () {
          return env.PBSessionExecution.completeSession(sp.session_plan_id, { completed_at: iso(3 + i, 9), results: (sp.assignments || []).map(function (a, idx) { return { assignment_index: idx, measured_value: 60 }; }) });
        });
      });
      return chain;
    })
    // ---- Layer 6/7: SessionLog -> CycleSummary -> Re-test Readiness (Scenario L) ----
    .then(function () {
      return env.PBTrainingReadiness.buildCycleSummary(ctx.plan.trainingCycle.cycle_id);
    }).then(function (summary) {
      ctx.summary = summary;
      assert.ok(['READY', 'NOT_READY', 'INCOMPLETE'].indexOf(summary.retest_readiness) !== -1, 'readiness is one of the three frozen semantic states');
      // 6 COMPLETE + 1 PARTIAL + 1 SKIPPED of 8 sessions -> adherence = (6*1 + 1*0.5 + 1*0)/8 = 0.8125 (>=0.80);
      // primary exposure = 4.5/6 = 0.75 exactly (>=0.75); both retest targets clear 0.70. This is a
      // realistic mixed execution history (not an artificially all-COMPLETE fixture) that still
      // legitimately crosses every threshold -- Scenario L (READY requires all gates PASS) proven
      // through the full real chain, not a hand-massaged shortcut.
      assert.strictEqual(summary.retest_readiness, 'READY', 'a realistic mixed execution history that genuinely clears every threshold correctly yields READY');
      ['R1', 'R2', 'R3', 'R4'].forEach(function (g) {
        assert.strictEqual(summary.training_exposure.gates[g].result, 'PASS', g + ' must PASS for an overall READY result');
      });

      // Scenario M: even where a cycle IS ready, readiness must never promote or touch validated_training_level.
      // Verified structurally here on the actual persisted records (not just the engine's own source code).
      var cycleJSON = JSON.stringify(ctx.plan.trainingCycle);
      var summaryJSON = JSON.stringify(summary);
      ['validated_training_level', 'promoted', 'PROMOTED', 'hard_gate_passed', 'match_validation_passed'].forEach(function (term) {
        assert.strictEqual(cycleJSON.indexOf(term), -1, 'TrainingCycle record must never contain ' + term);
        assert.strictEqual(summaryJSON.indexOf(term), -1, 'CycleSummary record must never contain ' + term);
      });

      // Cycle Status != Re-test Readiness: readiness computation must never mutate TrainingCycle.status.
      return PBStore.getTrainingCycle(ctx.plan.trainingCycle.cycle_id);
    }).then(function (cycle) {
      assert.strictEqual(cycle.status, 'PLANNED', 'TrainingCycle.status is untouched by readiness computation (Cycle Status != Re-test Readiness)');
    })
    // ---- Recalculation does not create uncontrolled duplicate CycleSummaries mid-chain ----
    .then(function () {
      return env.PBTrainingReadiness.buildCycleSummary(ctx.plan.trainingCycle.cycle_id);
    }).then(function (second) {
      assert.strictEqual(second.cycle_summary_id, ctx.summary.cycle_summary_id, 'recalculation updates the same CycleSummary record');
      return PBStore.getByIndex('cycle_summaries', 'by_cycle', ctx.plan.trainingCycle.cycle_id);
    }).then(function (all) {
      assert.strictEqual(all.length, 1, 'exactly one CycleSummary exists for this cycle end-to-end');
    })
    // ---- Scenario N: Match Transfer exposure, when present, stays isolated from CAP/Match Validation ----
    .then(function () {
      var env2 = freshEnv();
      return PBStore.createPlayer('MT QA').then(function (player) {
        return PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 });
      }).then(function (a) {
        return PBStore.createReviewSnapshot({ assessment_id: a.assessment_id, data: {} }).then(function (snap) {
          var full = Object.assign({}, snap, { assessment_id: a.assessment_id, bottleneck_state: 'DETERMINED', primary_bottleneck: 'match_validation', failed_hard_gates: [] });
          return PBStore.put('review_snapshots', full).then(function () {
            return PBStore.createPrescription({ assessment_id: a.assessment_id, data: { primary_bottleneck: 'match_validation', target_level: 4.0 } });
          }).then(function (rx) {
            return env2.PBTrainingPlan.buildTrainingCyclePlan({
              source_review_snapshot_id: full.review_snapshot_id, source_prescription_id: rx.prescription_id,
              validated_level_at_start: 3.5, target_level: 4.0, cycle_length_weeks: 6, sessions_per_week: 3, start_date: '2026-02-01'
            });
          });
        });
      }).then(function (plan) {
        var chain2 = Promise.resolve();
        plan.sessionPlans.forEach(function (sp, i) {
          chain2 = chain2.then(function () { return env2.PBSessionExecution.completeSession(sp.session_plan_id, { completed_at: iso(1 + i, 9), results: (sp.assignments || []).map(function (a, idx) { return { assignment_index: idx, measured_value: 60 }; }) }); });
        });
        return chain2.then(function () { return env2.PBTrainingReadiness.calculateTrainingExposure(plan.trainingCycle.cycle_id); });
      }).then(function (exposure) {
        assert.ok(exposure.match_transfer_exposure != null, 'match_transfer_score assignment present -> exposure computed, not null');
        assert.strictEqual(JSON.stringify(exposure).indexOf('cap'), -1, 'match transfer exposure output never mentions CAP');
        assert.strictEqual(JSON.stringify(exposure).indexOf('match_validation_passed'), -1, 'training exposure is never mislabeled as Match Validation passing');
      });
    })
    .then(function () {
      console.log('cross-layer-integration.test.js: all assertions passed');
    });
}

run().catch(function (err) {
  console.error('cross-layer-integration.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
