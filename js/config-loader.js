/* ============================================================
 * config-loader.js — Pickleball App 2.0 Alpha · V2.3.1 配置加载器
 * 只加载 S1 所需的三类基线数据：版本号 / 测试定义 / 评估层级(tiers)。
 * 严格不加载、不计算：Gate Engine / Capability / Validated Level / Prescription。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 版本基线（硬编码为唯一真值，与 /data/versions.json 一致，加载后做一致性校验）
  var VERSIONS = { schema_version: '2.3.1', benchmark_version: '2.1.1', protocol_version: '2.2.1' };

  // 本 Sprint 范围内的测试：T01–T07（T08 决策 / T09 抗压 / T10 视频 禁止开发）
  var S1_TEST_IDS = ['T01', 'T02', 'T03', 'T04', 'T05', 'T06', 'T07'];
  var FEED_MODES = ['machine', 'calibrated_human', 'partner', 'live_match'];
  var TIER_IDS = ['lite', 'standard', 'full'];

  var _state = { loaded: false, versions: VERSIONS, tiers: null, tests: {}, testIds: S1_TEST_IDS,
                 feedModes: FEED_MODES, tierIds: TIER_IDS, raw: {} };

  function _fetchJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('加载失败 ' + url + ' → HTTP ' + r.status);
      return r.json();
    });
  }

  // partial(P) 是否允许：以测试的 outcome_weights 是否显式含 "P" 为准（与 V2.3.1 策略一致）
  function _partialAllowed(testObj) {
    return !!(testObj && testObj.outcome_weights && Object.prototype.hasOwnProperty.call(testObj.outcome_weights, 'P'));
  }

  function load(base) {
    if (_state.loaded) return Promise.resolve(_state);
    base = base || './data/';
    return Promise.all([
      _fetchJSON(base + 'versions.json'),
      _fetchJSON(base + 'test_definitions_v2_3_1.json'),
      _fetchJSON(base + 'assessment_tiers_v2_3_1.json')
    ]).then(function (res) {
      var ver = res[0], td = res[1], tiers = res[2];

      // 一致性校验：文件版本必须与硬编码基线相符，避免用错 schema
      ['schema_version', 'benchmark_version', 'protocol_version'].forEach(function (k) {
        if (ver[k] !== VERSIONS[k]) throw new Error('版本不一致 ' + k + ': ' + ver[k] + ' ≠ ' + VERSIONS[k]);
      });
      if (td.schema_version !== VERSIONS.schema_version) throw new Error('test_definitions schema_version 不匹配');

      _state.versions = { schema_version: ver.schema_version, benchmark_version: ver.benchmark_version, protocol_version: ver.protocol_version };
      _state.tiers = tiers.tiers || tiers;
      _state.raw = { test_definitions: td, tiers: tiers };

      var tests = {};
      S1_TEST_IDS.forEach(function (tid) {
        var t = td.tests && td.tests[tid];
        if (!t) return;
        tests[tid] = {
          id: tid,
          name: t.name,
          category: t.category,
          sample_plan: t.sample_plan,
          outcome_weights: t.outcome_weights,
          partial_allowed: _partialAllowed(t),
          required_trial_fields: t.required_trial_fields || []
        };
      });
      _state.tests = tests;
      _state.loaded = true;
      return _state;
    });
  }

  function scoreWeight(testId, outcome) {
    var t = _state.tests[testId];
    if (!t || !t.outcome_weights) return null;
    var w = t.outcome_weights[outcome];
    return (w === undefined ? null : w); // I -> null
  }
  function partialAllowed(testId) {
    var t = _state.tests[testId];
    return t ? !!t.partial_allowed : false;
  }
  function outcomesFor(testId) {
    return partialAllowed(testId) ? ['S', 'P', 'F', 'I'] : ['S', 'F', 'I'];
  }
  function sampleTarget(testId, tier) {
    var t = _state.tests[testId];
    if (!t || !t.sample_plan) return null;
    var plan = t.sample_plan[tier];
    if (plan == null) return null;
    if (typeof plan === 'number') return plan;
    // T05 等按距离分桶：求和作为参考目标
    return Object.keys(plan).reduce(function (s, k) { return s + (plan[k] || 0); }, 0);
  }

  return {
    load: load,
    get versions() { return _state.versions; },
    get tiers() { return _state.tiers; },
    get tests() { return _state.tests; },
    get testIds() { return _state.testIds.slice(); },
    get feedModes() { return _state.feedModes.slice(); },
    get tierIds() { return _state.tierIds.slice(); },
    get loaded() { return _state.loaded; },
    scoreWeight: scoreWeight, partialAllowed: partialAllowed,
    outcomesFor: outcomesFor, sampleTarget: sampleTarget
  };
});
