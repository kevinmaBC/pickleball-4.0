/* tests/r4a-assessment-ux.test.js — POST-S11-R4-A: Assessment UX
 * Productization
 *
 * js/assessment.js is a bare top-level script with real DOM side effects
 * (no pure-function surface to require() — see tests/pre-s7-ui-regression
 * .test.js's own docstring for this repo's established rationale). This
 * suite uses the same technique: load the REAL script chain from the REAL
 * index.html into a minimal hand-rolled fake browser (vm module), seed
 * real data through PBStore (fake-indexeddb), and assert on rendered
 * innerHTML. The new pure label/progress helpers (js/assessment.js's
 * window.PBAssessment.TEST_LABEL etc., added for exactly this purpose)
 * are also exercised directly for fast, precise coverage.
 * Run: node tests/r4a-assessment-ux.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var ASSESSMENT_SRC = fs.readFileSync(path.join(ROOT, 'js', 'assessment.js'), 'utf8');
var createFakeIndexedDB = require('./fake-indexeddb');

function extractScripts(html) {
  var scripts = [], re = /<script src="\.\/js\/([^"]+)"><\/script>/g, m;
  while ((m = re.exec(html))) scripts.push(m[1]);
  return scripts;
}

// ---- minimal fake DOM (same spirit/subset as tests/pre-s7-ui-regression.test.js) ----
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
  // js/i18n.js reads LANG from localStorage['pb40_lang'] at load time and exposes window.LANG as
  // a read-only getter (no setter) — the only way to force English is to pre-seed that key.
  var lsStore = { pb40_lang: lang || 'en' };
  var sandbox = {
    console: console,
    localStorage: { getItem: function (k) { return Object.prototype.hasOwnProperty.call(lsStore, k) ? lsStore[k] : null; }, setItem: function (k, v) { lsStore[k] = String(v); }, removeItem: function (k) { delete lsStore[k]; } },
    navigator: { userAgent: 'pb-r4a-test' },
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
  var scripts = extractScripts(HTML);
  scripts.forEach(function (name) {
    var code = fs.readFileSync(path.join(ROOT, 'js', name), 'utf8');
    vm.runInContext(code, harness.sandbox, { filename: name });
  });
}

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ================================================================
// R4A-T01 — internal T01-T10 IDs preserved (never renamed in the data model).
// ================================================================
test('R4A-T01: internal T01-T10 IDs preserved in the source and PBConfig.testIds', function () {
  ['T01','T02','T03','T04','T05','T06','T07','T08','T09','T10'].forEach(function (tid) {
    assert.ok(ASSESSMENT_SRC.indexOf("'" + tid + ":") !== -1 || ASSESSMENT_SRC.indexOf(tid + ':') !== -1 || ASSESSMENT_SRC.indexOf(tid) !== -1, tid + ' must still appear in assessment.js');
  });
  var testDefs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'test_definitions_v2_3_1.json'), 'utf8'));
  assert.deepStrictEqual(Object.keys(testDefs.tests), ['T01','T02','T03','T04','T05','T06','T07','T08','T09','T10'], 'internal test IDs unchanged in data/test_definitions_v2_3_1.json');
});

// ================================================================
// R4A-T02 — player-facing labels map correctly (pure helper, direct call).
// ================================================================
test('R4A-T02: TEST_LABEL maps T01-T10 to the preferred player-facing names', function () {
  var harness = buildHarness('en');
  loadFullChain(harness);
  var A = harness.sandbox.PBAssessment;
  var expected = {
    T01: 'Serve', T02: 'Return', T03: 'Drive', T04: 'Third-Shot Drop', T05: 'Transition Reset',
    T06: 'Dink', T07: 'Volley & Counter', T08: 'Shot Decision', T09: 'Pressure & Transition', T10: 'Match Transfer'
  };
  Object.keys(expected).forEach(function (tid) {
    assert.strictEqual(A.TEST_LABEL(tid), expected[tid], tid + ' label');
  });
});

// ================================================================
// R4A-T03/T05 — partial T01 evidence displays In Progress, never Complete.
// ================================================================
test('R4A-T03/T05: TEST_PROGRESS classifies partial evidence as in_progress, never complete/not_started', function () {
  var harness = buildHarness('en');
  loadFullChain(harness);
  var A = harness.sandbox.PBAssessment;
  var session = { test_session_id: 'ses_1', test_id: 'T01' };
  var partialMetric = { n_valid: 4, n_total: 5, sample_target: 20, sample_complete: false };
  var completeMetric = { n_valid: 20, n_total: 20, sample_target: 20, sample_complete: true };

  assert.strictEqual(A.TEST_PROGRESS(null, null), 'not_started');
  assert.strictEqual(A.TEST_PROGRESS(session, partialMetric), 'in_progress');
  assert.notStrictEqual(A.TEST_PROGRESS(session, partialMetric), 'complete', 'partial evidence must never be displayed as Complete');
  assert.notStrictEqual(A.TEST_PROGRESS(session, partialMetric), 'not_started', 'partial evidence must never collapse to Not Started');
  assert.strictEqual(A.TEST_PROGRESS(session, completeMetric), 'complete');

  assert.strictEqual(A.PROGRESS_LABEL('not_started'), 'Not Started');
  assert.strictEqual(A.PROGRESS_LABEL('in_progress'), 'In Progress');
  assert.strictEqual(A.PROGRESS_LABEL('complete'), 'Complete · Evidence Ready');
});

// ================================================================
// R4A-T04 — 6/20 renders as player-facing observation progress (source-level
// wording check on the exact template used in renderDetail's per-test row).
// ================================================================
test('R4A-T04: 6/20-style sampling renders as "X of Y observations recorded"', function () {
  var stripped = ASSESSMENT_SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/m\.n_valid\s*\+\s*' of '\s*\+\s*m\.sample_target\s*\+\s*' observations recorded'/.test(stripped), 'renderDetail must build the "X of Y observations recorded" player-facing string from the existing n_valid/sample_target fields');
});

// ================================================================
// R4A-T06/T07 — T10 is presented as Match Transfer, with an honest
// "Not Yet Validated" state when match_transfer_score is absent.
// ================================================================
test('R4A-T06/T07: T10 renders as Match Transfer, incomplete state is "Not Yet Validated"', function () {
  var harness = buildHarness('en');
  loadFullChain(harness);
  var A = harness.sandbox.PBAssessment;
  assert.strictEqual(A.TEST_LABEL('T10'), 'Match Transfer');
  assert.ok(ASSESSMENT_SRC.indexOf("LANG==='en'?'Not Yet Validated'") !== -1, 'renderDetail must show "Not Yet Validated" when match_transfer_score is absent');
  assert.ok(ASSESSMENT_SRC.indexOf('Record Match Evidence') !== -1, 'the Match Transfer CTA must read "Record Match Evidence"');
});

// ================================================================
// R4A-T08 — Live Match feed mode does not imply Match Transfer validation.
// ================================================================
test('R4A-T08: Live Match feed-mode note explicitly distinguishes it from Match Transfer validation', function () {
  var stripped = ASSESSMENT_SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/live_match[\s\S]{0,400}not the same as Match Transfer validation/.test(stripped), 'the live_match feed-mode note must explicitly say it is not Match Transfer validation');
});

// ================================================================
// R4A-T09 — provisional score is clearly non-official when incomplete.
// ================================================================
test('R4A-T09: the composite/provisional score display carries a non-official disclaimer', function () {
  var compositeBlock = /<div class="composite">[\s\S]*?<\/div>\s*<\/div>/.exec(HTML);
  assert.ok(compositeBlock, 'the .composite score block must still exist in index.html');
  assert.ok(/Provisional — not a validated level/.test(compositeBlock[0]), 'the composite score block must carry a "Provisional — not a validated level" disclaimer');
  // Regression: the underlying computeKPI() formula/DOM write is untouched (same literal value
  // tests/pre-s7-ui-regression.test.js already locks in for a clean STATE).
  assert.ok(fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8').indexOf("document.getElementById('k-score').innerHTML=score+'<small>/100</small>'") !== -1, 'computeKPI() DOM write is unchanged');
});

// ================================================================
// R4A-T10/T11 — no validated_training_level write, no Recommendation/Prescription
// side effect anywhere in the modified UX files.
// ================================================================
test('R4A-T10/T11: no official rating / validated level / recommendation / prescription side effects', function () {
  ['js/assessment.js', 'js/preview.js'].forEach(function (rel) {
    var src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    var stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.strictEqual(stripped.indexOf('validated_training_level'), -1, rel + ' must never write validated_training_level');
    ['PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'PBWorkflow', 'createTrainingCycle', 'putDevelopmentCycle'].forEach(function (token) {
      assert.strictEqual(stripped.indexOf(token), -1, rel + ' must never reference ' + token);
    });
  });
});

// ================================================================
// R4A-T12 — DB_VERSION 5 / 18 stores unchanged (R4-A adds no schema).
// ================================================================
test('R4A-T12: DB_VERSION remains 5 and stores remain 18/18', function () {
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
// End-to-end: real detail screen render with seeded UAT-R3-shaped partial
// evidence — proves the new UX renders correctly against real PBStore/
// PBMetrics data, not just string templates.
// ================================================================
test('end-to-end: detail screen renders progress summary, player-facing labels, and In Progress badge for partial T01 evidence', function () {
  var harness = buildHarness('en');
  loadFullChain(harness);
  var sandbox = harness.sandbox;
  return flush(150).then(function () {
    return sandbox.PBStore.createPlayer('UAT-R3').then(function (p) {
      return sandbox.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'lite', target_training_level: 3.0 }).then(function (a) {
        return sandbox.PBStore.createTestSession({ assessment_id: a.assessment_id, test_id: 'T01', assessment_tier: 'lite', feed_mode: 'calibrated_human' }).then(function (s) {
          var outcomes = ['S', 'S', 'S', 'F', 'I'];
          return outcomes.reduce(function (chain, o, i) {
            return chain.then(function () { return sandbox.PBStore.addTrialEvent({ test_session_id: s.test_session_id, trial_no: i + 1, outcome: o, score_weight: o === 'S' ? 1 : (o === 'F' ? 0 : null) }); });
          }, Promise.resolve());
        }).then(function () {
          sandbox.PBAssessment._goto('detail', a.assessment_id);
          return flush(150);
        }).then(function () {
          var html = harness.registry['a1-app'].innerHTML;
          assert.ok(html.indexOf('1 of 9 skill tests started') !== -1, 'progress summary present: "1 of 9 skill tests started"');
          assert.ok(html.indexOf('Serve') !== -1, 'player-facing "Serve" label present for T01');
          assert.ok(html.indexOf('T01') !== -1, 'internal T01 ID still visible (secondary), never removed');
          assert.ok(html.indexOf('In Progress') !== -1, 'T01 shows In Progress');
          assert.strictEqual(html.indexOf('Complete · Evidence Ready'), -1, 'T01 (4/20, partial) must never show Complete');
          assert.ok(html.indexOf('4 of 20 observations recorded') !== -1, '6/20-style progress rendered as observation wording (here 4/20)');
          assert.ok(html.indexOf('Match Transfer') !== -1, 'Match Transfer section present');
          assert.ok(html.indexOf('Not Yet Validated') !== -1, 'Match Transfer shows Not Yet Validated (no UE/transfer recorded yet)');
          assert.strictEqual(html.indexOf('validated_training_level'), -1, 'no validated_training_level ever surfaced in the rendered HTML');
        });
      });
    });
  });
});

// ================================================================
// Regression — directly relevant accepted suites must stay green.
// ================================================================
test('regression: relevant accepted suites still pass unmodified', function () {
  var cp = require('child_process');
  var relevantSuites = ['preview.test.js', 'pre-s7-ui-regression.test.js', 's9-a-match-architecture.test.js', 's9-entry-audit.test.js'];
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
    else console.log('r4a-assessment-ux.test.js: all assertions passed (' + tests.length + ')');
  });
}

run();
