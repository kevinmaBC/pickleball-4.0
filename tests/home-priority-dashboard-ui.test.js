/* tests/home-priority-dashboard-ui.test.js — S11-B: Home / Priority
 * Dashboard UI
 * home-priority-dashboard-ui.js has no jsdom in this repo's test
 * conventions (same as review-ui.js/training-ui.js — the DOM-mounting
 * layer is verified via manual browser QA, not automated tests). This
 * suite covers the pure label/route/message builders and the pure
 * (data, en) -> HTML renderHomePanelHTML function, plus structural
 * source checks proving the thin-UI boundary.
 * Run: node tests/home-priority-dashboard-ui.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var UI = require('../js/home-priority-dashboard-ui.js');
var SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'home-priority-dashboard-ui.js'), 'utf8');
var CODE_ONLY = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
var CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'app.css'), 'utf8');

function baseModel(overrides) {
  return Object.assign({
    player_id: 'p1',
    journey: { stage: 'NEEDS_ASSESSMENT', status: 'READY', headline_code: 'NO_ACTIVE_CYCLE' },
    focus: null, why: null, training: null,
    next_action: { code: 'START_ASSESSMENT', enabled: true, target_ref: null },
    flags: [], schema_version: '1.0', view_version: 'S11-B-V1'
  }, overrides || {});
}

function run() {
  // ==================================================================
  // Bilingual stage labels (Section 10 — frozen core mapping, all 7 stages)
  // ==================================================================
  (function () {
    var expected = {
      NEEDS_ASSESSMENT: ['需要评估', 'Assessment Needed'],
      REVIEW_RECOMMENDATION: ['查看训练重点', 'Review Focus'],
      READY_TO_TRAIN: ['可以开始训练', 'Ready to Train'],
      TRAINING_IN_PROGRESS: ['训练进行中', 'Training in Progress'],
      REVIEW_PROGRESS: ['查看训练进步', 'Review Progress'],
      READY_TO_REASSESS: ['需要比赛复测', 'Match Reassessment Required'],
      CYCLE_COMPLETE: ['本周期完成', 'Cycle Complete']
    };
    Object.keys(expected).forEach(function (stage) {
      assert.strictEqual(UI.stageLabel(stage, false), expected[stage][0], stage + ' zh label');
      assert.strictEqual(UI.stageLabel(stage, true), expected[stage][1], stage + ' en label');
    });
    assert.strictEqual(UI.stageLabel('SOME_UNKNOWN_STAGE', true), 'SOME_UNKNOWN_STAGE', 'unknown stage falls back to raw code, never invented text');
  })();

  // ==================================================================
  // CTA route table — every real next_action routes to an existing view; NONE routes nowhere
  // ==================================================================
  (function () {
    var known = ['START_ASSESSMENT', 'REVIEW_RECOMMENDATION', 'ACTIVATE_PRESCRIPTION', 'START_TRAINING', 'CONTINUE_TRAINING', 'RESUME_SESSION', 'REVIEW_PROGRESS', 'RECORD_REAL_MATCH', 'REVIEW_REASSESSMENT', 'START_NEXT_CYCLE'];
    // 'guided' (S11-C) / 'progress' (S11-D) added alongside the pre-existing bottom-nav-tab views.
    var existingViews = ['home', 'learn', 'drill', 'measure', 'review', 'compete', 'team', 'guided', 'progress'];
    known.forEach(function (code) {
      var route = UI.routeForNextAction(code);
      assert.ok(existingViews.indexOf(route) !== -1, code + ' must route to an existing app view (got ' + route + ')');
    });
    assert.strictEqual(UI.routeForNextAction('NONE'), null, 'NONE routes nowhere');
    // S11-C: these four route into the Guided Training Action Flow, never the old S8 `drill` flow.
    ['ACTIVATE_PRESCRIPTION', 'START_TRAINING', 'CONTINUE_TRAINING', 'RESUME_SESSION'].forEach(function (code) {
      assert.strictEqual(UI.routeForNextAction(code), 'guided', code + ' routes into S11-C Guided Training');
    });
    // S11-D: REVIEW_PROGRESS/REVIEW_REASSESSMENT route into the Progress/Reassessment Experience;
    // RECORD_REAL_MATCH keeps routing to Measure (S11-D does not own Match Observation).
    assert.strictEqual(UI.routeForNextAction('REVIEW_PROGRESS'), 'progress');
    assert.strictEqual(UI.routeForNextAction('REVIEW_REASSESSMENT'), 'progress');
    assert.strictEqual(UI.routeForNextAction('RECORD_REAL_MATCH'), 'measure');
  })();

  // ==================================================================
  // Exactly one primary CTA + disabled handling
  // ==================================================================
  (function () {
    var html = UI.renderHomePanelHTML(baseModel({ next_action: { code: 'START_ASSESSMENT', enabled: true, target_ref: null } }), false);
    var matches = html.match(/data-primary-cta="1"/g) || [];
    assert.strictEqual(matches.length, 1, 'exactly one primary CTA element must render');
    assert.strictEqual(/disabled/.test(html), false, 'enabled CTA must not render the disabled attribute');
  })();
  (function () {
    var html = UI.renderHomePanelHTML(baseModel({ next_action: { code: 'ACTIVATE_PRESCRIPTION', enabled: false, target_ref: null } }), false);
    assert.ok(/data-act="cta"[^>]*disabled/.test(html), 'disabled next_action.enabled=false must render a disabled CTA button');
    var matches = html.match(/data-primary-cta="1"/g) || [];
    assert.strictEqual(matches.length, 1, 'still exactly one primary CTA element when disabled');
  })();

  // ==================================================================
  // UNRESOLVED drill message — exact bilingual wording (Section 14), never hidden/fabricated/FAILED
  // ==================================================================
  (function () {
    var m = baseModel({ training: { prescription_ref: 'rx_1', objective: 'SHOT_EXECUTION', mode: 'TECHNICAL_REPETITION', drill_family: 'SHOT_EXECUTION', kpi_profile: 'EXECUTION_SUCCESS_RATE', drill_resolution_status: 'UNRESOLVED', kpi_target_status: 'BENCHMARK_NOT_RESOLVED' } });
    var zh = UI.renderHomePanelHTML(m, false), en = UI.renderHomePanelHTML(m, true);
    assert.ok(zh.indexOf('训练方向已确定，具体 Drill 尚未解析。') !== -1, 'zh UNRESOLVED message present verbatim');
    assert.ok(en.indexOf('Training direction is available. Specific drill is not yet resolved.') !== -1, 'en UNRESOLVED message present verbatim');
    assert.strictEqual(zh.indexOf('FAILED'), -1, 'UNRESOLVED must never render as FAILED');
    assert.ok(zh.indexOf('SHOT_EXECUTION') !== -1, 'the prescription is never hidden when UNRESOLVED');
  })();

  // ==================================================================
  // Reassessment warning + MATCH transfer methodology wording (Sections 18/19)
  // ==================================================================
  (function () {
    var m = baseModel({ journey: { stage: 'READY_TO_REASSESS', status: 'READY', headline_code: 'REASSESSMENT_READY' }, next_action: { code: 'RECORD_REAL_MATCH', enabled: true, target_ref: null }, flags: ['REASSESSMENT_REQUIRED', 'STALE_RECOMMENDATION', 'STALE_PRESCRIPTION'] });
    var zh = UI.renderHomePanelHTML(m, false), en = UI.renderHomePanelHTML(m, true);
    assert.ok(zh.indexOf('需要比赛复测') !== -1, 'zh reassessment banner present');
    assert.ok(en.indexOf('Match Reassessment Required') !== -1, 'en reassessment banner present');
    assert.ok(zh.indexOf('训练进步尚不能等同于比赛能力提升，需要真实比赛验证。') !== -1, 'zh match-transfer methodology wording present verbatim');
    assert.ok(en.indexOf('Training progress does not yet confirm match transfer. A real match reassessment is required.') !== -1, 'en match-transfer methodology wording present verbatim');
    assert.strictEqual(zh.indexOf('data-code="START_TRAINING"'), -1, 'Start Training must never be the primary CTA during reassessment');
    assert.ok(zh.indexOf('data-code="RECORD_REAL_MATCH"') !== -1, 'primary CTA is RECORD_REAL_MATCH');
  })();

  // ==================================================================
  // MATCH transfer "not yet validated" wording (Section 20) — never a fabricated number
  // ==================================================================
  (function () {
    var m = baseModel({ flags: ['MATCH_TRANSFER_NOT_VALIDATED'] });
    var zh = UI.renderHomePanelHTML(m, false), en = UI.renderHomePanelHTML(m, true);
    assert.ok(zh.indexOf('比赛迁移：尚未验证') !== -1, 'zh match transfer unvalidated wording present verbatim');
    assert.ok(en.indexOf('Match Transfer: Not yet validated') !== -1, 'en match transfer unvalidated wording present verbatim');
  })();

  // ==================================================================
  // New-player empty state (Section 21) — honest, never "everything is fine"
  // ==================================================================
  (function () {
    var zh = UI.renderHomePanelHTML(baseModel(), false), en = UI.renderHomePanelHTML(baseModel(), true);
    assert.ok(zh.indexOf('需要评估') !== -1, 'zh Journey: Assessment Needed');
    assert.ok(en.indexOf('Assessment Needed') !== -1, 'en Journey: Assessment Needed');
    assert.ok(zh.indexOf('暂无数据') !== -1, 'zh Current Focus: not available yet');
    assert.ok(en.indexOf('Not available yet') !== -1, 'en Current Focus: not available yet');
    assert.strictEqual(zh.indexOf('一切正常'), -1, 'must never claim "everything is fine"');
    assert.ok(zh.indexOf('data-code="START_ASSESSMENT"') !== -1, 'primary CTA is Start Assessment');
  })();

  // ==================================================================
  // Zero-player empty state — renders the same frozen "Start Assessment" default
  // (Section 21), never a bare dead end
  // ==================================================================
  (function () {
    assert.strictEqual(UI.NO_PLAYER_HOME_DASHBOARD.journey.stage, 'NEEDS_ASSESSMENT');
    assert.strictEqual(UI.NO_PLAYER_HOME_DASHBOARD.next_action.code, 'START_ASSESSMENT');
    assert.strictEqual(UI.NO_PLAYER_HOME_DASHBOARD.next_action.enabled, true);
    var html = UI.renderHomePanelHTML(UI.NO_PLAYER_HOME_DASHBOARD, false);
    assert.ok(html.indexOf('data-code="START_ASSESSMENT"') !== -1);
  })();

  // ==================================================================
  // POST-S11-R3B-2 — assessment with recorded evidence must never render "No traceability data
  // yet" as if no assessment exists; it renders honest assessment-evidence copy instead.
  // ==================================================================
  (function () {
    var m = baseModel({ assessment: { player_id: 'p1', assessment_id: 'asm_1', assessment_status: 'ASSESSMENT_IN_PROGRESS', assessment_exists: true, evidence_status: 'PARTIAL', traceability_available: true, recommendation_eligible: false } });
    var zh = UI.renderHomePanelHTML(m, false), en = UI.renderHomePanelHTML(m, true);
    assert.strictEqual(en.indexOf('No traceability data yet'), -1, 'must not report no-traceability when an assessment with evidence exists');
    assert.strictEqual(zh.indexOf('暂无可追溯依据'), -1, 'zh: must not report no-traceability when an assessment with evidence exists');
    assert.ok(en.indexOf('Assessment evidence recorded (PARTIAL)') !== -1, 'en honest partial-evidence copy present');
    assert.ok(en.indexOf('Assessment Evidence') !== -1, 'en Assessment Evidence section present');
    assert.ok(en.indexOf('Not yet') !== -1, 'en recommendation_eligible=false renders "Not yet"');
  })();
  // No assessment at all -> original "No traceability data yet" copy is preserved verbatim.
  (function () {
    var html = UI.renderHomePanelHTML(baseModel(), true);
    assert.ok(html.indexOf('No traceability data yet') !== -1, 'original copy preserved when there is no assessment_context at all');
  })();

  // ==================================================================
  // Determinism — same input twice -> identical HTML
  // ==================================================================
  (function () {
    var m = baseModel({ focus: { recommendation_id: 'rec_1', rank: 1, priority_tier: 'HIGH', skill: 'drop', context: null, recommendation_code: 'IMPROVE_SHOT_EXECUTION' } });
    assert.strictEqual(UI.renderHomePanelHTML(m, false), UI.renderHomePanelHTML(m, false));
  })();

  // ==================================================================
  // Architecture protection — thin UI layer, no engine calls, only the adapter
  // ==================================================================
  (function () {
    var forbidden = [
      'PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription', 'PBWorkflow',
      'PBPrescriptionWorkflow', 'PBDashboard', 'PBProductJourney', 'PBProgressTracking',
      'PBReassessment', 'PBStore.put', 'PBStore.create', '.transition(', 'require('
    ];
    forbidden.forEach(function (token) {
      assert.strictEqual(CODE_ONLY.indexOf(token), -1, 'home-priority-dashboard-ui.js must never reference ' + token);
    });
    assert.ok(CODE_ONLY.indexOf('PBHomeDashboardAdapter.loadHomeDashboard') !== -1, 'the UI must delegate all data assembly to PBHomeDashboardAdapter');
  })();

  // ==================================================================
  // CSS — full-width, large-touch-target primary CTA (mobile-first baseline, Section 26);
  // no new responsive breakpoint introduced (matches the app-wide convention)
  // ==================================================================
  (function () {
    var ctaRuleMatch = /\.hpd-cta\{([^}]*)\}/.exec(CSS);
    assert.ok(ctaRuleMatch, '.hpd-cta rule must exist in css/app.css');
    assert.ok(/width:\s*100%/.test(ctaRuleMatch[1]), 'primary CTA must be full-width');
    var paddingMatch = /padding:\s*(\d+)px/.exec(ctaRuleMatch[1]);
    assert.ok(paddingMatch && Number(paddingMatch[1]) >= 12, 'primary CTA must have a large touch-target padding');
    var hpdBlock = CSS.slice(CSS.indexOf('S11-B'));
    assert.strictEqual(/@media/.test(hpdBlock), false, 'S11-B must not introduce a new responsive breakpoint');
  })();

  console.log('home-priority-dashboard-ui.test.js: all assertions passed');
}

run();
