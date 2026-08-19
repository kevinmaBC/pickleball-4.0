/* ============================================================
 * trend-engine.js — Pickleball App 2.0 Alpha · S7-C Longitudinal Trend Engine
 * 消费既有 S7-B Review Snapshots，为一名 Player 产出结构化的纵向趋势结果。
 * 独立于 UI：只读 PBStore（review_snapshots / assessments），不重新计算
 * Review Snapshot、不重跑 S7-B 的 Bottleneck 算法、不渲染。
 *
 * 冻结方法论（Frozen Rules，详见任务书，禁止偏离）：
 *   - 默认纵向窗口：最新 assessment_date 往前 42 天（trailing 6 weeks）；
 *     本 Sprint 不提供任意自定义日期过滤。
 *   - 最少纵向证据：1 次评估=BASELINE_ONLY，2 次=DIRECTIONAL，
 *     3 次及以上=TREND_ELIGIBLE，数据缺失=INCOMPLETE；从不把 1 次评估
 *     说成"趋势"。
 *   - 0-100 类指标分级：delta>=+5 IMPROVING，delta<=-5 DECLINING，否则 STABLE。
 *   - Capability Trend 只用 Review Snapshot 中已持久化的 capability_score，
 *     绝不用 Match Transfer 重新计算 CAP、绝不把 Match Transfer 并入 CAP 趋势。
 *   - Match Transfer / UE-per-game 是独立时间序列，保留 S7-B 的
 *     simplified/full 证据元数据，绝不把 T10-lite 简化证据说成完整
 *     rally-coded ASMT-10。
 *   - 硬门槛趋势必须使用每个历史快照自带的 threshold（不得用今天的门槛
 *     覆盖历史点）；样本不足绝不折叠成"表现下滑"。
 *   - Bottleneck History 直接消费 S7-B 已产出的 primary_bottleneck /
 *     bottleneck_state，不在 S7-C 重新发明瓶颈判定算法。
 *   - 缺失数值绝不当 0 处理；证据不足一律 INSUFFICIENT_EVIDENCE / INCOMPLETE。
 *   - 不引入 DUPR/Internal DUPR/DUPR Gap、不做自动定级晋升、不做预测式 AI 打分。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PBTrend = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var WINDOW_DAYS = 42; // trailing 6 weeks（4-6 周为主要解读窗口）
  var TREND_BAND = 5;   // 0-100 类指标：|delta|>=5 才判定 IMPROVING/DECLINING

  // 供参考/回归测试：higher-is-better / lower-is-better 指标方向（section 6 示例）
  var METRIC_DIRECTIONS = {
    technical_score: 'higher',
    decision_score: 'higher',
    pressure_score: 'higher',
    capability_score: 'higher',
    match_transfer_score: 'higher',
    serve_in_pct: 'higher',
    drop_ball_quality_pct: 'higher',
    ue_per_game: 'lower',
    wrong_attack_pct: 'lower'
  };

  function round1(x) { return Math.round(x * 10) / 10; }
  function uniq(arr) {
    var seen = {}, out = [];
    (arr || []).forEach(function (v) {
      var k = String(v);
      if (!seen[k]) { seen[k] = true; out.push(v); }
    });
    return out;
  }

  // ---- 最少纵向证据分级：1/2/3+ 次评估；0 次或数据缺失 -> INCOMPLETE ----
  function classifyHistoryState(count) {
    if (count == null) return 'INCOMPLETE';
    if (count >= 3) return 'TREND_ELIGIBLE';
    if (count === 2) return 'DIRECTIONAL';
    if (count === 1) return 'BASELINE_ONLY';
    return 'INCOMPLETE';
  }

  // ---- 指标分级（纯函数）：delta 已按指标方向归一化为"越大越好"。
  // band 缺省为 TREND_BAND=5，适用于 0-100 类指标（section 5 明确限定"For normal 0-100 metrics"）。
  // band=0 用于非 0-100 绝对量指标（如 ue_per_game，量级通常个位数，±5 的门槛不适用）：
  // 此时任何非零方向性变化即分级为 IMPROVING/DECLINING，恰好 0 才是 STABLE。----
  function classifyTrend(normalizedDelta, band) {
    var b = (band == null) ? TREND_BAND : band;
    if (normalizedDelta == null) return 'INSUFFICIENT_EVIDENCE';
    if (b === 0) {
      if (normalizedDelta > 0) return 'IMPROVING';
      if (normalizedDelta < 0) return 'DECLINING';
      return 'STABLE';
    }
    if (normalizedDelta >= b) return 'IMPROVING';
    if (normalizedDelta <= -b) return 'DECLINING';
    return 'STABLE';
  }

  // ---- 归一化改善量：higher-is-better -> current-baseline；lower-is-better -> baseline-current ----
  function computeNormalizedDelta(baseline, current, direction) {
    if (baseline == null || current == null) return null;
    return round1(direction === 'lower' ? (baseline - current) : (current - baseline));
  }

  // ---- 单个指标的时间序列：计算用 series 仅收录有效值（非 null）的点，缺失点绝不当 0 处理，
  // 只计入 missing_point_count —— 这部分行为与既有语义完全不变。
  // 另外附带 display_series：保留窗口内每个 assessment 的原始时间顺序位置（含缺失观测，value 为 null），
  // 供 UI 端画图时能在缺口处断开折线，不把跨越缺失评估的两个有效点误连成一条连续趋势线。
  // points 须已按 assessment_date 升序排列。extraExtractor 可选，用于附带每点的证据元数据（如 match_transfer_mode）。
  // band 可选：非 0-100 绝对量指标（如 ue_per_game）传 0，其余默认沿用 TREND_BAND。
  function buildTrend(points, valueExtractor, direction, extraExtractor, band) {
    var totalCount = (points || []).length;
    var series = [];
    var displaySeries = [];
    (points || []).forEach(function (p) {
      var v = valueExtractor(p);
      var entry = {
        assessment_id: p.assessment_id,
        assessment_date: p.assessment_date,
        review_snapshot_id: p.review_snapshot_id,
        value: (v == null ? null : v),
        schema_version: p.schema_version,
        benchmark_version: p.benchmark_version,
        protocol_version: p.protocol_version
      };
      if (extraExtractor) {
        var extra = extraExtractor(p) || {};
        Object.keys(extra).forEach(function (k) { entry[k] = extra[k]; });
      }
      displaySeries.push(entry); // 完整时间顺序占位，含 null，绝不跳过、绝不置 0
      if (v == null) return;
      series.push(entry); // 计算用序列：只含有效点，与既有行为一致，不受本次改动影响
    });
    var pointCount = series.length;
    var baseline = pointCount ? series[0].value : null;
    var current = pointCount ? series[pointCount - 1].value : null;
    var rawDelta = (pointCount >= 2) ? round1(current - baseline) : null;
    var normDelta = (pointCount >= 2) ? computeNormalizedDelta(baseline, current, direction) : null;
    return {
      state: (pointCount >= 2) ? classifyTrend(normDelta, band) : 'INSUFFICIENT_EVIDENCE',
      baseline_value: baseline,
      current_value: current,
      raw_delta: rawDelta,
      normalized_improvement_delta: normDelta,
      point_count: pointCount,
      missing_point_count: totalCount - pointCount,
      evidence_mode: classifyHistoryState(pointCount),
      series: series,
      display_series: displaySeries
    };
  }

  // ---- 重复 Assessment 快照守卫：同一 assessment_id 可能存在多份快照，
  // 只取"最近生成"的那份（generated_at 最大者）作为该 Assessment 的唯一代表 ----
  function compareGeneratedAt(a, b) {
    var ta = (a && a.generated_at) ? Date.parse(a.generated_at) : -Infinity;
    var tb = (b && b.generated_at) ? Date.parse(b.generated_at) : -Infinity;
    return ta - tb;
  }
  function selectCanonicalSnapshots(storedRecords) {
    var byAssessment = {};
    (storedRecords || []).forEach(function (r) {
      if (!r || !r.assessment_id) return;
      var existing = byAssessment[r.assessment_id];
      if (!existing || compareGeneratedAt(r, existing) > 0) byAssessment[r.assessment_id] = r;
    });
    return Object.keys(byAssessment).map(function (k) { return byAssessment[k]; });
  }

  // ---- 6 周窗口筛选：以本组数据中最新 assessment_date 为基准，向前 42 天（含）----
  // points 须已带 assessment_date（'YYYY-MM-DD'）；输出按升序排列。
  function filterTrailingWindow(points, windowDays) {
    windowDays = (windowDays == null) ? WINDOW_DAYS : windowDays;
    var withDate = (points || []).filter(function (p) { return p && p.assessment_date; });
    if (!withDate.length) return { window_start: null, window_end: null, points: [] };
    var sorted = withDate.slice().sort(function (a, b) {
      return a.assessment_date < b.assessment_date ? -1 : (a.assessment_date > b.assessment_date ? 1 : 0);
    });
    var latest = sorted[sorted.length - 1].assessment_date;
    var latestMs = Date.parse(latest + 'T00:00:00.000Z');
    var startMs = latestMs - windowDays * 24 * 60 * 60 * 1000;
    var startDate = new Date(startMs).toISOString().slice(0, 10);
    var filtered = sorted.filter(function (p) { return Date.parse(p.assessment_date + 'T00:00:00.000Z') >= startMs; });
    return { window_start: startDate, window_end: latest, points: filtered };
  }

  // ---- 单条硬门槛的历史序列 + 状态迁移。使用每个快照自带的 threshold/performance_state/
  // sample_state/status，不得用今天的门槛覆盖历史点；样本不足不得折叠成表现下滑 ----
  // ---- 硬门槛"正式状态"迁移分级（独立于数值 trend_state，二者都要保留）----
  // MET/BORDERLINE/NOT_MET 三级按序比较：名次上升=PROGRESSED，下降=REGRESSED，持平=UNCHANGED。
  // 涉及 INCOMPLETE 的迁移单独处理：
  //   - 之前 performance 已经是 MET、只是样本不足被降级为 INCOMPLETE，现在样本补齐正式 MET
  //     -> EVIDENCE_COMPLETED（不是"从头进步"，是证据补齐）。
  //   - 前后 performance 都已是 MET、只是样本验证在两次快照间波动（如 MET<->INCOMPLETE）
  //     -> UNCHANGED（不得把样本波动误判为表现退步，呼应 S7-B"样本不足不折叠为表现下滑"）。
  //   - 其余任何一侧为 INCOMPLETE 且不满足以上两种情形 -> 无法确信分类 -> INCOMPLETE。
  //   - 缺少可比较的前一个历史点 -> INCOMPLETE（历史不足）。
  var GATE_STATUS_RANK = { NOT_MET: 0, BORDERLINE: 1, MET: 2 };
  function classifyGateTransition(prevEntry, currEntry) {
    if (!prevEntry || !currEntry) return 'INCOMPLETE';
    var prevStatus = prevEntry.formal_status, curStatus = currEntry.formal_status;

    if (prevStatus === 'INCOMPLETE' && curStatus === 'MET' && prevEntry.performance_state === 'MET') {
      return 'EVIDENCE_COMPLETED';
    }

    var prevRank = GATE_STATUS_RANK[prevStatus], curRank = GATE_STATUS_RANK[curStatus];
    if (prevRank != null && curRank != null) {
      if (curRank > prevRank) return 'PROGRESSED';
      if (curRank < prevRank) return 'REGRESSED';
      return 'UNCHANGED';
    }

    if (prevEntry.performance_state === 'MET' && currEntry.performance_state === 'MET') {
      return 'UNCHANGED'; // 两侧表现皆为 MET，正式状态的差异只是样本验证波动
    }

    return 'INCOMPLETE';
  }

  function buildGateTrend(metricKey, points) {
    var history = [];
    (points || []).forEach(function (p) {
      var row = (p.hard_gates || []).filter(function (g) { return g.metric === metricKey; })[0];
      if (!row) return;
      history.push({
        assessment_id: p.assessment_id,
        assessment_date: p.assessment_date,
        review_snapshot_id: p.review_snapshot_id,
        value: (row.current_value == null ? null : row.current_value),
        performance_state: row.performance_state,
        sample_state: row.sample_state,
        formal_status: row.status,
        threshold: row.threshold,
        direction: row.direction
      });
    });
    if (!history.length) return null;

    var thresholds = uniq(history.map(function (h) { return h.threshold; }));
    var last = history[history.length - 1];
    var prev = (history.length >= 2) ? history[history.length - 2] : null;
    var normDir = (last.direction === 'max') ? 'lower' : 'higher';
    var normDelta = (prev && prev.value != null && last.value != null) ? computeNormalizedDelta(prev.value, last.value, normDir) : null;
    // ue_per_game_max 是绝对量（个位数量级），不是 0-100 百分比，section 5 的 ±5 门槛不适用于它；
    // 其余门槛键均为 *_pct 百分比量表，沿用 TREND_BAND（例："62 → 70 = improvement" 这类 8 分差在 ±5 门槛下才成立）。
    var band = (metricKey === 'ue_per_game_max') ? 0 : TREND_BAND;

    return {
      metric: metricKey,
      direction: last.direction,
      threshold: last.threshold,
      threshold_mixed: thresholds.length > 1,
      history: history,
      previous_value: prev ? prev.value : null,
      current_value: last.value,
      previous_status: prev ? prev.formal_status : null,
      current_status: last.formal_status,
      // 数值趋势与正式状态迁移分开保留，互不替代：
      trend_state: (prev && prev.value != null && last.value != null) ? classifyTrend(normDelta, band) : 'INSUFFICIENT_EVIDENCE',
      gate_transition_state: classifyGateTransition(prev, last)
    };
  }

  // ---- 对最新快照当前包含的每个硬门槛 key，构建其历史序列 ----
  function buildHardGateTrends(points) {
    if (!points || !points.length) return [];
    var latest = points[points.length - 1];
    var keys = uniq((latest.hard_gates || []).map(function (g) { return g.metric; }));
    return keys.map(function (k) { return buildGateTrend(k, points); }).filter(function (x) { return x != null; });
  }

  // ---- Bottleneck History：原样消费每个窗口内快照的 primary_bottleneck/bottleneck_state，
  // 不在 S7-C 重新计算瓶颈算法 ----
  function collectBottleneckHistory(points) {
    return (points || []).map(function (p) {
      return {
        assessment_id: p.assessment_id,
        assessment_date: p.assessment_date,
        review_snapshot_id: p.review_snapshot_id,
        primary_bottleneck: (p.primary_bottleneck == null ? null : p.primary_bottleneck),
        bottleneck_state: p.bottleneck_state
      };
    });
  }

  // ---- Bottleneck Movement：只在"有把握的"两个最近快照间比较
  // （bottleneck_state 为 DETERMINED 或 NONE，即 S7-B 已给出明确结论的点）----
  function detectBottleneckMovement(history) {
    var eligible = (history || []).filter(function (h) { return h.bottleneck_state === 'DETERMINED' || h.bottleneck_state === 'NONE'; });
    if (eligible.length < 2) {
      return {
        state: 'INCOMPLETE',
        previous_bottleneck: null,
        current_bottleneck: eligible.length ? eligible[eligible.length - 1].primary_bottleneck : null
      };
    }
    var prev = eligible[eligible.length - 2].primary_bottleneck;
    var cur = eligible[eligible.length - 1].primary_bottleneck;
    var state;
    // PERSISTENT 冻结定义为"同一个非 null 瓶颈持续存在"；null->null（持续无瓶颈）不是 PERSISTENT，
    // 是独立的 NONE 状态——没有瓶颈可言，谈不上"持续存在同一个瓶颈"。
    if (prev == null && cur == null) state = 'NONE';
    else if (prev != null && cur == null) state = 'CLEARED';     // 瓶颈已清除
    else if (prev != null && cur != null && prev === cur) state = 'PERSISTENT';
    else state = 'SHIFTED'; // 含"由无到有"及"瓶颈类型改变"两种情形，均视为变化
    return { state: state, previous_bottleneck: prev, current_bottleneck: cur };
  }

  // ---- Mixed Domain Trend：Technical/Decision/Pressure 三个域趋势方向若互相矛盾（同时存在
  // IMPROVING 与 DECLINING）-> MIXED。不产出新的分数，只是分类标签 ----
  function combineOverallDomainTrend(states) {
    var determinate = (states || []).filter(function (s) { return s === 'IMPROVING' || s === 'STABLE' || s === 'DECLINING'; });
    if (!determinate.length) return 'INSUFFICIENT_EVIDENCE';
    var hasImproving = determinate.indexOf('IMPROVING') !== -1;
    var hasDeclining = determinate.indexOf('DECLINING') !== -1;
    if (hasImproving && hasDeclining) return 'MIXED';
    if (hasImproving) return 'IMPROVING';
    if (hasDeclining) return 'DECLINING';
    return 'STABLE';
  }

  // ---- Snapshot Version Awareness：窗口内若混有不同 schema/benchmark/protocol 版本组合 -> version_mixed=true ----
  function detectVersionMixed(points) {
    var combos = uniq((points || []).map(function (p) {
      return [p.schema_version, p.benchmark_version, p.protocol_version].join('|');
    }));
    return combos.length > 1;
  }

  // ---- 主流程：为一名 Player 生成纵向趋势结果（只读，不落库，不重算历史 Review Snapshot）----
  function forPlayer(player_id, base) {
    if (typeof PBStore === 'undefined') throw new Error('PBStore not loaded');

    return PBStore.assessmentsByPlayer(player_id).then(function (assessments) {
      assessments = assessments || [];
      return Promise.all(assessments.map(function (a) { return PBStore.reviewSnapshotsByAssessment(a.assessment_id); }))
        .then(function (arrs) {
          var allStored = arrs.reduce(function (acc, arr) { return acc.concat(arr || []); }, []);
          var canonical = selectCanonicalSnapshots(allStored);

          // 展平为"点"：快照内容(.data) + 存储层分配的 review_snapshot_id
          var points = canonical.map(function (rec) {
            var d = rec.data || {};
            var merged = {};
            Object.keys(d).forEach(function (k) { merged[k] = d[k]; });
            merged.review_snapshot_id = rec.review_snapshot_id || d.review_snapshot_id || null;
            return merged;
          }).filter(function (p) { return p.assessment_date; });
          points.sort(function (a, b) { return a.assessment_date < b.assessment_date ? -1 : (a.assessment_date > b.assessment_date ? 1 : 0); });

          var windowed = filterTrailingWindow(points, WINDOW_DAYS);
          var winPoints = windowed.points;

          // 完整性提示：窗口起点之后存在 Assessment 但缺少 Review Snapshot（不臆造，只报告）。
          // 注意：不设上界——一份比"最新快照日期"更新的 Assessment 若还没生成快照，同样是需要
          // 报告的缺口（不能因为它比 window_end 更新就被排除在外）。
          var haveSnapshot = {};
          winPoints.forEach(function (p) { haveSnapshot[p.assessment_id] = true; });
          var missingSnapshotAssessmentIds = [];
          if (windowed.window_start) {
            assessments.forEach(function (a) {
              if (a.assessment_date && a.assessment_date >= windowed.window_start && !haveSnapshot[a.assessment_id]) {
                missingSnapshotAssessmentIds.push(a.assessment_id);
              }
            });
          }

          var techTrend = buildTrend(winPoints, function (p) { return p.technical_score; }, 'higher');
          var decTrend = buildTrend(winPoints, function (p) { return p.decision_score; }, 'higher');
          var presTrend = buildTrend(winPoints, function (p) { return p.pressure_score; }, 'higher');
          var capTrend = buildTrend(winPoints, function (p) { return p.capability_score; }, 'higher'); // 仅用持久化 capability_score，不含 Match Transfer

          var mtTrend = buildTrend(winPoints, function (p) { return p.match_transfer_score; }, 'higher', function (p) {
            return { mode: p.match_transfer_mode || null };
          });
          // band=0：UE/game 是个位数量级的绝对量，不是 0-100 百分比，±5 门槛不适用（例：7→5 即为 IMPROVING）。
          var ueTrend = buildTrend(winPoints, function (p) {
            var g = (p.hard_gates || []).filter(function (x) { return x.metric === 'ue_per_game_max'; })[0];
            return (g && g.current_value != null) ? g.current_value : null;
          }, 'lower', null, 0);

          var gateTrends = buildHardGateTrends(winPoints);
          var bottleneckHistory = collectBottleneckHistory(winPoints);
          var bottleneckMovement = detectBottleneckMovement(bottleneckHistory);
          var overallDomainTrend = combineOverallDomainTrend([techTrend.state, decTrend.state, presTrend.state]);

          return {
            player_id: player_id,
            window_days: WINDOW_DAYS,
            window_start: windowed.window_start,
            window_end: windowed.window_end,

            history_state: classifyHistoryState(winPoints.length),
            assessment_count: winPoints.length,
            missing_snapshot_assessment_ids: missingSnapshotAssessmentIds,

            technical_trend: techTrend,
            decision_trend: decTrend,
            pressure_trend: presTrend,
            capability_trend: capTrend,

            match_transfer_trend: mtTrend,
            ue_per_game_trend: ueTrend,

            hard_gate_trends: gateTrends,

            bottleneck_history: bottleneckHistory,
            bottleneck_movement: bottleneckMovement,

            overall_domain_trend: overallDomainTrend,

            version_mixed: detectVersionMixed(winPoints),

            generated_at: new Date().toISOString()
          };
        });
    });
  }

  return {
    // 主流程（异步，依赖 PBStore）
    forPlayer: forPlayer,

    // 纯函数（可独立单测，无需 DB）
    classifyHistoryState: classifyHistoryState,
    classifyTrend: classifyTrend,
    computeNormalizedDelta: computeNormalizedDelta,
    buildTrend: buildTrend,
    buildMetricSeries: buildTrend, // 别名，兼容任务书建议的函数名
    selectCanonicalSnapshots: selectCanonicalSnapshots,
    filterTrailingWindow: filterTrailingWindow,
    buildGateTrend: buildGateTrend,
    classifyGateTransition: classifyGateTransition,
    buildHardGateTrends: buildHardGateTrends,
    collectBottleneckHistory: collectBottleneckHistory,
    detectBottleneckMovement: detectBottleneckMovement,
    combineOverallDomainTrend: combineOverallDomainTrend,
    detectVersionMixed: detectVersionMixed,

    // 冻结常量（只读引用/回归测试用）
    WINDOW_DAYS: WINDOW_DAYS,
    TREND_BAND: TREND_BAND,
    METRIC_DIRECTIONS: METRIC_DIRECTIONS
  };
});
