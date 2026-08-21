/* ============================================================
 * guided-training-ui.js — Pickleball App 2.0 Alpha · S11-C
 * Guided Training Action Flow — THIN UI LAYER.
 *
 * Renders the Guided Training screen (Activate / Start / Active
 * Session / reload-loss / completion summary) by calling only
 * PBGuidedTrainingController — never PBPrescriptionWorkflow /
 * PBSessionEvidence / PBSessionEvidencePersistence / PBProductJourney
 * directly, and never PBDiagnosis/PBRecommendationPriority/
 * PBTrainingPrescription (no S9 rerun). No priority formula, no
 * recommendation/prescription mapping, no progress math, no workflow
 * state transition, and no result_value/Evidence logic live here — all
 * of that is delegated to the controller (which itself delegates to
 * S10-C/S10-D/S10-D-R1/S11-A).
 *
 * Same UMD / pure-vs-DOM split every other *-ui.js module in this repo
 * already uses: label/message/view-model builders take an explicit
 * `en` boolean and are pure (Node-testable, no DOM/PBStore/global
 * LANG); only mount()/render()/onClick() touch the DOM or the
 * controller.
 *
 * Mount point: #guided-training-app (dedicated `#v-guided` view,
 * reached only via HOME's S11-B CTA routing — never a bottom-nav tab,
 * per §31 "prefer minimal existing SPA integration").
 * ============================================================ */
