/* tests/fake-indexeddb.js — minimal in-memory IndexedDB stand-in.
 * Implements only the subset of the IDB API that js/storage.js uses, so
 * S7-A's upgrade path can be exercised under plain Node without adding
 * an npm dependency. Not a spec-complete IndexedDB implementation.
 */
'use strict';

function FakeRequest() {
  this.onsuccess = null;
  this.onerror = null;
  this.onupgradeneeded = null;
  this.result = undefined;
  this.error = null;
}

function fire(fn, evt) {
  if (fn) setTimeout(function () { fn(evt); }, 0);
}

function makeObjectStore(storeState) {
  return {
    keyPath: storeState.keyPath,
    createIndex: function (name, keyPath) {
      storeState.indexes[name] = { keyPath: keyPath };
    },
    put: function (value) {
      var req = new FakeRequest();
      var key = value[storeState.keyPath];
      storeState.data.set(key, value);
      req.result = key;
      fire(function () { req.onsuccess && req.onsuccess({ target: req }); });
      return req;
    },
    get: function (key) {
      var req = new FakeRequest();
      req.result = storeState.data.get(key);
      fire(function () { req.onsuccess && req.onsuccess({ target: req }); });
      return req;
    },
    getAll: function () {
      var req = new FakeRequest();
      req.result = Array.from(storeState.data.values());
      fire(function () { req.onsuccess && req.onsuccess({ target: req }); });
      return req;
    },
    delete: function (key) {
      var req = new FakeRequest();
      storeState.data.delete(key);
      fire(function () { req.onsuccess && req.onsuccess({ target: req }); });
      return req;
    },
    index: function (name) {
      var idx = storeState.indexes[name];
      return {
        getAll: function (value) {
          var req = new FakeRequest();
          req.result = Array.from(storeState.data.values()).filter(function (v) {
            return v[idx.keyPath] === value;
          });
          fire(function () { req.onsuccess && req.onsuccess({ target: req }); });
          return req;
        }
      };
    }
  };
}

function makeDB(dbState) {
  return {
    objectStoreNames: {
      contains: function (name) { return Object.prototype.hasOwnProperty.call(dbState.stores, name); }
    },
    createObjectStore: function (name, opts) {
      dbState.stores[name] = { keyPath: opts.keyPath, indexes: {}, data: new Map() };
      return makeObjectStore(dbState.stores[name]);
    },
    transaction: function (storeNames, mode) {
      return {
        objectStore: function (name) { return makeObjectStore(dbState.stores[name]); }
      };
    }
  };
}

function createFakeIndexedDB() {
  var databases = {};

  return {
    open: function (name, version) {
      var req = new FakeRequest();
      var existing = databases[name];
      var oldVersion = existing ? existing.version : 0;
      if (!existing) existing = databases[name] = { version: 0, stores: {} };

      setTimeout(function () {
        var upgraded = version > oldVersion;
        if (upgraded) existing.version = version;
        var db = makeDB(existing);
        req.result = db;
        if (upgraded && req.onupgradeneeded) {
          req.onupgradeneeded({ target: req, oldVersion: oldVersion, newVersion: version });
        }
        req.onsuccess && req.onsuccess({ target: req });
      }, 0);

      return req;
    },
    // Test-only helper: seed a pre-existing database version + store contents,
    // simulating a browser that already has S1-S6 data before the S7-A upgrade.
    _seed: function (name, version, storesSpec) {
      var dbState = { version: version, stores: {} };
      Object.keys(storesSpec).forEach(function (storeName) {
        var spec = storesSpec[storeName];
        var data = new Map();
        (spec.records || []).forEach(function (r) { data.set(r[spec.keyPath], r); });
        var indexes = {};
        (spec.indexes || []).forEach(function (ix) { indexes[ix[0]] = { keyPath: ix[1] }; });
        dbState.stores[storeName] = { keyPath: spec.keyPath, indexes: indexes, data: data };
      });
      databases[name] = dbState;
    },
    _dump: function () { return databases; }
  };
}

module.exports = createFakeIndexedDB;
