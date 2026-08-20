/* ============================================================
 * training-ui.js — Pickleball App 2.0 Alpha · S8-E Training / Cycle UI
 * 薄 UI 层：只读取 S8-A~D 已持久化数据、只调用既有引擎
 * （PBSessionExecution / PBTrainingReadiness），只渲染其返回值。
 * 本文件绝不重新实现或复制：
 *   - Adherence / Training Exposure / Primary Exposure / Retest Target Exposure 计算
 *   - R1-R4 门控判定逻辑或其阈值（0.80 / 0.75 / 0.70）
 *   - RETEST_READY 判定
 *   - CAP / Hard Gate / Match Validation / Validated Level / 晋级
 * 所有以上概念只读取引擎已产出的字段并展示，从不在本文件内比较、
 * 求和或判定。UI 也绝不直接写 SessionLog——执行动作全部委派给
 * PBSessionExecution。
 *
 * 三个挂载点（对应 Section 4 的既有导航复用）：
 *   #training-today-app     — HOME 页内「今日训练」卡片
 *   #training-cycle-app     — DRILL 页内「训练周期 / Session」主应用
 *   #training-progress-app  — REVIEW 页内「训练进度 / 复测就绪度」
 * 三者共享同一份模块内状态（当前选择的球员/周期/Session），因为它们
 * 运行在同一个页面、同一份 JS 模块实例内，无需引入新的跨标签路由或
 * 缓存架构。
 *
 * Active Session 提醒（Section 24）：PBSessionExecution 的进行中状态只存
 * 在内存（S8-C 既有设计，本文件不改变这一点，也不为此新增第 6 个
 * IndexedDB store）。刷新页面会丢失未提交的进行中状态，UI 对此如实提示。
 *
 * 纯格式化/取值函数与 DOM 挂载逻辑分离（与 review-ui.js 相同的 UMD 拆分），
 * 前者可在 Node 下单测。
 * ============================================================ */
