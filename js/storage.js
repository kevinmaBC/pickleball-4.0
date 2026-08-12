/* ============================================================
 * storage.js — Pickleball App 2.0 Alpha · S1 Data Core
 * 浏览器本地数据库 IndexedDB (IDB)。四个对象存储 (object stores)：
 *   players / assessments / test_sessions / trial_events
 * 逐 Trial 保存原始数据（不做任何聚合、不判级、不算能力分）。
 * 与现有 localStorage(STATE) 完全独立并存，不影响原有功能。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB_NAME = 'pb_v2';
  var DB_VERSION = 1;

  // 版本基线（V2.3.1）；若 PBConfig 已加载则以其为准
  var VERSIONS = { schema_version: '2.3.1', benchmark_version: '2.1.1', protocol_version: '2.2.1' };
  function versions() {
    try {
      if (typeof self !== 'undefined' && self.PBConfig && self.PBConfig.versions) return self.PBConfig.versions;
    } catch (e) {}
    return VERSIONS;
  }

  var STORES = {
    players:       { keyPath: 'player_id',       indexes: [] },
    assessments:   { keyPath: 'assessment_id',   indexes: [['by_player', 'player_id']] },
    test_sessions: { keyPath: 'test_session_id', indexes: [['by_assessment', 'assessment_id']] },
    trial_events:  { keyPath: 'trial_event_id',  indexes: [['by_session', 'test_session_id']] }
  };

  var _dbPromise = null;
  function open() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        Object.keys(STORES).forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            var cfg = STORES[name];
            var os = db.createObjectStore(name, { keyPath: cfg.keyPath });
            cfg.indexes.forEach(function (ix) { os.createIndex(ix[0], ix[1], { unique: false }); });
          }
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return _dbPromise;
  }

  function tx(store, mode) {
    return open().then(function (db) {
      return db.transaction(store, mode).objectStore(store);
    });
  }
  function reqP(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  // ---- 基础 CRUD ----
  function put(store, obj)      { return tx(store, 'readwrite').then(function (os) { return reqP(os.put(obj)); }).then(function () { return obj; }); }
  function get(store, key)      { return tx(store, 'readonly').then(function (os) { return reqP(os.get(key)); }); }
  function getAll(store)        { return tx(store, 'readonly').then(function (os) { return reqP(os.getAll()); }); }
  function del(store, key)      { return tx(store, 'readwrite').then(function (os) { return reqP(os.delete(key)); }); }
  function getByIndex(store, index, value) {
    return tx(store, 'readonly').then(function (os) { return reqP(os.index(index).getAll(value)); });
  }

  // ---- ID 生成 ----
  function uid(prefix) {
    var rnd = Math.random().toString(36).slice(2, 8);
    return prefix + '_' + Date.now().toString(36) + rnd;
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function nowISO() { return new Date().toISOString(); }

  // ---- 高层：创建对象 ----
  function createPlayer(display_name) {
    var p = { player_id: uid('plr'), display_name: (display_name || '').trim() || '未命名 Player', created_at: nowISO() };
    return put('players', p);
  }

  function createAssessment(opts) {
    var v = versions();
    var a = {
      assessment_id: uid('asm'),
      player_id: opts.player_id,
      assessment_date: opts.assessment_date || today(),
      assessment_tier: opts.assessment_tier,          // lite | standard | full
      target_training_level: opts.target_training_level, // 3.0 | 3.5 | 4.0 | 4.5 | 5.0
      schema_version: v.schema_version,
      benchmark_version: v.benchmark_version,
      protocol_version: v.protocol_version,
      created_at: nowISO()
      // 注意：本 Sprint 不写 validated_training_level / capability_score（禁止判级）
    };
    return put('assessments', a);
  }

  function createTestSession(opts) {
    var s = {
      test_session_id: uid('ses'),
      assessment_id: opts.assessment_id,
      test_id: opts.test_id,                          // T01..T07
      assessment_tier: opts.assessment_tier,
      feed_mode: opts.feed_mode,                      // machine | calibrated_human | partner | live_match
      feeder_id: opts.feeder_id || null,
      feeder_calibration_id: opts.feeder_calibration_id || null,
      started_at: nowISO()
    };
    return put('test_sessions', s);
  }

  function addTrialEvent(opts) {
    var t = {
      trial_event_id: uid('trl'),
      test_session_id: opts.test_session_id,
      trial_no: opts.trial_no,
      scenario_id: opts.scenario_id || null,
      outcome: opts.outcome,                          // S | P | F | I
      score_weight: (opts.score_weight === undefined ? null : opts.score_weight),
      raw_json: opts.raw_json || {},
      review_flag: !!opts.review_flag,
      video_timestamp_ms: (opts.video_timestamp_ms == null ? null : opts.video_timestamp_ms),
      created_at: nowISO()
    };
    return put('trial_events', t);
  }

  // ---- 查询 ----
  function listPlayers()                 { return getAll('players'); }
  function listAssessments()             { return getAll('assessments'); }
  function assessmentsByPlayer(pid)      { return getByIndex('assessments', 'by_player', pid); }
  function sessionsByAssessment(aid)     { return getByIndex('test_sessions', 'by_assessment', aid); }
  function trialsBySession(sid)          { return getByIndex('trial_events', 'by_session', sid); }

  // ---- 导出：完整 Assessment + Test Sessions + Trial Events（嵌套 JSON）----
  function exportAssessment(assessment_id) {
    var out = {};
    return get('assessments', assessment_id).then(function (a) {
      if (!a) throw new Error('assessment not found: ' + assessment_id);
      out.export_meta = { generated_at: nowISO(), versions: versions(), format: 'pb_assessment_export_v1' };
      out.assessment = a;
      return get('players', a.player_id);
    }).then(function (player) {
      out.player = player || null;
      return sessionsByAssessment(assessment_id);
    }).then(function (sessions) {
      sessions.sort(function (x, y) { return (x.test_id || '').localeCompare(y.test_id || ''); });
      return Promise.all(sessions.map(function (s) {
        return trialsBySession(s.test_session_id).then(function (trials) {
          trials.sort(function (x, y) { return (x.trial_no || 0) - (y.trial_no || 0); });
          return Object.assign({}, s, { trial_events: trials });
        });
      }));
    }).then(function (sessionsWithTrials) {
      out.test_sessions = sessionsWithTrials;
      return out;
    });
  }

  function clearAll() {
    return open().then(function (db) {
      return Promise.all(Object.keys(STORES).map(function (name) {
        return tx(name, 'readwrite').then(function (os) { return reqP(os.clear()); });
      }));
    });
  }

  return {
    DB_NAME: DB_NAME, DB_VERSION: DB_VERSION,
    open: open, put: put, get: get, getAll: getAll, del: del, getByIndex: getByIndex, clearAll: clearAll,
    createPlayer: createPlayer, createAssessment: createAssessment,
    createTestSession: createTestSession, addTrialEvent: addTrialEvent,
    listPlayers: listPlayers, listAssessments: listAssessments,
    assessmentsByPlayer: assessmentsByPlayer, sessionsByAssessment: sessionsByAssessment, trialsBySession: trialsBySession,
    exportAssessment: exportAssessment,
    _uid: uid
  };
});
