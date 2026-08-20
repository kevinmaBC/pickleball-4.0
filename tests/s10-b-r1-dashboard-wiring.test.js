/* tests/s10-b-r1-dashboard-wiring.test.js — S10-B-R1: Minimal UI Wiring
 * Rework
 *
 * Proves the S10-B Dashboard View Model (PBDashboard) is actually wired
 * into a user-visible surface (js/review-ui.js Section 7), not just
 * unit-tested in isolation. Covers the 14 items required by the S10-B-R1
 * package: script-chain loading, mount presence, rendered content for
 * ranked/unresolved/reassessment/empty states, the "no formula in the
 * UI" structural guarantee, and that the directly-relevant regression
 * suites stay green.
 *
 * Run: node tests/s10-b-r1-dashboard-wiring.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
var UI_SRC = fs.readFileSync(path.join(ROOT, 'js', 'review-ui.js'), 'utf8');
var UI_CODE_ONLY = UI_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

delete require.cache[require.resolve('../js/review-ui.js')];
var UI = require('../js/review-ui.js');
delete require.cache[require.resolve('../js/dashboard-integration-engine.js')];
var DB = require('../js/dashboard-integration-engine.js');

function extractScripts(html) {
  var scripts = [], re = /<script src="\.\/js\/([^"]+)"><\/script>/g, m;
  while ((m = re.exec(html))) scripts.push(m[1]);
  return scripts;
}

// ================================================================
// 1. dashboard module is loaded in browser script chain
// ================================================================
(function () {
  var scripts = extractScripts(HTML);
  assert.ok(scripts.indexOf('dashboard-integration-engine.js') !== -1, 'dashboard-integration-engine.js must be in index.html\'s script chain');
  // dependency order: everything the adapter's data feeds off of loads before review-ui.js consumes it
  var order = ['match-observation-engine.js', 'performance-analysis-engine.js', 'diagnosis-engine.js', 'recommendation-priority-engine.js', 'training-prescription-engine.js', 'dashboard-integration-engine.js', 'review-ui.js'];
  var indices = order.map(function (name) { return scripts.indexOf(name); });
  indices.forEach(function (idx, i) {
    assert.ok(idx !== -1, order[i] + ' must be present in the script chain');
    if (i > 0) assert.ok(indices[i - 1] < idx, order[i - 1] + ' must load before ' + order[i]);
  });
  // service worker CORE cache must not leave the new scripts unavailable offline
  order.slice(0, -1).forEach(function (name) {
    assert.ok(SW.indexOf("'./js/" + name + "'") !== -1, 'sw.js CORE must list ./js/' + name);
  });
})();

// ================================================================
// 2. dashboard UI mount exists
// ================================================================
(function () {
  assert.ok(/ROOT_ID = 'review-app'/.test(UI_SRC), 'review-ui.js mounts onto the existing #review-app root');
  assert.ok(/renderSection7/.test(UI_SRC), 'a Section 7 renderer exists in review-ui.js');
  assert.ok(/renderSection7\(model\)/.test(UI_CODE_ONLY.match(/function renderModelHTML[\s\S]*?\n  \}/)[0]), 'renderModelHTML actually calls renderSection7');
})();

function rec(overrides) {
  return Object.assign({
    recommendation_id: 'rec_1', match_id: 'm1', player_id: 'p1',
    skill: 'drop', context: null, recommendation_code: 'IMPROVE_SHOT_EXECUTION',
    source_skill_gap_ids: ['gap_1'], rank: 1, priority_score: 74, priority_tier: 'HIGH', status: 'recommended'
  }, overrides || {});
}
function rx(overrides) {
  return Object.assign({
    prescription_id: 'rx_1', training_objective_code: 'SHOT_EXECUTION', training_mode: 'TECHNICAL_REPETITION',
    drill_family_code: 'SHOT_EXECUTION', kpi_profile_code: 'EXECUTION_SUCCESS_RATE', dosage_profile_code: 'PRIMARY_FOCUS',
    kpi_target_value: null, kpi_target_status: 'BENCHMARK_NOT_RESOLVED',
    resolved_drill_ids: [], drill_resolution_status: 'UNRESOLVED', status: 'prescribed'
  }, overrides || {});
}

// ================================================================
// 3/4. ranked recommendation renders rank/tier/skill, values come from the View Model
// ================================================================
(function () {
  var item = DB.projectRecommendation({ recommendation: rec({ rank: 3, priority_tier: 'MEDIUM', skill: 'reset' }), prescription: rx() }).dashboard_item;
  var html = UI.dashboardItemCard(item);
  assert.ok(html.indexOf('#3') !== -1, 'rank #3 from the View Model appears verbatim');
  assert.ok(html.indexOf('MEDIUM') !== -1, 'priority_tier MEDIUM from the View Model appears verbatim');
  assert.ok(html.indexOf('reset') !== -1, 'skill from the View Model appears verbatim');
  assert.ok(html.indexOf('IMPROVE_SHOT_EXECUTION') !== -1, 'recommendation_code from the View Model appears verbatim');
})();

// unresolved rank never rendered as 0/999
(function () {
  var item = DB.projectRecommendation({ recommendation: rec({ rank: null }) }).dashboard_item;
  var html = UI.dashboardItemCard(item);
  assert.ok(html.indexOf('#0') === -1 && html.indexOf('#999') === -1, 'unresolved rank is never displayed as 0 or 999');
  assert.ok(/Rank unresolved|排名未定/.test(html), 'unresolved rank is stated honestly');
})();

// ================================================================
// 5. unresolved drill semantics render correctly
// ================================================================
(function () {
  var item = DB.projectRecommendation({ recommendation: rec(), prescription: rx({ drill_resolution_status: 'UNRESOLVED' }) }).dashboard_item;
  var html = UI.dashboardItemCard(item);
  assert.ok(/Specific drill not yet resolved|具体训练项尚未确定/.test(html), 'human-readable unresolved-drill wording present');
  assert.ok(html.indexOf('UNRESOLVED') !== -1, 'machine code UNRESOLVED remains visible alongside the wording');
})();

// ================================================================
// 6. unresolved KPI semantics render correctly
// ================================================================
(function () {
  var item = DB.projectRecommendation({ recommendation: rec(), prescription: rx({ kpi_target_status: 'BENCHMARK_NOT_RESOLVED' }) }).dashboard_item;
  var html = UI.dashboardItemCard(item);
  assert.ok(/KPI benchmark not yet resolved|KPI 基准尚未确定/.test(html), 'human-readable unresolved-KPI wording present');
  assert.ok(html.indexOf('BENCHMARK_NOT_RESOLVED') !== -1, 'machine code BENCHMARK_NOT_RESOLVED remains visible alongside the wording');
})();

// ================================================================
// 7. reassessment warning renders
// ================================================================
(function () {
  var item = DB.projectRecommendation({ recommendation: rec(), prescription: rx(), workflow: { state: 'REASSESSMENT_READY', evidence_refs: [] } }).dashboard_item;
  var html = UI.dashboardItemCard(item);
  assert.ok(/New evidence available.*reassessment required|有新证据.*需要重新评估/.test(html), 'reassessment warning text renders');
  // the prior recommendation stays visible for history, not hidden
  assert.ok(html.indexOf('IMPROVE_SHOT_EXECUTION') !== -1, 'the existing recommendation remains visible alongside the reassessment warning');
})();

// ================================================================
// 8. no-recommendation empty state is honest
// ================================================================
(function () {
  var model = { dashboard: DB.projectDashboardList([]).dashboard };
  var html = UI.renderSection7(model);
  assert.ok(/No active recommendation available|暂无有效推荐/.test(html), 'honest empty-state wording renders');
  assert.ok(!/everything is (fine|good)|no problems|一切正常|没有问题/i.test(html), 'empty state never implies "everything is fine"');
})();
// buildDashboardModel also degrades honestly when no dashboard result was fetched at all (e.g. no match session)
(function () {
  var d = UI.buildDashboardModel(null);
  assert.strictEqual(d.item_count, 0);
  assert.strictEqual(d.message_code, 'NO_RECOMMENDATION');
})();

// ================================================================
// 9. UI does not contain ranking/scoring formula
// ================================================================
(function () {
  var forbidden = [
    'PRIORITY_TIER_THRESHOLDS', 'REASON_SIGNAL_THRESHOLDS', 'DIAGNOSIS_TO_RECOMMENDATION',
    'RECOMMENDATION_TO_PRESCRIPTION', 'PATTERN_TO_DIAGNOSIS', 'EVIDENCE_GATE_MIN_CONFIDENCE',
    '0.60 *', '0.40 *', '0.60*', '0.40*'
  ];
  forbidden.forEach(function (token) {
    assert.ok(UI_CODE_ONLY.indexOf(token) === -1, 'review-ui.js must never contain the S9/S10-B scoring/mapping token "' + token + '"');
  });
  // the dashboard section only ever reads item.rank/priority_score/priority_tier — it never assigns to them
  assert.ok(!/\.\s*(rank|priority_score|priority_tier)\s*=[^=]/.test(UI_CODE_ONLY), 'review-ui.js must never assign rank/priority_score/priority_tier — read-only passthrough only');
})();

// ================================================================
// 10/11/12/13/14. directly-relevant regression suites remain green
// ================================================================
(function () {
  var suites = [
    'review-ui.test.js',                       // 10. existing Review UI still loads
    'pre-s7-ui-regression.test.js',             // 11. pre-S7/S7/S8 UI regression
    's9-full-system-qa.test.js',                // 12. S9 Final QA
    'workflow-integration-engine.test.js',      // 13. S10-A
    'dashboard-integration-engine.test.js'      // 14. S10-B adapter
  ];
  suites.forEach(function (suite) {
    var res = cp.spawnSync(process.execPath, [path.join(__dirname, suite)], { encoding: 'utf8' });
    assert.strictEqual(res.status, 0, 'regression suite ' + suite + ' must still pass:\n' + res.stdout + res.stderr);
  });
})();

console.log('s10-b-r1-dashboard-wiring.test.js: all assertions passed');
