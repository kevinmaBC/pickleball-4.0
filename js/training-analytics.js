/* ============================================================
 * training-analytics.js — Pickleball App 2.0 Alpha · S3 Canonical
 * Evidence Aggregation & KPI Observation Core
 * 只读、按需计算的训练证据聚合视图：把 S2 原始 Trial 证据（PBStore /
 * PBTrainingEvidence 写入的 training_sessions + drill_evidence_events）
 * 按冻结的 canonical Drill/Master/KPI 结构分组，输出确定性的描述性
 * 统计快照（字面计数 + 简单比例）。不做任何判级/加权/阈值/瓶颈排名/
 * 推荐/处方/晋级/P0–P6 逻辑，不引入新的 IndexedDB store 或 schema
 * 版本，不持久化任何派生结果——每次调用都是一次全新的只读计算。
 * 依赖：js/storage.js (PBStore) 与 js/canonical-runtime.js (PBCanonical)，
 * 二者必须先于本文件加载；同样也在 js/training-evidence.js 之后加载
 * （概念上位于证据写入层之上），但不直接依赖 PBTrainingEvidence。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PBTrainingAnalytics = factory().createModule({
      pbStore: root.PBStore,
      pbCanonical: root.PBCanonical
    });
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SNAPSHOT_VERSION = 'PB30-50-S3-OBS-v1';

  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
  function isArray(v) { return Array.isArray(v); }

  // ---- KPI 标识解析：secondary_kpis 是分号分隔的字符串（S0 canonical 既有约定），
  // 这里只做确定性的标识符拆分，不做任何权重/评分/解读。----
  function parseSecondaryKpis(str) {
    if (typeof str !== 'string') return [];
    return str.split(';').map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
  }

  function uniqSorted(arr) {
    var seen = {};
    var out = [];
    arr.forEach(function (x) {
      if (!Object.prototype.hasOwnProperty.call(seen, x)) { seen[x] = true; out.push(x); }
    });
    out.sort();
    return out;
  }

  function toSet(arr) {
    var set = {};
    (arr || []).forEach(function (x) { set[x] = true; });
    return set;
  }

  function emptyOutcomeCounts() {
    return { outcome_S_count: 0, outcome_P_count: 0, outcome_F_count: 0, outcome_I_count: 0 };
  }

  function addOutcome(counts, outcome) {
    if (outcome === 'S') counts.outcome_S_count += 1;
    else if (outcome === 'P') counts.outcome_P_count += 1;
    else if (outcome === 'F') counts.outcome_F_count += 1;
    else if (outcome === 'I') counts.outcome_I_count += 1;
  }

  function sumCounts(a, b) {
    return {
      outcome_S_count: a.outcome_S_count + b.outcome_S_count,
      outcome_P_count: a.outcome_P_count + b.outcome_P_count,
      outcome_F_count: a.outcome_F_count + b.outcome_F_count,
      outcome_I_count: a.outcome_I_count + b.outcome_I_count
    };
  }

  // ---- 字面计数 + 简单算术比例；分母为 0 时一律为 null（绝不 NaN/Infinity）。----
  function computeRateFields(counts) {
    var total = counts.outcome_S_count + counts.outcome_P_count + counts.outcome_F_count + counts.outcome_I_count;
    var valid = counts.outcome_S_count + counts.outcome_P_count + counts.outcome_F_count;
    return {
      trial_count_total: total,
      outcome_S_count: counts.outcome_S_count,
      outcome_P_count: counts.outcome_P_count,
      outcome_F_count: counts.outcome_F_count,
      outcome_I_count: counts.outcome_I_count,
      valid_trial_count: valid,
      S_rate_total: total > 0 ? counts.outcome_S_count / total : null,
      P_rate_total: total > 0 ? counts.outcome_P_count / total : null,
      F_rate_total: total > 0 ? counts.outcome_F_count / total : null,
      I_rate_total: total > 0 ? counts.outcome_I_count / total : null,
      S_rate_valid: valid > 0 ? counts.outcome_S_count / valid : null,
      P_rate_valid: valid > 0 ? counts.outcome_P_count / valid : null,
      F_rate_valid: valid > 0 ? counts.outcome_F_count / valid : null
    };
  }

  function minDate(a, b) { if (a == null) return b; if (b == null) return a; return a < b ? a : b; }
  function maxDate(a, b) { if (a == null) return b; if (b == null) return a; return a > b ? a : b; }

  function createModule(opts) {
    opts = opts || {};
    var pbStore = opts.pbStore;
    var pbCanonical = opts.pbCanonical;

    if (!pbStore) throw new Error('training-analytics: PBStore is not available — js/storage.js must load before js/training-analytics.js');
    if (!pbCanonical) throw new Error('training-analytics: PBCanonical is not available — js/canonical-runtime.js must load before js/training-analytics.js');

    function computeSnapshot(queryOpts) {
      queryOpts = queryOpts || {};
      var player_id = queryOpts.player_id;
      if (!isNonEmptyString(player_id)) return Promise.reject(new Error('training-analytics: player_id is required'));

      var date_from = (queryOpts.date_from == null ? null : queryOpts.date_from);
      var date_to = (queryOpts.date_to == null ? null : queryOpts.date_to);
      if (date_from !== null && !isNonEmptyString(date_from)) return Promise.reject(new Error('training-analytics: date_from must be a non-empty string or null'));
      if (date_to !== null && !isNonEmptyString(date_to)) return Promise.reject(new Error('training-analytics: date_to must be a non-empty string or null'));

      var requested_session_ids = (queryOpts.training_session_ids == null ? null : queryOpts.training_session_ids);
      var requested_drill_ids = (queryOpts.source_drill_ids == null ? null : queryOpts.source_drill_ids);
      var requested_master_ids = (queryOpts.master_ids == null ? null : queryOpts.master_ids);
      if (requested_session_ids !== null && !isArray(requested_session_ids)) return Promise.reject(new Error('training-analytics: training_session_ids must be an array or null'));
      if (requested_drill_ids !== null && !isArray(requested_drill_ids)) return Promise.reject(new Error('training-analytics: source_drill_ids must be an array or null'));
      if (requested_master_ids !== null && !isArray(requested_master_ids)) return Promise.reject(new Error('training-analytics: master_ids must be an array or null'));

      return pbCanonical.ready.then(function () {
        // ---- Canonical 结构（每次调用都重新读取只读 facade；不缓存第二份）----
        var masters = pbCanonical.listMasters(); // 冻结的 canonical 顺序
        var drills = pbCanonical.listDrills();   // 冻结的 canonical 顺序（已按 Master 分组）

        var drillById = {};
        drills.forEach(function (d) { drillById[d.source_drill_id] = d; });

        var canonicalMasterOfDrill = {}; // source_drill_id -> master_id（权威派生，永不信任存储行的 master_id）
        masters.forEach(function (m) {
          m.source_drill_ids.forEach(function (did) { canonicalMasterOfDrill[did] = m.master_id; });
        });

        // ---- KPI 结构：仅从 canonical primary_kpi / secondary_kpis 派生，与证据无关 ----
        var kpiStructure = {}; // kpi_id -> { primary_for_drill_ids:[], secondary_for_drill_ids:[] }
        drills.forEach(function (d) {
          var pk = d.primary_kpi;
          if (isNonEmptyString(pk)) {
            if (!kpiStructure[pk]) kpiStructure[pk] = { primary_for_drill_ids: [], secondary_for_drill_ids: [] };
            kpiStructure[pk].primary_for_drill_ids.push(d.source_drill_id);
          }
          parseSecondaryKpis(d.secondary_kpis).forEach(function (sk) {
            if (!kpiStructure[sk]) kpiStructure[sk] = { primary_for_drill_ids: [], secondary_for_drill_ids: [] };
            kpiStructure[sk].secondary_for_drill_ids.push(d.source_drill_id);
          });
        });
        var canonicalDrillOrder = drills.map(function (d) { return d.source_drill_id; });
        Object.keys(kpiStructure).forEach(function (kpiId) {
          var meta = kpiStructure[kpiId];
          var inRole = toSet(meta.primary_for_drill_ids.concat(meta.secondary_for_drill_ids));
          meta.referenced_drill_ids = canonicalDrillOrder.filter(function (did) { return inRole[did]; });
        });

        var drillFilterSet = requested_drill_ids ? toSet(requested_drill_ids) : null;
        var masterFilterSet = requested_master_ids ? toSet(requested_master_ids) : null;

        return pbStore.getByIndex('training_sessions', 'by_player', player_id).then(function (sessions) {
          var sessionById = {};
          sessions.forEach(function (s) { sessionById[s.training_session_id] = s; });

          var scopedSessions = sessions.filter(function (s) {
            if (date_from !== null && s.session_date < date_from) return false;
            if (date_to !== null && s.session_date > date_to) return false;
            return true;
          });

          var unknown_session_ids = [];
          if (requested_session_ids !== null) {
            var allowedSessionIds = {};
            requested_session_ids.forEach(function (sid) {
              if (Object.prototype.hasOwnProperty.call(sessionById, sid)) allowedSessionIds[sid] = true;
              else unknown_session_ids.push(sid);
            });
            scopedSessions = scopedSessions.filter(function (s) {
              return Object.prototype.hasOwnProperty.call(allowedSessionIds, s.training_session_id);
            });
          }

          return Promise.all(scopedSessions.map(function (s) {
            return pbStore.getByIndex('drill_evidence_events', 'by_training_session', s.training_session_id).then(function (rows) {
              return { session: s, rows: rows };
            });
          })).then(function (sessionRows) {
            // ---- 聚合累加器：预置全部 35 Drill / 13 Master（零填充） ----
            var drillAgg = {};
            drills.forEach(function (d) {
              drillAgg[d.source_drill_id] = { counts: emptyOutcomeCounts(), sessionIds: {}, dateFirst: null, dateLast: null };
            });
            var masterAgg = {};
            masters.forEach(function (m) {
              masterAgg[m.master_id] = { counts: emptyOutcomeCounts(), sessionIds: {}, dateFirst: null, dateLast: null };
            });

            var overallCounts = emptyOutcomeCounts();
            var overallSessionIds = {};
            var overallDateFirst = null;
            var overallDateLast = null;

            var unknown_drill_ids = [];
            var unknown_master_ids = [];
            var mismatched_master_ids = [];

            sessionRows.forEach(function (sr) {
              var sessionDate = sr.session.session_date;
              var sessionId = sr.session.training_session_id;
              sr.rows.forEach(function (evRow) {
                var did = evRow.source_drill_id;
                if (!Object.prototype.hasOwnProperty.call(drillById, did)) {
                  unknown_drill_ids.push(did);
                  return; // 不计入任何聚合，仅在 integrity 中留痕
                }
                var canonicalMasterId = canonicalMasterOfDrill[did];
                if (!canonicalMasterId) {
                  unknown_master_ids.push(evRow.master_id || did);
                  return;
                }
                if (evRow.master_id !== canonicalMasterId) {
                  mismatched_master_ids.push(evRow.master_id);
                }

                if (drillFilterSet && !drillFilterSet[did]) return;
                if (masterFilterSet && !masterFilterSet[canonicalMasterId]) return;

                var dAgg = drillAgg[did];
                addOutcome(dAgg.counts, evRow.outcome);
                dAgg.sessionIds[sessionId] = true;
                dAgg.dateFirst = minDate(dAgg.dateFirst, sessionDate);
                dAgg.dateLast = maxDate(dAgg.dateLast, sessionDate);

                var mAgg = masterAgg[canonicalMasterId];
                addOutcome(mAgg.counts, evRow.outcome);
                mAgg.sessionIds[sessionId] = true;
                mAgg.dateFirst = minDate(mAgg.dateFirst, sessionDate);
                mAgg.dateLast = maxDate(mAgg.dateLast, sessionDate);

                addOutcome(overallCounts, evRow.outcome);
                overallSessionIds[sessionId] = true;
                overallDateFirst = minDate(overallDateFirst, sessionDate);
                overallDateLast = maxDate(overallDateLast, sessionDate);
              });
            });

            // ---- by_drill：冻结的 canonical Drill 顺序，全部 35 项，零填充 ----
            var by_drill = drills.map(function (d) {
              var agg = drillAgg[d.source_drill_id];
              var row = {
                source_drill_id: d.source_drill_id,
                master_id: canonicalMasterOfDrill[d.source_drill_id],
                primary_kpi: d.primary_kpi,
                secondary_kpi_ids: parseSecondaryKpis(d.secondary_kpis)
              };
              var rateFields = computeRateFields(agg.counts);
              Object.keys(rateFields).forEach(function (k) { row[k] = rateFields[k]; });
              row.session_count = Object.keys(agg.sessionIds).length;
              row.evidence_date_first = agg.dateFirst;
              row.evidence_date_last = agg.dateLast;
              return row;
            });

            // ---- by_master：冻结的 canonical Master 顺序，全部 13 项，零填充 ----
            var by_master = masters.map(function (m) {
              var agg = masterAgg[m.master_id];
              var row = {
                master_id: m.master_id,
                name: m.name,
                class: m.class,
                drill_ids: m.source_drill_ids.slice()
              };
              var rateFields = computeRateFields(agg.counts);
              Object.keys(rateFields).forEach(function (k) { row[k] = rateFields[k]; });
              row.session_count = Object.keys(agg.sessionIds).length;
              row.evidence_date_first = agg.dateFirst;
              row.evidence_date_last = agg.dateLast;
              return row;
            });

            // ---- by_kpi：结构（primary/secondary/referenced）来自 canonical，与筛选无关；
            // 计数/比例/evidence_bearing_drill_ids 来自当前筛选后的 drillAgg ----
            var by_kpi = Object.keys(kpiStructure).sort().map(function (kpiId) {
              var meta = kpiStructure[kpiId];
              var counts = emptyOutcomeCounts();
              meta.referenced_drill_ids.forEach(function (did) {
                counts = sumCounts(counts, drillAgg[did].counts);
              });
              var evidenceBearing = meta.referenced_drill_ids.filter(function (did) {
                var c = drillAgg[did].counts;
                return (c.outcome_S_count + c.outcome_P_count + c.outcome_F_count + c.outcome_I_count) > 0;
              });
              var row = {
                kpi_id: kpiId,
                primary_for_drill_ids: meta.primary_for_drill_ids.slice(),
                secondary_for_drill_ids: meta.secondary_for_drill_ids.slice(),
                referenced_drill_ids: meta.referenced_drill_ids.slice(),
                evidence_bearing_drill_ids: evidenceBearing
              };
              var rateFields = computeRateFields(counts);
              Object.keys(rateFields).forEach(function (k) { row[k] = rateFields[k]; });
              return row;
            });

            var masterWithEvidence = by_master.filter(function (r) { return r.trial_count_total > 0; }).length;
            var drillWithEvidence = by_drill.filter(function (r) { return r.trial_count_total > 0; }).length;

            var coverage = {
              master_count_total: masters.length,
              master_count_with_evidence: masterWithEvidence,
              master_count_without_evidence: masters.length - masterWithEvidence,
              drill_count_total: drills.length,
              drill_count_with_evidence: drillWithEvidence,
              drill_count_without_evidence: drills.length - drillWithEvidence,
              session_count: Object.keys(overallSessionIds).length,
              evidence_date_first: overallDateFirst,
              evidence_date_last: overallDateLast
            };

            var overall = computeRateFields(overallCounts);

            return {
              snapshot_version: SNAPSHOT_VERSION,
              player_id: player_id,
              filter: {
                date_from: date_from,
                date_to: date_to,
                training_session_ids: requested_session_ids,
                source_drill_ids: requested_drill_ids,
                master_ids: requested_master_ids
              },
              coverage: coverage,
              overall: overall,
              by_master: by_master,
              by_drill: by_drill,
              by_kpi: by_kpi,
              integrity: {
                unknown_drill_ids: uniqSorted(unknown_drill_ids),
                unknown_master_ids: uniqSorted(unknown_master_ids),
                mismatched_master_ids: uniqSorted(mismatched_master_ids),
                unknown_session_ids: uniqSorted(unknown_session_ids)
              }
            };
          });
        });
      });
    }

    return {
      SNAPSHOT_VERSION: SNAPSHOT_VERSION,
      computeSnapshot: computeSnapshot,
      _parseSecondaryKpis: parseSecondaryKpis
    };
  }

  return { createModule: createModule };
});
