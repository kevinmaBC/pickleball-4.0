/* tests/progress-reassessment-ui.test.js — S11-D: Progress /
 * Reassessment UI
 * progress-reassessment-ui.js has no jsdom in this repo's test
 * conventions (same as the other *-ui.js modules — the DOM-mounting
 * layer is verified via manual browser QA, not automated tests). This
 * suite covers the pure label/format/route builders and the pure
 * (model, en) -> HTML renderProgressReassessmentHTML function, plus
 * structural source checks proving the thin-UI boundary.
 * Run: node tests/progress-reassessment-ui.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var UI = require('../js/progress-reassessment-ui.js');
var SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'progress-reassessment-ui.js'), 'utf8');
var CODE_ONLY = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
var CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'app.css'), 'utf8');

function baseModel(overrides) {
  return Object.assign({
    player_id: 'p1',
    cycle: { cycle_id: 'cyc_1', state: 'PROGRESS_RECORDED', kpi_profile_code: 'EXECUTION_SUCCESS_RATE', training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION', workflow_state: 'IN_PROGRESS' },
    training_progress: { status: 'RESOLVED', baseline: 0.62, current: 0.74, delta: 0.12, trend: 'IMPROVING', evidence_count: 4, source: 'TRAINING' },
    match_transfer: { status: 'INSUFFICIENT_DATA', numeric_progress: null, validated: false },
    reassessment: { required: false, state: null },
    journey: { stage: 'REVIEW_PROGRESS', status: 'READY' },
    next_action: { code: 'REVIEW_PROGRESS', enabled: true, target_ref: null },
    flags: [], schema_version: '1.0', view_version: 'S11-D-V1'
  }, overrides || {});
}

function run() {
  // ==================================================================
  // D-U01 — bilingual rendering
  // ==================================================================
  (function () {
    var zh = UI.renderProgressReassessmentHTML(baseModel(), false), en = UI.renderProgressReassessmentHTML(baseModel(), true);
    assert.ok(zh.indexOf('周期概览') !== -1 && zh.indexOf('训练进步') !== -1 && zh.indexOf('比赛迁移') !== -1 && zh.indexOf('复测状态') !== -1, 'zh section headers present');
    assert.ok(en.indexOf('Cycle Summary') !== -1 && en.indexOf('Training Progress') !== -1 && en.indexOf('Match Transfer') !== -1 && en.indexOf('Reassessment Status') !== -1, 'en section headers present');
  })();

  // ==================================================================
  // D-U02/D-U03 — Baseline / Current / Change visible, percentage-point formatting
  // ==================================================================
  (function () {
    var html = UI.renderProgressReassessmentHTML(baseModel(), false);
    assert.ok(html.indexOf('62%') !== -1, 'baseline formatted as percent');
    assert.ok(html.indexOf('74%') !== -1, 'current formatted as percent');
    assert.ok(html.indexOf('+12') !== -1, 'D-U03 delta formatted as percentage points (+12), never as +12%');
    assert.strictEqual(html.indexOf('+12%'), -1, 'D-U03 must never render the pp delta as a percent (+12%)');
    assert.strictEqual(UI.formatDeltaPP(0.12), '+12');
    assert.strictEqual(UI.formatDeltaPP(-0.05), '-5');
    assert.strictEqual(UI.formatDeltaPP(null), '—');
  })();

  // ==================================================================
  // D-U04 — trend wording (Section 12 bilingual vocabulary)
  // ==================================================================
  (function () {
    var expected = {
      IMPROVING: ['正在改善', 'Improving'], STABLE: ['基本稳定', 'Stable'], DECLINING: ['出现下降', 'Declining'],
      INSUFFICIENT_DATA: ['数据不足', 'Insufficient Data'], UNRESOLVED: ['尚未解析', 'Unresolved']
    };
    Object.keys(expected).forEach(function (trend) {
      assert.strictEqual(UI.trendLabel(trend, false), expected[trend][0]);
      assert.strictEqual(UI.trendLabel(trend, true), expected[trend][1]);
    });
  })();

  // ==================================================================
  // D-U05 — evidence count visible
  // ==================================================================
  (function () {
    var html = UI.renderProgressReassessmentHTML(baseModel(), false);
    assert.ok(html.indexOf('4') !== -1 && html.indexOf('证据数量') !== -1, 'evidence count rendered');
  })();

  // ==================================================================
  // D-U06 — insufficient-data / baseline-missing states
  // ==================================================================
  (function () {
    var html = UI.renderProgressReassessmentHTML(baseModel({ training_progress: { status: 'BASELINE_UNRESOLVED', baseline: null, current: null, delta: null, trend: 'UNRESOLVED', evidence_count: 0, source: 'TRAINING' } }), false);
    assert.ok(html.indexOf('基准值不可用，暂无法比较训练进步。') !== -1, 'baseline-missing wording present verbatim');
    var htmlEmpty = UI.renderProgressReassessmentHTML(baseModel({ cycle: null, training_progress: null, match_transfer: null }), false);
    assert.ok(htmlEmpty.indexOf('目前尚无可用的训练进步数据。') !== -1, 'no-progress empty state wording present verbatim');
  })();

  // ==================================================================
  // D-U07/D-U08 — Match Transfer is its own card, unresolved wording exact
  // ==================================================================
  (function () {
    var html = UI.renderProgressReassessmentHTML(baseModel(), false);
    var matchIdx = html.indexOf('比赛迁移'), trainingIdx = html.indexOf('训练进步');
    assert.ok(matchIdx !== -1 && trainingIdx !== -1 && matchIdx > trainingIdx, 'Match Transfer renders as its own section, after Training Progress');
    assert.ok(html.indexOf('比赛 KPI 证据尚不可用，比赛进步仍未解析。') !== -1, 'zh MATCH unresolved wording verbatim');
    var en = UI.renderProgressReassessmentHTML(baseModel(), true);
    assert.ok(en.indexOf('Match KPI evidence is not yet available. Match Progress remains unresolved.') !== -1, 'en MATCH unresolved wording verbatim');
    // Methodology wording only appears when TRAINING is IMPROVING and MATCH is unvalidated.
    assert.ok(html.indexOf('训练表现正在改善，但是否已经转化为真实比赛能力，仍需要真实比赛验证。') !== -1, 'match-transfer methodology wording present when training is improving');
    var stableModel = baseModel({ training_progress: Object.assign({}, baseModel().training_progress, { trend: 'STABLE' }) });
    var htmlStable = UI.renderProgressReassessmentHTML(stableModel, false);
    assert.strictEqual(htmlStable.indexOf('训练表现正在改善'), -1, 'methodology wording only shown for the IMPROVING+unvalidated scenario it describes');
  })();

  // ==================================================================
  // D-U09 — Ready for Reassessment banner, only when required
  // ==================================================================
  (function () {
    var required = UI.renderProgressReassessmentHTML(baseModel({ reassessment: { required: true, state: null } }), false);
    assert.ok(required.indexOf('已进入真实比赛复测阶段') !== -1, 'zh reassessment banner present');
    assert.ok(required.indexOf('出现新的训练证据，现在需要真实比赛验证。') !== -1, 'zh reassessment explanation present');
    var requiredEn = UI.renderProgressReassessmentHTML(baseModel({ reassessment: { required: true, state: null } }), true);
    assert.ok(requiredEn.indexOf('Ready for Match Reassessment') !== -1, 'en reassessment banner present');

    var notRequired = UI.renderProgressReassessmentHTML(baseModel({ reassessment: { required: false, state: null } }), false);
    assert.strictEqual(notRequired.indexOf('已进入真实比赛复测阶段'), -1, 'Section 28: banner never shown unless the authority says required');
    assert.ok(notRequired.indexOf('当前无需复测。') !== -1, 'neutral state shown instead');
  })();

  // ==================================================================
  // D-U10/D-U11 — CTA routing
  // ==================================================================
  (function () {
    assert.strictEqual(UI.routeForNextAction('RECORD_REAL_MATCH'), 'measure', 'D-U10 RECORD_REAL_MATCH routes to Measure (S11-D does not own Match Observation)');
    assert.strictEqual(UI.routeForNextAction('REVIEW_PROGRESS'), 'progress', 'D-U11 REVIEW_PROGRESS stays on the Progress page');
    assert.strictEqual(UI.routeForNextAction('REVIEW_REASSESSMENT'), 'progress');
    assert.strictEqual(UI.routeForNextAction('CONTINUE_TRAINING'), 'guided', 'training actions route into Guided Training');
  })();

  // ==================================================================
  // D-U12 — no fractional validated level / no promotion wording anywhere
  // ==================================================================
  (function () {
    var html = UI.renderProgressReassessmentHTML(baseModel({ training_progress: Object.assign({}, baseModel().training_progress, { current: 0.95 }) }), false);
    ['3.87', '4.12', 'validated_level', 'validated_training_level', '升级', 'PROMOTED', 'CERTIFIED'].forEach(function (needle) {
      assert.strictEqual(html.toUpperCase().indexOf(needle.toUpperCase()), -1, 'no fractional/promotion wording: ' + needle);
    });
  })();

  // ==================================================================
  // D-U13 — no training=match implication (match card never shows training's own numbers)
  // ==================================================================
  (function () {
    var html = UI.renderProgressReassessmentHTML(baseModel(), false); // training current=0.74 (74%), match unresolved
    var matchSection = html.slice(html.indexOf('比赛迁移'));
    assert.strictEqual(matchSection.indexOf('74%'), -1, 'training current value must never leak into the Match Transfer section');
  })();

  // ==================================================================
  // D-U14 — exactly one primary CTA
  // ==================================================================
  (function () {
    var cases = [
      baseModel(),
      baseModel({ cycle: null, training_progress: null, match_transfer: null }),
      baseModel({ reassessment: { required: true, state: null }, next_action: { code: 'RECORD_REAL_MATCH', enabled: true, target_ref: null } }),
      baseModel({ next_action: { code: 'NONE', enabled: false, target_ref: null } })
    ];
    cases.forEach(function (m, i) {
      var html = UI.renderProgressReassessmentHTML(m, false);
      var matches = html.match(/data-primary-cta="1"/g) || [];
      assert.strictEqual(matches.length, 1, 'case[' + i + '] must render exactly one primary CTA');
    });
  })();

  // ==================================================================
  // Determinism
  // ==================================================================
  (function () {
    var m = baseModel();
    assert.strictEqual(UI.renderProgressReassessmentHTML(m, false), UI.renderProgressReassessmentHTML(m, false));
  })();

  // ==================================================================
  // Architecture protection — thin UI layer, only PBProgressReassessmentAdapter
  // ==================================================================
  (function () {
    var forbidden = [
      'PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription',
      'PBWorkflow', 'PBPrescriptionWorkflow', 'PBSessionEvidence', 'PBSessionEvidencePersistence',
      'PBProgressTracking', 'PBCycleBaseline', 'PBReassessment', 'PBProductJourney',
      'PBStore.put', 'PBStore.create', '.transition(', 'require('
    ];
    forbidden.forEach(function (token) {
      assert.strictEqual(CODE_ONLY.indexOf(token), -1, 'progress-reassessment-ui.js must never reference ' + token);
    });
    assert.ok(CODE_ONLY.indexOf('PBProgressReassessmentAdapter') !== -1, 'the UI must delegate all data assembly to PBProgressReassessmentAdapter');
  })();

  // ==================================================================
  // CSS — reuses the established mobile-first primitives; no new breakpoint
  // ==================================================================
  (function () {
    var prBlock = CSS.slice(CSS.indexOf('S11-D'));
    assert.ok(prBlock.length > 0 && CSS.indexOf('S11-D') !== -1, 'S11-D CSS block must exist');
    assert.strictEqual(/@media/.test(prBlock), false, 'S11-D must not introduce a new responsive breakpoint');
  })();

  console.log('progress-reassessment-ui.test.js: all assertions passed');
}

run();
