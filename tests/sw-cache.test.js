/* tests/sw-cache.test.js — S8-0/TD-SW-01: Service Worker cache/version safety
 * Verifies, by loading the real sw.js into a mocked SW global scope:
 *   1. Navigation and code/data requests (.js/.css/.json) use network-first
 *      (fresh content while online; cache is only an offline fallback).
 *   2. Static assets (icons) keep stale-while-revalidate (instant cached
 *      response, background refresh) — unaffected by the TD-SW-01 fix.
 *   3. activate() purges every cache key that is not the current CACHE
 *      version (obsolete cache cleanup keeps working).
 * Run: node tests/sw-cache.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

function loadSW() {
  var code = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  // Read the live CACHE constant out of sw.js itself rather than hardcoding a version literal,
  // so this test doesn't need editing every time sw.js's CACHE is bumped for an unrelated change.
  var currentCacheMatch = /const\s+CACHE\s*=\s*'([^']+)'/.exec(code);
  var CURRENT_CACHE = currentCacheMatch ? currentCacheMatch[1] : 'pb40-vTEST';
  var listeners = {};
  var putCalls = [];
  var deletedKeys = [];
  var cacheKeys = ['pb40-v-obsolete-fixture', CURRENT_CACHE];
  var cacheStore = { 'https://pb.app.test/icon-192.png': { fromCache: true } };

  var fakeCacheObj = {
    match: function (req) {
      var url = typeof req === 'string' ? req : req.url;
      return Promise.resolve(cacheStore[url] || undefined);
    },
    put: function (req, res) {
      var url = typeof req === 'string' ? req : req.url;
      putCalls.push(url);
      cacheStore[url] = res;
      return Promise.resolve();
    },
    addAll: function () { return Promise.resolve(); }
  };

  var sandbox = {
    self: {
      addEventListener: function (type, cb) { listeners[type] = cb; },
      skipWaiting: function () {},
      clients: { claim: function () { return Promise.resolve(); } }
    },
    caches: {
      open: function () { return Promise.resolve(fakeCacheObj); },
      match: function (req) { return fakeCacheObj.match(req); },
      keys: function () { return Promise.resolve(cacheKeys.slice()); },
      delete: function (key) { deletedKeys.push(key); cacheKeys = cacheKeys.filter(function (k) { return k !== key; }); return Promise.resolve(true); }
    },
    fetch: sandbox_fetch,
    URL: URL,
    Promise: Promise,
    console: console
  };
  function sandbox_fetch(req) {
    var url = typeof req === 'string' ? req : req.url;
    return sandbox.__fetchImpl(url);
  }
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  return { listeners: listeners, sandbox: sandbox, putCalls: putCalls, deletedKeys: deletedKeys, cacheKeys: function () { return cacheKeys; }, cacheStore: cacheStore, currentCache: CURRENT_CACHE };
}

function mkReq(url, opts) {
  opts = opts || {};
  return {
    url: 'https://pb.app.test/' + url.replace(/^\.\//, ''),
    method: opts.method || 'GET',
    mode: opts.mode || 'no-cors',
    headers: { get: function (name) { return (opts.headers && opts.headers[name]) || null; } }
  };
}

function run() {
  // 1. Code asset (.js) online: network-first fetches network, not cache.
  var env1 = loadSW();
  var fetchedUrls = [];
  env1.sandbox.__fetchImpl = function (url) { fetchedUrls.push(url); return Promise.resolve({ status: 200, clone: function () { return { status: 200 }; } }); };
  var respondWithResult = null;
  var event1 = { request: mkReq('./js/review-ui.js'), respondWith: function (p) { respondWithResult = p; } };
  env1.listeners.fetch(event1);
  return respondWithResult.then(function () {
    assert.deepStrictEqual(fetchedUrls, ['https://pb.app.test/js/review-ui.js'], '.js request should hit network-first path');

    // 2. Code asset (.json) offline: falls back to cache instead of serving nothing.
    var env2 = loadSW();
    env2.cacheStore['https://pb.app.test/data/level_gates_v2_3_1.json'] = { fromCache: true, status: 200 };
    env2.sandbox.__fetchImpl = function () { return Promise.reject(new Error('offline')); };
    var result2 = null;
    var event2 = { request: mkReq('./data/level_gates_v2_3_1.json'), respondWith: function (p) { result2 = p; } };
    env2.listeners.fetch(event2);
    return result2.then(function (res) {
      assert.ok(res && res.fromCache, '.json request should fall back to cache when offline');

      // 3. Navigation offline with no exact cache match falls back to index.html.
      var env3 = loadSW();
      env3.cacheStore['./index.html'] = { fromCache: true, isShell: true };
      env3.sandbox.__fetchImpl = function () { return Promise.reject(new Error('offline')); };
      var result3 = null;
      var event3 = { request: mkReq('./some/page', { mode: 'navigate' }), respondWith: function (p) { result3 = p; } };
      env3.listeners.fetch(event3);
      return result3.then(function (res) {
        assert.ok(res && res.isShell, 'offline navigation should fall back to index.html shell');

        // 4. Static asset (icon) still uses stale-while-revalidate: cached value
        //    returned immediately without waiting on the network promise.
        var env4 = loadSW();
        var netResolve;
        env4.sandbox.__fetchImpl = function () { return new Promise(function (resolve) { netResolve = resolve; }); };
        var result4 = null;
        var event4 = { request: mkReq('./icon-192.png'), respondWith: function (p) { result4 = p; } };
        env4.listeners.fetch(event4);
        return result4.then(function (res) {
          assert.strictEqual(res.fromCache, true, 'static icon should resolve instantly from cache (SWR), not wait on network');
          if (netResolve) netResolve({ status: 200, clone: function () { return { status: 200 }; } });

          // 5. activate() deletes every cache key that is not the current CACHE.
          var env5 = loadSW();
          var activatePromise;
          var activateEvent = { waitUntil: function (p) { activatePromise = p; } };
          env5.listeners.activate(activateEvent);
          return activatePromise.then(function () {
            assert.deepStrictEqual(env5.deletedKeys, ['pb40-v-obsolete-fixture'], 'activate should purge obsolete cache versions only');
            assert.deepStrictEqual(env5.cacheKeys(), [env5.currentCache], 'current CACHE version should survive activate cleanup');
            console.log('sw-cache.test.js: all assertions passed');
          });
        });
      });
    });
  });
}

run().catch(function (err) {
  console.error('sw-cache.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
