/* ============================================================
 * masters-repo.js — Pickleball App 2.0 Alpha · S0 Data Foundation
 * 只读访问 13 Masters + 35 canonical GREEN35 Drills。
 * 无任何写入/更新 API——源字段不可变，读取即冻结 (Object.freeze)。
 * 数据来源单一：data/canonical/seed_data.json（由
 * scripts/build-canonical-data.js 从
 * docs/handoff/phase0-s0/seed_data.json 生成，禁止手工维护第二份）。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBMasters = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var REQUIRED_MASTER_FIELDS = ['master_id', 'name', 'class', 'source_drill_ids'];
  var REQUIRED_DRILL_FIELDS = [
    'source_drill_id', 'level_range', 'progression', 'purpose', 'setup', 'feed',
    'dose', 'success_criterion', 'primary_kpi', 'secondary_kpis', 'evidence', 'match_transfer'
  ];

  function deepFreeze(obj) {
    if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
      Object.getOwnPropertyNames(obj).forEach(function (key) { deepFreeze(obj[key]); });
      Object.freeze(obj);
    }
    return obj;
  }

  // buildIndex 是纯函数：输入已解析的 seed JSON，输出只读查询接口。
  // 任何计数/唯一性/映射不满足即刻抛错（fail fast），不产出半成品索引。
  function buildIndex(seedData) {
    if (!seedData || typeof seedData !== 'object') throw new Error('masters-repo: seedData must be an object');
    var masters = seedData.masters;
    var drills = seedData.drills;
    if (!Array.isArray(masters)) throw new Error('masters-repo: masters must be an array');
    if (!Array.isArray(drills)) throw new Error('masters-repo: drills must be an array');
    if (masters.length !== 13) throw new Error('masters-repo: expected exactly 13 masters, got ' + masters.length);
    if (drills.length !== 35) throw new Error('masters-repo: expected exactly 35 drills, got ' + drills.length);

    masters.forEach(function (m, i) {
      REQUIRED_MASTER_FIELDS.forEach(function (f) {
        if (!(f in m)) throw new Error('masters-repo: masters[' + i + '] missing field "' + f + '"');
      });
    });
    drills.forEach(function (d, i) {
      REQUIRED_DRILL_FIELDS.forEach(function (f) {
        if (!(f in d)) throw new Error('masters-repo: drills[' + i + '] missing field "' + f + '"');
      });
    });

    var mastersById = {};
    masters.forEach(function (m) {
      if (Object.prototype.hasOwnProperty.call(mastersById, m.master_id)) {
        throw new Error('masters-repo: duplicate master_id "' + m.master_id + '"');
      }
      mastersById[m.master_id] = m;
    });

    var drillsById = {};
    drills.forEach(function (d) {
      if (Object.prototype.hasOwnProperty.call(drillsById, d.source_drill_id)) {
        throw new Error('masters-repo: duplicate source_drill_id "' + d.source_drill_id + '"');
      }
      drillsById[d.source_drill_id] = d;
    });

    // 每个 drill 恰好属于一个 master；无遗漏、无多余、无重复归属
    var ownerOf = {};
    masters.forEach(function (m) {
      m.source_drill_ids.forEach(function (did) {
        if (Object.prototype.hasOwnProperty.call(ownerOf, did)) {
          throw new Error('masters-repo: drill "' + did + '" claimed by multiple masters ("' + ownerOf[did] + '", "' + m.master_id + '")');
        }
        ownerOf[did] = m.master_id;
        if (!Object.prototype.hasOwnProperty.call(drillsById, did)) {
          throw new Error('masters-repo: master "' + m.master_id + '" references unknown drill "' + did + '"');
        }
      });
    });
    drills.forEach(function (d) {
      if (!Object.prototype.hasOwnProperty.call(ownerOf, d.source_drill_id)) {
        throw new Error('masters-repo: drill "' + d.source_drill_id + '" is not mapped to any master');
      }
    });

    // 冻结：加载后任何运行时代码都无法静默修改源内容
    deepFreeze(masters);
    deepFreeze(drills);

    var drillIdsByMaster = {};
    masters.forEach(function (m) { drillIdsByMaster[m.master_id] = m.source_drill_ids.slice(); });

    function getMaster(master_id) {
      return Object.prototype.hasOwnProperty.call(mastersById, master_id) ? mastersById[master_id] : null;
    }
    function getDrill(source_drill_id) {
      return Object.prototype.hasOwnProperty.call(drillsById, source_drill_id) ? drillsById[source_drill_id] : null;
    }
    function getDrillsByMaster(master_id) {
      var ids = drillIdsByMaster[master_id];
      if (!ids) return [];
      return ids.map(function (id) { return drillsById[id]; });
    }
    function listMasters() { return masters.slice(); }
    function listDrills() { return drills.slice(); }

    return {
      getMaster: getMaster,
      getDrill: getDrill,
      getDrillsByMaster: getDrillsByMaster,
      listMasters: listMasters,
      listDrills: listDrills,
      masterCount: masters.length,
      drillCount: drills.length
    };
  }

  // 浏览器便捷入口：fetch + buildIndex。S0 不在 index.html 中接入本文件。
  function load(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('masters-repo: failed to load ' + url + ' → HTTP ' + r.status);
      return r.json();
    }).then(buildIndex);
  }

  return { buildIndex: buildIndex, load: load };
});
