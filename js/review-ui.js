/* ============================================================
 * review-ui.js — Pickleball App 2.0 Alpha · S7-E Review / Trend UI
 * 把 S7-A~D 已冻结的引擎输出（Review Snapshot / Trend / Prescription /
 * Re-test）拼成一个只读的"复盘 / 趋势"页面。
 * 严格边界：本文件不实现任何方法论——不重算 CAP/门槛/证据/瓶颈/趋势/
 * 处方/复测应答，只读取 PBReview / PBTrend / PBRetest 已产出的结果并展示。
 * 不因渲染页面而重新生成 Review Snapshot（只读 PBStore 既有数据）。
 * 纯格式化/取值函数与 DOM 挂载逻辑分离：前者可在 Node 下单测，
 * 后者只在浏览器环境运行（UMD 包装，module.exports 分支不触碰 DOM）。
 *
 * S10-B-R1：新增 Section 7"Recommendation / Training Focus"，把 S9
 * Diagnosis -> Recommendation Priority -> Training Prescription 链路
 * 经由 S10-B js/dashboard-integration-engine.js（PBDashboard）投影出的
 * Dashboard View Model 接到这个既有只读页面上。本文件依旧不实现任何
 * 判定/评分/处方逻辑——只调用既有 PBDiagnosis.diagnoseMatch /
 * PBRecommendationPriority.prioritizeDiagnosis /
 * PBTrainingPrescription.prescribeRecommendations（S9 既有公共
 * API，未新增/未复制其内部规则）取得结果，再交给 PBDashboard 投影，
 * 只读展示；找不到已持久化的 S10-A Workflow Cycle 时，工作流状态
 * 诚实显示为 UNRESOLVED（不臆造），而不是新增一个持久化存储来凑数据。
 * ============================================================ */
