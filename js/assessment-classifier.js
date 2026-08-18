/* ============================================================
 * assessment-classifier.js — Pickleball App 2.0 Alpha · S5
 * Formal Assessment Capability Classification Core
 * 只读、纯函数式的"正式评估判级"计算层：把调用方显式传入的 formal
 * assessment 输入（technical/decision/pressure 三项 component_scores、
 * 逐项 formal gate metrics、evidence_confidence C1–C4、可选
 * match_transfer_score）按 data/level_gates_v2_3_1.json（配置权威）与
 * schemas/scoring_engine_reference_v2_3_1.py（方法论权威、逐函数对齐）
 * 算出 capability_score / hard-gate 结果 / INCOMPLETE·LOW_CONFIDENCE·
 * PASS·BORDERLINE·FAIL 判定 / 3.0–5.0 五档中最高 PASS 档位。
 *
 * 严格边界（S5_SCOPE.md）：不推导 evidence_confidence 本身；不把 S2/S3
 * 训练证据/训练分析折算成正式评估指标；不做瓶颈推断/推荐/处方/
 * P0–P6/晋级/DUPR 解读；不引入新的 IndexedDB store 或 schema 版本；
 * 不持久化任何结果——每次调用都是一次全新的只读计算。本模块不依赖
 * PBStore/PBCanonical/PBTrainingAnalytics/PBPlayerTrainingState 中的
 * 任何一个：所有输入都是调用方显式提供的普通对象，从不从存储读取。
 *
 * data/evidence_confidence_v2_3_1.json 仅作为输入域参考（input-domain
 * reference only）——本模块在运行时从不 fetch 该文件；C1–C4 的秩序
 * （EVIDENCE_RANK）与 schemas/scoring_engine_reference_v2_3_1.py 完全
 * 手工镜像对齐，见下方常量。
 *
 * Owner-frozen R1（S5 pre-implementation gate decision）：
 * capability_score 的四舍五入必须与 Frozen Python Reference 的
 * round(x, 1) 语义一致（基于该 double 的精确二进制值、ties-to-even），
 * 而不是常见的 Math.round(x*10)/10（round-half-away-from-zero）写法；
 * 乘加运算顺序与 Python 源码逐行一致（0.45*t + 0.30*d + 0.25*p）。
 * 见 roundHalfEven1()。经验证据：tests/s5/fixtures/golden_vectors.json
 * （由 tests/s5/helpers/generate_golden_vectors.py 对 Frozen Python
 * Reference 实际运行一次生成，Python 文件本身从未被修改）。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PBAssessmentClassifier = factory().createModule();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CLASSIFIER_VERSION = 'PB30-50-S5-CLASSIFIER-v1';

  // ---- Owner-frozen R1: exact-value round-half-to-even to 1 decimal place, matching
  // CPython's round(x, 1) (which rounds the double's TRUE exact binary value, ties-to-even,
  // via David Gay's dtoa — not a decimal-string shortcut). Implemented with BigInt exact
  // integer arithmetic over the IEEE-754 bit pattern, so there is no float-on-float rounding
  // error anywhere in this function itself. ----
  function roundHalfEven1(x) {
    if (typeof x !== 'number' || !isFinite(x)) return x;
    if (x === 0) return 0;
    var sign = x < 0 ? -1 : 1;
    var ax = Math.abs(x);

    var buf = new ArrayBuffer(8);
    var dv = new DataView(buf);
    dv.setFloat64(0, ax);
    var hi = dv.getUint32(0);
    var lo = dv.getUint32(4);

    var biasedExp = (hi >>> 20) & 0x7ff;
    var mantHi = hi & 0xfffff;
    var mantissa = (BigInt(mantHi) << 32n) | BigInt(lo >>> 0);
    var e;
    if (biasedExp === 0) {
      // subnormal: value = mantissa * 2^-1074
      e = -1074;
    } else {
      mantissa = mantissa | (1n << 52n); // restore implicit leading 1
      e = biasedExp - 1075; // 1023 (bias) + 52 (mantissa fraction bits)
    }

    // |x| == mantissa * 2^e exactly. We need round(|x| * 10) to nearest integer, ties-to-even,
    // computed as an exact rational (num/den) so no precision is lost before rounding.
    var num, den;
    if (e >= 0) {
      num = mantissa * 10n * (1n << BigInt(e));
      den = 1n;
    } else {
      num = mantissa * 10n;
      den = 1n << BigInt(-e);
    }
    var q = num / den;      // BigInt division truncates toward zero (num, den both positive)
    var r = num % den;
    var twiceR = r * 2n;
    var roundedTenths;
    if (twiceR > den) roundedTenths = q + 1n;
    else if (twiceR < den) roundedTenths = q;
    else roundedTenths = (q % 2n === 0n) ? q : q + 1n; // exact tie -> round to even

    return sign * (Number(roundedTenths) / 10);
  }

  // ---- mirrors scoring_engine_reference_v2_3_1.py: EVIDENCE_RANK = {"C1":1,...} ----
  var EVIDENCE_RANK = { C1: 1, C2: 2, C3: 3, C4: 4 };

  var LABELS = ['3.0', '3.5', '4.0', '4.5', '5.0'];

  function hasOwn(obj, key) { return obj != null && Object.prototype.hasOwnProperty.call(obj, key); }
  function isMissing(v) { return v === undefined || v === null; }

  function invalidEvidenceError(evidence) {
    var err = new Error('assessment-classifier: invalid evidence_confidence "' + evidence + '" — must be one of C1/C2/C3/C4');
    err.code = 'INVALID_EVIDENCE_CONFIDENCE';
    return err;
  }

  // ---- mirrors scoring_engine_reference_v2_3_1.py: capability_score() ----
  function calculateCapabilityScore(componentScores) {
    var required = ['technical_score', 'decision_score', 'pressure_score'];
    var missing = required.some(function (k) { return !componentScores || isMissing(componentScores[k]); });
    if (missing) return null;
    var raw = 0.45 * componentScores.technical_score +
              0.30 * componentScores.decision_score +
              0.25 * componentScores.pressure_score;
    return roundHalfEven1(raw);
  }

  // ---- mirrors scoring_engine_reference_v2_3_1.py: _metric_pass(). A key OMITTED from
  // `metrics` (or explicitly null) is treated as -Infinity (>= gates) / +Infinity (_max
  // gates) — i.e. it always fails, exactly like Python's metrics.get(key, float('inf'/-inf))
  // sentinel default for an absent key. (Python's own .get() only substitutes the sentinel
  // for an OMITTED key — an explicit `None` value present in the dict would instead raise
  // TypeError comparing None to a threshold. That input shape never occurs under the S5 Data
  // Contract, where a metric is either a present number or omitted entirely; JS folds the
  // never-actually-Python-tested "present but null" case into the same missing-sentinel
  // behavior rather than throwing, which still satisfies "never silently passes.") ----
  function metricPass(metricKey, rule, metrics) {
    var threshold = rule.threshold;
    var isMax = /_max$/.test(metricKey);
    var sourceKey = isMax ? metricKey.slice(0, -4) : metricKey;
    var present = metrics && hasOwn(metrics, sourceKey) && !isMissing(metrics[sourceKey]);
    if (isMax) {
      var vMax = present ? metrics[sourceKey] : Infinity;
      return vMax <= threshold;
    }
    var vMin = present ? metrics[sourceKey] : -Infinity;
    return vMin >= threshold;
  }

  // ---- mirrors scoring_engine_reference_v2_3_1.py: gate_pass() ----
  function gatePass(levelCfg, metrics) {
    var out = {};
    Object.keys(levelCfg.hard_gates || {}).forEach(function (key) {
      out[key] = metricPass(key, levelCfg.hard_gates[key], metrics);
    });
    return out;
  }

  // ---- mirrors scoring_engine_reference_v2_3_1.py: evidence_ok(). Throws (does not
  // silently coerce) on an evidence_confidence value outside {C1,C2,C3,C4} — T20. ----
  function evidenceOk(levelCfg, evidence) {
    if (!hasOwn(EVIDENCE_RANK, evidence)) throw invalidEvidenceError(evidence);
    return EVIDENCE_RANK[evidence] >= EVIDENCE_RANK[levelCfg.evidence_min];
  }

  // ---- mirrors scoring_engine_reference_v2_3_1.py: classify() — identical branch order.
  // Returns the MINIMAL Python-shaped core result; classifyLevel() wraps this into the full
  // Data Contract superset shape (Owner-frozen R3). ----
  function classifyCore(levelCfg, metrics, componentScores, evidence, matchTransferScore) {
    var cap = calculateCapabilityScore(componentScores);
    if (cap === null) {
      return { status: 'INCOMPLETE', capability_score_0_100: null };
    }
    var gp = gatePass(levelCfg, metrics);
    var evOk = evidenceOk(levelCfg, evidence);
    var matchCfg = levelCfg.match_validation;
    var matchOk = true;
    if (matchCfg && matchCfg.required) {
      matchOk = !isMissing(matchTransferScore) && matchTransferScore >= matchCfg.min_match_transfer_score;
    }
    var allGatesPass = Object.keys(gp).every(function (k) { return gp[k]; });

    var status;
    if (!evOk) {
      status = 'LOW_CONFIDENCE';
    } else if (allGatesPass && cap >= levelCfg.capability_min && matchOk) {
      status = 'PASS';
    } else if (allGatesPass && Math.abs(cap - levelCfg.capability_min) <= 5 && matchOk) {
      status = 'BORDERLINE';
    } else {
      status = 'FAIL';
    }
    return {
      capability_score_0_100: cap,
      gate_results: gp,
      evidence_ok: evOk,
      match_validation_ok: matchOk,
      status: status
    };
  }

  // ---- Owner-frozen R3: diagnostic-only "which named inputs were absent" list. Never
  // consulted by classifyCore()/gatePass() themselves — purely additive provenance
  // (S5_SCOPE.md MAY-calculate item 7), computed independently after the fact. ----
  function computeMissingInputs(input, levelCfg) {
    var missing = [];
    var cs = input.component_scores || {};
    ['technical_score', 'decision_score', 'pressure_score'].forEach(function (k) {
      if (isMissing(cs[k])) missing.push(k);
    });
    var metrics = input.metrics || {};
    Object.keys(levelCfg.hard_gates || {}).forEach(function (gateKey) {
      var sourceKey = /_max$/.test(gateKey) ? gateKey.slice(0, -4) : gateKey;
      if (isMissing(metrics[sourceKey]) && missing.indexOf(sourceKey) === -1) missing.push(sourceKey);
    });
    var matchCfg = levelCfg.match_validation;
    if (matchCfg && matchCfg.required && isMissing(input.match_transfer_score)) {
      missing.push('match_transfer_score');
    }
    return missing;
  }

  function buildMatchValidation(levelCfg, matchTransferScore, core) {
    var matchCfg = levelCfg.match_validation || null;
    return {
      configured: !!matchCfg,
      required: !!(matchCfg && matchCfg.required),
      min_match_transfer_score: matchCfg ? matchCfg.min_match_transfer_score : null,
      input: isMissing(matchTransferScore) ? null : matchTransferScore,
      ok: hasOwn(core, 'match_validation_ok') ? core.match_validation_ok : null
    };
  }

  function createModule() {
    var _configState = { loaded: false, data: null };

    function fetchJSON(url) {
      return fetch(url, { cache: 'no-cache' }).then(function (r) {
        if (!r.ok) throw new Error('assessment-classifier: failed to load ' + url + ' -> HTTP ' + r.status);
        return r.json();
      });
    }

    // ---- §1 of the approved S5 plan: PBAssessmentClassifier owns its own config load —
    // it does NOT extend/depend on the frozen js/config-loader.js (PBConfig), which has no
    // knowledge of gates. Fetches data/level_gates_v2_3_1.json (configuration authority) and
    // cross-checks schema_version/benchmark_version against data/versions.json, mirroring
    // config-loader.js's own consistency-guard pattern. data/evidence_confidence_v2_3_1.json
    // is deliberately never fetched here — see file header. ----
    function loadConfig(base) {
      if (_configState.loaded) return Promise.resolve(_configState.data);
      base = base || './data/';
      return Promise.all([
        fetchJSON(base + 'versions.json'),
        fetchJSON(base + 'level_gates_v2_3_1.json')
      ]).then(function (res) {
        var ver = res[0], gates = res[1];
        ['schema_version', 'benchmark_version'].forEach(function (k) {
          if (gates[k] !== ver[k]) {
            throw new Error('assessment-classifier: version mismatch ' + k + ': level_gates has "' + gates[k] + '", versions.json has "' + ver[k] + '"');
          }
        });
        _configState.data = gates;
        _configState.loaded = true;
        return gates;
      });
    }

    function requireLoadedConfig() {
      if (!_configState.loaded) {
        throw new Error('assessment-classifier: loadConfig() must be called and resolved before classifyTarget()/validatedLevel() without an explicit levelConfig');
      }
      return _configState.data;
    }

    function levelLabelFor(targetLevel) {
      var match = LABELS.filter(function (l) { return parseFloat(l) === targetLevel; });
      return match.length ? match[0] : null;
    }

    // ---- calculateCapabilityScore(componentScores) — Construction Package preferred API ----
    // (module-level function above; re-exposed here unchanged)

    // ---- classifyLevel(input, levelConfig) — Construction Package preferred API.
    // Pure, sync; takes an explicit single-level config so it never requires loadConfig().
    // Returns the full S5_DATA_CONTRACT.md "Requested-level result" shape (Owner-frozen R3:
    // a superset of the frozen Python's minimal INCOMPLETE-branch object; numeric/status
    // values remain parity-exact, extra fields are null/diagnostic only). ----
    function classifyLevel(input, levelConfig) {
      input = input || {};
      var metrics = input.metrics || {};
      var componentScores = input.component_scores || null;
      var evidence = input.evidence_confidence;
      var matchTransferScore = isMissing(input.match_transfer_score) ? null : input.match_transfer_score;

      var core = classifyCore(levelConfig, metrics, componentScores, evidence, matchTransferScore);

      return {
        classifier_version: CLASSIFIER_VERSION,
        schema_version: _configState.loaded ? _configState.data.schema_version : null,
        benchmark_version: _configState.loaded ? _configState.data.benchmark_version : null,
        target_level: isMissing(input.target_level) ? null : input.target_level,
        level_status: core.status,
        provisional_level: levelConfig.status === 'provisional',
        capability_score_0_100: core.capability_score_0_100,
        capability_min: isMissing(levelConfig.capability_min) ? null : levelConfig.capability_min,
        component_scores: componentScores,
        evidence: {
          input: isMissing(evidence) ? null : evidence,
          minimum: isMissing(levelConfig.evidence_min) ? null : levelConfig.evidence_min,
          ok: hasOwn(core, 'evidence_ok') ? core.evidence_ok : null
        },
        gate_results: hasOwn(core, 'gate_results') ? core.gate_results : null,
        match_validation: buildMatchValidation(levelConfig, matchTransferScore, core),
        missing_inputs: computeMissingInputs(input, levelConfig)
      };
    }

    // ---- classifyTarget(input) — Construction Package preferred API. Resolves levelConfig
    // from input.target_level against the loaded config (requires loadConfig() to have
    // resolved first). ----
    function classifyTarget(input) {
      input = input || {};
      var cfg = requireLoadedConfig();
      var label = levelLabelFor(input.target_level);
      if (!label || !cfg.levels[label]) {
        throw new Error('assessment-classifier: unknown target_level "' + input.target_level + '" — must be one of ' + LABELS.join('/'));
      }
      return classifyLevel(input, cfg.levels[label]);
    }

    // ---- validatedLevel(input) — Construction Package preferred API. Evaluates all five
    // discrete levels (3.0/3.5/4.0/4.5/5.0) independently against the SAME input (mirrors
    // scoring_engine_reference_v2_3_1.py's validated_level()); returns the highest label
    // whose level_status === 'PASS' (BORDERLINE never counts — exact string match, same as
    // Python's `result["status"] == "PASS"`), or null if none PASS. Owner-frozen R5: each
    // level is independent — no lower-level-must-also-PASS rule is applied here. ----
    function validatedLevel(input) {
      input = input || {};
      var cfg = requireLoadedConfig();
      var levelResults = {};
      var passed = [];
      LABELS.forEach(function (label) {
        var levelCfg = cfg.levels[label];
        var perLevelInput = {
          target_level: parseFloat(label),
          metrics: input.metrics,
          component_scores: input.component_scores,
          evidence_confidence: input.evidence_confidence,
          match_transfer_score: input.match_transfer_score
        };
        var result = classifyLevel(perLevelInput, levelCfg);
        levelResults[label] = result;
        if (result.level_status === 'PASS') passed.push(parseFloat(label));
      });
      return {
        validated_training_level: passed.length ? Math.max.apply(null, passed) : null,
        level_results: levelResults
      };
    }

    return {
      CLASSIFIER_VERSION: CLASSIFIER_VERSION,
      EVIDENCE_RANK: EVIDENCE_RANK,
      loadConfig: loadConfig,
      calculateCapabilityScore: calculateCapabilityScore,
      classifyLevel: classifyLevel,
      classifyTarget: classifyTarget,
      validatedLevel: validatedLevel,
      get loaded() { return _configState.loaded; },
      get config() { return _configState.data; }
    };
  }

  return {
    createModule: createModule,
    // exposed for direct unit testing of Owner-frozen R1 rounding parity (golden vectors)
    // without needing a full createModule() instance
    roundHalfEven1: roundHalfEven1,
    calculateCapabilityScore: calculateCapabilityScore,
    EVIDENCE_RANK: EVIDENCE_RANK
  };
});
