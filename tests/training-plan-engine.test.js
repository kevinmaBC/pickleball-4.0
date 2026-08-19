/* tests/training-plan-engine.test.js — S8-B: Adaptive Plan Engine
 * Verifies js/training-plan-engine.js: baseline plan build (6/5/4-week
 * cycles), input validation, duplicate protection, determinism, incomplete
 * drill-mapping handling, Master Control safety, and no execution leakage
 * (no SessionLog, no execution-only fields on SessionPlan).
 * Run: node tests/training-plan-engine.test.js
 */
var assert = require('assert');
var createFakeIndexedDB = require('./fake-indexeddb');

global.PBNamespace = require('../js/namespace.js');

function freshStore() {
  global.indexedDB = createFakeIndexedDB();
  delete require.cache[require.resolve('../js/storage.js')];
  global.PBStore = require('../js/storage.js');
  delete require.cache[require.resolve('../js/training-plan-engine.js')];
  return require('../js/training-plan-engine.js');
}

var testDefs = require('../data/test_definitions_v2_3_1.json');
var prescriptionRules = require('../data/prescription_rules_v2_3_1.json');

function assertRejects(promise, label, expectedCode) {
  return promise.then(
    function () { throw new Error('expected rejection but resolved: ' + label); },
    function (err) {
      assert.ok(err instanceof Error, label + ' rejects with an Error');
      if (expectedCode) assert.strictEqual(err.code, expectedCode, label + ' code should be ' + expectedCode + ' (got ' + err.code + ')');
    }
  );
}

// Seeds a minimal S1/S7 chain (player -> assessment -> review_snapshot -> prescription)
// with a realistic S7-B-shaped review_snapshot record, and returns the source IDs.
function seedSource(PBStore, overrides) {
  overrides = overrides || {};
  return PBStore.createPlayer('P').then(function (player) {
    return PBStore.createAssessment({ player_id: player.player_id, assessment_tier: 'lite', target_training_level: 4.0 });
  }).then(function (a) {
    return PBStore.createReviewSnapshot({ assessment_id: a.assessment_id, data: {} }).then(function (snap) {
      var full = Object.assign({}, snap, {
        assessment_id: a.assessment_id,
        bottleneck_state: (overrides.bottleneck_state !== undefined) ? overrides.bottleneck_state : 'DETERMINED',
        primary_bottleneck: (overrides.snapshot_primary_bottleneck !== undefined) ? overrides.snapshot_primary_bottleneck : 'hard_gate:reset_ball_quality_pct',
        failed_hard_gates: (overrides.failed_hard_gates !== undefined) ? overrides.failed_hard_gates : [
          { metric: 'reset_ball_quality_pct', threshold: 50, direction: 'min', current_value: 40 },
          { metric: 'shot_selection_pct', threshold: 65, direction: 'min', current_value: 55 }
        ]
      });
      return PBStore.put('review_snapshots', full).then(function () {
        var prescriptionBottleneck = (overrides.prescription_primary_bottleneck !== undefined) ? overrides.prescription_primary_bottleneck : full.primary_bottleneck;
        return PBStore.createPrescription({ assessment_id: a.assessment_id, data: { primary_bottleneck: prescriptionBottleneck, target_level: 4.0 } });
      }).then(function (rx) {
        return { review_snapshot_id: full.review_snapshot_id, prescription_id: rx.prescription_id };
      });
    });
  });
}

