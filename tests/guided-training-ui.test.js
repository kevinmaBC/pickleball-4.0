/* tests/guided-training-ui.test.js — S11-C: Guided Training UI
 * guided-training-ui.js has no jsdom in this repo's test conventions
 * (same as review-ui.js/training-ui.js/home-priority-dashboard-ui.js —
 * the DOM-mounting layer is verified via manual browser QA, not
 * automated tests). This suite covers the pure label/error/view-model
 * builders and the pure (state, en) -> HTML renderGuidedTrainingHTML
 * function, plus structural source checks proving the thin-UI boundary.
 * Run: node tests/guided-training-ui.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var UI = require('../js/guided-training-ui.js');
var SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'guided-training-ui.js'), 'utf8');
var CODE_ONLY = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
var CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'app.css'), 'utf8');

function run() {
  // ==================================================================
  // Bilingual core labels (Section 32)
  // ==================================================================
  (function () {
    var readyActivate = { mode: 'READY_TO_ACTIVATE', prescription_snapshot: {} };
    var zh = UI.renderGuidedTrainingHTML(readyActivate, false), en = UI.renderGuidedTrainingHTML(readyActivate, true);
    assert.ok(zh.indexOf('激活训练处方') !== -1, 'zh Activate Training label');
    assert.ok(en.indexOf('Activate Training') !== -1, 'en Activate Training label');

    var readyStart = { mode: 'READY_TO_START', prescription_snapshot: {} };
    assert.ok(UI.renderGuidedTrainingHTML(readyStart, false).indexOf('开始训练') !== -1, 'zh Start Training label');
    assert.ok(UI.renderGuidedTrainingHTML(readyStart, true).indexOf('Start Training') !== -1, 'en Start Training label');

    var active = { mode: 'ACTIVE_SESSION', session_execution: { training_objective_code: 'X', training_mode: 'Y', kpi_profile_code: 'Z' } };
    assert.ok(UI.renderGuidedTrainingHTML(active, false).indexOf('训练进行中') !== -1, 'zh Training in Progress label');
    assert.ok(UI.renderGuidedTrainingHTML(active, true).indexOf('Training in Progress') !== -1, 'en Training in Progress label');
    assert.ok(UI.renderGuidedTrainingHTML(active, false).indexOf('尝试次数') !== -1, 'zh Attempts label');
    assert.ok(UI.renderGuidedTrainingHTML(active, true).indexOf('Attempts') !== -1, 'en Attempts label');
    assert.ok(UI.renderGuidedTrainingHTML(active, false).indexOf('成功次数') !== -1, 'zh Successful Attempts label');
    assert.ok(UI.renderGuidedTrainingHTML(active, true).indexOf('Successful Attempts') !== -1, 'en Successful Attempts label');
    assert.ok(UI.renderGuidedTrainingHTML(active, false).indexOf('完成并保存') !== -1, 'zh Complete & Save label');
    assert.ok(UI.renderGuidedTrainingHTML(active, true).indexOf('Complete &amp; Save') !== -1, 'en Complete & Save label (HTML-escaped)');

    var completed = { mode: 'COMPLETED', evidence_recorded: true };
    assert.ok(UI.renderGuidedTrainingHTML(completed, false).indexOf('训练结果已保存') !== -1, 'zh Result Saved label');
    assert.ok(UI.renderGuidedTrainingHTML(completed, true).indexOf('Session Result Saved') !== -1, 'en Result Saved label');
    assert.ok(UI.renderGuidedTrainingHTML(completed, false).indexOf('已记录训练证据') !== -1, 'zh Evidence Recorded label');
    assert.ok(UI.renderGuidedTrainingHTML(completed, true).indexOf('TRAINING Evidence Recorded') !== -1, 'en Evidence Recorded label');
  })();

  // ==================================================================
  // UNRESOLVED drill wording (Section 17) — exact, never hidden/fabricated
  // ==================================================================
  (function () {
    var state = { mode: 'READY_TO_ACTIVATE', prescription_snapshot: { drill_resolution_status: 'UNRESOLVED', training_objective_code: 'SHOT_EXECUTION' } };
    var zh = UI.renderGuidedTrainingHTML(state, false), en = UI.renderGuidedTrainingHTML(state, true);
    assert.ok(zh.indexOf('训练方向已确定，具体 Drill 尚未解析。') !== -1, 'zh UNRESOLVED wording verbatim');
    assert.ok(en.indexOf('Training direction is available. Specific drill is not yet resolved.') !== -1, 'en UNRESOLVED wording verbatim');
    // Still allows Activate: the primary CTA is present and not disabled by this condition alone.
    assert.ok(zh.indexOf('data-act="activate"') !== -1, 'UNRESOLVED drill still allows Activate');
    assert.ok(zh.indexOf('SHOT_EXECUTION') !== -1, 'prescription is never hidden when UNRESOLVED');
  })();

  // ==================================================================
  // BENCHMARK_NOT_RESOLVED wording (Section 18) — exact, never invented
  // ==================================================================
  (function () {
    var state = { mode: 'READY_TO_START', prescription_snapshot: { kpi_target_status: 'BENCHMARK_NOT_RESOLVED' } };
    var zh = UI.renderGuidedTrainingHTML(state, false), en = UI.renderGuidedTrainingHTML(state, true);
    assert.ok(zh.indexOf('基准值尚未解析。') !== -1, 'zh BENCHMARK_NOT_RESOLVED wording verbatim');
    assert.ok(en.indexOf('Benchmark not yet resolved.') !== -1, 'en BENCHMARK_NOT_RESOLVED wording verbatim');
  })();

  // ==================================================================
  // Exactly one primary action per actionable Guided Training state
  // ==================================================================
  (function () {
    var cases = [
      { mode: 'READY_TO_ACTIVATE', prescription_snapshot: {} },
      { mode: 'READY_TO_START', prescription_snapshot: {} },
      { mode: 'ACTIVE_SESSION', session_execution: { training_objective_code: 'X', training_mode: 'Y', kpi_profile_code: 'Z' } },
      { mode: 'SESSION_LOST' },
      { mode: 'COMPLETED' }
    ];
    cases.forEach(function (state) {
      var html = UI.renderGuidedTrainingHTML(state, false);
      var matches = html.match(/data-primary-cta="1"/g) || [];
      assert.strictEqual(matches.length, 1, state.mode + ' must render exactly one primary action');
    });
  })();

  // ==================================================================
  // Attempts / Successful Attempts inputs + Complete & Save action
  // ==================================================================
  (function () {
    var state = { mode: 'ACTIVE_SESSION', session_execution: { training_objective_code: 'X', training_mode: 'Y', kpi_profile_code: 'Z' } };
    var html = UI.renderGuidedTrainingHTML(state, false);
    assert.ok(html.indexOf('id="gt-attempts"') !== -1, 'attempts input present');
    assert.ok(html.indexOf('id="gt-successful"') !== -1, 'successful attempts input present');
    assert.ok(html.indexOf('data-act="complete"') !== -1, 'Complete & Save action present');
    assert.strictEqual(html.indexOf('Session Status = ACTIVE'.toUpperCase()), -1); // no leaked literal placeholder text
  })();

  // ==================================================================
  // Stale error messaging
  // ==================================================================
  (function () {
    var e = { code: 'STALE_RECOMMENDATION' };
    var zh = UI.translateError(e, false), en = UI.translateError(e, true);
    assert.ok(zh.length > 0 && en.length > 0, 'stale error translated in both languages');
    assert.notStrictEqual(zh, en, 'zh/en messages differ');
    var unknown = UI.translateError({ code: 'SOME_UNKNOWN_CODE', message: 'raw stack trace at Object.<anonymous>' }, false);
    assert.strictEqual(unknown.indexOf('at Object'), -1, 'unknown errors fall back to a generic message, never leak raw error text');
  })();

  // ==================================================================
  // S11-D §22 — post-completion CTA driven by the refreshed Journey's own next_action,
  // never a locally-invented "Back to Home" when a real next action exists.
  // ==================================================================
  (function () {
    var withNext = { mode: 'COMPLETED', evidence_recorded: true, next_action: { code: 'REVIEW_PROGRESS', enabled: true, target_ref: null } };
    var zh = UI.renderGuidedTrainingHTML(withNext, false), en = UI.renderGuidedTrainingHTML(withNext, true);
    assert.ok(zh.indexOf('data-code="REVIEW_PROGRESS"') !== -1, 'CTA carries the refreshed next_action code');
    assert.ok(zh.indexOf('查看进步') !== -1, 'zh label for REVIEW_PROGRESS');
    assert.ok(en.indexOf('View Progress') !== -1, 'en label for REVIEW_PROGRESS');
    var matches = zh.match(/data-primary-cta="1"/g) || [];
    assert.strictEqual(matches.length, 1, 'still exactly one primary CTA when a next_action is supplied');

    var recordMatch = { mode: 'COMPLETED', evidence_recorded: true, next_action: { code: 'RECORD_REAL_MATCH', enabled: true, target_ref: null } };
    assert.ok(UI.renderGuidedTrainingHTML(recordMatch, false).indexOf('记录真实比赛') !== -1, 'zh label for RECORD_REAL_MATCH');

    var noNext = { mode: 'COMPLETED', evidence_recorded: true, next_action: null };
    assert.ok(UI.renderGuidedTrainingHTML(noNext, false).indexOf('data-act="back-home"') !== -1, 'falls back to Back to Home when no refreshed next_action is available');
  })();

  // ==================================================================
  // Active-session-lost wording (Section 28) — exact, never pretends recovery
  // ==================================================================
  (function () {
    var zh = UI.renderGuidedTrainingHTML({ mode: 'SESSION_LOST' }, false);
    var en = UI.renderGuidedTrainingHTML({ mode: 'SESSION_LOST' }, true);
    assert.ok(zh.indexOf('上一次进行中的训练未保留，无法直接恢复。') !== -1, 'zh session-lost wording verbatim');
    assert.ok(en.indexOf('The previous active training session was not preserved and cannot be resumed directly.') !== -1, 'en session-lost wording verbatim');
  })();

  // ==================================================================
  // buildTrainingDirectionViewModel — pure, verbatim, no recomputation
  // ==================================================================
  (function () {
    var vm = UI.buildTrainingDirectionViewModel({ training_objective_code: 'SHOT_EXECUTION', drill_resolution_status: 'UNRESOLVED', kpi_target_status: 'BENCHMARK_NOT_RESOLVED' });
    assert.strictEqual(vm.objective, 'SHOT_EXECUTION');
    assert.strictEqual(vm.drillUnresolved, true);
    assert.strictEqual(vm.benchmarkUnresolved, true);
    var resolved = UI.buildTrainingDirectionViewModel({ drill_resolution_status: 'RESOLVED', kpi_target_status: 'AT_TARGET' });
    assert.strictEqual(resolved.drillUnresolved, false);
    assert.strictEqual(resolved.benchmarkUnresolved, false);
  })();

  // ==================================================================
  // No local result_value formula / no validated-level promotion wording
  // ==================================================================
  (function () {
    assert.strictEqual(/successful_?attempts\s*\/\s*attempts/i.test(CODE_ONLY), false, 'must never compute a result_value ratio itself');
    assert.strictEqual(/result_value\s*=/.test(CODE_ONLY), false, 'must never assign result_value itself');
    ['你现在是', 'validated_training_level', 'validated level', '4.0认证', 'match transfer confirmed', 'CERTIFIED'].forEach(function (phrase) {
      assert.strictEqual(CODE_ONLY.toLowerCase().indexOf(phrase.toLowerCase()), -1, 'must never claim a validated-level promotion / match-transfer confirmation: ' + phrase);
    });
  })();

  // ==================================================================
  // Determinism
  // ==================================================================
  (function () {
    var state = { mode: 'READY_TO_ACTIVATE', prescription_snapshot: { training_objective_code: 'X' } };
    assert.strictEqual(UI.renderGuidedTrainingHTML(state, false), UI.renderGuidedTrainingHTML(state, false));
  })();

  // ==================================================================
  // Architecture protection — thin UI layer, only PBGuidedTrainingController
  // ==================================================================
  (function () {
    var forbidden = [
      'PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription',
      'PBPrescriptionWorkflow', 'PBSessionEvidence', 'PBSessionEvidencePersistence',
      'PBWorkflow', 'PBProductJourney', 'PBStore.put', 'PBStore.create', '.transition(', 'require('
    ];
    forbidden.forEach(function (token) {
      assert.strictEqual(CODE_ONLY.indexOf(token), -1, 'guided-training-ui.js must never reference ' + token);
    });
    assert.ok(CODE_ONLY.indexOf('PBGuidedTrainingController') !== -1, 'the UI must delegate all mutation/orchestration to PBGuidedTrainingController');
  })();

  // ==================================================================
  // CSS — full-width, large-touch-target primary CTA (mobile-first baseline);
  // no new responsive breakpoint introduced
  // ==================================================================
  (function () {
    var ctaRuleMatch = /\.gt-cta\{([^}]*)\}/.exec(CSS);
    assert.ok(ctaRuleMatch, '.gt-cta rule must exist in css/app.css');
    var gtBlock = CSS.slice(CSS.indexOf('S11-C'));
    assert.strictEqual(/@media/.test(gtBlock), false, 'S11-C must not introduce a new responsive breakpoint');
  })();

  console.log('guided-training-ui.test.js: all assertions passed');
}

run();
