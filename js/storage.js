/* ============================================================
 * storage.js — Pickleball App 2.0 Alpha · S1 Data Core (+ S7-A storage, + S8-A)
 * 浏览器本地数据库 IndexedDB (IDB)。S1 四个对象存储 (object stores)：
 *   players / assessments / test_sessions / trial_events
 * 逐 Trial 保存原始数据（不做任何聚合、不判级、不算能力分）。
 * 与现有 localStorage(STATE) 完全独立并存，不影响原有功能。
 * S7-A：DB_VERSION 1 -> 2，新增 review_snapshots / prescriptions / retests
 * 三个空存储，供未来 S7 阶段使用。升级为纯增量（只新建缺失的 store），
 * 不清空、不改写、不删除任何既有 store 或记录。本阶段仅提供存储/读写，
 * 不实现 Review / Trend / Prescription / Retest 的任何计算或判定逻辑。
 * S8-A：DB_VERSION 2 -> 3，新增 training_cycles / weekly_plans /
 * session_plans / session_logs / cycle_summaries 五个存储，供未来 Adaptive
 * Training Cycle 系统使用。同样为纯增量升级，不触碰任何既有 store/记录。
 * 本阶段只提供 CRUD + 轻量父子关系/枚举校验，不实现自适应计划生成、
 * 依从度(adherence)计算、RETEST_READY 判定或训练 UI —— 详见
 * docs/S8-A-DATA-ARCHITECTURE.md。
 * S8-B：新增 listTrainingCyclesByPrescription（复用既有 by_prescription 索引），
 * 供 js/training-plan-engine.js 做同一 Prescription 的重复建周期保护查询；
 * 不新增 store/index，不改既有校验逻辑 —— 详见 docs/S8-B-ADAPTIVE-PLAN-ENGINE.md。
 * S8-C：新增 getFinalSessionLogByPlan（复用既有 by_session_plan 索引），供
 * js/session-execution-engine.js 做"每个 SessionPlan 最多一条终态 SessionLog"
 * 的判重查询；不新增 store/index，不改既有校验逻辑 —— 详见
 * docs/S8-C-SESSION-EXECUTION-ENGINE.md。
 * S9-A：新增 createMatchObservationSession，复用既有 test_sessions/trial_events
 * store（test_id 固定 'ASMT-10'、feed_mode 固定 'live_match'）承载 full T10 Match
 * Observation 采集；DB_VERSION 不变（仍为 3），不新增 store/index，不实现任何聚合/
 * 评分/判定逻辑 —— 详见 docs/S9-A-MATCH-DATA-ARCHITECTURE.md。
 * S9-B：createMatchObservationSession 新增可选 match_context 透传字段（仍是
 * test_sessions 的普通嵌套字段，无 schema/索引变化）；实际的采集校验、去重、抽样
 * 完整度与描述性 Full-T10 指标计算全部位于新模块 js/match-observation-engine.js，
 * storage.js 本身不新增计算逻辑 —— 详见 docs/S9-B-MATCH-OBSERVATION-ENGINE.md。
 * S10-D-R1：DB_VERSION 3 -> 4，新增 development_cycles / prescription_workflows /
 * session_results / training_evidence 四个存储，供 S10-A/S10-C/S10-D 已冻结的
 * 纯函数引擎（js/workflow-integration-engine.js /
 * js/prescription-workflow-engine.js / js/session-evidence-engine.js）产出的
 * 对象获得跨 reload 的持久化，不强行塞入语义不符的 S7/S8 既有 store（那些
 * store 的 FK 谱系是 S7 CAP/瓶颈周期化体系，S9/S10 数据是另一条谱系——详见
 * docs/S10-C-PRESCRIPTION-WORKFLOW.md §6 与 docs/S10-D-SESSION-EVIDENCE.md §6
 * 的既有证据）。与既往每一次升级同样：纯增量（只新建缺失的 store/index），
 * 不清空、不改写、不删除任何既有 store 或记录。本阶段仅提供 CRUD，不在
 * storage.js 内新增/修改任何 S10 业务规则——那些规则仍完全归属各自的纯函数
 * 引擎，详见 docs/S10-D-R1-DURABLE-PERSISTENCE.md。
 * S10-E-R1：DB_VERSION 4 -> 5，新增 cycle_kpi_baselines / reassessments 两个
 * 存储，供 S10-E-R1 已冻结的 Cycle KPI Baseline Snapshot / Reassessment 记录
 * 获得跨 reload 的持久化。同样纯增量、schema/CRUD 仅，不在 storage.js 内新增/
 * 修改任何业务规则——详见 docs/S10-E-R1-PROGRESS-REASSESSMENT.md。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DB_NAME = 'pb_v2';
  var DB_VERSION = 5;

  // 版本基线（V2.3.1）；若 PBConfig 已加载则以其为准
  var VERSIONS = { schema_version: '2.3.1', benchmark_version: '2.1.1', protocol_version: '2.2.1' };
  function versions() {
    try {
      if (typeof self !== 'undefined' && self.PBConfig && self.PBConfig.versions) return self.PBConfig.versions;
    } catch (e) {}
    return VERSIONS;
  }

  var STORES = {
    players:       { keyPath: 'player_id',       indexes: [] },
    assessments:   { keyPath: 'assessment_id',   indexes: [['by_player', 'player_id']] },
    test_sessions: { keyPath: 'test_session_id', indexes: [['by_assessment', 'assessment_id']] },
    trial_events:  { keyPath: 'trial_event_id',  indexes: [['by_session', 'test_session_id']] },
    // S7-A 新增（仅存储占位，未来 S7 阶段使用；本阶段无读写业务逻辑接入）
    review_snapshots: { keyPath: 'review_snapshot_id', indexes: [['by_assessment', 'assessment_id']] },
    prescriptions:     { keyPath: 'prescription_id',    indexes: [['by_assessment', 'assessment_id']] },
    retests:           { keyPath: 'retest_id',           indexes: [['by_assessment', 'assessment_id']] },
    // S8-A 新增：Adaptive Training Cycle 数据基础（schema/CRUD 仅，无自适应计算逻辑）
    training_cycles: {
      keyPath: 'cycle_id',
      indexes: [['by_prescription', 'source_prescription_id'], ['by_review_snapshot', 'source_review_snapshot_id'], ['by_status', 'status']]
    },
    weekly_plans: {
      keyPath: 'week_plan_id',
      // by_cycle_week 索引基于 cycle_week_key（cycle_id + '::' + week_number）冗余字段：
      // 现有 getByIndex 仅支持单值精确匹配，无复合键/范围查询，沿用既有约定而非引入新机制。
      indexes: [['by_cycle', 'cycle_id'], ['by_cycle_week', 'cycle_week_key']]
    },
    session_plans: {
      keyPath: 'session_plan_id',
      indexes: [['by_week', 'week_plan_id'], ['by_cycle', 'cycle_id'], ['by_status', 'status']]
    },
    session_logs: {
      keyPath: 'session_log_id',
      indexes: [['by_session_plan', 'session_plan_id'], ['by_week', 'week_plan_id'], ['by_cycle', 'cycle_id'], ['by_status', 'status']]
    },
    cycle_summaries: {
      keyPath: 'cycle_summary_id',
      indexes: [['by_cycle', 'cycle_id'], ['by_retest_readiness', 'retest_readiness']]
    },
    // S10-D-R1 新增：S10-A/S10-C/S10-D 纯函数引擎产出对象的持久化（schema/CRUD 仅，
    // 不新增/不复制任何业务规则 —— 详见 docs/S10-D-R1-DURABLE-PERSISTENCE.md）
    development_cycles: {
      keyPath: 'cycle_id',
      indexes: [['by_player', 'player_id'], ['by_state', 'state']]
    },
    prescription_workflows: {
      keyPath: 'workflow_id',
      indexes: [['by_player', 'player_id'], ['by_prescription', 'prescription_ref'], ['by_state', 'state']]
    },
    session_results: {
      keyPath: 'session_id',
      indexes: [['by_player', 'player_id'], ['by_prescription', 'prescription_ref'], ['by_status', 'status']]
    },
    training_evidence: {
      keyPath: 'evidence_id',
      indexes: [['by_player', 'player_id'], ['by_session', 'session_ref'], ['by_prescription', 'prescription_ref'], ['by_source', 'source']]
    },
    // S10-E-R1 新增：Cycle KPI Baseline Snapshot / Reassessment 持久化（schema/CRUD 仅，
    // 不新增/不复制任何业务规则 —— 详见 docs/S10-E-R1-PROGRESS-REASSESSMENT.md）
    cycle_kpi_baselines: {
      keyPath: 'baseline_id',
      indexes: [['by_cycle', 'cycle_id'], ['by_player', 'player_id']]
    },
    reassessments: {
      keyPath: 'reassessment_id',
      indexes: [['by_cycle', 'cycle_id'], ['by_player', 'player_id'], ['by_status', 'status']]
    }
  };

  var _dbPromise = null;
  function open() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        Object.keys(STORES).forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            var cfg = STORES[name];
            var os = db.createObjectStore(name, { keyPath: cfg.keyPath });
            cfg.indexes.forEach(function (ix) { os.createIndex(ix[0], ix[1], { unique: false }); });
          }
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return _dbPromise;
  }

  function tx(store, mode) {
    return open().then(function (db) {
      return db.transaction(store, mode).objectStore(store);
    });
  }
  function reqP(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  // ---- 基础 CRUD ----
  function put(store, obj)      { return tx(store, 'readwrite').then(function (os) { return reqP(os.put(obj)); }).then(function () { return obj; }); }
  function get(store, key)      { return tx(store, 'readonly').then(function (os) { return reqP(os.get(key)); }); }
  function getAll(store)        { return tx(store, 'readonly').then(function (os) { return reqP(os.getAll()); }); }
  function del(store, key)      { return tx(store, 'readwrite').then(function (os) { return reqP(os.delete(key)); }); }
  function getByIndex(store, index, value) {
    return tx(store, 'readonly').then(function (os) { return reqP(os.index(index).getAll(value)); });
  }

  // ---- ID 生成 ----
  function uid(prefix) {
    var rnd = Math.random().toString(36).slice(2, 8);
    return prefix + '_' + Date.now().toString(36) + rnd;
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function nowISO() { return new Date().toISOString(); }

  // ---- 高层：创建对象 ----
  function createPlayer(display_name) {
    var p = { player_id: uid('plr'), display_name: (display_name || '').trim() || '未命名 Player', created_at: nowISO() };
    return put('players', p);
  }

  function createAssessment(opts) {
    var v = versions();
    var a = {
      assessment_id: uid('asm'),
      player_id: opts.player_id,
      assessment_date: opts.assessment_date || today(),
      assessment_tier: opts.assessment_tier,          // lite | standard | full
      target_training_level: opts.target_training_level, // 3.0 | 3.5 | 4.0 | 4.5 | 5.0
      schema_version: v.schema_version,
      benchmark_version: v.benchmark_version,
      protocol_version: v.protocol_version,
      created_at: nowISO()
      // 注意：本 Sprint 不写 validated_training_level / capability_score（禁止判级）
    };
    return put('assessments', a);
  }

  function createTestSession(opts) {
    var s = {
      test_session_id: uid('ses'),
      assessment_id: opts.assessment_id,
      test_id: opts.test_id,                          // T01..T07
      assessment_tier: opts.assessment_tier,
      feed_mode: opts.feed_mode,                      // machine | calibrated_human | partner | live_match
      feeder_id: opts.feeder_id || null,
      feeder_calibration_id: opts.feeder_calibration_id || null,
      started_at: nowISO()
    };
    return put('test_sessions', s);
  }

  function addTrialEvent(opts) {
    var t = {
      trial_event_id: uid('trl'),
      test_session_id: opts.test_session_id,
      trial_no: opts.trial_no,
      scenario_id: opts.scenario_id || null,
      outcome: opts.outcome,                          // S | P | F | I
      score_weight: (opts.score_weight === undefined ? null : opts.score_weight),
      raw_json: opts.raw_json || {},
      review_flag: !!opts.review_flag,
      video_timestamp_ms: (opts.video_timestamp_ms == null ? null : opts.video_timestamp_ms),
      created_at: nowISO()
    };
    return put('trial_events', t);
  }

  // ---- 查询 ----
  function listPlayers()                 { return getAll('players'); }
  function listAssessments()             { return getAll('assessments'); }
  function assessmentsByPlayer(pid)      { return getByIndex('assessments', 'by_player', pid); }
  function sessionsByAssessment(aid)     { return getByIndex('test_sessions', 'by_assessment', aid); }
  function trialsBySession(sid)          { return getByIndex('trial_events', 'by_session', sid); }

  // ---- 导出：完整 Assessment + Test Sessions + Trial Events（嵌套 JSON）----
  function exportAssessment(assessment_id) {
    var out = {};
    return get('assessments', assessment_id).then(function (a) {
      if (!a) throw new Error('assessment not found: ' + assessment_id);
      out.export_meta = { generated_at: nowISO(), versions: versions(), format: 'pb_assessment_export_v1' };
      out.assessment = a;
      return get('players', a.player_id);
    }).then(function (player) {
      out.player = player || null;
      return sessionsByAssessment(assessment_id);
    }).then(function (sessions) {
      sessions.sort(function (x, y) { return (x.test_id || '').localeCompare(y.test_id || ''); });
      return Promise.all(sessions.map(function (s) {
        return trialsBySession(s.test_session_id).then(function (trials) {
          trials.sort(function (x, y) { return (x.trial_no || 0) - (y.trial_no || 0); });
          return Object.assign({}, s, { trial_events: trials });
        });
      }));
    }).then(function (sessionsWithTrials) {
      out.test_sessions = sessionsWithTrials;
      return out;
    });
  }

  // 合并式更新 Assessment（用于写入 T10-lite 的 ue / match_transfer 字段）
  function updateAssessment(assessment_id, patch) {
    return get('assessments', assessment_id).then(function (a) {
      if (!a) throw new Error('assessment not found: ' + assessment_id);
      return put('assessments', Object.assign({}, a, patch));
    });
  }

  // 删除单个 Session（级联删其 trial_events）
  function deleteSession(test_session_id) {
    return trialsBySession(test_session_id).then(function (trials) {
      return Promise.all(trials.map(function (t) { return del('trial_events', t.trial_event_id); }));
    }).then(function () { return del('test_sessions', test_session_id); });
  }

  // 删除整份 Assessment（级联删其所有 session 及 trial_events）
  function deleteAssessment(assessment_id) {
    return sessionsByAssessment(assessment_id).then(function (sessions) {
      return Promise.all(sessions.map(function (s) { return deleteSession(s.test_session_id); }));
    }).then(function () { return del('assessments', assessment_id); });
  }

  // ---- S7-A：Review/Prescription/Retest 存储占位 ----
  // 仅存储 schema_version / benchmark_version / protocol_version / generated_at
  // 等版本元数据 + 调用方提供的 data；不做任何 CAP/趋势/处方/复测计算。
  function createReviewSnapshot(opts) {
    var v = versions();
    var s = {
      review_snapshot_id: uid('rev'),
      assessment_id: opts.assessment_id,
      schema_version: v.schema_version,
      benchmark_version: v.benchmark_version,
      protocol_version: v.protocol_version,
      generated_at: nowISO(),
      data: opts.data || {},
      created_at: nowISO()
    };
    return put('review_snapshots', s);
  }
  function createPrescription(opts) {
    var v = versions();
    var p = {
      prescription_id: uid('rx'),
      assessment_id: opts.assessment_id,
      schema_version: v.schema_version,
      benchmark_version: v.benchmark_version,
      protocol_version: v.protocol_version,
      generated_at: nowISO(),
      data: opts.data || {},
      created_at: nowISO()
    };
    return put('prescriptions', p);
  }
  function createRetest(opts) {
    var v = versions();
    var r = {
      retest_id: uid('rt'),
      assessment_id: opts.assessment_id,
      prescription_id: opts.prescription_id || null,
      schema_version: v.schema_version,
      benchmark_version: v.benchmark_version,
      protocol_version: v.protocol_version,
      generated_at: nowISO(),
      data: opts.data || {},
      created_at: nowISO()
    };
    return put('retests', r);
  }
  function reviewSnapshotsByAssessment(aid) { return getByIndex('review_snapshots', 'by_assessment', aid); }
  function prescriptionsByAssessment(aid)   { return getByIndex('prescriptions', 'by_assessment', aid); }
  function retestsByAssessment(aid)         { return getByIndex('retests', 'by_assessment', aid); }

  // ---- S8-A：Training Cycle 数据架构（schema/CRUD/父子校验，无自适应计算） ----
  // 冻结校验集合：与 Master Control V2 完全一致，不新增/不放宽。
  var VALID_LEVELS = [3.0, 3.5, 4.0, 4.5, 5.0];
  var CYCLE_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED', 'ABORTED'];
  var WEEK_STATUSES = ['PLANNED', 'ACTIVE', 'COMPLETED'];
  var WEEK_PHASES = ['ACQUISITION', 'STABILIZATION', 'DECISION_INTEGRATION', 'PRESSURE_TRANSFER', 'MATCH_TRANSFER', 'RETEST'];
  var SESSION_PLAN_STATUSES = ['PLANNED', 'AVAILABLE', 'COMPLETED', 'SKIPPED'];
  var SESSION_LOG_STATUSES = ['COMPLETE', 'PARTIAL', 'SKIPPED'];
  var RETEST_READINESS_VALUES = ['READY', 'NOT_READY', 'INCOMPLETE'];
  var NEXT_ACTION_VALUES = ['RETEST', 'EXTEND', 'REVIEW', 'NONE'];
  // SessionPlan = intent only；这些字段专属 SessionLog（执行结果），不得写入 SessionPlan。
  var SESSION_LOG_ONLY_FIELDS = ['results', 'evidence_links', 'notes', 'started_at', 'completed_at'];
  // 任何 S8 存储路径都不得直接写入 validated_training_level（判级仍完全归属 S7 Review 逻辑）。
  var FORBIDDEN_PATCH_FIELDS = ['validated_training_level'];

  function fail(msg) { return Promise.reject(new Error(msg)); }
  function isValidLevel(v) { return VALID_LEVELS.indexOf(v) !== -1; }
  function isInEnum(v, list) { return list.indexOf(v) !== -1; }
  function hasForbiddenField(obj, list) {
    return Object.keys(obj || {}).some(function (k) { return list.indexOf(k) !== -1; });
  }

  // -- Training Cycle --
  function createTrainingCycle(opts) {
    opts = opts || {};
    if (!opts.source_review_snapshot_id) return fail('createTrainingCycle: source_review_snapshot_id is required');
    if (!opts.source_prescription_id) return fail('createTrainingCycle: source_prescription_id is required');
    if (opts.validated_level_at_start != null && !isValidLevel(opts.validated_level_at_start)) return fail('createTrainingCycle: invalid validated_level_at_start ' + opts.validated_level_at_start);
    if (opts.target_level != null && !isValidLevel(opts.target_level)) return fail('createTrainingCycle: invalid target_level ' + opts.target_level);
    var status = opts.status || 'PLANNED';
    if (!isInEnum(status, CYCLE_STATUSES)) return fail('createTrainingCycle: invalid status ' + status);

    // 溯源校验：来源 Review Snapshot / Prescription 必须已存在，绝不创建孤儿/伪造 ID。
    return get('review_snapshots', opts.source_review_snapshot_id).then(function (snap) {
      if (!snap) throw new Error('createTrainingCycle: source_review_snapshot_id not found: ' + opts.source_review_snapshot_id);
      return get('prescriptions', opts.source_prescription_id);
    }).then(function (rx) {
      if (!rx) throw new Error('createTrainingCycle: source_prescription_id not found: ' + opts.source_prescription_id);
      var now = nowISO();
      var c = {
        cycle_id: uid('tc'),
        schema_version: 1,
        created_at: now,
        updated_at: now,
        source_review_snapshot_id: opts.source_review_snapshot_id,
        source_prescription_id: opts.source_prescription_id,
        validated_level_at_start: (opts.validated_level_at_start == null ? null : opts.validated_level_at_start),
        target_level: (opts.target_level == null ? null : opts.target_level),
        primary_bottleneck: opts.primary_bottleneck || null,
        failed_hard_gates: opts.failed_hard_gates || [],
        retest_targets: opts.retest_targets || [],
        start_date: opts.start_date || today(),
        planned_end_date: opts.planned_end_date || null,
        status: status
      };
      return put('training_cycles', c);
    });
  }
  function getTrainingCycle(cycle_id) { return get('training_cycles', cycle_id); }
  function listTrainingCycles() { return getAll('training_cycles'); }
  // S8-B duplicate-plan-protection lookup: reuses the by_prescription index already created in S8-A.
  function listTrainingCyclesByPrescription(prescription_id) { return getByIndex('training_cycles', 'by_prescription', prescription_id); }
  function updateTrainingCycle(cycle_id, patch) {
    patch = patch || {};
    if (hasForbiddenField(patch, FORBIDDEN_PATCH_FIELDS)) return fail('updateTrainingCycle: must not write validated_training_level');
    if (patch.status !== undefined && !isInEnum(patch.status, CYCLE_STATUSES)) return fail('updateTrainingCycle: invalid status ' + patch.status);
    if (patch.validated_level_at_start != null && !isValidLevel(patch.validated_level_at_start)) return fail('updateTrainingCycle: invalid validated_level_at_start ' + patch.validated_level_at_start);
    if (patch.target_level != null && !isValidLevel(patch.target_level)) return fail('updateTrainingCycle: invalid target_level ' + patch.target_level);
    return get('training_cycles', cycle_id).then(function (c) {
      if (!c) throw new Error('updateTrainingCycle: not found: ' + cycle_id);
      return put('training_cycles', Object.assign({}, c, patch, { updated_at: nowISO() }));
    });
  }

  // -- Weekly Plan --
  function createWeeklyPlan(opts) {
    opts = opts || {};
    if (!opts.cycle_id) return fail('createWeeklyPlan: cycle_id is required');
    var status = opts.status || 'PLANNED';
    if (!isInEnum(status, WEEK_STATUSES)) return fail('createWeeklyPlan: invalid status ' + status);
    if (opts.phase != null && !isInEnum(opts.phase, WEEK_PHASES)) return fail('createWeeklyPlan: invalid phase ' + opts.phase);
    return get('training_cycles', opts.cycle_id).then(function (cycle) {
      if (!cycle) throw new Error('createWeeklyPlan: cycle_id not found: ' + opts.cycle_id);
      var now = nowISO();
      var wp = {
        week_plan_id: uid('wp'),
        cycle_id: opts.cycle_id,
        week_number: opts.week_number,
        cycle_week_key: opts.cycle_id + '::' + opts.week_number,
        phase: opts.phase || null,
        objectives: opts.objectives || [],
        planned_sessions: (opts.planned_sessions == null ? null : opts.planned_sessions),
        status: status,
        created_at: now,
        updated_at: now
      };
      return put('weekly_plans', wp);
    });
  }
  function getWeeklyPlan(week_plan_id) { return get('weekly_plans', week_plan_id); }
  function listWeeklyPlansByCycle(cycle_id) { return getByIndex('weekly_plans', 'by_cycle', cycle_id); }
  function getWeeklyPlanByCycleWeek(cycle_id, week_number) {
    return getByIndex('weekly_plans', 'by_cycle_week', cycle_id + '::' + week_number).then(function (rows) { return rows[0] || null; });
  }
  function updateWeeklyPlan(week_plan_id, patch) {
    patch = patch || {};
    if (patch.status !== undefined && !isInEnum(patch.status, WEEK_STATUSES)) return fail('updateWeeklyPlan: invalid status ' + patch.status);
    if (patch.phase != null && !isInEnum(patch.phase, WEEK_PHASES)) return fail('updateWeeklyPlan: invalid phase ' + patch.phase);
    return get('weekly_plans', week_plan_id).then(function (wp) {
      if (!wp) throw new Error('updateWeeklyPlan: not found: ' + week_plan_id);
      return put('weekly_plans', Object.assign({}, wp, patch, { updated_at: nowISO() }));
    });
  }

  // -- Session Plan (intent only — never holds execution-result fields) --
  function createSessionPlan(opts) {
    opts = opts || {};
    if (!opts.week_plan_id) return fail('createSessionPlan: week_plan_id is required');
    var status = opts.status || 'PLANNED';
    if (!isInEnum(status, SESSION_PLAN_STATUSES)) return fail('createSessionPlan: invalid status ' + status);
    if (hasForbiddenField(opts, SESSION_LOG_ONLY_FIELDS)) return fail('createSessionPlan: must not contain execution-result fields (results/evidence_links/notes/started_at/completed_at) — those belong to SessionLog');
    return get('weekly_plans', opts.week_plan_id).then(function (wp) {
      if (!wp) throw new Error('createSessionPlan: week_plan_id not found: ' + opts.week_plan_id);
      var now = nowISO();
      var sp = {
        session_plan_id: uid('sp'),
        week_plan_id: opts.week_plan_id,
        cycle_id: wp.cycle_id, // 由父 WeeklyPlan 派生，避免调用方传入不一致的 cycle_id 造成孤儿/错配
        sequence: opts.sequence,
        objective: opts.objective || null,
        assignments: opts.assignments || [],
        status: status,
        created_at: now,
        updated_at: now
      };
      return put('session_plans', sp);
    });
  }
  function getSessionPlan(session_plan_id) { return get('session_plans', session_plan_id); }
  function listSessionPlansByWeek(week_plan_id) { return getByIndex('session_plans', 'by_week', week_plan_id); }
  function listSessionPlansByCycle(cycle_id) { return getByIndex('session_plans', 'by_cycle', cycle_id); }
  function updateSessionPlan(session_plan_id, patch) {
    patch = patch || {};
    if (patch.status !== undefined && !isInEnum(patch.status, SESSION_PLAN_STATUSES)) return fail('updateSessionPlan: invalid status ' + patch.status);
    if (hasForbiddenField(patch, SESSION_LOG_ONLY_FIELDS)) return fail('updateSessionPlan: must not write execution-result fields — session plans are intent-only, use createSessionLog');
    return get('session_plans', session_plan_id).then(function (sp) {
      if (!sp) throw new Error('updateSessionPlan: not found: ' + session_plan_id);
      return put('session_plans', Object.assign({}, sp, patch, { updated_at: nowISO() }));
    });
  }

  // -- Session Log (execution record — distinct from SessionPlan; no adherence calc here) --
  function createSessionLog(opts) {
    opts = opts || {};
    if (!opts.session_plan_id) return fail('createSessionLog: session_plan_id is required');
    if (!opts.status) return fail('createSessionLog: status is required');
    if (!isInEnum(opts.status, SESSION_LOG_STATUSES)) return fail('createSessionLog: invalid status ' + opts.status);
    return get('session_plans', opts.session_plan_id).then(function (sp) {
      if (!sp) throw new Error('createSessionLog: session_plan_id not found: ' + opts.session_plan_id);
      var now = nowISO();
      var sl = {
        session_log_id: uid('sl'),
        session_plan_id: opts.session_plan_id,
        week_plan_id: sp.week_plan_id, // 由父 SessionPlan 派生，保证与 Plan 链路一致
        cycle_id: sp.cycle_id,
        started_at: opts.started_at || null,
        completed_at: opts.completed_at || null,
        status: opts.status,
        results: opts.results || [],
        evidence_links: opts.evidence_links || [],
        notes: opts.notes || '',
        created_at: now
      };
      return put('session_logs', sl);
    });
  }
  function getSessionLog(session_log_id) { return get('session_logs', session_log_id); }
  function listSessionLogsBySessionPlan(session_plan_id) { return getByIndex('session_logs', 'by_session_plan', session_plan_id); }
  function listSessionLogsByCycle(cycle_id) { return getByIndex('session_logs', 'by_cycle', cycle_id); }
  // S8-C single-final-log lookup: reuses the by_session_plan index; a SessionPlan has at most one
  // finalized SessionLog under the S8-C engine's own enforcement, so the first match is authoritative.
  function getFinalSessionLogByPlan(session_plan_id) {
    return getByIndex('session_logs', 'by_session_plan', session_plan_id).then(function (rows) { return rows[0] || null; });
  }

  // -- Cycle Summary (stores fields only; adherence/retest-readiness calc is a future S8-D concern) --
  function createCycleSummary(opts) {
    opts = opts || {};
    if (!opts.cycle_id) return fail('createCycleSummary: cycle_id is required');
    var retest_readiness = opts.retest_readiness || 'INCOMPLETE';
    var next_action = opts.next_action || 'NONE';
    if (!isInEnum(retest_readiness, RETEST_READINESS_VALUES)) return fail('createCycleSummary: invalid retest_readiness ' + retest_readiness);
    if (!isInEnum(next_action, NEXT_ACTION_VALUES)) return fail('createCycleSummary: invalid next_action ' + next_action);
    return get('training_cycles', opts.cycle_id).then(function (cycle) {
      if (!cycle) throw new Error('createCycleSummary: cycle_id not found: ' + opts.cycle_id);
      var now = nowISO();
      var cs = {
        cycle_summary_id: uid('cs'),
        cycle_id: opts.cycle_id,
        created_at: now,
        updated_at: now,
        planned_sessions: (opts.planned_sessions == null ? null : opts.planned_sessions),
        completed_sessions: (opts.completed_sessions == null ? null : opts.completed_sessions),
        adherence: (opts.adherence == null ? null : opts.adherence),
        training_exposure: opts.training_exposure || {},
        retest_readiness: retest_readiness,
        next_action: next_action
      };
      return put('cycle_summaries', cs);
    });
  }
  function getCycleSummary(cycle_summary_id) { return get('cycle_summaries', cycle_summary_id); }
  function getCycleSummaryByCycle(cycle_id) {
    return getByIndex('cycle_summaries', 'by_cycle', cycle_id).then(function (rows) { return rows[0] || null; });
  }
  function updateCycleSummary(cycle_summary_id, patch) {
    patch = patch || {};
    if (patch.retest_readiness !== undefined && !isInEnum(patch.retest_readiness, RETEST_READINESS_VALUES)) return fail('updateCycleSummary: invalid retest_readiness ' + patch.retest_readiness);
    if (patch.next_action !== undefined && !isInEnum(patch.next_action, NEXT_ACTION_VALUES)) return fail('updateCycleSummary: invalid next_action ' + patch.next_action);
    return get('cycle_summaries', cycle_summary_id).then(function (cs) {
      if (!cs) throw new Error('updateCycleSummary: not found: ' + cycle_summary_id);
      return put('cycle_summaries', Object.assign({}, cs, patch, { updated_at: nowISO() }));
    });
  }

  // ---- S9-A：Match Observation Session（复用 test_sessions/trial_events，无新增 store/index）----
  // createTestSession 的受限包装：强制 test_id='ASMT-10'（full T10 canonical）、
  // feed_mode='live_match'，标记"这是一次真实比赛的 Match Observation 采集会话"。
  // 不做任何聚合/评分/校验逻辑（属于未来 S9-B Match Observation Engine / S9-C Match
  // Validation Engine）；trial_events 仍通过既有 addTrialEvent 写入，raw_json 承载
  // ASMT-10 的 required_trial_fields，不改动 trial_events 的 schema。
  // S9-B：新增可选 opts.match_context（原样透传，storage 层不做枚举校验，交由
  // js/match-observation-engine.js 的 validateMatchContext 负责），作为 test_sessions
  // 记录上的一个附加嵌套字段（与既有 assessments 记录上的嵌套字段是同一种约定）；
  // 不新增 store/index，不改 createTestSession 本身（避免影响 T01-T09 既有调用方）。
  function createMatchObservationSession(opts) {
    opts = opts || {};
    if (!opts.assessment_id) return fail('createMatchObservationSession: assessment_id is required');
    if (opts.feed_mode != null && opts.feed_mode !== 'live_match') return fail('createMatchObservationSession: feed_mode must be live_match');
    return createTestSession({
      assessment_id: opts.assessment_id,
      test_id: 'ASMT-10',
      assessment_tier: opts.assessment_tier,
      feed_mode: 'live_match',
      feeder_id: opts.feeder_id,
      feeder_calibration_id: opts.feeder_calibration_id
    }).then(function (session) {
      return put('test_sessions', Object.assign({}, session, { match_context: opts.match_context || {} }));
    });
  }

  // ---- S10-D-R1：Development Cycle / Prescription Workflow / Session Result / Training
  // Evidence 持久化（schema/CRUD 仅）。持久化对象来自各自纯函数引擎（PBWorkflow /
  // PBPrescriptionWorkflow / PBSessionEvidence）已产出的完整合法对象，storage.js 本身
  // 不重新校验/不重算其业务字段，只要求各自的 keyPath 字段存在即可 put。----
  function putDevelopmentCycle(obj) {
    if (!obj || obj.cycle_id == null) return fail('putDevelopmentCycle: cycle_id is required');
    return put('development_cycles', obj);
  }
  function getDevelopmentCycle(cycle_id) { return get('development_cycles', cycle_id); }
  function listDevelopmentCyclesByPlayer(player_id) { return getByIndex('development_cycles', 'by_player', player_id); }
  function listDevelopmentCyclesByState(state) { return getByIndex('development_cycles', 'by_state', state); }

  function putPrescriptionWorkflow(obj) {
    if (!obj || obj.workflow_id == null) return fail('putPrescriptionWorkflow: workflow_id is required');
    return put('prescription_workflows', obj);
  }
  function getPrescriptionWorkflow(workflow_id) { return get('prescription_workflows', workflow_id); }
  function listPrescriptionWorkflowsByPlayer(player_id) { return getByIndex('prescription_workflows', 'by_player', player_id); }
  function listPrescriptionWorkflowsByPrescription(prescription_ref) { return getByIndex('prescription_workflows', 'by_prescription', prescription_ref); }
  function listPrescriptionWorkflowsByState(state) { return getByIndex('prescription_workflows', 'by_state', state); }

  function putSessionResult(obj) {
    if (!obj || obj.session_id == null) return fail('putSessionResult: session_id is required');
    return put('session_results', obj);
  }
  function getSessionResult(session_id) { return get('session_results', session_id); }
  function listSessionResultsByPlayer(player_id) { return getByIndex('session_results', 'by_player', player_id); }
  function listSessionResultsByPrescription(prescription_ref) { return getByIndex('session_results', 'by_prescription', prescription_ref); }
  function listSessionResultsByStatus(status) { return getByIndex('session_results', 'by_status', status); }

  function putTrainingEvidence(obj) {
    if (!obj || obj.evidence_id == null) return fail('putTrainingEvidence: evidence_id is required');
    return put('training_evidence', obj);
  }
  function getTrainingEvidence(evidence_id) { return get('training_evidence', evidence_id); }
  function listTrainingEvidenceByPlayer(player_id) { return getByIndex('training_evidence', 'by_player', player_id); }
  function listTrainingEvidenceBySession(session_ref) { return getByIndex('training_evidence', 'by_session', session_ref); }
  function listTrainingEvidenceByPrescription(prescription_ref) { return getByIndex('training_evidence', 'by_prescription', prescription_ref); }
  function listTrainingEvidenceBySource(source) { return getByIndex('training_evidence', 'by_source', source); }

  // ---- S10-E-R1：Cycle KPI Baseline Snapshot / Reassessment 持久化（schema/CRUD 仅）。
  // 持久化对象来自各自纯函数引擎（PBCycleBaseline / PBReassessment）已产出的完整合法
  // 对象，storage.js 本身不重新校验/不重算其业务字段，只要求各自的 keyPath 字段存在
  // 即可 put。----
  function putCycleKpiBaseline(obj) {
    if (!obj || obj.baseline_id == null) return fail('putCycleKpiBaseline: baseline_id is required');
    return put('cycle_kpi_baselines', obj);
  }
  function getCycleKpiBaseline(baseline_id) { return get('cycle_kpi_baselines', baseline_id); }
  function listCycleKpiBaselinesByCycle(cycle_id) { return getByIndex('cycle_kpi_baselines', 'by_cycle', cycle_id); }
  function listCycleKpiBaselinesByPlayer(player_id) { return getByIndex('cycle_kpi_baselines', 'by_player', player_id); }

  function putReassessment(obj) {
    if (!obj || obj.reassessment_id == null) return fail('putReassessment: reassessment_id is required');
    return put('reassessments', obj);
  }
  function getReassessment(reassessment_id) { return get('reassessments', reassessment_id); }
  function listReassessmentsByCycle(cycle_id) { return getByIndex('reassessments', 'by_cycle', cycle_id); }
  function listReassessmentsByPlayer(player_id) { return getByIndex('reassessments', 'by_player', player_id); }
  function listReassessmentsByStatus(status) { return getByIndex('reassessments', 'by_status', status); }

  function clearAll() {
    return open().then(function (db) {
      return Promise.all(Object.keys(STORES).map(function (name) {
        return tx(name, 'readwrite').then(function (os) { return reqP(os.clear()); });
      }));
    });
  }

  return {
    DB_NAME: DB_NAME, DB_VERSION: DB_VERSION,
    open: open, put: put, get: get, getAll: getAll, del: del, getByIndex: getByIndex, clearAll: clearAll,
    createPlayer: createPlayer, createAssessment: createAssessment,
    createTestSession: createTestSession, addTrialEvent: addTrialEvent,
    createMatchObservationSession: createMatchObservationSession,
    listPlayers: listPlayers, listAssessments: listAssessments,
    assessmentsByPlayer: assessmentsByPlayer, sessionsByAssessment: sessionsByAssessment, trialsBySession: trialsBySession,
    exportAssessment: exportAssessment,
    updateAssessment: updateAssessment,
    deleteSession: deleteSession, deleteAssessment: deleteAssessment,
    createReviewSnapshot: createReviewSnapshot, reviewSnapshotsByAssessment: reviewSnapshotsByAssessment,
    createPrescription: createPrescription, prescriptionsByAssessment: prescriptionsByAssessment,
    createRetest: createRetest, retestsByAssessment: retestsByAssessment,

    // S8-A: Training Cycle data architecture
    createTrainingCycle: createTrainingCycle, getTrainingCycle: getTrainingCycle,
    listTrainingCycles: listTrainingCycles, listTrainingCyclesByPrescription: listTrainingCyclesByPrescription,
    updateTrainingCycle: updateTrainingCycle,
    createWeeklyPlan: createWeeklyPlan, getWeeklyPlan: getWeeklyPlan,
    listWeeklyPlansByCycle: listWeeklyPlansByCycle, getWeeklyPlanByCycleWeek: getWeeklyPlanByCycleWeek,
    updateWeeklyPlan: updateWeeklyPlan,
    createSessionPlan: createSessionPlan, getSessionPlan: getSessionPlan,
    listSessionPlansByWeek: listSessionPlansByWeek, listSessionPlansByCycle: listSessionPlansByCycle,
    updateSessionPlan: updateSessionPlan,
    createSessionLog: createSessionLog, getSessionLog: getSessionLog,
    listSessionLogsBySessionPlan: listSessionLogsBySessionPlan, listSessionLogsByCycle: listSessionLogsByCycle,
    getFinalSessionLogByPlan: getFinalSessionLogByPlan,
    createCycleSummary: createCycleSummary, getCycleSummary: getCycleSummary,
    getCycleSummaryByCycle: getCycleSummaryByCycle, updateCycleSummary: updateCycleSummary,
    S8_ENUMS: {
      VALID_LEVELS: VALID_LEVELS.slice(),
      CYCLE_STATUSES: CYCLE_STATUSES.slice(),
      WEEK_STATUSES: WEEK_STATUSES.slice(),
      WEEK_PHASES: WEEK_PHASES.slice(),
      SESSION_PLAN_STATUSES: SESSION_PLAN_STATUSES.slice(),
      SESSION_LOG_STATUSES: SESSION_LOG_STATUSES.slice(),
      RETEST_READINESS_VALUES: RETEST_READINESS_VALUES.slice(),
      NEXT_ACTION_VALUES: NEXT_ACTION_VALUES.slice()
    },

    // S10-D-R1: Development Cycle / Prescription Workflow / Session Result / Training Evidence persistence
    putDevelopmentCycle: putDevelopmentCycle, getDevelopmentCycle: getDevelopmentCycle,
    listDevelopmentCyclesByPlayer: listDevelopmentCyclesByPlayer, listDevelopmentCyclesByState: listDevelopmentCyclesByState,
    putPrescriptionWorkflow: putPrescriptionWorkflow, getPrescriptionWorkflow: getPrescriptionWorkflow,
    listPrescriptionWorkflowsByPlayer: listPrescriptionWorkflowsByPlayer,
    listPrescriptionWorkflowsByPrescription: listPrescriptionWorkflowsByPrescription,
    listPrescriptionWorkflowsByState: listPrescriptionWorkflowsByState,
    putSessionResult: putSessionResult, getSessionResult: getSessionResult,
    listSessionResultsByPlayer: listSessionResultsByPlayer, listSessionResultsByPrescription: listSessionResultsByPrescription,
    listSessionResultsByStatus: listSessionResultsByStatus,
    putTrainingEvidence: putTrainingEvidence, getTrainingEvidence: getTrainingEvidence,
    listTrainingEvidenceByPlayer: listTrainingEvidenceByPlayer, listTrainingEvidenceBySession: listTrainingEvidenceBySession,
    listTrainingEvidenceByPrescription: listTrainingEvidenceByPrescription, listTrainingEvidenceBySource: listTrainingEvidenceBySource,

    // S10-E-R1: Cycle KPI Baseline Snapshot / Reassessment persistence
    putCycleKpiBaseline: putCycleKpiBaseline, getCycleKpiBaseline: getCycleKpiBaseline,
    listCycleKpiBaselinesByCycle: listCycleKpiBaselinesByCycle, listCycleKpiBaselinesByPlayer: listCycleKpiBaselinesByPlayer,
    putReassessment: putReassessment, getReassessment: getReassessment,
    listReassessmentsByCycle: listReassessmentsByCycle, listReassessmentsByPlayer: listReassessmentsByPlayer,
    listReassessmentsByStatus: listReassessmentsByStatus,

    _uid: uid
  };
});
