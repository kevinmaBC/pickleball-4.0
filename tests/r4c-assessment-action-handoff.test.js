/* tests/r4c-assessment-action-handoff.test.js — POST-S11-R4-C:
 * Assessment -> Action Handoff UX
 *
 * Same vm-harness technique as tests/r4a-assessment-ux.test.js and
 * tests/r4b-assessment-result-ux.test.js. Two harness levels: a minimal
 * one (assessment.js only) for the pure renderNextStepHTML unit tests,
 * and the full real script chain for end-to-end renderResult() tests
 * against real PBStore-seeded data (including a real development_cycle
 * for the active-cycle / reassessment-ready states).
 * Run: node tests/r4c-assessment-action-handoff.test.js
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

function baseSandbox(lang) {
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
    navigator: { userAgent: 'pb-r4c-test' },
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

// Minimal harness: assessment.js only (no PBConfig/PBStore/etc.), just enough for the pure
// renderNextStepHTML export — window.PBAssessment is set unconditionally at the bottom of the
// IIFE regardless of whether init()'s module-readiness check passes.
function buildMinimalHarness(lang) {
  var h = baseSandbox(lang);
  // Normally set by js/i18n.js's Object.defineProperty(window,'LANG',...); not loaded in this
  // minimal harness, so provide the plain global assessment.js's init()/render() paths expect.
  h.sandbox.LANG = lang || 'en';
  vm.runInContext(ASSESSMENT_SRC, h.sandbox, { filename: 'assessment.js' });
  return h;
}

function buildFullHarness(lang) {
  var h = baseSandbox(lang);
  extractScripts(HTML).forEach(function (name) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', name), 'utf8'), h.sandbox, { filename: name });
  });
  return h;
}

function flush(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms || 60); }); }

var tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ================================================================
// R4C-05 — existing Priority displayed read-only.
// ================================================================
test('R4C-05: existing focus.priority_tier is displayed read-only', function () {
  var h = buildMinimalHarness('en');
  var homeDashboard = { journey: { stage: 'REVIEW_RECOMMENDATION' }, focus: { priority_tier: 'HIGH', skill: 'drop', rank: 1 }, why: null, next_action: { code: 'REVIEW_RECOMMENDATION', enabled: true, target_ref: null } };
  var html = h.sandbox.PBAssessment.renderNextStepHTML(homeDashboard, true);
  assert.ok(html.indexOf('HIGH') !== -1, 'priority_tier value rendered verbatim');
  assert.ok(html.indexOf('drop') !== -1, 'skill rendered verbatim');
});

// ================================================================
// R4C-06 — no Priority source -> neutral "Not available yet".
// ================================================================
test('R4C-06: no focus -> "Not available yet"', function () {
  var h = buildMinimalHarness('en');
  var html = h.sandbox.PBAssessment.renderNextStepHTML({ journey: {}, focus: null, why: null, next_action: { code: 'NONE', enabled: false, target_ref: null } }, true);
  assert.ok(html.indexOf('Not available yet') !== -1, 'neutral fallback shown');
});

// ================================================================
// R4C-07 — existing explanation (why) used read-only.
// ================================================================
test('R4C-07: existing why.source_skill_gap_ids is used read-only', function () {
  var h = buildMinimalHarness('en');
  var homeDashboard = { journey: {}, focus: { priority_tier: 'HIGH' }, why: { source_skill_gap_ids: ['gap_drop_1'], evidence_pattern_ids: [], evidence_refs: [] }, next_action: { code: 'NONE', enabled: false } };
  var html = h.sandbox.PBAssessment.renderNextStepHTML(homeDashboard, true);
  assert.ok(html.indexOf('gap_drop_1') !== -1, 'existing skill-gap id rendered verbatim');
});

// ================================================================
// R4C-08 — no explanation -> neutral copy, no diagnosis fabrication.
// ================================================================
test('R4C-08: no why -> neutral copy only, never a fabricated diagnosis', function () {
  var h = buildMinimalHarness('en');
  var homeDashboard = { journey: {}, focus: { priority_tier: 'HIGH' }, why: null, next_action: { code: 'NONE', enabled: false } };
  var html = h.sandbox.PBAssessment.renderNextStepHTML(homeDashboard, true);
  assert.ok(html.indexOf('More evidence or recommendation detail is required.') !== -1, 'exact neutral copy present');
});

// ================================================================
// R4C-11 — unknown/unsupported next_action -> neutral fallback, Return Home.
// ================================================================
test('R4C-11: unknown next_action -> "not available yet" + Return Home fallback', function () {
  var h = buildMinimalHarness('en');
  [null, { code: 'NONE', enabled: false }, { code: 'SOME_UNRECOGNIZED_CODE', enabled: true }].forEach(function (na) {
    var html = h.sandbox.PBAssessment.renderNextStepHTML({ journey: {}, focus: null, why: null, next_action: na }, true);
    assert.ok(html.indexOf('Your next action is not available yet.') !== -1, 'neutral fallback text for na=' + JSON.stringify(na));
    assert.ok(html.indexOf('Return Home') !== -1, 'Return Home CTA for na=' + JSON.stringify(na));
    assert.ok(html.indexOf('data-route="home"') !== -1, 'routes to home for na=' + JSON.stringify(na));
  });
});

// ================================================================
// R4C-12 — at most ONE primary CTA rendered by the panel.
// ================================================================
test('R4C-12: renderNextStepHTML never renders more than one primary (btn solid) CTA', function () {
  var h = buildMinimalHarness('en');
  [
    { journey: {}, focus: null, why: null, next_action: null },
    { journey: {}, focus: { priority_tier: 'HIGH' }, why: { source_skill_gap_ids: ['g1'], evidence_pattern_ids: [], evidence_refs: [] }, next_action: { code: 'REVIEW_RECOMMENDATION', enabled: true } },
    { journey: {}, focus: null, why: null, next_action: { code: 'CONTINUE_TRAINING', enabled: true } }
  ].forEach(function (hd) {
    var html = h.sandbox.PBAssessment.renderNextStepHTML(hd, true);
    var matches = html.match(/class="btn solid"/g) || [];
    assert.strictEqual(matches.length, 1, 'exactly one primary CTA for ' + JSON.stringify(hd));
  });
});

// ================================================================
// R4C-13/R4C-15/R4C-16 — structural fail-safe checks.
// ================================================================
test('R4C-13: no validated_training_level anywhere in assessment.js', function () {
  var stripped = ASSESSMENT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.strictEqual(stripped.indexOf('validated_training_level'), -1);
});
test('R4C-15: next_action label/route come only from the existing PBHomeDashboardUI, no local vocabulary', function () {
  var stripped = ASSESSMENT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.strictEqual(/var\s+NEXT_ACTION/.test(stripped), false, 'no local next_action dictionary');
  assert.ok(stripped.indexOf('PBHomeDashboardUI.nextActionLabel') !== -1);
  assert.ok(stripped.indexOf('PBHomeDashboardUI.routeForNextAction') !== -1);
});
test('R4C-16: assessment.js never creates/mutates a Development Cycle', function () {
  var stripped = ASSESSMENT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  ['putDevelopmentCycle', 'createTrainingCycle', 'PBWorkflow', 'PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription'].forEach(function (token) {
    assert.strictEqual(stripped.indexOf(token), -1, 'must never reference ' + token);
  });
});

// ================================================================
// R4C-14 — TRAINING / MATCH separation: the Match Transfer card (Section
// E, from R4-B) is never influenced by journey.next_action, and vice
// versa; each reads its own independent accepted source.
// ================================================================
test('R4C-14: Match Transfer section reads only match_transfer_score, never journey/next_action', function () {
  var sectionEMatch = /var sectionE = '<div><b>'\+esc\(TEST_LABEL\('T10'\)\)[\s\S]*?<\/button>';/.exec(ASSESSMENT_SRC);
  assert.ok(sectionEMatch, 'sectionE block must exist');
  assert.strictEqual(sectionEMatch[0].indexOf('homeDashboard'), -1, 'Match Transfer section must not reference homeDashboard/journey');
  assert.strictEqual(sectionEMatch[0].indexOf('next_action'), -1, 'Match Transfer section must not reference next_action');
});

// ================================================================
// R4C-17/R4C-18 — DB_VERSION remains 5, stores remain 18/18.
// ================================================================
test('R4C-17/18: DB_VERSION remains 5 and stores remain 18/18', function () {
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
// R4C-01/R4C-02 end-to-end — incomplete assessment: Your Next Step shows
// Continue Assessment as the (only) primary CTA, no training
// recommendation is fabricated (focus stays null, as the accepted
// pipeline honestly has none yet).
// ================================================================
test('R4C-01/02 end-to-end: incomplete assessment -> Continue Assessment only, no fabricated recommendation', function () {
  var h = buildFullHarness('en');
  var sandbox = h.sandbox;
  return flush(150).then(function () {
    return sandbox.PBStore.createPlayer('R4C-Incomplete').then(function (p) {
      return sandbox.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'lite', target_training_level: 3.0 }).then(function (a) {
        sandbox.PBAssessment._goto('result', a.assessment_id);
        return flush(250);
      });
    });
  }).then(function () {
    var html = h.registry['a1-app'].innerHTML;
    assert.ok(html.indexOf('Continue Assessment') !== -1, 'R4C-01: Continue Assessment CTA present');
    var matches = html.match(/class="btn solid"/g) || [];
    assert.strictEqual(matches.length, 1, 'R4C-12: exactly one primary CTA on the whole result page');
    assert.strictEqual(html.indexOf('Provisional Assessment Score'), -1, 'R4C-02: no score fabricated');
    assert.ok(html.indexOf('Not available yet') !== -1, 'R4C-02: Current Priority honestly Not available yet (no S9 recommendation pipeline wired)');
    // R4C-04: no match evidence recorded -> Match Transfer stays Not Yet Validated.
    assert.ok(html.indexOf('Not Yet Validated') !== -1, 'R4C-04: Match Transfer Not Yet Validated with no accepted match evidence');
  });
});

// ================================================================
// R4C-09 end-to-end — active Development Cycle (TRAINING_ACTIVE) -> Your
// Next Step CTA is Continue Training, read from the real accepted Journey.
// ================================================================
test('R4C-09 end-to-end: active Development Cycle -> Continue Training', function () {
  var h = buildFullHarness('en');
  var sandbox = h.sandbox;
  return flush(150).then(function () {
    return sandbox.PBStore.createPlayer('R4C-Active').then(function (p) {
      return sandbox.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'lite', target_training_level: 3.0 }).then(function (a) {
        return sandbox.PBStore.putDevelopmentCycle({ cycle_id: 'r4c_cyc_1', player_id: p.player_id, state: 'TRAINING_ACTIVE', recommendation_refs: ['rec_1'], prescription_refs: ['rx_1'], created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .then(function () {
            sandbox.PBAssessment._goto('result', a.assessment_id);
            return flush(250);
          });
      });
    });
  }).then(function () {
    var html = h.registry['a1-app'].innerHTML;
    assert.ok(html.indexOf('Continue Training') !== -1, 'CTA reads Continue Training (from the real Journey projection)');
    var matches = html.match(/class="btn solid"/g) || [];
    assert.strictEqual(matches.length, 1, 'exactly one primary CTA');
  });
});

// ================================================================
// R4C-03/R4C-10 end-to-end — REASSESSMENT_READY cycle -> Your Next Step
// CTA is the real accepted RECORD_REAL_MATCH label ("Record Real Match"),
// never the locally-invented "Start Reassessment" wording.
// ================================================================
test('R4C-03/10 end-to-end: REASSESSMENT_READY cycle -> real accepted RECORD_REAL_MATCH label/route', function () {
  var h = buildFullHarness('en');
  var sandbox = h.sandbox;
  return flush(150).then(function () {
    return sandbox.PBStore.createPlayer('R4C-Reassess').then(function (p) {
      return sandbox.PBStore.createAssessment({ player_id: p.player_id, assessment_tier: 'lite', target_training_level: 3.0 }).then(function (a) {
        return sandbox.PBStore.putDevelopmentCycle({ cycle_id: 'r4c_cyc_2', player_id: p.player_id, state: 'REASSESSMENT_READY', recommendation_refs: ['rec_1'], prescription_refs: ['rx_1'], created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .then(function () {
            sandbox.PBAssessment._goto('result', a.assessment_id);
            return flush(250);
          });
      });
    });
  }).then(function () {
    var html = h.registry['a1-app'].innerHTML;
    assert.ok(html.indexOf('Record Real Match') !== -1, 'real accepted label used verbatim');
    assert.strictEqual(html.indexOf('Start Reassessment'), -1, 'must not invent "Start Reassessment" wording not present in the accepted vocabulary');
    assert.ok(html.indexOf('data-route="measure"') !== -1, 'routes via the real accepted RECORD_REAL_MATCH route');
  });
});

// ================================================================
// Regression — directly relevant accepted suites must stay green.
// ================================================================
test('regression: relevant accepted suites still pass unmodified', function () {
  var cp = require('child_process');
  var relevantSuites = ['r4b-assessment-result-ux.test.js', 'r4a-assessment-ux.test.js', 'preview.test.js', 'pre-s7-ui-regression.test.js'];
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
    else console.log('r4c-assessment-action-handoff.test.js: all assertions passed (' + tests.length + ')');
  });
}

run();
