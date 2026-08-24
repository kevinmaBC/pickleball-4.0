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
  // Short fail-safe: if the new worker's controllerchange never arrives
  // (sw.js's install handler calls skipWaiting() itself, so by the time the
  // user clicks the button the browser may have already promoted it without
  // ever firing the event this code is listening for), still reload once
  // rather than leaving the user stuck on "waiting".
  var FAILSAFE_RELOAD_TIMEOUT_MS = 3000;

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

  // Applies a waiting Service Worker (or, if none is waiting but an update
  // is already known to be available, just reloads) and reloads exactly
  // once. Never touches Cache Storage / IndexedDB / localStorage / user
  // records, and guards against a reload loop with a one-shot sessionStorage
  // flag.
  //
  // opts.updateAvailable: pass true when the caller's last checkForUpdate()
  // result was UPDATE_AVAILABLE. sw.js's install handler calls
  // self.skipWaiting() itself, so the new worker can activate before the
  // user ever clicks "Update and Restart" — by then registration.waiting is
  // already empty even though a real update was published. In that case a
  // plain reload is what actually adopts the new HTML/JS (via the existing
  // network-first fetch policy), so it happens instead of only telling the
  // user to close and reopen the app.
  function applyUpdateAndRestart(opts) {
    opts = opts || {};
    var swReg = opts.swRegistration;
    var win = opts.win || (typeof window !== 'undefined' ? window : undefined);
    var updateAvailable = !!opts.updateAvailable;
    var timeoutMs = (opts.timeoutMs !== undefined) ? opts.timeoutMs : FAILSAFE_RELOAD_TIMEOUT_MS;
    var setTimeoutImpl = Object.prototype.hasOwnProperty.call(opts, 'setTimeout')
      ? opts.setTimeout
      : (typeof setTimeout === 'function' ? setTimeout : undefined);
    var clearTimeoutImpl = Object.prototype.hasOwnProperty.call(opts, 'clearTimeout')
      ? opts.clearTimeout
      : (typeof clearTimeout === 'function' ? clearTimeout : undefined);

    var storage;
    try { storage = win && win.sessionStorage; } catch (e) { storage = undefined; }
    var FLAG = 'pb40_update_reload_once';

    function reloadOnce() {
      if (!win) return false;
      var already = false;
      try { already = storage && storage.getItem(FLAG) === '1'; } catch (e) {}
      if (already) return false;
      try { storage && storage.setItem(FLAG, '1'); } catch (e) {}
      try { win.location.reload(); } catch (e) {}
      return true;
    }

    if (swReg && swReg.waiting && typeof swReg.waiting.postMessage === 'function') {
      return new Promise(function (resolve) {
        var settled = false;
        var timer;
        function finish() {
          if (settled) return;
          settled = true;
          if (timer && clearTimeoutImpl) clearTimeoutImpl(timer);
          resolve(reloadOnce());
        }
        var listenerAttached = false;
        try {
          if (win && win.navigator && win.navigator.serviceWorker
              && typeof win.navigator.serviceWorker.addEventListener === 'function') {
            win.navigator.serviceWorker.addEventListener('controllerchange', finish);
            listenerAttached = true;
          }
        } catch (e) {}
        if (setTimeoutImpl) {
          timer = setTimeoutImpl(finish, timeoutMs);
        }
        swReg.waiting.postMessage({ type: 'SKIP_WAITING' });
        // Degraded environment with neither a controllerchange target nor a
        // timer available — nothing left to wait on, so reload immediately.
        if (!listenerAttached && !setTimeoutImpl) finish();
      });
    }

    if (updateAvailable) {
      // Nothing waiting to activate (already activated on its own, or the
      // registration had no pending worker) but a real update is known to
      // exist — reload once so the page picks up the newly published
      // HTML/JS instead of leaving the user stuck on stale code.
      return Promise.resolve(reloadOnce());
    }

    // No waiting worker and no known pending update — nothing unsafe to do;
    // caller should tell the user to close and reopen the APP.
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
    FAILSAFE_RELOAD_TIMEOUT_MS: FAILSAFE_RELOAD_TIMEOUT_MS,
    compareReleases: compareReleases,
    checkForUpdate: checkForUpdate,
    applyUpdateAndRestart: applyUpdateAndRestart,
    clearReloadGuard: clearReloadGuard
  };
});
