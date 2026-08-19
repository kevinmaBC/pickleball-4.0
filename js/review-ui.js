/* ============================================================
 * review-ui.js — Pickleball App 2.0 Alpha · S7-E Review / Trend UI
 * 把 S7-A~D 已冻结的引擎输出（Review Snapshot / Trend / Prescription /
 * Re-test）拼成一个只读的"复盘 / 趋势"页面。
 * 严格边界：本文件不实现任何方法论——不重算 CAP/门槛/证据/瓶颈/趋势/
 * 处方/复测应答，只读取 PBReview / PBTrend / PBRetest 已产出的结果并展示。
 * 不因渲染页面而重新生成 Review Snapshot（只读 PBStore 既有数据）。
 * 纯格式化/取值函数与 DOM 挂载逻辑分离：前者可在 Node 下单测，
 * 后者只在浏览器环境运行（UMD 包装，module.exports 分支不触碰 DOM）。
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
    section6: { en: '6 · Re-test / Promotion Review', zh: '6 · 复测 / 晋级复核' }
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
    INCOMPLETE: { kind: 'inc', label: 'INCOMPLETE' }
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
  function buildDomainSeriesModel(trendObj) {
    trendObj = trendObj || {};
    return {
      state: trendObj.state || 'INSUFFICIENT_EVIDENCE',
      evidenceMode: trendObj.evidence_mode || 'INCOMPLETE',
      baseline: fmtNumOrIncomplete(trendObj.baseline_value),
      current: fmtNumOrIncomplete(trendObj.current_value),
      delta: fmtNumOrIncomplete(trendObj.raw_delta),
      pointCount: trendObj.point_count || 0,
      missingPointCount: trendObj.missing_point_count || 0,
      series: (trendObj.series || []).map(function (s) { return { date: s.assessment_date, value: s.value }; })
    };
  }

  function buildCurrentStatusModel(snap, reassessment) {
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
      validatedLevel: 'INCOMPLETE', // 冻结规则：本系统从不写 validated_training_level / 自动晋级
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

  // ---- 主编排：把已取得的原始引擎输出整理成整页视图模型（纯函数，不发请求、不碰 DOM）----
  function buildReviewViewModel(input) {
    input = input || {};
    var trend = input.trend;
    if (!trend || !trend.assessment_count) {
      return { emptyState: true, message: t('noHistory') };
    }
    var snap = input.latestSnapshot || null;
    return {
      emptyState: false,
      assessmentCount: trend.assessment_count,
      historyState: trend.history_state,
      versionMixed: !!trend.version_mixed,
      currentStatus: buildCurrentStatusModel(snap, input.reassessment),
      capabilityTrend: buildCapabilityTrendModel(trend),
      matchTransfer: buildMatchTransferModel(snap, trend, input.latestRetestEntry),
      hardGates: buildHardGateRows(trend.hard_gate_trends),
      bottleneck: buildBottleneckModel(trend.bottleneck_movement),
      prescription: buildPrescriptionModel(input.prescription, input.retestSummary),
      reassessment: buildReassessmentModel(input.reassessment)
    };
  }

  // ---- 轻量 SVG 折线：只连接真实存在的点，缺失点不臆造插值；无预测、仅历史展示 ----
  function sparklineSVG(points, opts) {
    opts = opts || {};
    var w = opts.width || 220, h = opts.height || 40, pad = 5;
    var pts = (points || []).filter(function (p) { return p.value != null; });
    if (!pts.length) return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"></svg>';
    if (pts.length === 1) {
      return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><circle cx="' + (w / 2) + '" cy="' + (h / 2) + '" r="3" fill="var(--ink)"></circle></svg>';
    }
    var values = pts.map(function (p) { return p.value; });
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    if (min === max) { min -= 1; max += 1; }
    var stepX = (w - pad * 2) / (pts.length - 1);
    var coords = pts.map(function (p, i) {
      var x = pad + i * stepX;
      var y = pad + (h - pad * 2) * (1 - (p.value - min) / (max - min));
      return [x, y];
    });
    var path = coords.map(function (c, i) { return (i === 0 ? 'M' : 'L') + c[0].toFixed(1) + ',' + c[1].toFixed(1); }).join(' ');
    var dots = coords.map(function (c) { return '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="2.5" fill="var(--ink)"></circle>'; }).join('');
    return '<svg width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><path d="' + path + '" fill="none" stroke="var(--lime-deep,#2f6f5f)" stroke-width="2"></path>' + dots + '</svg>';
  }

  // ================= 以下为 DOM 渲染 / 数据编排（仅浏览器环境运行）=================

  var ROOT_ID = 'review-app';
  var el = null;
  var SELECTED_PLAYER_ID = null;

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

  function renderModelHTML(model) {
    if (model.emptyState) return '<div class="rv-mut" style="margin-top:10px">' + esc(model.message) + '</div>';
    var warn = model.versionMixed ? '<div class="rv-banner" style="border-color:var(--part);background:#fff8e8">' + esc(t('versionMixedWarning')) + '</div>' : '';
    return warn + renderSection1(model) + renderSection2(model) + renderSection3(model) + renderSection4(model) + renderSection5(model) + renderSection6(model);
  }

  function loadReviewData(player_id) {
    return Promise.all([
      PBTrend.forPlayer(player_id),
      PBRetest.getLatestReviewSnapshotForPlayer(player_id),
      PBRetest.prescriptionsForPlayer(player_id),
      PBRetest.getReassessmentSignalForPlayer(player_id)
    ]).then(function (r) {
      var trend = r[0], latestSnapRec = r[1], prescriptions = (r[2] || []).slice(), reassessment = r[3];
      prescriptions.sort(function (a, b) { return (a.created_at || '') < (b.created_at || '') ? -1 : ((a.created_at || '') > (b.created_at || '') ? 1 : 0); });
      var latestPrescription = prescriptions.length ? prescriptions[prescriptions.length - 1] : null;
      var summaryPromise = latestPrescription ? PBRetest.getPrescriptionRetestSummary(latestPrescription.prescription_id) : Promise.resolve(null);
      return summaryPromise.then(function (retestSummary) {
        var latestRetestEntry = (retestSummary && retestSummary.response_history.length)
          ? retestSummary.response_history[retestSummary.response_history.length - 1] : null;
        return buildReviewViewModel({
          trend: trend,
          latestSnapshot: latestSnapRec ? latestSnapRec.data : null,
          prescription: latestPrescription,
          retestSummary: retestSummary,
          reassessment: reassessment,
          latestRetestEntry: latestRetestEntry
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
    PBStore.listPlayers().then(function (players) {
      var header = renderPlayerPickerHTML(players);
      if (!players.length) { el.innerHTML = header; return; }
      if (!SELECTED_PLAYER_ID) { el.innerHTML = header + '<div class="rv-mut" style="margin-top:10px">' + esc(t('noPlayer')) + '</div>'; return; }
      el.innerHTML = header + '<div class="rv-mut" style="margin-top:10px">' + (LANG === 'en' ? 'Loading…' : '加载中…') + '</div>';
      loadReviewData(SELECTED_PLAYER_ID).then(function (model) {
        if (el) el.innerHTML = header + renderModelHTML(model);
      }).catch(function (e) {
        if (el) el.innerHTML = header + '<div class="rv-mut" style="color:var(--fail)">' + (LANG === 'en' ? 'Load failed: ' : '加载失败：') + esc(e.message) + '</div>';
      });
    });
  }

  function onClick(e) {
    var node = e.target.closest('[data-act]'); if (!node) return;
    var act = node.getAttribute('data-act');
    if (act === 'pick-player') { SELECTED_PLAYER_ID = node.getAttribute('data-pid'); render(); }
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
    stateBadgeMeta: stateBadgeMeta,
    sparklineSVG: sparklineSVG,
    fmtLevel: fmtLevel,

    // 供页面刷新调用（在浏览器环境挂载后可用）
    refresh: function () { render(); },
    _mount: mount
  };
});
