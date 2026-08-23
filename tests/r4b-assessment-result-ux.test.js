/* tests/r4b-assessment-result-ux.test.js — POST-S11-R4-B: Assessment
 * Completion / Result UX
 *
 * Same vm-harness technique as tests/r4a-assessment-ux.test.js and
 * tests/pre-s7-ui-regression.test.js (js/assessment.js has real DOM side
 * effects at load time, no pure-function surface to require()). Loads the
 * REAL script chain from the REAL index.html, seeds real data through
 * PBStore (fake-indexeddb), and asserts on rendered innerHTML plus
 * targeted structural/source checks.
 * Run: node tests/r4b-assessment-result-ux.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var ASSESSMENT_SRC = fs.readFileSync(path.join(ROOT, 'js', 'assessment.js'), 'utf8');
var APP_SRC = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
var I18N_SRC = fs.readFileSync(path.join(ROOT, 'js', 'i18n.js'), 'utf8');
var createFakeIndexedDB = require('./fake-indexeddb');

function extractScripts(html) {
  var scripts = [], re = /<script src="\.\/js\/([^"]+)"><\/script>/g, m;
  while ((m = re.exec(html))) scripts.push(m[1]);
  return scripts;
}

function makeClassList() {
  var set = new Set();
  return {
    add: function (c) { set.add(c); }, remove: function (c) { set.delete(c); },
    toggle: function (c, force) { if (force === undefined) { if (set.has(c)) set.delete(c); else set.add(c); } else if (force) set.add(c); else set.delete(c); },
    contains: function (c) { return set.has(c); }
  };
}
function FakeElement(tag, id) {
  this.tagName = (tag || 'div').toUpperCase();
  this.id = id || '';
  this._innerHTML = '';
  this.textContent = '';
  this.value = '';
  this.dataset = {};
  this.style = new Proxy({}, { get: function (t, k) { return t[k]; }, set: function (t, k, v) { t[k] = v; return true; } });
  this.classList = makeClassList();
  this._children = [];
  this._listeners = {};
}
Object.defineProperty(FakeElement.prototype, 'innerHTML', {
  get: function () { return this._innerHTML; },
  set: function (v) { this._innerHTML = v; this._children = []; }
});
Object.defineProperty(FakeElement.prototype, 'children', { get: function () { return this._children; } });
FakeElement.prototype.appendChild = function (c) { this._children.push(c); return c; };
FakeElement.prototype.removeChild = function (c) { var i = this._children.indexOf(c); if (i !== -1) this._children.splice(i, 1); return c; };
FakeElement.prototype.querySelectorAll = function () { return []; };
FakeElement.prototype.querySelector = function () { return null; };
FakeElement.prototype.addEventListener = function (type, fn) { this._listeners[type] = this._listeners[type] || []; this._listeners[type].push(fn); };
FakeElement.prototype.removeEventListener = function () {};
FakeElement.prototype.closest = function () { return null; };
FakeElement.prototype.getAttribute = function (name) { return this.dataset[name.replace('data-', '')] || null; };
FakeElement.prototype.setAttribute = function (name, v) { if (name.indexOf('data-') === 0) this.dataset[name.slice(5)] = v; };

function fetchLocalJSON(relPath) {
  var full = path.join(ROOT, relPath.replace(/^\.\//, ''));
  return Promise.resolve().then(function () {
    var txt = fs.readFileSync(full, 'utf8');
    return { ok: true, status: 200, json: function () { return Promise.resolve(JSON.parse(txt)); }, text: function () { return Promise.resolve(txt); } };
  }).catch(function () { return { ok: false, status: 404, json: function () { return Promise.reject(new Error('not found: ' + relPath)); } }; });
}

function buildHarness(lang) {
  var registry = {};
  var lsStore = { pb40_lang: lang || 'en' };
  var fakeDocument = {
    readyState: 'complete',
    documentElement: new FakeElement('html'),
    body: new FakeElement('body'),
    getElementById: function (id) { if (!registry[id]) registry[id] = new FakeElement('div', id); return registry[id]; },
    createElement: function (tag) { return new FakeElement(tag); },
    querySelectorAll: function () { return []; },
    querySelector: function () { return null; },
    addEventListener: function () {}
  };
  var sandbox = {
    console: console,
    localStorage: { getItem: function (k) { return Object.prototype.hasOwnProperty.call(lsStore, k) ? lsStore[k] : null; }, setItem: function (k, v) { lsStore[k] = String(v); }, removeItem: function (k) { delete lsStore[k]; } },
    navigator: { userAgent: 'pb-r4b-test' },
    alert: function () {}, confirm: function () { return true; },
    Blob: function (parts, opts) { this.parts = parts; this.opts = opts; },
    URL: Object.assign(function (u) { return { href: u }; }, { createObjectURL: function () { return 'blob:fake'; }, revokeObjectURL: function () {} }),
    fetch: function (url) { return fetchLocalJSON(url); },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    Promise: Promise, scrollTo: function () {}
  };
  sandbox.window = sandbox; sandbox.self = sandbox; sandbox.document = fakeDocument; sandbox.globalThis = sandbox;
  sandbox.indexedDB = createFakeIndexedDB();
  vm.createContext(sandbox);
  return { sandbox: sandbox, registry: registry };
}

function flush(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms || 60); }); }

function loadFullChain(harness) {
  extractScripts(HTML).forEach(function (name) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', name), 'utf8'), harness.sandbox, { filename: name });
  });
}

function addTrials(sandbox, session_id, outcomes) {
  return outcomes.reduce(function (chain, o, i) {
    return chain.then(function () { return sandbox.PBStore.addTrialEvent({ test_session_id: session_id, trial_no: i + 1, outcome: o, score_weight: o === 'S' ? 1 : (o === 'F' ? 0 : null) }); });
  }, Promise.resolve());
}

// Seeds ALL 9 skill tests at full sufficient evidence for target level 3.0 (40 valid S trials
// each on T01/T02, which are the only two comparable gates at level 3.0 besides ue_per_game_max),
// plus T10 match evidence, so both ASSESSMENT_COMPLETE and RESULT_READY are true.
function seedFullySufficient(sandbox, displayName) {
  return sandbox.PBStore.createPlayer(displayName || 'Full-Player').then(function (p) {
    return sandbox.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'standard', target_training_level: 3.0 }).then(function (a) {
      var PBConfig = sandbox.PBConfig;
      return PBConfig.load('./data/').then(function () {
        // Each test's own sample_target at 'standard' tier (some, e.g. T05, sum a per-distance
        // bucketed plan to a target > 40 — see js/config-loader.js's sampleTarget()).
        return PBConfig.testIds.reduce(function (chain, tid) {
          return chain.then(function () {
            var target = PBConfig.sampleTarget(tid, 'standard') || 40;
            var outcomes = new Array(target).fill('S');
            return sandbox.PBStore.createTestSession({ assessment_id: a.assessment_id, test_id: tid, assessment_tier: 'standard', feed_mode: 'machine' })
              .then(function (s) { return addTrials(sandbox, s.test_session_id, outcomes); });
          });
        }, Promise.resolve());
      }).then(function () {
        return sandbox.PBStore.updateAssessment(a.assessment_id, {
          ue: { games: 2, counts: { serve: 0, return: 0, drive: 0, drop: 0, dink: 0, reset: 0, other: 0 } },
          match_transfer: { decision: 80, transition: 80, pressure: 80, attack: 80, score: 80 }
        });
      }).then(function () { return { player: p, assessment: a }; });
    });
  });
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ================================================================
// R4B-14 — legacy "Measure · 4.0 KPI" title removed from player UI.
// ================================================================
test('R4B-14: legacy "Measure · 4.0 KPI" title removed', function () {
  assert.strictEqual(/measure\.h2['"]:\s*['"][^'"]*4\.0 KPI/.test(I18N_SRC), false, 'i18n.js must not map measure.h2 to any "...4.0 KPI" string');
  assert.ok(I18N_SRC.indexOf("'measure.h2': 'Measure · Player Assessment'") !== -1, 'en measure.h2 must read "Measure · Player Assessment"');
  assert.ok(I18N_SRC.indexOf("'measure.h2': '测 · 球员评估'") !== -1, 'zh measure.h2 must read "测 · 球员评估"');
});

// ================================================================
// R4B-05 — FOUNDATION shown as Assessment Stage, not player Level.
// ================================================================
test('R4B-05: measure.levelLabel reads "Assessment Stage", not "Level"', function () {
  assert.ok(I18N_SRC.indexOf("'measure.levelLabel': 'Assessment Stage'") !== -1, 'en levelLabel must be "Assessment Stage"');
  assert.strictEqual(/measure\.levelLabel['"]:\s*['"]Level['"]/.test(I18N_SRC), false, 'levelLabel must not be bare "Level" anywhere');
  // computeKPI()/levelOf() underlying computation/DOM write for the VALUE (e.g. "FOUNDATION") is
  // unchanged — only the preceding LABEL wording changed.
  assert.ok(APP_SRC.indexOf("document.getElementById('k-level').textContent") !== -1, 'levelOf() value write is unchanged');
});

// ================================================================
// R4B-07 — Six Hard Gates presentation preserved: same 6 gates, same
// thresholds, same allOk logic; only an additive "X of 6" count line.
// ================================================================
test('R4B-07: Six Hard Gates thresholds/count/allOk logic unchanged, count line added', function () {
  var gatesMatch = /const GATES=\[([\s\S]*?)\];/.exec(APP_SRC);
  assert.ok(gatesMatch, 'GATES array must still exist');
  var gateCount = (gatesMatch[1].match(/\{lab:/g) || []).length;
  assert.strictEqual(gateCount, 6, 'GATES must still have exactly 6 entries');
  assert.ok(APP_SRC.indexOf('min:95') !== -1 && APP_SRC.indexOf('min:75') !== -1 && APP_SRC.indexOf('min:70') !== -1 && APP_SRC.indexOf('min:65') !== -1 && APP_SRC.indexOf('min:80') !== -1, 'gate thresholds unchanged');
  assert.ok(APP_SRC.indexOf('UE_PER<=5') !== -1, 'UE gate threshold (<=5) unchanged');
  assert.ok(APP_SRC.indexOf('gates currently meet the benchmark') !== -1, 'the "X of 6 gates currently meet the benchmark" count line must be present');
  assert.strictEqual(/allOk\s*=\s*false/.test(APP_SRC), true, 'allOk logic (one failed gate fails the whole verdict) unchanged');
});

// ================================================================
// R4B-10/R4B-11/R4B-17 — structural: renderResult never computes a
// competing recommendation/next_action, never touches S9/S10 engines.
// ================================================================
test('R4B-10/R4B-11/R4B-17: assessment.js/preview.js/app.js/i18n.js never reference S9/S10 engines or a local next_action dictionary', function () {
  [ASSESSMENT_SRC, fs.readFileSync(path.join(ROOT, 'js', 'preview.js'), 'utf8'), APP_SRC, I18N_SRC].forEach(function (src) {
    var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    ['PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'PBWorkflow', 'PBPrescriptionWorkflow',
      'PBSessionEvidence', 'PBProgressTracking', 'PBReassessment', 'createTrainingCycle', 'putDevelopmentCycle',
      'validated_training_level'].forEach(function (token) {
      assert.strictEqual(stripped.indexOf(token), -1, 'must never reference ' + token);
    });
  });
  // No local NEXT_ACTION_LABELS/NEXT_ACTION_ROUTES-style dictionary in assessment.js — it must
  // read labels/routes from the existing PBHomeDashboardUI, never invent a competing one.
  assert.strictEqual(/var\s+NEXT_ACTION/.test(ASSESSMENT_SRC), false, 'assessment.js must not define a local next_action vocabulary');
  assert.ok(ASSESSMENT_SRC.indexOf('PBHomeDashboardUI.nextActionLabel') !== -1, 'next_action label must come from the existing PBHomeDashboardUI');
  assert.ok(ASSESSMENT_SRC.indexOf('PBHomeDashboardUI.routeForNextAction') !== -1, 'next_action route must come from the existing PBHomeDashboardUI');
  assert.ok(ASSESSMENT_SRC.indexOf('PBHomeDashboardAdapter.loadHomeDashboard') !== -1, 'next_action/focus must be read via the existing, accepted loadHomeDashboard');
});

// ================================================================
// R4B-18 — HOME/Journey architecture untouched by this package.
// ================================================================
test('R4B-18: HOME/Journey production files are unchanged by R4-B', function () {
  var cp = require('child_process');
  ['js/product-journey-orchestrator.js', 'js/home-dashboard-adapter.js', 'js/home-priority-dashboard-ui.js', 'js/assessment-journey-bridge.js'].forEach(function (rel) {
    var res = cp.spawnSync('git', ['diff', '--quiet', 'HEAD', '--', rel], { cwd: ROOT });
    assert.strictEqual(res.status, 0, rel + ' must have zero working-tree diff from HEAD (R4-B must not touch it)');
  });
});

// ================================================================
// R4B-12 — History/Explainability (S11-E) untouched: extending it to cover
// Assessment records would cross into a different subsystem (S9/S10
// Development Cycles) — out of R4-B's presentation-only scope.
// ================================================================
test('R4B-12: js/history-explainability-*.js untouched (no architecture expansion)', function () {
  var cp = require('child_process');
  ['js/history-explainability-adapter.js', 'js/history-explainability-ui.js'].forEach(function (rel) {
    var res = cp.spawnSync('git', ['diff', '--quiet', 'HEAD', '--', rel], { cwd: ROOT });
    assert.strictEqual(res.status, 0, rel + ' must have zero working-tree diff from HEAD');
  });
});

// ================================================================
// R4B-15/R4B-16 — DB_VERSION remains 5, stores remain 18/18.
// ================================================================
test('R4B-15/R4B-16: DB_VERSION remains 5 and stores remain 18/18', function () {
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
    EXPECTED_STORES.forEach(function (name) { assert.ok(db.objectStoreNames.contains(name), 'store ' + name + ' must exist'); });
  });
});

// ================================================================
// End-to-end: R4B-13 — incomplete/fresh assessment renders an honest
// fail-safe result (Not Started, no fabricated score, no recommendation).
// ================================================================
test('R4B-13 end-to-end: fresh assessment (no evidence) -> Not Started, no fabricated result', function () {
  var harness = buildHarness('en');
  loadFullChain(harness);
  var sandbox = harness.sandbox;
  return flush(150).then(function () {
    return sandbox.PBStore.createPlayer('Fresh Player').then(function (p) {
      return sandbox.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'lite', target_training_level: 3.0 }).then(function (a) {
        sandbox.PBAssessment._goto('result', a.assessment_id);
        return flush(200);
      });
    });
  }).then(function () {
    var html = harness.registry['a1-app'].innerHTML;
    assert.ok(html.indexOf('Not Started') !== -1, 'fresh assessment shows Not Started');
    assert.strictEqual(html.indexOf('Assessment Complete'), -1, 'fresh assessment must never show Assessment Complete');
    assert.strictEqual(html.indexOf('Provisional Assessment Score'), -1, 'no score fabricated when no comparable evidence has been recorded');
    assert.strictEqual(html.indexOf('validated_training_level'), -1, 'no validated_training_level ever surfaced');
    assert.ok(html.indexOf('Not Yet Validated') !== -1, 'Match Transfer honestly shows Not Yet Validated (R4B-09)');
    // POST-S11-R4-C superseded Section F's original ad-hoc "Recommendation not available yet."
    // text with the richer, frozen "Your Next Step" panel (Current Priority / Why This Matters /
    // Next Action) — this is that package's own authorized, in-scope redesign, not a weakening of
    // this check. The equivalent honest-fallback assertion now lives in
    // tests/r4c-assessment-action-handoff.test.js (R4C-06/R4C-08).
    assert.ok(html.indexOf('Not available yet') !== -1, 'no fabricated Current Priority for a brand-new player (R4B-10, superseded by R4-C\'s Your Next Step panel)');
  });
});

// ================================================================
// End-to-end: R4B-01/R4B-02/R4B-03/R4B-04/R4B-06/R4B-08/R4B-09 — a fully
// sufficient assessment renders Assessment Complete, Result Ready, the
// exact provisional disclaimer, player-facing skill labels, and Match
// Transfer stays independent of the T01-T09 evidence.
// ================================================================
test('R4B-01/02/03/04/06/08/09 end-to-end: fully sufficient assessment -> Complete + Result Ready + disclaimer + skill labels', function () {
  var harness = buildHarness('en');
  loadFullChain(harness);
  var sandbox = harness.sandbox;
  return flush(150).then(function () {
    return seedFullySufficient(sandbox, 'Full-Player').then(function (seed) {
      sandbox.PBAssessment._goto('result', seed.assessment.assessment_id);
      return flush(250);
    });
  }).then(function () {
    var html = harness.registry['a1-app'].innerHTML;
    // R4B-01
    assert.ok(html.indexOf('Assessment Complete') !== -1, 'R4B-01: Assessment Complete shown');
    assert.ok(html.indexOf('9 of 9 skill tests complete') !== -1, 'R4B-01: exact "9 of 9 skill tests complete" wording');
    // R4B-02
    assert.ok(html.indexOf('Provisional Assessment Score') !== -1, 'R4B-02: Result Ready shows the Provisional Assessment Score section');
    assert.strictEqual(html.indexOf('Result not ready yet'), -1, 'R4B-02: must not show "not ready" once RESULT_READY');
    // R4B-03
    assert.ok(html.indexOf('Reference only — not an official or validated player rating.') !== -1, 'R4B-03: exact disclaimer wording present');
    // R4B-04
    assert.strictEqual(html.indexOf('validated_training_level'), -1, 'R4B-04: assessment score is never presented as a validated level');
    assert.strictEqual(html.indexOf('Validated Level'), -1, 'R4B-04: no "Validated Level" claim anywhere in the rendered result');
    // R4B-06
    assert.ok(html.indexOf('Serve') !== -1 && html.indexOf('Return') !== -1, 'R4B-06: player-facing skill labels present');
    assert.ok(/Meets Target|Below Target|Near Target|Insufficient Evidence/.test(html), 'R4B-06: player-facing skill status vocabulary present');
    // R4B-08/09: T10 Match Transfer stays independent — this fixture never touched live_match feed
    // mode on T01-T09, and match_transfer_score WAS recorded, so it must NOT say Not Yet Validated.
    assert.ok(html.indexOf('Match Transfer') !== -1, 'R4B-08: Match Transfer card present');
    assert.strictEqual(html.indexOf('Not Yet Validated'), -1, 'R4B-09 (inverse): match_transfer_score was recorded, so it reads Transfer score, not Not Yet Validated');
    assert.ok(html.indexOf('Transfer score 80') !== -1, 'recorded transfer score renders');
  });
});

// ================================================================
// Regression — directly relevant accepted suites must stay green.
// ================================================================
test('regression: relevant accepted suites still pass unmodified', function () {
  var cp = require('child_process');
  var relevantSuites = ['r4a-assessment-ux.test.js', 'preview.test.js', 'pre-s7-ui-regression.test.js', 'sw-cache.test.js'];
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
    if (failed) { console.error(failed + ' test(s) failed'); process.exitCode = 1; }
    else console.log('r4b-assessment-result-ux.test.js: all assertions passed (' + tests.length + ')');
  });
}

run();
