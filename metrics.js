/* ============================================================
 * metrics.js — Pickleball App 2.0 Alpha · S2-A 指标计算层 Metrics
 * 只做一件事：把逐 Trial 的原始 S/P/F/I，按 V2.3.1 公式算成
 *   每项测试的 ball-quality 主指标百分比（raw %）。
 * 公式（全项统一）：主指标% = 加权成功 / 有效试验 × 100
 *   加权成功 = Σ score_weight（S=1, P=0.5, F=0）；有效试验 = 排除 outcome=I。
 * 严格边界：不判级、不算综合能力分、不比门槛、不出 Pass/Fail、不碰 DUPR。
 * 其它类型指标（opponent_response / movement / decision 等）需额外采集，本轮不算，标注 not_captured。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBMetrics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 每项测试的“可由 S/P/F/I 直接算出的 ball-quality 主指标”键名（与 V2.3.1 test_definitions 对齐）
  var PRIMARY = {
    T01: 'serve_in_pct',
    T02: 'return_quality_pct',
    T03: 'drive_ball_quality_pct',
    T04: 'drop_ball_quality_pct',
    T05: 'reset_ball_quality_pct',
    T06: 'dink_unattackable_pct',
    T07: 'volley_control_pct',
    T08: 'shot_selection_pct',
    T09: 'pressure_success_pct'
  };

  function round1(x) { return Math.round(x * 10) / 10; }

  // 从一组 trial 计算主指标；I（score_weight=null）不计入分母
  function computeTrials(trials) {
    var counts = { S: 0, P: 0, F: 0, I: 0 };
    var sum = 0, nValid = 0;
    (trials || []).forEach(function (t) {
      if (counts[t.outcome] === undefined) counts[t.outcome] = 0;
      counts[t.outcome]++;
      if (t.score_weight != null) { sum += t.score_weight; nValid++; }
    });
    return {
      quality_pct: nValid ? round1(sum / nValid * 100) : null,
      n_valid: nValid,
      n_total: (trials || []).length,
      counts: counts
    };
  }

  // 汇总一次 Assessment 下每项测试的主指标 + 抽样完整度（跨该测试的所有 session 合并 trial）
  function computeAssessment(assessment_id) {
    if (typeof PBStore === 'undefined') return Promise.resolve({ per_test: {} });
    var tier = null, asm = null;
    return PBStore.get('assessments', assessment_id).then(function (a) {
      asm = a; tier = a ? a.assessment_tier : null;
      return PBStore.sessionsByAssessment(assessment_id);
    }).then(function (sessions) {
      var byTest = {};
      sessions.forEach(function (s) { (byTest[s.test_id] = byTest[s.test_id] || []).push(s.test_session_id); });
      var testIds = Object.keys(byTest);
      return Promise.all(testIds.map(function (tid) {
        return Promise.all(byTest[tid].map(function (sid) { return PBStore.trialsBySession(sid); }))
          .then(function (arrs) {
            var all = arrs.reduce(function (a, b) { return a.concat(b); }, []);
            var m = computeTrials(all);
            m.test_id = tid;
            m.metric_key = PRIMARY[tid] || (tid.toLowerCase() + '_ball_quality_pct');
            var target = (typeof PBConfig !== 'undefined' && tier) ? PBConfig.sampleTarget(tid, tier) : null;
            m.sample_target = target;
            m.sample_complete = (target != null) ? (m.n_valid >= target) : null;
            return m;
          });
      })).then(function (results) {
        var per_test = {};
        results.forEach(function (r) { per_test[r.test_id] = r; });
        // T10-lite：从评估记录读 UE 与转化验证分（简化，非逐拍编码）
        var match = null;
        if (asm && (asm.ue || asm.match_transfer)) {
          var ue = asm.ue || null, mt = asm.match_transfer || null;
          var games = ue && ue.games ? ue.games : 0;
          var ueTotal = (ue && ue.counts) ? Object.keys(ue.counts).reduce(function (s, k) { return s + (ue.counts[k] || 0); }, 0) : null;
          match = {
            games: games,
            ue_total: ueTotal,
            ue_per_game: (ueTotal != null && games > 0) ? round1(ueTotal / games) : null,
            match_transfer_score: (mt && mt.score != null) ? mt.score : null,
            match_transfer_source: 'simplified_self_or_coach_v1',
            note: 'ue_per_game = total_ue/games; match_transfer_score = mean of self/coach sub-scores (SIMPLIFIED, not rally-by-rally T10 coding)'
          };
        }
        return {
          generated_at: new Date().toISOString(),
          assessment_tier: tier,
          note: 'raw primary percentages + sampling completeness + simplified match inputs (T10-lite). No level judgment / no capability score / no gates. Full T10 rally-by-rally coding still deferred.',
          per_test: per_test,
          match: match
        };
      });
    });
  }

  function primaryKey(testId) { return PRIMARY[testId] || null; }

  return { computeTrials: computeTrials, computeAssessment: computeAssessment, primaryKey: primaryKey };
});
