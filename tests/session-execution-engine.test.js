/* tests/session-execution-engine.test.js — S8-C: Session Execution Engine
 * Verifies js/session-execution-engine.js: start/complete/partial/skip
 * lifecycle, single-final-log rule, assignment integrity, timestamp
 * validation, evidence-link safety, no execution leakage into SessionPlan,
 * and Master Control safety.
 * Run: node tests/session-execution-engine.test.js
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
  return { PBTrainingPlan: PBTrainingPlan, PBSessionExecution: PBSessionExecution };
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

// Seeds player -> assessment -> review_snapshot -> prescription -> a built TrainingCycle
// (via the real S8-B engine, so SessionPlans are realistic), returns the plan result.
function seedPlan(PBTrainingPlan, opts) {
  opts = opts || {};
  return PBStore.createPlayer('P').then(function (player) {
    return PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 });
  }).then(function (a) {
    return PBStore.createReviewSnapshot({ assessment_id: a.assessment_id, data: {} }).then(function (snap) {
      var full = Object.assign({}, snap, {
        assessment_id: a.assessment_id,
        bottleneck_state: 'DETERMINED',
        primary_bottleneck: 'hard_gate:reset_ball_quality_pct',
        failed_hard_gates: [
          { metric: 'reset_ball_quality_pct', threshold: 50, direction: 'min', current_value: 40 },
          { metric: 'shot_selection_pct', threshold: 65, direction: 'min', current_value: 55 }
        ]
      });
      return PBStore.put('review_snapshots', full).then(function () {
        return PBStore.createPrescription({ assessment_id: a.assessment_id, data: { primary_bottleneck: full.primary_bottleneck, target_level: 4.0 } });
      }).then(function (rx) {
        return PBTrainingPlan.buildTrainingCyclePlan(Object.assign({
          source_review_snapshot_id: full.review_snapshot_id,
          source_prescription_id: rx.prescription_id,
          validated_level_at_start: 3.5, target_level: 4.0,
          cycle_length_weeks: 4, sessions_per_week: 2, start_date: '2026-01-05'
        }, opts));
      });
    });
  });
}

function run() {
  var chain = Promise.resolve();

  // ---- 1. Start: unknown SessionPlan ----
  chain = chain.then(function () {
    var env = freshEnv();
    return assertRejects(env.PBSessionExecution.startSession('sp_does_not_exist'), 'start unknown SessionPlan', 'SESSION_NOT_FOUND');
  });

  // ---- 2. Start: valid SessionPlan succeeds ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var sp = plan.sessionPlans[0];
      return env.PBSessionExecution.startSession(sp.session_plan_id, { started_at: '2026-01-05T09:00:00.000Z' }).then(function (state) {
        assert.strictEqual(state.session_plan_id, sp.session_plan_id);
        assert.strictEqual(state.started_at, '2026-01-05T09:00:00.000Z');
        assert.strictEqual(state.week_plan_id, sp.week_plan_id);
        assert.strictEqual(state.cycle_id, sp.cycle_id);
        var live = env.PBSessionExecution.getSessionExecutionState(sp.session_plan_id);
        assert.deepStrictEqual(live, state);
        // starting the same plan again while active should conflict (Section 23).
        return assertRejects(env.PBSessionExecution.startSession(sp.session_plan_id), 'start twice while active', 'SESSION_ALREADY_ACTIVE');
      });
    });
  });

  // ---- 3. Start: reject when SessionPlan already COMPLETED/SKIPPED ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var sp = plan.sessionPlans[0];
      return env.PBSessionExecution.skipSession(sp.session_plan_id).then(function () {
        return assertRejects(env.PBSessionExecution.startSession(sp.session_plan_id), 'start an already-SKIPPED SessionPlan', 'SESSION_NOT_STARTABLE');
      });
    });
  });

  // ---- 4. Complete: full lifecycle ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var sp = plan.sessionPlans[0];
      return env.PBSessionExecution.startSession(sp.session_plan_id, { started_at: '2026-01-05T09:00:00.000Z' }).then(function () {
        return env.PBSessionExecution.completeSession(sp.session_plan_id, {
          completed_at: '2026-01-05T09:30:00.000Z',
          results: [{ assignment_index: 0, attempts: 20, successful: 13, measured_value: 65, unit: 'percent' }],
          evidence_links: [{ assignment_index: 0 }],
          notes: 'good session'
        });
      }).then(function (log) {
        assert.strictEqual(log.status, 'COMPLETE');
        assert.strictEqual(log.session_plan_id, sp.session_plan_id);
        assert.strictEqual(log.started_at, '2026-01-05T09:00:00.000Z');
        assert.strictEqual(log.completed_at, '2026-01-05T09:30:00.000Z');
        assert.strictEqual(log.results.length, 1);
        assert.strictEqual(log.results[0].criterion_met, true, 'measured_value 65 >= threshold 50 -> criterion_met true, mechanically');
        assert.strictEqual(log.evidence_links.length, 1);
        assert.strictEqual(log.evidence_links[0].source_id, log.session_log_id, 'source_id backfilled with the real SessionLog id');
        assert.strictEqual(log.evidence_links[0].evidence_class, null, 'S8-C never assigns a C-level evidence class');

        return PBStore.listSessionLogsBySessionPlan(sp.session_plan_id);
      }).then(function (logs) {
        assert.strictEqual(logs.length, 1, 'exactly one SessionLog exists for this SessionPlan');
        return PBStore.getSessionPlan(sp.session_plan_id);
      }).then(function (updatedPlan) {
        assert.strictEqual(updatedPlan.status, 'COMPLETED', 'SessionPlan lifecycle synced to COMPLETED');
        assert.strictEqual(env.PBSessionExecution.getSessionExecutionState(sp.session_plan_id), null, 'active state cleared after finalize');
      });
    });
  });

  // ---- 5. Partial: SessionLog PARTIAL, no implied success/promotion/readiness ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var sp = plan.sessionPlans[0];
      return env.PBSessionExecution.startSession(sp.session_plan_id, { started_at: '2026-01-05T09:00:00.000Z' }).then(function () {
        return env.PBSessionExecution.partialSession(sp.session_plan_id, {
          completed_at: '2026-01-05T09:15:00.000Z',
          results: [{ assignment_index: 0, attempts: 8, successful: 3 }],
          notes: 'cut short'
        });
      }).then(function (log) {
        assert.strictEqual(log.status, 'PARTIAL');
        assert.notStrictEqual(log.status, 'COMPLETE');
        // No success/promotion/readiness vocabulary anywhere on the record.
        var json = JSON.stringify(log);
        ['PROMOTED', 'RETEST_READY', 'validated_training_level'].forEach(function (term) {
          assert.strictEqual(json.indexOf(term), -1, 'PARTIAL log must not carry ' + term);
        });
        return PBStore.getSessionPlan(sp.session_plan_id);
      }).then(function (updatedPlan) {
        // Section 15: PARTIAL still finalizes the SessionPlan slot as COMPLETED (execution finalized),
        // there is no SessionPlan-level PARTIAL enum (S8-A never defined one).
        assert.strictEqual(updatedPlan.status, 'COMPLETED');
      });
    });
  });

  // ---- 6. Skip: exactly one SKIPPED log, no fabricated results ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var sp = plan.sessionPlans[0];
      // Skipping without ever starting must be allowed (Section 14).
      return env.PBSessionExecution.skipSession(sp.session_plan_id, {
        notes: 'player unavailable',
        results: [{ assignment_index: 0, measured_value: 99 }] // must be ignored, not persisted
      }).then(function (log) {
        assert.strictEqual(log.status, 'SKIPPED');
        assert.deepStrictEqual(log.results, [], 'no fabricated results on a skipped session, even if payload tried to supply them');
        assert.deepStrictEqual(log.evidence_links, []);
        assert.strictEqual(log.started_at, null, 'a skip with no prior start records started_at as null');
        return PBStore.listSessionLogsBySessionPlan(sp.session_plan_id);
      }).then(function (logs) {
        assert.strictEqual(logs.length, 1);
        return PBStore.getSessionPlan(sp.session_plan_id);
      }).then(function (updatedPlan) {
        assert.strictEqual(updatedPlan.status, 'SKIPPED');
      });
    });
  });

  // ---- 7. Duplicate finalization ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var sp = plan.sessionPlans[0];
      return env.PBSessionExecution.completeSession(sp.session_plan_id, { completed_at: '2026-01-05T09:30:00.000Z' }).then(function () {
        return assertRejects(env.PBSessionExecution.completeSession(sp.session_plan_id, {}), 'second finalize after COMPLETE', 'SESSION_ALREADY_FINALIZED');
      }).then(function () {
        return assertRejects(env.PBSessionExecution.skipSession(sp.session_plan_id), 'skip after already finalized', 'SESSION_ALREADY_FINALIZED');
      }).then(function () {
        return PBStore.listSessionLogsBySessionPlan(sp.session_plan_id);
      }).then(function (logs) {
        assert.strictEqual(logs.length, 1, 'still exactly one SessionLog after rejected duplicate attempts');
      });
    });
  });

  // ---- 8. Assignment integrity ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var sp = plan.sessionPlans[0];
      return assertRejects(env.PBSessionExecution.completeSession(sp.session_plan_id, {
        results: [{ drill_id: 'SOME_UNRELATED_BLOCK', assessment_namespace: 'ASMT-01' }]
      }), 'result referencing a drill/namespace not on the plan', 'EXECUTION_ASSIGNMENT_MISMATCH')
        .then(function () {
          return assertRejects(env.PBSessionExecution.completeSession(sp.session_plan_id, {
            results: [{ assignment_index: 99 }]
          }), 'result referencing an out-of-range assignment_index', 'EXECUTION_ASSIGNMENT_MISMATCH');
        }).then(function () {
          return assertRejects(env.PBSessionExecution.completeSession(sp.session_plan_id, {
            evidence_links: [{ assignment_index: 0, drill_id: 'WRONG_BLOCK' }]
          }), 'evidence_link drill_id mismatched against its own assignment_index', 'EXECUTION_ASSIGNMENT_MISMATCH');
        }).then(function () {
          return PBStore.listSessionLogsBySessionPlan(sp.session_plan_id);
        }).then(function (logs) {
          assert.strictEqual(logs.length, 0, 'no SessionLog persisted for any rejected mismatch attempt');
        });
    });
  });

  // ---- 9. Timestamp validation ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var sp = plan.sessionPlans[0];
      return assertRejects(env.PBSessionExecution.completeSession(sp.session_plan_id, {
        started_at: '2026-01-05T10:00:00.000Z', completed_at: '2026-01-05T09:00:00.000Z'
      }), 'completed_at earlier than started_at', 'INVALID_TIMESTAMP_ORDER')
        .then(function () {
          return assertRejects(env.PBSessionExecution.completeSession(sp.session_plan_id, {
            started_at: 'not-a-timestamp', completed_at: '2026-01-05T09:00:00.000Z'
          }), 'malformed started_at', 'INVALID_EXECUTION_PAYLOAD');
        }).then(function () {
          return assertRejects(env.PBSessionExecution.completeSession(sp.session_plan_id, { results: 'not-an-array' }), 'results not an array', 'INVALID_EXECUTION_PAYLOAD');
        }).then(function () {
          return PBStore.listSessionLogsBySessionPlan(sp.session_plan_id);
        }).then(function (logs) {
          assert.strictEqual(logs.length, 0, 'no SessionLog persisted after any rejected payload');
        });
    });
  });

  // ---- 10. No execution leakage into SessionPlan ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var sp = plan.sessionPlans[0];
      var originalObjective = sp.objective, originalAssignments = JSON.stringify(sp.assignments), originalSequence = sp.sequence;
      return env.PBSessionExecution.completeSession(sp.session_plan_id, {
        completed_at: '2026-01-05T09:30:00.000Z',
        results: [{ assignment_index: 0, measured_value: 10 }],
        evidence_links: [{ assignment_index: 0 }],
        notes: 'x'
      }).then(function () {
        return PBStore.getSessionPlan(sp.session_plan_id);
      }).then(function (updatedPlan) {
        ['results', 'evidence_links', 'notes', 'started_at', 'completed_at'].forEach(function (f) {
          assert.ok(!Object.prototype.hasOwnProperty.call(updatedPlan, f), 'SessionPlan must never gain execution-only field: ' + f);
        });
        assert.strictEqual(updatedPlan.objective, originalObjective, 'objective untouched');
        assert.strictEqual(JSON.stringify(updatedPlan.assignments), originalAssignments, 'assignments untouched');
        assert.strictEqual(updatedPlan.sequence, originalSequence, 'sequence untouched');
        assert.strictEqual(updatedPlan.week_plan_id, sp.week_plan_id, 'week_plan_id untouched');
        assert.strictEqual(updatedPlan.cycle_id, sp.cycle_id, 'cycle_id untouched');
      });
    });
  });

  // ---- 11. Evidence safety: no automatic C1-C4, no C0 ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var sp = plan.sessionPlans[0];
      return env.PBSessionExecution.completeSession(sp.session_plan_id, {
        completed_at: '2026-01-05T09:30:00.000Z',
        evidence_links: [{ assignment_index: 0, evidence_class: 'C2' }] // caller-supplied class must be overridden, never trusted
      }).then(function (log) {
        assert.strictEqual(log.evidence_links[0].evidence_class, null, 'S8-C forces evidence_class to null even if a caller supplies one');
        var json = JSON.stringify(log);
        assert.strictEqual(json.indexOf('"C0"'), -1, 'no C0 anywhere in a SessionLog');
      });
    });
  });

  // ---- 12. Master Control safety ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var sp = plan.sessionPlans[0];
      return env.PBSessionExecution.completeSession(sp.session_plan_id, { completed_at: '2026-01-05T09:30:00.000Z' }).then(function (log) {
        assert.strictEqual(log.validated_training_level, undefined);
        // Structural check on the engine's own code (comments stripped, same convention as S8-B's test).
        var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'session-execution-engine.js'), 'utf8');
        var codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        ['validated_training_level', 'capability_score', "'C0'", '"C0"'].forEach(function (term) {
          assert.strictEqual(codeOnly.indexOf(term), -1, 'session-execution-engine.js code must not reference ' + term);
        });
        // No TrainingCycle auto-completion (Section 27): completing every SessionPlan in the cycle
        // must not flip the cycle's own status.
        return PBStore.listSessionPlansByCycle(sp.cycle_id);
      }).then(function (allPlans) {
        var remaining = allPlans.filter(function (p) { return p.session_plan_id !== sp.session_plan_id; });
        var chain2 = Promise.resolve();
        remaining.forEach(function (p) {
          chain2 = chain2.then(function () { return env.PBSessionExecution.skipSession(p.session_plan_id); });
        });
        return chain2.then(function () { return PBStore.getTrainingCycle(sp.cycle_id); });
      }).then(function (cycle) {
        assert.strictEqual(cycle.status, 'PLANNED', 'TrainingCycle status never auto-advances even when every SessionPlan is finalized');
        return PBStore.getCycleSummaryByCycle(sp.cycle_id);
      }).then(function (summary) {
        assert.strictEqual(summary, null, 'S8-C never creates a CycleSummary');
      });
    });
  });

  return chain.then(function () {
    console.log('session-execution-engine.test.js: all assertions passed');
  });
}

run().catch(function (err) {
  console.error('session-execution-engine.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
