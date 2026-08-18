/* ============================================================
 * assessment-explainer.js — Pickleball App 2.0 Alpha · S6
 * Assessment Explanation & Evidence Trace Core
 * 只读、纯函数式的"评估解释"层：把调用方显式传入的 S5
 * PBAssessmentClassifier 结果（s5Result）连同该次调用本就已经持有的
 * 原始 metrics 与 levelConfig 一并翻译成人类可读 + 机器可读的解释——
 * 为什么 S5 返回了这个分类。S6 绝不是第二个分类器：level_status 及
 * 每一个 gate/evidence/match 的布尔判定，永远原样取自 s5Result，从不
 * 重新计算、覆盖或再解释。
 *
 * 严格边界（S6_SCOPE.md）：不重新分类/覆盖 S5；不推导 evidence_confidence；
 * 不把 S2/S3 训练证据折算成正式评估指标；不做瓶颈排序/推荐/处方/
 * P0–P6/晋级/DUPR 解读；不持久化任何结果；不依赖 PBStore/PBCanonical/
 * PBTrainingAnalytics/PBPlayerTrainingState 中的任何一个。
 *
 * Owner-approved S6 Decision A: explainClassification() takes THREE
 * explicit arguments — (s5Result, metrics, levelConfig) — rather than
 * s5Result alone, because PBAssessmentClassifier.classifyLevel()'s
 * gate_results is only {gateKey: boolean}: it carries no observed value
 * and no threshold. metrics/levelConfig are the SAME objects the caller
 * already built/obtained to call S5 in the first place — pure pass-
 * through, zero new data, zero re-derivation, zero modification of
 * js/assessment-classifier.js.
 *
 * Owner-approved S6 Decision E: CAPABILITY_WEIGHTS (0.45/0.30/0.25) and
 * BORDERLINE_BAND_PP (5) below are hand-mirrored literals copied from
 * js/assessment-classifier.js's own hardcoded constants (Owner-frozen S5
 * R1/R4) — NOT read from data/level_gates_v2_3_1.json's
 * capability_weights/statistical_policy.borderline_band_pp keys, and NOT
 * an independent S6 policy source. They exist here for DISPLAY only
 * (labeling capability.components / capability.status) and never feed
 * back into classification_status, which always comes verbatim from
 * s5Result.level_status. Parity with S5's actual literals is proven by
 * tests/s6/parity_mirror.test.js and the real-browser representative test.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PBAssessmentExplainer = factory().createModule();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EXPLAINER_VERSION = 'PB30-50-S6-EXPLAIN-v1';

  // ---- mirrors js/assessment-classifier.js calculateCapabilityScore()'s hardcoded
  // literals (Owner-frozen S5 R1) — display-only, see file header. ----
  var CAPABILITY_WEIGHTS = {
    technical_score: 0.45,
    decision_score: 0.30,
    pressure_score: 0.25
  };
  var CAPABILITY_COMPONENT_ORDER = ['technical_score', 'decision_score', 'pressure_score'];

  // ---- mirrors js/assessment-classifier.js classifyCore()'s hardcoded borderline
  // band literal (Owner-frozen S5 R4) — display-only, see file header. ----
  var BORDERLINE_BAND_PP = 5;

  var REASON_CODES = {
    INCOMPLETE_INPUT: 'INCOMPLETE_INPUT',
    CAPABILITY_BELOW_MINIMUM: 'CAPABILITY_BELOW_MINIMUM',
    CAPABILITY_BORDERLINE: 'CAPABILITY_BORDERLINE',
    EVIDENCE_BELOW_MINIMUM: 'EVIDENCE_BELOW_MINIMUM',
    HARD_GATE_FAIL: 'HARD_GATE_FAIL',
    GATE_BELOW_MINIMUM: 'GATE_BELOW_MINIMUM',
    GATE_ABOVE_MAXIMUM: 'GATE_ABOVE_MAXIMUM',
    MATCH_VALIDATION_FAIL: 'MATCH_VALIDATION_FAIL',
    BORDERLINE_CLASSIFICATION: 'BORDERLINE_CLASSIFICATION',
    PROVISIONAL_LEVEL: 'PROVISIONAL_LEVEL',
    PASS_ALL_REQUIREMENTS: 'PASS_ALL_REQUIREMENTS'
  };

  function isMissing(v) { return v === undefined || v === null; }
  function hasOwn(obj, key) { return obj != null && Object.prototype.hasOwnProperty.call(obj, key); }

  function invalidS5ResultError(reason) {
    var err = new Error('assessment-explainer: invalid s5Result — ' + reason);
    err.code = 'INVALID_S5_RESULT';
    return err;
  }

  // ---- capability section: observed/required/margin come straight from s5Result's
  // own two numbers (capability_score_0_100, capability_min) — margin is plain
  // subtraction, never a second capability-score computation. status is a display
  // banding of those same two numbers, mirroring S5's own hardcoded +/-5 band
  // (BORDERLINE_BAND_PP) purely to LABEL the section; it never substitutes for
  // s5Result.level_status. ----
  function buildCapability(s5Result) {
    var observed = isMissing(s5Result.capability_score_0_100) ? null : s5Result.capability_score_0_100;
    var required = isMissing(s5Result.capability_min) ? null : s5Result.capability_min;
    var margin = (observed === null || required === null) ? null : (observed - required);

    var status = null;
    if (observed !== null && required !== null) {
      if (observed >= required) status = 'PASS';
      else if ((required - observed) <= BORDERLINE_BAND_PP) status = 'BORDERLINE';
      else status = 'FAIL';
    }

    var componentScores = s5Result.component_scores || null;
    var components = CAPABILITY_COMPONENT_ORDER.map(function (key) {
      var value = componentScores && hasOwn(componentScores, key) && !isMissing(componentScores[key])
        ? componentScores[key] : null;
      return { metric: key, weight: CAPABILITY_WEIGHTS[key], value: value };
    });

    return { status: status, observed: observed, required: required, margin: margin, components: components };
  }

  // ---- evidence section: input/minimum copied verbatim from s5Result.evidence;
  // status is a direct relabel of s5Result.evidence.ok — never a re-check of C-rank. ----
  function buildEvidence(s5Result) {
    var ok = s5Result.evidence ? s5Result.evidence.ok : null;
    return {
      status: ok === true ? 'PASS' : (ok === false ? 'FAIL' : null),
      input: s5Result.evidence ? s5Result.evidence.input : null,
      minimum: s5Result.evidence ? s5Result.evidence.minimum : null
    };
  }

  // ---- hard_gates: one row per key already present in s5Result.gate_results (empty
  // when gate_results is null, i.e. INCOMPLETE — nothing was ever evaluated). status
  // is copied verbatim from s5Result.gate_results[key] (a boolean S5 already decided);
  // observed comes from the SAME metrics object the caller passed to S5; required
  // comes from the SAME levelConfig object the caller passed to S5. margin is plain
  // arithmetic per S6_DATA_CONTRACT.md (MIN: observed-required, MAX: required-observed)
  // — explanatory only, never a severity ranking. ----
  function buildHardGates(s5Result, metrics, levelConfig) {
    var gateResults = s5Result.gate_results;
    if (!gateResults) return [];
    var hardGatesCfg = (levelConfig && levelConfig.hard_gates) || {};
    metrics = metrics || {};
    return Object.keys(gateResults).map(function (gateKey) {
      var isMax = /_max$/.test(gateKey);
      var sourceKey = isMax ? gateKey.slice(0, -4) : gateKey;
      var direction = isMax ? 'MAX' : 'MIN';
      var rule = hardGatesCfg[gateKey] || {};
      var required = isMissing(rule.threshold) ? null : rule.threshold;
      var observed = hasOwn(metrics, sourceKey) && !isMissing(metrics[sourceKey]) ? metrics[sourceKey] : null;
      var status = gateResults[gateKey] ? 'PASS' : 'FAIL';
      var margin = (observed === null || required === null) ? null
        : (isMax ? (required - observed) : (observed - required));
      var reasonCode = status === 'PASS' ? null : (isMax ? REASON_CODES.GATE_ABOVE_MAXIMUM : REASON_CODES.GATE_BELOW_MINIMUM);
      return {
        metric: sourceKey,
        status: status,
        direction: direction,
        observed: observed,
        required: required,
        margin: margin,
        reason_code: reasonCode
      };
    });
  }

  // ---- match_validation section: null (section omitted, T38) when S5 says this level
  // has no match_validation configured at all; otherwise every value is copied/derived
  // from s5Result.match_validation's own fields (S5 already read levelConfig.match_validation
  // and the caller's match_transfer_score — S6 re-reads none of that itself). ----
  function buildMatchValidation(s5Result) {
    var mv = s5Result.match_validation;
    if (!mv || !mv.configured) return null;
    var observed = isMissing(mv.input) ? null : mv.input;
    var minimum = isMissing(mv.min_match_transfer_score) ? null : mv.min_match_transfer_score;
    var margin = (observed === null || minimum === null) ? null : (observed - minimum);
    return {
      required: !!mv.required,
      status: mv.ok === true ? 'PASS' : (mv.ok === false ? 'FAIL' : null),
      observed: observed,
      minimum: minimum,
      margin: margin
    };
  }

  // ---- summary.reason_code selection mirrors classifyCore()'s own if/else-if branch
  // order EXACTLY (S6_SCOPE MAY item 4 / Plan §5) — it re-reads the SAME booleans
  // already decided by S5 (evidence.ok, each gate_results[key], match_validation.ok,
  // capability observed>=required) purely to pick which already-known fact is the
  // headline; level_status itself is never touched. ----
  function selectSummaryReasonCode(status, hardGates, matchValidation, capability) {
    if (status === 'INCOMPLETE') return REASON_CODES.INCOMPLETE_INPUT;
    if (status === 'LOW_CONFIDENCE') return REASON_CODES.EVIDENCE_BELOW_MINIMUM;
    if (status === 'PASS') return REASON_CODES.PASS_ALL_REQUIREMENTS;
    if (status === 'BORDERLINE') return REASON_CODES.BORDERLINE_CLASSIFICATION;
    // FAIL: gate failure(s) first (most concrete/actionable), then match, then capability.
    var anyGateFailed = hardGates.some(function (g) { return g.status === 'FAIL'; });
    if (anyGateFailed) return REASON_CODES.HARD_GATE_FAIL;
    if (matchValidation && matchValidation.status === 'FAIL') return REASON_CODES.MATCH_VALIDATION_FAIL;
    return REASON_CODES.CAPABILITY_BELOW_MINIMUM;
  }

  function buildSummaryText(reasonCode, ctx) {
    switch (reasonCode) {
      case REASON_CODES.INCOMPLETE_INPUT:
        return 'Classification incomplete: one or more required component scores (technical/decision/pressure) were not supplied.';
      case REASON_CODES.EVIDENCE_BELOW_MINIMUM:
        return 'Evidence confidence ' + (ctx.evidenceInput || '(none)') + ' is below the required minimum ' + (ctx.evidenceMinimum || '(unset)') + ' for this level.';
      case REASON_CODES.PASS_ALL_REQUIREMENTS:
        return 'All requirements met: capability score, hard gates, evidence confidence, and match validation (if required) all satisfy this level\'s criteria.';
      case REASON_CODES.BORDERLINE_CLASSIFICATION:
        return 'Capability score is within ' + BORDERLINE_BAND_PP + ' points of the minimum while all hard gates and match validation (if required) passed.';
      case REASON_CODES.HARD_GATE_FAIL:
        return 'One or more hard gates did not meet their required threshold.';
      case REASON_CODES.MATCH_VALIDATION_FAIL:
        return 'Match transfer score did not meet the required minimum for this level.';
      case REASON_CODES.CAPABILITY_BELOW_MINIMUM:
        return 'Capability score is below the required minimum for this level, outside the borderline band.';
      default:
        return '';
    }
  }

  // ---- blocking_reasons: every concrete fact currently preventing PASS, listed in a
  // fixed deterministic order (gates in their s5Result.gate_results key order, then
  // match, then capability, then evidence/incomplete) — never sorted/ranked by margin
  // or severity (S6_SCOPE: "a failed gate is a classification blocker, not
  // automatically ranked by severity"). Empty for PASS and BORDERLINE (BORDERLINE by
  // definition has zero failed gates/match — S5_SCOPE borderline branch requires
  // allGatesPass && matchOk). ----
  function buildBlockingReasons(status, hardGates, matchValidation) {
    if (status === 'PASS' || status === 'BORDERLINE') return [];
    if (status === 'INCOMPLETE') return [REASON_CODES.INCOMPLETE_INPUT];
    if (status === 'LOW_CONFIDENCE') return [REASON_CODES.EVIDENCE_BELOW_MINIMUM];
    var reasons = [];
    hardGates.forEach(function (g) {
      if (g.status === 'FAIL') reasons.push(g.reason_code + ':' + g.metric);
    });
    if (matchValidation && matchValidation.status === 'FAIL') reasons.push(REASON_CODES.MATCH_VALIDATION_FAIL);
    reasons.push(REASON_CODES.CAPABILITY_BELOW_MINIMUM);
    return reasons;
  }

  function createModule() {
    // ---- explainClassification(s5Result, metrics, levelConfig) — Owner-approved
    // Decision A API. Pure, synchronous, no fetch, no storage. Never recomputes,
    // replaces, reinterprets, or independently derives S5's classification —
    // classification_status is always s5Result.level_status, verbatim. ----
    function explainClassification(s5Result, metrics, levelConfig) {
      if (!s5Result || typeof s5Result.level_status !== 'string') {
        throw invalidS5ResultError('s5Result.level_status must be a string (the exact S5 classifyLevel()/classifyTarget() output shape)');
      }
      metrics = metrics || {};
      levelConfig = levelConfig || null;

      var status = s5Result.level_status;
      var capability = buildCapability(s5Result);
      var evidence = buildEvidence(s5Result);
      var hardGates = buildHardGates(s5Result, metrics, levelConfig);
      var matchValidation = buildMatchValidation(s5Result);
      var reasonCode = selectSummaryReasonCode(status, hardGates, matchValidation, capability);
      var blockingReasons = buildBlockingReasons(status, hardGates, matchValidation);

      return {
        explanation_version: EXPLAINER_VERSION,
        target_level: isMissing(s5Result.target_level) ? null : s5Result.target_level,
        classification_status: status,
        summary: {
          reason_code: reasonCode,
          explanation: buildSummaryText(reasonCode, { evidenceInput: evidence.input, evidenceMinimum: evidence.minimum })
        },
        capability: capability,
        evidence: evidence,
        hard_gates: hardGates,
        match_validation: matchValidation,
        missing_inputs: Array.isArray(s5Result.missing_inputs) ? s5Result.missing_inputs.slice() : [],
        provisional: !!s5Result.provisional_level,
        blocking_reasons: blockingReasons,
        provenance: {
          classifier_version: isMissing(s5Result.classifier_version) ? null : s5Result.classifier_version,
          schema_version: isMissing(s5Result.schema_version) ? null : s5Result.schema_version,
          benchmark_version: isMissing(s5Result.benchmark_version) ? null : s5Result.benchmark_version,
          explainer_version: EXPLAINER_VERSION
        }
      };
    }

    return {
      EXPLAINER_VERSION: EXPLAINER_VERSION,
      REASON_CODES: REASON_CODES,
      CAPABILITY_WEIGHTS: CAPABILITY_WEIGHTS,
      BORDERLINE_BAND_PP: BORDERLINE_BAND_PP,
      explainClassification: explainClassification
    };
  }

  return {
    createModule: createModule,
    EXPLAINER_VERSION: EXPLAINER_VERSION,
    REASON_CODES: REASON_CODES,
    CAPABILITY_WEIGHTS: CAPABILITY_WEIGHTS,
    BORDERLINE_BAND_PP: BORDERLINE_BAND_PP
  };
});
