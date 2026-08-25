/* tests/rc1.1-version-ebook-access.test.js — PB-APP-RC1.1: Version &
 * E-Book Access.
 *
 * Governance-scope note: this suite covers only the frozen RC1.1 scope
 * (release identity, update-check state machine, PWA install copy,
 * permanent E-Book URL/QR access). It adds no assessment/scoring/
 * recommendation/training/match/progress/reassessment/journey logic and
 * asserts none was touched (DB_VERSION/stores unchanged).
 *
 * Run: node tests/rc1.1-version-ebook-access.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var ROOT = path.join(__dirname, '..');
function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); }

var VU = require('../js/version-update.js');
var INDEX_HTML = readSrc('index.html');
var SW_SRC = readSrc('sw.js');
var STORAGE_SRC = stripComments(readSrc('js/storage.js'));
var VERSION_UPDATE_SRC = stripComments(readSrc('js/version-update.js'));
var EBOOK_HTML = readSrc('ebook/index.html');

var APP_URL = 'https://kevinmabc.github.io/pickleball-4.0/';
var EBOOK_URL = 'https://kevinmabc.github.io/pickleball-4.0/ebook/';

function run() {

  // 1/2/3. Release metadata exists, parses, and carries the frozen identity.
  (function () {
    var raw = readSrc('data/app-release.json');
    var meta;
    assert.doesNotThrow(function () { meta = JSON.parse(raw); }, '1: data/app-release.json must be valid JSON');
    assert.strictEqual(meta.product_release, 'PB-APP-RC1.1', '2: release identity is PB-APP-RC1.1');
    assert.strictEqual(meta.sw_cache, 'pb40-v31', '3: metadata cache identity is pb40-v31');
    assert.strictEqual(meta.schema_version, '2.3.1');
    assert.strictEqual(meta.benchmark_version, '2.1.1');
    assert.strictEqual(meta.protocol_version, '2.2.1');
    assert.strictEqual(meta.product_baseline, '4676e25');
    assert.strictEqual(meta.governance_baseline, '5cc91ba');

    // Running identity baked into the app must match the published metadata's
    // identity fields exactly, or a freshly-deployed app would immediately
    // report UPDATE_AVAILABLE against itself.
    assert.strictEqual(VU.RUNNING_RELEASE.product_release, 'PB-APP-RC1.1');
    assert.strictEqual(VU.RUNNING_RELEASE.sw_cache, 'pb40-v31', '3: running cache identity is pb40-v31');
    assert.strictEqual(VU.compareReleases(VU.RUNNING_RELEASE, meta), VU.STATES.LATEST,
      'RUNNING_RELEASE must be in sync with data/app-release.json');

    // sw.js CACHE constant must match too (single source of truth for the cache name).
    var cacheMatch = /const\s+CACHE\s*=\s*'([^']+)'/.exec(SW_SRC);
    assert.ok(cacheMatch, 'sw.js must declare CACHE');
    assert.strictEqual(cacheMatch[1], 'pb40-v31', '3: sw.js CACHE is pb40-v31');
  })();

  // 4. Version comparison returns LATEST correctly.
  (function () {
    var running = { product_release: 'PB-APP-RC1.1', sw_cache: 'pb40-v30', schema_version: '2.3.1', benchmark_version: '2.1.1', protocol_version: '2.2.1' };
    var published = Object.assign({}, running);
    assert.strictEqual(VU.compareReleases(running, published), VU.STATES.LATEST, '4: identical identity -> LATEST');
  })();

  // 5. A newer published release returns UPDATE_AVAILABLE.
  (function () {
    var running = { product_release: 'PB-APP-RC1.1', sw_cache: 'pb40-v30', schema_version: '2.3.1', benchmark_version: '2.1.1', protocol_version: '2.2.1' };
    var newer = Object.assign({}, running, { product_release: 'PB-APP-RC1.2', sw_cache: 'pb40-v31' });
    assert.strictEqual(VU.compareReleases(running, newer), VU.STATES.UPDATE_AVAILABLE, '5: newer published release -> UPDATE_AVAILABLE');
  })();

  // 6. Offline state is never reported as latest.
  (function () {
    return VU.checkForUpdate({ online: false, fetch: function () { throw new Error('must not fetch while offline'); } })
      .then(function (result) {
        assert.strictEqual(result.state, VU.STATES.OFFLINE, '6: offline -> OFFLINE');
        assert.notStrictEqual(result.state, VU.STATES.LATEST, '6: offline must never be reported as LATEST');
      });
  })();

  // 7. Check failure is never reported as latest (network reject + bad HTTP status).
  (function () {
    var rejectFetch = function () { return Promise.reject(new Error('network drop')); };
    var badStatusFetch = function () { return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({}); } }); };
    var badJsonFetch = function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.reject(new Error('bad json')); } }); };
    return Promise.all([
      VU.checkForUpdate({ online: true, fetch: rejectFetch }).then(function (r) {
        assert.strictEqual(r.state, VU.STATES.CHECK_FAILED, '7a: fetch rejection -> CHECK_FAILED');
        assert.notStrictEqual(r.state, VU.STATES.LATEST, '7a: must never report LATEST on failure');
      }),
      VU.checkForUpdate({ online: true, fetch: badStatusFetch }).then(function (r) {
        assert.strictEqual(r.state, VU.STATES.CHECK_FAILED, '7b: HTTP error status -> CHECK_FAILED');
      }),
      VU.checkForUpdate({ online: true, fetch: badJsonFetch }).then(function (r) {
        assert.strictEqual(r.state, VU.STATES.CHECK_FAILED, '7c: JSON parse failure -> CHECK_FAILED');
      })
    ]);
  })();

  // UNSUPPORTED: no fetch implementation available at all.
  (function () {
    return VU.checkForUpdate({ online: true, fetch: undefined }).then(function (r) {
      assert.strictEqual(r.state, VU.STATES.UNSUPPORTED, 'no fetch available -> UNSUPPORTED');
    });
  })();

  // checkForUpdate calls a provided swRegistration.update() where supported, best-effort.
  (function () {
    var calls = 0;
    var swReg = { update: function () { calls++; return Promise.resolve(); } };
    var meta = Object.assign({}, VU.RUNNING_RELEASE);
    var fetchImpl = function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(meta); } }); };
    return VU.checkForUpdate({ online: true, fetch: fetchImpl, swRegistration: swReg }).then(function (r) {
      assert.strictEqual(calls, 1, 'swRegistration.update() must be invoked once when supported');
      assert.strictEqual(r.state, VU.STATES.LATEST);
    });
  })();

  // 8. Update action does not clear user storage — source-scan js/version-update.js
  // for any storage-clearing call; only postMessage/SKIP_WAITING and a single-key
  // sessionStorage reload guard are permitted.
  (function () {
    var forbidden = ['indexedDB.deleteDatabase', 'localStorage.clear', 'caches.delete', 'caches.keys', 'sessionStorage.clear', 'IDBFactory'];
    forbidden.forEach(function (token) {
      assert.strictEqual(VERSION_UPDATE_SRC.indexOf(token), -1, '8: version-update.js must never call ' + token);
    });
    assert.ok(VERSION_UPDATE_SRC.indexOf('SKIP_WAITING') !== -1, '8: uses the safe SKIP_WAITING handshake to activate the waiting worker');
  })();

  // ================================================================
  // R1-02 — applyUpdateAndRestart: waiting-worker path, already-activated/
  // no-waiting-worker path, exactly-once reload, reload-loop prevention,
  // and no user-storage clearing. All against fake win/serviceWorker
  // objects — no real DOM, no real timers.
  // ================================================================
  function makeFakeServiceWorker() {
    var listeners = [];
    return {
      addEventListener: function (type, cb) { if (type === 'controllerchange') listeners.push(cb); },
      fire: function () { listeners.slice().forEach(function (cb) { cb(); }); }
    };
  }
  function makeFakeWin(opts) {
    opts = opts || {};
    var store = {};
    var reloadCalls = 0;
    var localStorageClearCalls = 0;
    var deleteDatabaseCalls = [];
    var cachesDeleteCalls = [];
    var win = {
      location: { reload: function () { reloadCalls++; } },
      sessionStorage: {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
        setItem: function (k, v) { store[k] = v; },
        removeItem: function (k) { delete store[k]; }
      },
      localStorage: { clear: function () { localStorageClearCalls++; } },
      indexedDB: { deleteDatabase: function (name) { deleteDatabaseCalls.push(name); } },
      caches: { delete: function (k) { cachesDeleteCalls.push(k); return Promise.resolve(true); } },
      navigator: opts.serviceWorker ? { serviceWorker: opts.serviceWorker } : undefined
    };
    return {
      win: win,
      reloadCalls: function () { return reloadCalls; },
      localStorageClearCalls: function () { return localStorageClearCalls; },
      deleteDatabaseCalls: function () { return deleteDatabaseCalls; },
      cachesDeleteCalls: function () { return cachesDeleteCalls; }
    };
  }

  // R1-02a: waiting-worker path — posts SKIP_WAITING, waits for
  // controllerchange, reloads exactly once.
  (function () {
    var posted = [];
    var swReg = { waiting: { postMessage: function (m) { posted.push(m); } } };
    var sw = makeFakeServiceWorker();
    var f = makeFakeWin({ serviceWorker: sw });
    var p = VU.applyUpdateAndRestart({
      swRegistration: swReg, win: f.win,
      setTimeout: function () { return 0; }, clearTimeout: function () {}
    });
    sw.fire(); // simulate the browser promoting the new worker
    return p.then(function (reloaded) {
      assert.strictEqual(reloaded, true, 'R1-02a: waiting-worker path resolves reloaded=true');
      assert.deepStrictEqual(posted, [{ type: 'SKIP_WAITING' }], 'R1-02a: posts SKIP_WAITING to the waiting worker');
      assert.strictEqual(f.reloadCalls(), 1, 'R1-02a: reload happens exactly once');
    });
  })();

  // R1-02b: fail-safe timeout — if controllerchange never arrives, a short
  // fail-safe timeout still reloads once.
  (function () {
    var swReg = { waiting: { postMessage: function () {} } };
    var f = makeFakeWin({}); // no navigator.serviceWorker -> controllerchange can never fire
    var timeoutCb;
    var p = VU.applyUpdateAndRestart({
      swRegistration: swReg, win: f.win,
      setTimeout: function (cb, ms) { timeoutCb = cb; assert.ok(ms > 0 && ms <= 5000, 'R1-02b: fail-safe timeout is short'); return 1; },
      clearTimeout: function () {}
    });
    assert.strictEqual(typeof timeoutCb, 'function', 'R1-02b: a fail-safe timer is armed');
    timeoutCb();
    return p.then(function (reloaded) {
      assert.strictEqual(reloaded, true, 'R1-02b: fail-safe timeout triggers the reload');
      assert.strictEqual(f.reloadCalls(), 1);
    });
  })();

  // R1-02c: both controllerchange and the fail-safe timer firing must still
  // reload exactly once (settle-once guard inside applyUpdateAndRestart).
  (function () {
    var swReg = { waiting: { postMessage: function () {} } };
    var sw = makeFakeServiceWorker();
    var f = makeFakeWin({ serviceWorker: sw });
    var timeoutCb;
    var p = VU.applyUpdateAndRestart({
      swRegistration: swReg, win: f.win,
      setTimeout: function (cb) { timeoutCb = cb; return 1; }, clearTimeout: function () {}
    });
    sw.fire();
    if (timeoutCb) timeoutCb();
    return p.then(function () {
      assert.strictEqual(f.reloadCalls(), 1, 'R1-02c: reload happens exactly once even if both triggers fire');
    });
  })();

  // R1-02d: already-activated / no-waiting-worker path — when the update
  // check already returned UPDATE_AVAILABLE, reload directly instead of
  // only telling the user to close and reopen the app.
  (function () {
    var f = makeFakeWin({});
    var swReg = {}; // no .waiting
    return VU.applyUpdateAndRestart({ swRegistration: swReg, win: f.win, updateAvailable: true }).then(function (reloaded) {
      assert.strictEqual(reloaded, true, 'R1-02d: no waiting worker + updateAvailable -> reload');
      assert.strictEqual(f.reloadCalls(), 1);
    });
  })();

  // R1-02e: no waiting worker and no known pending update -> nothing unsafe
  // is attempted (caller falls back to the close-and-reopen message).
  (function () {
    var f = makeFakeWin({});
    var swReg = {};
    return VU.applyUpdateAndRestart({ swRegistration: swReg, win: f.win, updateAvailable: false }).then(function (reloaded) {
      assert.strictEqual(reloaded, false, 'R1-02e: nothing to activate and no known update -> no reload');
      assert.strictEqual(f.reloadCalls(), 0);
    });
  })();

  // R1-02f: reload-loop prevention — the one-shot sessionStorage flag blocks
  // a second reload, and clearReloadGuard() releases it again for next time.
  (function () {
    var f = makeFakeWin({});
    f.win.sessionStorage.setItem('pb40_update_reload_once', '1');
    var swReg = {};
    return VU.applyUpdateAndRestart({ swRegistration: swReg, win: f.win, updateAvailable: true }).then(function (reloaded) {
      assert.strictEqual(reloaded, false, 'R1-02f: reload-loop guard blocks a second reload');
      assert.strictEqual(f.reloadCalls(), 0);
      VU.clearReloadGuard(f.win);
      assert.strictEqual(f.win.sessionStorage.getItem('pb40_update_reload_once'), null,
        'R1-02f: clearReloadGuard releases the one-shot flag for the next update');
    });
  })();

  // R1-02g: no user-storage clearing anywhere in the waiting-worker flow —
  // functional check on top of the source-scan in test 8 above.
  (function () {
    var sw = makeFakeServiceWorker();
    var f = makeFakeWin({ serviceWorker: sw });
    var swReg = { waiting: { postMessage: function () {} } };
    var p = VU.applyUpdateAndRestart({
      swRegistration: swReg, win: f.win,
      setTimeout: function () { return 1; }, clearTimeout: function () {}
    });
    sw.fire();
    return p.then(function () {
      assert.strictEqual(f.localStorageClearCalls(), 0, 'R1-02g: never calls localStorage.clear');
      assert.strictEqual(f.deleteDatabaseCalls().length, 0, 'R1-02g: never calls indexedDB.deleteDatabase');
      assert.strictEqual(f.cachesDeleteCalls().length, 0, 'R1-02g: never calls caches.delete');
    });
  })();

  // sw.js: message handler only ever calls self.skipWaiting(), never touches
  // Cache Storage / IndexedDB / localStorage.
  (function () {
    var msgHandlerMatch = /addEventListener\('message',([\s\S]*?)\);/.exec(SW_SRC);
    assert.ok(msgHandlerMatch, 'sw.js must register a message listener for SKIP_WAITING');
    var body = msgHandlerMatch[1];
    assert.ok(body.indexOf('skipWaiting') !== -1, 'sw.js message handler calls skipWaiting');
    ['caches.delete', 'indexedDB.deleteDatabase', 'localStorage'].forEach(function (token) {
      assert.strictEqual(body.indexOf(token), -1, 'sw.js message handler must never call ' + token);
    });
  })();

  // 9. /ebook/ landing page exists.
  (function () {
    assert.ok(fs.existsSync(path.join(ROOT, 'ebook', 'index.html')), '9: ebook/index.html must exist');
  })();

  // 10. Both permanent URLs are exact (QR-A on the e-book page, QR-B in the app).
  (function () {
    assert.ok(EBOOK_HTML.indexOf(APP_URL) !== -1, '10: ebook page shows the exact official APP URL: ' + APP_URL);
    assert.ok(INDEX_HTML.indexOf(EBOOK_URL) !== -1, '10: app About panel shows the exact E-Book URL: ' + EBOOK_URL);
  })();

  // 11. Both QR assets exist as static local files (SVG), not a runtime/CDN service.
  (function () {
    var qrApp = path.join(ROOT, 'assets', 'qr', 'qr-app.svg');
    var qrEbook = path.join(ROOT, 'assets', 'qr', 'qr-ebook.svg');
    assert.ok(fs.existsSync(qrApp), '11: assets/qr/qr-app.svg must exist');
    assert.ok(fs.existsSync(qrEbook), '11: assets/qr/qr-ebook.svg must exist');
    assert.ok(fs.readFileSync(qrApp, 'utf8').indexOf('<svg') !== -1, '11: qr-app.svg is a real SVG');
    assert.ok(fs.readFileSync(qrEbook, 'utf8').indexOf('<svg') !== -1, '11: qr-ebook.svg is a real SVG');
    // No runtime QR generation/service call anywhere in the shipped app or e-book page.
    [INDEX_HTML, EBOOK_HTML].forEach(function (html) {
      assert.strictEqual(/api\.qrserver|chart\.googleapis|qrcode(?:\.js|-generator)/i.test(html), false,
        'no runtime/CDN QR service referenced');
    });
  })();

  // 12. PB-EBOOK-RC1: both editions are published — no stale "In Preparation"
  // placeholder remains, and each edition links to its actual frozen PDF.
  (function () {
    assert.strictEqual(EBOOK_HTML.indexOf('正在装配中') === -1 && EBOOK_HTML.indexOf('In Preparation') === -1, true,
      '12: no "正在装配中 / In Preparation" placeholder remains on the e-book page');
    assert.strictEqual(EBOOK_HTML.indexOf('尚无发布说明') === -1 && EBOOK_HTML.indexOf('No release notes yet') === -1, true,
      '12: no "no release notes yet" placeholder remains');
    assert.ok(/href\s*=\s*"[^"]*\.pdf"/i.test(EBOOK_HTML), '12: e-book page now links directly to PDF files');
  })();

  // PB-EBOOK-RC1 — publication integration.
  var RELEASE_MANIFEST = JSON.parse(readSrc('ebook/release-manifest.json'));
  var CN_PDF_REL = 'ebook/' + RELEASE_MANIFEST.editions['zh-CN'].file;
  var EN_PDF_REL = 'ebook/' + RELEASE_MANIFEST.editions['en-CA'].file;

  // EB-1. Release identity strings appear on the e-book page.
  (function () {
    assert.ok(EBOOK_HTML.indexOf('PB-EBOOK-RC1') !== -1, 'EB-1: e-book page shows PB-EBOOK-RC1');
    assert.ok(EBOOK_HTML.indexOf('PB-APP-RC1.1') !== -1, 'EB-1: e-book page shows the paired APP baseline PB-APP-RC1.1');
  })();

  // EB-2. Page count is correct per edition (144 CN / 102 EN).
  (function () {
    assert.ok(EBOOK_HTML.indexOf('144 pages') !== -1, 'EB-2: Chinese edition shows 144 pages');
    assert.ok(EBOOK_HTML.indexOf('102 pages') !== -1, 'EB-2: English edition shows 102 pages');
  })();

  // EB-3. Four reading/download entry points exist. PB-EBOOK-RC1.1: the
  // "Open" entries route through the embedded reader (not the raw PDF);
  // only the "Download" entries link directly to the frozen PDF.
  (function () {
    var cnHref = RELEASE_MANIFEST.editions['zh-CN'].file;
    var enHref = RELEASE_MANIFEST.editions['en-CA'].file;
    var cnLinkRe = new RegExp('<a[^>]+href="' + cnHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g');
    var enLinkRe = new RegExp('<a[^>]+href="' + enHref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'g');
    assert.strictEqual((EBOOK_HTML.match(cnLinkRe) || []).length, 1, 'EB-3: exactly 1 direct link (download only) to the Chinese PDF');
    assert.strictEqual((EBOOK_HTML.match(enLinkRe) || []).length, 1, 'EB-3: exactly 1 direct link (download only) to the English PDF');
    assert.ok(EBOOK_HTML.indexOf('href="' + RELEASE_MANIFEST.reader.chinese + '"') !== -1, 'EB-3: "Open Chinese Edition" routes to the embedded reader');
    assert.ok(EBOOK_HTML.indexOf('href="' + RELEASE_MANIFEST.reader.english + '"') !== -1, 'EB-3: "Open English Edition" routes to the embedded reader');
    assert.ok(EBOOK_HTML.indexOf('Open Chinese Edition') !== -1, 'EB-3: "Open Chinese Edition" entry point exists');
    assert.ok(EBOOK_HTML.indexOf('Download Chinese PDF') !== -1, 'EB-3: "Download Chinese PDF" entry point exists');
    assert.ok(EBOOK_HTML.indexOf('Open English Edition') !== -1, 'EB-3: "Open English Edition" entry point exists');
    assert.ok(EBOOK_HTML.indexOf('Download English PDF') !== -1, 'EB-3: "Download English PDF" entry point exists');
  })();

  // EB-4. Both PDF files exist on disk and are non-zero.
  (function () {
    var cnStat = fs.statSync(path.join(ROOT, CN_PDF_REL));
    var enStat = fs.statSync(path.join(ROOT, EN_PDF_REL));
    assert.ok(cnStat.size > 0, 'EB-4: Chinese PDF exists and is non-zero');
    assert.ok(enStat.size > 0, 'EB-4: English PDF exists and is non-zero');
  })();

  // EB-5. Actual on-disk SHA-256 of both PDFs matches the release manifest
  // (the frozen hashes must never drift from what was authorized).
  (function () {
    function sha256(rel) {
      return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex');
    }
    assert.strictEqual(sha256(CN_PDF_REL), RELEASE_MANIFEST.editions['zh-CN'].sha256, 'EB-5: Chinese PDF SHA-256 matches manifest');
    assert.strictEqual(sha256(EN_PDF_REL), RELEASE_MANIFEST.editions['en-CA'].sha256, 'EB-5: English PDF SHA-256 matches manifest');
    assert.strictEqual(RELEASE_MANIFEST.editions['zh-CN'].sha256, '04fcc0ccd9a2027463ce63b2995096d32884c68706b25e2ab92db77d5112d64f', 'EB-5: Chinese SHA-256 matches the frozen authorized value');
    assert.strictEqual(RELEASE_MANIFEST.editions['en-CA'].sha256, 'f3c325ad1372f7979f475479bf7fdc92949868bf9c171c5d769ac0e19c96afa7', 'EB-5: English SHA-256 matches the frozen authorized value');
  })();

  // EB-6. Manifest parses and both editions are RELEASED.
  (function () {
    assert.strictEqual(RELEASE_MANIFEST.release, 'PB-EBOOK-RC1', 'EB-6: manifest release id is PB-EBOOK-RC1');
    assert.strictEqual(RELEASE_MANIFEST.status, 'RELEASED', 'EB-6: manifest status is RELEASED');
    assert.strictEqual(RELEASE_MANIFEST.editions['zh-CN'].status, 'RELEASED', 'EB-6: zh-CN edition is RELEASED');
    assert.strictEqual(RELEASE_MANIFEST.editions['en-CA'].status, 'RELEASED', 'EB-6: en-CA edition is RELEASED');
  })();

  // EB-7. Sync-control flags.
  (function () {
    assert.strictEqual(RELEASE_MANIFEST.sync_control.cn_en_paired, true, 'EB-7: cn_en_paired is true');
    assert.strictEqual(RELEASE_MANIFEST.sync_control.app_ebook_paired, true, 'EB-7: app_ebook_paired is true');
  })();

  // EB-8. Word masters are never publicly downloadable.
  (function () {
    assert.strictEqual(RELEASE_MANIFEST.word_masters.public_download, false, 'EB-8: word_masters.public_download is false');
    assert.strictEqual(/\.docx?["\s]/i.test(EBOOK_HTML), false, 'EB-8: no Word master file is linked from the e-book page');
  })();

  // EB-9. Service Worker never precaches the (large) PDF release files.
  (function () {
    var coreMatch = /const\s+CORE\s*=\s*\[([\s\S]*?)\];/.exec(SW_SRC);
    assert.ok(coreMatch, 'EB-9: sw.js must declare a CORE precache list');
    assert.strictEqual(/\.pdf/i.test(coreMatch[1]), false, 'EB-9: sw.js CORE precache list must not reference any .pdf file');
  })();

  // EB-10. APP QR payload/target is unchanged by this release.
  (function () {
    assert.ok(EBOOK_HTML.indexOf('src="../assets/qr/qr-app.svg"') !== -1, 'EB-10: e-book page still renders the APP QR (qr-app.svg)');
    assert.ok(EBOOK_HTML.indexOf(APP_URL) !== -1, 'EB-10: APP QR caption/URL is still the exact permanent APP URL');
  })();

  // EB-11. The e-book page still offers a way back to the APP.
  (function () {
    assert.ok(EBOOK_HTML.indexOf('href="' + APP_URL + '"') !== -1, 'EB-11: e-book page still links back to the APP');
  })();

  // 13. Required CN/EN labels exist (verbatim, per PB-APP-RC1.1 spec section 5).
  (function () {
    var required = [
      'APP版本 / App Version',
      '数据与规则版本 / Rules &amp; Data Versions',
      '检查更新 / Check for Updates',
      '更新并重新启动 / Update and Restart',
      '最近检查时间 / Last Checked',
      '安装到设备 / Install App'
    ];
    required.forEach(function (label) {
      assert.ok(INDEX_HTML.indexOf(label) !== -1, '13: index.html must contain label "' + label + '"');
    });
    var stateLabels = [
      '当前已是最新版',
      '发现新版本',
      '离线，暂时无法检查更新'
    ];
    stateLabels.forEach(function (label) {
      assert.ok(INDEX_HTML.indexOf(label) !== -1, '13: index.html must contain status text "' + label + '"');
    });
  })();

  // 14. DB_VERSION remains 5 (unchanged by this release).
  (function () {
    assert.ok(/var DB_VERSION = 5;/.test(STORAGE_SRC), '14: DB_VERSION remains 5');
  })();

  // 15. Store count remains 18/18 (unchanged by this release).
  (function () {
    var storesBlockMatch = STORAGE_SRC.match(/var STORES = \{([\s\S]*?)\n  \};/);
    assert.ok(storesBlockMatch, '15: STORES config block found');
    var keyPathCount = (storesBlockMatch[1].match(/keyPath:/g) || []).length;
    assert.strictEqual(keyPathCount, 18, '15: exactly 18 stores (found ' + keyPathCount + ')');
  })();

  // No business/assessment/training/match/progress/journey vocabulary was
  // introduced by the new RC1.1 module — it is a pure release-identity/update
  // module, nothing more.
  (function () {
    var forbidden = ['PBAssessment', 'PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription',
      'PBWorkflow', 'PBReassessment', 'PBMatchObservation', 'validated_training_level', 'PBStore'];
    forbidden.forEach(function (token) {
      assert.strictEqual(VERSION_UPDATE_SRC.indexOf(token), -1, 'version-update.js must never reference ' + token);
    });
  })();

  console.log('rc1.1-version-ebook-access.test.js: all assertions passed');
}

Promise.resolve().then(run).catch(function (err) {
  console.error('rc1.1-version-ebook-access.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
