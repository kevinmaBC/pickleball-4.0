/* ============================================================
 * preview.js — Pickleball App 2.0 Alpha · S3-B 就绪度预览 Readiness Preview
 * 只读：按评估的“目标等级”逐条对照 V2.3.1 硬门槛(level_gates)，显示
 *   当前% / 门槛 / 达标·边缘·未达 / 样本是否达最低要求。
 * 缺项（UE、match_transfer 等 T10 家族）一律标“未采集·待T10”，绝不臆测。
 * 严格边界：不给整体 Pass/Fail、不给综合能力分、不给 validated level、不给连续小数。
 *          明确标注“非官方评级 NOT an official rating”。
 * 门槛数值从 data/level_gates_v2_3_1.json 读取；本模块只“比对显示”，不改写等级。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBPreview = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 门槛指标键 → 我们已采集的测试（T01–T09）。不在表中的键=尚未采集（多属 T10 实战家族）
  var METRIC_TO_TEST = {
    serve_in_pct: 'T01', return_quality_pct: 'T02', drive_ball_quality_pct: 'T03',
    drop_ball_quality_pct: 'T04', reset_ball_quality_pct: 'T05', dink_unattackable_pct: 'T06',
    volley_control_pct: 'T07', shot_selection_pct: 'T08', pressure_success_pct: 'T09'
  };
  var BORDER = 5; // 边缘带 ±5（与 V2.3.1 borderline 口径一致）

  var _gates = null;
  function load(base) {
    if (_gates) return Promise.resolve(_gates);
    base = base || './data/';
    return fetch(base + 'level_gates_v2_3_1.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('门槛表加载失败 HTTP ' + r.status);
      return r.json();
    }).then(function (g) { _gates = g; return g; });
  }

  function minReqOf(gate) {
    return gate.min_trials || gate.min_scenarios || gate.min_rallies || gate.min_opportunities || null;
  }

  // 单条门槛比对（纯函数，便于测试）
  function evalGate(gateKey, gate, perTest) {
    var thr = gate.threshold, isMax = /_max$/.test(gateKey);
    var baseKey = isMax ? gateKey.replace(/_max$/, '') : gateKey;
    var tid = METRIC_TO_TEST[baseKey];
    var row = { key: gateKey, threshold: thr, direction: isMax ? 'max' : 'min', test_id: tid || null };
    if (!tid) { row.status = 'not_captured'; return row; }          // 归属 T10 等，未采集
    var m = perTest[tid];
    if (!m || m.quality_pct == null) { row.status = 'no_data'; row.n_valid = m ? m.n_valid : 0; return row; }
    var cur = m.quality_pct; row.current = cur; row.n_valid = m.n_valid;
    var minReq = minReqOf(gate); row.min_required = minReq;
    row.sample_ok = (minReq == null) ? true : (m.n_valid >= minReq);
    if (isMax) {
      row.status = (cur <= thr) ? 'met' : ((cur <= thr + BORDER) ? 'borderline' : 'not_met');
    } else {
      row.status = (cur >= thr) ? 'met' : ((cur >= thr - BORDER) ? 'borderline' : 'not_met');
    }
    return row;
  }

  function forAssessment(assessment_id) {
    var target = null, tier = null;
    return Promise.all([load(), PBStore.get('assessments', assessment_id)]).then(function (r) {
      var a = r[1];
      if (!a) throw new Error('assessment not found');
      tier = a.assessment_tier;
      target = a.target_training_level.toFixed(1);
      return PBMetrics.computeAssessment(assessment_id);
    }).then(function (M) {
      var levelCfg = _gates.levels[target];
      if (!levelCfg) return { target: target, unsupported: true, rows: [] };
      var perTest = M.per_test || {};
      var rows = Object.keys(levelCfg.hard_gates).map(function (k) {
        return evalGate(k, levelCfg.hard_gates[k], perTest);
      });
      // 实战验证（若该级要求）：match_transfer_score —— 未采集(T10)
      if (levelCfg.match_validation && levelCfg.match_validation.required) {
        rows.push({ key: 'match_transfer_score', threshold: levelCfg.match_validation.min_match_transfer_score,
                    direction: 'min', test_id: null, status: 'not_captured' });
      }
      var tally = { total: rows.length, met: 0, borderline: 0, not_met: 0, no_data: 0, not_captured: 0, sample_short: 0 };
      rows.forEach(function (x) { tally[x.status] = (tally[x.status] || 0) + 1; if (x.status !== 'not_captured' && x.sample_ok === false) tally.sample_short++; });
      return {
        target: target, tier: tier, rows: rows, tally: tally,
        capability_min: levelCfg.capability_min, evidence_min: levelCfg.evidence_min,
        official: false,
        note: 'Readiness preview only — NOT an official rating. No overall pass/fail, no capability score, no validated level. Missing inputs (UE / match_transfer) belong to T10.'
      };
    });
  }

  return { load: load, evalGate: evalGate, forAssessment: forAssessment, METRIC_TO_TEST: METRIC_TO_TEST };
});
