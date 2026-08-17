/* ============================================================
 * canonical-runtime.js — Pickleball App 2.0 Alpha · S1 Canonical Runtime Bridge
 * Thin read-only adapter between the frozen S0 canonical repository
 * (js/masters-repo.js + data/canonical/seed_data.json) and the
 * browser/PWA runtime.
 *
 * This module defines no data, computes nothing, stores no second
 * copy of any master/drill, and never mutates anything. It only
 * loads the S0 index once and forwards reads to it. S0 remains the
 * sole canonical data authority.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PBCanonical = factory().createFacade({
      pbMasters: root.PBMasters,
      url: './data/canonical/seed_data.json'
    });
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Pure factory: given a PBMasters-shaped loader and a URL, returns a
  // read-only facade object. Kept separate from browser auto-bootstrap
  // so it can be unit tested with an injected fake loader (no network,
  // no DOM required).
  function createFacade(opts) {
    opts = opts || {};
    var pbMasters = opts.pbMasters;
    var url = opts.url;

    var state = 'loading'; // 'loading' -> 'ready' | 'error'
    var error = null;
    var repo = null;

    function notReadyError() {
      return new Error('PBCanonical: not ready (state=' + state + ')');
    }

    function requireReady() {
      if (state !== 'ready') throw notReadyError();
      return repo;
    }

    var ready = new Promise(function (resolve, reject) {
      if (!pbMasters || typeof pbMasters.load !== 'function') {
        var e = new Error('PBCanonical: PBMasters is not available — js/masters-repo.js must load before js/canonical-runtime.js');
        state = 'error';
        error = e;
        reject(e);
        return;
      }
      pbMasters.load(url).then(function (r) {
        repo = r;
        state = 'ready';
        resolve(repo);
      }).catch(function (e) {
        state = 'error';
        error = e;
        reject(e);
      });
    });
    // Consumers that only poll `.state`/`.error` shouldn't produce an
    // unhandled-rejection warning for not having attached a .catch.
    ready.catch(function () {});

    return {
      ready: ready,
      get state() { return state; },
      get error() { return error; },
      getMaster: function (master_id) { return requireReady().getMaster(master_id); },
      getDrill: function (source_drill_id) { return requireReady().getDrill(source_drill_id); },
      getDrillsByMaster: function (master_id) { return requireReady().getDrillsByMaster(master_id); },
      listMasters: function () { return requireReady().listMasters(); },
      listDrills: function () { return requireReady().listDrills(); },
      get schemaVersion() { return requireReady().schema_version; }
    };
  }

  return { createFacade: createFacade };
});
