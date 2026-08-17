'use strict';
/* In-memory fake implementing the subset of the PBStore contract that
 * js/training-evidence.js depends on (put/get/getAll/del/getByIndex/_uid),
 * so S2 module logic can be unit-tested in Node without a real IndexedDB. */

var KEYPATH = {
  players: 'player_id',
  training_sessions: 'training_session_id',
  drill_evidence_events: 'drill_evidence_id'
};

var INDEX_FIELD = {
  training_sessions: { by_player: 'player_id', by_session_date: 'session_date' },
  drill_evidence_events: { by_training_session: 'training_session_id', by_source_drill: 'source_drill_id', by_master: 'master_id' }
};

function createFakeStore(seedPlayers) {
  var data = { players: {}, training_sessions: {}, drill_evidence_events: {} };
  (seedPlayers || []).forEach(function (p) { data.players[p.player_id] = p; });
  var seq = 0;

  function uid(prefix) { seq += 1; return prefix + '_' + seq; }
  function put(store, obj) {
    var kp = KEYPATH[store];
    if (!kp) return Promise.reject(new Error('fake_store: unknown store "' + store + '"'));
    data[store][obj[kp]] = obj;
    return Promise.resolve(obj);
  }
  function get(store, key) { return Promise.resolve(data[store][key]); }
  function getAll(store) { return Promise.resolve(Object.keys(data[store]).map(function (k) { return data[store][k]; })); }
  function del(store, key) { delete data[store][key]; return Promise.resolve(); }
  function getByIndex(store, index, value) {
    var field = INDEX_FIELD[store] && INDEX_FIELD[store][index];
    if (!field) return Promise.reject(new Error('fake_store: unknown index "' + index + '" on "' + store + '"'));
    return Promise.resolve(Object.keys(data[store]).map(function (k) { return data[store][k]; }).filter(function (r) { return r[field] === value; }));
  }

  return { put: put, get: get, getAll: getAll, del: del, getByIndex: getByIndex, _uid: uid, _raw: data };
}

module.exports = { createFakeStore: createFakeStore };
