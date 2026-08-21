/* ============================================================
 * history-explainability-ui.js — Pickleball App 2.0 Alpha · S11-E
 * History / Explainability / Recovery — THIN UI LAYER.
 *
 * Renders the already-composed PBHistoryExplainabilityAdapter View
 * Model: cycle list, selected-cycle timeline, "Why This Training?"
 * traceability, evidence lineage, recovery status, and integrity
 * warnings. No priority formula, no recommendation/prescription
 * mapping, no progress math, no reassessment logic, and no free-form
 * causal explanation live here — every field is read verbatim from
 * PBHistoryExplainabilityAdapter.loadHistoryExplainability()'s output.
 *
 * History is secondary navigation only (§10) — it never renders a
 * primary CTA and never substitutes for journey.next_action (owned by
 * S11-A/S11-B/S11-D).
 *
 * Same UMD / pure-vs-DOM split every other *-ui.js module in this repo
 * already uses: label/format builders and the pure (model, opts) -> HTML
 * renderHistoryExplainabilityHTML function take an explicit `en`
 * boolean and are Node-testable (no DOM/PBStore/global LANG); only
 * mount()/render()/onClick() touch the DOM or the adapter.
 *
 * Mount point: #history-explainability-app (dedicated `#v-history`
 * view, reached only via minimal secondary navigation — never a
 * bottom-nav tab, per §8 "add only minimal navigation wiring").
 * ============================================================ */