(function (root, factory) {
  var pure = factory();
  if (typeof module === 'object' && module.exports) { module.exports = pure; return; }
  root.PBGuidedTrainingUI = pure;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pure._mount);
    else pure._mount();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ================================================================
  // §27/§32 Bilingual copy — frozen core strings.
  // ================================================================
  var LABELS = {
    activate: { zh: '激活训练处方', en: 'Activate Training' },
    start: { zh: '开始训练', en: 'Start Training' },
    inProgress: { zh: '训练进行中', en: 'Training in Progress' },
    attempts: { zh: '尝试次数', en: 'Attempts' },
    successfulAttempts: { zh: '成功次数', en: 'Successful Attempts' },
    completeSave: { zh: '完成并保存', en: 'Complete & Save' },
    resultSaved: { zh: '训练结果已保存', en: 'Session Result Saved' },
    evidenceRecorded: { zh: '已记录训练证据', en: 'TRAINING Evidence Recorded' },
    drillUnresolved: { zh: '训练方向已确定，具体 Drill 尚未解析。', en: 'Training direction is available. Specific drill is not yet resolved.' },
    benchmarkUnresolved: { zh: '基准值尚未解析。', en: 'Benchmark not yet resolved.' },
    sessionLost: { zh: '上一次进行中的训练未保留，无法直接恢复。', en: 'The previous active training session was not preserved and cannot be resumed directly.' }
  };
  function tr(key, en) { var m = LABELS[key]; return m ? (en ? m.en : m.zh) : key; }

  // ================================================================
  // §27 Error contract — raw domain codes preserved (never swallowed),
  // mapped to a concise bilingual message for display only.
  // ================================================================
  var ERROR_MESSAGES = {
    STALE_RECOMMENDATION: { zh: '训练重点已过期，需要先完成比赛复测。', en: 'This recommendation is stale — a match reassessment is required first.' },
    INVALID_PRESCRIPTION_STATUS: { zh: '当前处方状态不允许此操作。', en: 'The prescription status does not allow this action.' },
    MISSING_PRIORITY: { zh: '优先级信息缺失，无法激活。', en: 'Priority information is missing — cannot activate.' },
    MISSING_TRAINING_OBJECTIVE: { zh: '训练目标缺失，无法激活。', en: 'Training objective is missing — cannot activate.' },
    MISSING_TRAINING_MODE: { zh: '训练方式缺失，无法激活。', en: 'Training mode is missing — cannot activate.' },
    MISSING_KPI_PROFILE: { zh: 'KPI 指标缺失，无法激活。', en: 'KPI profile is missing — cannot activate.' },
    INVALID_SESSION_STATE: { zh: '当前训练课节状态不允许此操作。', en: 'The session is not in a state that allows this action.' },
    INVALID_ATTEMPTS: { zh: '尝试次数无效，请检查后重试。', en: 'Attempts value is invalid — please check and try again.' },
    INVALID_SUCCESS_COUNT: { zh: '成功次数无效，请检查后重试。', en: 'Successful attempts value is invalid — please check and try again.' },
    DUPLICATE_FINALIZATION: { zh: '该课节已完成，不能用不同结果重复提交。', en: 'This session is already finalized and cannot be resubmitted with a different result.' },
    PERSISTENCE_READ_FAILED: { zh: '读取数据失败，请重试。', en: 'Failed to read data — please try again.' },
    PERSISTENCE_WRITE_FAILED: { zh: '保存数据失败，请重试。', en: 'Failed to save data — please try again.' },
    MISSING_DEVELOPMENT_CYCLE: { zh: '未找到有效的训练周期。', en: 'No valid development cycle was found.' },
    PRESCRIPTION_WORKFLOW_NOT_FOUND: { zh: '未找到该训练处方流程。', en: 'Prescription workflow not found.' },
    ALREADY_IN_PROGRESS: { zh: '该训练已在进行中。', en: 'This training is already in progress.' },
    ACTIVE_SESSION_LOST: { zh: '当前没有进行中的训练课节。', en: 'There is no active training session right now.' }
  };
  function translateError(e, en) {
    var m = e && e.code && ERROR_MESSAGES[e.code];
    if (m) return en ? m.en : m.zh;
    return en ? 'Something went wrong. Please try again.' : '操作失败，请重试。';
  }

  // ================================================================
  // §16-§18 Pure Training Direction view-model — read verbatim from the
  // persisted prescription_snapshot, nothing recomputed.
  // ================================================================
  function buildTrainingDirectionViewModel(snapshot) {
    snapshot = snapshot || {};
    return {
      objective: snapshot.training_objective_code != null ? snapshot.training_objective_code : null,
      mode: snapshot.training_mode != null ? snapshot.training_mode : null,
      kpiProfile: snapshot.kpi_profile_code != null ? snapshot.kpi_profile_code : null,
      drillFamily: snapshot.drill_family_code != null ? snapshot.drill_family_code : null,
      drillResolutionStatus: snapshot.drill_resolution_status != null ? snapshot.drill_resolution_status : 'UNRESOLVED',
      kpiTargetStatus: snapshot.kpi_target_status != null ? snapshot.kpi_target_status : 'BENCHMARK_NOT_RESOLVED',
      drillUnresolved: snapshot.drill_resolution_status === 'UNRESOLVED',
      benchmarkUnresolved: snapshot.kpi_target_status === 'BENCHMARK_NOT_RESOLVED'
    };
  }

  function trainingDirectionHTML(vm, en) {
    return '<div class="hpd-card gt-card">' +
      (vm.objective ? '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Objective' : '训练目标') + '</span><b>' + esc(vm.objective) + '</b></div>' : '') +
      (vm.mode ? '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Mode' : '训练方式') + '</span><b>' + esc(vm.mode) + '</b></div>' : '') +
      (vm.drillFamily ? '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Drill Family' : 'Drill 类别') + '</span><b>' + esc(vm.drillFamily) + '</b></div>' : '') +
      (vm.kpiProfile ? '<div class="hpd-row" style="border:none"><span class="hpd-mut">KPI</span><b>' + esc(vm.kpiProfile) + '</b></div>' : '') +
      '</div>' +
      (vm.drillUnresolved ? '<div class="hpd-banner">' + esc(tr('drillUnresolved', en)) + '</div>' : '') +
      (vm.benchmarkUnresolved ? '<div class="hpd-mut">' + esc(tr('benchmarkUnresolved', en)) + '</div>' : '');
  }

  // ================================================================
  // §9 Pure screen renderer — one `state.mode` per Guided Training
  // screen. Exactly one primary action button per screen
  // (`data-primary-cta="1"`), same convention as home-priority-
  // dashboard-ui.js's renderHomePanelHTML.
  // ================================================================

  function renderGuidedTrainingHTML(state, en) {
    state = state || {};
    var mode = state.mode || 'NO_SELECTION';

    if (mode === 'NO_SELECTION') {
      return '<div class="hpd-mut">' + (en ? 'No training action selected.' : '尚未选择训练操作。') + '</div>';
    }
    if (mode === 'LOADING') {
      return '<div class="hpd-mut">' + (en ? 'Loading…' : '加载中…') + '</div>';
    }
    if (mode === 'ERROR') {
      return '<div class="hpd-mut" style="color:var(--fail)">' + esc(state.message || '') + '</div>' +
        '<button class="btn hpd-cta gt-cta" data-act="retry">' + (en ? 'Retry' : '重试') + '</button>';
    }
    if (mode === 'READY_TO_ACTIVATE') {
      return trainingDirectionHTML(buildTrainingDirectionViewModel(state.prescription_snapshot), en) +
        (state.error ? '<div class="hpd-mut" style="color:var(--fail);margin:6px 0">' + esc(state.error) + '</div>' : '') +
        '<button class="btn solid hpd-cta gt-cta" data-act="activate" data-primary-cta="1"' + (state.busy ? ' disabled' : '') + '>' + esc(tr('activate', en)) + '</button>';
    }
    if (mode === 'READY_TO_START') {
      return trainingDirectionHTML(buildTrainingDirectionViewModel(state.prescription_snapshot), en) +
        (state.error ? '<div class="hpd-mut" style="color:var(--fail);margin:6px 0">' + esc(state.error) + '</div>' : '') +
        '<button class="btn solid hpd-cta gt-cta" data-act="start" data-primary-cta="1"' + (state.busy ? ' disabled' : '') + '>' + esc(tr('start', en)) + '</button>';
    }
    if (mode === 'ACTIVE_SESSION') {
      var exec = state.session_execution || {};
      return '<div class="hpd-card gt-card">' +
        '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Objective' : '训练目标') + '</span><b>' + esc(exec.training_objective_code) + '</b></div>' +
        '<div class="hpd-row"><span class="hpd-mut">' + (en ? 'Mode' : '训练方式') + '</span><b>' + esc(exec.training_mode) + '</b></div>' +
        '<div class="hpd-row"><span class="hpd-mut">KPI</span><b>' + esc(exec.kpi_profile_code) + '</b></div>' +
        '<div class="hpd-row" style="border:none"><span class="hpd-mut">' + (en ? 'Session Status' : '课节状态') + '</span><b>' + esc(tr('inProgress', en)) + '</b></div>' +
        '</div>' +
        (state.error ? '<div class="hpd-mut" style="color:var(--fail);margin:6px 0">' + esc(state.error) + '</div>' : '') +
        '<div class="gt-form">' +
        '<label class="hpd-mut">' + esc(tr('attempts', en)) + '</label>' +
        '<input class="fld gt-input" type="number" min="0" step="1" id="gt-attempts" value="' + esc(state.attempts != null ? state.attempts : '') + '">' +
        '<label class="hpd-mut">' + esc(tr('successfulAttempts', en)) + '</label>' +
        '<input class="fld gt-input" type="number" min="0" step="1" id="gt-successful" value="' + esc(state.successful_attempts != null ? state.successful_attempts : '') + '">' +
        '</div>' +
        '<button class="btn solid hpd-cta gt-cta" data-act="complete" data-primary-cta="1"' + (state.busy ? ' disabled' : '') + '>' + esc(tr('completeSave', en)) + '</button>';
    }
    if (mode === 'SESSION_LOST') {
      return '<div class="hpd-banner hpd-warn">' + esc(tr('sessionLost', en)) + '</div>' +
        '<button class="btn hpd-cta gt-cta" data-act="back-home" data-primary-cta="1">' + (en ? 'Back to Home' : '返回首页') + '</button>';
    }
    if (mode === 'COMPLETED') {
      return '<div class="hpd-banner">' + esc(tr('resultSaved', en)) + (state.evidence_recorded ? ' · ' + esc(tr('evidenceRecorded', en)) : '') + '</div>' +
        '<button class="btn solid hpd-cta gt-cta" data-act="back-home" data-primary-cta="1">' + (en ? 'Back to Home' : '返回首页') + '</button>';
    }
    return '<div class="hpd-mut">' + (en ? 'Unknown state.' : '未知状态。') + '</div>';
  }

  // ================= 以下为 DOM 渲染 / 数据编排（仅浏览器环境运行）=================

  var ROOT_ID = 'guided-training-app';
  var rootEl = null;
  var BUSY = false;

  // Set by HOME's CTA routing (openForAction) — deliberately transient/in-memory only, never
  // persisted, matching §12's "exactly one active in-memory execution" model.
  var CONTEXT = { code: null, workflow_id: null, player_id: null };

  function isEN() { return typeof LANG !== 'undefined' && LANG === 'en'; }
  function modulesReady() { return typeof PBGuidedTrainingController !== 'undefined'; }

  function gotoTab(tabName) { if (tabName && typeof go === 'function') go(tabName); }

  function setContext(ctx) { CONTEXT = { code: ctx.code || null, workflow_id: ctx.workflow_id || null, player_id: ctx.player_id || null }; }

  // §29 called by js/home-priority-dashboard-ui.js's CTA handler before routing to 'guided'.
  function openForAction(ctx) {
    setContext(ctx || {});
    render();
  }

  function renderState(state) {
    if (!rootEl) return;
    rootEl.innerHTML = renderGuidedTrainingHTML(state, isEN());
    rootEl._lastState = state;
  }

  function render() {
    if (!rootEl) return;
    var C = PBGuidedTrainingController;
    renderState({ mode: 'LOADING' });

    // §15/§28: RESUME_SESSION only ever reflects the current in-process active session — never
    // reconstructed from persisted data.
    if (CONTEXT.code === 'RESUME_SESSION') {
      var active = C.getActiveSession();
      if (active && active.session_execution.state === 'ACTIVE') {
        renderState({ mode: 'ACTIVE_SESSION', session_execution: active.session_execution });
      } else {
        renderState({ mode: 'SESSION_LOST' });
      }
      return;
    }

    if (!CONTEXT.workflow_id) { renderState({ mode: 'NO_SELECTION' }); return; }

    C.resolveSessionState({ workflow_id: CONTEXT.workflow_id }).then(function (result) {
      if (result.state === 'SESSION_ACTIVE') {
        renderState({ mode: 'ACTIVE_SESSION', session_execution: result.session_execution });
      } else if (result.state === 'ACTIVE_SESSION_LOST') {
        renderState({ mode: 'SESSION_LOST' });
      } else if (result.state === 'DRAFTED') {
        renderState({ mode: 'READY_TO_ACTIVATE', prescription_snapshot: result.workflow.prescription_snapshot });
      } else if (result.state === 'ACTIVE') {
        // Persisted workflow is S10-C-activated but training hasn't started (no live session) —
        // the legitimate "ready to start" case, distinct from the in-memory 'SESSION_ACTIVE' above.
        renderState({ mode: 'READY_TO_START', prescription_snapshot: result.workflow.prescription_snapshot });
      } else {
        renderState({ mode: 'ERROR', message: isEN() ? 'This training is not in a guided-flow state (' + result.state + ').' : '当前训练状态不支持引导流程（' + result.state + '）。' });
      }
    }).catch(function (e) {
      renderState({ mode: 'ERROR', message: translateError(e, isEN()) });
    });
  }

  function readIntInput(id) {
    var el = document.getElementById(id);
    if (!el || el.value === '') return undefined;
    var n = Number(el.value);
    return isNaN(n) ? undefined : n;
  }

  function onClick(e) {
    var node = e.target.closest('[data-act]'); if (!node) return;
    var act = node.getAttribute('data-act');
    var C = PBGuidedTrainingController;

    if (act === 'retry' || act === 'back-home') { if (act === 'back-home') gotoTab('home'); else render(); return; }

    if (BUSY) return;

    if (act === 'activate') {
      BUSY = true;
      C.activatePrescription({ workflow_id: CONTEXT.workflow_id }).then(function () {
        BUSY = false;
        render();
      }).catch(function (e) {
        BUSY = false;
        var last = rootEl && rootEl._lastState;
        renderState(Object.assign({}, last, { error: translateError(e, isEN()), busy: false }));
      });
      return;
    }

    if (act === 'start') {
      BUSY = true;
      C.startTraining({ workflow_id: CONTEXT.workflow_id }).then(function () {
        BUSY = false;
        render();
      }).catch(function (e) {
        BUSY = false;
        var last = rootEl && rootEl._lastState;
        renderState(Object.assign({}, last, { error: translateError(e, isEN()), busy: false }));
      });
      return;
    }

    if (act === 'complete') {
      var attempts = readIntInput('gt-attempts');
      var successful = readIntInput('gt-successful');
      var active = C.getActiveSession();
      if (!active) { renderState({ mode: 'SESSION_LOST' }); return; }
      BUSY = true;
      C.resolveCurrentCycle({ player_id: CONTEXT.player_id }).then(function (cycle) {
        return C.completeSession({
          attempts: attempts, successful_attempts: successful,
          development_cycle_id: cycle ? cycle.cycle_id : null
        });
      }).then(function (result) {
        BUSY = false;
        renderState({ mode: 'COMPLETED', evidence_recorded: !!result.evidence });
      }).catch(function (e) {
        BUSY = false;
        var last = rootEl && rootEl._lastState;
        renderState(Object.assign({}, last, { error: translateError(e, isEN()), busy: false }));
      });
      return;
    }
  }

  function mount() {
    rootEl = document.getElementById(ROOT_ID);
    if (!rootEl) return;
    rootEl.addEventListener('click', onClick);
    if (!modulesReady()) {
      rootEl.innerHTML = '<div class="hpd-mut">' + (isEN() ? 'Guided Training module not ready.' : '引导训练模块未就绪。') + '</div>';
      return;
    }
    render();
  }

  return {
    // pure (Node-testable, no DOM/PBStore/global LANG)
    translateError: translateError,
    buildTrainingDirectionViewModel: buildTrainingDirectionViewModel,
    renderGuidedTrainingHTML: renderGuidedTrainingHTML,

    // browser-only
    openForAction: openForAction,
    refresh: function () { render(); },
    _mount: mount
  };
});
