/* tests/assessment-journey-bridge.test.js — POST-S11-R3B-2: Assessment ->
 * Journey Integration Bridge
 * Run: node tests/assessment-journey-bridge.test.js
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
  var Bridge = require('../js/assessment-journey-bridge.js');
  return { PBStore: global.PBStore, PBPreview: global.PBPreview, Bridge: Bridge };
}

function installFetchShim() {
  var gatesPath = path.join(ROOT, 'data', 'level_gates_v2_3_1.json');
  global.fetch = function (url) {
    if (String(url).indexOf('level_gates_v2_3_1.json') === -1) return Promise.reject(new Error('unexpected fetch: ' + url));
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve(JSON.parse(fs.readFileSync(gatesPath, 'utf8'))); } });
  };
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ================================================================
// B2-01 — player_id is canonical identity: selection is strictly scoped by
// assessment.player_id (via the existing by_player index) — never by
// display_name, even when two players share a similar-looking name.
// ================================================================
test('B2-01: assessment selection scoped by player_id, never display_name', function () {
  var env = freshEnv();
  return Promise.all([
    env.PBStore.createPlayer('UAT-R3'),
    env.PBStore.createPlayer('UAT-R3') // deliberately identical display_name, distinct player
  ]).then(function (players) {
    return Promise.all([
      env.PBStore.createAssessment({ player_id: players[0].player_id, assessment_tier: 'lite', target_training_level: 3.0 }),
      env.PBStore.createAssessment({ player_id: players[1].player_id, assessment_tier: 'lite', target_training_level: 3.5 })
    ]).then(function (assessments) {
      return env.Bridge.loadAssessmentContext(players[0].player_id).then(function (ctx) {
        assert.strictEqual(ctx.assessment_id, assessments[0].assessment_id, 'resolves the assessment belonging to player 0 via player_id, not display_name');
        assert.notStrictEqual(ctx.assessment_id, assessments[1].assessment_id);
      });
    });
  });
});

// ================================================================
// B2-02 — latest valid assessment selection is deterministic: created_at
// descending, assessment_id tie-break, never store-iteration order.
// ================================================================
test('B2-02: pickLatestAssessment is deterministic (created_at desc, assessment_id tie-break)', function () {
  var env = freshEnv();
  var a = { assessment_id: 'asm_b', player_id: 'p1', created_at: '2026-01-01T00:00:00.000Z' };
  var b = { assessment_id: 'asm_a', player_id: 'p1', created_at: '2026-02-01T00:00:00.000Z' };
  var c = { assessment_id: 'asm_z', player_id: 'p1', created_at: '2026-02-01T00:00:00.000Z' }; // tie with b
  assert.strictEqual(env.Bridge.pickLatestAssessment([a, b]).assessment_id, 'asm_a', 'later created_at wins');
  assert.strictEqual(env.Bridge.pickLatestAssessment([b, c]).assessment_id, 'asm_z', 'tie on created_at -> higher assessment_id wins, deterministically');
  // Order-independence: shuffled input yields the same winner.
  assert.strictEqual(env.Bridge.pickLatestAssessment([c, a, b]).assessment_id, 'asm_z');
  assert.strictEqual(env.Bridge.pickLatestAssessment([]), null);
});

// ================================================================
// B2-03 — a partial/incomplete assessment must never be reported as
// NO_ASSESSMENT (that code is reserved for "zero assessment records").
// ================================================================
test('B2-03: partial evidence assessment != NO_ASSESSMENT', function () {
  var env = freshEnv();
  var ctx = env.Bridge.composeAssessmentContext({
    player_id: 'p1',
    assessment: { assessment_id: 'asm_1', assessment_tier: 'lite', target_training_level: 3.0 },
    evidence_refs: [{ type: 'test_session', test_id: 'T01', test_session_id: 'ses_1', trial_count: 4 }],
    preview: { tally: { total: 3, met: 1, not_met: 1, no_data: 1, sample_short: 1, not_captured: 0 } }
  });
  assert.notStrictEqual(ctx.assessment_status, 'NO_ASSESSMENT');
  assert.strictEqual(ctx.assessment_status, 'ASSESSMENT_IN_PROGRESS');
  assert.strictEqual(ctx.assessment_exists, true);

  var noAsm = env.Bridge.composeAssessmentContext({ player_id: 'p1', assessment: null });
  assert.strictEqual(noAsm.assessment_status, 'NO_ASSESSMENT');
  assert.strictEqual(noAsm.assessment_exists, false);
});

// ================================================================
// B2-04 — T01 (and any T01-T09) test session evidence is traceable via a
// pointer (test_session_id/test_id), not a copy of trial_events.
// ================================================================
test('B2-04: T01 evidence traceable via evidence_refs pointer', function () {
  var env = freshEnv();
  var assessment = { assessment_id: 'asm_1' };
  var sessions = [{ test_session_id: 'ses_1', test_id: 'T01', feed_mode: 'calibrated_human' }];
  var refs = env.Bridge.buildEvidenceRefs(assessment, sessions, { ses_1: 4 });
  var t01 = refs.filter(function (r) { return r.type === 'test_session' && r.test_id === 'T01'; })[0];
  assert.ok(t01, 'T01 test_session ref present');
  assert.strictEqual(t01.test_session_id, 'ses_1');
  assert.strictEqual(t01.trial_count, 4);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(t01, 'raw_json'), false, 'ref is a pointer, never a copy of trial_events');
});

// ================================================================
// B2-05 — T10 (match/UE) evidence is traceable when present on the
// assessment record's ue/match_transfer fields.
// ================================================================
test('B2-05: T10 match evidence traceable via evidence_refs pointer', function () {
  var env = freshEnv();
  var withMatch = { assessment_id: 'asm_1', ue: { games: 2, counts: { serve: 1 } } };
  var refsWith = env.Bridge.buildEvidenceRefs(withMatch, [], {});
  assert.ok(refsWith.some(function (r) { return r.type === 'match_evidence'; }), 'match_evidence ref present when ue is recorded');

  var withoutMatch = { assessment_id: 'asm_2' };
  var refsWithout = env.Bridge.buildEvidenceRefs(withoutMatch, [], {});
  assert.ok(!refsWithout.some(function (r) { return r.type === 'match_evidence'; }), 'no match_evidence ref when nothing recorded');
});

// ================================================================
// B2-06 — existing Readiness (PBPreview) is consumed verbatim, never
// recalculated: classifyEvidence only reads previewResult.tally fields,
// and the bridge source never reimplements gate comparison.
// ================================================================
test('B2-06: classifyEvidence reads PBPreview tally verbatim (no recalculation)', function () {
  var env = freshEnv();
  var sufficient = env.Bridge.classifyEvidence({ tally: { total: 2, met: 2, not_met: 0, no_data: 0, sample_short: 0, not_captured: 0 } });
  assert.strictEqual(sufficient.evidence_status, 'SUFFICIENT');
  var partial = env.Bridge.classifyEvidence({ tally: { total: 3, met: 1, not_met: 1, no_data: 1, sample_short: 1, not_captured: 0 } });
  assert.strictEqual(partial.evidence_status, 'PARTIAL');
  var none = env.Bridge.classifyEvidence({ tally: { total: 2, no_data: 2, not_captured: 0 } });
  assert.strictEqual(none.evidence_status, 'NONE');
  var unsupported = env.Bridge.classifyEvidence({ unsupported: true });
  assert.strictEqual(unsupported.readiness_data_status, 'NOT_AVAILABLE');
});
test('B2-06: bridge source never reimplements gate/threshold comparison', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js', 'assessment-journey-bridge.js'), 'utf8');
  var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ['threshold', 'statusMM', 'BORDER', 'level_gates', 'quality_pct ='].forEach(function (token) {
    assert.strictEqual(stripped.indexOf(token), -1, 'bridge must never reference ' + token + ' (that is PBPreview/PBMetrics-only territory)');
  });
});

// ================================================================
// B2-07 — no official rating is ever generated by the bridge.
// ================================================================
test('B2-07: composeAssessmentContext never produces an official rating field', function () {
  var env = freshEnv();
  var ctx = env.Bridge.composeAssessmentContext({
    player_id: 'p1', assessment: { assessment_id: 'asm_1' },
    preview: { tally: { total: 1, met: 1, no_data: 0, sample_short: 0, not_captured: 0 } }
  });
  ['official', 'rating', 'capability_score', 'validated_level'].forEach(function (k) {
    assert.strictEqual(Object.prototype.hasOwnProperty.call(ctx, k), false, 'must never contain ' + k);
  });
});

// ================================================================
// B2-08 — no validated_training_level is ever written; the bridge never
// writes to PBStore at all.
// ================================================================
test('B2-08: bridge never writes validated_training_level or persists anything', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js', 'assessment-journey-bridge.js'), 'utf8');
  var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.strictEqual(stripped.indexOf('validated_training_level'), -1, 'must never reference validated_training_level');
  var writeTokens = ['PBStore.put', 'PBStore.createPlayer', 'PBStore.createAssessment', 'PBStore.createTestSession', 'PBStore.addTrialEvent', 'PBStore.updateAssessment', 'PBStore.del(', 'PBStore.deleteAssessment', 'PBStore.deleteSession'];
  writeTokens.forEach(function (token) {
    assert.strictEqual(stripped.indexOf(token), -1, 'must never write to PBStore: ' + token);
  });
});

// ================================================================
// B2-09 — insufficient evidence must yield recommendation_eligible = false;
// only fully sufficient evidence yields true.
// ================================================================
test('B2-09: insufficient evidence -> recommendation_eligible false; sufficient -> true', function () {
  var env = freshEnv();
  var partial = env.Bridge.composeAssessmentContext({
    player_id: 'p1', assessment: { assessment_id: 'asm_1' },
    evidence_refs: [{ type: 'test_session', test_id: 'T01' }],
    preview: { tally: { total: 2, met: 1, not_met: 0, no_data: 1, sample_short: 0, not_captured: 0 } }
  });
  assert.strictEqual(partial.recommendation_eligible, false);

  var sufficient = env.Bridge.composeAssessmentContext({
    player_id: 'p1', assessment: { assessment_id: 'asm_1' },
    evidence_refs: [{ type: 'test_session', test_id: 'T01' }],
    preview: { tally: { total: 2, met: 2, not_met: 0, no_data: 0, sample_short: 0, not_captured: 0 } }
  });
  assert.strictEqual(sufficient.recommendation_eligible, true);
  assert.strictEqual(sufficient.assessment_status, 'ASSESSMENT_EVIDENCE_READY');
});

// ================================================================
// B2-10 — no Development Cycle is ever auto-created by the bridge.
// ================================================================
test('B2-10: bridge never creates a Development Cycle', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js', 'assessment-journey-bridge.js'), 'utf8');
  var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ['createTrainingCycle', 'putDevelopmentCycle', 'development_cycle', 'PBWorkflow', 'PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription'].forEach(function (token) {
    assert.strictEqual(stripped.indexOf(token), -1, 'bridge must never reference ' + token);
  });
});

// ================================================================
// B2-11 — Journey distinguishes "no assessment" from "assessment in
// progress" via assessment_context.
//
// POST-S11-R3B-3 superseded this test's original expectation: under R3B-2,
// assessment_context was purely inert passthrough, so journey.stage itself
// stayed NEEDS_ASSESSMENT in both cases. R3B-3's own acceptance gates
// (package §15 G2/G3: "assessment exists -> never shown as no assessment",
// "partial evidence -> Assessment In Progress") require journey.stage
// itself to distinguish J0 from J1 — see the !cycle branch of deriveStage
// in js/product-journey-orchestrator.js. This is the intentional, in-scope
// behavior change that package authorized, not a weakening of this test.
// ================================================================
test('B2-11: journey.assessment_context (and, since R3B-3, journey.stage) distinguishes NO_ASSESSMENT from ASSESSMENT_IN_PROGRESS', function () {
  delete require.cache[require.resolve('../js/product-journey-orchestrator.js')];
  var PJ = require('../js/product-journey-orchestrator.js');

  var noAsm = PJ.projectJourney({ player: { player_id: 'p1' }, assessment_context: { assessment_status: 'NO_ASSESSMENT', assessment_exists: false } });
  var partial = PJ.projectJourney({ player: { player_id: 'p1' }, assessment_context: { assessment_status: 'ASSESSMENT_IN_PROGRESS', assessment_exists: true, recommendation_eligible: false, traceability_available: true } });

  assert.strictEqual(noAsm.journey.stage, 'NEEDS_ASSESSMENT');
  assert.strictEqual(partial.journey.stage, 'ASSESSMENT_IN_PROGRESS'); // POST-S11-R3B-3: no longer collapsed into NEEDS_ASSESSMENT
  assert.notStrictEqual(partial.journey.stage, noAsm.journey.stage, 'stage itself now distinguishes J0 from J1');
  assert.strictEqual(noAsm.journey.assessment_context.assessment_status, 'NO_ASSESSMENT');
  assert.strictEqual(partial.journey.assessment_context.assessment_status, 'ASSESSMENT_IN_PROGRESS');
  assert.notStrictEqual(noAsm.journey.assessment_context.assessment_exists, partial.journey.assessment_context.assessment_exists);
});

// ================================================================
// B2-12 — HOME consumes a prepared projection only: the bridge itself has
// no rendering/DOM footprint (that stays in js/home-priority-dashboard-
// ui.js, which only ever calls PBHomeDashboardAdapter — see
// tests/home-priority-dashboard-ui.test.js's own architecture check).
// ================================================================
test('B2-12: bridge has no rendering/DOM footprint', function () {
  var src = fs.readFileSync(path.join(ROOT, 'js', 'assessment-journey-bridge.js'), 'utf8');
  var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ['innerHTML', 'document.', 'render(', 'addEventListener'].forEach(function (token) {
    assert.strictEqual(stripped.indexOf(token), -1, 'bridge must never touch the DOM: ' + token);
  });
});

// ================================================================
// B2-13 — DB_VERSION remains 5, stores remain 18/18 (the bridge adds no
// schema, no new store, no new index).
// ================================================================
test('B2-13: DB_VERSION remains 5 and stores remain 18/18', function () {
  delete require.cache[require.resolve('../js/storage.js')];
  var Store = require('../js/storage.js');
  assert.strictEqual(Store.DB_VERSION, 5);
  var EXPECTED_STORES = [
    'players', 'assessments', 'test_sessions', 'trial_events',
    'review_snapshots', 'prescriptions', 'retests',
    'training_cycles', 'weekly_plans', 'session_plans', 'session_logs', 'cycle_summaries',
    'development_cycles', 'prescription_workflows', 'session_results', 'training_evidence',
    'cycle_kpi_baselines', 'reassessments'
  ];
  assert.strictEqual(EXPECTED_STORES.length, 18);
  global.indexedDB = createFakeIndexedDB();
  delete require.cache[require.resolve('../js/storage.js')];
  var StoreFresh = require('../js/storage.js');
  return StoreFresh.open().then(function (db) {
    EXPECTED_STORES.forEach(function (name) {
      assert.ok(db.objectStoreNames.contains(name), 'store ' + name + ' must exist');
    });
    assert.strictEqual(db.objectStoreNames.length !== undefined ? Array.from(db.objectStoreNames).length : EXPECTED_STORES.length, 18, 'exactly 18 stores');
  });
});

// ================================================================
// UAT-R3 end-to-end reproduction (POST-S11-R3B-2 §8 acceptance scenario):
// T01 partial (4 valid trials, sample_short at level 3.0's 40 min), T02
// not recorded, T10 evidence present -> traceability_available=true,
// assessment_exists=true, evidence incomplete, recommendation_eligible=false.
// ================================================================
test('UAT-R3 end-to-end: assessment_exists=true, traceability_available=true, recommendation_eligible=false', function () {
  var env = freshEnv();
  installFetchShim();
  return env.PBStore.createPlayer('UAT-R3').then(function (p) {
    return env.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'lite', target_training_level: 3.0 }).then(function (a) {
      return env.PBStore.createTestSession({ assessment_id: a.assessment_id, test_id: 'T01', assessment_tier: 'lite', feed_mode: 'calibrated_human' }).then(function (s) {
        var outcomes = ['S', 'S', 'S', 'F', 'I'];
        return outcomes.reduce(function (chain, o, i) {
          return chain.then(function () {
            return env.PBStore.addTrialEvent({ test_session_id: s.test_session_id, trial_no: i + 1, outcome: o, score_weight: o === 'S' ? 1 : (o === 'F' ? 0 : null) });
          });
        }, Promise.resolve());
      }).then(function () {
        return env.PBStore.updateAssessment(a.assessment_id, {
          ue: { games: 2, counts: { serve: 1, return: 2, drive: 1, drop: 1, dink: 1, reset: 0, other: 0 } },
          match_transfer: { decision: 70, transition: 80, pressure: 60, attack: 90, score: 75 }
        });
      }).then(function () {
        return env.Bridge.loadAssessmentContext(p.player_id);
      }).then(function (ctx) {
        assert.strictEqual(ctx.assessment_exists, true, 'UAT-R3: assessment_exists');
        assert.strictEqual(ctx.assessment_status, 'ASSESSMENT_IN_PROGRESS', 'UAT-R3: evidence incomplete, not NO_ASSESSMENT and not EVIDENCE_READY');
        assert.strictEqual(ctx.evidence_status, 'PARTIAL', 'UAT-R3: evidence status PARTIAL');
        assert.strictEqual(ctx.traceability_available, true, 'UAT-R3: traceability_available (T01 + T10 evidence present)');
        assert.strictEqual(ctx.recommendation_eligible, false, 'UAT-R3: recommendation NOT eligible (must not generate a recommendation)');
        assert.ok(ctx.evidence_refs.some(function (r) { return r.type === 'test_session' && r.test_id === 'T01'; }), 'UAT-R3: T01 evidence traceable');
        assert.ok(ctx.evidence_refs.some(function (r) { return r.type === 'match_evidence'; }), 'UAT-R3: T10 evidence traceable');
      });
    });
  });
});

// ================================================================
// Wiring — script chain / service worker (mirrors the established
// tests/s10-b-r1-dashboard-wiring.test.js pattern): the bridge loads
// before the orchestrator that consumes it, and is precached offline.
// ================================================================
test('wiring: index.html loads the bridge before the orchestrator/adapter; sw.js precaches it', function () {
  var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  var sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  var scripts = [], re = /<script src="\.\/js\/([^"]+)"><\/script>/g, m;
  while ((m = re.exec(html))) scripts.push(m[1]);
  var order = ['assessment-journey-bridge.js', 'product-journey-orchestrator.js', 'home-dashboard-adapter.js'];
  var idx = order.map(function (n) { return scripts.indexOf(n); });
  idx.forEach(function (i, k) {
    assert.ok(i !== -1, order[k] + ' must be present in the script chain');
    if (k > 0) assert.ok(idx[k - 1] < i, order[k - 1] + ' must load before ' + order[k]);
  });
  assert.ok(sw.indexOf("'./js/assessment-journey-bridge.js'") !== -1, 'sw.js CORE must precache the bridge for offline use');
});

// ================================================================
// Determinism — same input twice -> identical composed Assessment Context
// ================================================================
test('determinism: identical input yields identical Assessment Context', function () {
  var env = freshEnv();
  var opts = { player_id: 'p1', assessment: { assessment_id: 'asm_1', assessment_tier: 'lite', target_training_level: 3.0 }, evidence_refs: [{ type: 'test_session', test_id: 'T01' }], preview: { tally: { total: 1, met: 1, no_data: 0, sample_short: 0, not_captured: 0 } } };
  var out1 = env.Bridge.composeAssessmentContext(opts);
  var out2 = env.Bridge.composeAssessmentContext(opts);
  assert.strictEqual(JSON.stringify(out1), JSON.stringify(out2));
});

// ================================================================
// Structurally invalid input -> explicit error
// ================================================================
test('invalid input: missing player_id throws INVALID_INPUT', function () {
  var env = freshEnv();
  var threw = null;
  try { env.Bridge.composeAssessmentContext({ assessment: null }); } catch (e) { threw = e; }
  assert.ok(threw instanceof Error);
  assert.strictEqual(threw.code, 'INVALID_INPUT');
});

// ================================================================
// Regression — directly relevant accepted suites must stay green.
// ================================================================
test('regression: relevant accepted suites still pass unmodified', function () {
  var cp = require('child_process');
  var relevantSuites = ['product-journey-orchestrator.test.js', 'home-dashboard-adapter.test.js', 'home-priority-dashboard-ui.test.js', 'preview.test.js', 'storage.test.js'];
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
      console.log('assessment-journey-bridge.test.js: all assertions passed (' + tests.length + ')');
    }
  });
}

run();
