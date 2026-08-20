/* tests/pre-s7-ui-regression.test.js — S8-F / TD-REG-01 closure
 *
 * Dedicated automated regression coverage for the pre-S7 UI (Home, Learn,
 * Drill, Measure, Compete, Team, and the S1 Assessment Data Core widget),
 * and proof that the full S1->S8-E script chain still loads and
 * initializes together without breaking those accepted surfaces.
 *
 * This repo has no npm/jsdom (no package.json, no node_modules) and every
 * existing test runs via plain `node tests/x.test.js`. app.js/assessment.js
 * are bare top-level scripts with real DOM side effects at load time, so
 * there is no pure-function surface to `require()` the way the engine
 * files expose one. Instead this harness applies the exact same technique
 * tests/sw-cache.test.js already uses for sw.js: read the REAL script
 * source from disk and execute it via Node's `vm` module inside a
 * minimal, hand-rolled fake browser (document/window/localStorage/fetch),
 * built from the REAL index.html rather than a hand-maintained copy —
 * so a future change to index.html's script list, tab structure, or
 * element ids is reflected automatically instead of silently going stale.
 *
 * Run: node tests/pre-s7-ui-regression.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var createFakeIndexedDB = require('./fake-indexeddb');

// ---- parse the real index.html (source of truth, not hand-duplicated) ----
function extractIds(html) {
  var ids = [], re = /\bid="([^"]+)"/g, m;
  while ((m = re.exec(html))) ids.push(m[1]);
  return ids;
}
function extractScripts(html) {
  var scripts = [], re = /<script src="\.\/js\/([^"]+)"><\/script>/g, m;
  while ((m = re.exec(html))) scripts.push(m[1]);
  return scripts;
}
function extractViewSections(html) {
  var out = [], re = /<section class="view( active)?" id="(v-[^"]+)">/g, m;
  while ((m = re.exec(html))) out.push({ id: m[2], activeInitially: !!m[1] });
  return out;
}
function extractNavButtons(html) {
  var block = /<nav class="tabs">([\s\S]*?)<\/nav>/.exec(html)[1];
  var out = [], re = /<button([^>]*)data-t="([^"]+)"([^>]*)>/g, m;
  while ((m = re.exec(block))) out.push({ t: m[2], initiallyOn: /class="on"/.test(m[1] + m[3]) });
  return out;
}

// ---- minimal fake DOM (purpose-built, same spirit as fake-indexeddb.js — not a general library) ----
function makeClassList() {
  var set = new Set();
  return {
    add: function (c) { set.add(c); },
    remove: function (c) { set.delete(c); },
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
  this.checked = false;
  this.dataset = {};
  this.style = new Proxy({}, { get: function (t, k) { return t[k]; }, set: function (t, k, v) { t[k] = v; return true; } });
  this.classList = makeClassList();
  this._children = [];
  this._listeners = {};
  this.open = false;
}
Object.defineProperty(FakeElement.prototype, 'innerHTML', {
  get: function () { return this._innerHTML; },
  set: function (v) { this._innerHTML = v; this._children = []; }
});
Object.defineProperty(FakeElement.prototype, 'children', { get: function () { return this._children; } });
FakeElement.prototype.appendChild = function (child) { this._children.push(child); return child; };
FakeElement.prototype.removeChild = function (child) { var i = this._children.indexOf(child); if (i !== -1) this._children.splice(i, 1); return child; };
FakeElement.prototype.querySelectorAll = function () { return []; };
FakeElement.prototype.querySelector = function () { return null; };
FakeElement.prototype.addEventListener = function (type, fn) { this._listeners[type] = this._listeners[type] || []; this._listeners[type].push(fn); };
FakeElement.prototype.removeEventListener = function () {};
FakeElement.prototype.click = function () { (this._listeners.click || []).forEach(function (fn) { fn({ target: this, currentTarget: this }); }.bind(this)); };
FakeElement.prototype.closest = function () { return null; };
FakeElement.prototype.getAttribute = function (name) { return this.dataset[name.replace('data-', '')] || null; };
FakeElement.prototype.setAttribute = function (name, v) { if (name.indexOf('data-') === 0) this.dataset[name.slice(5)] = v; };

// Serves the app's own real data/*.json files (used by PBConfig.load during assessment.js init),
// so the S1 widget mounts against genuine config data rather than a stubbed shortcut.
function fetchLocalJSON(relPath) {
  var full = path.join(ROOT, relPath.replace(/^\.\//, ''));
  return Promise.resolve().then(function () {
    var txt = fs.readFileSync(full, 'utf8');
    return { ok: true, status: 200, json: function () { return Promise.resolve(JSON.parse(txt)); }, text: function () { return Promise.resolve(txt); } };
  }).catch(function () {
    return { ok: false, status: 404, json: function () { return Promise.reject(new Error('not found: ' + relPath)); } };
  });
}

function buildHarness() {
  var registry = {};
  extractIds(HTML).forEach(function (id) { registry[id] = new FakeElement('div', id); });

  var viewSections = extractViewSections(HTML).map(function (v) {
    var el = registry[v.id];
    el.classList.add('view');
    if (v.activeInitially) el.classList.add('active');
    return el;
  });
  var navButtons = extractNavButtons(HTML).map(function (b) {
    var el = new FakeElement('button');
    el.dataset.t = b.t;
    if (b.initiallyOn) el.classList.add('on');
    return el;
  });

  var lsStore = {};
  var fakeLocalStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(lsStore, k) ? lsStore[k] : null; },
    setItem: function (k, v) { lsStore[k] = String(v); },
    removeItem: function (k) { delete lsStore[k]; }
  };

  var fakeDocument = {
    readyState: 'complete',
    documentElement: new FakeElement('html'),
    body: new FakeElement('body'),
    getElementById: function (id) { if (!registry[id]) registry[id] = new FakeElement('div', id); return registry[id]; },
    createElement: function (tag) { return new FakeElement(tag); },
    querySelectorAll: function (sel) {
      if (sel === '.view') return viewSections;
      if (sel === 'nav.tabs button') return navButtons;
      return [];
    },
    querySelector: function (sel) { var all = fakeDocument.querySelectorAll(sel); return all.length ? all[0] : null; },
    addEventListener: function () {}
  };

  var sandbox = {
    console: console,
    localStorage: fakeLocalStorage,
    navigator: { userAgent: 'pb-regression-test' },
    alert: function () {},
    confirm: function () { return false; },
    Blob: function (parts, opts) { this.parts = parts; this.opts = opts; },
    URL: Object.assign(function (u) { return { href: u }; }, { createObjectURL: function () { return 'blob:fake'; }, revokeObjectURL: function () {} }),
    fetch: function (url) { return fetchLocalJSON(url); },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    Promise: Promise,
    scrollTo: function () {}
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.document = fakeDocument;
  sandbox.globalThis = sandbox;
  sandbox.indexedDB = createFakeIndexedDB();

  vm.createContext(sandbox);
  return { sandbox: sandbox, registry: registry, viewSections: viewSections, navButtons: navButtons };
}

function flush(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms || 50); }); }

function run() {
  var harness = buildHarness();
  var scripts = extractScripts(HTML);

  // ---- 1. The entire real script chain (S1 through S8-E, in the real index.html order)
  // loads and executes without throwing. This is the core proof that S7/S8 integration
  // has not broken the pre-S7 UI's load path -- if any script referenced a missing global,
  // a stale filename, or collided with another module, this throws immediately. ----
  var loadErrors = [];
  scripts.forEach(function (name) {
    var full = path.join(ROOT, 'js', name);
    assert.ok(fs.existsSync(full), 'index.html references js/' + name + ' but the file does not exist (stale script reference)');
    var code = fs.readFileSync(full, 'utf8');
    try {
      vm.runInContext(code, harness.sandbox, { filename: name });
    } catch (e) {
      loadErrors.push(name + ': ' + e.message);
    }
  });
  assert.deepStrictEqual(loadErrors, [], 'every script referenced by index.html must load without throwing: ' + loadErrors.join(' | '));
  assert.ok(scripts.length >= 15, 'sanity: the real script list should contain all expected pre-S7/S7/S8 modules');

  // ---- 2. Expected globals from every accepted layer are present after load ----
  var expectedGlobals = [
    'PBNamespace', 'PBConfig', 'PBStore', 'PBMetrics', // S1/S7-A infra
    'PBReview', 'PBTrend', 'PBRetest', 'PBReviewUI',   // S7
    'PBSessionExecution', 'PBTrainingReadiness', 'PBTrainingUI', // S8-C/D/E (PBTrainingPlan is not script-included by design, per S8-E)
    'PBMatchObservation', 'PBPerformanceAnalysis', 'PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'PBDashboard', // S9-B~F + S10-B-R1 (PBWorkflow/S10-A is not script-included: no persisted cycle to read yet)
    'PBPreview', 'PBAssessment', // pre-S7 UI support + S1 UI
    'go', 'LANG' // pre-S7 shell
  ];
  expectedGlobals.forEach(function (g) {
    assert.strictEqual(typeof harness.sandbox[g], (g === 'go' ? 'function' : (g === 'LANG' ? 'string' : 'object')), g + ' must be defined after the real script chain loads');
  });

  return flush(150).then(function () {
    var reg = harness.registry;

    // ================================================================
    // HOME / navigation structure (Section 4, 12)
    // ================================================================
    var viewSections = extractViewSections(HTML);
    var navButtons = extractNavButtons(HTML);
    var expectedTabs = ['home', 'learn', 'drill', 'measure', 'review', 'compete', 'team'];
    expectedTabs.forEach(function (tab) {
      assert.ok(viewSections.some(function (v) { return v.id === 'v-' + tab; }), 'v-' + tab + ' section must exist');
      assert.ok(navButtons.some(function (b) { return b.t === tab; }), 'nav button for ' + tab + ' must exist');
    });
    assert.strictEqual(reg['v-home'].classList.contains('active'), true, 'Home is the initially active view');

    // S8-F mobile-QA fix regression guard: the Home "System Map" table (pre-existing, predates
    // S1-S8) overflowed the 375px viewport because it wasn't wrapped in a horizontal-scroll
    // container, unlike every other wide table already using this app's established pattern.
    // Fixed by wrapping it in <div style="overflow-x:auto"> (the same pattern used elsewhere,
    // e.g. review-ui.js's hard-gate table) -- verify the wrapper is present so this can't
    // silently regress.
    var systemMapTableMatch = /<h3 class="blk" data-i18n-html="home\.mapH3">[\s\S]{0,600}?<table class="tbl">/.exec(HTML);
    assert.ok(systemMapTableMatch, 'the Home System Map table must still exist');
    assert.ok(/<div style="overflow-x:auto">\s*<table class="tbl">/.test(systemMapTableMatch[0]), 'the Home System Map table must stay wrapped in a horizontal-scroll container to prevent 375px viewport overflow');

    // go() must work for every real nav tab discovered from index.html (not a hand-picked subset).
    expectedTabs.forEach(function (tab) {
      harness.sandbox.go(tab);
      assert.strictEqual(reg['v-' + tab].classList.contains('active'), true, 'go(' + tab + ') activates v-' + tab);
      expectedTabs.filter(function (t) { return t !== tab; }).forEach(function (other) {
        assert.strictEqual(reg['v-' + other].classList.contains('active'), false, 'go(' + tab + ') deactivates v-' + other);
      });
      var btn = harness.navButtons.filter(function (b) { return b.dataset.t === tab; })[0];
      assert.ok(btn.classList.contains('on'), 'nav button for ' + tab + ' gets .on after go(' + tab + ')');
    });
    harness.sandbox.go('home'); // leave in the default state for subsequent checks

    // ================================================================
    // DRILL — pre-S7 8-week tracker core render/init path (Section 4)
    // ================================================================
    assert.strictEqual(reg.weeks.children.length, 8, 'renderWeeks must render exactly the 8 defined weeks');
    assert.ok(reg.weeks.children[0].innerHTML.indexOf('Rally-scoring') !== -1, 'week 1 content renders its real item text');
    assert.strictEqual(reg['t-done'].innerHTML, '0%', 'a clean STATE shows 0% done');
    assert.strictEqual(reg['t-pass'].innerHTML, '0%', 'a clean STATE shows 0% pass');
    assert.strictEqual(reg['t-items'].innerHTML, '<span class="num">0</span>/25', 'total tracked items is 25 (4+3*7), matching the real WEEKS data');

    // S8-E training mount points must exist inside the Drill view without breaking the legacy tracker.
    assert.ok(reg['training-cycle-app'], '#training-cycle-app mount exists');
    assert.ok(reg['training-today-app'], '#training-today-app mount exists (Home)');
    assert.ok(reg['training-progress-app'], '#training-progress-app mount exists (Review)');

    // ================================================================
    // MEASURE — pre-S7 KPI dashboard core render/init path (Section 4)
    // ================================================================
    assert.strictEqual(reg.modules.children.length, 9, 'renderModules must render all 9 KPI modules');
    assert.strictEqual(reg['k-score'].innerHTML, '9.5<small>/100</small>', 'initial composite KPI score is deterministic (0 on all modules, default UE=2 -> 95pts*10%)');
    assert.strictEqual(reg['k-level'].textContent, '基础需加强', 'initial level label matches the lowest bracket');

    harness.sandbox.setMod(0, 80); // Serve module (weight 8) to 80%
    assert.strictEqual(reg['fill-0'].style.width, '80%');
    assert.strictEqual(reg['pct-0'].textContent, '80%');
    assert.strictEqual(reg['k-score'].innerHTML, '15.9<small>/100</small>', 'composite score formula: 8*80/100 + 10*95/100 = 15.9');
    var serveGate = reg['home-gates'].children[0];
    assert.ok(serveGate, 'Serve gate tile rendered');
    assert.strictEqual(serveGate.className, 'gate no', 'Serve at 80% is below its 95% hard-gate threshold -> not ok');

    harness.sandbox.setMod(0, 95); // now meets the Serve threshold exactly
    assert.strictEqual(reg['home-gates'].children[0].className, 'gate ok', 'Serve at exactly 95% meets the threshold -> ok');

    harness.sandbox.setUE(2);
    assert.ok(reg['ue-val'].textContent.indexOf('95') !== -1, 'UE=2/game maps to the documented 95-point score');

    // ================================================================
    // MEASURE — S1 Assessment Data Core availability (Section 4/19: "Measure / Assessment
    // availability / basic operation"). Mounts against REAL data/*.json config, not a stub.
    // ================================================================
    var a1 = reg['a1-app'];
    assert.ok(a1.innerHTML.length > 0, 'a1-app (Assessment Data Core) must render, not stay blank');
    assert.strictEqual(a1.innerHTML.indexOf('模块未就绪'), -1, 'assessment.js must not fall into its "modules not ready" branch — PBConfig/PBStore/PBMetrics/PBPreview must all be loaded');
    assert.strictEqual(a1.innerHTML.indexOf('配置加载失败'), -1, 'PBConfig.load must succeed against the real data/*.json files');
    assert.ok(a1.innerHTML.indexOf('New Assessment') !== -1 || a1.innerHTML.indexOf('新建评估') !== -1, 'the New Assessment entry point must be present and reachable');

    // ================================================================
    // REVIEW — S7 Review/Trend UI mount (regression: still mounts after S8 integration)
    // ================================================================
    var review = reg['review-app'];
    assert.ok(review.innerHTML.length > 0, 'review-app must render something (at minimum the "no history" empty state), not stay blank');
    assert.strictEqual(review.innerHTML.indexOf('模块未就绪'), -1, 'review-ui.js must not report PBStore/PBTrend/PBRetest as missing');

    // ================================================================
    // Compete / Team static structure (Section 12: render/navigation PASS)
    // ================================================================
    assert.ok(HTML.indexOf('id="v-compete"') !== -1 && HTML.indexOf('DreamBreaker') !== -1, 'Compete tab content intact');
    assert.ok(HTML.indexOf('id="v-team"') !== -1 && HTML.indexOf('id="sync-status"') !== -1, 'Team tab structure intact');

    // ================================================================
    // i18n refresh hook must not throw and must reach every mounted UI module
    // (including the S8-E hook added into js/i18n.js's refreshDynamic()).
    // ================================================================
    assert.doesNotThrow(function () { harness.sandbox.toggleLang(); }, 'toggleLang() must not throw across the whole loaded app');
    harness.sandbox.toggleLang(); // back to zh for determinism if anything else reads LANG

    console.log('pre-s7-ui-regression.test.js: all assertions passed');
  });
}

run().catch(function (err) {
  console.error('pre-s7-ui-regression.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
