/* tests/preview.test.js — POST-S11-R3B-1: Metric Contract Repair
 * Verifies:
 *   A. T02 canonical metric resolution uses return_in_pct
 *   B. Recorded T02 evidence is not misrouted through not_captured because
 *      of the return_quality_pct/return_in_pct key mismatch
 *   C. T02 missing evidence is never labeled "Pending T10"; the label is
 *      only applied when levelCfg.source_tests genuinely declares T10
 *   D. ue_per_game_max sample completeness exposes n_valid (never
 *      "undefined/2")
 *   E. The 20 (Lite session target) vs 40 (level-3.0 gate minimum) split
 *      is unchanged
 *   F. Fail-safe behavior is unchanged: no official rating / validated
 *      level is ever produced by the preview
 * Run: node tests/preview.test.js
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
  var PBPreview = require('../js/preview.js');
  return { PBStore: global.PBStore, PBMetrics: global.PBMetrics, PBPreview: PBPreview };
}

// Minimal fetch shim: preview.js's load() only ever fetches
// data/level_gates_v2_3_1.json — serve it straight off disk so forAssessment()
// runs its real code path end-to-end (no separate mock gate table).
function installFetchShim() {
  var gatesPath = path.join(ROOT, 'data', 'level_gates_v2_3_1.json');
  global.fetch = function (url) {
    if (String(url).indexOf('level_gates_v2_3_1.json') === -1) {
      return Promise.reject(new Error('unexpected fetch: ' + url));
    }
    return Promise.resolve({
      ok: true,
      json: function () { return Promise.resolve(JSON.parse(fs.readFileSync(gatesPath, 'utf8'))); }
    });
  };
}

function run() {
  var tests = [];
  function test(name, fn) { tests.push({ name: name, fn: fn }); }

  // ---- TEST A: pure evalGate resolves return_in_pct to T02 ----
  test('TEST A: METRIC_TO_TEST maps return_in_pct -> T02 (canonical)', function () {
    var env = freshEnv();
    assert.strictEqual(env.PBPreview.METRIC_TO_TEST.return_in_pct, 'T02');
    // legacy alias used by the 3.5/4.0 gate tables must keep working (no regression)
    assert.strictEqual(env.PBPreview.METRIC_TO_TEST.return_quality_pct, 'T02');
  });

  test('TEST A: evalGate("return_in_pct", ...) resolves against T02 perTest data', function () {
    var env = freshEnv();
    var perTest = { T02: { quality_pct: 82, n_valid: 45 } };
    var row = env.PBPreview.evalGate('return_in_pct', { threshold: 80, min_trials: 40 }, perTest);
    assert.strictEqual(row.test_id, 'T02');
    assert.strictEqual(row.status, 'met');
    assert.strictEqual(row.current, 82);
    assert.strictEqual(row.n_valid, 45);
  });

  // ---- TEST B: recorded T02 evidence is not treated as not_captured ----
  test('TEST B: return_in_pct with recorded T02 evidence never yields not_captured', function () {
    var env = freshEnv();
    var perTest = { T02: { quality_pct: 30, n_valid: 40 } }; // deliberately below threshold
    var row = env.PBPreview.evalGate('return_in_pct', { threshold: 80, min_trials: 40 }, perTest);
    assert.notStrictEqual(row.status, 'not_captured');
    assert.strictEqual(row.status, 'not_met'); // evaluated on its merits, not swallowed by the key bug
  });

  test('TEST B: return_in_pct with no T02 session yields no_data, not not_captured', function () {
    var env = freshEnv();
    var row = env.PBPreview.evalGate('return_in_pct', { threshold: 80, min_trials: 40 }, {});
    assert.strictEqual(row.status, 'no_data');
    assert.notStrictEqual(row.status, 'not_captured');
  });

  // ---- TEST C: "Pending T10" only for genuinely T10-dependent gaps ----
  test('TEST C (end-to-end, level 3.0): UAT-R3-shaped assessment shows no not_captured/Pending-T10 for return', function () {
    var env = freshEnv();
    installFetchShim();
    return env.PBStore.createPlayer('UAT-R3-repro').then(function (p) {
      return env.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'lite', target_training_level: 3.0 });
    }).then(function (a) {
      return env.PBPreview.forAssessment(a.assessment_id).then(function (P) {
        var returnRow = P.rows.filter(function (r) { return r.key === 'return_in_pct'; })[0];
        assert.ok(returnRow, 'return_in_pct row must be present in level 3.0 gate table');
        assert.strictEqual(returnRow.status, 'no_data'); // no T02 session recorded in this fixture
        assert.notStrictEqual(returnRow.status, 'not_captured');
      });
    });
  });

  test('TEST C: not_captured row is tagged t10_pending only when levelCfg.source_tests declares T10', function () {
    var env = freshEnv();
    installFetchShim();
    return env.PBStore.createPlayer('T10-gate-check').then(function (p) {
      return env.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'full', target_training_level: 4.5 });
    }).then(function (a) {
      return env.PBPreview.forAssessment(a.assessment_id).then(function (P) {
        // level 4.5's hard_gates are entirely outside T01-T09 and the level declares source_tests: ["T09","T10"]
        var row = P.rows.filter(function (r) { return r.key === 'attack_conversion_pct'; })[0];
        assert.ok(row, 'attack_conversion_pct row must be present at level 4.5');
        assert.strictEqual(row.status, 'not_captured');
        assert.strictEqual(row.t10_pending, true);
      });
    });
  });

  test('TEST C: assessment.js UI copy is neutral by default, "Pending T10" only when t10_pending is set', function () {
    var src = fs.readFileSync(path.join(ROOT, 'js', 'assessment.js'), 'utf8');
    assert.ok(src.indexOf("not_captured:['Not Captured','var(--muted)']") !== -1, 'EN STAT.not_captured must be neutral by default');
    assert.ok(src.indexOf("not_captured:['未采集','var(--muted)']") !== -1, 'ZH STAT.not_captured must be neutral by default');
    assert.ok(src.indexOf('x.t10_pending') !== -1, 'renderer must branch on t10_pending before ever showing "Pending T10"');
  });

  // ---- TEST D: ue_per_game_max sample display never shows "undefined" ----
  test('TEST D (end-to-end): ue_per_game_max row exposes numeric n_valid (never undefined/2)', function () {
    var env = freshEnv();
    installFetchShim();
    return env.PBStore.createPlayer('UAT-R3-repro-2').then(function (p) {
      return env.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'lite', target_training_level: 3.0 });
    }).then(function (a) {
      return env.PBStore.updateAssessment(a.assessment_id, {
        ue: { games: 2, counts: { serve: 1, return: 2, drive: 1, drop: 1, dink: 1, reset: 0, other: 0 } },
        match_transfer: { decision: 70, transition: 80, pressure: 60, attack: 90, score: 75 }
      }).then(function () { return a.assessment_id; });
    }).then(function (assessment_id) {
      return env.PBPreview.forAssessment(assessment_id).then(function (P) {
        var row = P.rows.filter(function (r) { return r.key === 'ue_per_game_max'; })[0];
        assert.ok(row, 'ue_per_game_max row must be present');
        assert.strictEqual(row.games, 2);
        assert.strictEqual(row.min_required, 2);
        assert.strictEqual(row.n_valid, 2, 'n_valid must equal games so the generic renderer never reads undefined');
        assert.strictEqual(typeof row.n_valid, 'number');
        var rendered = 'Sample ' + row.n_valid + '/' + row.min_required;
        assert.strictEqual(rendered, 'Sample 2/2');
        assert.strictEqual(row.status, 'met'); // ue_per_game = 6/2 = 3 <= threshold 9 — verdict must be unchanged
      });
    });
  });

  // ---- TEST E: 20-vs-40 split unchanged ----
  test('TEST E: Lite T01 sample target (20) and level-3.0 gate minimum (40) both unchanged', function () {
    var testDefs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'test_definitions_v2_3_1.json'), 'utf8'));
    assert.strictEqual(testDefs.tests.T01.sample_plan.lite, 20);
    var gates = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'level_gates_v2_3_1.json'), 'utf8'));
    assert.strictEqual(gates.levels['3.0'].hard_gates.serve_in_pct.min_trials, 40);
    assert.strictEqual(gates.levels['3.0'].hard_gates.return_in_pct.min_trials, 40);
  });

  // ---- TEST F: fail-safe behavior unchanged ----
  test('TEST F (end-to-end): insufficient/complete evidence never yields an official rating or validated level', function () {
    var env = freshEnv();
    installFetchShim();
    return env.PBStore.createPlayer('UAT-R3-repro-3').then(function (p) {
      return env.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'lite', target_training_level: 3.0 });
    }).then(function (a) {
      return env.PBPreview.forAssessment(a.assessment_id).then(function (P) {
        assert.strictEqual(P.official, false);
        assert.ok(!Object.prototype.hasOwnProperty.call(P, 'validated_training_level'));
        assert.ok(!Object.prototype.hasOwnProperty.call(P, 'capability_score'));
      });
    });
  });

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
      console.log('All preview.test.js tests passed (' + tests.length + ')');
    }
  });
}

run();
