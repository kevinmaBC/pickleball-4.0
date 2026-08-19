/* ============================================================
 * retest-engine.js — Pickleball App 2.0 Alpha · S7-D Prescription + Re-test Linkage
 * 把纵向链路串起来：Review Snapshot → Primary Bottleneck → Prescription →
 * Re-test → Response。只做"链接 + 判定既有证据是否显示应答"，
 * 不是新的训练理论引擎，不发明处方内容，不重算历史快照。
 * 独立于 UI：只读/写 PBStore 既有 review_snapshots / prescriptions / retests
 * 三个 S7-A 存储（沿用其 data 字段承载 S7-D 专属内容，不改 IndexedDB 结构、
 * 不新增 store、不新增 index，向后兼容）；复用 PBTrend 的门槛状态迁移与
 * 数值分级纯函数，不重复实现 S7-B/S7-C 已有的算法。
 *
 * 冻结方法论（详见任务书，禁止偏离）：
 *   - Validated Training Level 仍只能是 3.0/3.5/4.0/4.5/5.0，本模块不产出/
 *     不推导任何连续小数等级。
 *   - CAP 仍是 45% Technical + 30% Decision + 25% Pressure；Match Transfer
 *     永远是独立验证层，绝不并入 CAP，也绝不影响 CAP 数值。
 *   - Evidence 仍只用 C1-C4；证据不足一律 INCOMPLETE，绝不当 0。
 *   - Primary Bottleneck 优先级（Failed Hard Gate → Largest Deficit →
 *     Match Impact → Evidence → Trend → Diagnostic Root Cause）不在本模块
 *     重新推导或替换——本模块只读取 S7-B 已产出的 primary_bottleneck，
 *     并比较它在 baseline/retest 两份历史快照之间的既有证据。
 *   - 历史快照的门槛/阈值/状态一律按其自身生成时的取值使用，绝不用今天的
 *     门槛覆盖历史点。
 *   - PROMOTION_REVIEW_ELIGIBLE 绝不等于"已晋级"；晋级仍需 Capability 门槛
 *     + Evidence Confidence + Target Hard Gates + Match Validation 全部满足
 *     （直接读取既有 S7-B validation_state，不重新发明定级公式）。
 *   - 不引入 Internal DUPR / DUPR Gap、不做统一固定训练剂量、不做自动晋级。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBRetest = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PRESCRIPTION_STATUS = { ACTIVE: 'ACTIVE', COMPLETED: 'COMPLETED', SUPERSEDED: 'SUPERSEDED' };

  var RESPONSE_STATES = ['POSITIVE_RESPONSE', 'PARTIAL_RESPONSE', 'NO_MEANINGFUL_CHANGE', 'NEGATIVE_RESPONSE', 'INCOMPLETE'];
  var MATCH_TRANSFER_RESPONSE_STATES = ['CONFIRMED', 'IMPROVING_NOT_CONFIRMED', 'NOT_CONFIRMED', 'REGRESSED', 'INCOMPLETE'];
  var EFFECTIVENESS_STATES = ['EFFECTIVE', 'PARTIALLY_EFFECTIVE', 'NOT_EFFECTIVE', 'POSSIBLE_REGRESSION', 'INCOMPLETE'];
  var REASSESSMENT_SIGNALS = ['NOT_READY', 'RETEST_RECOMMENDED', 'PROMOTION_REVIEW_ELIGIBLE', 'INCOMPLETE'];

  var NUMERIC_BAND = 5; // 0-100 类指标的分级带宽，与 S7-C 一致
  var EVIDENCE_RANK = { C1: 1, C2: 2, C3: 3, C4: 4 };

  function trend() {
    if (typeof PBTrend === 'undefined') throw new Error('PBTrend not loaded');
    return PBTrend;
  }

  function findGate(snapshot, metricKey) {
    return ((snapshot && snapshot.hard_gates) || []).filter(function (g) { return g.metric === metricKey; })[0] || null;
  }

  // 数值方向：ue_per_game_max 是个位数绝对量，不适用 0-100 的 ±5 带宽（与 S7-C 一致约定）
  function bandForMetric(metricKey) { return (metricKey === 'ue_per_game_max') ? 0 : NUMERIC_BAND; }

  // ---- 针对单个硬门槛型 Primary Bottleneck（'hard_gate:<metric>'）的应答判定 ----
  // 优先用 PBTrend.classifyGateTransition 得到的正式状态迁移（不重新发明门槛迁移逻辑）；
  // 若正式状态未变（UNCHANGED），退回比较该门槛底层数值的方向性变化。
  function classifyGateBottleneckResponse(metricKey, baseline, retest) {
    var bGate = findGate(baseline, metricKey), rGate = findGate(retest, metricKey);
    if (!bGate || !rGate) return { response_state: 'INCOMPLETE', reason: 'missing_gate_evidence', metric: metricKey };

    var transition = trend().classifyGateTransition(
      { formal_status: bGate.status, performance_state: bGate.performance_state },
      { formal_status: rGate.status, performance_state: rGate.performance_state }
    );
    var base = { metric: metricKey, previous_status: bGate.status, current_status: rGate.status };

    if (transition === 'PROGRESSED' || transition === 'EVIDENCE_COMPLETED') {
      return Object.assign({ response_state: 'POSITIVE_RESPONSE', reason: transition }, base);
    }
    if (transition === 'REGRESSED') {
      return Object.assign({ response_state: 'NEGATIVE_RESPONSE', reason: transition }, base);
    }
    if (transition === 'INCOMPLETE') {
      return Object.assign({ response_state: 'INCOMPLETE', reason: 'gate_transition_incomplete' }, base);
    }

    // UNCHANGED 正式状态：不代表数值一定没变（例如仍是 NOT_MET 但差距在缩小），
    // 退回用底层数值的方向性变化做 PARTIAL/NO_MEANINGFUL/NEGATIVE 三分。
    var direction = (rGate.direction === 'max') ? 'lower' : 'higher';
    var normDelta = trend().computeNormalizedDelta(bGate.current_value, rGate.current_value, direction);
    var numTrend = trend().classifyTrend(normDelta, bandForMetric(metricKey));
    if (numTrend === 'IMPROVING') return Object.assign({ response_state: 'PARTIAL_RESPONSE', reason: 'numeric_improved_same_status' }, base);
    if (numTrend === 'DECLINING') return Object.assign({ response_state: 'NEGATIVE_RESPONSE', reason: 'numeric_worsened_same_status' }, base);
    if (numTrend === 'STABLE') return Object.assign({ response_state: 'NO_MEANINGFUL_CHANGE', reason: 'stable' }, base);
    return Object.assign({ response_state: 'INCOMPLETE', reason: 'missing_numeric_value' }, base);
  }

  // ---- Primary Bottleneck = 'capability_threshold' 的应答判定 ----
  function classifyCapabilityBottleneckResponse(baseline, retest) {
    var bState = baseline.capability_threshold_state, rState = retest.capability_threshold_state;
    if (bState === 'NOT_MET' && rState === 'MET') return { response_state: 'POSITIVE_RESPONSE', reason: 'capability_threshold_progressed' };
    if (bState === 'MET' && rState === 'NOT_MET') return { response_state: 'NEGATIVE_RESPONSE', reason: 'capability_threshold_regressed' };
    if (bState === rState && (bState === 'MET' || bState === 'NOT_MET')) {
      var normDelta = trend().computeNormalizedDelta(baseline.capability_score, retest.capability_score, 'higher');
      var t = trend().classifyTrend(normDelta, NUMERIC_BAND);
      if (t === 'IMPROVING') return { response_state: 'PARTIAL_RESPONSE', reason: 'capability_score_improved' };
      if (t === 'DECLINING') return { response_state: 'NEGATIVE_RESPONSE', reason: 'capability_score_declined' };
      if (t === 'STABLE') return { response_state: 'NO_MEANINGFUL_CHANGE', reason: 'capability_score_stable' };
    }
    return { response_state: 'INCOMPLETE', reason: 'capability_threshold_incomplete' };
  }

  // ---- Primary Bottleneck = 'match_validation' 的应答判定（核心 response_state 专用；
  // match_transfer_response 字段无论 primary_bottleneck 是什么都会独立计算，见下方）----
  function classifyMatchValidationBottleneckResponse(baseline, retest) {
    var bState = baseline.match_validation_state, rState = retest.match_validation_state;
    if (bState === 'NOT_MET' && rState === 'MET') return { response_state: 'POSITIVE_RESPONSE', reason: 'match_validation_progressed' };
    if (bState === 'MET' && rState === 'NOT_MET') return { response_state: 'NEGATIVE_RESPONSE', reason: 'match_validation_regressed' };
    if (bState === rState && (bState === 'MET' || bState === 'NOT_MET')) {
      var normDelta = trend().computeNormalizedDelta(baseline.match_transfer_score, retest.match_transfer_score, 'higher');
      var t = trend().classifyTrend(normDelta, NUMERIC_BAND);
      if (t === 'IMPROVING') return { response_state: 'PARTIAL_RESPONSE', reason: 'match_transfer_score_improved' };
      if (t === 'DECLINING') return { response_state: 'NEGATIVE_RESPONSE', reason: 'match_transfer_score_declined' };
      if (t === 'STABLE') return { response_state: 'NO_MEANINGFUL_CHANGE', reason: 'match_transfer_stable' };
    }
    return { response_state: 'INCOMPLETE', reason: 'match_validation_incomplete' };
  }

  // ---- Primary Bottleneck = 'evidence' 的应答判定（C1-C4 等级比较，不存在 C0/连续值）----
  function classifyEvidenceBottleneckResponse(baseline, retest) {
    if (baseline.evidence_state !== 'DETERMINED' || retest.evidence_state !== 'DETERMINED') {
      return { response_state: 'INCOMPLETE', reason: 'evidence_state_not_determined' };
    }
    var bR = EVIDENCE_RANK[baseline.evidence_confidence], rR = EVIDENCE_RANK[retest.evidence_confidence];
    if (bR == null || rR == null) return { response_state: 'INCOMPLETE', reason: 'unrecognized_evidence_confidence' };
    if (rR > bR) return { response_state: 'POSITIVE_RESPONSE', reason: 'evidence_confidence_increased' };
    if (rR < bR) return { response_state: 'NEGATIVE_RESPONSE', reason: 'evidence_confidence_decreased' };
    return { response_state: 'NO_MEANINGFUL_CHANGE', reason: 'evidence_confidence_unchanged' };
  }

  // ---- 分发：按 Primary Bottleneck 的类型选用对应的判定器（不重新推导瓶颈优先级本身）----
  function classifyBottleneckResponse(primaryBottleneck, baseline, retest) {
    if (!primaryBottleneck) return { response_state: 'INCOMPLETE', reason: 'no_prescribed_bottleneck' };
    if (!baseline || !retest) return { response_state: 'INCOMPLETE', reason: 'missing_snapshot' };

    if (primaryBottleneck.indexOf('hard_gate:') === 0) {
      return classifyGateBottleneckResponse(primaryBottleneck.slice('hard_gate:'.length), baseline, retest);
    }
    if (primaryBottleneck === 'capability_threshold') return classifyCapabilityBottleneckResponse(baseline, retest);
    if (primaryBottleneck === 'match_validation') return classifyMatchValidationBottleneckResponse(baseline, retest);
    if (primaryBottleneck === 'evidence') return classifyEvidenceBottleneckResponse(baseline, retest);
    return { response_state: 'INCOMPLETE', reason: 'unrecognized_bottleneck_type' };
  }

  // ---- Match Transfer 应答：独立轨道，永远单独计算，绝不并入/替代核心 response_state，
  // 也绝不反向影响 CAP（本函数只读 match_transfer_score / match_validation_*，不碰 capability_score）----
  function classifyMatchTransferResponse(baseline, retest) {
    var rScore = (retest.match_transfer_score == null) ? null : retest.match_transfer_score;
    var bScore = (baseline.match_transfer_score == null) ? null : baseline.match_transfer_score;
    if (rScore == null) return 'INCOMPLETE';

    if (retest.match_validation_required) {
      if (retest.match_validation_state === 'MET') return 'CONFIRMED';
      if (retest.match_validation_state === 'NOT_MET') {
        if (bScore == null) return 'NOT_CONFIRMED';
        var t1 = trend().classifyTrend(trend().computeNormalizedDelta(bScore, rScore, 'higher'), NUMERIC_BAND);
        if (t1 === 'IMPROVING') return 'IMPROVING_NOT_CONFIRMED';
        if (t1 === 'DECLINING') return 'REGRESSED';
        return 'NOT_CONFIRMED';
      }
      return 'INCOMPLETE'; // retest.match_validation_state === 'INCOMPLETE'
    }

    // 该目标等级未强制要求 Match Validation，仍可给出方向性参考（不作为"已确认"）
    if (bScore == null) return 'INCOMPLETE';
    var t2 = trend().classifyTrend(trend().computeNormalizedDelta(bScore, rScore, 'higher'), NUMERIC_BAND);
    if (t2 === 'IMPROVING') return 'IMPROVING_NOT_CONFIRMED';
    if (t2 === 'DECLINING') return 'REGRESSED';
    return 'NOT_CONFIRMED';
  }

  // ---- 汇总一次 Re-test 的完整判定结果（纯函数：只读两份快照内容，不落库、不发网络请求）----
  function evaluateRetest(input) {
    var baseline = input && input.baseline, retest = input && input.retest, primaryBottleneck = input && input.primaryBottleneck;
    if (!baseline || !retest) {
      return {
        response_state: 'INCOMPLETE', response_reason: 'missing_snapshot', bottleneck: primaryBottleneck || null,
        bottleneck_metric: null, previous_status: null, current_status: null, match_transfer_response: 'INCOMPLETE'
      };
    }
    var core = classifyBottleneckResponse(primaryBottleneck, baseline, retest);
    return {
      response_state: core.response_state,
      response_reason: core.reason,
      bottleneck: primaryBottleneck || null,
      bottleneck_metric: core.metric || null,
      previous_status: core.previous_status || null,
      current_status: core.current_status || null,
      match_transfer_response: classifyMatchTransferResponse(baseline, retest)
    };
  }

  // ---- Prescription Effectiveness：response_state 的解读层，不是新的数值分数 ----
  var EFFECTIVENESS_MAP = {
    POSITIVE_RESPONSE: 'EFFECTIVE',
    PARTIAL_RESPONSE: 'PARTIALLY_EFFECTIVE',
    NO_MEANINGFUL_CHANGE: 'NOT_EFFECTIVE',
    NEGATIVE_RESPONSE: 'POSSIBLE_REGRESSION',
    INCOMPLETE: 'INCOMPLETE'
  };
  function mapResponseToEffectiveness(responseState) { return EFFECTIVENESS_MAP[responseState] || 'INCOMPLETE'; }

  // ---- 多次 Re-test 汇总：保留完整时间顺序历史，不覆盖旧结果 ----
  function summarizePrescriptionResponses(retestRecords) {
    var sorted = (retestRecords || []).slice().sort(function (a, b) {
      var da = (a.data && a.data.retest_date) || a.created_at || '';
      var db = (b.data && b.data.retest_date) || b.created_at || '';
      return da < db ? -1 : (da > db ? 1 : 0);
    });
    var history = sorted.map(function (r) {
      var d = r.data || {};
      return {
        retest_id: r.retest_id,
        retest_date: d.retest_date || null,
        response_state: d.response_state || 'INCOMPLETE',
        match_transfer_response: d.match_transfer_response || 'INCOMPLETE'
      };
    });
    var latest = history.length ? history[history.length - 1] : null;
    return {
      retest_count: history.length,
      latest_response: latest ? latest.response_state : 'INCOMPLETE',
      response_history: history,
      prescription_effectiveness: latest ? mapResponseToEffectiveness(latest.response_state) : 'INCOMPLETE'
    };
  }

  // ---- 保守的复测/晋级复核信号：只读既有 S7-B validation_state，不重新发明定级公式 ----
  function determineReassessmentSignal(validationState, latestResponseState) {
    if (validationState === 'VALIDATION_ELIGIBLE') return 'PROMOTION_REVIEW_ELIGIBLE';
    if (validationState === 'NOT_ELIGIBLE') {
      if (latestResponseState === 'POSITIVE_RESPONSE' || latestResponseState === 'PARTIAL_RESPONSE') return 'RETEST_RECOMMENDED';
      return 'NOT_READY';
    }
    return 'INCOMPLETE';
  }

  // ================= 以下为异步编排：读写 PBStore 既有三个 S7-A 存储 =================

  // ---- 签发 Prescription：链接到触发它的 Review Snapshot / Assessment / Player ----
  function issuePrescription(opts) {
    if (typeof PBStore === 'undefined') throw new Error('PBStore not loaded');
    opts = opts || {};
    var data = {
      player_id: opts.player_id || null,
      source_assessment_id: opts.source_assessment_id || null,
      source_review_snapshot_id: opts.source_review_snapshot_id || null,
      target_level: (opts.target_level == null ? null : opts.target_level),
      primary_bottleneck: (opts.primary_bottleneck === undefined ? null : opts.primary_bottleneck),
      status: opts.status || PRESCRIPTION_STATUS.ACTIVE,
      notes: opts.notes || null
    };
    return PBStore.createPrescription({ assessment_id: opts.source_assessment_id || null, data: data });
  }

  // 便捷封装：直接从一条已持久化的 review_snapshots 记录派生 Prescription 的关联字段
  // （primary_bottleneck / target_level 等直接取自该记录，不重新计算）
  function issuePrescriptionFromSnapshot(reviewSnapshotRecord, opts) {
    var snap = (reviewSnapshotRecord && reviewSnapshotRecord.data) || {};
    var merged = {
      player_id: snap.player_id,
      source_assessment_id: snap.assessment_id,
      source_review_snapshot_id: reviewSnapshotRecord ? reviewSnapshotRecord.review_snapshot_id : null,
      target_level: snap.target_training_level,
      primary_bottleneck: snap.primary_bottleneck
    };
    var o = opts || {};
    Object.keys(o).forEach(function (k) { merged[k] = o[k]; });
    return issuePrescription(merged);
  }

  function updatePrescriptionStatus(prescription_id, status) {
    if (typeof PBStore === 'undefined') throw new Error('PBStore not loaded');
    return PBStore.get('prescriptions', prescription_id).then(function (rec) {
      if (!rec) throw new Error('prescription not found: ' + prescription_id);
      var data = Object.assign({}, rec.data || {}, { status: status });
      var updated = Object.assign({}, rec, { data: data });
      return PBStore.put('prescriptions', updated);
    });
  }

  // ---- 记录一次 Re-test：读取 baseline / retest 两份已持久化 Review Snapshot（历史值原样使用，
  // 绝不用当下门槛重算），判定应答，并落库到 retests 存储 ----
  function recordRetest(opts) {
    if (typeof PBStore === 'undefined') throw new Error('PBStore not loaded');
    opts = opts || {};
    return Promise.all([
      opts.baseline_review_snapshot_id ? PBStore.get('review_snapshots', opts.baseline_review_snapshot_id) : Promise.resolve(null),
      opts.retest_review_snapshot_id ? PBStore.get('review_snapshots', opts.retest_review_snapshot_id) : Promise.resolve(null),
      opts.prescription_id ? PBStore.get('prescriptions', opts.prescription_id) : Promise.resolve(null)
    ]).then(function (r) {
      var baselineRec = r[0], retestRec = r[1], prescriptionRec = r[2];
      var primaryBottleneck = (opts.primary_bottleneck !== undefined) ? opts.primary_bottleneck :
        ((prescriptionRec && prescriptionRec.data && prescriptionRec.data.primary_bottleneck) || null);

      var evalResult = (baselineRec && retestRec)
        ? evaluateRetest({ baseline: baselineRec.data || {}, retest: retestRec.data || {}, primaryBottleneck: primaryBottleneck })
        : { response_state: 'INCOMPLETE', response_reason: 'missing_snapshot', bottleneck: primaryBottleneck || null, bottleneck_metric: null, previous_status: null, current_status: null, match_transfer_response: 'INCOMPLETE' };

      var data = Object.assign({
        player_id: opts.player_id || null,
        baseline_review_snapshot_id: opts.baseline_review_snapshot_id || null,
        retest_review_snapshot_id: opts.retest_review_snapshot_id || null,
        baseline_assessment_id: opts.baseline_assessment_id || null,
        retest_assessment_id: opts.retest_assessment_id || null,
        retest_date: opts.retest_date || null
      }, evalResult);

      return PBStore.createRetest({
        assessment_id: opts.retest_assessment_id || null,
        prescription_id: opts.prescription_id || null,
        data: data
      });
    });
  }

  // ---- 某个 Prescription 的完整 Re-test 历史与应答汇总 ----
  function getPrescriptionRetestSummary(prescription_id) {
    if (typeof PBStore === 'undefined') throw new Error('PBStore not loaded');
    return PBStore.getAll('retests').then(function (all) {
      var mine = (all || []).filter(function (r) { return r.prescription_id === prescription_id; });
      return summarizePrescriptionResponses(mine);
    });
  }

  // ---- 一名 Player 的所有 Prescription（跨其所有 Assessment 聚合，沿用既有 by_assessment 索引，
  // 不新增 by_player 索引/不升级 DB_VERSION）----
  function prescriptionsForPlayer(player_id) {
    if (typeof PBStore === 'undefined') throw new Error('PBStore not loaded');
    return PBStore.assessmentsByPlayer(player_id).then(function (assessments) {
      return Promise.all((assessments || []).map(function (a) { return PBStore.prescriptionsByAssessment(a.assessment_id); }))
        .then(function (arrs) { return arrs.reduce(function (acc, arr) { return acc.concat(arr || []); }, []); });
    });
  }

  // ---- 一名 Player 最新的规范 Review Snapshot（复用 PBTrend 的去重逻辑，不重复实现）----
  function getLatestReviewSnapshotForPlayer(player_id) {
    if (typeof PBStore === 'undefined') throw new Error('PBStore not loaded');
    return PBStore.assessmentsByPlayer(player_id).then(function (assessments) {
      return Promise.all((assessments || []).map(function (a) { return PBStore.reviewSnapshotsByAssessment(a.assessment_id); }))
        .then(function (arrs) {
          var all = arrs.reduce(function (acc, arr) { return acc.concat(arr || []); }, []);
          var canonical = trend().selectCanonicalSnapshots(all);
          canonical.sort(function (a, b) {
            var da = (a.data && a.data.assessment_date) || '';
            var db = (b.data && b.data.assessment_date) || '';
            return da < db ? -1 : (da > db ? 1 : 0);
          });
          return canonical.length ? canonical[canonical.length - 1] : null;
        });
    });
  }

  // ---- 保守复核信号（供未来 UI 使用；不是自动晋级）----
  function getReassessmentSignalForPlayer(player_id) {
    return getLatestReviewSnapshotForPlayer(player_id).then(function (rec) {
      if (!rec) return { signal: 'INCOMPLETE', latest_review_snapshot_id: null, validation_state: null };
      var snap = rec.data || {};
      return {
        signal: determineReassessmentSignal(snap.validation_state, null),
        latest_review_snapshot_id: rec.review_snapshot_id,
        validation_state: snap.validation_state || null
      };
    });
  }

  return {
    // 异步编排（依赖 PBStore + PBTrend）
    issuePrescription: issuePrescription,
    issuePrescriptionFromSnapshot: issuePrescriptionFromSnapshot,
    updatePrescriptionStatus: updatePrescriptionStatus,
    recordRetest: recordRetest,
    getPrescriptionRetestSummary: getPrescriptionRetestSummary,
    prescriptionsForPlayer: prescriptionsForPlayer,
    getLatestReviewSnapshotForPlayer: getLatestReviewSnapshotForPlayer,
    getReassessmentSignalForPlayer: getReassessmentSignalForPlayer,

    // 纯函数（可独立单测，无需 DB；依赖全局 PBTrend）
    evaluateRetest: evaluateRetest,
    classifyBottleneckResponse: classifyBottleneckResponse,
    classifyGateBottleneckResponse: classifyGateBottleneckResponse,
    classifyCapabilityBottleneckResponse: classifyCapabilityBottleneckResponse,
    classifyMatchValidationBottleneckResponse: classifyMatchValidationBottleneckResponse,
    classifyEvidenceBottleneckResponse: classifyEvidenceBottleneckResponse,
    classifyMatchTransferResponse: classifyMatchTransferResponse,
    mapResponseToEffectiveness: mapResponseToEffectiveness,
    summarizePrescriptionResponses: summarizePrescriptionResponses,
    determineReassessmentSignal: determineReassessmentSignal,

    // 冻结常量
    PRESCRIPTION_STATUS: PRESCRIPTION_STATUS,
    RESPONSE_STATES: RESPONSE_STATES.slice(),
    MATCH_TRANSFER_RESPONSE_STATES: MATCH_TRANSFER_RESPONSE_STATES.slice(),
    EFFECTIVENESS_STATES: EFFECTIVENESS_STATES.slice(),
    REASSESSMENT_SIGNALS: REASSESSMENT_SIGNALS.slice()
  };
});
