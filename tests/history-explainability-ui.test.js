/* tests/history-explainability-ui.test.js — S11-E: History /
 * Explainability / Recovery UI
 * history-explainability-ui.js has no jsdom in this repo's test
 * conventions (same as the other *-ui.js modules — the DOM-mounting
 * layer is verified via manual browser QA, not automated tests). This
 * suite covers the pure label/format builders and the pure
 * (model, opts) -> HTML renderHistoryExplainabilityHTML function, plus
 * structural source checks proving the thin-UI boundary.
 * Run: node tests/history-explainability-ui.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var UI = require('../js/history-explainability-ui.js');
var SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'history-explainability-ui.js'), 'utf8');
var CODE_ONLY = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
var CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'app.css'), 'utf8');

function timelineEvent(overrides) {
  return Object.assign({ type: 'CYCLE_CREATED', occurred_at: '2026-01-01T00:00:00.000Z', time_status: 'KNOWN', ref: 'cyc_1', detail: {} }, overrides || {});
}
function cycleView(overrides) {
  return Object.assign({
    cycle_id: 'cyc_1', state: 'PROGRESS_RECORDED', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-05T00:00:00.000Z', is_current: true,
    timeline: [
      timelineEvent({ type: 'CYCLE_CREATED', occurred_at: '2026-01-01T00:00:00.000Z' }),
      timelineEvent({ type: 'SESSION_COMPLETED', occurred_at: '2026-01-04T00:00:00.000Z', ref: 'sint_1' })
    ],
    workflow_summary: {
      workflow_id: 'pwf_1', workflow_state: 'IN_PROGRESS', recommendation_ref: 'rec_1', priority_rank: 1, priority_tier: 'HIGH',
      training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION', kpi_profile_code: 'EXECUTION_SUCCESS_RATE',
      drill_resolution_status: 'RESOLVED', kpi_target_status: 'AT_TARGET'
    },
    evidence_lineage: [{ session_result_id: 'sint_1', prescription_ref: 'rx_1', recommendation_ref: 'rec_1', attempts: 20, successful_attempts: 15, result_value: 0.75, evidence_id: 'ev_1', kpi_profile_code: 'EXECUTION_SUCCESS_RATE', source: 'TRAINING' }],
    progress_summary: { status: 'RESOLVED', baseline: 0.62, current: 0.75, delta: 0.13, trend: 'IMPROVING', evidence_count: 1, authority: 'S10-E' },
    reassessment_summary: { required: false, state: null }
  }, overrides || {});
}
function baseVM(overrides) {
  return Object.assign({
    player_id: 'p1',
    cycles: [cycleView()],
    current_explanation: { workflow_id: 'pwf_1', recommendation_ref: 'rec_1' },
    recovery: { status: 'PARTIAL', recoverable: ['DEVELOPMENT_CYCLE', 'PRESCRIPTION_WORKFLOW', 'SESSION_RESULTS', 'TRAINING_EVIDENCE', 'BASELINE', 'REASSESSMENT'], unrecoverable: ['ACTIVE_SESSION_EXECUTION', 'FULL_S9_RECOMMENDATION_DETAIL', 'MATCH_KPI_EVIDENCE'], flags: ['MATCH_PROGRESS_UNRESOLVED'] },
    integrity_flags: [],
    schema_version: '1.0', view_version: 'S11-E-V1'
  }, overrides || {});
}

function run() {
  // ==================================================================
  // E-U01 — bilingual History labels
  // ==================================================================
  (function () {
    var zh = UI.renderHistoryExplainabilityHTML(baseVM(), { en: false }), en = UI.renderHistoryExplainabilityHTML(baseVM(), { en: true });
    assert.ok(zh.indexOf('发展时间线') !== -1 && zh.indexOf('证据链') !== -1 && zh.indexOf('恢复状态') !== -1, 'zh core section labels present');
    assert.ok(en.indexOf('Development Timeline') !== -1 && en.indexOf('Evidence Lineage') !== -1 && en.indexOf('Recovery Status') !== -1, 'en core section labels present');
    assert.strictEqual(UI.coreLabel('history', false), '历史');
    assert.strictEqual(UI.coreLabel('history', true), 'History');
  })();

  // ==================================================================
  // E-U02 — cycle list renders
  // ==================================================================
  (function () {
    var html = UI.renderHistoryExplainabilityHTML(baseVM(), { en: false });
    assert.ok(html.indexOf('data-act="pick-cycle"') !== -1, 'cycle chip renders');
    assert.ok(html.indexOf('data-cid="cyc_1"') !== -1);
  })();

  // ==================================================================
  // E-U03/E-U04 — timeline chronological order + current cycle identified
  // ==================================================================
  (function () {
    var vm = baseVM({ cycles: [cycleView({ cycle_id: 'cyc_1', is_current: true }), cycleView({ cycle_id: 'cyc_0', is_current: false, updated_at: '2025-12-01T00:00:00.000Z' })] });
    var html = UI.renderHistoryExplainabilityHTML(vm, { en: false, selectedCycleId: 'cyc_1' });
    var createdIdx = html.indexOf('周期创建'), completedIdx = html.indexOf('训练完成');
    assert.ok(createdIdx !== -1 && completedIdx !== -1 && createdIdx < completedIdx, 'E-U03 CYCLE_CREATED renders before SESSION_COMPLETED (chronological)');
    assert.ok(html.indexOf('当前周期') !== -1, 'E-U04 current cycle marker present');
    assert.ok(html.indexOf('历史周期') !== -1, 'historical cycle marker present for the non-current one');
  })();

  // ==================================================================
  // E-U05 — Why This Training renders from the persisted snapshot
  // ==================================================================
  (function () {
    var html = UI.renderHistoryExplainabilityHTML(baseVM(), { en: false });
    assert.ok(html.indexOf('rec_1') !== -1, 'recommendation_ref traceable');
    assert.ok(html.indexOf('#1') !== -1 && html.indexOf('HIGH') !== -1, 'priority traceable');
    assert.ok(html.indexOf('SHOT_EXECUTION') !== -1, 'training objective traceable');
    assert.ok(html.indexOf('已持久保存的处方流程快照') !== -1, 'source attribution present (Persisted Prescription Workflow Snapshot)');
    assert.ok(html.indexOf('未持久保存') !== -1 || html.indexOf('详细的推荐说明') !== -1, 'S9 detail limitation stated honestly, not fabricated');
  })();

  // ==================================================================
  // E-U06 — Evidence lineage renders
  // ==================================================================
  (function () {
    var html = UI.renderHistoryExplainabilityHTML(baseVM(), { en: false });
    assert.ok(html.indexOf('75%') !== -1, 'evidence lineage result rendered');
  })();

  // ==================================================================
  // E-U07 — Recovery Status renders
  // ==================================================================
  (function () {
    var html = UI.renderHistoryExplainabilityHTML(baseVM(), { en: false });
    assert.ok(html.indexOf('可部分恢复') !== -1, 'PARTIAL recovery status label present');
    var htmlEn = UI.renderHistoryExplainabilityHTML(baseVM(), { en: true });
    assert.ok(htmlEn.indexOf('Partially Recoverable') !== -1);
  })();

  // ==================================================================
  // E-U08 — active-session limitation visible
  // ==================================================================
  (function () {
    var vm = baseVM({ recovery: Object.assign({}, baseVM().recovery, { flags: ['ACTIVE_SESSION_NOT_DURABLE'] }) });
    var zh = UI.renderHistoryExplainabilityHTML(vm, { en: false }), en = UI.renderHistoryExplainabilityHTML(vm, { en: true });
    assert.ok(zh.indexOf('上一次进行中的训练未保留，无法直接恢复。') !== -1, 'zh active-session wording verbatim');
    assert.ok(en.indexOf('The previous active training session was not preserved and cannot be resumed directly.') !== -1);
  })();

  // ==================================================================
  // E-U09 — S9-detail limitation visible
  // ==================================================================
  (function () {
    var vm = baseVM({ recovery: Object.assign({}, baseVM().recovery, { flags: ['S9_DETAIL_NOT_DURABLE'] }) });
    var html = UI.renderHistoryExplainabilityHTML(vm, { en: false });
    assert.ok(html.indexOf('详细的推荐说明未持久保存') !== -1, 'S9 detail limitation stated in Recovery section too');
  })();

  // ==================================================================
  // E-U10 — MATCH limitation visible
  // ==================================================================
  (function () {
    var html = UI.renderHistoryExplainabilityHTML(baseVM(), { en: false }); // default fixture already includes MATCH_PROGRESS_UNRESOLVED
    assert.ok(html.indexOf('比赛进步') !== -1 && (html.indexOf('数据不足') !== -1 || html.indexOf('尚不可用') !== -1), 'MATCH limitation shown honestly, never fabricated');
  })();

  // ==================================================================
  // E-U11 — integrity warning renders
  // ==================================================================
  (function () {
    var vm = baseVM({ integrity_flags: ['ORPHAN_WORKFLOW_REF'] });
    var html = UI.renderHistoryExplainabilityHTML(vm, { en: false });
    assert.ok(html.indexOf('数据一致性警告') !== -1, 'integrity warning banner present');
    var noneVm = baseVM({ integrity_flags: [] });
    var noneHtml = UI.renderHistoryExplainabilityHTML(noneVm, { en: false });
    assert.strictEqual(noneHtml.indexOf('hpd-banner hpd-warn'), -1, 'no warning banner when no integrity issues exist');
  })();

  // ==================================================================
  // E-U12 — no invented free-form causal explanation
  // ==================================================================
  (function () {
    var html = UI.renderHistoryExplainabilityHTML(baseVM(), { en: false });
    ['因为你', '建议你', 'BECAUSE YOU', 'YOU SHOULD', '你的弱点是'].forEach(function (phrase) {
      assert.strictEqual(html.toUpperCase().indexOf(phrase.toUpperCase()), -1, 'no free-form causal explanation: ' + phrase);
    });
  })();

  // ==================================================================
  // E-U14 — raw machine codes traceable in detail mode
  // ==================================================================
  (function () {
    var simple = UI.renderHistoryExplainabilityHTML(baseVM(), { en: false, detailMode: false });
    var detail = UI.renderHistoryExplainabilityHTML(baseVM(), { en: false, detailMode: true });
    assert.strictEqual(simple.indexOf('pwf_1'), -1, 'simple mode hides raw ids');
    assert.ok(detail.indexOf('pwf_1') !== -1, 'detail mode exposes workflow_id');
    assert.ok(detail.indexOf('ev_1') !== -1, 'detail mode exposes evidence_id');
    assert.ok(detail.indexOf('CYCLE_CREATED') !== -1, 'detail mode exposes the raw machine event type');
  })();

  // ==================================================================
  // Empty state
  // ==================================================================
  (function () {
    var html = UI.renderHistoryExplainabilityHTML(baseVM({ cycles: [] }), { en: false });
    assert.ok(html.indexOf('目前尚无可用的发展周期。') !== -1, 'honest empty state, never fabricated');
  })();

  // ==================================================================
  // Determinism
  // ==================================================================
  (function () {
    var vm = baseVM();
    assert.strictEqual(UI.renderHistoryExplainabilityHTML(vm, { en: false }), UI.renderHistoryExplainabilityHTML(vm, { en: false }));
  })();

  // ==================================================================
  // History is secondary navigation only — never a primary CTA, never journey.next_action
  // ==================================================================
  (function () {
    var html = UI.renderHistoryExplainabilityHTML(baseVM(), { en: false });
    assert.strictEqual(html.indexOf('data-primary-cta'), -1, 'History never renders a primary CTA / journey.next_action');
  })();

  // ==================================================================
  // Architecture protection — thin UI layer, only PBHistoryExplainabilityAdapter
  // ==================================================================
  (function () {
    var forbidden = [
      'PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription',
      'PBWorkflow', 'PBPrescriptionWorkflow', 'PBSessionEvidence', 'PBSessionEvidencePersistence',
      'PBProgressTracking', 'PBCycleBaseline', 'PBReassessment', 'PBProductJourney',
      'PBStore.put', 'PBStore.create', '.transition(', 'require('
    ];
    forbidden.forEach(function (token) {
      assert.strictEqual(CODE_ONLY.indexOf(token), -1, 'history-explainability-ui.js must never reference ' + token);
    });
    assert.ok(CODE_ONLY.indexOf('PBHistoryExplainabilityAdapter') !== -1, 'the UI must delegate all data assembly to PBHistoryExplainabilityAdapter');
  })();

  // ==================================================================
  // E-U13 — CSS reuses established mobile-first primitives; no new breakpoint
  // ==================================================================
  (function () {
    var heBlock = CSS.slice(CSS.indexOf('S11-E'));
    assert.ok(heBlock.length > 0 && CSS.indexOf('S11-E') !== -1, 'S11-E CSS block must exist');
    assert.strictEqual(/@media/.test(heBlock), false, 'S11-E must not introduce a new responsive breakpoint');
  })();

  console.log('history-explainability-ui.test.js: all assertions passed');
}

run();