(function (root, factory) {
  var pure = factory();
  if (typeof module === 'object' && module.exports) { module.exports = pure; return; }
  root.PBHistoryExplainabilityUI = pure;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pure._mount);
    else pure._mount();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ================================================================
  // §35 Bilingual core labels — frozen minimum.
  // ================================================================
  var CORE_LABELS = {
    history: { zh: '历史', en: 'History' },
    timeline: { zh: '发展时间线', en: 'Development Timeline' },
    whyThisTraining: { zh: '为什么练这个？', en: 'Why This Training?' },
    evidenceLineage: { zh: '证据链', en: 'Evidence Lineage' },
    recoveryStatus: { zh: '恢复状态', en: 'Recovery Status' },
    currentCycle: { zh: '当前周期', en: 'Current Cycle' },
    historicalCycle: { zh: '历史周期', en: 'Historical Cycle' },
    partiallyRecoverable: { zh: '可部分恢复', en: 'Partially Recoverable' },
    dataUnavailable: { zh: '数据不可用', en: 'Data Unavailable' },
    integrityWarning: { zh: '数据一致性警告', en: 'Integrity Warning' }
  };
  function coreLabel(key, en) { var m = CORE_LABELS[key]; return m ? (en ? m.en : m.zh) : key; }

  // §12 Timeline vocabulary — bilingual, fixed.
  var EVENT_LABELS = {
    CYCLE_CREATED: { zh: '周期创建', en: 'Cycle Created' },
    BASELINE_AVAILABLE: { zh: '基准值可用', en: 'Baseline Available' },
    PRESCRIPTION_WORKFLOW_CREATED: { zh: '处方流程创建', en: 'Prescription Workflow Created' },
    PRESCRIPTION_ACTIVATED: { zh: '处方已激活', en: 'Prescription Activated' },
    TRAINING_STARTED: { zh: '训练已开始', en: 'Training Started' },
    SESSION_COMPLETED: { zh: '训练完成', en: 'Session Completed' },
    TRAINING_EVIDENCE_RECORDED: { zh: '已记录训练证据', en: 'Training Evidence Recorded' },
    PROGRESS_AVAILABLE: { zh: '进步数据可用', en: 'Progress Available' },
    REASSESSMENT_REQUIRED: { zh: '需要比赛复测', en: 'Match Reassessment Required' },
    REASSESSMENT_COMPLETED: { zh: '复测已完成', en: 'Reassessment Completed' },
    CYCLE_COMPLETED: { zh: '周期已完成', en: 'Cycle Completed' }
  };
  function eventTypeLabel(type, en) {
    var m = EVENT_LABELS[type];
    if (!m) return type || '';
    return en ? m.en : m.zh;
  }

  // §26/§28 Recovery vocabulary.
  var RECOVERY_STATUS_LABELS = {
    FULL: { zh: '完全可恢复', en: 'Fully Recoverable' },
    PARTIAL: { zh: '可部分恢复', en: 'Partially Recoverable' },
    LIMITED: { zh: '恢复受限', en: 'Limited' }
  };
  function recoveryStatusLabel(status, en) {
    var m = RECOVERY_STATUS_LABELS[status];
    if (!m) return status || '';
    return en ? m.en : m.zh;
  }

  var RECOVERY_FLAG_MESSAGES = {
    BASELINE_UNAVAILABLE: { zh: '基准值不可用。', en: 'Baseline not available.' },
    MATCH_PROGRESS_UNRESOLVED: { zh: '比赛进步：数据不足 / 尚不可用。', en: 'Match Progress: Insufficient Data / Not durably available.' },
    ACTIVE_SESSION_NOT_DURABLE: { zh: '上一次进行中的训练未保留，无法直接恢复。', en: 'The previous active training session was not preserved and cannot be resumed directly.' },
    S9_DETAIL_NOT_DURABLE: { zh: '详细的推荐说明未持久保存，无法在此历史记录中查看。', en: 'Detailed recommendation explanation is not durably available for this historical record.' }
  };
  function recoveryFlagMessage(flag, en) {
    var m = RECOVERY_FLAG_MESSAGES[flag];
    if (!m) return null;
    return en ? m.en : m.zh;
  }

  var INTEGRITY_FLAG_MESSAGES = {
    ORPHAN_WORKFLOW_REF: { zh: '发现处方流程引用未关联到任何周期。', en: 'A prescription workflow reference is not linked to any cycle.' },
    ORPHAN_EVIDENCE_REF: { zh: '发现训练证据未关联到任何周期。', en: 'A training evidence record is not linked to any cycle.' },
    SESSION_RESULT_WITHOUT_EVIDENCE: { zh: '存在训练结果但未生成对应证据（如 0 次尝试）。', en: 'A session result exists without corresponding evidence (e.g. a 0-attempt session).' }
  };
  function integrityFlagMessage(flag, en) {
    var m = INTEGRITY_FLAG_MESSAGES[flag];
    if (!m) return null;
    return en ? m.en : m.zh;
  }

  function fmtPercent(v) { return v == null ? '—' : (Math.round(v * 1000) / 10) + '%'; }

  // ================================================================
  // §9/§33 Pure sub-renderers — data -> HTML string, no DOM access.
  // ================================================================

  function renderCycleListHTML(cycles, en, selectedCycleId) {
    if (!cycles.length) return '<div class="hpd-mut">' + (en ? 'No cycles yet.' : '暂无周期。') + '</div>';
    return '<div class="he-cyclist">' + cycles.map(function (c) {
      var sel = (selectedCycleId ? c.cycle_id === selectedCycleId : c.is_current) ? ' sel' : '';
      var marker = c.is_current ? coreLabel('currentCycle', en) : coreLabel('historicalCycle', en);
      return '<span class="hpd-chip' + sel + '" data-act="pick-cycle" data-cid="' + esc(c.cycle_id) + '">' + esc(marker) + ' · ' + esc(c.state) + '</span>';
    }).join('') + '</div>';
  }

  function renderTimelineHTML(timeline, en, detailMode) {
    if (!timeline || !timeline.length) return '<div class="hpd-mut">' + (en ? 'No timeline events yet.' : '暂无时间线事件。') + '</div>';
    return '<div class="he-timeline">' + timeline.map(function (ev) {
      var time = ev.time_status === 'KNOWN' ? esc(ev.occurred_at) : (en ? 'Unknown time' : '时间未知');
      var detail = detailMode ? ('<div class="hpd-mut he-detail">' + esc(ev.type) + (ev.ref ? ' · ' + esc(ev.ref) : '') + '</div>') : '';
      return '<div class="he-event"><div class="he-event-row"><b>' + esc(eventTypeLabel(ev.type, en)) + '</b><span class="hpd-mut">' + time + '</span></div>' + detail + '</div>';
    }).join('') + '</div>';
  }

  function renderWhyThisTrainingHTML(ws, en, detailMode) {
    if (!ws) return '<div class="hpd-mut">' + (en ? 'Not available yet.' : '暂无数据。') + '</div>';
    var html = '<div class="hpd-card gt-card">' +
      (ws.recommendation_ref ? '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Recommendation Ref' : '建议引用') + '</span><b>' + esc(ws.recommendation_ref) + '</b></div>' : '') +
      (ws.priority_rank != null ? '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Priority' : '优先级') + '</span><b>#' + esc(ws.priority_rank) + (ws.priority_tier ? ' / ' + esc(ws.priority_tier) : '') + '</b></div>' : '') +
      (ws.training_objective_code ? '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Training Objective' : '训练目标') + '</span><b>' + esc(ws.training_objective_code) + '</b></div>' : '') +
      (ws.training_mode ? '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Training Mode' : '训练方式') + '</span><b>' + esc(ws.training_mode) + '</b></div>' : '') +
      (ws.kpi_profile_code ? '<div class="hpd-row" style="border:none"><span class="hpd-mut">KPI</span><b>' + esc(ws.kpi_profile_code) + '</b></div>' : '') +
      '</div><div class="hpd-mut">' + (en ? 'Source: Persisted Prescription Workflow Snapshot' : '来源：已持久保存的处方流程快照') + '</div>';
    if (detailMode) {
      html += '<div class="hpd-mut he-detail">' + (en ? 'workflow_id' : 'workflow_id') + ': ' + esc(ws.workflow_id) + ' · state: ' + esc(ws.workflow_state) +
        (ws.drill_resolution_status ? ' · drill_resolution_status: ' + esc(ws.drill_resolution_status) : '') +
        (ws.kpi_target_status ? ' · kpi_target_status: ' + esc(ws.kpi_target_status) : '') + '</div>';
    }
    html += '<div class="hpd-mut">' + (en ? 'Detailed recommendation explanation: Not durably available for this historical record.' : '详细的推荐说明：未持久保存，无法在此历史记录中查看。') + '</div>';
    return html;
  }

  function renderEvidenceLineageHTML(lineage, en, detailMode) {
    if (!lineage || !lineage.length) return '<div class="hpd-mut">' + (en ? 'No evidence lineage yet.' : '暂无证据链。') + '</div>';
    return lineage.map(function (item) {
      var head = '<div class="hpd-card gt-card">' +
        '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Result' : '结果') + '</span><b>' + fmtPercent(item.result_value) + '</b></div>' +
        '<div class="hpd-row" style="border:none"><span class="hpd-mut">' + (en ? 'Evidence' : '证据') + '</span><b>' + (item.evidence_id ? esc(item.source) : (en ? 'Not recorded' : '未生成')) + '</b></div>' +
        '</div>';
      var detail = detailMode ? '<div class="hpd-mut he-detail">session_result_id: ' + esc(item.session_result_id) +
        (item.evidence_id ? ' · evidence_id: ' + esc(item.evidence_id) : '') +
        (item.kpi_profile_code ? ' · kpi: ' + esc(item.kpi_profile_code) : '') +
        ' · attempts: ' + esc(item.attempts) + '/' + esc(item.successful_attempts) + '</div>' : '';
      return head + detail;
    }).join('');
  }

  function renderRecoveryHTML(recovery, en) {
    if (!recovery) return '';
    var statusHTML = '<div class="hpd-stage-row"><span class="hpd-badge hpd-stage-' + esc(recovery.status) + '">' + esc(recoveryStatusLabel(recovery.status, en)) + '</span></div>';
    var flagsHTML = (recovery.flags || []).map(function (f) {
      var msg = recoveryFlagMessage(f, en);
      return msg ? '<div class="hpd-mut">' + esc(msg) + '</div>' : '';
    }).join('');
    return statusHTML + flagsHTML;
  }

  function renderIntegrityHTML(integrityFlags, en) {
    if (!integrityFlags || !integrityFlags.length) return '<div class="hpd-mut">' + (en ? 'No integrity issues detected.' : '未发现数据一致性问题。') + '</div>';
    return integrityFlags.map(function (f) {
      var msg = integrityFlagMessage(f, en);
      return '<div class="hpd-banner hpd-warn">' + esc(coreLabel('integrityWarning', en)) + (msg ? ' — ' + esc(msg) : ' (' + esc(f) + ')') + '</div>';
    }).join('');
  }

  // ================================================================
  // Main pure renderer.
  // ================================================================

  function renderHistoryExplainabilityHTML(vm, opts) {
    vm = vm || {};
    opts = opts || {};
    var en = !!opts.en;
    var detailMode = !!opts.detailMode;
    var cycles = Array.isArray(vm.cycles) ? vm.cycles : [];
    var selectedCycleId = opts.selectedCycleId || null;
    var selected = (selectedCycleId ? cycles.filter(function (c) { return c.cycle_id === selectedCycleId; })[0] : null) || cycles.filter(function (c) { return c.is_current; })[0] || cycles[0] || null;

    if (!cycles.length) {
      return '<div class="hpd-mut">' + (en ? 'No development cycles are available yet.' : '目前尚无可用的发展周期。') + '</div>' +
        renderRecoveryHTML(vm.recovery, en);
    }

    return '<div class="hpd-section"><div class="hpd-label">' + (en ? 'Development Cycles' : '发展周期') + '</div>' + renderCycleListHTML(cycles, en, selected ? selected.cycle_id : null) + '</div>' +
      '<div class="hpd-section"><div class="hpd-label">' + coreLabel('timeline', en) + '</div>' + renderTimelineHTML(selected ? selected.timeline : [], en, detailMode) + '</div>' +
      '<div class="hpd-section"><div class="hpd-label">' + coreLabel('whyThisTraining', en) + '</div>' + renderWhyThisTrainingHTML(selected ? selected.workflow_summary : null, en, detailMode) + '</div>' +
      '<div class="hpd-section"><div class="hpd-label">' + coreLabel('evidenceLineage', en) + '</div>' + renderEvidenceLineageHTML(selected ? selected.evidence_lineage : [], en, detailMode) + '</div>' +
      '<div class="hpd-section"><div class="hpd-label">' + coreLabel('recoveryStatus', en) + '</div>' + renderRecoveryHTML(vm.recovery, en) + '</div>' +
      '<div class="hpd-section"><div class="hpd-label">' + (en ? 'Integrity Warnings' : '数据一致性警告') + '</div>' + renderIntegrityHTML(vm.integrity_flags, en) + '</div>' +
      '<div class="hpd-section"><button class="btn hpd-cta gt-cta" data-act="toggle-detail">' + (detailMode ? (en ? 'Simple View' : '简明视图') : (en ? 'Detail View' : '详细视图')) + '</button></div>';
  }

  // ================= 以下为 DOM 渲染 / 数据编排（仅浏览器环境运行）=================

  var ROOT_ID = 'history-explainability-app';
  var rootEl = null;
  var SELECTED_PLAYER_ID = null;
  var SELECTED_CYCLE_ID = null;
  var DETAIL_MODE = false;
  var LAST_VM = null;

  function isEN() { return typeof LANG !== 'undefined' && LANG === 'en'; }
  function modulesReady() { return typeof PBStore !== 'undefined' && typeof PBHistoryExplainabilityAdapter !== 'undefined'; }
  function loadingHTML() { return '<div class="hpd-mut" style="margin-top:10px">' + (isEN() ? 'Loading…' : '加载中…') + '</div>'; }
  function errorHTML(e) { return '<div class="hpd-mut" style="color:var(--fail);margin-top:10px">' + (isEN() ? 'Load failed: ' : '加载失败：') + esc(e && e.message) + '</div>'; }

  function render() {
    if (!rootEl) return;
    PBStore.listPlayers().then(function (players) {
      if (!players.length) { rootEl.innerHTML = '<div class="hpd-mut">' + (isEN() ? 'No players yet.' : '暂无球员。') + '</div>'; return; }
      if (!SELECTED_PLAYER_ID) SELECTED_PLAYER_ID = players[0].player_id;
      rootEl.innerHTML = loadingHTML();
      PBHistoryExplainabilityAdapter.loadHistoryExplainability(SELECTED_PLAYER_ID).then(function (result) {
        if (!rootEl) return;
        LAST_VM = result.history_explainability;
        rootEl.innerHTML = renderHistoryExplainabilityHTML(LAST_VM, { en: isEN(), selectedCycleId: SELECTED_CYCLE_ID, detailMode: DETAIL_MODE });
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
    if (act === 'pick-cycle') {
      SELECTED_CYCLE_ID = node.getAttribute('data-cid');
      if (rootEl && LAST_VM) rootEl.innerHTML = renderHistoryExplainabilityHTML(LAST_VM, { en: isEN(), selectedCycleId: SELECTED_CYCLE_ID, detailMode: DETAIL_MODE });
      return;
    }
    if (act === 'toggle-detail') {
      DETAIL_MODE = !DETAIL_MODE;
      if (rootEl && LAST_VM) rootEl.innerHTML = renderHistoryExplainabilityHTML(LAST_VM, { en: isEN(), selectedCycleId: SELECTED_CYCLE_ID, detailMode: DETAIL_MODE });
      return;
    }
  }

  function mount() {
    rootEl = document.getElementById(ROOT_ID);
    if (!rootEl) return;
    rootEl.addEventListener('click', onClick);
    if (!modulesReady()) {
      rootEl.innerHTML = '<div class="hpd-mut">' + (isEN() ? 'History module not ready.' : '历史模块未就绪。') + '</div>';
      return;
    }
    render();
  }

  return {
    // pure (Node-testable, no DOM/PBStore/global LANG)
    coreLabel: coreLabel,
    eventTypeLabel: eventTypeLabel,
    recoveryStatusLabel: recoveryStatusLabel,
    recoveryFlagMessage: recoveryFlagMessage,
    integrityFlagMessage: integrityFlagMessage,
    fmtPercent: fmtPercent,
    renderHistoryExplainabilityHTML: renderHistoryExplainabilityHTML,

    // browser-only
    refresh: function () { render(); },
    _mount: mount
  };
});