(function (root, factory) {
  var pure = factory();
  if (typeof module === 'object' && module.exports) { module.exports = pure; return; }
  root.PBTrainingUI = pure;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pure._mount);
    else pure._mount();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function isEN() { return typeof LANG !== 'undefined' && LANG === 'en'; }
  function tr(zh, en) { return isEN() ? en : zh; }

  // ---- 已知引擎错误码 → 简明双语提示；未知错误码一律走通用兜底文案，绝不暴露堆栈 ----
  var ERROR_MESSAGES = {
    SESSION_NOT_FOUND: { zh: '未找到该训练课节。', en: 'Session not found.' },
    SESSION_NOT_STARTABLE: { zh: '该训练课节当前无法开始。', en: 'This session cannot be started right now.' },
    SESSION_ALREADY_ACTIVE: { zh: '该训练课节已在进行中。', en: 'This session is already in progress.' },
    SESSION_ALREADY_FINALIZED: { zh: '该训练课节已完成，不能重复提交。', en: 'This session has already been finalized.' },
    INVALID_EXECUTION_PAYLOAD: { zh: '输入数据无效，请检查后重试。', en: 'The entered data is invalid. Please check and try again.' },
    EXECUTION_ASSIGNMENT_MISMATCH: { zh: '结果与该课节的计划任务不匹配。', en: 'The result does not match this session’s planned assignments.' },
    INVALID_TIMESTAMP_ORDER: { zh: '完成时间不能早于开始时间。', en: 'The completion time cannot be earlier than the start time.' },
    CYCLE_NOT_FOUND: { zh: '未找到该训练周期。', en: 'Training cycle not found.' }
  };
  function translateError(e) {
    var m = e && e.code && ERROR_MESSAGES[e.code];
    if (m) return isEN() ? m.en : m.zh;
    return tr('操作失败，请重试。', 'Something went wrong. Please try again.');
  }

  // ================================================================
  // 纯函数（可在 Node 下单测，不依赖 DOM/PBStore）
  // ================================================================

  // ---- 从候选 TrainingCycle 中挑选"当前周期"：只看 PLANNED/ACTIVE，ACTIVE 优先，
  // 其次按 start_date 越新越优先——纯粹的既有数据筛选，不产生/推导任何新字段 ----
  function pickCurrentCycle(cycles) {
    var candidates = (cycles || []).filter(function (c) { return c && (c.status === 'ACTIVE' || c.status === 'PLANNED'); });
    if (!candidates.length) return null;
    candidates.sort(function (a, b) {
      var aActive = a.status === 'ACTIVE' ? 1 : 0, bActive = b.status === 'ACTIVE' ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      var ad = a.start_date || '', bd = b.start_date || '';
      if (ad !== bd) return ad < bd ? 1 : -1;
      var ac = a.created_at || '', bc = b.created_at || '';
      return ac < bc ? 1 : (ac > bc ? -1 : 0);
    });
    return candidates[0];
  }

  // ---- 从已按 (week_number, sequence) 附带信息的 SessionPlan 列表中挑选"下一个待办课节"：
  // 第一个状态仍为 PLANNED/AVAILABLE 的，按周次+序号排序后取最前——不涉及日历/排程计算，
  // 只是对既有 status 字段的确定性排序筛选（未引入 calendar scheduling，S8-E 明确不做）----
  function pickNextSession(sessions) {
    var pending = (sessions || []).filter(function (s) { return s && (s.status === 'PLANNED' || s.status === 'AVAILABLE'); });
    if (!pending.length) return null;
    pending = pending.slice().sort(function (a, b) { return (a.week_number - b.week_number) || (a.sequence - b.sequence); });
    return pending[0];
  }

  function findPrimaryAssignment(assignments) {
    return (assignments || []).filter(function (a) { return a.role === 'PRIMARY'; })[0] || null;
  }

  // ---- Today 视图模型：cycle 不存在 -> hasCycle:false（空状态，绝不臆造周期）----
  function buildTodayViewModel(input) {
    input = input || {};
    if (!input.cycle) return { hasCycle: false };
    var cycle = input.cycle;
    var weeks = input.weeks || [];
    var next = input.nextSession || null;
    var currentWeek = next
      ? weeks.filter(function (w) { return w.week_number === next.week_number; })[0]
      : (weeks.length ? weeks[weeks.length - 1] : null);
    var primary = next ? findPrimaryAssignment(next.assignments) : null;
    return {
      hasCycle: true,
      cycleId: cycle.cycle_id,
      weekNumber: currentWeek ? currentWeek.week_number : null,
      totalWeeks: weeks.length,
      phase: currentWeek ? currentWeek.phase : null,
      primaryBottleneck: cycle.primary_bottleneck || null,
      nextSession: next ? {
        sessionPlanId: next.session_plan_id,
        sequence: next.sequence,
        weekNumber: next.week_number,
        status: next.status,
        primaryTarget: primary ? primary.target : null,
        primaryDrillId: primary ? primary.drill_id : null,
        primaryNamespace: primary ? primary.assessment_namespace : null
      } : null,
      isSessionActive: !!(next && input.executionState),
      allSessionsFinalized: !next
    };
  }

  // ---- Cycle 视图模型：只做分组/排序整理，不重算周期规则（S8-B 已冻结）----
  function buildCycleViewModel(input) {
    input = input || {};
    if (!input.cycle) return { hasCycle: false };
    var cycle = input.cycle;
    var weeklyPlans = (input.weeklyPlans || []).slice().sort(function (a, b) { return a.week_number - b.week_number; });
    var byWeek = {};
    (input.sessionPlans || []).forEach(function (sp) { (byWeek[sp.week_plan_id] = byWeek[sp.week_plan_id] || []).push(sp); });
    var weeks = weeklyPlans.map(function (wp) {
      var sessions = (byWeek[wp.week_plan_id] || []).slice().sort(function (a, b) { return a.sequence - b.sequence; });
      var counts = {};
      sessions.forEach(function (s) { counts[s.status] = (counts[s.status] || 0) + 1; });
      return {
        weekPlanId: wp.week_plan_id, weekNumber: wp.week_number, phase: wp.phase, status: wp.status,
        plannedSessions: wp.planned_sessions, statusCounts: counts,
        sessions: sessions.map(function (s) { return { sessionPlanId: s.session_plan_id, sequence: s.sequence, status: s.status, objective: s.objective }; })
      };
    });
    return {
      hasCycle: true, cycleId: cycle.cycle_id, status: cycle.status,
      targetLevel: cycle.target_level, validatedLevelAtStart: cycle.validated_level_at_start,
      primaryBottleneck: cycle.primary_bottleneck, startDate: cycle.start_date, plannedEndDate: cycle.planned_end_date,
      cycleLengthWeeks: weeks.length, weeks: weeks
    };
  }

  // ---- Session 视图模型：assignments 原样取自 SessionPlan（S8-B 冻结值），
  // 已终态结果原样取自 SessionLog（S8-C 冻结值），criterion_met 直接读取引擎已算出的值，
  // 本函数不做任何比较/判定 ----
  function buildSessionViewModel(input) {
    input = input || {};
    var sp = input.sessionPlan;
    if (!sp) return { found: false };
    var log = input.sessionLog || null;
    var assignments = (sp.assignments || []).map(function (a, idx) {
      return { index: idx, role: a.role, target: a.target, namespace: a.assessment_namespace, drillId: a.drill_id, plannedVolume: a.planned_volume, successCriterion: a.success_criterion };
    });
    var resultsByIndex = {};
    if (log) (log.results || []).forEach(function (r) { if (r.assignment_index != null) resultsByIndex[r.assignment_index] = r; });
    return {
      found: true,
      sessionPlanId: sp.session_plan_id,
      sequence: sp.sequence,
      weekNumber: input.weeklyPlan ? input.weeklyPlan.week_number : null,
      phase: input.weeklyPlan ? input.weeklyPlan.phase : null,
      objective: sp.objective,
      status: sp.status,
      assignments: assignments,
      isFinalized: !!log,
      isActive: !!input.executionState,
      executionStartedAt: input.executionState ? input.executionState.started_at : null,
      log: log ? {
        status: log.status,
        startedAt: log.started_at,
        completedAt: log.completed_at,
        notes: log.notes || '',
        results: assignments.map(function (a) {
          var r = resultsByIndex[a.index];
          return r ? {
            index: a.index,
            measuredValue: (r.measured_value == null ? null : r.measured_value),
            attempts: (r.attempts == null ? null : r.attempts),
            successful: (r.successful == null ? null : r.successful),
            successCriterion: r.success_criterion || a.successCriterion,
            criterionMet: (r.criterion_met === undefined ? null : r.criterion_met)
          } : null;
        })
      } : null
    };
  }

  // ---- Progress 视图模型：只读取 CycleSummary 已算好的字段（含 S8-D 新增的逐目标
  // meets_threshold），MET/BELOW_TARGET/INCOMPLETE 标签直接取自该字段，本函数从不比较
  // exposure_rate 与任何阈值 ----
  function buildProgressViewModel(summary) {
    if (!summary) return { hasSummary: false };
    var e = summary.training_exposure || {};
    var retestTargets = (e.retest_target_detail || []).map(function (d) {
      var label = (d.exposure_rate == null) ? 'INCOMPLETE' : (d.meets_threshold ? 'EXPOSURE_MET' : 'EXPOSURE_BELOW_TARGET');
      return { metric: d.metric, namespace: d.namespace, exposureRate: d.exposure_rate, label: label, occurrenceCount: d.occurrence_count, hasExecution: d.has_complete_or_partial };
    });
    var gatesObj = e.gates || {};
    var gates = ['R1', 'R2', 'R3', 'R4'].map(function (k) { return gatesObj[k] || null; }).filter(Boolean);
    return {
      hasSummary: true,
      cycleId: summary.cycle_id,
      calculatedAt: e.calculated_at || summary.updated_at || null,
      adherence: {
        planned: summary.planned_sessions, complete: e.complete_sessions, partial: e.partial_sessions,
        skipped: e.skipped_sessions, unlogged: e.unlogged_sessions,
        completionEquivalent: e.completion_equivalent, rate: e.adherence_rate
      },
      primaryExposure: { rate: e.primary_exposure_rate, metric: e.primary_metric, namespace: e.primary_namespace },
      retestTargets: retestTargets,
      matchTransferExposure: (e.match_transfer_exposure == null ? null : e.match_transfer_exposure),
      gates: gates,
      thresholds: e.thresholds || null,
      readiness: summary.retest_readiness
    };
  }

  function fmtPct(v) { return (v == null) ? tr('（无数据）', 'n/a') : (Math.round(v * 1000) / 10) + '%'; }
  function fmtNum(v) { return (v == null) ? '—' : v; }

  // ================= 以下为 DOM 渲染 / 数据编排（仅浏览器环境运行）=================

  var TODAY_ROOT_ID = 'training-today-app';
  var CYCLE_ROOT_ID = 'training-cycle-app';
  var PROGRESS_ROOT_ID = 'training-progress-app';
  var todayEl = null, cycleEl = null, progressEl = null;

  var SELECTED_PLAYER_ID = null;
  var CYCLE_VIEW = 'cycle'; // 'cycle' | 'session'
  var SELECTED_SESSION_PLAN_ID = null;
  var SKIP_CONFIRM_PENDING = null; // session_plan_id awaiting skip confirmation, else null
  var BUSY = false; // 防止重复提交（Section 10/23）
  var LAST_ERROR = null;

  function modulesReady() {
    return typeof PBStore !== 'undefined' && typeof PBSessionExecution !== 'undefined' && typeof PBTrainingReadiness !== 'undefined';
  }

  // ---- 读取型编排：从 player 出发遍历既有索引找到其全部 TrainingCycle（只读，不计算）----
  function findCyclesForPlayer(player_id) {
    return PBStore.assessmentsByPlayer(player_id).then(function (assessments) {
      return Promise.all((assessments || []).map(function (a) { return PBStore.reviewSnapshotsByAssessment(a.assessment_id); }));
    }).then(function (snapLists) {
      var snapIds = [];
      (snapLists || []).forEach(function (list) { (list || []).forEach(function (s) { snapIds.push(s.review_snapshot_id); }); });
      return Promise.all(snapIds.map(function (sid) { return PBStore.getByIndex('training_cycles', 'by_review_snapshot', sid); }));
    }).then(function (cycleLists) {
      var all = [];
      (cycleLists || []).forEach(function (list) { (list || []).forEach(function (c) { all.push(c); }); });
      return all;
    });
  }

  function loadCycleBundle(cycle_id) {
    return Promise.all([
      PBStore.getTrainingCycle(cycle_id),
      PBStore.listWeeklyPlansByCycle(cycle_id),
      PBStore.listSessionPlansByCycle(cycle_id)
    ]).then(function (r) {
      var cycle = r[0], weeklyPlans = r[1] || [], sessionPlans = r[2] || [];
      var weekById = {};
      weeklyPlans.forEach(function (wp) { weekById[wp.week_plan_id] = wp; });
      var enriched = sessionPlans.map(function (sp) {
        var wp = weekById[sp.week_plan_id];
        return Object.assign({}, sp, { week_number: wp ? wp.week_number : null, phase: wp ? wp.phase : null });
      });
      return { cycle: cycle, weeklyPlans: weeklyPlans, sessionPlans: enriched };
    });
  }

  function loadTodayData(player_id) {
    return findCyclesForPlayer(player_id).then(function (cycles) {
      var cycle = pickCurrentCycle(cycles);
      if (!cycle) return { hasCycle: false };
      return loadCycleBundle(cycle.cycle_id).then(function (bundle) {
        var next = pickNextSession(bundle.sessionPlans);
        var stateP = next ? Promise.resolve(PBSessionExecution.getSessionExecutionState(next.session_plan_id)) : Promise.resolve(null);
        return stateP.then(function (state) {
          return buildTodayViewModel({ cycle: bundle.cycle, weeks: bundle.weeklyPlans, sessions: bundle.sessionPlans, nextSession: next, executionState: state });
        });
      });
    });
  }

  function loadCycleData(player_id) {
    return findCyclesForPlayer(player_id).then(function (cycles) {
      var cycle = pickCurrentCycle(cycles);
      if (!cycle) return { hasCycle: false };
      return loadCycleBundle(cycle.cycle_id).then(function (bundle) {
        return buildCycleViewModel(bundle);
      });
    });
  }

  function loadSessionData(session_plan_id) {
    return PBStore.getSessionPlan(session_plan_id).then(function (sp) {
      if (!sp) return { found: false };
      return Promise.all([
        PBStore.getWeeklyPlan(sp.week_plan_id),
        PBStore.getFinalSessionLogByPlan(session_plan_id)
      ]).then(function (r) {
        var weeklyPlan = r[0], log = r[1];
        var state = PBSessionExecution.getSessionExecutionState(session_plan_id);
        return buildSessionViewModel({ sessionPlan: sp, weeklyPlan: weeklyPlan, sessionLog: log, executionState: state });
      });
    });
  }

  function loadProgressData(player_id) {
    return findCyclesForPlayer(player_id).then(function (cycles) {
      var cycle = pickCurrentCycle(cycles);
      if (!cycle) return { hasCycle: false };
      // Section 23：读取现有 CycleSummary，再用既有引擎重新计算/落库最新一份（不新增缓存架构）。
      return PBTrainingReadiness.buildCycleSummary(cycle.cycle_id).then(function (summary) {
        var vm = buildProgressViewModel(summary);
        vm.hasCycle = true;
        return vm;
      });
    });
  }

  // ---- 徽章：kind 只用于视觉分组，label 始终附带文字，绝不仅靠颜色传达语义 ----
  function badge(kind, label) { return '<span class="tr-badge tr-' + kind + '">' + esc(label) + '</span>'; }
  function gateTile(gate) {
    var cls = gate.result === 'PASS' ? 'ok' : (gate.result === 'FAIL' ? 'no' : '');
    var labelMap = {
      R1_ADHERENCE: tr('R1 依从度', 'R1 Adherence'),
      R2_PRIMARY_EXPOSURE: tr('R2 主瓶颈暴露', 'R2 Primary Exposure'),
      R3_RETEST_TARGET_COVERAGE: tr('R3 复测目标覆盖', 'R3 Retest Coverage'),
      R4_EXECUTION_EVIDENCE: tr('R4 执行证据', 'R4 Execution Evidence')
    };
    return '<div class="gate ' + cls + '"><div class="lab">' + esc(labelMap[gate.gate] || gate.gate) + '</div>' +
      '<div class="thr">' + esc(gate.result) + (gate.value != null ? ' · ' + fmtPct(gate.value) : '') + '</div><div class="dot"></div></div>';
  }

  // ---------------- Today ----------------
  function renderToday() {
    if (!todayEl) return;
    if (!SELECTED_PLAYER_ID) { todayEl.innerHTML = pickerPromptHTML('drill'); return; }
    todayEl.innerHTML = loadingHTML();
    loadTodayData(SELECTED_PLAYER_ID).then(function (m) {
      if (!todayEl) return;
      todayEl.innerHTML = renderTodayHTML(m);
    }).catch(function (e) { if (todayEl) todayEl.innerHTML = errorHTML(e); });
  }

  function renderTodayHTML(m) {
    if (!m.hasCycle) {
      return '<div class="tr-h">' + tr('今日训练', "Today's Training") + '</div>' +
        '<div class="tr-banner">' + tr('暂无进行中的训练周期', 'NO ACTIVE TRAINING CYCLE') + '</div>' +
        '<div class="tr-mut">' + tr('请先在「析 Review」完成复盘与处方。', 'Complete a Review / Prescription first.') + '</div>' +
        '<button class="btn" data-act="goto-review" style="margin-top:8px">' + tr('前往复盘 Review', 'Go to Review') + '</button>';
    }
    var head = '<div class="tr-h">' + tr('今日训练', "Today's Training") + '</div>' +
      '<div class="tr-row"><span class="tr-mut">' + tr('当前周次', 'Week') + '</span><b>' + esc(m.weekNumber) + ' / ' + esc(m.totalWeeks) + '</b></div>' +
      '<div class="tr-row"><span class="tr-mut">' + tr('阶段', 'Phase') + '</span><b>' + esc(m.phase || '—') + '</b></div>' +
      '<div class="tr-row" style="border:none"><span class="tr-mut">' + tr('主要瓶颈', 'Primary Bottleneck') + '</span><b>' + esc(m.primaryBottleneck || '—') + '</b></div>';
    if (m.allSessionsFinalized) {
      return head + '<div class="tr-banner" style="margin-top:10px">' + tr('本周期所有课节均已完成/跳过', 'All sessions in this cycle are finalized.') + '</div>' +
        '<button class="btn" data-act="goto-drill" style="margin-top:8px">' + tr('查看训练周期', 'View Training Cycle') + '</button>';
    }
    var n = m.nextSession;
    var ctaLabel = m.isSessionActive ? tr('继续本节 →', 'CONTINUE SESSION →') : tr('开始本节 →', 'START SESSION →');
    return head + '<div class="tr-card" style="margin-top:10px">' +
      '<div class="tr-row"><span class="tr-mut">' + tr('课节', 'Session') + '</span><b>' + tr('第', 'Week ') + esc(n.weekNumber) + tr('周 · 第', ' · #') + esc(n.sequence) + (isEN() ? '' : '节') + '</b></div>' +
      (n.primaryTarget ? '<div class="tr-row" style="border:none"><span class="tr-mut">' + tr('主训练目标', 'Primary Drill') + '</span><b>' + esc(n.primaryNamespace || '') + ' · ' + esc(n.primaryDrillId || n.primaryTarget) + '</b></div>' : '') +
      '<button class="btn solid tr-cta" data-act="today-open-session" data-spid="' + esc(n.sessionPlanId) + '" style="margin-top:10px">' + ctaLabel + '</button>' +
      '</div>';
  }

  // ---------------- Cycle / Session app ----------------
  function renderCycleApp() {
    if (!cycleEl) return;
    PBStore.listPlayers().then(function (players) {
      var header = playerPickerHTML(players);
      if (!players.length) { cycleEl.innerHTML = header; return; }
      if (!SELECTED_PLAYER_ID) { cycleEl.innerHTML = header + '<div class="tr-mut" style="margin-top:10px">' + tr('请选择球员。', 'Choose a player.') + '</div>'; return; }
      cycleEl.innerHTML = header + loadingHTML();
      var body = (CYCLE_VIEW === 'session' && SELECTED_SESSION_PLAN_ID)
        ? loadSessionData(SELECTED_SESSION_PLAN_ID).then(renderSessionHTML)
        : loadCycleData(SELECTED_PLAYER_ID).then(renderCycleHTML);
      body.then(function (html) {
        if (cycleEl) cycleEl.innerHTML = header + html;
      }).catch(function (e) {
        if (cycleEl) cycleEl.innerHTML = header + errorHTML(e);
      });
    });
  }

  function playerPickerHTML(players) {
    if (!players.length) return '<div class="tr-h">' + tr('训练周期', 'Training Cycle') + '</div><div class="tr-mut">' + tr('暂无球员。', 'No players yet.') + '</div>';
    var chips = players.map(function (p) {
      return '<span class="tr-chip' + (SELECTED_PLAYER_ID === p.player_id ? ' sel' : '') + '" data-act="pick-player" data-pid="' + esc(p.player_id) + '">' + esc(p.display_name) + '</span>';
    }).join('');
    return '<div class="tr-h">' + tr('训练周期', 'Training Cycle') + '</div><label class="tr-mut">' + tr('选择球员', 'Player') + '</label><div>' + chips + '</div>';
  }

  function renderCycleHTML(m) {
    if (!m.hasCycle) {
      return '<div class="tr-banner" style="margin-top:10px">' + tr('暂无进行中的训练周期', 'NO ACTIVE TRAINING CYCLE') + '</div>' +
        '<div class="tr-mut">' + tr('请先在「析 Review」完成复盘与处方。', 'Complete a Review / Prescription first.') + '</div>' +
        '<button class="btn" data-act="goto-review" style="margin-top:8px">' + tr('前往复盘 Review', 'Go to Review') + '</button>';
    }
    var head = '<div class="tr-card" style="margin-top:10px">' +
      '<div class="tr-row"><span class="tr-mut">' + tr('目标等级', 'Target Level') + '</span><b>' + fmtNum(m.targetLevel) + '</b></div>' +
      '<div class="tr-row"><span class="tr-mut">' + tr('周期起始等级', 'Validated Level at Start') + '</span><b>' + fmtNum(m.validatedLevelAtStart) + '</b></div>' +
      '<div class="tr-row"><span class="tr-mut">' + tr('主要瓶颈', 'Primary Bottleneck') + '</span><b>' + esc(m.primaryBottleneck || '—') + '</b></div>' +
      '<div class="tr-row"><span class="tr-mut">' + tr('周期时长', 'Cycle Length') + '</span><b>' + esc(m.cycleLengthWeeks) + ' ' + tr('周', 'weeks') + '</b></div>' +
      '<div class="tr-row" style="border:none"><span class="tr-mut">' + tr('周期状态', 'Cycle Status') + '</span>' + badge('neu', m.status) + '</div>' +
      '</div>';
    var weeks = m.weeks.map(function (w) {
      var sessions = w.sessions.map(function (s) {
        return '<div class="tr-row" data-act="open-session" data-spid="' + esc(s.sessionPlanId) + '" style="cursor:pointer">' +
          '<span>' + tr('第', '#') + esc(s.sequence) + tr('节', '') + (s.objective ? ' · ' + esc(s.objective) : '') + '</span>' + badge('neu', s.status) + '</div>';
      }).join('');
      return '<details class="tr-week"><summary>' + tr('第', 'Week ') + esc(w.weekNumber) + tr('周', '') + ' · ' + esc(w.phase) + '</summary><div class="tr-week-body">' + sessions + '</div></details>';
    }).join('');
    return head + weeks;
  }

  function renderSessionHTML(m) {
    if (!m.found) return '<div class="tr-mut" style="margin-top:10px">' + tr('未找到该课节。', 'Session not found.') + '</div>';
    var back = '<button class="btn" data-act="back-to-cycle" style="margin:10px 0">← ' + tr('返回周期', 'Back to Cycle') + '</button>';
    var head = '<div class="tr-card">' +
      '<div class="tr-row"><span class="tr-mut">' + tr('周次 / 阶段', 'Week / Phase') + '</span><b>' + esc(m.weekNumber) + ' · ' + esc(m.phase) + '</b></div>' +
      '<div class="tr-row"><span class="tr-mut">' + tr('序号', 'Sequence') + '</span><b>#' + esc(m.sequence) + '</b></div>' +
      (m.objective ? '<div class="tr-row" style="border:none"><span class="tr-mut">' + tr('目标', 'Objective') + '</span><b>' + esc(m.objective) + '</b></div>' : '') +
      '</div>';
    var assignHTML = '<div class="tr-card"><div class="tr-mut" style="font-weight:700;margin-bottom:6px">' + tr('计划任务', 'Planned Assignments') + '</div>' +
      m.assignments.map(function (a) {
        return '<div class="tr-assign"><span class="tag">' + esc(a.role) + '</span> <b>' + esc(a.namespace || '') + ' · ' + esc(a.drillId || a.target) + '</b>' +
          (a.successCriterion ? '<div class="tr-mut">' + tr('达标标准', 'Success Criterion') + '：' + esc(a.successCriterion) + '</div>' : '') +
          (a.plannedVolume ? '<div class="tr-mut">' + tr('计划量', 'Planned Volume') + '：' + esc(a.plannedVolume) + '</div>' : '') +
          '</div>';
      }).join('') + '</div>';

    var actionHTML;
    if (m.isFinalized) {
      actionHTML = renderSessionResultHTML(m);
    } else if (m.isActive) {
      actionHTML = renderExecutionFormHTML(m);
    } else {
      actionHTML = '<div class="tr-mut" style="margin:6px 0">' + tr('若中途刷新页面，进行中但尚未提交的课节状态可能会丢失，需要重新点击开始。', 'If you reload mid-session, unfinalized progress may be lost — you may need to press Start again.') + '</div>' +
        '<button class="btn solid tr-cta" data-act="start-session" data-spid="' + esc(m.sessionPlanId) + '"' + (BUSY ? ' disabled' : '') + '>' + tr('开始本节 START SESSION', 'START SESSION') + '</button>';
    }
    return back + head + assignHTML + '<div class="tr-card">' + actionHTML + '</div>';
  }

  function renderExecutionFormHTML(m) {
    var rows = m.assignments.map(function (a) {
      return '<div class="tr-exec-row"><div class="tr-mut">' + esc(a.namespace || '') + ' · ' + esc(a.drillId || a.target) + '</div>' +
        '<div class="tr-exec-fields">' +
        '<input class="fld" type="number" placeholder="' + tr('测量值', 'measured value') + '" id="tr-mv-' + a.index + '">' +
        '<input class="fld" type="number" placeholder="' + tr('次数', 'attempts') + '" id="tr-att-' + a.index + '">' +
        '<input class="fld" type="number" placeholder="' + tr('成功数', 'successful') + '" id="tr-succ-' + a.index + '">' +
        '</div></div>';
    }).join('');
    var skipConfirm = (SKIP_CONFIRM_PENDING === m.sessionPlanId);
    var errHTML = LAST_ERROR ? '<div class="tr-mut" style="color:var(--fail);margin:6px 0">' + esc(LAST_ERROR) + '</div>' : '';
    return errHTML + rows +
      '<textarea class="fld" id="tr-notes" placeholder="' + tr('备注', 'notes') + '" style="margin:8px 0"></textarea>' +
      '<div class="tr-mut" style="margin-bottom:8px">' + tr('训练完成状态不等于能力/硬门槛/评估通过。', 'Session completion status is not a capability, hard-gate, or assessment result.') + '</div>' +
      (skipConfirm
        ? '<div class="tr-banner" style="border-color:var(--fail)">' + tr('确认跳过本节？该操作将记录为已跳过，无法撤销。', 'Confirm skipping this session? This will be recorded as SKIPPED and cannot be undone.') + '</div>' +
          '<div class="toolbar"><button class="btn warn" data-act="confirm-skip" data-spid="' + esc(m.sessionPlanId) + '"' + (BUSY ? ' disabled' : '') + '>' + tr('确认跳过', 'Confirm Skip') + '</button>' +
          '<button class="btn" data-act="cancel-skip">' + tr('取消', 'Cancel') + '</button></div>'
        : '<div class="toolbar">' +
          '<button class="btn solid" data-act="complete-session" data-spid="' + esc(m.sessionPlanId) + '"' + (BUSY ? ' disabled' : '') + '>' + tr('完成 COMPLETE', 'COMPLETE') + '</button>' +
          '<button class="btn" data-act="partial-session" data-spid="' + esc(m.sessionPlanId) + '"' + (BUSY ? ' disabled' : '') + '>' + tr('部分完成 PARTIAL', 'PARTIAL') + '</button>' +
          '<button class="btn warn" data-act="skip-session" data-spid="' + esc(m.sessionPlanId) + '"' + (BUSY ? ' disabled' : '') + '>' + tr('跳过 SKIP', 'SKIP') + '</button>' +
          '</div>');
  }

  function renderSessionResultHTML(m) {
    var log = m.log;
    var statusLabelMap = {
      COMPLETE: tr('训练课节已完成', 'Training session completed'),
      PARTIAL: tr('训练课节部分完成', 'Training session partially completed'),
      SKIPPED: tr('训练课节已跳过', 'Training session skipped')
    };
    var results = log.results.map(function (r, idx) {
      if (!r) return '';
      var criterionHTML = (r.criterionMet == null)
        ? badge('inc', tr('未判定', 'N/A'))
        : badge(r.criterionMet ? 'pos' : 'neg', r.criterionMet ? tr('达标', 'Criterion Met') : tr('未达标', 'Not Met'));
      return '<div class="tr-row"><span>' + esc(m.assignments[idx] ? (m.assignments[idx].drillId || m.assignments[idx].target) : '') + '</span>' +
        '<b>' + fmtNum(r.measuredValue) + '</b> ' + criterionHTML + '</div>';
    }).join('');
    return '<div class="tr-row"><span class="tr-mut">' + tr('执行状态', 'Execution Status') + '</span>' + badge('neu', log.status) + '</div>' +
      '<div class="tr-mut" style="margin:4px 0 10px">' + esc(statusLabelMap[log.status] || '') + '</div>' +
      (results || '<div class="tr-mut">' + tr('无记录结果。', 'No recorded results.') + '</div>') +
      (log.notes ? '<div class="tr-row" style="border:none"><span class="tr-mut">' + tr('备注', 'Notes') + '</span><span>' + esc(log.notes) + '</span></div>' : '') +
      '<div class="tr-banner" style="margin-top:10px">' + tr('达标 ≠ 硬门槛通过；训练课节结果 ≠ 正式评估结果。不代表等级变化。', 'Criterion Met ≠ Hard Gate Passed. Training session result ≠ formal assessment result. No level change is implied.') + '</div>';
  }

  // ---------------- Progress ----------------
  function renderProgress() {
    if (!progressEl) return;
    if (!SELECTED_PLAYER_ID) { progressEl.innerHTML = pickerPromptHTML('drill'); return; }
    progressEl.innerHTML = loadingHTML();
    loadProgressData(SELECTED_PLAYER_ID).then(function (m) {
      if (progressEl) progressEl.innerHTML = renderProgressHTML(m);
    }).catch(function (e) { if (progressEl) progressEl.innerHTML = errorHTML(e); });
  }

  function renderProgressHTML(m) {
    var headTitle = '<div class="tr-h">' + tr('训练进度 / 复测就绪度', 'Training Progress / Re-test Readiness') + '</div>';
    if (!m.hasCycle || !m.hasSummary) {
      return headTitle + '<div class="tr-banner">' + tr('暂无进行中的训练周期', 'NO ACTIVE TRAINING CYCLE') + '</div>' +
        '<button class="btn" data-act="goto-review" style="margin-top:8px">' + tr('前往复盘 Review', 'Go to Review') + '</button>';
    }
    var a = m.adherence;
    var adherenceCard = '<div class="tr-section"><div class="tr-h2">' + tr('训练依从度', 'Training Adherence') + '</div><div class="tr-card">' +
      '<div class="tr-row"><span class="tr-mut">' + tr('计划课节', 'Planned') + '</span><b>' + fmtNum(a.planned) + '</b></div>' +
      '<div class="tr-row"><span class="tr-mut">' + tr('完成', 'Complete') + '</span><b>' + fmtNum(a.complete) + '</b></div>' +
      '<div class="tr-row"><span class="tr-mut">' + tr('部分完成', 'Partial') + '</span><b>' + fmtNum(a.partial) + '</b></div>' +
      '<div class="tr-row"><span class="tr-mut">' + tr('跳过', 'Skipped') + '</span><b>' + fmtNum(a.skipped) + '</b></div>' +
      '<div class="tr-row"><span class="tr-mut">' + tr('未记录', 'Unlogged') + '</span><b>' + fmtNum(a.unlogged) + '</b></div>' +
      '<div class="tr-row" style="border:none"><span class="tr-mut">' + tr('依从率', 'Adherence Rate') + '</span><b>' + fmtPct(a.rate) + '</b></div>' +
      '</div></div>';
    var primaryCard = '<div class="tr-section"><div class="tr-h2">' + tr('主要瓶颈训练暴露', 'Primary Bottleneck Exposure') + '</div><div class="tr-card">' +
      '<div class="tr-row" style="border:none"><span class="tr-mut">' + esc(m.primaryExposure.namespace || '') + ' · ' + esc(m.primaryExposure.metric || '') + '</span><b>' + fmtPct(m.primaryExposure.rate) + '</b></div>' +
      '</div></div>';
    var targetsCard = '<div class="tr-section"><div class="tr-h2">' + tr('复测目标训练暴露（逐项）', 'Re-test Target Exposure (per target)') + '</div><div class="gates">' +
      m.retestTargets.map(function (t) {
        var cls = t.label === 'EXPOSURE_MET' ? 'ok' : (t.label === 'EXPOSURE_BELOW_TARGET' ? 'no' : '');
        var labelText = { EXPOSURE_MET: tr('达标暴露', 'EXPOSURE MET'), EXPOSURE_BELOW_TARGET: tr('暴露不足', 'EXPOSURE BELOW TARGET'), INCOMPLETE: 'INCOMPLETE' }[t.label];
        return '<div class="gate ' + cls + '"><div class="lab">' + esc(t.namespace || t.metric) + '</div><div class="thr">' + esc(labelText) + (t.exposureRate != null ? ' · ' + fmtPct(t.exposureRate) : '') + '</div><div class="dot"></div></div>';
      }).join('') + '</div></div>';
    var matchCard = (m.matchTransferExposure == null) ? '' :
      '<div class="tr-section"><div class="tr-h2">' + tr('实战转化训练暴露', 'Match Transfer Training Exposure') + '</div><div class="tr-card">' +
      '<div class="tr-row" style="border:none"><span class="tr-mut">match_transfer_score</span><b>' + fmtPct(m.matchTransferExposure) + '</b></div>' +
      '<div class="callout warn" style="margin-top:8px">' + tr('仅为训练暴露 — 并非正式实战验证 Match Validation。', 'Training exposure only — not formal Match Validation.') + '</div>' +
      '</div></div>';
    var gatesCard = '<div class="tr-section"><div class="tr-h2">R1–R4</div><div class="gates">' + m.gates.map(gateTile).join('') + '</div></div>';
    var readinessCard = renderReadinessHTML(m.readiness);
    return headTitle + readinessCard + adherenceCard + primaryCard + targetsCard + matchCard + gatesCard;
  }

  function renderReadinessHTML(state) {
    if (state === 'READY') {
      return '<div class="tr-banner tr-ready">' + tr('复测就绪 RE-TEST READY', 'RE-TEST READY') + '</div>' +
        '<div class="tr-mut" style="margin-bottom:8px">' + tr('本训练周期的执行/暴露已足以支持安排正式复测。', 'This training cycle has sufficient execution/exposure to justify formal re-testing.') + '</div>' +
        '<button class="btn solid tr-cta" data-act="goto-measure" style="margin-bottom:14px">' + tr('前往测 / 复测', 'GO TO MEASURE / RE-TEST') + '</button>';
    }
    if (state === 'NOT_READY') {
      return '<div class="tr-banner" style="border-color:var(--fail)">' + tr('需要更多训练 MORE TRAINING REQUIRED', 'MORE TRAINING REQUIRED') + '</div>';
    }
    return '<div class="tr-banner" style="border-style:dashed">' + tr('就绪度数据不完整 READINESS INCOMPLETE', 'READINESS INCOMPLETE') + '</div>' +
      '<div class="tr-mut" style="margin-bottom:8px">' + tr('必要数据或映射缺失，暂无法安全判定复测就绪度。', 'Required data/mapping is missing or cannot safely support a readiness decision.') + '</div>';
  }

  // ---------------- shared small pieces ----------------
  function loadingHTML() { return '<div class="tr-mut" style="margin-top:10px">' + tr('加载中…', 'Loading…') + '</div>'; }
  function errorHTML(e) { return '<div class="tr-mut" style="color:var(--fail);margin-top:10px">' + tr('加载失败：', 'Load failed: ') + esc(e && e.message) + '</div>'; }
  function pickerPromptHTML(tab) {
    return '<div class="tr-mut">' + tr('请先在「练 Drill」选择球员。', 'Choose a player in Training Cycle (Drill) first.') + '</div>' +
      '<button class="btn" data-act="goto-' + tab + '" style="margin-top:8px">' + tr('前往练 Drill', 'Go to Drill') + '</button>';
  }

  function refreshAll() { renderToday(); renderCycleApp(); renderProgress(); }

  function gotoTab(tabName) { if (typeof go === 'function') go(tabName); }

  function readNumberInput(id) {
    var el = document.getElementById(id);
    if (!el || el.value === '') return undefined;
    var n = Number(el.value);
    return isNaN(n) ? undefined : n;
  }

  function gatherExecutionPayload(m) {
    var results = m.assignments.map(function (a) {
      var mv = readNumberInput('tr-mv-' + a.index), att = readNumberInput('tr-att-' + a.index), succ = readNumberInput('tr-succ-' + a.index);
      if (mv === undefined && att === undefined && succ === undefined) return null;
      var r = { assignment_index: a.index };
      if (mv !== undefined) r.measured_value = mv;
      if (att !== undefined) r.attempts = att;
      if (succ !== undefined) r.successful = succ;
      return r;
    }).filter(Boolean);
    var notesEl = document.getElementById('tr-notes');
    return { results: results, notes: notesEl ? notesEl.value : '' };
  }

  function runAction(promise) {
    if (BUSY) return;
    BUSY = true; LAST_ERROR = null;
    renderCycleApp();
    promise.then(function () {
      BUSY = false;
      refreshAll();
    }).catch(function (e) {
      BUSY = false; LAST_ERROR = translateError(e);
      renderCycleApp();
    });
  }

  function onTodayClick(e) {
    var node = e.target.closest('[data-act]'); if (!node) return;
    var act = node.getAttribute('data-act');
    if (act === 'today-open-session') {
      SELECTED_SESSION_PLAN_ID = node.getAttribute('data-spid'); CYCLE_VIEW = 'session';
      gotoTab('drill'); renderCycleApp();
    } else if (act === 'goto-review') gotoTab('review');
    else if (act === 'goto-drill') gotoTab('drill');
  }

  function onCycleClick(e) {
    var node = e.target.closest('[data-act]'); if (!node) return;
    var act = node.getAttribute('data-act');
    if (act === 'pick-player') { SELECTED_PLAYER_ID = node.getAttribute('data-pid'); CYCLE_VIEW = 'cycle'; SELECTED_SESSION_PLAN_ID = null; refreshAll(); return; }
    if (act === 'open-session') { SELECTED_SESSION_PLAN_ID = node.getAttribute('data-spid'); CYCLE_VIEW = 'session'; LAST_ERROR = null; renderCycleApp(); return; }
    if (act === 'back-to-cycle') { CYCLE_VIEW = 'cycle'; SELECTED_SESSION_PLAN_ID = null; SKIP_CONFIRM_PENDING = null; LAST_ERROR = null; renderCycleApp(); return; }
    if (act === 'goto-review') { gotoTab('review'); return; }
    if (act === 'start-session') {
      if (BUSY) return;
      var spid = node.getAttribute('data-spid');
      runAction(PBSessionExecution.startSession(spid));
      return;
    }
    if (act === 'skip-session') { SKIP_CONFIRM_PENDING = node.getAttribute('data-spid'); renderCycleApp(); return; }
    if (act === 'cancel-skip') { SKIP_CONFIRM_PENDING = null; renderCycleApp(); return; }
    if (act === 'confirm-skip' || act === 'complete-session' || act === 'partial-session') {
      if (BUSY) return;
      var sessionPlanId = node.getAttribute('data-spid');
      loadSessionData(sessionPlanId).then(function (m) {
        var payload = (act === 'confirm-skip') ? {} : gatherExecutionPayload(m);
        var fn = (act === 'confirm-skip') ? PBSessionExecution.skipSession
          : (act === 'complete-session') ? PBSessionExecution.completeSession
          : PBSessionExecution.partialSession;
        SKIP_CONFIRM_PENDING = null;
        runAction(fn(sessionPlanId, payload));
      });
    }
  }

  function onProgressClick(e) {
    var node = e.target.closest('[data-act]'); if (!node) return;
    var act = node.getAttribute('data-act');
    if (act === 'goto-measure') gotoTab('measure');
    else if (act === 'goto-review') gotoTab('review');
    else if (act === 'goto-drill') gotoTab('drill');
  }

  function mount() {
    todayEl = document.getElementById(TODAY_ROOT_ID);
    cycleEl = document.getElementById(CYCLE_ROOT_ID);
    progressEl = document.getElementById(PROGRESS_ROOT_ID);
    if (todayEl) todayEl.addEventListener('click', onTodayClick);
    if (cycleEl) cycleEl.addEventListener('click', onCycleClick);
    if (progressEl) progressEl.addEventListener('click', onProgressClick);
    if (!modulesReady()) {
      var msg = '<div class="tr-mut">' + tr('训练模块未就绪（PBStore/PBSessionExecution/PBTrainingReadiness 未加载）。', 'Training modules not ready (PBStore/PBSessionExecution/PBTrainingReadiness not loaded).') + '</div>';
      if (todayEl) todayEl.innerHTML = msg;
      if (cycleEl) cycleEl.innerHTML = msg;
      if (progressEl) progressEl.innerHTML = msg;
      return;
    }
    refreshAll();
  }

  return {
    // 纯函数（可在 Node 下单测，不依赖 DOM/PBStore）
    pickCurrentCycle: pickCurrentCycle,
    pickNextSession: pickNextSession,
    buildTodayViewModel: buildTodayViewModel,
    buildCycleViewModel: buildCycleViewModel,
    buildSessionViewModel: buildSessionViewModel,
    buildProgressViewModel: buildProgressViewModel,
    translateError: translateError,

    // 供页面刷新调用（在浏览器环境挂载后可用）
    refresh: function () { refreshAll(); },
    _mount: mount
  };
});
