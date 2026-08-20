/* ============================================================
 * training-readiness-engine.js — Pickleball App 2.0 Alpha · S8-D
 * Adherence + Training Exposure + Re-test Readiness + CycleSummary
 *
 * 把 S8-A/B/C 已产出的 TrainingCycle / WeeklyPlan / SessionPlan /
 * SessionLog 数据，转化为确定性的训练周期 readiness 摘要。
 *
 * 本模块只回答"训练是否被执行、目标是否被充分暴露、是否可以安排正式复测"，
 * 绝不回答"能力是否提升、硬门槛是否通过、Match Validation 是否通过、
 * 等级是否变化、是否应晋级"——那些概念完全归属 S7 Review 逻辑与冻结的
 * Master Control V2 判级公式，本模块绝不重新实现或绕过。
 *
 * 冻结不变量（贯穿全文件强制成立）：
 *   Adherence != Capability
 *   Training Completion != Hard Gate Passed
 *   RETEST_READY != PROMOTED
 *   Training Match Transfer Exposure != Formal Match Validation
 *   Missing required data = INCOMPLETE（绝不降级为 NOT_READY）
 *
 * 存储：完全复用既有 S8-A storage API（PBStore.getTrainingCycle /
 * listSessionPlansByCycle / listSessionLogsByCycle / createCycleSummary /
 * getCycleSummaryByCycle / updateCycleSummary）。本文件不修改 js/storage.js、
 * 不新增 IndexedDB store/index——现有 cycle_summaries schema（尤其是自由格式的
 * training_exposure 字段）已足够承载本阶段全部输出，零存储层改动。
 *
 * 确定性：所有计算均为对已持久化数据的纯函数变换，无随机数、无 LLM、
 * 无外部/云调用、无时间相关评分；calculated_at 仅作为生成时间的元信息
 * 写入 training_exposure 内部，从不参与任何判定比较。
 *
 * S8-E：retest_target_detail[] 新增 meets_threshold 字段——把 R3 内部本就
 * 对照 RETEST_READINESS_THRESHOLDS.MIN_RETEST_TARGET_EXPOSURE 做的同一次
 * 比较，逐项也附加出来，供 S8-E UI 直接读取展示"EXPOSURE MET / BELOW
 * TARGET"，不必在 UI 层重复实现阈值比较逻辑。未新增阈值、未改变任何
 * 门槛判定结果，纯粹是把既有内部比较结果多暴露一份 —— 详见
 * docs/S8-E-TRAINING-UI.md。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBTrainingReadiness = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function ReadinessError(code, message) {
    var err = new Error(message || code);
    err.name = 'ReadinessError';
    err.code = code;
    return err;
  }

  // ---- 冻结阈值：集中于此一处，禁止在其它函数中散落魔法数字（Section 10）----
  var RETEST_READINESS_THRESHOLDS = {
    MIN_ADHERENCE: 0.80,
    MIN_PRIMARY_EXPOSURE: 0.75,
    MIN_RETEST_TARGET_EXPOSURE: 0.70
  };

  function nowISO() { return new Date().toISOString(); }

  // ---- 会话完成度credit（Section 4/5 冻结规则）：COMPLETE=1 / PARTIAL=0.5 / SKIPPED|NO LOG=0 ----
  function sessionCredit(log) {
    if (!log) return 0;
    if (log.status === 'COMPLETE') return 1;
    if (log.status === 'PARTIAL') return 0.5;
    return 0; // SKIPPED，或既有冻结枚举之外的任何值（防御性，不应出现）
  }
  function sessionExecuted(log) {
    return !!log && (log.status === 'COMPLETE' || log.status === 'PARTIAL');
  }

  // ---- 解析 S7-B primary_bottleneck 字符串（与 training-plan-engine.js 相同的纯函数，
  // 本文件独立复制一份而非跨模块 require，避免引擎间产生脆弱的内部耦合——与仓库既有
  // 各引擎彼此独立读取持久化字段、不互相 require 内部实现的约定一致）----
  function parseBottleneckMetric(primary_bottleneck) {
    if (typeof primary_bottleneck !== 'string' || !primary_bottleneck) return { type: null, metric: null };
    if (primary_bottleneck.indexOf('hard_gate:') === 0) return { type: 'hard_gate', metric: primary_bottleneck.slice('hard_gate:'.length) };
    if (primary_bottleneck === 'match_validation') return { type: 'match_validation', metric: 'match_transfer_score' };
    if (primary_bottleneck === 'capability_threshold') return { type: 'capability_threshold', metric: null };
    if (primary_bottleneck === 'evidence') return { type: 'evidence', metric: null };
    return { type: 'unknown', metric: null };
  }

  // ================================================================
  // calculateAdherence — Section 4. 纯粹的会话执行统计，不涉及具体 assignment。
  // ================================================================
  function calculateAdherence(cycle_id) {
    if (typeof PBStore === 'undefined') return Promise.reject(new Error('PBStore not loaded'));
    return Promise.all([
      PBStore.listSessionPlansByCycle(cycle_id),
      PBStore.listSessionLogsByCycle(cycle_id)
    ]).then(function (r) {
      var plans = r[0] || [], logs = r[1] || [];
      var logByPlan = {};
      logs.forEach(function (l) { logByPlan[l.session_plan_id] = l; }); // S8-C 保证每个 SessionPlan 最多一条终态 SessionLog

      var complete = 0, partial = 0, skipped = 0, unlogged = 0;
      plans.forEach(function (p) {
        var log = logByPlan[p.session_plan_id];
        if (!log) { unlogged++; return; }
        if (log.status === 'COMPLETE') complete++;
        else if (log.status === 'PARTIAL') partial++;
        else if (log.status === 'SKIPPED') skipped++;
        else unlogged++; // 防御性：既有冻结枚举之外的值一律不计入完成度
      });

      var planned_sessions = plans.length;
      var completion_equivalent = complete * 1.0 + partial * 0.5;
      var adherence_rate = (planned_sessions > 0) ? (completion_equivalent / planned_sessions) : null;

      return {
        cycle_id: cycle_id,
        planned_sessions: planned_sessions,
        complete_sessions: complete,
        partial_sessions: partial,
        skipped_sessions: skipped,
        unlogged_sessions: unlogged,
        completion_equivalent: completion_equivalent,
        adherence_rate: adherence_rate // null 仅当 planned_sessions===0（无法计算，不可当作 0）
      };
    });
  }

  // ================================================================
  // calculateTrainingExposure — Section 5/6/7/9. 按 (session, assignment) 展开，
  // 每个 assignment 继承其所在 SessionLog 的 credit（S8-C 尚无逐 assignment 执行状态）。
  // ================================================================
  function calculateTrainingExposure(cycle_id) {
    if (typeof PBStore === 'undefined') return Promise.reject(new Error('PBStore not loaded'));
    return Promise.all([
      PBStore.getTrainingCycle(cycle_id),
      PBStore.listSessionPlansByCycle(cycle_id),
      PBStore.listSessionLogsByCycle(cycle_id)
    ]).then(function (r) {
      var cycle = r[0], plans = r[1] || [], logs = r[2] || [];
      if (!cycle) throw ReadinessError('CYCLE_NOT_FOUND', 'TrainingCycle not found: ' + cycle_id);

      var logByPlan = {};
      logs.forEach(function (l) { logByPlan[l.session_plan_id] = l; });

      var occurrences = [];
      plans.forEach(function (p) {
        var log = logByPlan[p.session_plan_id];
        var credit = sessionCredit(log);
        var executed = sessionExecuted(log);
        (p.assignments || []).forEach(function (a) {
          occurrences.push({ role: a.role, target: a.target, assessment_namespace: a.assessment_namespace, credit: credit, executed: executed });
        });
      });

      // ---- Section 6: Primary Bottleneck Exposure. 权威瓶颈只读取既有 TrainingCycle.primary_bottleneck
      // （S8-B 建周期时已从 S7 Prescription 复制而来），本引擎绝不重新计算瓶颈本身。----
      var parsed = parseBottleneckMetric(cycle.primary_bottleneck);
      var primary_metric = parsed.metric;
      var primary_exposure_rate = null, primary_incomplete_reason = null, primary_namespace = null;
      if (!primary_metric) {
        primary_incomplete_reason = 'primary_bottleneck has no mappable single metric (type: ' + (parsed.type || 'missing') + ')';
      } else {
        var primaryOccurrences = occurrences.filter(function (o) { return o.role === 'PRIMARY' && o.target === primary_metric; });
        if (!primaryOccurrences.length) {
          primary_incomplete_reason = 'no PRIMARY-role assignment found for primary bottleneck metric "' + primary_metric + '"';
        } else {
          primary_namespace = primaryOccurrences[0].assessment_namespace || null;
          primary_exposure_rate = primaryOccurrences.reduce(function (s, o) { return s + o.credit; }, 0) / primaryOccurrences.length;
        }
      }

      // ---- Section 7: 逐个 retest target 独立追踪（绝不用平均值掩盖某一项不达标）。
      // exposure 覆盖该 metric 在整个周期内的全部出现（不仅限于 RETEST 周），因为一个目标在
      // ACQUISITION/STABILIZATION 阶段获得的训练同样是对该目标的真实暴露。----
      var retestTargets = cycle.retest_targets || [];
      var retest_target_exposure = {};
      var retest_target_detail = [];
      retestTargets.forEach(function (metric) {
        var occ = occurrences.filter(function (o) { return o.target === metric; });
        var namespace = (occ[0] && occ[0].assessment_namespace) || null;
        var key = namespace || metric; // 理论上不该发生（无命名空间即视为未映射），仅作防御性 key 兜底
        if (!occ.length) {
          // Section 7: 无法安全映射的必测目标 -> 整体结果必须 INCOMPLETE，绝不臆造暴露值。
          retest_target_exposure[key] = null;
          retest_target_detail.push({ metric: metric, namespace: null, exposure_rate: null, occurrence_count: 0, has_complete_or_partial: false, meets_threshold: null });
          return;
        }
        var rate = occ.reduce(function (s, o) { return s + o.credit; }, 0) / occ.length;
        var hasExec = occ.some(function (o) { return o.executed; });
        retest_target_exposure[key] = rate;
        // meets_threshold：把 R3 内部已做的同一次比较（对照下方同一个 RETEST_READINESS_THRESHOLDS
        // 常量，不是新阈值）也附加到逐项 detail 上，供 S8-E UI 直接读取展示，不必在 UI 层重复实现
        // 阈值比较逻辑（S8-E Section 21 明确要求 UI 不得自行复制门槛判定）。
        retest_target_detail.push({ metric: metric, namespace: namespace, exposure_rate: rate, occurrence_count: occ.length, has_complete_or_partial: hasExec, meets_threshold: rate >= RETEST_READINESS_THRESHOLDS.MIN_RETEST_TARGET_EXPOSURE });
      });

      // ---- Section 9: Match Transfer 训练暴露——只按 metric 精确匹配 match_transfer_score，
      // 不按 role==='TRANSFER' 笼统统计（PRESSURE_TRANSFER 周的抗压 assignment 在 S8-B 中
      // 同样使用 role='TRANSFER'，必须用 metric 区分，否则会把两种不同训练目标的暴露量混淆）。
      // 纯训练暴露信息，绝不进入 CAP、绝不等同于正式 Match Validation。----
      var matchOccurrences = occurrences.filter(function (o) { return o.target === 'match_transfer_score'; });
      var match_transfer_exposure = matchOccurrences.length
        ? matchOccurrences.reduce(function (s, o) { return s + o.credit; }, 0) / matchOccurrences.length
        : null;

      return {
        cycle_id: cycle_id,
        primary_metric: primary_metric,
        primary_namespace: primary_namespace,
        primary_exposure_rate: primary_exposure_rate,
        primary_incomplete_reason: primary_incomplete_reason,
        retest_target_exposure: retest_target_exposure,
        retest_target_detail: retest_target_detail,
        match_transfer_exposure: match_transfer_exposure
      };
    });
  }

  function gateResult(gate, result, reason, value, detail) {
    var o = { gate: gate, result: result };
    if (reason != null) o.reason = reason;
    if (value != null) o.value = value;
    if (detail != null) o.detail = detail;
    return o;
  }

  // ================================================================
  // evaluateRetestReadiness — Section 11/12. R1-R4 四道门，语义状态
  // 严格三选一：READY / NOT_READY / INCOMPLETE（INCOMPLETE 优先于 NOT_READY）。
  // ================================================================
  function evaluateRetestReadiness(cycle_id) {
    if (typeof PBStore === 'undefined') return Promise.reject(new Error('PBStore not loaded'));
    return Promise.all([
      PBStore.getTrainingCycle(cycle_id),
      calculateAdherence(cycle_id),
      calculateTrainingExposure(cycle_id)
    ]).then(function (r) {
      var cycle = r[0], adherence = r[1], exposure = r[2];
      if (!cycle) throw ReadinessError('CYCLE_NOT_FOUND', 'TrainingCycle not found: ' + cycle_id);

      var gates = {};

      // R1 — Adherence
      if (adherence.adherence_rate == null) {
        gates.R1 = gateResult('R1_ADHERENCE', 'INCOMPLETE', 'no planned sessions to calculate adherence from');
      } else {
        gates.R1 = gateResult('R1_ADHERENCE', adherence.adherence_rate >= RETEST_READINESS_THRESHOLDS.MIN_ADHERENCE ? 'PASS' : 'FAIL', null, adherence.adherence_rate);
      }

      // R2 — Primary Bottleneck Exposure
      if (exposure.primary_exposure_rate == null) {
        gates.R2 = gateResult('R2_PRIMARY_EXPOSURE', 'INCOMPLETE', exposure.primary_incomplete_reason);
      } else {
        gates.R2 = gateResult('R2_PRIMARY_EXPOSURE', exposure.primary_exposure_rate >= RETEST_READINESS_THRESHOLDS.MIN_PRIMARY_EXPOSURE ? 'PASS' : 'FAIL', null, exposure.primary_exposure_rate);
      }

      // R3 — Retest Target Coverage（逐项判定，不取平均）+ R4 — Execution Evidence Sufficiency
      var detail = exposure.retest_target_detail || [];
      var r3State, r4State, gateReason = null;
      if (!detail.length) {
        r3State = 'INCOMPLETE'; r4State = 'INCOMPLETE'; gateReason = 'no retest targets are defined on this TrainingCycle';
      } else if (detail.some(function (d) { return d.exposure_rate == null; })) {
        r3State = 'INCOMPLETE'; r4State = 'INCOMPLETE'; gateReason = 'one or more required retest targets could not be safely mapped to a planned assignment';
      } else {
        r3State = detail.every(function (d) { return d.meets_threshold; }) ? 'PASS' : 'FAIL'; // 复用 detail 上已算好的同一次比较，避免两处各自重复阈值判定
        r4State = detail.every(function (d) { return d.has_complete_or_partial; }) ? 'PASS' : 'FAIL';
      }
      gates.R3 = gateResult('R3_RETEST_TARGET_COVERAGE', r3State, gateReason, null, detail);
      gates.R4 = gateResult('R4_EXECUTION_EVIDENCE', r4State, gateReason, null, detail);

      var states = [gates.R1.result, gates.R2.result, gates.R3.result, gates.R4.result];
      var overall;
      if (states.indexOf('INCOMPLETE') !== -1) overall = 'INCOMPLETE'; // Master Control: Missing = INCOMPLETE, never collapsed into NOT_READY
      else if (states.every(function (s) { return s === 'PASS'; })) overall = 'READY';
      else overall = 'NOT_READY';

      return {
        cycle_id: cycle_id,
        retest_readiness: overall,
        gates: gates,
        adherence: adherence,
        exposure: exposure
      };
    });
  }

  // ================================================================
  // buildCycleSummary — Section 13. 每个 cycle 只维护一份"当前" CycleSummary
  // （存在则 update，不存在则 create），复用既有 S8-A storage 约定，不创建
  // 无界历史流。绝不写入 Section 14 列出的任何禁止字段。
  // ================================================================
  function buildCycleSummary(cycle_id) {
    if (typeof PBStore === 'undefined') return Promise.reject(new Error('PBStore not loaded'));
    return evaluateRetestReadiness(cycle_id).then(function (readiness) {
      var a = readiness.adherence, e = readiness.exposure;
      var next_action = (readiness.retest_readiness === 'READY') ? 'RETEST' : 'NONE';

      var summaryData = {
        cycle_id: cycle_id,
        planned_sessions: a.planned_sessions,
        completed_sessions: a.complete_sessions,
        adherence: a.adherence_rate,
        retest_readiness: readiness.retest_readiness,
        next_action: next_action,
        training_exposure: {
          calculated_at: nowISO(), // 元信息：生成时间，绝不参与任何判定比较（Section 17）
          complete_sessions: a.complete_sessions,
          partial_sessions: a.partial_sessions,
          skipped_sessions: a.skipped_sessions,
          unlogged_sessions: a.unlogged_sessions,
          completion_equivalent: a.completion_equivalent,
          adherence_rate: a.adherence_rate,
          primary_exposure_rate: e.primary_exposure_rate,
          primary_metric: e.primary_metric,
          primary_namespace: e.primary_namespace,
          retest_target_exposure: e.retest_target_exposure,
          retest_target_detail: e.retest_target_detail,
          match_transfer_exposure: e.match_transfer_exposure,
          gates: readiness.gates,
          thresholds: RETEST_READINESS_THRESHOLDS
        }
      };

      return PBStore.getCycleSummaryByCycle(cycle_id).then(function (existing) {
        if (existing) return PBStore.updateCycleSummary(existing.cycle_summary_id, summaryData);
        return PBStore.createCycleSummary(summaryData);
      });
    });
  }

  return {
    calculateAdherence: calculateAdherence,
    calculateTrainingExposure: calculateTrainingExposure,
    evaluateRetestReadiness: evaluateRetestReadiness,
    buildCycleSummary: buildCycleSummary,
    ReadinessError: ReadinessError,
    RETEST_READINESS_THRESHOLDS: Object.assign({}, RETEST_READINESS_THRESHOLDS),
    parseBottleneckMetric: parseBottleneckMetric
  };
});
