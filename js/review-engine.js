/* ============================================================
 * review-engine.js — Pickleball App 2.0 Alpha · S7-B Review Snapshot Engine
 * 由一次 Assessment 的既有 S1-S6 采集数据（逐 Trial 原始结果 + T10-lite
 * 简化输入）生成一份结构化 Review Snapshot。独立于 UI：只读 PBStore /
 * PBMetrics / PBNamespace，不渲染、不写 UI 状态。
 *
 * 冻结方法论（Frozen Rules，详见任务书，禁止偏离）：
 *   - Validated Training Level 只能是 3.0/3.5/4.0/4.5/5.0，本引擎从不
 *     产出/推导任何连续小数等级，也从不写 validated_training_level。
 *   - CAP = 0.45*Technical + 0.30*Decision + 0.25*Pressure，范围 0-100；
 *     三个域分任一缺失 -> capability_score=null, capability_state=INCOMPLETE。
 *     缺失域分绝不用 0 代替。
 *   - Match Transfer 是独立验证层，不计入 CAP。
 *   - Evidence 只用 C1-C4，不存在 C0；证据不足 -> INCOMPLETE。
 *   - 不引入 DUPR/Internal DUPR/DUPR Gap；DUPR 不参与 CAP/门槛/证据/定级。
 *   - 本阶段没有 Trend Engine：不得从单次评估臆造 C4 或长期趋势瓶颈。
 *   - 本引擎只“生成 + 显式持久化”Review Snapshot，不做 Prescription /
 *     Retest / Trend / UI / 自动定级晋升。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBReview = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- 冻结常量 ----
  var CAP_WEIGHTS = { technical: 0.45, decision: 0.30, pressure: 0.25 };
  var VALIDATED_LEVELS = [3.0, 3.5, 4.0, 4.5, 5.0]; // 仅供只读引用/测试比对，本引擎从不据此推导等级
  var EVIDENCE_RANK = { C1: 1, C2: 2, C3: 3, C4: 4 };
  var DEFAULT_BORDERLINE_BAND_PP = 5;

  // category === 'technical'（严格取自 test_definitions_v2_3_1.json 的分类字段，非臆造）；
  // T05(technical_pressure)/T07(technical_decision) 为混合分类，不计入 Technical 域，避免"盲目平均全部测试"。
  var CORE_TECHNICAL_TESTS = ['T01', 'T02', 'T03', 'T04', 'T06'];

  function round1(x) { return Math.round(x * 10) / 10; }

  function ns() {
    if (typeof PBNamespace === 'undefined') throw new Error('PBNamespace not loaded');
    return PBNamespace;
  }
  function canon(tid) { return ns().toCanonical(tid); }

  // ---- 域分：Technical（严格显式列表，任一未采集则不计入平均，全无采集则 INCOMPLETE）----
  function computeTechnicalDomain(perTest) {
    var contributing = [];
    var sum = 0;
    CORE_TECHNICAL_TESTS.forEach(function (tid) {
      var m = perTest && perTest[tid];
      if (m && m.quality_pct != null) { sum += m.quality_pct; contributing.push(tid); }
    });
    if (!contributing.length) return { score: null, state: 'INCOMPLETE', contributing_tests: [] };
    return { score: round1(sum / contributing.length), state: 'OK', contributing_tests: contributing.map(canon) };
  }

  // ---- 域分：Decision（ASMT-08）。当前 App 仅采集 S/P/F/I 结果，未采集 intent/shot/target/recovery
  // 四项 component 分数，因此即便有值也只能标注 SIMPLIFIED，绝不谎称为完整 SSS 2.0 组件评分。----
  function computeDecisionDomain(perTest) {
    var m = perTest && perTest.T08;
    if (!m || m.quality_pct == null) return { score: null, state: 'INCOMPLETE', contributing_tests: [] };
    return { score: m.quality_pct, state: 'SIMPLIFIED', contributing_tests: [canon('T08')] };
  }

  // ---- 域分：Pressure（ASMT-09）----
  function computePressureDomain(perTest) {
    var m = perTest && perTest.T09;
    if (!m || m.quality_pct == null) return { score: null, state: 'INCOMPLETE', contributing_tests: [] };
    return { score: m.quality_pct, state: 'OK', contributing_tests: [canon('T09')] };
  }

  // ---- CAP：三域任一缺失 -> null/INCOMPLETE；绝不以 0 代替缺失域分；Match Transfer 不参与 ----
  function computeCAP(technicalScore, decisionScore, pressureScore) {
    if (technicalScore == null || decisionScore == null || pressureScore == null) {
      return { capability_score: null, capability_state: 'INCOMPLETE' };
    }
    var cap = CAP_WEIGHTS.technical * technicalScore + CAP_WEIGHTS.decision * decisionScore + CAP_WEIGHTS.pressure * pressureScore;
    return { capability_score: round1(cap), capability_state: 'OK' };
  }

  // ---- 单条硬门槛评估（纯函数）----
  // gateKey 以 _max 结尾 -> 越低越好（direction=max）；否则越高越好（direction=min）。
  // sampleCount 不足门槛所需样本时，即使数值达标也不得报 MET，降级为 BORDERLINE（"formally not MET"）。
  function evalHardGate(gateKey, gateCfg, currentValue, sampleCount, borderlineBandPp, sourceTestCanonicalId) {
    var isMax = /_max$/.test(gateKey);
    var direction = isMax ? 'max' : 'min';
    var threshold = gateCfg.threshold;
    var band = (borderlineBandPp == null) ? DEFAULT_BORDERLINE_BAND_PP : borderlineBandPp;
    var sampleRequirement = gateCfg.min_trials || gateCfg.min_sessions || gateCfg.min_scenarios ||
      gateCfg.min_rallies || gateCfg.min_games || gateCfg.min_opportunities || gateCfg.min_eligible_rallies || null;

    var row = {
      metric: gateKey,
      threshold: threshold,
      direction: direction,
      current_value: (currentValue == null ? null : currentValue),
      sample_requirement: sampleRequirement,
      sample_ok: null,
      status: null,
      source_test: sourceTestCanonicalId || null
    };

    if (currentValue == null) { row.status = 'INCOMPLETE'; return row; }

    row.sample_ok = (sampleRequirement == null) ? true : (sampleCount != null && sampleCount >= sampleRequirement);

    var raw;
    if (isMax) {
      raw = (currentValue <= threshold) ? 'MET' : ((currentValue <= threshold + band) ? 'BORDERLINE' : 'NOT_MET');
    } else {
      raw = (currentValue >= threshold) ? 'MET' : ((currentValue >= threshold - band) ? 'BORDERLINE' : 'NOT_MET');
    }
    if (raw === 'MET' && row.sample_ok === false) raw = 'BORDERLINE'; // 样本不足：不得判定为正式 MET
    row.status = raw;
    return row;
  }

  // ---- 硬门槛整体状态：NOT_MET > INCOMPLETE > BORDERLINE > MET（明确失败优先于未知）----
  function aggregateHardGateState(gates) {
    if (!gates || !gates.length) return 'INCOMPLETE';
    if (gates.some(function (g) { return g.status === 'NOT_MET'; })) return 'NOT_MET';
    if (gates.some(function (g) { return g.status === 'INCOMPLETE'; })) return 'INCOMPLETE';
    if (gates.some(function (g) { return g.status === 'BORDERLINE'; })) return 'BORDERLINE';
    return 'MET';
  }

  // ---- Capability 门槛（对照 target level 的 capability_min；不得单独用 CAP 判定等级资格）----
  function evalCapabilityThreshold(capabilityState, capabilityScore, capabilityMin) {
    if (capabilityState !== 'OK' || capabilityScore == null || capabilityMin == null) {
      return { threshold: (capabilityMin == null ? null : capabilityMin), state: 'INCOMPLETE' };
    }
    return { threshold: capabilityMin, state: (capabilityScore >= capabilityMin) ? 'MET' : 'NOT_MET' };
  }

  // ---- Match Validation：独立于 CAP；仅当 target level 要求时才评估 ----
  function evalMatchValidation(required, minScore, matchTransferScore) {
    if (!required) return { required: false, state: 'INCOMPLETE', score: (matchTransferScore == null ? null : matchTransferScore) };
    if (matchTransferScore == null) return { required: true, state: 'INCOMPLETE', score: null };
    return { required: true, state: (matchTransferScore >= minScore) ? 'MET' : 'NOT_MET', score: matchTransferScore };
  }

  // ---- Evidence Confidence：仅基于本次 assessment 自身可验证的数据；
  // C3 需要 >=3 段视频比赛或 >=60 编码回合，C4 需要 4-6 周趋势 —— 均超出当前采集能力，
  // S7-B 结构上无法验证，因此本引擎在 S7-B 阶段最高只判定到 C2，绝不臆造 C3/C4。----
  function determineEvidenceConfidence(testDatesCount, gamesCount) {
    if (testDatesCount == null) return { evidence_confidence: null, evidence_state: 'INCOMPLETE' };
    if (testDatesCount >= 2 && gamesCount != null && gamesCount >= 2) {
      return { evidence_confidence: 'C2', evidence_state: 'DETERMINED' };
    }
    return { evidence_confidence: 'C1', evidence_state: 'DETERMINED' }; // C1 為基線，恒可判定
  }

  function countDistinctDates(sessions) {
    var set = {};
    (sessions || []).forEach(function (s) { if (s && s.started_at) set[s.started_at.slice(0, 10)] = true; });
    return Object.keys(set).length;
  }

  // ---- Validated-Level Eligibility：Capability 门槛 AND Evidence 门槛 AND 目标等级硬门槛 AND（若要求）Match Validation ----
  // 任一环节明确失败 -> NOT_ELIGIBLE（即使其它环节未知，明确失败优先）；
  // 无明确失败但存在未知环节 -> INCOMPLETE；全部通过 -> VALIDATION_ELIGIBLE。
  // 本函数只判定"是否有资格"，绝不写入/晋升 validated_training_level。
  function evalValidationEligibility(o) {
    var capFail = o.capabilityThresholdState === 'NOT_MET';
    var gateFail = o.hardGateState === 'NOT_MET' || o.hardGateState === 'BORDERLINE';
    var matchFail = !!o.matchValidationRequired && o.matchValidationState === 'NOT_MET';
    var evidenceFail = o.evidenceState === 'DETERMINED' && o.evidenceMin != null &&
      EVIDENCE_RANK[o.evidenceConfidence] < EVIDENCE_RANK[o.evidenceMin];
    if (capFail || gateFail || matchFail || evidenceFail) return 'NOT_ELIGIBLE';

    var capUnknown = o.capabilityThresholdState === 'INCOMPLETE';
    var gateUnknown = o.hardGateState === 'INCOMPLETE';
    var matchUnknown = !!o.matchValidationRequired && o.matchValidationState === 'INCOMPLETE';
    var evidenceUnknown = o.evidenceState !== 'DETERMINED';
    if (capUnknown || gateUnknown || matchUnknown || evidenceUnknown) return 'INCOMPLETE';

    return 'VALIDATION_ELIGIBLE';
  }

  // ---- Primary Bottleneck：冻结优先级，S7-B 只实现前四步（无 Trend/诊断根因）----
  // 1) Failed Target-Level Hard Gate  2) Largest Relevant Deficit(含 borderline / capability)
  // 3) Match Impact  4) Evidence  —— 全部满足则 bottleneck_state=NONE；数据不足以判定则 INCOMPLETE。
  function gateDeficit(g) {
    if (g.current_value == null) return -Infinity;
    return (g.direction === 'max') ? (g.current_value - g.threshold) : (g.threshold - g.current_value);
  }
  function pickLargestDeficit(list) {
    var best = null, bestD = -Infinity;
    list.forEach(function (g) {
      var d = gateDeficit(g);
      if (d > bestD) { bestD = d; best = g; }
    });
    return best;
  }

  function determinePrimaryBottleneck(o) {
    var gates = o.hardGates || [];

    var failed = gates.filter(function (g) { return g.status === 'NOT_MET'; });
    if (failed.length) {
      var worst = pickLargestDeficit(failed);
      return { primary_bottleneck: 'hard_gate:' + worst.metric, bottleneck_state: 'DETERMINED' };
    }

    var borderline = gates.filter(function (g) { return g.status === 'BORDERLINE'; });
    if (borderline.length) {
      var worstB = pickLargestDeficit(borderline);
      return { primary_bottleneck: 'hard_gate:' + worstB.metric, bottleneck_state: 'DETERMINED' };
    }

    if (o.capabilityThresholdState === 'NOT_MET') {
      return { primary_bottleneck: 'capability_threshold', bottleneck_state: 'DETERMINED' };
    }

    if (o.matchValidationRequired && o.matchValidationState === 'NOT_MET') {
      return { primary_bottleneck: 'match_validation', bottleneck_state: 'DETERMINED' };
    }

    var evidenceInsufficient = o.evidenceState !== 'DETERMINED' ||
      (o.evidenceMin != null && EVIDENCE_RANK[o.evidenceConfidence] < EVIDENCE_RANK[o.evidenceMin]);
    if (evidenceInsufficient) {
      return { primary_bottleneck: 'evidence', bottleneck_state: 'DETERMINED' };
    }

    var anyIncomplete = gates.some(function (g) { return g.status === 'INCOMPLETE'; }) ||
      o.capabilityThresholdState === 'INCOMPLETE' ||
      (o.matchValidationRequired && o.matchValidationState === 'INCOMPLETE');
    if (anyIncomplete) return { primary_bottleneck: null, bottleneck_state: 'INCOMPLETE' };

    return { primary_bottleneck: null, bottleneck_state: 'NONE' };
  }

  // ---- 从 test_definitions 动态派生 "metric key -> test id"，不硬编码重复表，避免与数据源漂移 ----
  function buildMetricToTest(testDefs) {
    var map = {};
    var tests = (testDefs && testDefs.tests) || {};
    Object.keys(tests).forEach(function (tid) {
      var metrics = tests[tid].metrics || {};
      Object.keys(metrics).forEach(function (mk) { if (!(mk in map)) map[mk] = tid; });
    });
    return map;
  }

  // ---- 独立配置加载（不依赖 UI 模块，自行 fetch，与 preview.js 解耦）----
  var _levelGates = null, _testDefs = null;
  function loadLevelGates(base) {
    if (_levelGates) return Promise.resolve(_levelGates);
    base = base || './data/';
    return fetch(base + 'level_gates_v2_3_1.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('level_gates load failed HTTP ' + r.status);
      return r.json();
    }).then(function (g) { _levelGates = g; return g; });
  }
  function loadTestDefinitions(base) {
    if (_testDefs) return Promise.resolve(_testDefs);
    base = base || './data/';
    return fetch(base + 'test_definitions_v2_3_1.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('test_definitions load failed HTTP ' + r.status);
      return r.json();
    }).then(function (td) { _testDefs = td; return td; });
  }

  // ---- 主流程：生成 Review Snapshot（只读，不落库）----
  function generate(assessment_id, base) {
    if (typeof PBStore === 'undefined') throw new Error('PBStore not loaded');
    if (typeof PBMetrics === 'undefined') throw new Error('PBMetrics not loaded');

    var levelGates, testDefs, assessment;
    return Promise.all([loadLevelGates(base), loadTestDefinitions(base)]).then(function (r) {
      levelGates = r[0]; testDefs = r[1];
      return PBStore.get('assessments', assessment_id);
    }).then(function (a) {
      if (!a) throw new Error('assessment not found: ' + assessment_id);
      assessment = a;
      return Promise.all([PBMetrics.computeAssessment(assessment_id), PBStore.sessionsByAssessment(assessment_id)]);
    }).then(function (r) {
      var metricsResult = r[0], sessions = r[1];
      var perTest = metricsResult.per_test || {};
      var match = metricsResult.match || null;

      var tech = computeTechnicalDomain(perTest);
      var dec = computeDecisionDomain(perTest);
      var pres = computePressureDomain(perTest);
      var cap = computeCAP(tech.score, dec.score, pres.score);

      var targetKey = assessment.target_training_level.toFixed(1);
      var levelCfg = levelGates.levels[targetKey];
      var borderBand = (levelGates.statistical_policy && levelGates.statistical_policy.borderline_band_pp != null)
        ? levelGates.statistical_policy.borderline_band_pp : DEFAULT_BORDERLINE_BAND_PP;

      var metricToTest = buildMetricToTest(testDefs);
      var hardGates = [];
      if (levelCfg && levelCfg.hard_gates) {
        Object.keys(levelCfg.hard_gates).forEach(function (gateKey) {
          var gateCfg = levelCfg.hard_gates[gateKey];
          if (gateKey === 'ue_per_game_max') {
            var cur = (match && match.ue_per_game != null) ? match.ue_per_game : null;
            var sc = (match && match.games != null) ? match.games : null;
            hardGates.push(evalHardGate(gateKey, gateCfg, cur, sc, borderBand, 'match'));
            return;
          }
          var isMax = /_max$/.test(gateKey);
          var baseKey = isMax ? gateKey.replace(/_max$/, '') : gateKey;
          var tid = metricToTest[baseKey] || null;
          var m = tid ? perTest[tid] : null;
          var cur2 = (m && m.quality_pct != null) ? m.quality_pct : null;
          var sc2 = (m && m.n_valid != null) ? m.n_valid : null;
          hardGates.push(evalHardGate(gateKey, gateCfg, cur2, sc2, borderBand, tid ? canon(tid) : null));
        });
      }
      var hardGateState = aggregateHardGateState(hardGates);
      var failedHardGates = hardGates.filter(function (g) { return g.status === 'NOT_MET'; });

      var matchValReq = !!(levelCfg && levelCfg.match_validation && levelCfg.match_validation.required);
      var matchValMin = matchValReq ? levelCfg.match_validation.min_match_transfer_score : null;
      var matchScore = (match && match.match_transfer_score != null) ? match.match_transfer_score : null;
      var matchVal = evalMatchValidation(matchValReq, matchValMin, matchScore);

      var testDatesCount = countDistinctDates(sessions);
      var gamesCount = (match && match.games != null) ? match.games : null;
      var evidence = determineEvidenceConfidence(testDatesCount, gamesCount);

      var capThresh = evalCapabilityThreshold(cap.capability_state, cap.capability_score, levelCfg ? levelCfg.capability_min : null);

      var validationState = evalValidationEligibility({
        capabilityThresholdState: capThresh.state,
        hardGateState: hardGateState,
        evidenceState: evidence.evidence_state,
        evidenceConfidence: evidence.evidence_confidence,
        evidenceMin: levelCfg ? levelCfg.evidence_min : null,
        matchValidationRequired: matchValReq,
        matchValidationState: matchVal.state
      });

      var bottleneck = determinePrimaryBottleneck({
        hardGates: hardGates,
        capabilityThresholdState: capThresh.state,
        matchValidationRequired: matchValReq,
        matchValidationState: matchVal.state,
        evidenceState: evidence.evidence_state,
        evidenceConfidence: evidence.evidence_confidence,
        evidenceMin: levelCfg ? levelCfg.evidence_min : null
      });

      return {
        review_snapshot_id: null, // 持久化时由 PBStore.createReviewSnapshot 分配并回填
        assessment_id: assessment.assessment_id,
        player_id: assessment.player_id,
        assessment_date: assessment.assessment_date,
        assessment_tier: assessment.assessment_tier,
        target_training_level: assessment.target_training_level,
        target_level_supported: !!levelCfg,

        technical_score: tech.score, technical_state: tech.state, technical_contributing_tests: tech.contributing_tests,
        decision_score: dec.score, decision_state: dec.state, decision_contributing_tests: dec.contributing_tests,
        pressure_score: pres.score, pressure_state: pres.state, pressure_contributing_tests: pres.contributing_tests,

        capability_score: cap.capability_score,
        capability_state: cap.capability_state,
        capability_threshold: capThresh.threshold,
        capability_threshold_state: capThresh.state,

        match_transfer_score: matchScore,
        match_transfer_mode: (matchScore != null) ? 'simplified' : null,
        match_validation_required: matchValReq,
        match_validation_state: matchVal.state,

        evidence_state: evidence.evidence_state,
        evidence_confidence: evidence.evidence_confidence,
        evidence_min_required: levelCfg ? levelCfg.evidence_min : null,

        hard_gates: hardGates,
        hard_gate_state: hardGateState,
        failed_hard_gates: failedHardGates,

        validation_state: validationState,

        primary_bottleneck: bottleneck.primary_bottleneck,
        bottleneck_state: bottleneck.bottleneck_state,

        schema_version: testDefs.schema_version,
        benchmark_version: testDefs.benchmark_version,
        protocol_version: testDefs.protocol_version,
        generated_at: new Date().toISOString()
      };
    });
  }

  // ---- 显式持久化：写入 S7-A review_snapshots 存储。绝不在 generate() 内部自动调用，
  // 避免"仅因渲染页面"就产生重复快照；调用方需显式选择 persist / generateAndPersist。----
  function persist(snapshot) {
    if (typeof PBStore === 'undefined') throw new Error('PBStore not loaded');
    return PBStore.createReviewSnapshot({ assessment_id: snapshot.assessment_id, data: snapshot }).then(function (stored) {
      snapshot.review_snapshot_id = stored.review_snapshot_id;
      return stored;
    });
  }
  function generateAndPersist(assessment_id, base) {
    return generate(assessment_id, base).then(function (snapshot) { return persist(snapshot); });
  }

  return {
    // 主流程（异步，依赖 PBStore/PBMetrics/PBNamespace + fetch）
    forAssessment: generate,
    generate: generate,
    persist: persist,
    generateAndPersist: generateAndPersist,
    loadLevelGates: loadLevelGates,
    loadTestDefinitions: loadTestDefinitions,

    // 纯函数（可独立单测，无需 DB/网络）
    computeCAP: computeCAP,
    computeTechnicalDomain: computeTechnicalDomain,
    computeDecisionDomain: computeDecisionDomain,
    computePressureDomain: computePressureDomain,
    evalHardGate: evalHardGate,
    aggregateHardGateState: aggregateHardGateState,
    evalCapabilityThreshold: evalCapabilityThreshold,
    evalMatchValidation: evalMatchValidation,
    determineEvidenceConfidence: determineEvidenceConfidence,
    countDistinctDates: countDistinctDates,
    evalValidationEligibility: evalValidationEligibility,
    determinePrimaryBottleneck: determinePrimaryBottleneck,
    buildMetricToTest: buildMetricToTest,

    // 冻结常量（只读引用/回归测试用）
    CAP_WEIGHTS: CAP_WEIGHTS,
    VALIDATED_LEVELS: VALIDATED_LEVELS.slice(),
    EVIDENCE_RANK: EVIDENCE_RANK,
    CORE_TECHNICAL_TESTS: CORE_TECHNICAL_TESTS.slice()
  };
});
