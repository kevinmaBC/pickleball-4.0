/* ============================================================
 * version-update.js — PB-APP-RC1.1 · Version & Update Check
 * Scope: read-only release-identity comparison + PWA update-and-restart
 * flow. No assessment/scoring/recommendation/training/match/progress/
 * reassessment/journey logic. No DB schema, DB_VERSION, or store changes.
 * Pure functions (RUNNING_RELEASE, compareReleases, checkForUpdate) are
 * side-effect-free and independently testable; render()/applyUpdate() are
 * the only DOM/SW-touching parts and are exercised in-browser, not here.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBVersionUpdate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Baked-in identity of the code actually running (kept in sync with
  // data/app-release.json at release time; the check compares this against
  // the fetched, possibly-newer, published copy of that same file).
  var RUNNING_RELEASE = {
    product_release: 'PB-APP-RC1.1',
    sw_cache: 'pb40-v30',
    schema_version: '2.3.1',
    benchmark_version: '2.1.1',
    protocol_version: '2.2.1'
  };

  var STATES = {
    LATEST: 'LATEST',
    UPDATE_AVAILABLE: 'UPDATE_AVAILABLE',
    OFFLINE: 'OFFLINE',
    CHECK_FAILED: 'CHECK_FAILED',
    UNSUPPORTED: 'UNSUPPORTED'
  };

  var RELEASE_URL = './data/app-release.json';
  var IDENTITY_FIELDS = ['product_release', 'sw_cache', 'schema_version', 'benchmark_version', 'protocol_version'];

  // Pure: never returns LATEST unless every tracked identity field matches
  // verbatim. Never called on a network/offline failure path (see
  // checkForUpdate) so it can never misreport an error as "latest".
  function compareReleases(running, published) {
    if (!running || !published) return STATES.CHECK_FAILED;
    var same = IDENTITY_FIELDS.every(function (k) { return running[k] === published[k]; });
    return same ? STATES.LATEST : STATES.UPDATE_AVAILABLE;
  }

  // checkForUpdate(opts) — orchestrates the deterministic-state check.
  // opts: { fetch, url, running, online, swRegistration } all optional and
  // overridable, so this same function drives both the real browser button
  // and headless tests without any DOM.
  function checkForUpdate(opts) {
    opts = opts || {};
    var fetchImpl = Object.prototype.hasOwnProperty.call(opts, 'fetch')
      ? opts.fetch
      : (typeof fetch === 'function' ? fetch : undefined);
    var url = opts.url || RELEASE_URL;
    var running = opts.running || RUNNING_RELEASE;
    var swReg = opts.swRegistration;
    var online = (opts.online !== undefined) ? opts.online
      : (typeof navigator === 'undefined' || navigator.onLine !== false);

    if (typeof fetchImpl !== 'function') return Promise.resolve({ state: STATES.UNSUPPORTED });
    if (!online) return Promise.resolve({ state: STATES.OFFLINE });

    var swUpdateP = (swReg && typeof swReg.update === 'function')
      ? swReg.update().catch(function () {})
      : Promise.resolve();

    return swUpdateP.then(function () {
      return fetchImpl(url + (url.indexOf('?') === -1 ? '?' : '&') + 't=' + Date.now(), { cache: 'no-store' });
    }).then(function (res) {
      if (!res || !res.ok) throw new Error('release metadata fetch failed');
      return res.json();
    }).then(function (published) {
      return { state: compareReleases(running, published), published: published, running: running, checkedAt: Date.now() };
    }).catch(function () {
      // Any failure past the online check (bad status, JSON parse error,
      // network drop mid-flight) is a real check failure, not "latest".
      return { state: STATES.CHECK_FAILED, checkedAt: Date.now() };
    });
  }

  // Applies a waiting Service Worker and reloads exactly once. Never
  // touches Cache Storage / IndexedDB / localStorage / user records, and
  // guards against a reload loop with a one-shot sessionStorage flag.
  function applyUpdateAndRestart(opts) {
    opts = opts || {};
    var swReg = opts.swRegistration;
    var win = opts.win || (typeof window !== 'undefined' ? window : undefined);
    var storage;
    try { storage = win && win.sessionStorage; } catch (e) { storage = undefined; }
    var FLAG = 'pb40_update_reload_once';

    function reloadOnce() {
      if (!win) return false;
      var already = false;
      try { already = storage && storage.getItem(FLAG) === '1'; } catch (e) {}
      if (already) return false;
      try { storage && storage.setItem(FLAG, '1'); } catch (e) {}
      win.location.reload();
      return true;
    }

    if (swReg && swReg.waiting && typeof swReg.waiting.postMessage === 'function') {
      var controllerChanged = false;
      try {
        if (win && win.navigator && win.navigator.serviceWorker) {
          win.navigator.serviceWorker.addEventListener('controllerchange', function () {
            if (controllerChanged) return;
            controllerChanged = true;
            reloadOnce();
          });
        }
      } catch (e) {}
      swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
      // Fail-safe: if controllerchange never fires (older/partial support), still reload once.
      return Promise.resolve(true).then(function () { return reloadOnce(); });
    }
    // No waiting worker to activate — nothing unsafe to do; caller should
    // tell the user to close and reopen the APP.
    return Promise.resolve(false);
  }

  function clearReloadGuard(win) {
    win = win || (typeof window !== 'undefined' ? window : undefined);
    try { win && win.sessionStorage && win.sessionStorage.removeItem('pb40_update_reload_once'); } catch (e) {}
  }

  return {
    RUNNING_RELEASE: RUNNING_RELEASE,
    STATES: STATES,
    RELEASE_URL: RELEASE_URL,
    compareReleases: compareReleases,
    checkForUpdate: checkForUpdate,
    applyUpdateAndRestart: applyUpdateAndRestart,
    clearReloadGuard: clearReloadGuard
  };
});
