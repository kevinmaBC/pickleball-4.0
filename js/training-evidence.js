/* ============================================================
 * training-evidence.js — Pickleball App 2.0 Alpha · S2 Canonical
 * Training Session Evidence Core
 * 逐 Trial 保存原始训练证据，绑定到冻结的 canonical Drill/Master
 * （通过 PBCanonical 只读校验 + 派生 master_id）。不做任何判级/
 * 推荐/处方/晋级/P0–P6 逻辑，不复制 canonical Drill/Master 完整定义。
 * 依赖：js/storage.js (PBStore) 与 js/canonical-runtime.js (PBCanonical)，
 * 二者必须先于本文件加载。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PBTrainingEvidence = factory().createModule({
      pbStore: root.PBStore,
      pbCanonical: root.PBCanonical
    });
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VALID_OUTCOMES = { S: true, P: true, F: true, I: true };

  function isValidOutcome(o) { return Object.prototype.hasOwnProperty.call(VALID_OUTCOMES, o); }
  function isPositiveInt(n) { return typeof n === 'number' && Number.isInteger(n) && n > 0; }
  function isNonNegInt(n) { return typeof n === 'number' && Number.isInteger(n) && n >= 0; }
  function isPlainObject(v) { return v != null && typeof v === 'object' && !Array.isArray(v); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function nowISO() { return new Date().toISOString(); }

  function createModule(opts) {
    opts = opts || {};
    var pbStore = opts.pbStore;
    var pbCanonical = opts.pbCanonical;

    if (!pbStore) throw new Error('training-evidence: PBStore is not available — js/storage.js must load before js/training-evidence.js');
    if (!pbCanonical) throw new Error('training-evidence: PBCanonical is not available — js/canonical-runtime.js must load before js/training-evidence.js');

    // ---- 派生：由冻结的 Master 归属关系求出 master_id；从不信任调用方传入的 master_id ----
    function deriveMasterId(source_drill_id) {
      var masters = pbCanonical.listMasters();
      for (var i = 0; i < masters.length; i++) {
        if (masters[i].source_drill_ids.indexOf(source_drill_id) !== -1) return masters[i].master_id;
      }
      return null;
    }

    function checkDuplicateTrial(training_session_id, source_drill_id, trial_no) {
      return pbStore.getByIndex('drill_evidence_events', 'by_training_session', training_session_id).then(function (rows) {
        var dup = rows.some(function (r) { return r.source_drill_id === source_drill_id && r.trial_no === trial_no; });
        if (dup) {
          throw new Error('training-evidence: duplicate trial_no ' + trial_no + ' for source_drill_id "' + source_drill_id + '" already exists in training_session "' + training_session_id + '"');
        }
      });
    }

    // ---- Session ----
    function createSession(opts) {
      opts = opts || {};
      var player_id = opts.player_id;
      if (!player_id) return Promise.reject(new Error('training-evidence: player_id is required'));
      return pbStore.get('players', player_id).then(function (player) {
        if (!player) throw new Error('training-evidence: unknown player_id "' + player_id + '" — a training session may only be created for an existing player');
        return pbCanonical.ready;
      }).then(function () {
        var s = {
          training_session_id: pbStore._uid('trn'),
          player_id: player_id,
          session_date: opts.session_date || today(),
          started_at: nowISO(),
          ended_at: null,
          notes: (opts.notes == null ? null : opts.notes),
          canonical_schema_version: pbCanonical.schemaVersion,
          created_at: nowISO()
        };
        return pbStore.put('training_sessions', s);
      });
    }

    function endSession(training_session_id, opts) {
      opts = opts || {};
      return pbStore.get('training_sessions', training_session_id).then(function (s) {
        if (!s) throw new Error('training-evidence: training_session_id "' + training_session_id + '" not found');
        var patch = { ended_at: (opts.ended_at != null ? opts.ended_at : nowISO()) };
        return pbStore.put('training_sessions', Object.assign({}, s, patch));
      });
    }

    function listSessionsByPlayer(player_id) {
      return pbStore.getByIndex('training_sessions', 'by_player', player_id);
    }

    // ---- Evidence ----
    function addEvidence(opts) {
      opts = opts || {};
      var training_session_id = opts.training_session_id;
      var source_drill_id = opts.source_drill_id;
      var trial_no = opts.trial_no;
      var outcome = opts.outcome;
      var video_timestamp_ms = (opts.video_timestamp_ms === undefined ? null : opts.video_timestamp_ms);
      var raw_json = (opts.raw_json === undefined ? {} : opts.raw_json);

      if (!training_session_id) return Promise.reject(new Error('training-evidence: training_session_id is required'));
      if (!source_drill_id) return Promise.reject(new Error('training-evidence: source_drill_id is required'));
      if (!isValidOutcome(outcome)) return Promise.reject(new Error('training-evidence: outcome must be one of S | P | F | I'));
      if (!isPositiveInt(trial_no)) return Promise.reject(new Error('training-evidence: trial_no must be a positive integer'));
      if (video_timestamp_ms !== null && !isNonNegInt(video_timestamp_ms)) return Promise.reject(new Error('training-evidence: video_timestamp_ms must be a non-negative integer or null'));
      if (!isPlainObject(raw_json)) return Promise.reject(new Error('training-evidence: raw_json must be a plain object'));

      return pbCanonical.ready.then(function () {
        var drill = pbCanonical.getDrill(source_drill_id);
        if (!drill) throw new Error('training-evidence: unknown source_drill_id "' + source_drill_id + '" (not in canonical Drill set)');
        var master_id = deriveMasterId(source_drill_id);
        if (!master_id) throw new Error('training-evidence: source_drill_id "' + source_drill_id + '" is not mapped to any canonical Master');
        return pbStore.get('training_sessions', training_session_id).then(function (session) {
          if (!session) throw new Error('training-evidence: training_session_id "' + training_session_id + '" not found');
          return checkDuplicateTrial(training_session_id, source_drill_id, trial_no);
        }).then(function () {
          var e = {
            drill_evidence_id: pbStore._uid('dev'),
            training_session_id: training_session_id,
            source_drill_id: source_drill_id,
            master_id: master_id,
            trial_no: trial_no,
            outcome: outcome,
            scenario_id: (opts.scenario_id == null ? null : opts.scenario_id),
            target: (opts.target == null ? null : opts.target),
            quality: (opts.quality == null ? null : opts.quality),
            notes: (opts.notes == null ? null : opts.notes),
            video_timestamp_ms: video_timestamp_ms,
            raw_json: raw_json,
            created_at: nowISO()
          };
          return pbStore.put('drill_evidence_events', e);
        });
      });
    }

    function evidenceBySession(training_session_id) {
      return pbStore.getByIndex('drill_evidence_events', 'by_training_session', training_session_id);
    }
    function evidenceByDrill(source_drill_id) {
      return pbStore.getByIndex('drill_evidence_events', 'by_source_drill', source_drill_id);
    }
    function evidenceByMaster(master_id) {
      return pbStore.getByIndex('drill_evidence_events', 'by_master', master_id);
    }

    // ---- Export（会话 + 证据，确定性排序；不嵌入完整 canonical Drill/Master 定义）----
    function exportSession(training_session_id) {
      var out = {};
      return pbStore.get('training_sessions', training_session_id).then(function (s) {
        if (!s) throw new Error('training-evidence: training_session_id "' + training_session_id + '" not found');
        out.export_meta = { generated_at: nowISO(), format: 'pb_training_evidence_export_v1' };
        out.training_session = s;
        return pbStore.get('players', s.player_id);
      }).then(function (player) {
        out.player = player || null;
        return pbStore.getByIndex('drill_evidence_events', 'by_training_session', training_session_id);
      }).then(function (events) {
        events.sort(function (a, b) {
          if (a.trial_no !== b.trial_no) return a.trial_no - b.trial_no;
          return (a.created_at || '').localeCompare(b.created_at || '');
        });
        out.drill_evidence_events = events;
        return out;
      });
    }

    // ---- 删除 Session（级联删其 drill_evidence_events）----
    function deleteSession(training_session_id) {
      return pbStore.getByIndex('drill_evidence_events', 'by_training_session', training_session_id).then(function (events) {
        return Promise.all(events.map(function (e) { return pbStore.del('drill_evidence_events', e.drill_evidence_id); }));
      }).then(function () {
        return pbStore.del('training_sessions', training_session_id);
      });
    }

    return {
      createSession: createSession,
      endSession: endSession,
      listSessionsByPlayer: listSessionsByPlayer,
      addEvidence: addEvidence,
      evidenceBySession: evidenceBySession,
      evidenceByDrill: evidenceByDrill,
      evidenceByMaster: evidenceByMaster,
      exportSession: exportSession,
      deleteSession: deleteSession,
      _deriveMasterId: deriveMasterId
    };
  }

  return { createModule: createModule };
});
