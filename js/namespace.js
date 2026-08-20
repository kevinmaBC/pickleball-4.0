/* ============================================================
 * namespace.js — Pickleball App 2.0 Alpha · S7-A 规范命名空间兼容层
 * 官方规范 ID：ASMT-01..ASMT-10；既有 T01..T10 视为 Legacy Alias。
 * 原则：读旧(T01..T10) → 归一为规范(ASMT-01..10)；新 S7 记录一律写规范 ID。
 * 纯函数、无副作用、不接触 IndexedDB/localStorage，便于独立测试。
 * 不重设计既有 S1–S6 的 T01..T10 ID 处理方式（仅新增兼容映射）。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBNamespace = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var LEGACY_TO_CANONICAL = {
    T01: 'ASMT-01',
    T02: 'ASMT-02',
    T03: 'ASMT-03',
    T04: 'ASMT-04',
    T05: 'ASMT-05',
    T06: 'ASMT-06',
    T07: 'ASMT-07',
    T08: 'ASMT-08',
    T09: 'ASMT-09',
    T10: 'ASMT-10'
  };

  var CANONICAL_TO_LEGACY = {};
  var LEGACY_IDS = Object.keys(LEGACY_TO_CANONICAL);
  LEGACY_IDS.forEach(function (legacy) {
    CANONICAL_TO_LEGACY[LEGACY_TO_CANONICAL[legacy]] = legacy;
  });
  var CANONICAL_IDS = LEGACY_IDS.map(function (legacy) { return LEGACY_TO_CANONICAL[legacy]; });

  function isLegacy(id) { return LEGACY_IDS.indexOf(id) !== -1; }
  function isCanonical(id) { return CANONICAL_IDS.indexOf(id) !== -1; }

  // S9-A：Match Capture 测试 ID（full T10 / ASMT-10）——标记哪个规范 ID 属于
  // Match Observation（真实比赛采集），不新增第二套命名空间，不改变别名解析本身；
  // 仅供 storage 层识别 test_sessions 记录是否为 Match Observation Session。
  var MATCH_CAPTURE_IDS = ['ASMT-10'];
  function isMatchCapture(id) {
    var canon = toCanonical(id);
    return canon != null && MATCH_CAPTURE_IDS.indexOf(canon) !== -1;
  }

  // 归一化为规范 ID：已是规范 ID 原样返回；Legacy Alias 映射；未知 ID 一律 null（绝不猜测）
  function toCanonical(id) {
    if (isCanonical(id)) return id;
    if (isLegacy(id)) return LEGACY_TO_CANONICAL[id];
    return null;
  }

  // 反向映射为 Legacy Alias（仅用于兼容展示/旧逻辑对接），未知 ID 一律 null
  function toLegacy(id) {
    if (isLegacy(id)) return id;
    if (isCanonical(id)) return CANONICAL_TO_LEGACY[id];
    return null;
  }

  return {
    LEGACY_TO_CANONICAL: LEGACY_TO_CANONICAL,
    CANONICAL_TO_LEGACY: CANONICAL_TO_LEGACY,
    CANONICAL_IDS: CANONICAL_IDS.slice(),
    LEGACY_IDS: LEGACY_IDS.slice(),
    isLegacy: isLegacy,
    isCanonical: isCanonical,
    toCanonical: toCanonical,
    toLegacy: toLegacy,
    MATCH_CAPTURE_IDS: MATCH_CAPTURE_IDS.slice(),
    isMatchCapture: isMatchCapture
  };
});
