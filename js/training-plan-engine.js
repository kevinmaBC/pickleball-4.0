/* ============================================================
 * training-plan-engine.js — Pickleball App 2.0 Alpha · S8-B Adaptive Plan Engine
 * 把已被 S7 判定的 Review Snapshot + Prescription（primary_bottleneck /
 * failed_hard_gates / target_level）转化为 S8-A 存储结构中的
 * TrainingCycle -> WeeklyPlan[] -> SessionPlan[] 计划骨架。
 *
 * 本模块只做"计划"，绝不做"执行"：
 *   - 不创建 SessionLog（执行记录属于未来 S8-C）。
 *   - 不计算 adherence / training_exposure（属于未来 S8-D）。
 *   - 不计算 RETEST_READY，也不创建 CycleSummary（属于未来 S8-D）。
 *   - 不晋级、不写 validated_training_level（S8 全阶段禁止）。
 *   - 不重新推导 Primary Bottleneck（只读取 S7-B 已产出的
 *     prescription.data.primary_bottleneck / snapshot.failed_hard_gates，
 *     绝不用新公式替换 Master Control V2 已冻结的优先级判定）。
 *
 * 确定性（Section 8）：相同的 source 数据 + 相同的合法输入 -> 相同的逻辑训练结构
 * （周数、阶段序列、目标序列、drill 映射、session 逻辑结构）。不使用随机数、
 * LLM、外部/云服务或隐藏启发式评分；ID/时间戳允许随运行不同。
 *
 * Drill/内容映射复用仓库既有 data/prescription_rules_v2_3_1.json
 * （metric -> BLOCK）与 data/test_definitions_v2_3_1.json（metric -> test id），
 * 不新建平行的 drill 目录；namespace 复用既有 js/namespace.js
 * （T01..T10 legacy -> ASMT-01..10 canonical），不新建第二套命名空间
 * 归一系统 —— 因此本模块的 assessment_namespace 输出为仓库中真实存在的
 * ASMT-xx 规范 ID，而非任务书示例中仅作占位说明、代码库内并无具体定义的
 * TECH-xx / DEC-xx（详见 docs/S8-B-ADAPTIVE-PLAN-ENGINE.md）。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBTrainingPlan = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function PlanningError(code, message) {
    var err = new Error(message || code);
    err.name = 'PlanningError';
    err.code = code;
    return err;
  }

  // ---- 冻结边界（Section 9/10）：只允许这些有界选项，不做用户自定义扩展 ----
  var CYCLE_LENGTH_OPTIONS = [4, 5, 6];
  var CYCLE_LENGTH_DEFAULT = 6;
  var SESSIONS_PER_WEEK_OPTIONS = [2, 3, 4];
  var SESSIONS_PER_WEEK_DEFAULT = 3;

  // ---- 冻结周阶段映射（Section 11），逐周期长度各自独立，不发明新阶段 ----
  var PHASE_MAPS = {
    6: ['ACQUISITION', 'STABILIZATION', 'DECISION_INTEGRATION', 'PRESSURE_TRANSFER', 'MATCH_TRANSFER', 'RETEST'],
    5: ['ACQUISITION', 'STABILIZATION', 'DECISION_INTEGRATION', 'PRESSURE_TRANSFER', 'RETEST'],
    4: ['ACQUISITION', 'DECISION_INTEGRATION', 'PRESSURE_TRANSFER', 'RETEST']
  };

  // 与 Master Control V2 完全一致（js/storage.js S8_ENUMS.VALID_LEVELS 同源冻结值，此处独立声明
  // 以保持本模块可在无 PBStore 的纯函数场景下单独测试/复用）。
  var VALID_LEVELS = [3.0, 3.5, 4.0, 4.5, 5.0];

  var ROLES = { PRIMARY: 'PRIMARY', SUPPORT: 'SUPPORT', TRANSFER: 'TRANSFER', RETEST_PREP: 'RETEST_PREP' };

  // ---- 日期工具：全部按 UTC 日历日计算，避免 date-only 值的时区漂移 ----
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayISODate() {
    var d = new Date();
    return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }
  function addDaysISODate(dateStr, days) {
    var parts = String(dateStr).split('-').map(Number);
    var base = Date.UTC(parts[0], parts[1] - 1, parts[2]);
    var next = new Date(base + days * 86400000);
    return next.getUTCFullYear() + '-' + pad2(next.getUTCMonth() + 1) + '-' + pad2(next.getUTCDate());
  }

  // ---- 配置加载：Node/测试环境下直接 require 静态 JSON（无网络依赖，结果确定）；
  // 浏览器环境下按既有 review-engine.js loadLevelGates() 同款 fetch 约定加载 ----
  var _testDefs = null, _prescriptionRules = null;
  function loadJSON(nodeRequirePath, fileName, base) {
    if (typeof module === 'object' && module.exports) {
      return Promise.resolve(require(nodeRequirePath));
    }
    base = base || './data/';
    return fetch(base + fileName, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('failed to load ' + fileName + ' -> HTTP ' + r.status);
      return r.json();
    });
  }
  function loadTestDefinitions(base) {
    if (_testDefs) return Promise.resolve(_testDefs);
    return loadJSON('../data/test_definitions_v2_3_1.json', 'test_definitions_v2_3_1.json', base).then(function (d) { _testDefs = d; return d; });
  }
  function loadPrescriptionRules(base) {
    if (_prescriptionRules) return Promise.resolve(_prescriptionRules);
    return loadJSON('../data/prescription_rules_v2_3_1.json', 'prescription_rules_v2_3_1.json', base).then(function (d) { _prescriptionRules = d; return d; });
  }

  // ---- 纯派生：metric -> test id（与 review-engine.js buildMetricToTest 同款算法，不重复硬编码表）----
  function buildMetricToTest(testDefs) {
    var map = {};
    var tests = (testDefs && testDefs.tests) || {};
    Object.keys(tests).forEach(function (tid) {
      var metrics = tests[tid].metrics || {};
      Object.keys(metrics).forEach(function (mk) { if (!(mk in map)) map[mk] = tid; });
    });
    return map;
  }
  // ---- 纯派生：metric -> 既有 prescription_rules_v2_3_1.json 中的 BLOCK（唯一现存 drill/内容引用）----
  function buildMetricToBlock(prescriptionRules) {
    var map = {};
    var rules = (prescriptionRules && prescriptionRules.rules) || [];
    rules.forEach(function (rule) {
      var when = rule.when || {};
      var metric = when.confirmed_hard_gate_fail || when.match_validation_fail || when.metric_low || null;
      if (metric && !(metric in map)) map[metric] = rule.prescribe;
    });
    return map;
  }

  // ---- 解析 S7-B primary_bottleneck 字符串为可映射的 metric（绝不重新计算瓶颈本身）----
  function parseBottleneckMetric(primary_bottleneck) {
    if (typeof primary_bottleneck !== 'string' || !primary_bottleneck) return { type: null, metric: null };
    if (primary_bottleneck.indexOf('hard_gate:') === 0) {
      return { type: 'hard_gate', metric: primary_bottleneck.slice('hard_gate:'.length) };
    }
    if (primary_bottleneck === 'match_validation') return { type: 'match_validation', metric: 'match_transfer_score' };
    if (primary_bottleneck === 'capability_threshold') return { type: 'capability_threshold', metric: null };
    if (primary_bottleneck === 'evidence') return { type: 'evidence', metric: null };
    return { type: 'unknown', metric: null };
  }

  function resolveNamespace(testId) {
    if (typeof PBNamespace === 'undefined') throw new Error('PBNamespace not loaded');
    return PBNamespace.toCanonical(testId);
  }

  // ---- 单个 metric -> SessionPlan assignment；无法解析映射时返回 null（由调用方决定是否致命）----
  function buildAssignment(metric, role, metricToTest, metricToBlock, gatesByMetric) {
    if (!metric) return null;
    var block = metricToBlock[metric];
    var testId = metricToTest[metric];
    if (!block || !testId) return null;
    var namespace = resolveNamespace(testId);
    if (!namespace) return null;
    var gate = gatesByMetric[metric];
    var successCriterion = gate
      ? (metric + ' ' + (gate.direction === 'max' ? '<=' : '>=') + ' ' + gate.threshold)
      : (metric + ' meets prescribed target');
    return {
      assessment_namespace: namespace,
      drill_id: block,
      role: role,
      target: metric,
      planned_volume: '1 session block',
      success_criterion: successCriterion
    };
  }

  function uniq(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (v) { if (v != null && !seen[v]) { seen[v] = true; out.push(v); } });
    return out;
  }

  function cloneAssignments(list) { return (list || []).map(function (a) { return Object.assign({}, a); }); }

  // ================================================================
  // buildPlanStructure — 纯函数、无 I/O：给定 S7 来源数据 + 合法边界输入，
  // 返回确定性的逻辑训练结构（不含任何持久化 ID）。可独立于 PBStore/IndexedDB
  // 单测，用于验证 Section 8 的确定性与 Section 9-21 的结构规则。
  // 输入无效或映射不完整时同步抛出 PlanningError（.code 见下）。
  // ================================================================
  function buildPlanStructure(ctx) {
    ctx = ctx || {};

    // ---- 边界校验（Section 9/10）----
    var cycleLengthWeeks = (ctx.cycle_length_weeks == null) ? CYCLE_LENGTH_DEFAULT : ctx.cycle_length_weeks;
    if (typeof cycleLengthWeeks !== 'number' || !Number.isInteger(cycleLengthWeeks) || CYCLE_LENGTH_OPTIONS.indexOf(cycleLengthWeeks) === -1) {
      throw PlanningError('INVALID_CYCLE_LENGTH', 'cycle_length_weeks must be one of ' + CYCLE_LENGTH_OPTIONS.join('/') + ', got ' + ctx.cycle_length_weeks);
    }
    var sessionsPerWeek = (ctx.sessions_per_week == null) ? SESSIONS_PER_WEEK_DEFAULT : ctx.sessions_per_week;
    if (typeof sessionsPerWeek !== 'number' || !Number.isInteger(sessionsPerWeek) || SESSIONS_PER_WEEK_OPTIONS.indexOf(sessionsPerWeek) === -1) {
      throw PlanningError('INVALID_SESSIONS_PER_WEEK', 'sessions_per_week must be one of ' + SESSIONS_PER_WEEK_OPTIONS.join('/') + ', got ' + ctx.sessions_per_week);
    }

    // ---- Validated Level 安全性（Section 10 / 26）：只允许冻结的 5 个规范等级 ----
    if (VALID_LEVELS.indexOf(ctx.validated_level_at_start) === -1) {
      throw PlanningError('INVALID_VALIDATED_LEVEL', 'validated_level_at_start must be one of ' + VALID_LEVELS.join('/') + ', got ' + ctx.validated_level_at_start);
    }
    if (VALID_LEVELS.indexOf(ctx.target_level) === -1) {
      throw PlanningError('INVALID_TARGET_LEVEL', 'target_level must be one of ' + VALID_LEVELS.join('/') + ', got ' + ctx.target_level);
    }

    // ---- Primary Bottleneck 消费（Section 12）：只读取 S7 已产出结果，数据不足 -> INCOMPLETE ----
    if (ctx.bottleneck_state !== 'DETERMINED' || !ctx.primary_bottleneck) {
      throw PlanningError('INCOMPLETE', 'S7 review/prescription does not establish a valid planning target (bottleneck_state=' + ctx.bottleneck_state + ')');
    }

    var metricToTest = ctx.metricToTest || {};
    var metricToBlock = ctx.metricToBlock || {};
    var failedHardGates = ctx.failed_hard_gates || [];
    var gatesByMetric = {};
    failedHardGates.forEach(function (g) { if (g && g.metric && !(g.metric in gatesByMetric)) gatesByMetric[g.metric] = g; });

    var parsed = parseBottleneckMetric(ctx.primary_bottleneck);
    if (!parsed.metric) {
      // capability_threshold / evidence / unknown：没有可映射的单一 metric，无法定位具体 drill
      throw PlanningError('INCOMPLETE_MAPPING', 'no drill mapping exists for primary_bottleneck type "' + parsed.type + '" (' + ctx.primary_bottleneck + ')');
    }
    var primaryAssignment = buildAssignment(parsed.metric, ROLES.PRIMARY, metricToTest, metricToBlock, gatesByMetric);
    if (!primaryAssignment) {
      throw PlanningError('INCOMPLETE_MAPPING', 'no drill/namespace mapping exists for primary bottleneck metric "' + parsed.metric + '"');
    }
    var primaryMetric = parsed.metric;

    // ---- 次要目标（Section 15）：仅来自 failed_hard_gates，无法映射的静默跳过（不致命，不计入总数强制要求）----
    var secondaryCandidates = uniq(failedHardGates.map(function (g) { return g.metric; }).filter(function (m) { return m && m !== primaryMetric; }));
    var secondaryAssignments = secondaryCandidates
      .map(function (m) { return buildAssignment(m, ROLES.SUPPORT, metricToTest, metricToBlock, gatesByMetric); })
      .filter(Boolean);

    // ---- 决策域 / 抗压域候选（Section 17）：仅当存在有效映射时才纳入，不发明 ----
    function firstByCategory(categories) {
      var m = secondaryCandidates.filter(function (metric) {
        var tid = metricToTest[metric];
        var cat = tid && ctx.testDefs && ctx.testDefs.tests && ctx.testDefs.tests[tid] && ctx.testDefs.tests[tid].category;
        return categories.indexOf(cat) !== -1;
      })[0];
      return m ? buildAssignment(m, ROLES.SUPPORT, metricToTest, metricToBlock, gatesByMetric) : null;
    }
    var decisionAssignment = firstByCategory(['decision']);
    var pressureAssignment = (function () {
      var a = firstByCategory(['pressure', 'technical_pressure']);
      return a ? Object.assign({}, a, { role: ROLES.TRANSFER }) : null;
    })();

    // ---- Match Transfer 训练暴露（Section 17）：始终为训练暴露，绝非 Match Validation ----
    var matchTransferAssignment = buildAssignment('match_transfer_score', ROLES.TRANSFER, metricToTest, metricToBlock, gatesByMetric);

    // ---- Re-test 准备目标（Section 17 / 23）：failed_hard_gates ∪ primary metric，去重，绝不为空 ----
    var retestTargetMetrics = uniq(failedHardGates.map(function (g) { return g.metric; }).concat([primaryMetric]));
    var retestAssignments = retestTargetMetrics
      .map(function (m) { return buildAssignment(m, ROLES.RETEST_PREP, metricToTest, metricToBlock, gatesByMetric); })
      .filter(Boolean);
    // primaryAssignment 已验证可映射，故 retestAssignments 在此处理后必然非空。

    var phases = PHASE_MAPS[cycleLengthWeeks];

    function assignmentsForPhase(phase) {
      switch (phase) {
        case 'ACQUISITION': return [primaryAssignment];
        case 'STABILIZATION': return secondaryAssignments.length ? [primaryAssignment, secondaryAssignments[0]] : [primaryAssignment];
        case 'DECISION_INTEGRATION': return decisionAssignment ? [primaryAssignment, decisionAssignment] : [primaryAssignment];
        case 'PRESSURE_TRANSFER': return pressureAssignment ? [primaryAssignment, pressureAssignment] : [primaryAssignment];
        case 'MATCH_TRANSFER': return matchTransferAssignment ? [primaryAssignment, matchTransferAssignment] : [primaryAssignment];
        case 'RETEST': return retestAssignments;
        default: return [primaryAssignment];
      }
    }

    function objectiveTypeForRole(role) {
      if (role === ROLES.PRIMARY) return 'PRIMARY_BOTTLENECK';
      if (role === ROLES.RETEST_PREP) return 'RETEST_TARGET';
      return 'SECONDARY_DEFICIT';
    }

    var weeklyPlans = [];
    var sessionPlansByWeek = [];
    phases.forEach(function (phase, idx) {
      var weekNumber = idx + 1;
      var weekAssignments = assignmentsForPhase(phase);
      var objectives = weekAssignments.map(function (a) {
        return { type: objectiveTypeForRole(a.role), namespace: a.assessment_namespace, target: a.target, source: 'review_snapshot' };
      });
      weeklyPlans.push({
        week_number: weekNumber,
        phase: phase,
        objectives: objectives,
        planned_sessions: sessionsPerWeek,
        status: 'PLANNED'
      });

      var objectiveSummary = phase + ' focus: ' + weekAssignments.map(function (a) { return a.assessment_namespace + ':' + a.target; }).join(' + ');
      var sessions = [];
      for (var seq = 1; seq <= sessionsPerWeek; seq++) {
        sessions.push({
          sequence: seq,
          objective: objectiveSummary,
          assignments: cloneAssignments(weekAssignments),
          status: 'PLANNED'
        });
      }
      sessionPlansByWeek.push(sessions);
    });

    var startDate = ctx.start_date || todayISODate();
    var plannedEndDate = addDaysISODate(startDate, cycleLengthWeeks * 7);

    return {
      cycle: {
        source_review_snapshot_id: ctx.source_review_snapshot_id,
        source_prescription_id: ctx.source_prescription_id,
        validated_level_at_start: ctx.validated_level_at_start,
        target_level: ctx.target_level,
        primary_bottleneck: ctx.primary_bottleneck,
        failed_hard_gates: failedHardGates,
        retest_targets: retestTargetMetrics,
        start_date: startDate,
        planned_end_date: plannedEndDate,
        status: 'PLANNED'
      },
      weeklyPlans: weeklyPlans,
      sessionPlans: sessionPlansByWeek,
      cycle_length_weeks: cycleLengthWeeks,
      sessions_per_week: sessionsPerWeek
    };
  }

  // ================================================================
  // buildTrainingCyclePlan — 异步编排：加载配置 + 读取 S7 来源记录 +
  // 重复保护 + 调用 buildPlanStructure + 经由 S8-A 公共存储 API 落库。
  // 不绕过 storage API，不直接操作 IndexedDB store。
  // ================================================================
  function persistPlan(structure) {
    var createdCycle = null, createdWeeks = [], createdSessions = [];
    return PBStore.createTrainingCycle(structure.cycle).then(function (cycle) {
      createdCycle = cycle;
      var chain = Promise.resolve();
      structure.weeklyPlans.forEach(function (wpDraft, idx) {
        chain = chain.then(function () {
          return PBStore.createWeeklyPlan(Object.assign({}, wpDraft, { cycle_id: cycle.cycle_id })).then(function (wp) {
            createdWeeks.push(wp);
            var sessionsDraft = structure.sessionPlans[idx] || [];
            var sChain = Promise.resolve();
            sessionsDraft.forEach(function (spDraft) {
              sChain = sChain.then(function () {
                return PBStore.createSessionPlan(Object.assign({}, spDraft, { week_plan_id: wp.week_plan_id })).then(function (sp) {
                  createdSessions.push(sp);
                });
              });
            });
            return sChain;
          });
        });
      });
      return chain;
    }).then(function () {
      return { trainingCycle: createdCycle, weeklyPlans: createdWeeks, sessionPlans: createdSessions };
    }).catch(function (err) {
      // 失败/原子性策略（Section 22）：计划结构在写入前已完整校验/在内存中构建完毕，
      // 写入阶段理论上只应因存储层本身的意外错误失败。一旦发生，尽力回滚已创建的
      // 部分记录（不留下误导性的半成品 TrainingCycle），再把原始错误继续抛出。
      var cleanup = [];
      createdSessions.forEach(function (sp) { cleanup.push(PBStore.del('session_plans', sp.session_plan_id).catch(function () {})); });
      createdWeeks.forEach(function (wp) { cleanup.push(PBStore.del('weekly_plans', wp.week_plan_id).catch(function () {})); });
      if (createdCycle) cleanup.push(PBStore.del('training_cycles', createdCycle.cycle_id).catch(function () {}));
      return Promise.all(cleanup).then(function () { throw err; });
    });
  }

  function buildTrainingCyclePlan(input) {
    if (typeof PBStore === 'undefined') return Promise.reject(new Error('PBStore not loaded'));
    if (typeof PBNamespace === 'undefined') return Promise.reject(new Error('PBNamespace not loaded'));
    input = input || {};

    return Promise.all([loadTestDefinitions(input.data_base), loadPrescriptionRules(input.data_base)]).then(function (cfg) {
      var testDefs = cfg[0], prescriptionRules = cfg[1];
      return Promise.all([
        PBStore.get('review_snapshots', input.source_review_snapshot_id),
        PBStore.get('prescriptions', input.source_prescription_id),
        PBStore.listTrainingCyclesByPrescription(input.source_prescription_id)
      ]).then(function (r) {
        var snap = r[0], rx = r[1], existingCycles = r[2] || [];
        if (!snap) throw PlanningError('MISSING_SOURCE_REVIEW_SNAPSHOT', 'source_review_snapshot_id not found: ' + input.source_review_snapshot_id);
        if (!rx) throw PlanningError('MISSING_SOURCE_PRESCRIPTION', 'source_prescription_id not found: ' + input.source_prescription_id);

        // ---- 重复保护（Section 23）：同一 Prescription 已存在 PLANNED/ACTIVE 周期时拒绝 ----
        var dup = existingCycles.some(function (c) { return c.status === 'PLANNED' || c.status === 'ACTIVE'; });
        if (dup) throw PlanningError('DUPLICATE_ACTIVE_CYCLE', 'a PLANNED/ACTIVE training cycle already exists for prescription ' + input.source_prescription_id);

        // ---- Prescription 是权威规划输入（Section 13）：primary_bottleneck 取自 prescription.data ----
        var primaryBottleneck = (rx.data && rx.data.primary_bottleneck !== undefined) ? rx.data.primary_bottleneck : null;
        var bottleneckState = snap.bottleneck_state || null;
        var failedHardGates = snap.failed_hard_gates || [];

        var structure = buildPlanStructure({
          source_review_snapshot_id: input.source_review_snapshot_id,
          source_prescription_id: input.source_prescription_id,
          validated_level_at_start: input.validated_level_at_start,
          target_level: input.target_level,
          primary_bottleneck: primaryBottleneck,
          bottleneck_state: bottleneckState,
          failed_hard_gates: failedHardGates,
          cycle_length_weeks: input.cycle_length_weeks,
          sessions_per_week: input.sessions_per_week,
          start_date: input.start_date,
          metricToTest: buildMetricToTest(testDefs),
          metricToBlock: buildMetricToBlock(prescriptionRules),
          testDefs: testDefs
        });

        return persistPlan(structure);
      });
    });
  }

  return {
    buildTrainingCyclePlan: buildTrainingCyclePlan,
    buildPlanStructure: buildPlanStructure,
    buildMetricToTest: buildMetricToTest,
    buildMetricToBlock: buildMetricToBlock,
    parseBottleneckMetric: parseBottleneckMetric,
    PlanningError: PlanningError,
    CYCLE_LENGTH_OPTIONS: CYCLE_LENGTH_OPTIONS.slice(),
    CYCLE_LENGTH_DEFAULT: CYCLE_LENGTH_DEFAULT,
    SESSIONS_PER_WEEK_OPTIONS: SESSIONS_PER_WEEK_OPTIONS.slice(),
    SESSIONS_PER_WEEK_DEFAULT: SESSIONS_PER_WEEK_DEFAULT,
    PHASE_MAPS: PHASE_MAPS,
    VALID_LEVELS: VALID_LEVELS.slice(),
    ROLES: Object.assign({}, ROLES)
  };
});
