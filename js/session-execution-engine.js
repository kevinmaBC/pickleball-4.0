/* ============================================================
 * session-execution-engine.js — Pickleball App 2.0 Alpha · S8-C Session Execution Engine
 * 把 S8-B 已生成的 SessionPlan（计划意图）经由 START -> ACTIVE -> 终态
 * 流程，转化为一条持久化的 SessionLog（执行事实）。
 *
 * 本模块只做"记录发生了什么"，绝不做"评判/聚合/晋级"：
 *   - 不计算 adherence / training_exposure（属于未来 S8-D）。
 *   - 不计算 RETEST_READY，不创建/触发 retest 或 CycleSummary（S8-D）。
 *   - 不创建 TrainingCycle/WeeklyPlan（S8-B 已完成，本模块只消费既有 SessionPlan）。
 *   - 不推荐 drill、不新增训练 UI（属于未来 S8-E）。
 *   - 不晋级、不写 validated_training_level（S8 全阶段禁止）。
 *   - 不自动把 criterion_met=true 解读为 Hard Gate Passed / Validated Level
 *     改变 / RETEST_READY —— 这些概念仍完全归属 S7/未来 S8-D。
 *
 * 架构决策（Section 9，需在此记录）：Active 执行状态只存于本模块内存
 * （_active，进程/页面生命周期内有效，不落库），不新增第 6 个 IndexedDB
 * store。只有终态（COMPLETE/PARTIAL/SKIPPED）才通过 PBStore.createSessionLog
 * 落库为真正的 SessionLog。这样可避免为一个"用户按了开始但还没结束"的
 * 临时状态引入持久化设计，也天然满足"Plan != Execution Log"——SessionPlan
 * 本身在 START 阶段完全不被触碰。
 *
 * 单一终态日志规则（Section 8）：一个 SessionPlan 最多只能有一条终态
 * SessionLog（COMPLETE/PARTIAL/SKIPPED 均计入"已终态化"）。复用 S8-A 既有
 * by_session_plan 索引（PBStore.getFinalSessionLogByPlan）判重，第二次
 * finalize 一律拒绝为 SESSION_ALREADY_FINALIZED，不产生静默重复记录。
 *
 * Namespace 复用 js/namespace.js（不新建第二套归一系统）；Evidence
 * 安全性：本模块产出的 evidence_links[].evidence_class 恒为 null——训练执行
 * 本身绝不自动升级为已判定的 C1-C4 评估证据。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBSessionExecution = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function ExecutionError(code, message) {
    var err = new Error(message || code);
    err.name = 'ExecutionError';
    err.code = code;
    return err;
  }

  var STARTABLE_STATUSES = ['PLANNED', 'AVAILABLE'];
  var FINAL_STATUSES = ['COMPLETE', 'PARTIAL', 'SKIPPED'];

  function nowISO() { return new Date().toISOString(); }

  // ---- Active execution state：进程内存，不持久化（见文件头架构决策）----
  var _active = {};

  function normalizeNamespace(ns) {
    if (ns == null) return null;
    if (typeof PBNamespace === 'undefined') return ns;
    if (PBNamespace.isCanonical(ns)) return ns;
    if (PBNamespace.isLegacy(ns)) return PBNamespace.toCanonical(ns);
    return ns; // 未知 ID：原样保留，不臆造归一结果
  }

  // ---- 机械化、可解释的成功判据解析：仅识别 S8-B 产出的固定格式
  // "<metric> >= <threshold>" / "<metric> <= <threshold>"，解析失败一律 null，不猜测 ----
  var CRITERION_RE = /^.+?\s*(>=|<=)\s*(-?\d+(?:\.\d+)?)$/;
  function evaluateCriterion(successCriterion, measuredValue) {
    if (typeof successCriterion !== 'string' || typeof measuredValue !== 'number' || isNaN(measuredValue)) return null;
    var m = CRITERION_RE.exec(successCriterion.trim());
    if (!m) return null;
    var op = m[1], threshold = parseFloat(m[2]);
    if (op === '>=') return measuredValue >= threshold;
    if (op === '<=') return measuredValue <= threshold;
    return null;
  }

  function findAssignment(assignments, entry) {
    if (entry.assignment_index !== undefined) {
      return (Number.isInteger(entry.assignment_index) && entry.assignment_index >= 0 && entry.assignment_index < assignments.length)
        ? assignments[entry.assignment_index] : undefined;
    }
    if (entry.drill_id === undefined && entry.assessment_namespace === undefined) return undefined;
    return assignments.filter(function (a) {
      return (entry.drill_id === undefined || entry.drill_id === a.drill_id) &&
        (entry.assessment_namespace === undefined || normalizeNamespace(entry.assessment_namespace) === a.assessment_namespace);
    })[0];
  }

  // ---- 计划归属完整性（Section 20）：result/evidence_link 必须对应 SessionPlan 上真实存在的 assignment ----
  function validateAgainstAssignments(assignments, entries, kind) {
    (entries || []).forEach(function (e) {
      if (e == null || typeof e !== 'object' || Array.isArray(e)) throw ExecutionError('INVALID_EXECUTION_PAYLOAD', kind + ' entries must be objects');
      if (e.assignment_index !== undefined) {
        if (!Number.isInteger(e.assignment_index) || e.assignment_index < 0 || e.assignment_index >= assignments.length) {
          throw ExecutionError('EXECUTION_ASSIGNMENT_MISMATCH', kind + ': assignment_index ' + e.assignment_index + ' does not exist on this SessionPlan');
        }
        var a = assignments[e.assignment_index];
        if (e.drill_id !== undefined && e.drill_id !== a.drill_id) {
          throw ExecutionError('EXECUTION_ASSIGNMENT_MISMATCH', kind + ': drill_id "' + e.drill_id + '" does not match assignment_index ' + e.assignment_index);
        }
        if (e.assessment_namespace !== undefined && normalizeNamespace(e.assessment_namespace) !== a.assessment_namespace) {
          throw ExecutionError('EXECUTION_ASSIGNMENT_MISMATCH', kind + ': assessment_namespace "' + e.assessment_namespace + '" does not match assignment_index ' + e.assignment_index);
        }
      } else if (e.drill_id !== undefined || e.assessment_namespace !== undefined) {
        if (!findAssignment(assignments, e)) {
          throw ExecutionError('EXECUTION_ASSIGNMENT_MISMATCH', kind + ': drill_id/assessment_namespace does not match any assignment on this SessionPlan');
        }
      }
    });
  }

  function buildResultEntry(assignments, entry) {
    var assignment = findAssignment(assignments, entry);
    var measuredValue = (typeof entry.measured_value === 'number') ? entry.measured_value : null;
    var successCriterion = (assignment && assignment.success_criterion) || (typeof entry.success_criterion === 'string' ? entry.success_criterion : null);
    return {
      assignment_index: (entry.assignment_index !== undefined) ? entry.assignment_index : (assignment ? assignments.indexOf(assignment) : null),
      assessment_namespace: normalizeNamespace(entry.assessment_namespace !== undefined ? entry.assessment_namespace : (assignment && assignment.assessment_namespace)),
      drill_id: (entry.drill_id !== undefined) ? entry.drill_id : ((assignment && assignment.drill_id) || null),
      attempts: (entry.attempts === undefined ? null : entry.attempts),
      successful: (entry.successful === undefined ? null : entry.successful),
      measured_value: measuredValue,
      unit: entry.unit || null,
      success_criterion: successCriterion,
      // Section 17: mechanically derived only, and only ever a local per-result fact —
      // never Hard-Gate/Validated-Level/RETEST_READY judgment.
      criterion_met: evaluateCriterion(successCriterion, measuredValue)
    };
  }

  // ---- Evidence link（Section 18）：source_id 在持久化后回填为真正的 session_log_id；
  // evidence_class 恒为 null —— S8-C 绝不自动判定 C1-C4 ----
  function buildEvidenceLinkEntry(assignments, entry) {
    entry = entry || {};
    var assignment = findAssignment(assignments, entry);
    return {
      assessment_namespace: normalizeNamespace(entry.assessment_namespace !== undefined ? entry.assessment_namespace : (assignment && assignment.assessment_namespace)),
      source_type: 'TRAINING_SESSION',
      source_id: null,
      drill_id: (entry.drill_id !== undefined) ? entry.drill_id : ((assignment && assignment.drill_id) || null),
      metric: (entry.metric !== undefined) ? entry.metric : ((assignment && assignment.target) || null),
      evidence_class: null
    };
  }

  function validatePayloadShape(payload) {
    payload = payload || {};
    if (payload.results !== undefined && !Array.isArray(payload.results)) throw ExecutionError('INVALID_EXECUTION_PAYLOAD', 'results must be an array');
    if (payload.evidence_links !== undefined && !Array.isArray(payload.evidence_links)) throw ExecutionError('INVALID_EXECUTION_PAYLOAD', 'evidence_links must be an array');
    if (payload.notes !== undefined && typeof payload.notes !== 'string') throw ExecutionError('INVALID_EXECUTION_PAYLOAD', 'notes must be a string');
    return payload;
  }

  function isValidISOTimestamp(v) { return typeof v === 'string' && v !== '' && !isNaN(Date.parse(v)); }

  // ---- 时间戳规则（Section 22）：ISO 8601；started_at <= completed_at（两者都存在时）----
  function validateTimestamps(started_at, completed_at) {
    if (started_at != null && !isValidISOTimestamp(started_at)) throw ExecutionError('INVALID_EXECUTION_PAYLOAD', 'started_at is not a valid ISO 8601 timestamp');
    if (completed_at != null && !isValidISOTimestamp(completed_at)) throw ExecutionError('INVALID_EXECUTION_PAYLOAD', 'completed_at is not a valid ISO 8601 timestamp');
    if (started_at != null && completed_at != null && Date.parse(started_at) > Date.parse(completed_at)) {
      throw ExecutionError('INVALID_TIMESTAMP_ORDER', 'completed_at (' + completed_at + ') must not be earlier than started_at (' + started_at + ')');
    }
  }

  // ================================================================
  // startSession — Section 9: 确认 SessionPlan/父 Week/父 Cycle 存在、无既有终态
  // 日志、状态可启动，然后建立一条内存态 active execution state（不落库）。
  // ================================================================
  function startSession(session_plan_id, options) {
    if (typeof PBStore === 'undefined') return Promise.reject(new Error('PBStore not loaded'));
    options = options || {};
    if (!session_plan_id) return Promise.reject(ExecutionError('SESSION_NOT_FOUND', 'session_plan_id is required'));

    return PBStore.getSessionPlan(session_plan_id).then(function (sp) {
      if (!sp) throw ExecutionError('SESSION_NOT_FOUND', 'SessionPlan not found: ' + session_plan_id);
      if (STARTABLE_STATUSES.indexOf(sp.status) === -1) {
        throw ExecutionError('SESSION_NOT_STARTABLE', 'SessionPlan status is ' + sp.status + ', cannot start');
      }
      return PBStore.getWeeklyPlan(sp.week_plan_id).then(function (wp) {
        if (!wp) throw ExecutionError('SESSION_NOT_STARTABLE', 'parent WeeklyPlan no longer exists: ' + sp.week_plan_id);
        return PBStore.getTrainingCycle(sp.cycle_id);
      }).then(function (cycle) {
        if (!cycle) throw ExecutionError('SESSION_NOT_STARTABLE', 'parent TrainingCycle no longer exists: ' + sp.cycle_id);
        return PBStore.getFinalSessionLogByPlan(session_plan_id);
      }).then(function (existingLog) {
        if (existingLog) throw ExecutionError('SESSION_ALREADY_FINALIZED', 'SessionPlan already has a finalized SessionLog: ' + existingLog.session_log_id);
        if (_active[session_plan_id]) throw ExecutionError('SESSION_ALREADY_ACTIVE', 'an active execution state already exists for this SessionPlan');

        var state = {
          session_plan_id: session_plan_id,
          week_plan_id: sp.week_plan_id,
          cycle_id: sp.cycle_id,
          started_at: (options.started_at !== undefined ? options.started_at : nowISO())
        };
        if (!isValidISOTimestamp(state.started_at)) throw ExecutionError('INVALID_EXECUTION_PAYLOAD', 'started_at is not a valid ISO 8601 timestamp');
        _active[session_plan_id] = state;
        return Object.assign({}, state);
      });
    });
  }

  function getSessionExecutionState(session_plan_id) {
    var s = _active[session_plan_id];
    return s ? Object.assign({}, s) : null;
  }

  // ================================================================
  // finalizeSession — 共同落地逻辑：COMPLETE / PARTIAL / SKIPPED 三选一。
  // 只经由 PBStore.createSessionLog 落库（不绕过 S8-A storage API），
  // 成功后按 Section 15 同步 SessionPlan 生命周期字段（仅 status，不写入
  // 任何 objective/assignments/sequence/week_plan_id/cycle_id）。
  // ================================================================
  function finalizeSession(session_plan_id, status, payload) {
    if (typeof PBStore === 'undefined') return Promise.reject(new Error('PBStore not loaded'));
    if (typeof PBNamespace === 'undefined') return Promise.reject(new Error('PBNamespace not loaded'));
    if (!session_plan_id) return Promise.reject(ExecutionError('SESSION_NOT_FOUND', 'session_plan_id is required'));
    if (FINAL_STATUSES.indexOf(status) === -1) return Promise.reject(ExecutionError('INVALID_EXECUTION_PAYLOAD', 'invalid status: ' + status));

    var validatedPayload;
    try {
      validatedPayload = validatePayloadShape(payload);
    } catch (e) {
      return Promise.reject(e);
    }

    return PBStore.getSessionPlan(session_plan_id).then(function (sp) {
      if (!sp) throw ExecutionError('SESSION_NOT_FOUND', 'SessionPlan not found: ' + session_plan_id);
      return PBStore.getFinalSessionLogByPlan(session_plan_id).then(function (existing) {
        if (existing) throw ExecutionError('SESSION_ALREADY_FINALIZED', 'SessionPlan already has a finalized SessionLog: ' + existing.session_log_id);

        var active = _active[session_plan_id];
        var started_at = (validatedPayload.started_at !== undefined) ? validatedPayload.started_at : (active ? active.started_at : null);
        var completed_at = (validatedPayload.completed_at !== undefined) ? validatedPayload.completed_at : nowISO();
        validateTimestamps(started_at, completed_at);

        var assignments = sp.assignments || [];
        var results = [], evidenceLinks = [];
        // Section 14: a SKIPPED session must never carry fabricated execution results,
        // regardless of what a caller's payload happens to contain.
        if (status !== 'SKIPPED') {
          validateAgainstAssignments(assignments, validatedPayload.results, 'results');
          validateAgainstAssignments(assignments, validatedPayload.evidence_links, 'evidence_links');
          results = (validatedPayload.results || []).map(function (e) { return buildResultEntry(assignments, e); });
          evidenceLinks = (validatedPayload.evidence_links || []).map(function (e) { return buildEvidenceLinkEntry(assignments, e); });
        }

        var logDraft = {
          session_plan_id: session_plan_id,
          started_at: started_at,
          completed_at: completed_at,
          status: status,
          results: results,
          evidence_links: evidenceLinks,
          notes: validatedPayload.notes || ''
        };

        return PBStore.createSessionLog(logDraft).then(function (created) {
          delete _active[session_plan_id];

          function syncPlanAndReturn(finalRecord) {
            // Section 15: COMPLETE and PARTIAL both mean "execution finalized" for the SessionPlan
            // slot -> status COMPLETED (there is no SessionPlan-level PARTIAL enum in S8-A, and
            // Section 15 explicitly prefers not adding one). SKIPPED maps 1:1 to SKIPPED.
            var planStatus = (status === 'SKIPPED') ? 'SKIPPED' : 'COMPLETED';
            return PBStore.updateSessionPlan(session_plan_id, { status: planStatus }).then(function () { return finalRecord; });
          }

          if (evidenceLinks.length) {
            var backfilled = evidenceLinks.map(function (e) { return Object.assign({}, e, { source_id: created.session_log_id }); });
            return PBStore.put('session_logs', Object.assign({}, created, { evidence_links: backfilled })).then(syncPlanAndReturn);
          }
          return syncPlanAndReturn(created);
        });
      });
    });
  }

  function completeSession(session_plan_id, executionPayload) { return finalizeSession(session_plan_id, 'COMPLETE', executionPayload); }
  function partialSession(session_plan_id, executionPayload) { return finalizeSession(session_plan_id, 'PARTIAL', executionPayload); }
  function skipSession(session_plan_id, skipPayload) { return finalizeSession(session_plan_id, 'SKIPPED', skipPayload); }

  return {
    startSession: startSession,
    completeSession: completeSession,
    partialSession: partialSession,
    skipSession: skipSession,
    finalizeSession: finalizeSession,
    getSessionExecutionState: getSessionExecutionState,
    ExecutionError: ExecutionError,
    STARTABLE_STATUSES: STARTABLE_STATUSES.slice(),
    FINAL_STATUSES: FINAL_STATUSES.slice(),
    evaluateCriterion: evaluateCriterion
  };
});
