/* tests/r3b3-home-integration.test.js — POST-S11-R3B-3: HOME Journey
 * Integration + RC-UAT Closure
 *
 * Exercises the full wired pipeline: js/assessment-journey-bridge.js ->
 * js/product-journey-orchestrator.js -> js/home-dashboard-adapter.js ->
 * js/home-priority-dashboard-ui.js, proving the J0-J4 state contract,
 * CTA correctness, player isolation, fail-safe boundaries, and R3B-1
 * regression protection.
 * Run: node tests/r3b3-home-integration.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var createFakeIndexedDB = require('./fake-indexeddb');

var ROOT = path.join(__dirname, '..');

function freshEnv() {
  global.indexedDB = createFakeIndexedDB();
  delete require.cache[require.resolve('../js/storage.js')];
  global.PBStore = require('../js/storage.js');
  delete require.cache[require.resolve('../js/metrics.js')];
  global.PBMetrics = require('../js/metrics.js');
  delete require.cache[require.resolve('../js/preview.js')];
  global.PBPreview = require('../js/preview.js');
  delete require.cache[require.resolve('../js/assessment-journey-bridge.js')];
  global.PBAssessmentJourneyBridge = require('../js/assessment-journey-bridge.js');
  delete require.cache[require.resolve('../js/product-journey-orchestrator.js')];
  global.PBProductJourney = require('../js/product-journey-orchestrator.js');
  delete require.cache[require.resolve('../js/dashboard-integration-engine.js')];
  global.PBDashboard = require('../js/dashboard-integration-engine.js');
  delete require.cache[require.resolve('../js/home-dashboard-adapter.js')];
  global.PBHomeDashboardAdapter = require('../js/home-dashboard-adapter.js');
  delete require.cache[require.resolve('../js/home-priority-dashboard-ui.js')];
  var UI = require('../js/home-priority-dashboard-ui.js');
  return {
    PBStore: global.PBStore, PBMetrics: global.PBMetrics, PBPreview: global.PBPreview,
    PBAssessmentJourneyBridge: global.PBAssessmentJourneyBridge, PBProductJourney: global.PBProductJourney,
    PBDashboard: global.PBDashboard, PBHomeDashboardAdapter: global.PBHomeDashboardAdapter,
    UI: UI
  };
}

function installFetchShim() {
  var gatesPath = path.join(ROOT, 'data', 'level_gates_v2_3_1.json');
  global.fetch = function (url) {
    if (String(url).indexOf('level_gates_v2_3_1.json') === -1) return Promise.reject(new Error('unexpected fetch: ' + url));
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve(JSON.parse(fs.readFileSync(gatesPath, 'utf8'))); } });
  };
}

function addTrials(session_id, outcomes) {
  return outcomes.reduce(function (chain, o, i) {
    return chain.then(function () {
      return global.PBStore.addTrialEvent({ test_session_id: session_id, trial_no: i + 1, outcome: o, score_weight: o === 'S' ? 1 : (o === 'F' ? 0 : null) });
    });
  }, Promise.resolve());
}

// Seeds the exact UAT-R3 fixture: T01 partial (S,S,S,F,I), T02 not recorded, T10 present.
function seedUatR3(displayName) {
  return global.PBStore.createPlayer(displayName || 'UAT-R3').then(function (p) {
    return global.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'lite', target_training_level: 3.0 }).then(function (a) {
      return global.PBStore.createTestSession({ assessment_id: a.assessment_id, test_id: 'T01', assessment_tier: 'lite', feed_mode: 'calibrated_human' })
        .then(function (s) { return addTrials(s.test_session_id, ['S', 'S', 'S', 'F', 'I']); })
        .then(function () {
          return global.PBStore.updateAssessment(a.assessment_id, {
            ue: { games: 2, counts: { serve: 1, return: 2, drive: 1, drop: 1, dink: 1, reset: 0, other: 0 } },
            match_transfer: { decision: 70, transition: 80, pressure: 60, attack: 90, score: 75 }
          });
        }).then(function () { return { player: p, assessment: a }; });
    });
  });
}

// Seeds an assessment at level 3.0 with FULL sufficient evidence on both T01 and T02
// (40 valid S trials each), so PBPreview reports SUFFICIENT (recommendation_eligible=true).
function seedSufficientEvidence(displayName) {
  return global.PBStore.createPlayer(displayName || 'Sufficient-Player').then(function (p) {
    return global.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'standard', target_training_level: 3.0 }).then(function (a) {
      var outcomes40 = new Array(40).fill('S');
      return global.PBStore.createTestSession({ assessment_id: a.assessment_id, test_id: 'T01', assessment_tier: 'standard', feed_mode: 'machine' })
        .then(function (s) { return addTrials(s.test_session_id, outcomes40); })
        .then(function () { return global.PBStore.createTestSession({ assessment_id: a.assessment_id, test_id: 'T02', assessment_tier: 'standard', feed_mode: 'machine' }); })
        .then(function (s2) { return addTrials(s2.test_session_id, outcomes40); })
        .then(function () {
          return global.PBStore.updateAssessment(a.assessment_id, { ue: { games: 2, counts: { serve: 0, return: 0, drive: 0, drop: 0, dink: 0, reset: 0, other: 0 } } });
        }).then(function () { return { player: p, assessment: a }; });
    });
  });
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ================================================================
// R3B3-T01 — No assessment -> Assessment Needed / Start Assessment
// ================================================================
test('R3B3-T01: no assessment -> J0 Assessment Needed', function () {
  var env = freshEnv();
  installFetchShim();
  return env.PBStore.createPlayer('NoAssessmentPlayer').then(function (p) {
    return env.PBHomeDashboardAdapter.loadHomeDashboard(p.player_id).then(function (r) {
      var h = r.home_dashboard;
      assert.strictEqual(h.journey.stage, 'NEEDS_ASSESSMENT', 'T01 stage');
      assert.strictEqual(h.next_action.code, 'START_ASSESSMENT', 'T01 CTA');
      var html = env.UI.renderHomePanelHTML(h, true);
      assert.ok(html.indexOf('Assessment Needed') !== -1, 'T01 rendered "Assessment Needed"');
      assert.ok(html.indexOf('data-code="START_ASSESSMENT"') !== -1, 'T01 rendered Start Assessment CTA');
    });
  });
});

// ================================================================
// R3B3-T02/T03/T04 — UAT-R3 (partial evidence) -> J1 Assessment In Progress,
// never NO_ASSESSMENT, recommendation unavailable.
// ================================================================
test('R3B3-T02/T03/T04: UAT-R3 partial evidence -> J1 Assessment In Progress, never NO_ASSESSMENT, no recommendation', function () {
  var env = freshEnv();
  installFetchShim();
  return seedUatR3('UAT-R3').then(function (seed) {
    return env.PBHomeDashboardAdapter.loadHomeDashboard(seed.player.player_id).then(function (r) {
      var h = r.home_dashboard;
      assert.strictEqual(h.journey.stage, 'ASSESSMENT_IN_PROGRESS', 'T02 stage is Assessment In Progress');
      assert.notStrictEqual(h.journey.stage, 'NEEDS_ASSESSMENT', 'T03 partial assessment never collapses to NO_ASSESSMENT');
      assert.strictEqual(h.assessment.assessment_status, 'ASSESSMENT_IN_PROGRESS');
      assert.notStrictEqual(h.assessment.assessment_status, 'NO_ASSESSMENT');
      assert.strictEqual(h.assessment.assessment_exists, true);
      assert.strictEqual(h.assessment.traceability_available, true, 'T02 traceability available (T01+T10 evidence)');
      assert.strictEqual(h.assessment.recommendation_eligible, false, 'T04 recommendation unavailable');
      assert.strictEqual(h.next_action.code, 'CONTINUE_ASSESSMENT', 'T02 CTA is Continue Assessment');
      assert.strictEqual(h.focus, null, 'T04 no fabricated recommendation focus');
      var html = env.UI.renderHomePanelHTML(h, true);
      assert.ok(html.indexOf('Assessment In Progress') !== -1, 'T02 rendered "Assessment In Progress"');
      assert.strictEqual(html.indexOf('Assessment Needed'), -1, 'T03 UI never renders "Assessment Needed" for a partial assessment');
      assert.strictEqual(html.indexOf('No traceability data yet'), -1, 'must not report no-traceability (R3B-2 §8, re-verified here)');
      assert.ok(html.indexOf('data-code="CONTINUE_ASSESSMENT"') !== -1, 'T02 rendered Continue Assessment CTA');
    });
  });
});

// ================================================================
// R3B3-T05 — sufficient evidence + no Recommendation -> J2 Assessment Ready,
// explicitly NOT Recommendation Ready.
// ================================================================
test('R3B3-T05: sufficient evidence, no cycle -> J2 Assessment Ready, not Recommendation Ready', function () {
  var env = freshEnv();
  installFetchShim();
  return seedSufficientEvidence('Sufficient-Player').then(function (seed) {
    return env.PBHomeDashboardAdapter.loadHomeDashboard(seed.player.player_id).then(function (r) {
      var h = r.home_dashboard;
      assert.strictEqual(h.assessment.evidence_status, 'SUFFICIENT', 'evidence sufficient');
      assert.strictEqual(h.assessment.recommendation_eligible, true, 'recommendation eligible (structural, not a recommendation)');
      assert.strictEqual(h.journey.stage, 'ASSESSMENT_READY', 'T05 stage is Assessment Ready');
      assert.notStrictEqual(h.journey.stage, 'REVIEW_RECOMMENDATION', 'T05 must NOT be Recommendation Ready — no accepted Recommendation exists');
      assert.strictEqual(h.next_action.code, 'REVIEW_ASSESSMENT', 'T05 CTA is Review Assessment');
      assert.strictEqual(h.focus, null, 'T05 still no fabricated recommendation');
      var html = env.UI.renderHomePanelHTML(h, true);
      assert.ok(html.indexOf('Assessment Ready') !== -1, 'T05 rendered "Assessment Ready"');
      assert.ok(html.indexOf('data-code="REVIEW_ASSESSMENT"') !== -1, 'T05 rendered Review Assessment CTA');
    });
  });
});

// ================================================================
// R3B3-T06 — accepted Recommendation exists (real development_cycle,
// RECOMMENDATION_READY) -> J3 Training Recommendation Ready (existing
// REVIEW_RECOMMENDATION vocabulary — reused per package instructions).
// ================================================================
test('R3B3-T06: accepted Recommendation (cycle RECOMMENDATION_READY) -> J3 Recommendation Ready', function () {
  var env = freshEnv();
  var cycle = { cycle_id: 'cyc_1', player_id: 'p1', state: 'RECOMMENDATION_READY', recommendation_refs: ['rec_1'], prescription_refs: [] };
  var out = env.PBProductJourney.projectJourney({ player: { player_id: 'p1' }, development_cycle: cycle });
  assert.strictEqual(out.journey.stage, 'REVIEW_RECOMMENDATION', 'T06 stage is the existing Recommendation-Ready vocabulary');
  assert.strictEqual(out.journey.next_action.code, 'REVIEW_RECOMMENDATION');
});

// ================================================================
// R3B3-T07 — Development Cycle exists / training active -> J4 Active
// Training (existing TRAINING_IN_PROGRESS vocabulary — reused).
// ================================================================
test('R3B3-T07: Development Cycle TRAINING_ACTIVE -> J4 Active Training', function () {
  var env = freshEnv();
  var cycle = { cycle_id: 'cyc_1', player_id: 'p1', state: 'TRAINING_ACTIVE', recommendation_refs: ['rec_1'], prescription_refs: ['rx_1'] };
  var out = env.PBProductJourney.projectJourney({ player: { player_id: 'p1' }, development_cycle: cycle });
  assert.strictEqual(out.journey.stage, 'TRAINING_IN_PROGRESS', 'T07 stage is the existing Active-Training vocabulary');
  assert.strictEqual(out.journey.next_action.code, 'CONTINUE_TRAINING');
});

// ================================================================
// R3B3-T08 — CTA follows Journey state across all five J-states.
// ================================================================
test('R3B3-T08: CTA follows Journey state for J0-J4', function () {
  var env = freshEnv();
  var cases = [
    { input: { player: { player_id: 'p1' } }, expectedCode: 'START_ASSESSMENT', expectedRoute: 'measure' },
    { input: { player: { player_id: 'p1' }, assessment_context: { assessment_exists: true, assessment_status: 'ASSESSMENT_IN_PROGRESS', recommendation_eligible: false, assessment_id: 'asm_1' } }, expectedCode: 'CONTINUE_ASSESSMENT', expectedRoute: 'measure' },
    { input: { player: { player_id: 'p1' }, assessment_context: { assessment_exists: true, assessment_status: 'ASSESSMENT_EVIDENCE_READY', recommendation_eligible: true, assessment_id: 'asm_1' } }, expectedCode: 'REVIEW_ASSESSMENT', expectedRoute: 'measure' },
    { input: { player: { player_id: 'p1' }, development_cycle: { cycle_id: 'c1', player_id: 'p1', state: 'RECOMMENDATION_READY', recommendation_refs: ['rec_1'], prescription_refs: [] } }, expectedCode: 'REVIEW_RECOMMENDATION', expectedRoute: 'review' },
    { input: { player: { player_id: 'p1' }, development_cycle: { cycle_id: 'c1', player_id: 'p1', state: 'TRAINING_ACTIVE', recommendation_refs: ['rec_1'], prescription_refs: ['rx_1'] } }, expectedCode: 'CONTINUE_TRAINING', expectedRoute: 'guided' }
  ];
  cases.forEach(function (c, i) {
    var out = env.PBProductJourney.projectJourney(c.input);
    assert.strictEqual(out.journey.next_action.code, c.expectedCode, 'J' + i + ' CTA code');
    assert.strictEqual(env.UI.routeForNextAction(out.journey.next_action.code), c.expectedRoute, 'J' + i + ' route');
  });
});

// ================================================================
// R3B3-T09 — player_id isolation: Player A's assessment/evidence must never
// appear in Player B's HOME, and vice versa.
// ================================================================
test('R3B3-T09: player_id isolation between Player A and Player B', function () {
  var env = freshEnv();
  installFetchShim();
  return Promise.all([seedUatR3('Player A'), seedSufficientEvidence('Player B')]).then(function (seeds) {
    var a = seeds[0], b = seeds[1];
    return Promise.all([
      env.PBHomeDashboardAdapter.loadHomeDashboard(a.player.player_id),
      env.PBHomeDashboardAdapter.loadHomeDashboard(b.player.player_id)
    ]).then(function (results) {
      var homeA = results[0].home_dashboard, homeB = results[1].home_dashboard;
      assert.strictEqual(homeA.assessment.assessment_id, a.assessment.assessment_id, 'A sees only A\'s assessment');
      assert.notStrictEqual(homeA.assessment.assessment_id, b.assessment.assessment_id, 'A never sees B\'s assessment_id');
      assert.strictEqual(homeB.assessment.assessment_id, b.assessment.assessment_id, 'B sees only B\'s assessment');
      assert.notStrictEqual(homeB.assessment.assessment_id, a.assessment.assessment_id, 'B never sees A\'s assessment_id');
      assert.strictEqual(homeA.journey.stage, 'ASSESSMENT_IN_PROGRESS', 'A (partial evidence) is J1');
      assert.strictEqual(homeB.journey.stage, 'ASSESSMENT_READY', 'B (sufficient evidence) is J2 — states not cross-contaminated');
    });
  });
});

// ================================================================
// R3B3-T10 — no mock/fabricated recommendation across J0-J2 (dashboard.items
// stays [] per the frozen R3B-1/S11-B boundary; focus/training always null).
// ================================================================
test('R3B3-T10: no mock/fabricated recommendation for J0/J1/J2', function () {
  var env = freshEnv();
  installFetchShim();
  return Promise.all([
    env.PBStore.createPlayer('J0').then(function (p) { return env.PBHomeDashboardAdapter.loadHomeDashboard(p.player_id); }),
    seedUatR3('J1').then(function (s) { return env.PBHomeDashboardAdapter.loadHomeDashboard(s.player.player_id); }),
    seedSufficientEvidence('J2').then(function (s) { return env.PBHomeDashboardAdapter.loadHomeDashboard(s.player.player_id); })
  ]).then(function (results) {
    results.forEach(function (r, i) {
      assert.strictEqual(r.home_dashboard.focus, null, 'case ' + i + ': focus never fabricated');
      assert.strictEqual(r.home_dashboard.training, null, 'case ' + i + ': training never fabricated');
    });
  });
});

// ================================================================
// R3B3-T11 — no official rating / validated_training_level write anywhere
// in the modified surface.
// ================================================================
test('R3B3-T11: no official rating / validated_training_level in modified files', function () {
  ['js/product-journey-orchestrator.js', 'js/home-dashboard-adapter.js', 'js/home-priority-dashboard-ui.js', 'js/assessment-journey-bridge.js'].forEach(function (rel) {
    var src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.strictEqual(stripped.indexOf('validated_training_level'), -1, rel + ' must never reference validated_training_level');
  });
  var env = freshEnv();
  var out = env.PBProductJourney.projectJourney({ player: { player_id: 'p1' }, assessment_context: { assessment_exists: true, assessment_status: 'ASSESSMENT_EVIDENCE_READY', recommendation_eligible: true } });
  ['official', 'rating', 'validated_training_level', 'capability_score'].forEach(function (k) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(out.journey, k), false, 'journey must never contain ' + k);
  });
});

// ================================================================
// R3B3-T12 — R3B-1 regressions remain fixed: return_in_pct canonical
// mapping, no "Pending T10" mislabel, no "Sample undefined/2", 20-vs-40.
// ================================================================
test('R3B3-T12: R3B-1 regressions remain fixed', function () {
  var env = freshEnv();
  installFetchShim();
  assert.strictEqual(env.PBPreview.METRIC_TO_TEST.return_in_pct, 'T02', 'return_in_pct canonical key intact');
  return seedUatR3('R3B1-check').then(function (seed) {
    return env.PBPreview.forAssessment(seed.assessment.assessment_id).then(function (P) {
      var returnRow = P.rows.filter(function (r) { return r.key === 'return_in_pct'; })[0];
      assert.strictEqual(returnRow.status, 'no_data', 'return_in_pct still evaluates via no_data, not not_captured');
      var ueRow = P.rows.filter(function (r) { return r.key === 'ue_per_game_max'; })[0];
      assert.strictEqual(ueRow.n_valid, 2, 'ue_per_game_max n_valid is numeric (never undefined)');
      var rendered = 'Sample ' + ueRow.n_valid + '/' + ueRow.min_required;
      assert.strictEqual(rendered, 'Sample 2/2');
    });
  }).then(function () {
    var testDefs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'test_definitions_v2_3_1.json'), 'utf8'));
    assert.strictEqual(testDefs.tests.T01.sample_plan.lite, 20, '20 (Lite session target) unchanged');
    var gates = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'level_gates_v2_3_1.json'), 'utf8'));
    assert.strictEqual(gates.levels['3.0'].hard_gates.serve_in_pct.min_trials, 40, '40 (level 3.0 readiness minimum) unchanged');
  });
});

// ================================================================
// Regression — directly relevant accepted suites must stay green.
// ================================================================
test('regression: relevant accepted suites still pass unmodified', function () {
  var cp = require('child_process');
  var relevantSuites = [
    'assessment-journey-bridge.test.js', 'product-journey-orchestrator.test.js',
    'home-dashboard-adapter.test.js', 'home-priority-dashboard-ui.test.js',
    'preview.test.js', 'storage.test.js'
  ];
  relevantSuites.forEach(function (suite) {
    var res = cp.spawnSync(process.execPath, [path.join(__dirname, suite)], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, 'accepted suite ' + suite + ' must still pass unmodified:\n' + res.stdout + res.stderr);
  });
});

function run() {
  var failed = 0;
  return tests.reduce(function (chain, t) {
    return chain.then(function () {
      return Promise.resolve().then(t.fn).then(function () {
        console.log('  ok - ' + t.name);
      }, function (err) {
        failed++;
        console.error('  FAIL - ' + t.name);
        console.error('    ' + (err && err.stack ? err.stack : err));
      });
    });
  }, Promise.resolve()).then(function () {
    if (failed) {
      console.error(failed + ' test(s) failed');
      process.exitCode = 1;
    } else {
      console.log('r3b3-home-integration.test.js: all assertions passed (' + tests.length + ')');
    }
  });
}

run();
