/* ============================================================
 * player-training-state.js — Pickleball App 2.0 Alpha · S4
 * Player Training State Integration Core
 * 只读、按需计算的"球员训练状态"复合视图：把已存储的 Assessment 上下文
 * （逐字段白名单投影，从不整体透传）与 S3 PBTrainingAnalytics 的训练
 * 证据聚合快照组合成一个确定性的只读快照。评估域与训练域彼此不覆盖、
 * 不互相推断；缺失值保持 null，绝不合成/回填。不做任何判级/能力分/
 * 置信度/瓶颈推断排序/推荐/处方/晋级/P0–P6/DUPR 解读逻辑，不引入新的
 * IndexedDB store 或 schema 版本，不持久化任何派生结果。
 * 依赖：js/storage.js (PBStore)、js/canonical-runtime.js (PBCanonical，
 * 仅用于依赖存在性检查)、js/training-analytics.js (PBTrainingAnalytics)，
 * 三者必须先于本文件加载。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.PBPlayerTrainingState = factory().createModule({
      pbStore: root.PBStore,
      pbCanonical: root.PBCanonical,
      pbTrainingAnalytics: root.PBTrainingAnalytics
    });
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STATE_VERSION = 'PB30-50-S4-STATE-v1';

  function isNonEmptyString(v) { return typeof v === 'string' && v.length > 0; }
  function hasOwn(obj, key) { return obj != null && Object.prototype.hasOwnProperty.call(obj, key); }
  function fieldOrNull(obj, key) { return hasOwn(obj, key) ? obj[key] : null; }

  function playerNotFoundError(player_id) {
    var err = new Error('player-training-state: unknown player_id "' + player_id + '"');
    err.code = 'PLAYER_NOT_FOUND';
    return err;
  }

  // ---- 确定性排序比较器（字符串字典序，绝不解析 Date，绝不依赖存储返回顺序）----
  function compareDesc(a, b) {
    if (a > b) return -1;
    if (a < b) return 1;
    return 0;
  }

  // ---- 最新 Assessment 选择：assessment_date 最高 → created_at 最高 → assessment_id 字典序最高 ----
  function selectLatestAssessment(assessments) {
    if (!assessments || assessments.length === 0) return null;
    var sorted = assessments.slice().sort(function (x, y) {
      var byDate = compareDesc(x.assessment_date || '', y.assessment_date || '');
      if (byDate !== 0) return byDate;
      var byCreated = compareDesc(x.created_at || '', y.created_at || '');
      if (byCreated !== 0) return byCreated;
      return compareDesc(x.assessment_id || '', y.assessment_id || '');
    });
    return sorted[0];
  }

  // ---- match_transfer_score：字面存储优先取扁平字段；否则取已落库的嵌套
  // assessment.match_transfer.score（Owner-frozen 15.1：按仓库实际写入形状读取，
  // 仍是字面透传，不做任何计算/推断）----
  function matchTransferScore(a) {
    if (hasOwn(a, 'match_transfer_score')) return a.match_transfer_score;
    if (hasOwn(a, 'match_transfer') && a.match_transfer && hasOwn(a.match_transfer, 'score')) {
      return a.match_transfer.score;
    }
    return null;
  }

  // ---- 显式白名单投影（Owner-frozen 15.2）：只暴露以下命名字段，从不透传/暴露
  // 完整 Assessment 对象本身；每个字段独立按 hasOwnProperty 读取，缺失→null，
  // 已存储的 0 保持 0（从不用 `||` 折叠）----
  function projectAssessment(a) {
    return {
      selected_assessment_id: a.assessment_id,
      assessment_date: fieldOrNull(a, 'assessment_date'),
      assessment_tier: fieldOrNull(a, 'assessment_tier'),
      target_training_level: fieldOrNull(a, 'target_training_level'),
      validated_training_level: fieldOrNull(a, 'validated_training_level'),
      capability_score_0_100: fieldOrNull(a, 'capability_score_0_100'),
      technical_score: fieldOrNull(a, 'technical_score'),
      decision_score: fieldOrNull(a, 'decision_score'),
      pressure_score: fieldOrNull(a, 'pressure_score'),
      match_transfer_score: matchTransferScore(a),
      evidence_confidence: fieldOrNull(a, 'evidence_confidence'),
      primary_bottleneck: fieldOrNull(a, 'primary_bottleneck'),
      secondary_bottleneck: fieldOrNull(a, 'secondary_bottleneck'),
      recommended_block_id: fieldOrNull(a, 'recommended_block_id'),
      versions: {
        schema_version: fieldOrNull(a, 'schema_version'),
        benchmark_version: fieldOrNull(a, 'benchmark_version'),
        protocol_version: fieldOrNull(a, 'protocol_version')
      },
      dupr: fieldOrNull(a, 'dupr'),
      external_validation_note: fieldOrNull(a, 'external_validation_note')
    };
  }

  // ---- 无 Assessment 时的空状态：versions 也必须为 null（Owner-frozen 15.3）——
  // 不回退到 PBCanonical/PBConfig 的运行时默认版本号，因为那会伪造并不存在的
  // Assessment 出处（provenance）----
  function emptyAssessmentState() {
    return {
      availability: 'NONE',
      selected_assessment_id: null,
      assessment_date: null,
      assessment_tier: null,
      target_training_level: null,
      validated_training_level: null,
      capability_score_0_100: null,
      technical_score: null,
      decision_score: null,
      pressure_score: null,
      match_transfer_score: null,
      evidence_confidence: null,
      primary_bottleneck: null,
      secondary_bottleneck: null,
      recommended_block_id: null,
      versions: null,
      dupr: null,
      external_validation_note: null
    };
  }

  var INTEGRITY_ARRAY_KEYS = ['unknown_drill_ids', 'unknown_master_ids', 'mismatched_master_ids', 'unknown_session_ids'];

  function createModule(opts) {
    opts = opts || {};
    var pbStore = opts.pbStore;
    var pbCanonical = opts.pbCanonical;
    var pbTrainingAnalytics = opts.pbTrainingAnalytics;

    if (!pbStore) throw new Error('player-training-state: PBStore is not available — js/storage.js must load before js/player-training-state.js');
    if (!pbCanonical) throw new Error('player-training-state: PBCanonical is not available — js/canonical-runtime.js must load before js/player-training-state.js');
    if (!pbTrainingAnalytics) throw new Error('player-training-state: PBTrainingAnalytics is not available — js/training-analytics.js must load before js/player-training-state.js');

    function getPlayerTrainingState(queryOpts) {
      queryOpts = queryOpts || {};
      var player_id = queryOpts.player_id;
      if (!isNonEmptyString(player_id)) return Promise.reject(new Error('player-training-state: player_id is required'));

      // Owner-frozen 15.7：原样转发 S3 已支持的完整 filter 集合，不重解释/不收窄/不扩展语义。
      var filter = {
        date_from: (queryOpts.date_from == null ? null : queryOpts.date_from),
        date_to: (queryOpts.date_to == null ? null : queryOpts.date_to),
        training_session_ids: (queryOpts.training_session_ids == null ? null : queryOpts.training_session_ids),
        source_drill_ids: (queryOpts.source_drill_ids == null ? null : queryOpts.source_drill_ids),
        master_ids: (queryOpts.master_ids == null ? null : queryOpts.master_ids)
      };

      return pbStore.get('players', player_id).then(function (player) {
        // Owner-frozen 15.6：未知 player_id 显式失败，携带稳定错误码 PLAYER_NOT_FOUND，
        // 绝不返回"空球员状态"当作正常结果。
        if (!player) throw playerNotFoundError(player_id);

        return Promise.all([
          pbStore.getByIndex('assessments', 'by_player', player_id),
          pbTrainingAnalytics.computeSnapshot({
            player_id: player_id,
            date_from: filter.date_from,
            date_to: filter.date_to,
            training_session_ids: filter.training_session_ids,
            source_drill_ids: filter.source_drill_ids,
            master_ids: filter.master_ids
          })
        ]).then(function (r) {
          var assessments = r[0] || [];
          var analytics = r[1];

          var selected = selectLatestAssessment(assessments);
          var assessment_state;
          if (selected) {
            assessment_state = projectAssessment(selected);
            assessment_state.availability = 'AVAILABLE';
          } else {
            assessment_state = emptyAssessmentState();
          }

          // Owner-frozen 15.5：沿用 S3 既有证据计数语义——过滤后快照包含证据即 AVAILABLE，
          // 不发明新的"训练就绪度"规则。
          var trainingAvailable = analytics.overall.trial_count_total > 0;
          var training_state = {
            availability: trainingAvailable ? 'AVAILABLE' : 'NONE',
            filter: filter,
            analytics: analytics
          };

          // Owner-frozen 15.4：integrity.status 只表示"数据完整性"，绝不代表球员表现——
          // 单纯的存在性折叠（是否有任何一类损坏/未知 id 记录），无严重程度排序。
          var integrityArrays = analytics.integrity || {};
          var hasIssues = INTEGRITY_ARRAY_KEYS.some(function (k) { return (integrityArrays[k] || []).length > 0; });

          return {
            state_version: STATE_VERSION,
            player_id: player_id,
            player: { display_name: fieldOrNull(player, 'display_name') },
            assessment_state: assessment_state,
            training_state: training_state,
            availability: {
              assessment: assessment_state.availability,
              training_evidence: training_state.availability
            },
            integrity: {
              status: hasIssues ? 'ISSUES_PRESENT' : 'OK',
              analytics_integrity: analytics.integrity
            }
          };
        });
      });
    }

    return {
      STATE_VERSION: STATE_VERSION,
      getPlayerTrainingState: getPlayerTrainingState
    };
  }

  return { createModule: createModule };
});
