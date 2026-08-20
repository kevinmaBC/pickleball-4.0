/* tests/training-readiness-engine.test.js — S8-D: Adherence + Training
 * Exposure + Re-test Readiness + CycleSummary
 * Run: node tests/training-readiness-engine.test.js
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

function iso(day, hour) {
  return '2026-01-' + String(day).padStart(2, '0') + 'T' + String(hour || 10).padStart(2, '0') + ':00:00.000Z';
}

// Seeds player -> assessment -> review_snapshot -> prescription -> a real S8-B TrainingCycle.
function seedPlan(PBTrainingPlan, planOverrides, snapshotOverrides) {
  planOverrides = planOverrides || {};
  snapshotOverrides = snapshotOverrides || {};
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
      }, snapshotOverrides);
      return PBStore.put('review_snapshots', full).then(function () {
        return PBStore.createPrescription({ assessment_id: a.assessment_id, data: { primary_bottleneck: full.primary_bottleneck, target_level: 4.0 } });
      }).then(function (rx) {
        return PBTrainingPlan.buildTrainingCyclePlan(Object.assign({
          source_review_snapshot_id: full.review_snapshot_id,
          source_prescription_id: rx.prescription_id,
          validated_level_at_start: 3.5, target_level: 4.0,
          cycle_length_weeks: 4, sessions_per_week: 2, start_date: '2026-01-05'
        }, planOverrides));
      });
    });
  });
}

// Builds a minimal TrainingCycle + one WeeklyPlan + N SessionPlans directly through PBStore,
// bypassing the S8-B engine's natural weekly-phase structure. Used only where a test needs a
// session-count shape that a real S8-B cycle cannot produce (S8-B always gives the PRIMARY
// assignment to every non-RETEST week, so PRIMARY-bearing sessions are structurally the large
// majority of any real cycle -- there is no way to get "high overall adherence but low primary
// exposure" out of a real S8-B plan, since neglecting PRIMARY sessions necessarily tanks overall
// adherence too). This directly exercises the S8-A storage contract, which is all S8-D depends on.
function buildSyntheticCycle(assignmentsBySession, opts) {
  opts = opts || {};
  return PBStore.createPlayer('P').then(function (player) {
    return PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 });
  }).then(function (a) {
    return PBStore.createReviewSnapshot({ assessment_id: a.assessment_id, data: {} }).then(function (snap) {
      return PBStore.createPrescription({ assessment_id: a.assessment_id, data: { primary_bottleneck: opts.primary_bottleneck || 'hard_gate:reset_ball_quality_pct' } }).then(function (rx) {
        return PBStore.createTrainingCycle({
          source_review_snapshot_id: snap.review_snapshot_id,
          source_prescription_id: rx.prescription_id,
          validated_level_at_start: 3.5, target_level: 4.0,
          primary_bottleneck: opts.primary_bottleneck || 'hard_gate:reset_ball_quality_pct',
          retest_targets: opts.retest_targets || ['reset_ball_quality_pct']
        });
      });
    });
  }).then(function (cycle) {
    return PBStore.createWeeklyPlan({ cycle_id: cycle.cycle_id, week_number: 1, phase: 'ACQUISITION', planned_sessions: assignmentsBySession.length }).then(function (wp) {
      var chain = Promise.resolve();
      var sessionPlans = [];
      assignmentsBySession.forEach(function (assignments, i) {
        chain = chain.then(function () {
          return PBStore.createSessionPlan({ week_plan_id: wp.week_plan_id, sequence: i + 1, assignments: assignments }).then(function (sp) {
            sessionPlans.push(sp);
          });
        });
      });
      return chain.then(function () { return { trainingCycle: cycle, weeklyPlan: wp, sessionPlans: sessionPlans }; });
    });
  });
}
function primaryAssignment() {
  return { assessment_namespace: 'ASMT-05', drill_id: 'RESET_TRANSITION_BLOCK', role: 'PRIMARY', target: 'reset_ball_quality_pct', planned_volume: '1 session block', success_criterion: 'reset_ball_quality_pct >= 50' };
}
function supportAssignment() {
  return { assessment_namespace: 'ASMT-08', drill_id: 'SSS_DECISION_BLOCK', role: 'SUPPORT', target: 'shot_selection_pct', planned_volume: '1 session block', success_criterion: 'shot_selection_pct >= 65' };
}

// Finalizes SessionPlans in order according to a list of statuses ('COMPLETE'|'PARTIAL'|'SKIPPED'|null for no-log).
function executeSessions(env, sessionPlans, statuses) {
  var chain = Promise.resolve();
  statuses.forEach(function (status, i) {
    if (status == null) return; // leave unlogged
    var sp = sessionPlans[i];
    var payload = { completed_at: iso(10 + i) };
    if (status !== 'SKIPPED') {
      payload.results = (sp.assignments || []).map(function (a, idx) { return { assignment_index: idx, measured_value: 60 }; });
    }
    chain = chain.then(function () {
      if (status === 'COMPLETE') return env.PBSessionExecution.completeSession(sp.session_plan_id, payload);
      if (status === 'PARTIAL') return env.PBSessionExecution.partialSession(sp.session_plan_id, payload);
      if (status === 'SKIPPED') return env.PBSessionExecution.skipSession(sp.session_plan_id, payload);
    });
  });
  return chain;
}

function run() {
  var chain = Promise.resolve();

  // ---- A. All COMPLETE -> correct adherence ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var statuses = plan.sessionPlans.map(function () { return 'COMPLETE'; });
      return executeSessions(env, plan.sessionPlans, statuses).then(function () {
        return env.PBTrainingReadiness.calculateAdherence(plan.trainingCycle.cycle_id);
      }).then(function (a) {
        assert.strictEqual(a.planned_sessions, 8);
        assert.strictEqual(a.complete_sessions, 8);
        assert.strictEqual(a.completion_equivalent, 8);
        assert.strictEqual(a.adherence_rate, 1);
      });
    });
  });

  // ---- B/C/D. PARTIAL=0.5, SKIPPED=0, NO LOG=0, mixed adherence matches the worked example shape ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan, { cycle_length_weeks: 6, sessions_per_week: 3 }).then(function (plan) {
      assert.strictEqual(plan.sessionPlans.length, 18);
      // 14 COMPLETE, 2 PARTIAL, 1 SKIPPED, 1 NO LOG (matches the brief's worked example: equivalent=15, rate=15/18)
      var statuses = [];
      for (var i = 0; i < 14; i++) statuses.push('COMPLETE');
      statuses.push('PARTIAL', 'PARTIAL', 'SKIPPED', null);
      return executeSessions(env, plan.sessionPlans, statuses).then(function () {
        return env.PBTrainingReadiness.calculateAdherence(plan.trainingCycle.cycle_id);
      }).then(function (a) {
        assert.strictEqual(a.complete_sessions, 14);
        assert.strictEqual(a.partial_sessions, 2);
        assert.strictEqual(a.skipped_sessions, 1);
        assert.strictEqual(a.unlogged_sessions, 1);
        assert.strictEqual(a.completion_equivalent, 15);
        assert.ok(Math.abs(a.adherence_rate - (15 / 18)) < 1e-9);
      });
    });
  });

  // ---- E. Adherence threshold boundary: exactly 0.80 -> PASS ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan, { cycle_length_weeks: 5, sessions_per_week: 4 }).then(function (plan) {
      // 20 sessions; need completion_equivalent/20 == 0.80 exactly -> 16 COMPLETE, 4 unlogged
      assert.strictEqual(plan.sessionPlans.length, 20);
      var statuses = [];
      for (var i = 0; i < 16; i++) statuses.push('COMPLETE');
      for (var j = 0; j < 4; j++) statuses.push(null);
      return executeSessions(env, plan.sessionPlans, statuses).then(function () {
        return env.PBTrainingReadiness.evaluateRetestReadiness(plan.trainingCycle.cycle_id);
      }).then(function (readiness) {
        assert.strictEqual(readiness.adherence.adherence_rate, 0.8);
        assert.strictEqual(readiness.gates.R1.result, 'PASS', '0.80 exactly must PASS (>=, not >)');
      });
    });
  });

  // ---- F. Primary exposure threshold boundary: exactly 0.75 -> PASS ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan, { cycle_length_weeks: 4, sessions_per_week: 4 }).then(function (plan) {
      // 4-week phases: ACQUISITION, DECISION_INTEGRATION, PRESSURE_TRANSFER, RETEST.
      // PRIMARY-role assignment appears in every week's sessions except RETEST -> 3 weeks * 4 sessions = 12 primary occurrences.
      var primaryPlans = plan.sessionPlans.filter(function (sp) { return (sp.assignments || []).some(function (a) { return a.role === 'PRIMARY'; }); });
      assert.strictEqual(primaryPlans.length, 12, 'sanity check on this fixture\'s PRIMARY occurrence count');
      // Need exactly 0.75 exposure -> 9 COMPLETE, 3 unlogged among the 12 primary-bearing sessions; remaining (retest week) sessions irrelevant here.
      var statuses = plan.sessionPlans.map(function (sp) {
        var idx = primaryPlans.indexOf(sp);
        if (idx === -1) return null; // RETEST week sessions left unlogged, don't affect R2
        return idx < 9 ? 'COMPLETE' : null;
      });
      return executeSessions(env, plan.sessionPlans, statuses).then(function () {
        return env.PBTrainingReadiness.evaluateRetestReadiness(plan.trainingCycle.cycle_id);
      }).then(function (readiness) {
        assert.strictEqual(readiness.exposure.primary_exposure_rate, 0.75);
        assert.strictEqual(readiness.gates.R2.result, 'PASS', '0.75 exactly must PASS (>=, not >)');
      });
    });
  });

  // ---- G. Per-target threshold boundary: exactly 0.70 -> PASS ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan, { cycle_length_weeks: 5, sessions_per_week: 4 }, {
      // Force a single retest target (shot_selection_pct absent) so its occurrence count is easy to hit exactly at 0.70.
      failed_hard_gates: [{ metric: 'reset_ball_quality_pct', threshold: 50, direction: 'min', current_value: 40 }]
    }).then(function (plan) {
      var occurrences = plan.sessionPlans.filter(function (sp) { return (sp.assignments || []).some(function (a) { return a.target === 'reset_ball_quality_pct'; }); });
      // reset_ball_quality_pct is both the primary bottleneck and the only retest target -> appears in every week's sessions (5 weeks * 4 sessions/week).
      assert.strictEqual(occurrences.length, 20, 'sanity check on this fixture\'s target occurrence count');
      // Need exactly 14/20 = 0.70.
      var statuses = plan.sessionPlans.map(function (sp) {
        var idx = occurrences.indexOf(sp);
        if (idx === -1) return null;
        return idx < 14 ? 'COMPLETE' : null;
      });
      return executeSessions(env, plan.sessionPlans, statuses).then(function () {
        return env.PBTrainingReadiness.evaluateRetestReadiness(plan.trainingCycle.cycle_id);
      }).then(function (readiness) {
        var detail = readiness.exposure.retest_target_detail[0];
        assert.strictEqual(detail.exposure_rate, 0.7);
        assert.strictEqual(readiness.gates.R3.result, 'PASS', '0.70 exactly must PASS (>=, not >)');
      });
    });
  });

  // ---- H. One retest target below threshold -> R3 FAIL and NOT_READY (no averaging across targets) ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan, { cycle_length_weeks: 6, sessions_per_week: 3 }).then(function (plan) {
      // Complete everything (high adherence, high primary exposure) except heavily under-expose shot_selection_pct's sessions.
      var shotSelectionPlans = plan.sessionPlans.filter(function (sp) { return (sp.assignments || []).some(function (a) { return a.target === 'shot_selection_pct'; }); });
      var statuses = plan.sessionPlans.map(function (sp) {
        return shotSelectionPlans.indexOf(sp) !== -1 ? null : 'COMPLETE'; // leave every shot_selection_pct session unlogged
      });
      return executeSessions(env, plan.sessionPlans, statuses).then(function () {
        return env.PBTrainingReadiness.evaluateRetestReadiness(plan.trainingCycle.cycle_id);
      }).then(function (readiness) {
        var shotDetail = readiness.exposure.retest_target_detail.filter(function (d) { return d.metric === 'shot_selection_pct'; })[0];
        assert.strictEqual(shotDetail.exposure_rate, 0, 'the under-trained target itself is 0, not averaged up by the well-trained one');
        assert.strictEqual(readiness.gates.R3.result, 'FAIL');
        assert.strictEqual(readiness.retest_readiness, 'NOT_READY');
      });
    });
  });

  // ---- I. High overall adherence but insufficient primary exposure -> NOT_READY ----
  // A real S8-B cycle can't produce this shape (PRIMARY is scheduled into every non-RETEST week,
  // so neglecting it always drags overall adherence down too -- see buildSyntheticCycle's comment).
  // Build the SessionPlans directly through PBStore instead, exercising only the S8-A storage
  // contract S8-D actually depends on: 2 PRIMARY-only sessions (both skipped) + 18 SUPPORT-only
  // sessions (all completed).
  chain = chain.then(function () {
    var env = freshEnv();
    var sessions = [[primaryAssignment()], [primaryAssignment()]];
    for (var i = 0; i < 18; i++) sessions.push([supportAssignment()]);
    return buildSyntheticCycle(sessions, { retest_targets: ['reset_ball_quality_pct', 'shot_selection_pct'] }).then(function (built) {
      var statuses = built.sessionPlans.map(function (sp, idx) { return idx < 2 ? 'SKIPPED' : 'COMPLETE'; });
      return executeSessions(env, built.sessionPlans, statuses).then(function () {
        return env.PBTrainingReadiness.evaluateRetestReadiness(built.trainingCycle.cycle_id);
      }).then(function (readiness) {
        assert.strictEqual(readiness.adherence.adherence_rate, 0.9, 'adherence should still be high in this fixture (18/20)');
        assert.ok(readiness.adherence.adherence_rate >= 0.80);
        assert.strictEqual(readiness.exposure.primary_exposure_rate, 0, 'both PRIMARY sessions were skipped');
        assert.strictEqual(readiness.gates.R1.result, 'PASS');
        assert.strictEqual(readiness.gates.R2.result, 'FAIL');
        assert.strictEqual(readiness.retest_readiness, 'NOT_READY');
      });
    });
  });

  // ---- J. High adherence + primary exposure but one required target missing authoritative mapping -> INCOMPLETE ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var statuses = plan.sessionPlans.map(function () { return 'COMPLETE'; });
      return executeSessions(env, plan.sessionPlans, statuses).then(function () {
        // Simulate a retest target with no corresponding planned assignment anywhere (unmappable), by directly
        // patching the persisted TrainingCycle -- this is exactly the real-world case the brief describes:
        // a retest_targets entry whose drill/namespace mapping never resolved to a plannable assignment.
        return PBStore.updateTrainingCycle(plan.trainingCycle.cycle_id, {
          retest_targets: plan.trainingCycle.retest_targets.concat(['totally_unmapped_metric'])
        });
      }).then(function () {
        return env.PBTrainingReadiness.evaluateRetestReadiness(plan.trainingCycle.cycle_id);
      }).then(function (readiness) {
        assert.strictEqual(readiness.gates.R3.result, 'INCOMPLETE');
        assert.strictEqual(readiness.gates.R4.result, 'INCOMPLETE');
        assert.strictEqual(readiness.retest_readiness, 'INCOMPLETE', 'INCOMPLETE must win even though R1/R2 both PASS');
      });
    });
  });

  // ---- K. Required target planned but never executed -> R4 FAIL / NOT_READY ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      // Leave every shot_selection_pct-bearing session unlogged, but that's covered by test H already testing R3;
      // here construct a case where R3 could theoretically still read as "some exposure" is impossible under the
      // current 0/1/0.5 credit model (0 executions always yields 0 exposure, so R3 also fails) -- assert both gates
      // agree the target was planned-but-never-executed.
      var shotSelectionPlans = plan.sessionPlans.filter(function (sp) { return (sp.assignments || []).some(function (a) { return a.target === 'shot_selection_pct'; }); });
      assert.ok(shotSelectionPlans.length > 0, 'sanity: shot_selection_pct is planned somewhere in this cycle');
      var statuses = plan.sessionPlans.map(function (sp) {
        return shotSelectionPlans.indexOf(sp) !== -1 ? null : 'COMPLETE';
      });
      return executeSessions(env, plan.sessionPlans, statuses).then(function () {
        return env.PBTrainingReadiness.evaluateRetestReadiness(plan.trainingCycle.cycle_id);
      }).then(function (readiness) {
        var shotDetail = readiness.exposure.retest_target_detail.filter(function (d) { return d.metric === 'shot_selection_pct'; })[0];
        assert.strictEqual(shotDetail.occurrence_count > 0, true, 'the target IS planned (has assignment occurrences)');
        assert.strictEqual(shotDetail.has_complete_or_partial, false, 'but never actually executed');
        assert.strictEqual(readiness.gates.R4.result, 'FAIL');
        assert.strictEqual(readiness.retest_readiness, 'NOT_READY');
      });
    });
  });

  // ---- L. Broken/missing authoritative ancestry/source data -> INCOMPLETE ----
  // primary_bottleneck='capability_threshold' has no single mappable metric -- S8-B itself would
  // reject building a cycle for this (INCOMPLETE_MAPPING), so to exercise S8-D's own defensive
  // handling of broken ancestry, build a normal cycle then directly corrupt its primary_bottleneck
  // field to an unmappable value, simulating a TrainingCycle whose authoritative source data is
  // broken/missing by the time S8-D runs.
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var statuses = plan.sessionPlans.map(function () { return 'COMPLETE'; });
      return executeSessions(env, plan.sessionPlans, statuses).then(function () {
        return PBStore.updateTrainingCycle(plan.trainingCycle.cycle_id, { primary_bottleneck: 'capability_threshold' });
      }).then(function () {
        return env.PBTrainingReadiness.evaluateRetestReadiness(plan.trainingCycle.cycle_id);
      }).then(function (readiness) {
        assert.strictEqual(readiness.gates.R2.result, 'INCOMPLETE');
        assert.strictEqual(readiness.retest_readiness, 'INCOMPLETE');
      });
    });
  });
  chain = chain.then(function () {
    var env = freshEnv();
    return assertRejects(env.PBTrainingReadiness.evaluateRetestReadiness('tc_does_not_exist'), 'evaluateRetestReadiness on unknown cycle', 'CYCLE_NOT_FOUND');
  });

  // ---- M. PARTIAL session assignment exposure = 0.50 ----
  chain = chain.then(function () {
    var env = freshEnv();
    return buildSyntheticCycle([[primaryAssignment()]]).then(function (built) {
      return executeSessions(env, built.sessionPlans, ['PARTIAL']).then(function () {
        return env.PBTrainingReadiness.calculateTrainingExposure(built.trainingCycle.cycle_id);
      }).then(function (exposure) {
        // A single PRIMARY-bearing session marked PARTIAL -> exposure = 0.50, exactly.
        assert.strictEqual(exposure.primary_exposure_rate, 0.5);
      });
    });
  });

  // ---- N. Match-transfer exposure does not enter CAP or formal Match Validation ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan, { cycle_length_weeks: 6, sessions_per_week: 3 }).then(function (plan) {
      var statuses = plan.sessionPlans.map(function () { return 'COMPLETE'; });
      return executeSessions(env, plan.sessionPlans, statuses).then(function () {
        return env.PBTrainingReadiness.calculateTrainingExposure(plan.trainingCycle.cycle_id);
      }).then(function (exposure) {
        assert.strictEqual(exposure.match_transfer_exposure, 1, 'match_transfer_score assignment fully completed');
        assert.strictEqual(exposure.match_transfer_exposure !== undefined, true);
        // Structural: match_transfer_exposure must never be folded into a capability/CAP number anywhere in the engine.
        var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'training-readiness-engine.js'), 'utf8');
        var codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        ['capability_score', 'CAP_score', 'match_validation_passed'].forEach(function (term) {
          assert.strictEqual(codeOnly.indexOf(term), -1, 'engine code must not reference ' + term);
        });
      });
    });
  });

  // ---- O/P/Q. No validated_training_level write, no Hard Gate pass/write, no promotion ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var statuses = plan.sessionPlans.map(function () { return 'COMPLETE'; });
      return executeSessions(env, plan.sessionPlans, statuses).then(function () {
        return env.PBTrainingReadiness.buildCycleSummary(plan.trainingCycle.cycle_id);
      }).then(function (summary) {
        var forbidden = ['validated_training_level', 'new_level', 'promoted_level', 'capability_score', 'CAP_score', 'hard_gate_passed', 'match_validation_passed', 'promotion_status'];
        var json = JSON.stringify(summary);
        forbidden.forEach(function (term) {
          assert.strictEqual(json.indexOf(term), -1, 'CycleSummary must never contain ' + term);
        });
        var src = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'training-readiness-engine.js'), 'utf8');
        var codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        forbidden.forEach(function (term) {
          assert.strictEqual(codeOnly.indexOf(term), -1, 'engine source code must never reference ' + term);
        });
        // No automatic cycle completion either (Section 15).
        return PBStore.getTrainingCycle(plan.trainingCycle.cycle_id);
      }).then(function (cycle) {
        assert.strictEqual(cycle.status, 'PLANNED', 'TrainingCycle status must never auto-advance from building a CycleSummary');
      });
    });
  });

  // ---- R. CycleSummary persists through existing PBStore architecture ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var statuses = plan.sessionPlans.map(function () { return 'COMPLETE'; });
      return executeSessions(env, plan.sessionPlans, statuses).then(function () {
        return env.PBTrainingReadiness.buildCycleSummary(plan.trainingCycle.cycle_id);
      }).then(function (summary) {
        return PBStore.getCycleSummary(summary.cycle_summary_id).then(function (fetched) {
          assert.deepStrictEqual(fetched, summary);
          return PBStore.getCycleSummaryByCycle(plan.trainingCycle.cycle_id);
        }).then(function (byCycle) {
          assert.strictEqual(byCycle.cycle_summary_id, summary.cycle_summary_id);
        });
      });
    });
  });

  // ---- S. Recalculation does not create uncontrolled duplicate CycleSummaries ----
  chain = chain.then(function () {
    var env = freshEnv();
    return seedPlan(env.PBTrainingPlan).then(function (plan) {
      var statuses = plan.sessionPlans.map(function () { return 'COMPLETE'; });
      return executeSessions(env, plan.sessionPlans, statuses).then(function () {
        return env.PBTrainingReadiness.buildCycleSummary(plan.trainingCycle.cycle_id);
      }).then(function (first) {
        return env.PBTrainingReadiness.buildCycleSummary(plan.trainingCycle.cycle_id).then(function (second) {
          assert.strictEqual(second.cycle_summary_id, first.cycle_summary_id, 'recalculation updates the same record');
          return PBStore.getByIndex('cycle_summaries', 'by_cycle', plan.trainingCycle.cycle_id);
        });
      }).then(function (all) {
        assert.strictEqual(all.length, 1, 'exactly one CycleSummary exists per cycle after multiple recalculations');
      });
    });
  });

  return chain.then(function () {
    console.log('training-readiness-engine.test.js: all assertions passed');
  });
}

run().catch(function (err) {
  console.error('training-readiness-engine.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