(function (root, factory) {
  var pure = factory();
  if (typeof module === 'object' && module.exports) { module.exports = pure; return; }
  root.PBReviewUI = pure;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pure._mount);
    else pure._mount();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VALIDATED_LEVELS = [3.0, 3.5, 4.0, 4.5, 5.0]; // 只读引用，本文件从不据此推导/写入等级

  // ---- 双语文案（与 assessment.js 相同的 LANG 分支约定，不引入新的 i18n 机制）----
  var MESSAGES = {
    reviewTitle: { en: 'Review / Trend', zh: '复盘 / 趋势 Review / Trend' },
    choosePlayer: { en: 'Choose a player', zh: '选择球员 Player' },
    noPlayer: { en: 'No player selected. Choose a player below.', zh: '尚未选择球员，请在下方选择。' },
    noHistory: { en: 'No assessment history. Create an assessment before Review & Trend is available.', zh: '无评估历史。请先创建一次评估，才能使用复盘 / 趋势。' },
    baselineOnly: { en: 'Baseline established. Trend requires additional assessment history.', zh: '已建立基线。趋势判定还需更多评估历史。' },
    directional: { en: 'Directional change available. Longitudinal trend confidence remains limited.', zh: '已有方向性变化。纵向趋势置信度仍有限。' },
    noPrescription: { en: 'No active prescription cycle.', zh: '当前没有进行中的处方周期。' },
    noRetest: { en: 'No linked re-test available.', zh: '暂无关联的复测记录。' },
    simplifiedEvidence: { en: 'Simplified / Provisional Evidence (not full rally-coded ASMT-10 data)', zh: '简化 / 临时证据 Simplified / Provisional Evidence（非完整逐拍编码 ASMT-10）' },
    promotionReviewNote: { en: 'Promotion Review Eligible. Review required before validated level change.', zh: '具备晋级复核资格。定级变更前仍须走既有复核流程，并非已晋级。' },
    versionMixedWarning: { en: 'This window mixes different methodology versions; interpret with care.', zh: '本窗口内混有不同方法论版本的快照，解读时请留意。' },
    section1: { en: '1 · Current Status', zh: '1 · 当前状态' },
    section2: { en: '2 · 4–6 Week Capability Trend', zh: '2 · 4–6 周能力趋势' },
    section3: { en: '3 · Match Transfer', zh: '3 · 实战转化 Match Transfer' },
    section4: { en: '4 · Hard-Gate Progress', zh: '4 · 硬门槛进展' },
    section5: { en: '5 · Bottleneck & Prescription', zh: '5 · 瓶颈与处方' },
    section6: { en: '6 · Re-test / Promotion Review', zh: '6 · 复测 / 晋级复核' },
    section7: { en: '7 · Recommendation / Training Focus', zh: '7 · 推荐 / 训练重点 Recommendation Focus' },
    noActiveRecommendation: { en: 'No active recommendation available', zh: '暂无有效推荐 No active recommendation available' },
    rankUnresolved: { en: 'Rank unresolved', zh: '排名未定 Rank unresolved' },
    prescriptionNotYet: { en: 'Recommendation available. Training prescription not yet available.', zh: '已有推荐，训练处方尚未生成。' },
    drillUnresolvedMsg: { en: 'Specific drill not yet resolved', zh: '具体训练项尚未确定 Specific drill not yet resolved' },
    kpiUnresolvedMsg: { en: 'KPI benchmark not yet resolved', zh: 'KPI 基准尚未确定 KPI benchmark not yet resolved' },
    reassessmentMsg: { en: 'New evidence available — reassessment required', zh: '有新证据 — 需要重新评估 New evidence available — reassessment required' },
    whyEvidenceLabel: { en: 'Why / Evidence', zh: '原因 / 证据 Why / Evidence' },
    findingsLabel: { en: 'Findings', zh: '依据 Findings' },
    evidencePatternsLabel: { en: 'Evidence patterns', zh: '证据模式 Evidence patterns' },
    trainingDirectionLabel: { en: 'Training Direction', zh: '训练方向 Training Direction' },
    noneLabel: { en: '(none)', zh: '（无）' },
    useThisPlanBtn: { en: 'Use This Training Plan', zh: '使用此训练计划 Use This Training Plan' },
    registrationPending: { en: 'Registering…', zh: '正在登记…' },
    registrationSuccess: { en: 'Training plan registered. Development cycle ready — go to Guided Training to begin.', zh: '训练计划已登记，发展周期已就绪——请前往"引导训练"开始。' },
    registrationAlready: { en: 'This training plan is already registered.', zh: '此训练计划此前已登记过。' },
    registrationErrorPrefix: { en: 'Registration failed: ', zh: '登记失败：' }
  };
  function t(key) {
    var m = MESSAGES[key];
    if (!m) return key;
    return (typeof LANG !== 'undefined' && LANG === 'en') ? m.en : m.zh;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ---- 状态徽章：kind 决定颜色语义(pos/warn/neg/neu/inc)，label 始终附带文字，绝不仅靠颜色 ----
  var STATE_META = {
    MET: { kind: 'pos', label: 'MET' },
    BORDERLINE: { kind: 'warn', label: 'BORDERLINE' },
    NOT_MET: { kind: 'neg', label: 'NOT_MET' },
    SUFFICIENT: { kind: 'pos', label: 'SUFFICIENT' },
    INSUFFICIENT: { kind: 'warn', label: 'INSUFFICIENT' },
    OK: { kind: 'pos', label: 'OK' },
    SIMPLIFIED: { kind: 'warn', label: 'SIMPLIFIED' },
    IMPROVING: { kind: 'pos', label: 'IMPROVING' },
    STABLE: { kind: 'neu', label: 'STABLE' },
    DECLINING: { kind: 'neg', label: 'DECLINING' },
    MIXED: { kind: 'warn', label: 'MIXED' },
    INSUFFICIENT_EVIDENCE: { kind: 'inc', label: 'INSUFFICIENT_EVIDENCE' },
    BASELINE_ONLY: { kind: 'inc', label: 'BASELINE_ONLY' },
    DIRECTIONAL: { kind: 'warn', label: 'DIRECTIONAL' },
    TREND_ELIGIBLE: { kind: 'pos', label: 'TREND_ELIGIBLE' },
    PROGRESSED: { kind: 'pos', label: 'PROGRESSED' },
    REGRESSED: { kind: 'neg', label: 'REGRESSED' },
    UNCHANGED: { kind: 'neu', label: 'UNCHANGED' },
    // EVIDENCE_COMPLETED：只代表样本/证据被补齐，不是训练带来的表现提升 —— 措辞必须区别于 PROGRESSED
    EVIDENCE_COMPLETED: { kind: 'inc', label: 'EVIDENCE_COMPLETED (evidence completed, not a training improvement)' },
    PERSISTENT: { kind: 'warn', label: 'PERSISTENT' },
    SHIFTED: { kind: 'warn', label: 'SHIFTED' },
    CLEARED: { kind: 'pos', label: 'CLEARED' },
    NONE: { kind: 'neu', label: 'NONE' },
    POSITIVE_RESPONSE: { kind: 'pos', label: 'POSITIVE_RESPONSE' },
    PARTIAL_RESPONSE: { kind: 'warn', label: 'PARTIAL_RESPONSE' },
    NO_MEANINGFUL_CHANGE: { kind: 'neu', label: 'NO_MEANINGFUL_CHANGE' },
    NEGATIVE_RESPONSE: { kind: 'neg', label: 'NEGATIVE_RESPONSE' },
    EFFECTIVE: { kind: 'pos', label: 'EFFECTIVE' },
    PARTIALLY_EFFECTIVE: { kind: 'warn', label: 'PARTIALLY_EFFECTIVE' },
    NOT_EFFECTIVE: { kind: 'neu', label: 'NOT_EFFECTIVE' },
    POSSIBLE_REGRESSION: { kind: 'neg', label: 'POSSIBLE_REGRESSION' },
    CONFIRMED: { kind: 'pos', label: 'CONFIRMED' },
    IMPROVING_NOT_CONFIRMED: { kind: 'warn', label: 'IMPROVING_NOT_CONFIRMED' },
    NOT_CONFIRMED: { kind: 'neu', label: 'NOT_CONFIRMED' },
    NOT_READY: { kind: 'neg', label: 'NOT_READY' },
    RETEST_RECOMMENDED: { kind: 'warn', label: 'RETEST_RECOMMENDED' },
    // PROMOTION_REVIEW_ELIGIBLE：措辞必须是"具备复核资格"，绝不能写成"已晋级/新等级"
    PROMOTION_REVIEW_ELIGIBLE: { kind: 'pos', label: 'PROMOTION_REVIEW_ELIGIBLE (review eligible, not promoted)' },
    VALIDATION_ELIGIBLE: { kind: 'pos', label: 'VALIDATION_ELIGIBLE' },
    NOT_ELIGIBLE: { kind: 'neg', label: 'NOT_ELIGIBLE' },
    ACTIVE: { kind: 'pos', label: 'ACTIVE' },
    COMPLETED: { kind: 'neu', label: 'COMPLETED' },
    SUPERSEDED: { kind: 'neu', label: 'SUPERSEDED' },
    INCOMPLETE: { kind: 'inc', label: 'INCOMPLETE' },
    // S10-B-R1: Dashboard priority tiers / unresolved semantics / S10-A workflow states —
    // machine code always stays the label text, never silently swapped for a verdict word.
    HIGH: { kind: 'neg', label: 'HIGH' },
    MEDIUM: { kind: 'warn', label: 'MEDIUM' },
    LOW: { kind: 'neu', label: 'LOW' },
    UNRESOLVED: { kind: 'warn', label: 'UNRESOLVED' },
    BENCHMARK_NOT_RESOLVED: { kind: 'warn', label: 'BENCHMARK_NOT_RESOLVED' },
    BASELINE_READY: { kind: 'neu', label: 'BASELINE_READY' },
    EVIDENCE_AVAILABLE: { kind: 'neu', label: 'EVIDENCE_AVAILABLE' },
    RECOMMENDATION_READY: { kind: 'pos', label: 'RECOMMENDATION_READY' },
    PRESCRIPTION_READY: { kind: 'pos', label: 'PRESCRIPTION_READY' },
    TRAINING_ACTIVE: { kind: 'pos', label: 'TRAINING_ACTIVE' },
    SESSION_COMPLETED: { kind: 'pos', label: 'SESSION_COMPLETED' },
    PROGRESS_RECORDED: { kind: 'pos', label: 'PROGRESS_RECORDED' },
    REASSESSMENT_READY: { kind: 'warn', label: 'REASSESSMENT_READY' },
    CYCLE_COMPLETED: { kind: 'pos', label: 'CYCLE_COMPLETED' }
  };
  function stateBadgeMeta(value) {
    if (value == null) return STATE_META.INCOMPLETE;
    return STATE_META[value] || { kind: 'neu', label: String(value) };
  }
  function badgeHTML(value) {
    var meta = stateBadgeMeta(value);
    return '<span class="rv-badge rv-' + meta.kind + '">' + esc(meta.label) + '</span>';
  }

  function fmtNumOrIncomplete(v) { return (v == null) ? 'INCOMPLETE' : v; }
  function fmtLevel(v) { return (v != null && VALIDATED_LEVELS.indexOf(v) !== -1) ? v.toFixed(1) : 'INCOMPLETE'; }

  // ---- 纯函数：把一条 PBTrend 域趋势对象整理为展示用视图模型（缺失值绝不当 0）----
  // 数值计算相关字段（state/baseline/current/delta/pointCount/missingPointCount）仍完全取自 S7-C
  // 既有的计算语义，不做任何改动。展示用 series 则优先取 display_series——它保留了窗口内每个
  // assessment 的原始时间顺序位置（缺失观测处 value 为 null），供 sparkline 在缺口处断线，
  // 不把跨越缺失评估的两个有效点连成一条虚假的连续趋势线。若上游未提供 display_series（如旧
  // 数据/测试夹具），退回到只含有效点的 series，保持向后兼容。
  function buildDomainSeriesModel(trendObj) {
    trendObj = trendObj || {};
    var chronology = trendObj.display_series || trendObj.series || [];
    return {
      state: trendObj.state || 'INSUFFICIENT_EVIDENCE',
      evidenceMode: trendObj.evidence_mode || 'INCOMPLETE',
      baseline: fmtNumOrIncomplete(trendObj.baseline_value),
      current: fmtNumOrIncomplete(trendObj.current_value),
      delta: fmtNumOrIncomplete(trendObj.raw_delta),
      pointCount: trendObj.point_count || 0,
      missingPointCount: trendObj.missing_point_count || 0,
      series: chronology.map(function (s) { return { date: s.assessment_date, value: (s.value == null ? null : s.value) }; })
    };
  }

  // validatedTrainingLevel：调用方读取到的既有持久化值（如 assessment.validated_training_level），
  // 本函数只做展示格式化——绝不从 CAP 反推、绝不从 target_training_level 顶替、绝不自动晋级/写入。
  // 只接受冻结的 3.0/3.5/4.0/4.5/5.0；缺失或非法（如连续小数）一律显示 INCOMPLETE。
  function buildCurrentStatusModel(snap, reassessment, validatedTrainingLevel) {
    if (!snap) {
      return {
        validatedLevel: 'INCOMPLETE', targetLevel: 'INCOMPLETE',
        capabilityScore: 'INCOMPLETE', capabilityState: 'INCOMPLETE',
        evidenceConfidence: 'INCOMPLETE', evidenceState: 'INCOMPLETE',
        primaryBottleneck: null, bottleneckState: 'INCOMPLETE',
        reviewStatus: (reassessment && reassessment.signal) || 'INCOMPLETE'
      };
    }
    return {
      validatedLevel: fmtLevel(validatedTrainingLevel),
      targetLevel: fmtLevel(snap.target_training_level),
      capabilityScore: fmtNumOrIncomplete(snap.capability_score),
      capabilityState: snap.capability_state || 'INCOMPLETE',
      evidenceConfidence: snap.evidence_confidence || 'INCOMPLETE', // 绝不显示 C0
      evidenceState: snap.evidence_state || 'INCOMPLETE',
      primaryBottleneck: snap.primary_bottleneck || null,
      bottleneckState: snap.bottleneck_state || 'INCOMPLETE',
      reviewStatus: (reassessment && reassessment.signal) || 'INCOMPLETE'
    };
  }

  function buildCapabilityTrendModel(trend) {
    var banner = null;
    if (trend.history_state === 'BASELINE_ONLY') banner = t('baselineOnly');
    else if (trend.history_state === 'DIRECTIONAL') banner = t('directional');
    return {
      banner: banner,
      technical: buildDomainSeriesModel(trend.technical_trend),
      decision: buildDomainSeriesModel(trend.decision_trend),
      pressure: buildDomainSeriesModel(trend.pressure_trend),
      capability: buildDomainSeriesModel(trend.capability_trend), // 只用持久化 capability_score，不含 Match Transfer
      overallDomainTrend: trend.overall_domain_trend || 'INSUFFICIENT_EVIDENCE'
    };
  }

  // ---- Match Transfer：结构上与 Capability 完全分离的独立视图模型 ----
  function buildMatchTransferModel(snap, trend, latestRetestEntry) {
    var mode = (snap && snap.match_transfer_mode) || null;
    return {
      currentScore: fmtNumOrIncomplete(snap && snap.match_transfer_score),
      trend: buildDomainSeriesModel(trend.match_transfer_trend),
      uePerGameTrend: buildDomainSeriesModel(trend.ue_per_game_trend),
      matchValidationRequired: !!(snap && snap.match_validation_required),
      matchValidationState: (snap && snap.match_validation_state) || 'INCOMPLETE',
      isSimplifiedEvidence: mode === 'simplified',
      evidenceLabel: (mode === 'simplified') ? t('simplifiedEvidence') : 'INCOMPLETE',
      matchTransferResponse: (latestRetestEntry && latestRetestEntry.match_transfer_response) || 'INCOMPLETE'
    };
  }

  // ---- 硬门槛表格行：performance_state / sample_state / formal_status / transition 四者必须分开呈现 ----
  function buildHardGateRows(hardGateTrends) {
    return (hardGateTrends || []).map(function (gt) {
      var hist = gt.history || [];
      var last = hist.length ? hist[hist.length - 1] : null;
      return {
        metric: gt.metric,
        direction: gt.direction,
        previousValue: fmtNumOrIncomplete(gt.previous_value),
        currentValue: fmtNumOrIncomplete(gt.current_value),
        threshold: fmtNumOrIncomplete(gt.threshold),
        performanceState: (last && last.performance_state) || 'INCOMPLETE',
        sampleState: (last && last.sample_state) || 'INCOMPLETE',
        formalState: gt.current_status || 'INCOMPLETE',
        transition: gt.gate_transition_state || 'INCOMPLETE',
        thresholdMixed: !!gt.threshold_mixed
      };
    });
  }

  function buildBottleneckModel(movement) {
    movement = movement || {};
    return {
      previous: movement.previous_bottleneck || null,
      current: movement.current_bottleneck || null,
      movementState: movement.state || 'INCOMPLETE'
    };
  }

  // ---- Prescription：只展示已持久化的处方/复测链接数据，本页不产出处方内容 ----
  function buildPrescriptionModel(prescriptionRecord, retestSummary) {
    if (!prescriptionRecord) return { exists: false, message: t('noPrescription') };
    var d = prescriptionRecord.data || {};
    var summary = retestSummary || { retest_count: 0, latest_response: 'INCOMPLETE', response_history: [], prescription_effectiveness: 'INCOMPLETE' };
    return {
      exists: true,
      prescriptionId: prescriptionRecord.prescription_id,
      status: d.status || 'ACTIVE',
      sourceAssessmentId: d.source_assessment_id || null,
      sourceReviewSnapshotId: d.source_review_snapshot_id || null,
      primaryBottleneck: d.primary_bottleneck || null,
      createdAt: prescriptionRecord.created_at || null,
      retestCount: summary.retest_count,
      latestResponse: summary.latest_response,
      effectiveness: summary.prescription_effectiveness,
      noRetestMessage: (summary.retest_count === 0) ? t('noRetest') : null,
      responseHistory: summary.response_history
    };
  }

  // ---- 复测/晋级复核：PROMOTION_REVIEW_ELIGIBLE 必须显式声明"非已晋级" ----
  function buildReassessmentModel(reassessment) {
    var signal = (reassessment && reassessment.signal) || 'INCOMPLETE';
    return {
      signal: signal,
      note: (signal === 'PROMOTION_REVIEW_ELIGIBLE') ? t('promotionReviewNote') : null,
      validationState: (reassessment && reassessment.validation_state) || null
    };
  }

  // ---- S10-B-R1: Dashboard View Model passthrough — PBDashboard already produced the final
  // shape (dashboardResult.dashboard); this only supplies an honest default when the S9 match
  // pipeline yielded nothing (no match session, or the caller-side fetch degraded on error),
  // matching PBDashboard.projectDashboardList([])'s own empty-state contract exactly. No
  // recommendation/priority/prescription value is read, computed, or altered here.
  function buildDashboardModel(dashboardResult) {
    if (dashboardResult && dashboardResult.dashboard) return dashboardResult.dashboard;
    return { items: [], item_count: 0, message_code: 'NO_RECOMMENDATION', message: 'No active recommendation available' };
  }

  // ---- 主编排：把已取得的原始引擎输出整理成整页视图模型（纯函数，不发请求、不碰 DOM）----
  function buildReviewViewModel(input) {
    input = input || {};
    var trend = input.trend;
    var dashboard = buildDashboardModel(input.dashboardResult);
    if (!trend || !trend.assessment_count) {
      return { emptyState: true, message: t('noHistory'), dashboard: dashboard };
    }
    var snap = input.latestSnapshot || null;
    return {
      emptyState: false,
      assessmentCount: trend.assessment_count,
      historyState: trend.history_state,
      versionMixed: !!trend.version_mixed,
      currentStatus: buildCurrentStatusModel(snap, input.reassessment, input.validatedTrainingLevel),
      capabilityTrend: buildCapabilityTrendModel(trend),
      matchTransfer: buildMatchTransferModel(snap, trend, input.latestRetestEntry),
      hardGates: buildHardGateRows(trend.hard_gate_trends),
      bottleneck: buildBottleneckModel(trend.bottleneck_movement),
      prescription: buildPrescriptionModel(input.prescription, input.retestSummary),
      reassessment: buildReassessmentModel(input.reassessment),
      dashboard: dashboard
    };
  }

  // ---- 轻量 SVG 折线：坐标按原始时间顺序位置排布（含缺失点占位），缺失点绝不臆造插值——
  // 遇到 null/缺失观测，路径在该处断开，绝不画出跨越缺口的连线；无预测、仅历史展示。
  // points 可包含 {value:null} 这类缺失观测占位，用于保留其在时间序列中的原始位置。
  function sparklineSVG(points, opts) {
    opts = opts || {};
    var w = opts.width || 220, h = opts.height || 40, pad = 5;
    var all = points || [];
    var n = all.length;
    if (!n) return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"></svg>';

    var validValues = [];
    all.forEach(function (p) { if (p && p.value != null) validValues.push(p.value); });
    if (!validValues.length) return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"></svg>';

    if (n === 1) {
      return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><circle cx="' + (w / 2) + '" cy="' + (h / 2) + '" r="3" fill="var(--ink)"></circle></svg>';
    }

    var min = Math.min.apply(null, validValues), max = Math.max.apply(null, validValues);
    if (min === max) { min -= 1; max += 1; }
    var stepX = (w - pad * 2) / (n - 1);

    // 按原始索引分段：连续无缺口的有效点归为同一段可连线；一旦遇到 null，另起一段——
    // 段与段之间绝不连线，即"72, null, 78"必须渲染成两个互不相连的点/段。
    var segments = [], current = [];
    all.forEach(function (p, i) {
      if (p && p.value != null) {
        var x = pad + i * stepX;
        var y = pad + (h - pad * 2) * (1 - (p.value - min) / (max - min));
        current.push([x, y]);
      } else if (current.length) {
        segments.push(current); current = [];
      }
    });
    if (current.length) segments.push(current);

    var paths = segments.filter(function (seg) { return seg.length > 1; }).map(function (seg) {
      return '<path d="' + seg.map(function (c, i) { return (i === 0 ? 'M' : 'L') + c[0].toFixed(1) + ',' + c[1].toFixed(1); }).join(' ') + '" fill="none" stroke="var(--lime-deep,#2f6f5f)" stroke-width="2"></path>';
    }).join('');
    var dots = segments.reduce(function (acc, seg) { return acc.concat(seg); }, []).map(function (c) {
      return '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="2.5" fill="var(--ink)"></circle>';
    }).join('');

    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + paths + dots + '</svg>';
  }

  // ================= 以下为 DOM 渲染 / 数据编排（仅浏览器环境运行）=================

  var ROOT_ID = 'review-app';
  var el = null;
  var SELECTED_PLAYER_ID = null;

  // S11-F0-R1 IO-layer state — never read by the pure builders/renderers above (those only ever
  // receive plain data as explicit arguments); these exist solely so the "Use This Training Plan"
  // click handler can (a) find the exact in-memory recommendation+prescription pair the primary
  // dashboard card is showing, without re-running S9, and (b) re-paint the already-loaded page
  // with an updated registration status, without a redundant PBStore/S9 reload.
  var LAST_MATCH_SESSION_ID = null;
  var LAST_RAW_ITEMS = []; // [{recommendation, prescription, skill_gaps}] for SELECTED_PLAYER_ID's current dashboard
  var LAST_HEADER_HTML = '';
  var LAST_MODEL = null;
  var REGISTRATION_VIEW_STATE = null;

  function findRawItem(recommendation_id) {
    return LAST_RAW_ITEMS.filter(function (it) { return it.recommendation && it.recommendation.recommendation_id === recommendation_id; })[0] || null;
  }

  function domainCard(label, model) {
    return '<div class="rv-card"><div class="rv-mut" style="font-weight:700;color:var(--ink)">' + esc(label) + '</div>' +
      sparklineSVG(model.series, {}) +
      '<div class="rv-row"><span class="rv-mut">' + (LANG === 'en' ? 'Baseline → Current' : '基线 → 当前') + '</span><b>' + esc(model.baseline) + ' → ' + esc(model.current) + '</b></div>' +
      '<div class="rv-row"><span class="rv-mut">' + (LANG === 'en' ? 'Delta' : '差值') + '</span><b>' + esc(model.delta) + '</b></div>' +
      '<div class="rv-row" style="border:none"><span class="rv-mut">' + (LANG === 'en' ? 'Evidence' : '证据模式') + '</span>' + badgeHTML(model.evidenceMode) + '</div>' +
      '<div style="margin-top:4px">' + badgeHTML(model.state) + '</div></div>';
  }

  function renderSection1(m) {
    var s = m.currentStatus;
    return '<div class="rv-section"><div class="rv-h">' + t('section1') + '</div><div class="card">' +
      '<div class="rv-row"><span>' + (LANG === 'en' ? 'Validated Training Level' : '已验证等级 Validated Level') + '</span><b>' + esc(s.validatedLevel) + '</b></div>' +
      '<div class="rv-row"><span>' + (LANG === 'en' ? 'Target Training Level' : '目标等级 Target Level') + '</span><b>' + esc(s.targetLevel) + '</b></div>' +
      '<div class="rv-row"><span>' + (LANG === 'en' ? 'Capability Score' : 'Capability 综合分') + '</span><b>' + esc(s.capabilityScore) + '</b> ' + badgeHTML(s.capabilityState) + '</div>' +
      '<div class="rv-row"><span>' + (LANG === 'en' ? 'Evidence Confidence' : '证据置信度') + '</span><b>' + esc(s.evidenceConfidence) + '</b> ' + badgeHTML(s.evidenceState) + '</div>' +
      '<div class="rv-row"><span>' + (LANG === 'en' ? 'Primary Bottleneck' : '当前主要瓶颈') + '</span><b>' + esc(s.primaryBottleneck || (LANG === 'en' ? '(none)' : '（无）')) + '</b> ' + badgeHTML(s.bottleneckState) + '</div>' +
      '<div class="rv-row" style="border:none"><span>' + (LANG === 'en' ? 'Review / Reassessment Status' : '复盘 / 复核状态') + '</span>' + badgeHTML(s.reviewStatus) + '</div>' +
      '</div></div>';
  }

  function renderSection2(m) {
    var c = m.capabilityTrend;
    var banner = c.banner ? '<div class="rv-banner">' + esc(c.banner) + '</div>' : '';
    return '<div class="rv-section"><div class="rv-h">' + t('section2') + '</div>' + banner +
      '<div class="rv-row" style="border:none"><span class="rv-mut">' + (LANG === 'en' ? 'Overall domain direction' : '域趋势整体方向') + '</span>' + badgeHTML(c.overallDomainTrend) + '</div>' +
      '<div class="rv-grid">' +
      domainCard(LANG === 'en' ? 'Technical' : '技术 Technical', c.technical) +
      domainCard(LANG === 'en' ? 'Decision' : '决策 Decision', c.decision) +
      domainCard(LANG === 'en' ? 'Pressure' : '抗压 Pressure', c.pressure) +
      domainCard(LANG === 'en' ? 'Capability' : '综合 Capability', c.capability) +
      '</div></div>';
  }

  function renderSection3(m) {
    var mt = m.matchTransfer;
    var simplified = mt.isSimplifiedEvidence ? '<div class="rv-banner">' + esc(mt.evidenceLabel) + '</div>' : '';
    return '<div class="rv-section"><div class="rv-h">' + t('section3') + '</div><div class="card">' + simplified +
      '<div class="rv-row"><span>' + (LANG === 'en' ? 'Current Match Transfer Score' : '当前实战转化分') + '</span><b>' + esc(mt.currentScore) + '</b></div>' +
      '<div class="rv-row" style="display:block;border:none"><span class="rv-mut">' + (LANG === 'en' ? 'Match Transfer Trend' : '实战转化趋势') + '</span>' + domainCard('', mt.trend) + '</div>' +
      '<div class="rv-row" style="display:block;border:none"><span class="rv-mut">' + (LANG === 'en' ? 'UE / Game Trend' : '每局 UE 趋势') + '</span>' + domainCard('', mt.uePerGameTrend) + '</div>' +
      '<div class="rv-row"><span>' + (LANG === 'en' ? 'Match Validation' : '实战验证') + (mt.matchValidationRequired ? '' : (LANG === 'en' ? ' (not required)' : '（未强制）')) + '</span>' + badgeHTML(mt.matchValidationState) + '</div>' +
      '<div class="rv-row" style="border:none"><span>' + (LANG === 'en' ? 'Match Transfer Response (S7-D)' : '实战转化应答（S7-D）') + '</span>' + badgeHTML(mt.matchTransferResponse) + '</div>' +
      '</div></div>';
  }

  function renderSection4(m) {
    var rows = m.hardGates.length ? m.hardGates.map(function (g) {
      return '<tr><td>' + esc(g.metric) + (g.thresholdMixed ? ' <span class="rv-mut">⚠' + (LANG === 'en' ? 'threshold changed' : '门槛已变') + '</span>' : '') + '</td>' +
        '<td class="num">' + esc(g.previousValue) + '</td><td class="num">' + esc(g.currentValue) + '</td><td class="num">' + esc(g.threshold) + '</td>' +
        '<td>' + badgeHTML(g.performanceState) + '</td><td>' + badgeHTML(g.sampleState) + '</td><td>' + badgeHTML(g.formalState) + '</td><td>' + badgeHTML(g.transition) + '</td></tr>';
    }).join('') : '<tr><td colspan="8" class="rv-mut">' + (LANG === 'en' ? 'No hard-gate data available.' : '暂无硬门槛数据。') + '</td></tr>';
    return '<div class="rv-section"><div class="rv-h">' + t('section4') + '</div><div class="card" style="overflow-x:auto">' +
      '<table class="rv-tbl"><thead><tr><th>' + (LANG === 'en' ? 'Hard Gate' : '硬门槛') + '</th><th>' + (LANG === 'en' ? 'Previous' : '此前') + '</th><th>' + (LANG === 'en' ? 'Current' : '当前') + '</th><th>' + (LANG === 'en' ? 'Threshold' : '门槛') + '</th><th>' + (LANG === 'en' ? 'Performance' : '表现') + '</th><th>' + (LANG === 'en' ? 'Sample' : '样本') + '</th><th>' + (LANG === 'en' ? 'Formal' : '正式状态') + '</th><th>' + (LANG === 'en' ? 'Transition' : '迁移') + '</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '</div></div>';
  }

  function renderSection5(m) {
    var b = m.bottleneck, p = m.prescription;
    var pHtml;
    if (!p.exists) {
      pHtml = '<div class="rv-mut">' + esc(p.message) + '</div>';
    } else {
      pHtml = '<div class="rv-row"><span>Prescription ID</span><b>' + esc(p.prescriptionId) + '</b></div>' +
        '<div class="rv-row"><span>' + (LANG === 'en' ? 'Status' : '状态') + '</span>' + badgeHTML(p.status) + '</div>' +
        '<div class="rv-row"><span>' + (LANG === 'en' ? 'Source Assessment' : '来源 Assessment') + '</span><b>' + esc(p.sourceAssessmentId || 'INCOMPLETE') + '</b></div>' +
        '<div class="rv-row"><span>' + (LANG === 'en' ? 'Source Review Snapshot' : '来源 Review Snapshot') + '</span><b>' + esc(p.sourceReviewSnapshotId || 'INCOMPLETE') + '</b></div>' +
        '<div class="rv-row"><span>' + (LANG === 'en' ? 'Primary Bottleneck' : '目标瓶颈') + '</span><b>' + esc(p.primaryBottleneck || (LANG === 'en' ? '(none)' : '（无）')) + '</b></div>' +
        '<div class="rv-row"><span>' + (LANG === 'en' ? 'Created' : '创建时间') + '</span><b>' + esc(p.createdAt || 'INCOMPLETE') + '</b></div>' +
        '<div class="rv-row"><span>' + (LANG === 'en' ? 'Re-test Count' : '复测次数') + '</span><b>' + esc(p.retestCount) + '</b></div>' +
        (p.noRetestMessage
          ? '<div class="rv-row" style="border:none"><span class="rv-mut">' + esc(p.noRetestMessage) + '</span></div>'
          : ('<div class="rv-row"><span>' + (LANG === 'en' ? 'Latest Response' : '最新应答') + '</span>' + badgeHTML(p.latestResponse) + '</div>' +
             '<div class="rv-row" style="border:none"><span>' + (LANG === 'en' ? 'Prescription Effectiveness' : '处方有效性') + '</span>' + badgeHTML(p.effectiveness) + '</div>'));
    }
    return '<div class="rv-section"><div class="rv-h">' + t('section5') + '</div><div class="card">' +
      '<div class="rv-row"><span>' + (LANG === 'en' ? 'Current Primary Bottleneck' : '当前主要瓶颈') + '</span><b>' + esc(b.current || (LANG === 'en' ? '(none)' : '（无）')) + '</b></div>' +
      '<div class="rv-row"><span>' + (LANG === 'en' ? 'Previous Bottleneck' : '此前瓶颈') + '</span><b>' + esc(b.previous || (LANG === 'en' ? '(none)' : '（无）')) + '</b></div>' +
      '<div class="rv-row" style="border:none"><span>' + (LANG === 'en' ? 'Bottleneck Movement' : '瓶颈迁移') + '</span>' + badgeHTML(b.movementState) + '</div>' +
      '</div><div class="card" style="margin-top:10px">' + pHtml + '</div></div>';
  }

  function renderSection6(m) {
    var r = m.reassessment;
    return '<div class="rv-section"><div class="rv-h">' + t('section6') + '</div><div class="card">' +
      '<div style="margin-bottom:8px">' + badgeHTML(r.signal) + '</div>' +
      (r.note ? '<div class="rv-mut">' + esc(r.note) + '</div>' : '') +
      '</div></div>';
  }

  // review-ui.js's existing render1-6 read the browser global `LANG` (set by js/i18n.js)
  // directly and were previously only ever invoked from the browser; curLang() gives the new
  // Section 7 renderers below the same dynamic per-call read but with a safe fallback, so they
  // stay Node-unit-testable like this file's other pure functions.
  function curLang() { return (typeof LANG !== 'undefined') ? LANG : 'zh'; }

  // ---- S10-B-R1: one dashboard_item -> one read-only recommendation card. Every value is read
  // straight off the PBDashboard-projected item; this function computes nothing (no rank, no
  // score, no tier, no mapping) — it only chooses HTML/copy for values already decided upstream.
  // S11-F0-R1: isPrimaryEligible/registrationView are optional (default false/null) so every
  // pre-existing call site/test that invokes dashboardItemCard(item) alone is unaffected — only
  // renderSection7 ever passes them, and only for the single top-priority item that has both a
  // resolved rank and an available prescription (the "primary Recommendation" the frozen package
  // requires). registrationView, when given, is one of {phase:'idle'|'pending'|'success'|'already'|'error', code, cycle_id, workflow_id} — plain data, no DOM/PBStore read here, keeping this a pure function like the rest of this file's view builders.
  function dashboardItemCard(item, isPrimaryEligible, registrationView) {
    var rankLabel = item.rank_status === 'RESOLVED' ? ('#' + item.rank) : t('rankUnresolved');
    var header = '<div class="rv-row" style="border:none"><b>' + esc(rankLabel) + '</b> ' + badgeHTML(item.priority_tier) + '</div>';
    var body =
      '<div class="rv-row"><span>' + (curLang() === 'en' ? 'Skill' : '技能') + '</span><b>' + esc(item.skill || t('noneLabel')) + '</b></div>' +
      '<div class="rv-row"><span>' + (curLang() === 'en' ? 'Recommendation' : '推荐') + '</span><b>' + esc(item.recommendation_code || 'UNRESOLVED') + '</b></div>' +
      '<div class="rv-row"><span>' + (curLang() === 'en' ? 'Status' : '状态') + '</span>' + badgeHTML(item.status) + '</div>';

    var trace = item.traceability || { source_skill_gap_ids: [], evidence_pattern_ids: [] };
    var traceHTML = '<div class="rv-row" style="display:block;border:none"><span class="rv-mut">' + t('whyEvidenceLabel') + '</span>' +
      '<div class="rv-mut">' + esc(t('findingsLabel')) + ': ' + esc(trace.source_skill_gap_ids.length ? trace.source_skill_gap_ids.join(', ') : t('noneLabel')) + '</div>' +
      '<div class="rv-mut">' + esc(t('evidencePatternsLabel')) + ': ' + esc(trace.evidence_pattern_ids.length ? trace.evidence_pattern_ids.join(', ') : t('noneLabel')) + '</div>' +
      '</div>';

    var presc = item.prescription_summary;
    var prescHTML;
    if (!presc) {
      prescHTML = '<div class="rv-mut">' + esc(t('prescriptionNotYet')) + '</div>';
    } else {
      prescHTML =
        '<div class="rv-row"><span>' + (curLang() === 'en' ? 'Objective' : '训练目标') + '</span><b>' + esc(presc.training_objective_code || 'UNRESOLVED') + '</b></div>' +
        '<div class="rv-row"><span>' + (curLang() === 'en' ? 'Mode' : '训练模式') + '</span><b>' + esc(presc.training_mode || 'UNRESOLVED') + '</b></div>' +
        '<div class="rv-row"><span>' + (curLang() === 'en' ? 'Drill Family' : '训练项类型') + '</span><b>' + esc(presc.drill_family_code || 'UNRESOLVED') + '</b></div>' +
        '<div class="rv-row"><span>' + (curLang() === 'en' ? 'Dosage' : '强度权重') + '</span><b>' + esc(presc.dosage_profile_code || 'UNRESOLVED') + '</b></div>' +
        (presc.drill_resolution_status === 'UNRESOLVED'
          ? '<div class="rv-row"><span class="rv-mut">' + esc(t('drillUnresolvedMsg')) + '</span>' + badgeHTML('UNRESOLVED') + '</div>' : '') +
        (presc.kpi_target_status === 'BENCHMARK_NOT_RESOLVED'
          ? '<div class="rv-row" style="border:none"><span class="rv-mut">' + esc(t('kpiUnresolvedMsg')) + '</span>' + badgeHTML('BENCHMARK_NOT_RESOLVED') + '</div>' : '');
    }

    var workflowHTML = '<div class="rv-row" style="border:none"><span>' + (curLang() === 'en' ? 'Workflow' : '工作流状态') + '</span>' + badgeHTML(item.workflow_state) + '</div>';
    var reassessHTML = item.reassessment_pending ? '<div class="rv-banner" style="border-color:var(--part);background:#fff8e8">' + esc(t('reassessmentMsg')) + '</div>' : '';

    // S11-F0-R1: the one legitimate production entry point for turning this already-computed,
    // in-memory recommendation+prescription pair into a durable S10-A/S10-C registration. Only
    // rendered for the single primary (rank #1, prescription available) item; never recomputes
    // S9, never fabricates a rank/prescription that isn't already resolved upstream.
    var registrationHTML = '';
    if (isPrimaryEligible) {
      var rv = registrationView || { phase: 'idle' };
      var btnDisabled = rv.phase === 'pending' ? ' disabled' : '';
      registrationHTML = '<div style="margin-top:8px">' +
        '<button class="btn solid" data-act="register-decision-cycle" data-recid="' + esc(item.recommendation_id) + '"' + btnDisabled + '>' + esc(t('useThisPlanBtn')) + '</button>';
      if (rv.phase === 'pending') {
        registrationHTML += '<div class="rv-mut" style="margin-top:6px">' + esc(t('registrationPending')) + '</div>';
      } else if (rv.phase === 'success') {
        registrationHTML += '<div class="rv-banner" style="margin-top:6px">' + esc(t('registrationSuccess')) + '</div>';
      } else if (rv.phase === 'already') {
        registrationHTML += '<div class="rv-banner" style="margin-top:6px">' + esc(t('registrationAlready')) + '</div>';
      } else if (rv.phase === 'error') {
        registrationHTML += '<div class="rv-banner" style="margin-top:6px;border-color:var(--fail);background:#fdecec">' + esc(t('registrationErrorPrefix')) + esc(rv.code || 'UNKNOWN') + '</div>';
      }
      registrationHTML += '</div>';
    }

    return '<div class="rv-card">' + header + body + traceHTML +
      '<div style="margin-top:6px;font-weight:700;color:var(--ink)">' + esc(t('trainingDirectionLabel')) + '</div>' + prescHTML +
      workflowHTML + reassessHTML + registrationHTML + '</div>';
  }

  // model.registrationView (optional; set by the DOM-mount layer only, never by
  // buildReviewViewModel) — {recommendation_id, phase, code, cycle_id, workflow_id} describing the
  // in-flight/most-recent registration click, or null/undefined outside of that. It is only ever
  // matched against and displayed on the primary item; a stale entry for a since-changed primary
  // recommendation_id (e.g. after switching players) is never shown.
  function renderSection7(model) {
    var d = model.dashboard || { items: [], item_count: 0 };
    var rv = model.registrationView || null;
    var body = (d.items && d.items.length)
      ? '<div class="rv-grid">' + d.items.map(function (item, idx) {
          var isPrimaryEligible = idx === 0 && item.rank_status === 'RESOLVED' && item.prescription_status === 'AVAILABLE';
          var itemRegistrationView = (isPrimaryEligible && rv && rv.recommendation_id === item.recommendation_id) ? rv : null;
          return dashboardItemCard(item, isPrimaryEligible, itemRegistrationView);
        }).join('') + '</div>'
      : '<div class="rv-mut">' + esc(t('noActiveRecommendation')) + '</div>';
    return '<div class="rv-section"><div class="rv-h">' + t('section7') + '</div>' + body + '</div>';
  }

  function renderModelHTML(model) {
    if (model.emptyState) return '<div class="rv-mut" style="margin-top:10px">' + esc(model.message) + '</div>' + renderSection7(model);
    var warn = model.versionMixed ? '<div class="rv-banner" style="border-color:var(--part);background:#fff8e8">' + esc(t('versionMixedWarning')) + '</div>' : '';
    return warn + renderSection1(model) + renderSection2(model) + renderSection3(model) + renderSection4(model) + renderSection5(model) + renderSection6(model) + renderSection7(model);
  }

  // ---- S10-B-R1 orchestration: locate this player's most recent S9-A Match Observation session
  // (test_id ASMT-10 / feed_mode live_match) using the existing PBNamespace.isMatchCapture /
  // PBStore.assessmentsByPlayer / sessionsByAssessment public APIs — no new query/store, no
  // duplicated S9 matching logic. ----
  function dashboardEnginesReady() {
    return typeof PBDiagnosis !== 'undefined' && typeof PBRecommendationPriority !== 'undefined' &&
      typeof PBTrainingPrescription !== 'undefined' && typeof PBDashboard !== 'undefined' &&
      typeof PBNamespace !== 'undefined';
  }

  function findLatestMatchSessionId(player_id) {
    return PBStore.assessmentsByPlayer(player_id).then(function (assessments) {
      return Promise.all((assessments || []).map(function (a) { return PBStore.sessionsByAssessment(a.assessment_id); }));
    }).then(function (sessionLists) {
      var sessions = [].concat.apply([], sessionLists).filter(function (s) {
        return s && PBNamespace.isMatchCapture(s.test_id);
      });
      sessions.sort(function (a, b) { return (a.started_at || '') < (b.started_at || '') ? 1 : -1; }); // most recent first
      return sessions.length ? sessions[0].test_session_id : null;
    });
  }

  // Runs the existing, accepted S9 chain via its own public entry points only (diagnoseMatch is
  // storage-backed; prioritizeDiagnosis/prescribeRecommendations are the same pure functions S9-E/F
  // already expose) and projects the result through PBDashboard — never recomputing any of it.
  // No S10-A Workflow Cycle is persisted anywhere in this repo yet (S10-A shipped deliberately
  // without persistence), so `workflow` is left unset here; PBDashboard's own contract already
  // renders that honestly as workflow_state: 'UNRESOLVED' rather than inventing a storage layer.
  function loadDashboardData(player_id) {
    if (!dashboardEnginesReady()) { LAST_MATCH_SESSION_ID = null; LAST_RAW_ITEMS = []; return Promise.resolve(null); }
    return findLatestMatchSessionId(player_id).then(function (matchSessionId) {
      LAST_MATCH_SESSION_ID = matchSessionId;
      if (!matchSessionId) { LAST_RAW_ITEMS = []; return PBDashboard.projectDashboardList([]); }
      return PBDiagnosis.diagnoseMatch(matchSessionId, player_id).then(function (diagnosisResult) {
        var recommendationResult = PBRecommendationPriority.prioritizeDiagnosis(diagnosisResult);
        var prescriptionResult = PBTrainingPrescription.prescribeRecommendations(recommendationResult);
        var items = recommendationResult.recommendations.map(function (r) {
          var prescription = prescriptionResult.prescriptions.filter(function (p) { return p.source_recommendation_id === r.recommendation_id; })[0] || null;
          return { recommendation: r, prescription: prescription, skill_gaps: diagnosisResult.skill_gaps };
        });
        // S11-F0-R1: kept around (recommendation/prescription full objects, not just the S10-B
        // projected summary) so the "Use This Training Plan" click can register the exact pair
        // shown, without asking S9 to recompute anything at click time.
        LAST_RAW_ITEMS = items;
        return PBDashboard.projectDashboardList(items);
      });
    }).catch(function () {
      // A dashboard-pipeline failure (e.g. an unreadable session) must never blank out the rest
      // of the Review page — degrade honestly to the same empty state PBDashboard itself defines.
      LAST_RAW_ITEMS = [];
      return PBDashboard.projectDashboardList([]);
    });
  }

  function loadReviewData(player_id) {
    return Promise.all([
      PBTrend.forPlayer(player_id),
      PBRetest.getLatestReviewSnapshotForPlayer(player_id),
      PBRetest.prescriptionsForPlayer(player_id),
      PBRetest.getReassessmentSignalForPlayer(player_id),
      loadDashboardData(player_id)
    ]).then(function (r) {
      var trend = r[0], latestSnapRec = r[1], prescriptions = (r[2] || []).slice(), reassessment = r[3], dashboardResult = r[4];
      prescriptions.sort(function (a, b) { return (a.created_at || '') < (b.created_at || '') ? -1 : ((a.created_at || '') > (b.created_at || '') ? 1 : 0); });
      var latestPrescription = prescriptions.length ? prescriptions[prescriptions.length - 1] : null;
      var summaryPromise = latestPrescription ? PBRetest.getPrescriptionRetestSummary(latestPrescription.prescription_id) : Promise.resolve(null);
      // 只读取既有 Assessment 记录上的 validated_training_level（S7-E 从不写入/推导它），
      // 该字段目前仅在外部/人工写入 assessment 记录时才会存在（schema 已预留），本页只展示。
      var assessmentId = latestSnapRec && latestSnapRec.data ? latestSnapRec.data.assessment_id : null;
      var assessmentPromise = assessmentId ? PBStore.get('assessments', assessmentId) : Promise.resolve(null);
      return Promise.all([summaryPromise, assessmentPromise]).then(function (r2) {
        var retestSummary = r2[0], assessmentRec = r2[1];
        var latestRetestEntry = (retestSummary && retestSummary.response_history.length)
          ? retestSummary.response_history[retestSummary.response_history.length - 1] : null;
        return buildReviewViewModel({
          trend: trend,
          latestSnapshot: latestSnapRec ? latestSnapRec.data : null,
          prescription: latestPrescription,
          retestSummary: retestSummary,
          reassessment: reassessment,
          latestRetestEntry: latestRetestEntry,
          validatedTrainingLevel: assessmentRec ? assessmentRec.validated_training_level : null,
          dashboardResult: dashboardResult
        });
      });
    });
  }

  function renderPlayerPickerHTML(players) {
    if (!players.length) {
      return '<div class="rv-h">' + t('reviewTitle') + '</div><div class="rv-mut">' + esc(t('noHistory')) + '</div>';
    }
    var chips = players.map(function (p) {
      return '<span class="rv-chip' + (SELECTED_PLAYER_ID === p.player_id ? ' sel' : '') + '" data-act="pick-player" data-pid="' + esc(p.player_id) + '">' + esc(p.display_name) + '</span>';
    }).join('');
    return '<div class="rv-h">' + t('reviewTitle') + '</div><label class="rv-mut">' + t('choosePlayer') + '</label><div>' + chips + '</div>';
  }

  function render() {
    if (!el) return;
    REGISTRATION_VIEW_STATE = null; // a fresh full reload (player switch, initial mount) drops any stale click-status
    LAST_MODEL = null;
    PBStore.listPlayers().then(function (players) {
      var header = renderPlayerPickerHTML(players);
      LAST_HEADER_HTML = header;
      if (!players.length) { el.innerHTML = header; return; }
      if (!SELECTED_PLAYER_ID) { el.innerHTML = header + '<div class="rv-mut" style="margin-top:10px">' + esc(t('noPlayer')) + '</div>'; return; }
      el.innerHTML = header + '<div class="rv-mut" style="margin-top:10px">' + (LANG === 'en' ? 'Loading…' : '加载中…') + '</div>';
      loadReviewData(SELECTED_PLAYER_ID).then(function (model) {
        LAST_MODEL = model;
        if (el) el.innerHTML = header + renderModelHTML(model);
      }).catch(function (e) {
        if (el) el.innerHTML = header + '<div class="rv-mut" style="color:var(--fail)">' + (LANG === 'en' ? 'Load failed: ' : '加载失败：') + esc(e.message) + '</div>';
      });
    });
  }

  // Repaints the already-loaded page from cached header/model + the current
  // REGISTRATION_VIEW_STATE — no PBStore re-read, no S9 recompute — used after a registration
  // click so the button's own status (pending/success/already/error) is reflected immediately.
  function repaint() {
    if (!el || !LAST_MODEL) return;
    LAST_MODEL.registrationView = REGISTRATION_VIEW_STATE;
    el.innerHTML = LAST_HEADER_HTML + renderModelHTML(LAST_MODEL);
  }

  function onRegisterDecisionCycleClick(recommendation_id) {
    var item = findRawItem(recommendation_id);
    if (!item || !item.prescription) return;
    if (typeof PBDecisionCycleRegistration === 'undefined' || !LAST_MATCH_SESSION_ID || !SELECTED_PLAYER_ID) return;
    REGISTRATION_VIEW_STATE = { recommendation_id: recommendation_id, phase: 'pending' };
    repaint();
    PBDecisionCycleRegistration.registerDecisionCycle({
      player_id: SELECTED_PLAYER_ID,
      source_match_session_id: LAST_MATCH_SESSION_ID,
      recommendation: item.recommendation,
      prescription: item.prescription
    }).then(function (result) {
      REGISTRATION_VIEW_STATE = {
        recommendation_id: recommendation_id,
        phase: result.was_existing ? 'already' : 'success',
        cycle_id: result.development_cycle.cycle_id,
        workflow_id: result.prescription_workflow.workflow_id
      };
      repaint();
    }).catch(function (err) {
      REGISTRATION_VIEW_STATE = { recommendation_id: recommendation_id, phase: 'error', code: (err && err.code) || 'UNKNOWN' };
      repaint();
    });
  }

  function onClick(e) {
    var node = e.target.closest('[data-act]'); if (!node) return;
    var act = node.getAttribute('data-act');
    if (act === 'pick-player') { SELECTED_PLAYER_ID = node.getAttribute('data-pid'); render(); return; }
    if (act === 'register-decision-cycle') { onRegisterDecisionCycleClick(node.getAttribute('data-recid')); return; }
  }

  function mount() {
    el = document.getElementById(ROOT_ID); if (!el) return;
    el.addEventListener('click', onClick);
    if (typeof PBStore === 'undefined' || typeof PBTrend === 'undefined' || typeof PBRetest === 'undefined') {
      el.innerHTML = '<div class="rv-mut">' + (LANG === 'en' ? 'Modules not ready (PBStore/PBTrend/PBRetest not loaded).' : '模块未就绪（PBStore/PBTrend/PBRetest 未加载）。') + '</div>';
      return;
    }
    render();
  }

  return {
    // 纯函数（可在 Node 下单测，不依赖 DOM/PBStore）
    buildReviewViewModel: buildReviewViewModel,
    buildCurrentStatusModel: buildCurrentStatusModel,
    buildCapabilityTrendModel: buildCapabilityTrendModel,
    buildMatchTransferModel: buildMatchTransferModel,
    buildHardGateRows: buildHardGateRows,
    buildBottleneckModel: buildBottleneckModel,
    buildPrescriptionModel: buildPrescriptionModel,
    buildReassessmentModel: buildReassessmentModel,
    buildDomainSeriesModel: buildDomainSeriesModel,
    buildDashboardModel: buildDashboardModel,
    stateBadgeMeta: stateBadgeMeta,
    sparklineSVG: sparklineSVG,
    fmtLevel: fmtLevel,

    // S10-B-R1：HTML 拼接也是纯函数（输入 view model，输出字符串，不碰 DOM），
    // 与既有 sparklineSVG 同类，可在 Node 下单测渲染输出
    dashboardItemCard: dashboardItemCard,
    renderSection7: renderSection7,
    renderModelHTML: renderModelHTML,

    // 供页面刷新调用（在浏览器环境挂载后可用）
    refresh: function () { render(); },
    _mount: mount
  };
});