function run() {
  var chain = Promise.resolve();

  // ---- 1. Baseline plan build: 6 weeks x 3 sessions/week ----
  chain = chain.then(function () {
    var PBTrainingPlan = freshStore();
    return seedSource(PBStore).then(function (src) {
      return PBTrainingPlan.buildTrainingCyclePlan({
        source_review_snapshot_id: src.review_snapshot_id,
        source_prescription_id: src.prescription_id,
        validated_level_at_start: 3.5,
        target_level: 4.0,
        cycle_length_weeks: 6,
        sessions_per_week: 3,
        start_date: '2026-01-05'
      }).then(function (result) {
        assert.strictEqual(result.weeklyPlans.length, 6, '6 WeeklyPlans created');
        assert.strictEqual(result.sessionPlans.length, 18, '6*3=18 SessionPlans created');
        assert.strictEqual(result.trainingCycle.status, 'PLANNED');
        assert.strictEqual(result.trainingCycle.source_review_snapshot_id, src.review_snapshot_id);
        assert.strictEqual(result.trainingCycle.source_prescription_id, src.prescription_id);
        assert.strictEqual(result.trainingCycle.planned_end_date, '2026-02-16', 'planned_end_date = start_date + 6*7 days (UTC calendar-safe)');
        var weekNumbers = result.weeklyPlans.map(function (w) { return w.week_number; }).sort(function (a, b) { return a - b; });
        assert.deepStrictEqual(weekNumbers, [1, 2, 3, 4, 5, 6], 'week_number contiguous from 1, no gaps/dupes');
        var phases = result.weeklyPlans.slice().sort(function (a, b) { return a.week_number - b.week_number; }).map(function (w) { return w.phase; });
        assert.deepStrictEqual(phases, ['ACQUISITION', 'STABILIZATION', 'DECISION_INTEGRATION', 'PRESSURE_TRANSFER', 'MATCH_TRANSFER', 'RETEST'], '6-week phase map');

        // Verify records are actually persisted via the S8-A storage API (not bypassed).
        return PBStore.listWeeklyPlansByCycle(result.trainingCycle.cycle_id).then(function (weeks) {
          assert.strictEqual(weeks.length, 6);
          return PBStore.listSessionPlansByCycle(result.trainingCycle.cycle_id);
        }).then(function (sessions) {
          assert.strictEqual(sessions.length, 18);
        });
      });
    });
  });

  // ---- 2. 4-week cycle: correct phase map + session counts across valid sessions/week ----
  [2, 3, 4].forEach(function (spw) {
    chain = chain.then(function () {
      var PBTrainingPlan = freshStore();
      return seedSource(PBStore).then(function (src) {
        return PBTrainingPlan.buildTrainingCyclePlan({
          source_review_snapshot_id: src.review_snapshot_id, source_prescription_id: src.prescription_id,
          validated_level_at_start: 3.5, target_level: 4.0,
          cycle_length_weeks: 4, sessions_per_week: spw, start_date: '2026-01-05'
        }).then(function (result) {
          assert.strictEqual(result.weeklyPlans.length, 4);
          assert.strictEqual(result.sessionPlans.length, 4 * spw, '4 weeks * ' + spw + ' sessions/week');
          var phases = result.weeklyPlans.slice().sort(function (a, b) { return a.week_number - b.week_number; }).map(function (w) { return w.phase; });
          assert.deepStrictEqual(phases, ['ACQUISITION', 'DECISION_INTEGRATION', 'PRESSURE_TRANSFER', 'RETEST'], '4-week phase map');
        });
      });
    });
  });

  // ---- 3. 5-week cycle: correct phase map + record counts ----
  chain = chain.then(function () {
    var PBTrainingPlan = freshStore();
    return seedSource(PBStore).then(function (src) {
      return PBTrainingPlan.buildTrainingCyclePlan({
        source_review_snapshot_id: src.review_snapshot_id, source_prescription_id: src.prescription_id,
        validated_level_at_start: 3.5, target_level: 4.0,
        cycle_length_weeks: 5, sessions_per_week: 3, start_date: '2026-01-05'
      }).then(function (result) {
        assert.strictEqual(result.weeklyPlans.length, 5);
        assert.strictEqual(result.sessionPlans.length, 15);
        var phases = result.weeklyPlans.slice().sort(function (a, b) { return a.week_number - b.week_number; }).map(function (w) { return w.phase; });
        assert.deepStrictEqual(phases, ['ACQUISITION', 'STABILIZATION', 'DECISION_INTEGRATION', 'PRESSURE_TRANSFER', 'RETEST'], '5-week phase map');
      });
    });
  });

  // ---- 4. Input validation rejections ----
  chain = chain.then(function () {
    var PBTrainingPlan = freshStore();
    return seedSource(PBStore).then(function (src) {
      function build(overrides) {
        return PBTrainingPlan.buildTrainingCyclePlan(Object.assign({
          source_review_snapshot_id: src.review_snapshot_id, source_prescription_id: src.prescription_id,
          validated_level_at_start: 3.5, target_level: 4.0, cycle_length_weeks: 6, sessions_per_week: 3, start_date: '2026-01-05'
        }, overrides));
      }
      return assertRejects(build({ cycle_length_weeks: 3 }), '3-week cycle', 'INVALID_CYCLE_LENGTH')
        .then(function () { return assertRejects(build({ cycle_length_weeks: 7 }), '7-week cycle', 'INVALID_CYCLE_LENGTH'); })
        .then(function () { return assertRejects(build({ sessions_per_week: 1 }), '1 session/week', 'INVALID_SESSIONS_PER_WEEK'); })
        .then(function () { return assertRejects(build({ sessions_per_week: 5 }), '5 sessions/week', 'INVALID_SESSIONS_PER_WEEK'); })
        .then(function () { return assertRejects(build({ validated_level_at_start: 3.87 }), 'invalid validated level', 'INVALID_VALIDATED_LEVEL'); })
        .then(function () { return assertRejects(build({ target_level: 4.2 }), 'invalid target level', 'INVALID_TARGET_LEVEL'); })
        .then(function () { return assertRejects(build({ source_prescription_id: 'rx_does_not_exist' }), 'missing source prescription', 'MISSING_SOURCE_PRESCRIPTION'); })
        .then(function () { return assertRejects(build({ source_review_snapshot_id: 'rev_does_not_exist' }), 'missing source review snapshot', 'MISSING_SOURCE_REVIEW_SNAPSHOT'); });
    });
  });

  // ---- 5. Defaults: cycle_length_weeks/sessions_per_week default to 6/3 when omitted ----
  chain = chain.then(function () {
    var PBTrainingPlan = freshStore();
    return seedSource(PBStore).then(function (src) {
      return PBTrainingPlan.buildTrainingCyclePlan({
        source_review_snapshot_id: src.review_snapshot_id, source_prescription_id: src.prescription_id,
        validated_level_at_start: 3.5, target_level: 4.0
      }).then(function (result) {
        assert.strictEqual(result.weeklyPlans.length, 6, 'default cycle length is 6 weeks');
        assert.strictEqual(result.sessionPlans.length, 18, 'default sessions/week is 3');
      });
    });
  });

  // ---- 6. Duplicate protection ----
  chain = chain.then(function () {
    var PBTrainingPlan = freshStore();
    return seedSource(PBStore).then(function (src) {
      return PBTrainingPlan.buildTrainingCyclePlan({
        source_review_snapshot_id: src.review_snapshot_id, source_prescription_id: src.prescription_id,
        validated_level_at_start: 3.5, target_level: 4.0
      }).then(function () {
        return assertRejects(PBTrainingPlan.buildTrainingCyclePlan({
          source_review_snapshot_id: src.review_snapshot_id, source_prescription_id: src.prescription_id,
          validated_level_at_start: 3.5, target_level: 4.0
        }), 'duplicate PLANNED cycle for same prescription', 'DUPLICATE_ACTIVE_CYCLE');
      });
    });
  });

  // ---- 6b. Completed/aborted cycles do not block future planning (Section 24) ----
  chain = chain.then(function () {
    var PBTrainingPlan = freshStore();
    return seedSource(PBStore).then(function (src) {
      return PBTrainingPlan.buildTrainingCyclePlan({
        source_review_snapshot_id: src.review_snapshot_id, source_prescription_id: src.prescription_id,
        validated_level_at_start: 3.5, target_level: 4.0
      }).then(function (result) {
        return PBStore.updateTrainingCycle(result.trainingCycle.cycle_id, { status: 'COMPLETED' });
      }).then(function () {
        // A second build for the same prescription should now succeed (prior cycle is COMPLETED, not PLANNED/ACTIVE).
        return PBTrainingPlan.buildTrainingCyclePlan({
          source_review_snapshot_id: src.review_snapshot_id, source_prescription_id: src.prescription_id,
          validated_level_at_start: 3.5, target_level: 4.0
        });
      }).then(function (result2) {
        assert.ok(result2.trainingCycle.cycle_id, 'a new cycle can be built once the prior one is COMPLETED');
      });
    });
  });

  // ---- 7. Determinism: same source data + same inputs -> same logical structure (ignoring IDs/timestamps) ----
  chain = chain.then(function () {
    var PBTrainingPlan = freshStore();
    var m2t = PBTrainingPlan.buildMetricToTest(testDefs);
    var m2b = PBTrainingPlan.buildMetricToBlock(prescriptionRules);
    var ctx = {
      source_review_snapshot_id: 'rev_fixed', source_prescription_id: 'rx_fixed',
      validated_level_at_start: 3.5, target_level: 4.0,
      primary_bottleneck: 'hard_gate:reset_ball_quality_pct', bottleneck_state: 'DETERMINED',
      failed_hard_gates: [
        { metric: 'reset_ball_quality_pct', threshold: 50, direction: 'min', current_value: 40 },
        { metric: 'shot_selection_pct', threshold: 65, direction: 'min', current_value: 55 }
      ],
      cycle_length_weeks: 6, sessions_per_week: 3, start_date: '2026-01-05',
      metricToTest: m2t, metricToBlock: m2b, testDefs: testDefs
    };
    function stripVolatile(structure) {
      // Nothing in buildPlanStructure's output is ID/timestamp-bearing (that only happens at
      // persistence time), so a structural deep-equal already ignores IDs/timestamps by construction.
      return structure;
    }
    var a = stripVolatile(PBTrainingPlan.buildPlanStructure(ctx));
    var b = stripVolatile(PBTrainingPlan.buildPlanStructure(ctx));
    assert.deepStrictEqual(a, b, 'same inputs produce identical logical plan structure');
    var phaseSeqA = a.weeklyPlans.map(function (w) { return w.phase; });
    var phaseSeqB = b.weeklyPlans.map(function (w) { return w.phase; });
    assert.deepStrictEqual(phaseSeqA, phaseSeqB);
    assert.deepStrictEqual(a.sessionPlans, b.sessionPlans, 'session logical structure and drill mapping identical');
  });

  // ---- 8. Incomplete drill mapping: capability_threshold / evidence bottleneck types cannot be mapped ----
  chain = chain.then(function () {
    var PBTrainingPlan = freshStore();
    return seedSource(PBStore, { snapshot_primary_bottleneck: 'capability_threshold', prescription_primary_bottleneck: 'capability_threshold', failed_hard_gates: [] }).then(function (src) {
      return assertRejects(PBTrainingPlan.buildTrainingCyclePlan({
        source_review_snapshot_id: src.review_snapshot_id, source_prescription_id: src.prescription_id,
        validated_level_at_start: 3.5, target_level: 4.0
      }), 'capability_threshold bottleneck has no drill mapping', 'INCOMPLETE_MAPPING');
    });
  });
  chain = chain.then(function () {
    var PBTrainingPlan = freshStore();
    return seedSource(PBStore, { snapshot_primary_bottleneck: 'evidence', prescription_primary_bottleneck: 'evidence', failed_hard_gates: [] }).then(function (src) {
      return assertRejects(PBTrainingPlan.buildTrainingCyclePlan({
        source_review_snapshot_id: src.review_snapshot_id, source_prescription_id: src.prescription_id,
        validated_level_at_start: 3.5, target_level: 4.0
      }), 'evidence bottleneck has no drill mapping', 'INCOMPLETE_MAPPING');
    });
  });
  // A hard-gate metric with no entry in prescription_rules_v2_3_1.json must not fabricate a drill either.
  chain = chain.then(function () {
    var PBTrainingPlan = freshStore();
    return seedSource(PBStore, { snapshot_primary_bottleneck: 'hard_gate:totally_unmapped_metric', prescription_primary_bottleneck: 'hard_gate:totally_unmapped_metric', failed_hard_gates: [{ metric: 'totally_unmapped_metric', threshold: 1, direction: 'min', current_value: 0 }] }).then(function (src) {
      return assertRejects(PBTrainingPlan.buildTrainingCyclePlan({
        source_review_snapshot_id: src.review_snapshot_id, source_prescription_id: src.prescription_id,
        validated_level_at_start: 3.5, target_level: 4.0
      }), 'unmapped hard-gate metric', 'INCOMPLETE_MAPPING');
    });
  });
  // No plan record must be left behind after an INCOMPLETE_MAPPING rejection (atomicity — Section 22).
  chain = chain.then(function () {
    return PBStore.listTrainingCycles().then(function (all) {
      var orphaned = all.filter(function (c) { return c.primary_bottleneck === 'capability_threshold' || c.primary_bottleneck === 'evidence' || c.primary_bottleneck === 'hard_gate:totally_unmapped_metric'; });
      assert.strictEqual(orphaned.length, 0, 'no TrainingCycle persisted for a build that failed on INCOMPLETE_MAPPING');
    });
  });

  // ---- 8b. bottleneck_state not DETERMINED -> INCOMPLETE, not fabricated ----
  chain = chain.then(function () {
    var PBTrainingPlan = freshStore();
    return seedSource(PBStore, { bottleneck_state: 'INCOMPLETE', snapshot_primary_bottleneck: null, prescription_primary_bottleneck: null }).then(function (src) {
      return assertRejects(PBTrainingPlan.buildTrainingCyclePlan({
        source_review_snapshot_id: src.review_snapshot_id, source_prescription_id: src.prescription_id,
        validated_level_at_start: 3.5, target_level: 4.0
      }), 'bottleneck not DETERMINED', 'INCOMPLETE');
    });
  });

  // ---- 9. Master Control safety ----
  chain = chain.then(function () {
    var PBTrainingPlan = freshStore();
    return seedSource(PBStore).then(function (src) {
      return PBTrainingPlan.buildTrainingCyclePlan({
        source_review_snapshot_id: src.review_snapshot_id, source_prescription_id: src.prescription_id,
        validated_level_at_start: 3.5, target_level: 4.0
      }).then(function (result) {
        assert.strictEqual(result.trainingCycle.validated_training_level, undefined, 'no validated_training_level field written');
        // Structural check: the engine source must never reference validated_training_level,
        // CAP fields, Match-Transfer-into-CAP, C0, or promotion vocabulary in actual CODE
        // (compliance-negation comments documenting the invariant, as used throughout S7, are fine —
        // same convention as docs/S7-FINAL-ACCEPTANCE.md's methodology audit).
        var src2 = require('fs').readFileSync(require('path').join(__dirname, '..', 'js', 'training-plan-engine.js'), 'utf8');
        var codeOnly = src2
          .replace(/\/\*[\s\S]*?\*\//g, '') // strip /* ... */ blocks
          .replace(/\/\/.*$/gm, '');        // strip // line comments
        ['validated_training_level', 'capability_score', "'C0'", '"C0"', 'PROMOTED', 'RETEST_READY'].forEach(function (term) {
          assert.strictEqual(codeOnly.indexOf(term), -1, 'training-plan-engine.js code (outside comments) must not reference ' + term);
        });
        // Reject invalid status defense: updateTrainingCycle (S8-A) still guards this even via engine-created records.
        return assertRejects(require('../js/storage.js').updateTrainingCycle(result.trainingCycle.cycle_id, { validated_training_level: 4.0 }), 'no S8 path may write validated_training_level');
      });
    });
  });

  // ---- 10. No execution leakage: no SessionLog created; SessionPlan has no execution-only fields ----
  chain = chain.then(function () {
    var PBTrainingPlan = freshStore();
    return seedSource(PBStore).then(function (src) {
      return PBTrainingPlan.buildTrainingCyclePlan({
        source_review_snapshot_id: src.review_snapshot_id, source_prescription_id: src.prescription_id,
        validated_level_at_start: 3.5, target_level: 4.0
      }).then(function (result) {
        return PBStore.listSessionLogsByCycle(result.trainingCycle.cycle_id).then(function (logs) {
          assert.strictEqual(logs.length, 0, 'S8-B never creates SessionLog records');
          var forbidden = ['results', 'evidence_links', 'notes', 'started_at', 'completed_at'];
          result.sessionPlans.forEach(function (sp) {
            forbidden.forEach(function (f) {
              assert.ok(!Object.prototype.hasOwnProperty.call(sp, f), 'SessionPlan must not carry execution-only field: ' + f);
            });
          });
          // No CycleSummary is created by S8-B either (Section 27).
          return PBStore.getCycleSummaryByCycle(result.trainingCycle.cycle_id);
        }).then(function (summary) {
          assert.strictEqual(summary, null, 'S8-B does not create CycleSummary');
        });
      });
    });
  });

  return chain.then(function () {
    console.log('training-plan-engine.test.js: all assertions passed');
  });
}

run().catch(function (err) {
  console.error('training-plan-engine.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
