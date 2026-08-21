/* ============================================================
 * progress-reassessment-ui.js — Pickleball App 2.0 Alpha · S11-D
 * Progress / Reassessment Experience — THIN UI LAYER.
 *
 * Renders the already-composed PBProgressReassessmentAdapter View
 * Model, translates labels, and routes the single primary CTA to an
 * existing app view. No progress formula, no recommendation/
 * prescription mapping, no reassessment logic, no level-promotion
 * wording lives here — every field is read verbatim from
 * PBProgressReassessmentAdapter.loadProgressReassessment()'s output.
 *
 * Same UMD / pure-vs-DOM split every other *-ui.js module in this repo
 * already uses: label/format/route builders take an explicit `en`
 * boolean and are pure (Node-testable, no DOM/PBStore/global LANG);
 * only mount()/render()/onClick() touch the DOM or the adapter.
 *
 * Mount point: #progress-reassessment-app (dedicated `#v-progress`
 * view, reached via HOME's REVIEW_PROGRESS/REVIEW_REASSESSMENT CTA
 * routing and Guided Training's post-completion routing).
 * ============================================================ */
(function (root, factory) {
  var pure = factory();
  if (typeof module === 'object' && module.exports) { module.exports = pure; return; }
  root.PBProgressReassessmentUI = pure;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pure._mount);
    else pure._mount();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ================================================================
  // §12 Trend vocabulary — bilingual, exactly the upstream values, no invented thresholds.
  // ================================================================
  var TREND_LABELS = {
    IMPROVING: { zh: '正在改善', en: 'Improving' },
    STABLE: { zh: '基本稳定', en: 'Stable' },
    DECLINING: { zh: '出现下降', en: 'Declining' },
    INSUFFICIENT_DATA: { zh: '数据不足', en: 'Insufficient Data' },
    UNRESOLVED: { zh: '尚未解析', en: 'Unresolved' }
  };
  function trendLabel(trend, en) {
    var m = TREND_LABELS[trend];
    if (!m) return trend || (en ? 'Unresolved' : '尚未解析');
    return en ? m.en : m.zh;
  }

  // §11: ratio/percentage formatting — never recompute, only format the existing S10-E value.
  function formatPercent(v) { return v == null ? '—' : (Math.round(v * 1000) / 10) + '%'; }
  function formatDeltaPP(v) {
    if (v == null) return '—';
    var pp = Math.round(v * 1000) / 10;
    var sign = pp > 0 ? '+' : '';
    return sign + pp;
  }

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

  // §21/§22: this page's own CTA routing — REVIEW_PROGRESS/REVIEW_REASSESSMENT stay on this
  // page; RECORD_REAL_MATCH always routes to Measure (S11-D does not own Match Observation);
  // training actions route into the S11-C Guided Training flow, matching HOME's own table.
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
  function routeForNextAction(code) {
    return Object.prototype.hasOwnProperty.call(NEXT_ACTION_ROUTES, code) ? NEXT_ACTION_ROUTES[code] : null;
  }

  // §17 fixed methodology wording — shown only when TRAINING is improving but MATCH transfer is
  // not yet validated (the specific scenario this sentence describes), never implying training
  // improvement alone confirms match performance.
  var MATCH_TRANSFER_METHODOLOGY = { zh: '训练表现正在改善，但是否已经转化为真实比赛能力，仍需要真实比赛验证。', en: 'Training performance may be improving, but match transfer still requires real-match validation.' };
  // §19 fixed reassessment banner wording.
  var REASSESSMENT_BANNER = { zh: '已进入真实比赛复测阶段', en: 'Ready for Match Reassessment' };
  var REASSESSMENT_EXPLAIN = { zh: '出现新的训练证据，现在需要真实比赛验证。', en: 'New training evidence exists. Real-match validation is now required.' };

  // ================================================================
  // §9 Pure screen renderer — data -> HTML string, no DOM access, explicit `en`.
  // ================================================================

  function renderProgressReassessmentHTML(m, en) {
    m = m || {};
    var cycle = m.cycle || null;
    var tp = m.training_progress || null;
    var mt = m.match_transfer || null;
    var reassessment = m.reassessment || { required: false, state: null };
    var na = m.next_action || { code: 'NONE', enabled: false, target_ref: null };

    // §25: nothing available at all — honest, never "everything is fine".
    if (!cycle) {
      var emptyCta = '<button class="btn solid hpd-cta gt-cta pr-cta" data-act="cta" data-code="' + esc(na.code) + '" data-primary-cta="1"' + (na.enabled ? '' : ' disabled') + '>' + esc(nextActionLabel(na.code, en)) + '</button>';
      return '<div class="hpd-mut">' + (en ? 'No training progress is available yet.' : '目前尚无可用的训练进步数据。') + '</div>' +
        '<div class="hpd-section" style="margin-top:12px">' + emptyCta + '</div>';
    }

    // §24 Cycle Summary.
    var cycleHTML = '<div class="hpd-section"><div class="hpd-label">' + (en ? 'Cycle Summary' : '周期概览') + '</div><div class="hpd-card gt-card">' +
      '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Cycle State' : '周期状态') + '</span><b>' + esc(cycle.state || (en ? 'Not available yet' : '暂无数据')) + '</b></div>' +
      (cycle.kpi_profile_code ? '<div class="hpd-row"><span class="hpd-mut">KPI</span><b>' + esc(cycle.kpi_profile_code) + '</b></div>' : '') +
      (cycle.training_objective_code ? '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Objective' : '训练目标') + '</span><b>' + esc(cycle.training_objective_code) + '</b></div>' : '') +
      (cycle.training_mode ? '<div class="hpd-row" style="border:none"><span class="hpd-mut">' + (en ? 'Mode' : '训练方式') + '</span><b>' + esc(cycle.training_mode) + '</b></div>' : '') +
      '</div></div>';

    // Training Progress.
    var trainingHTML = '<div class="hpd-section"><div class="hpd-label">' + (en ? 'Training Progress' : '训练进步') + '</div>';
    if (!tp || tp.status === 'BASELINE_UNRESOLVED') {
      trainingHTML += '<div class="hpd-mut">' + (en ? 'Baseline not available. Progress cannot yet be compared.' : '基准值不可用，暂无法比较训练进步。') + '</div>';
    } else if (tp.status === 'RESOLVED') {
      trainingHTML += '<div class="hpd-card gt-card">' +
        '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Baseline' : '基准值') + '</span><b>' + formatPercent(tp.baseline) + '</b></div>' +
        '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Current' : '当前值') + '</span><b>' + formatPercent(tp.current) + '</b></div>' +
        '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Change' : '变化') + '</span><b>' + formatDeltaPP(tp.delta) + ' ' + (en ? 'pp' : '个百分点') + '</b></div>' +
        '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Trend' : '趋势') + '</span><b>' + esc(trendLabel(tp.trend, en)) + '</b></div>' +
        '<div class="hpd-row" style="border:none"><span class="hpd-mut">' + (en ? 'Evidence' : '证据数量') + '</span><b>' + esc(tp.evidence_count) + ' ' + (en ? 'sessions' : '次') + '</b></div>' +
        '</div>';
    } else {
      trainingHTML += '<div class="hpd-mut">' + esc(trendLabel(tp.trend, en)) + (tp.evidence_count != null ? ' · ' + (en ? 'Evidence: ' : '证据：') + esc(tp.evidence_count) : '') + '</div>';
    }
    trainingHTML += '</div>';

    // Match Transfer — always a separate card, never merged with Training.
    var matchHTML = '<div class="hpd-section"><div class="hpd-label">' + (en ? 'Match Transfer' : '比赛迁移') + '</div>';
    if (!mt || mt.status !== 'RESOLVED') {
      matchHTML += '<div class="hpd-mut">' + (en ? 'Match KPI evidence is not yet available. Match Progress remains unresolved.' : '比赛 KPI 证据尚不可用，比赛进步仍未解析。') + '</div>';
      if (tp && tp.trend === 'IMPROVING') {
        matchHTML += '<div class="hpd-mut" style="margin-top:4px">' + esc(en ? MATCH_TRANSFER_METHODOLOGY.en : MATCH_TRANSFER_METHODOLOGY.zh) + '</div>';
      }
    } else {
      matchHTML += '<div class="hpd-card gt-card"><div class="hpd-row" style="border:none"><span class="hpd-mut">' + (en ? 'Match Progress' : '比赛进步') + '</span><b>' + formatPercent(mt.numeric_progress) + '</b></div></div>';
    }
    matchHTML += '</div>';

    // Reassessment Status — banner only when the authority actually says ready (§28 neutral otherwise).
    var reassessHTML = '<div class="hpd-section"><div class="hpd-label">' + (en ? 'Reassessment Status' : '复测状态') + '</div>';
    if (reassessment.required) {
      reassessHTML += '<div class="hpd-banner hpd-warn">' + esc(en ? REASSESSMENT_BANNER.en : REASSESSMENT_BANNER.zh) + '</div>' +
        '<div class="hpd-mut">' + esc(en ? REASSESSMENT_EXPLAIN.en : REASSESSMENT_EXPLAIN.zh) + '</div>';
    } else {
      reassessHTML += '<div class="hpd-mut">' + (en ? 'Reassessment is not currently required.' : '当前无需复测。') + '</div>';
    }
    if (reassessment.state) {
      reassessHTML += '<div class="hpd-mut" style="margin-top:4px">' + (en ? 'Latest reassessment: ' : '最近复测：') + esc(reassessment.state) + '</div>';
    }
    reassessHTML += '</div>';

    // Primary Next Action — exactly one, driven by S11-A.
    var ctaHTML = '<div class="hpd-section" style="margin-top:12px">' +
      '<button class="btn solid hpd-cta gt-cta pr-cta" data-act="cta" data-code="' + esc(na.code) + '" data-primary-cta="1"' + (na.enabled ? '' : ' disabled') + '>' + esc(nextActionLabel(na.code, en)) + '</button>' +
      (!na.enabled ? '<div class="hpd-mut" style="margin-top:6px">' + (en ? 'Not available yet.' : '暂不可用。') + '</div>' : '') +
      '</div>';

    return cycleHTML + trainingHTML + matchHTML + reassessHTML + ctaHTML;
  }

  // ================= 以下为 DOM 渲染 / 数据编排（仅浏览器环境运行）=================

  var ROOT_ID = 'progress-reassessment-app';
  var rootEl = null;
  var SELECTED_PLAYER_ID = null;

  function isEN() { return typeof LANG !== 'undefined' && LANG === 'en'; }
  function modulesReady() { return typeof PBStore !== 'undefined' && typeof PBProgressReassessmentAdapter !== 'undefined'; }
  function loadingHTML() { return '<div class="hpd-mut" style="margin-top:10px">' + (isEN() ? 'Loading…' : '加载中…') + '</div>'; }
  function errorHTML(e) { return '<div class="hpd-mut" style="color:var(--fail);margin-top:10px">' + (isEN() ? 'Load failed: ' : '加载失败：') + esc(e && e.message) + '</div>'; }

  function gotoTab(tabName) { if (tabName && typeof go === 'function') go(tabName); }

  function render() {
    if (!rootEl) return;
    var store = PBStore;
    store.listPlayers().then(function (players) {
      if (!players.length) { rootEl.innerHTML = '<div class="hpd-mut">' + (isEN() ? 'No players yet.' : '暂无球员。') + '</div>'; return; }
      if (!SELECTED_PLAYER_ID) SELECTED_PLAYER_ID = players[0].player_id;
      rootEl.innerHTML = loadingHTML();
      PBProgressReassessmentAdapter.loadProgressReassessment(SELECTED_PLAYER_ID).then(function (result) {
        if (!rootEl) return;
        rootEl.innerHTML = renderProgressReassessmentHTML(result.progress_reassessment, isEN());
      }).catch(function (e) {
        if (rootEl) rootEl.innerHTML = errorHTML(e);
      });
    }).catch(function (e) {
      if (rootEl) rootEl.innerHTML = errorHTML(e);
    });
  }

  function onClick(e) {
    var node = e.target.closest('[data-act]'); if (!node) return;
    var act = node.getAttribute('data-act');
    if (act === 'cta') {
      if (node.hasAttribute('disabled')) return;
      gotoTab(routeForNextAction(node.getAttribute('data-code')));
    }
  }

  function mount() {
    rootEl = document.getElementById(ROOT_ID);
    if (!rootEl) return;
    rootEl.addEventListener('click', onClick);
    if (!modulesReady()) {
      rootEl.innerHTML = '<div class="hpd-mut">' + (isEN() ? 'Progress module not ready.' : '进步模块未就绪。') + '</div>';
      return;
    }
    render();
  }

  return {
    // pure (Node-testable, no DOM/PBStore/global LANG)
    trendLabel: trendLabel,
    formatPercent: formatPercent,
    formatDeltaPP: formatDeltaPP,
    nextActionLabel: nextActionLabel,
    routeForNextAction: routeForNextAction,
    renderProgressReassessmentHTML: renderProgressReassessmentHTML,

    // browser-only
    refresh: function () { render(); },
    _mount: mount
  };
});
