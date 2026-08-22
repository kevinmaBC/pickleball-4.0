/* ============================================================
 * home-priority-dashboard-ui.js — Pickleball App 2.0 Alpha · S11-B
 * Home / Priority Dashboard Experience — THIN UI LAYER.
 *
 * Renders the already-composed PBHomeDashboardAdapter View Model,
 * translates labels, and routes the single primary CTA to an existing
 * app view. This file implements no priority formula, no recommendation/
 * prescription mapping, no progress math, no workflow state transition,
 * and no reassessment logic of its own — every field it displays is
 * read verbatim from PBHomeDashboardAdapter.loadHomeDashboard()'s output
 * (which itself only ever reads already-computed S9/S10/S11-A data,
 * never recalculates it).
 *
 * Same UMD / pure-vs-DOM split js/training-ui.js and js/review-ui.js
 * already use: label/route/message builders take an explicit `en`
 * boolean and are pure (Node-testable, no DOM/PBStore/global LANG);
 * only the mount()/render() functions below touch the DOM, PBStore
 * (via the adapter), or the global LANG/go().
 *
 * Mount point: #home-priority-dashboard-app (HOME page, S11-B panel,
 * placed after the existing Hero and before S8-E's Today's Training).
 * ============================================================ */
(function (root, factory) {
  var pure = factory();
  if (typeof module === 'object' && module.exports) { module.exports = pure; return; }
  root.PBHomeDashboardUI = pure;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pure._mount);
    else pure._mount();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ================================================================
  // §10 Journey Stage bilingual labels — frozen core mapping.
  // ================================================================
  var STAGE_LABELS = {
    NEEDS_ASSESSMENT: { zh: '需要评估', en: 'Assessment Needed' },
    REVIEW_RECOMMENDATION: { zh: '查看训练重点', en: 'Review Focus' },
    READY_TO_TRAIN: { zh: '可以开始训练', en: 'Ready to Train' },
    TRAINING_IN_PROGRESS: { zh: '训练进行中', en: 'Training in Progress' },
    REVIEW_PROGRESS: { zh: '查看训练进步', en: 'Review Progress' },
    READY_TO_REASSESS: { zh: '需要比赛复测', en: 'Match Reassessment Required' },
    CYCLE_COMPLETE: { zh: '本周期完成', en: 'Cycle Complete' }
  };
  function stageLabel(stage, en) {
    var m = STAGE_LABELS[stage];
    if (!m) return stage || (en ? 'Unknown' : '未知状态');
    return en ? m.en : m.zh;
  }

  var STATUS_LABELS = {
    READY: { zh: '就绪', en: 'Ready' },
    PARTIAL: { zh: '部分可用', en: 'Partial' },
    UNRESOLVED: { zh: '尚未解析', en: 'Unresolved' },
    BLOCKED: { zh: '受限', en: 'Blocked' }
  };
  function statusLabel(status, en) {
    var m = STATUS_LABELS[status];
    if (!m) return status || '';
    return en ? m.en : m.zh;
  }

  // ================================================================
  // §11/§15 Next-action vocabulary -> bilingual CTA label + existing-view route.
  // ACTIVATE_PRESCRIPTION has no dedicated route yet: it routes to Review (where
  // the recommendation/prescription detail already lives) WITHOUT pretending any
  // domain mutation happened — §16 "no unauthorized domain mutation in S11-B".
  // ================================================================
  var NEXT_ACTION_LABELS = {
    START_ASSESSMENT: { zh: '开始评估', en: 'Start Assessment' },
    REVIEW_RECOMMENDATION: { zh: '查看训练重点', en: 'Review Recommendation' },
    ACTIVATE_PRESCRIPTION: { zh: '查看处方详情', en: 'View Prescription' },
    START_TRAINING: { zh: '开始训练', en: 'Start Training' },
    CONTINUE_TRAINING: { zh: '继续训练', en: 'Continue Training' },
    RESUME_SESSION: { zh: '继续本节', en: 'Resume Session' },
    REVIEW_PROGRESS: { zh: '查看进步', en: 'Review Progress' },
    RECORD_REAL_MATCH: { zh: '记录真实比赛', en: 'Record Real Match' },
    REVIEW_REASSESSMENT: { zh: '查看复测结果', en: 'Review Reassessment' },
    START_NEXT_CYCLE: { zh: '开始下一周期', en: 'Start Next Cycle' },
    NONE: { zh: '暂无可用操作', en: 'No Action Available' }
  };
  function nextActionLabel(code, en) {
    var m = NEXT_ACTION_LABELS[code];
    if (!m) return code || '';
    return en ? m.en : m.zh;
  }

  // §29 (S11-C): ACTIVATE_PRESCRIPTION/START_TRAINING/CONTINUE_TRAINING/RESUME_SESSION route into
  // the S11-C Guided Training Action Flow (js/guided-training-ui.js) instead of the old S8 `drill`
  // flow — S9/S10 Prescription Workflow lineage is a different FK lineage than S8 TrainingCycle/
  // SessionPlan, and S11-C is the only place authorized to drive that lineage's mutations.
  // §21 (S11-D): REVIEW_PROGRESS/REVIEW_REASSESSMENT route into the S11-D Progress/Reassessment
  // Experience (js/progress-reassessment-ui.js); RECORD_REAL_MATCH stays on `measure` — S11-D
  // does not own Match Observation.
  var NEXT_ACTION_ROUTES = {
    START_ASSESSMENT: 'measure',
    REVIEW_RECOMMENDATION: 'review',
    ACTIVATE_PRESCRIPTION: 'guided',
    START_TRAINING: 'guided',
    CONTINUE_TRAINING: 'guided',
    RESUME_SESSION: 'guided',
    REVIEW_PROGRESS: 'progress',
    RECORD_REAL_MATCH: 'measure',
    REVIEW_REASSESSMENT: 'progress',
    START_NEXT_CYCLE: 'measure',
    NONE: null
  };
  var GUIDED_TRAINING_ACTIONS = ['ACTIVATE_PRESCRIPTION', 'START_TRAINING', 'CONTINUE_TRAINING', 'RESUME_SESSION'];
  function routeForNextAction(code) {
    return Object.prototype.hasOwnProperty.call(NEXT_ACTION_ROUTES, code) ? NEXT_ACTION_ROUTES[code] : null;
  }

  // ================================================================
  // §14/§18/§20 Known presentation flags -> honest bilingual messages. Unknown flag codes are
  // never translated into invented text (§12 "no unsupported statements") — they simply render
  // nothing here (the raw code itself stays traceable in the underlying View Model/journey data).
  // ================================================================
  var FLAG_MESSAGES = {
    DRILL_UNRESOLVED: { zh: '训练方向已确定，具体 Drill 尚未解析。', en: 'Training direction is available. Specific drill is not yet resolved.' },
    KPI_TARGET_UNRESOLVED: { zh: '训练目标基准（KPI Target）尚未确定。', en: 'KPI target benchmark is not yet resolved.' },
    REASSESSMENT_REQUIRED: { zh: '出现新证据，需要复测。', en: 'New evidence is available. Reassessment is required.' },
    STALE_RECOMMENDATION: { zh: '此前的训练重点已过期，等待复测更新。', en: 'The previous recommendation is stale, pending reassessment.' },
    STALE_PRESCRIPTION: { zh: '此前的训练处方已过期，等待复测更新。', en: 'The previous prescription is stale, pending reassessment.' },
    PROGRESS_NOT_YET_AVAILABLE: { zh: '训练进步数据尚不可用。', en: 'Training progress data is not yet available.' },
    PRESCRIPTION_WORKFLOW_UNAVAILABLE: { zh: '训练处方流程数据不可用，暂无法激活。', en: 'Prescription workflow data is unavailable — cannot activate yet.' },
    RECOMMENDATION_RANK_UNRESOLVED: { zh: '优先级排序尚未确定。', en: 'Priority rank is not yet resolved.' },
    NO_RECOMMENDATION: { zh: '暂无可用的训练重点建议。', en: 'No recommendation is available yet.' }
  };
  // §19/§20 fixed methodology wording — always shown verbatim for these two conditions, never
  // paraphrased per-call.
  var MATCH_TRANSFER_METHODOLOGY = { zh: '训练进步尚不能等同于比赛能力提升，需要真实比赛验证。', en: 'Training progress does not yet confirm match transfer. A real match reassessment is required.' };
  var MATCH_TRANSFER_UNVALIDATED = { zh: '比赛迁移：尚未验证', en: 'Match Transfer: Not yet validated' };

  function flagMessage(code, en) {
    var m = FLAG_MESSAGES[code];
    if (!m) return null;
    return en ? m.en : m.zh;
  }

  // §21 New Player Empty State — the single frozen default PBProductJourney.projectJourney
  // itself always returns for "no active cycle" (verified by tests/product-journey-orchestrator
  // .test.js's own T01/T11). Used directly (no PBStore/adapter round-trip needed) when there is
  // not yet even one player record, so a first-time user is never shown a bare dead end.
  var NO_PLAYER_HOME_DASHBOARD = {
    player_id: null,
    journey: { stage: 'NEEDS_ASSESSMENT', status: 'READY', headline_code: 'NO_ACTIVE_CYCLE' },
    focus: null, why: null, training: null,
    next_action: { code: 'START_ASSESSMENT', enabled: true, target_ref: null },
    flags: [], schema_version: '1.0', view_version: 'S11-B-V1'
  };

  // ================================================================
  // §9 Pure panel renderer — data -> HTML string, no DOM access, explicit `en` (no global LANG
  // dependency), so it is directly Node-testable like the label/route helpers above.
  // ================================================================

  function renderHomePanelHTML(home_dashboard, en) {
    var m = home_dashboard || {};
    var journey = m.journey || {};
    var na = m.next_action || { code: 'NONE', enabled: false, target_ref: null };
    var flags = Array.isArray(m.flags) ? m.flags : [];

    var journeyHTML = '<div class="hpd-section">' +
      '<div class="hpd-label">' + (en ? 'Journey Status' : '进度状态') + '</div>' +
      '<div class="hpd-stage-row">' +
      '<span class="hpd-badge hpd-stage-' + esc(journey.stage || 'UNKNOWN') + '">' + esc(stageLabel(journey.stage, en)) + '</span>' +
      '<span class="hpd-mut">' + esc(statusLabel(journey.status, en)) + '</span>' +
      '</div></div>';

    var focusHTML;
    if (m.focus) {
      var f = m.focus;
      focusHTML = '<div class="hpd-card">' +
        (f.rank != null ? '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Rank' : '排名') + '</span><b>#' + esc(f.rank) + '</b></div>' : '') +
        (f.priority_tier ? '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Priority' : '优先级') + '</span><b>' + esc(f.priority_tier) + '</b></div>' : '') +
        (f.skill ? '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Skill' : '技术项') + '</span><b>' + esc(f.skill) + (f.context ? ' · ' + esc(f.context) : '') + '</b></div>' : '') +
        (f.recommendation_code ? '<div class="hpd-row" style="border:none"><span class="hpd-mut">' + (en ? 'Recommendation' : '建议') + '</span><b>' + esc(f.recommendation_code) + '</b></div>' : '') +
        '</div>';
    } else {
      focusHTML = '<div class="hpd-mut">' + (en ? 'Not available yet' : '暂无数据') + '</div>';
    }

    var whyHTML;
    if (m.why && ((m.why.source_skill_gap_ids && m.why.source_skill_gap_ids.length) || (m.why.evidence_pattern_ids && m.why.evidence_pattern_ids.length) || (m.why.evidence_refs && m.why.evidence_refs.length))) {
      var w = m.why;
      whyHTML = '<div class="hpd-mut">' +
        (w.source_skill_gap_ids.length ? (en ? 'Skill gaps: ' : '技术缺口：') + esc(w.source_skill_gap_ids.join(', ')) + '<br>' : '') +
        (w.evidence_pattern_ids.length ? (en ? 'Evidence patterns: ' : '证据模式：') + esc(w.evidence_pattern_ids.join(', ')) + '<br>' : '') +
        (w.evidence_refs.length ? (en ? 'Evidence: ' : '证据：') + esc(w.evidence_refs.join(', ')) : '') +
        '</div>';
    } else if (m.assessment && m.assessment.assessment_exists && m.assessment.traceability_available) {
      // POST-S11-R3B-2 §8: an assessment with recorded evidence must never be reported as
      // "no traceability data" just because no recommendation has been produced yet.
      whyHTML = '<div class="hpd-mut">' + (en
        ? 'Assessment evidence recorded (' + esc(m.assessment.evidence_status) + ') — not yet linked to a training recommendation.'
        : '已记录评估证据（' + esc(m.assessment.evidence_status) + '）— 尚未关联训练建议。') + '</div>';
    } else {
      whyHTML = '<div class="hpd-mut">' + (en ? 'No traceability data yet' : '暂无可追溯依据') + '</div>';
    }

    // POST-S11-R3B-2: honest, additive Assessment Evidence section — presentation-only branching
    // over facts already decided by js/assessment-journey-bridge.js; renders nothing when there
    // is no assessment_context at all (never fabricates one).
    var assessmentHTML = '';
    if (m.assessment && m.assessment.assessment_exists) {
      var asmt = m.assessment;
      assessmentHTML = '<div class="hpd-section"><div class="hpd-label">' + (en ? 'Assessment Evidence' : '评估证据') + '</div>' +
        '<div class="hpd-mut">' +
        (en ? 'Status: ' : '状态：') + esc(asmt.assessment_status) +
        ' · ' + (en ? 'Evidence: ' : '证据：') + esc(asmt.evidence_status) +
        ' · ' + (en ? 'Recommendation eligible: ' : '可生成训练建议：') + (asmt.recommendation_eligible ? (en ? 'Yes' : '是') : (en ? 'Not yet' : '尚未')) +
        '</div></div>';
    }

    var trainingHTML;
    if (m.training) {
      var t = m.training;
      trainingHTML = '<div class="hpd-card">' +
        (t.objective ? '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Objective' : '训练目标') + '</span><b>' + esc(t.objective) + '</b></div>' : '') +
        (t.mode ? '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Mode' : '训练方式') + '</span><b>' + esc(t.mode) + '</b></div>' : '') +
        (t.drill_family ? '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Drill Family' : 'Drill 类别') + '</span><b>' + esc(t.drill_family) + '</b></div>' : '') +
        (t.kpi_profile ? '<div class="hpd-row" style="border:none"><span class="hpd-mut">KPI</span><b>' + esc(t.kpi_profile) + '</b></div>' : '') +
        '</div>' +
        (t.drill_resolution_status === 'UNRESOLVED' ? '<div class="hpd-banner">' + esc(flagMessage('DRILL_UNRESOLVED', en)) + '</div>' : '') +
        (t.kpi_target_status === 'BENCHMARK_NOT_RESOLVED' ? '<div class="hpd-mut">' + esc(flagMessage('KPI_TARGET_UNRESOLVED', en)) + '</div>' : '');
    } else {
      trainingHTML = '<div class="hpd-mut">' + (en ? 'Not yet available' : '尚未可用') + '</div>';
    }

    // §18/§19 reassessment banner — only for READY_TO_REASSESS, always with the fixed
    // methodology wording, never implying validated-level promotion.
    var reassessHTML = '';
    if (journey.stage === 'READY_TO_REASSESS') {
      reassessHTML = '<div class="hpd-banner hpd-warn">' + (en ? 'Match Reassessment Required' : '需要比赛复测') + '</div>' +
        '<div class="hpd-mut" style="margin-bottom:8px">' + esc(en ? MATCH_TRANSFER_METHODOLOGY.en : MATCH_TRANSFER_METHODOLOGY.zh) + '</div>';
    }

    // §20 MATCH transfer honesty — shown whenever the composed flags say MATCH progress isn't
    // a genuinely resolved value (adapter-level decision, never fabricated here).
    var matchHTML = (flags.indexOf('MATCH_TRANSFER_NOT_VALIDATED') !== -1 || flags.indexOf('MATCH_PROGRESS_INSUFFICIENT_DATA') !== -1)
      ? '<div class="hpd-mut">' + esc(en ? MATCH_TRANSFER_UNVALIDATED.en : MATCH_TRANSFER_UNVALIDATED.zh) + '</div>' : '';

    // Any other known flag not already rendered inline above (e.g. STALE_*, REASSESSMENT_REQUIRED
    // outside the dedicated banner, NO_RECOMMENDATION) gets its own honest line.
    var INLINE_HANDLED = ['DRILL_UNRESOLVED', 'KPI_TARGET_UNRESOLVED', 'MATCH_TRANSFER_NOT_VALIDATED', 'MATCH_PROGRESS_INSUFFICIENT_DATA'];
    var extraFlagsHTML = flags.filter(function (c) { return INLINE_HANDLED.indexOf(c) === -1; })
      .map(function (c) { var msg = flagMessage(c, en); return msg ? '<div class="hpd-mut">' + esc(msg) + '</div>' : ''; })
      .join('');

    var ctaLabel = esc(nextActionLabel(na.code, en));
    var ctaHTML = '<button class="btn solid hpd-cta" data-act="cta" data-code="' + esc(na.code) + '" data-target-ref="' + esc(na.target_ref) + '" data-primary-cta="1"' + (na.enabled ? '' : ' disabled') + '>' + ctaLabel + '</button>' +
      (!na.enabled ? '<div class="hpd-mut" style="margin-top:6px">' + (en ? 'Not available yet.' : '暂不可用。') + '</div>' : '');

    return journeyHTML +
      assessmentHTML +
      '<div class="hpd-section"><div class="hpd-label">' + (en ? 'Current Focus' : '当前重点') + '</div>' + focusHTML + '</div>' +
      '<div class="hpd-section"><div class="hpd-label">' + (en ? 'Why This Matters' : '为什么重要') + '</div>' + whyHTML + '</div>' +
      '<div class="hpd-section"><div class="hpd-label">' + (en ? 'Training Direction' : '训练方向') + '</div>' + trainingHTML + '</div>' +
      reassessHTML + matchHTML + extraFlagsHTML +
      '<div class="hpd-section" style="margin-top:12px">' + ctaHTML + '</div>';
  }

  // ================= 以下为 DOM 渲染 / 数据编排（仅浏览器环境运行）=================

  var ROOT_ID = 'home-priority-dashboard-app';
  var rootEl = null;
  var SELECTED_PLAYER_ID = null;

  function isEN() { return typeof LANG !== 'undefined' && LANG === 'en'; }

  function modulesReady() {
    return typeof PBStore !== 'undefined' && typeof PBHomeDashboardAdapter !== 'undefined';
  }

  function loadingHTML() { return '<div class="hpd-mut" style="margin-top:10px">' + (isEN() ? 'Loading…' : '加载中…') + '</div>'; }
  function errorHTML(e) { return '<div class="hpd-mut" style="color:var(--fail);margin-top:10px">' + (isEN() ? 'Load failed: ' : '加载失败：') + esc(e && e.message) + '</div>'; }

  function playerPickerHTML(players) {
    if (players.length <= 1) return '';
    var chips = players.map(function (p) {
      return '<span class="hpd-chip' + (SELECTED_PLAYER_ID === p.player_id ? ' sel' : '') + '" data-act="pick-player" data-pid="' + esc(p.player_id) + '">' + esc(p.display_name) + '</span>';
    }).join('');
    return '<div class="hpd-mut">' + (isEN() ? 'Player' : '球员') + '</div><div style="margin-bottom:8px">' + chips + '</div>';
  }

  function render() {
    if (!rootEl) return;
    var store = PBStore;
    store.listPlayers().then(function (players) {
      // §21 New Player Empty State: not even one player record exists yet — never a dead end,
      // always the same frozen "no active cycle" default (see NO_PLAYER_HOME_DASHBOARD above).
      if (!players.length) { rootEl.innerHTML = renderHomePanelHTML(NO_PLAYER_HOME_DASHBOARD, isEN()); return; }
      if (!SELECTED_PLAYER_ID) SELECTED_PLAYER_ID = players[0].player_id;
      var header = playerPickerHTML(players);
      rootEl.innerHTML = header + loadingHTML();
      PBHomeDashboardAdapter.loadHomeDashboard(SELECTED_PLAYER_ID).then(function (result) {
        if (!rootEl) return;
        rootEl.innerHTML = header + renderHomePanelHTML(result.home_dashboard, isEN());
      }).catch(function (e) {
        if (rootEl) rootEl.innerHTML = header + errorHTML(e);
      });
    }).catch(function (e) {
      if (rootEl) rootEl.innerHTML = errorHTML(e);
    });
  }

  function gotoTab(tabName) { if (tabName && typeof go === 'function') go(tabName); }

  function onClick(e) {
    var node = e.target.closest('[data-act]'); if (!node) return;
    var act = node.getAttribute('data-act');
    if (act === 'pick-player') { SELECTED_PLAYER_ID = node.getAttribute('data-pid'); render(); return; }
    if (act === 'cta') {
      if (node.hasAttribute('disabled')) return;
      var code = node.getAttribute('data-code');
      var targetRef = node.getAttribute('data-target-ref');
      // §29: hand off to the S11-C Guided Training Action Flow for the four guided actions —
      // this file never performs the mutation itself, only routes with the minimal context
      // (workflow_id/player_id) PBGuidedTrainingUI needs to resolve state on its own.
      if (GUIDED_TRAINING_ACTIONS.indexOf(code) !== -1 && window.PBGuidedTrainingUI && typeof window.PBGuidedTrainingUI.openForAction === 'function') {
        window.PBGuidedTrainingUI.openForAction({ code: code, workflow_id: targetRef, player_id: SELECTED_PLAYER_ID });
      }
      gotoTab(routeForNextAction(code));
    }
  }

  function mount() {
    rootEl = document.getElementById(ROOT_ID);
    if (!rootEl) return;
    rootEl.addEventListener('click', onClick);
    if (!modulesReady()) {
      rootEl.innerHTML = '<div class="hpd-mut">' + (isEN() ? 'Home module not ready (PBStore/PBHomeDashboardAdapter not loaded).' : '首页模块未就绪（PBStore/PBHomeDashboardAdapter 未加载）。') + '</div>';
      return;
    }
    render();
  }

  return {
    // pure (Node-testable, no DOM/PBStore/global LANG)
    STAGE_LABELS: STAGE_LABELS,
    NEXT_ACTION_ROUTES: NEXT_ACTION_ROUTES,
    stageLabel: stageLabel,
    statusLabel: statusLabel,
    nextActionLabel: nextActionLabel,
    routeForNextAction: routeForNextAction,
    flagMessage: flagMessage,
    renderHomePanelHTML: renderHomePanelHTML,
    NO_PLAYER_HOME_DASHBOARD: NO_PLAYER_HOME_DASHBOARD,

    // 供页面刷新调用（在浏览器环境挂载后可用）
    refresh: function () { render(); },
    _mount: mount
  };
});
