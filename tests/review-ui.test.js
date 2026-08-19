/* tests/review-ui.test.js — S7-E: Review / Trend UI (pure formatting functions)
 * Run: node tests/review-ui.test.js
 * These test the pure view-model builders only — no DOM, no PBStore. The DOM
 * mounting code in review-ui.js is untested here, consistent with the rest of
 * this codebase's UI modules (e.g. assessment.js is also not unit-tested).
 */
var assert = require('assert');

delete require.cache[require.resolve('../js/review-ui.js')];
var UI = require('../js/review-ui.js');

function domainTrend(fields) {
  var base = { state: 'INSUFFICIENT_EVIDENCE', baseline_value: null, current_value: null, raw_delta: null, normalized_improvement_delta: null, point_count: 0, missing_point_count: 0, evidence_mode: 'INCOMPLETE', series: [] };
  Object.keys(fields || {}).forEach(function (k) { base[k] = fields[k]; });
  return base;
}
function emptyTrendResult(fields) {
  var base = {
    player_id: 'plr_1', window_days: 42, window_start: null, window_end: null,
    history_state: 'INCOMPLETE', assessment_count: 0, missing_snapshot_assessment_ids: [],
    technical_trend: domainTrend(), decision_trend: domainTrend(), pressure_trend: domainTrend(), capability_trend: domainTrend(),
    match_transfer_trend: domainTrend(), ue_per_game_trend: domainTrend(),
    hard_gate_trends: [], bottleneck_history: [], bottleneck_movement: { state: 'INCOMPLETE', previous_bottleneck: null, current_bottleneck: null },
    overall_domain_trend: 'INSUFFICIENT_EVIDENCE', version_mixed: false, generated_at: '2026-01-01T00:00:00.000Z'
  };
  Object.keys(fields || {}).forEach(function (k) { base[k] = fields[k]; });
  return base;
}

// ---- 1. No assessments -> correct empty state ----
(function () {
  var model = UI.buildReviewViewModel({ trend: emptyTrendResult({ assessment_count: 0 }) });
  assert.strictEqual(model.emptyState, true);
  assert.ok(/No assessment history|无评估历史/.test(model.message));
})();
(function () {
  // Also correct when trend itself is entirely absent (e.g. player never had a forPlayer call resolve).
  var model = UI.buildReviewViewModel({ trend: null });
  assert.strictEqual(model.emptyState, true);
})();

// ---- 2. One assessment -> BASELINE_ONLY message ----
(function () {
  var trend = emptyTrendResult({ assessment_count: 1, history_state: 'BASELINE_ONLY' });
  var c = UI.buildCapabilityTrendModel(trend);
  assert.ok(/Baseline established|已建立基线/.test(c.banner));
})();

// ---- 3. Two assessments -> DIRECTIONAL message ----
(function () {
  var trend = emptyTrendResult({ assessment_count: 2, history_state: 'DIRECTIONAL' });
  var c = UI.buildCapabilityTrendModel(trend);
  assert.ok(/Directional change available|方向性变化/.test(c.banner));
})();
(function () {
  // Three or more: no banner (a real trend, not a caveat message).
  var trend = emptyTrendResult({ assessment_count: 3, history_state: 'TREND_ELIGIBLE' });
  var c = UI.buildCapabilityTrendModel(trend);
  assert.strictEqual(c.banner, null);
})();

// ---- 4. Missing Capability -> shows INCOMPLETE, not 0 ----
(function () {
  var snap = { capability_score: null, capability_state: 'INCOMPLETE', target_training_level: 4.0 };
  var s = UI.buildCurrentStatusModel(snap, null);
  assert.strictEqual(s.capabilityScore, 'INCOMPLETE');
  assert.notStrictEqual(s.capabilityScore, 0);

  var dm = UI.buildDomainSeriesModel(domainTrend({ baseline_value: null, current_value: null }));
  assert.strictEqual(dm.baseline, 'INCOMPLETE');
  assert.strictEqual(dm.current, 'INCOMPLETE');
})();

// Evidence confidence: missing must be INCOMPLETE, never C0.
(function () {
  var s = UI.buildCurrentStatusModel({ evidence_confidence: null, evidence_state: 'INCOMPLETE' }, null);
  assert.strictEqual(s.evidenceConfidence, 'INCOMPLETE');
  assert.notStrictEqual(s.evidenceConfidence, 'C0');
})();

// ---- 5. Match Transfer is rendered separately from Capability ----
(function () {
  var trend = emptyTrendResult({
    capability_trend: domainTrend({ state: 'IMPROVING', baseline_value: 70, current_value: 80, point_count: 2 }),
    match_transfer_trend: domainTrend({ state: 'STABLE', baseline_value: 40, current_value: 42, point_count: 2 })
  });
  var snapA = { match_transfer_score: 60, capability_score: 72 };
  var snapB = { match_transfer_score: 5, capability_score: 72 }; // only match transfer differs
  var capA = UI.buildCurrentStatusModel(snapA, null).capabilityScore;
  var capB = UI.buildCurrentStatusModel(snapB, null).capabilityScore;
  assert.strictEqual(capA, capB); // capability display unaffected by match transfer changes

  var mtModel = UI.buildMatchTransferModel(snapA, trend, null);
  // structural check: the match-transfer view model carries no capability_score-derived field
  assert.strictEqual(Object.prototype.hasOwnProperty.call(mtModel, 'capabilityScore'), false);
  assert.strictEqual(mtModel.currentScore, 60);
})();

// ---- 6. Simplified Match Transfer evidence -> visibly marked simplified/provisional ----
(function () {
  var trend = emptyTrendResult();
  var mt = UI.buildMatchTransferModel({ match_transfer_score: 70, match_transfer_mode: 'simplified' }, trend, null);
  assert.strictEqual(mt.isSimplifiedEvidence, true);
  assert.ok(/Simplified|简化/.test(mt.evidenceLabel));

  var mtFull = UI.buildMatchTransferModel({ match_transfer_score: null, match_transfer_mode: null }, trend, null);
  assert.strictEqual(mtFull.isSimplifiedEvidence, false);
  assert.strictEqual(mtFull.evidenceLabel, 'INCOMPLETE');
})();

// ---- 7. Hard Gate: Performance MET, Sample INSUFFICIENT, Formal INCOMPLETE -> all three rendered separately ----
(function () {
  var gateTrends = [{
    metric: 'serve_in_pct', direction: 'min', threshold: 85,
    previous_value: 88, current_value: 90,
    previous_status: 'MET', current_status: 'INCOMPLETE',
    trend_state: 'IMPROVING', gate_transition_state: 'EVIDENCE_COMPLETED', threshold_mixed: false,
    history: [
      { performance_state: 'MET', sample_state: 'SUFFICIENT', formal_status: 'MET' },
      { performance_state: 'MET', sample_state: 'INSUFFICIENT', formal_status: 'INCOMPLETE' }
    ]
  }];
  var rows = UI.buildHardGateRows(gateTrends);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].performanceState, 'MET');
  assert.strictEqual(rows[0].sampleState, 'INSUFFICIENT');
  assert.strictEqual(rows[0].formalState, 'INCOMPLETE');
  // the three must be distinct values, not collapsed into one
  assert.notStrictEqual(rows[0].performanceState, rows[0].sampleState);
  assert.notStrictEqual(rows[0].sampleState, rows[0].formalState);
})();

// ---- 8. Bottleneck null->null -> NONE, not PERSISTENT ----
(function () {
  var b = UI.buildBottleneckModel({ state: 'NONE', previous_bottleneck: null, current_bottleneck: null });
  assert.strictEqual(b.movementState, 'NONE');
  assert.notStrictEqual(b.movementState, 'PERSISTENT');
  var badge = UI.stateBadgeMeta(b.movementState);
  assert.strictEqual(badge.label, 'NONE');
})();

// ---- 9. EVIDENCE_COMPLETED -> displayed as evidence completion, not training improvement ----
(function () {
  var meta = UI.stateBadgeMeta('EVIDENCE_COMPLETED');
  assert.ok(/evidence completed/i.test(meta.label));
  assert.ok(/not a training improvement/i.test(meta.label));
  // must be visually/semantically distinct from a real positive progression
  var progressedMeta = UI.stateBadgeMeta('PROGRESSED');
  assert.notStrictEqual(meta.kind, progressedMeta.kind); // EVIDENCE_COMPLETED is 'inc', PROGRESSED is 'pos'
  assert.notStrictEqual(meta.label, progressedMeta.label);
})();

// ---- 10. PROMOTION_REVIEW_ELIGIBLE -> UI says review eligible, not promoted ----
(function () {
  var model = UI.buildReassessmentModel({ signal: 'PROMOTION_REVIEW_ELIGIBLE', validation_state: 'VALIDATION_ELIGIBLE' });
  assert.ok(/review eligible|复核资格/i.test(model.note));
  // Any mention of "promoted"/"已晋级" must be inside an explicit negation, never an affirmative claim.
  assert.ok(!/[^否非]\bpromoted\b/i.test(model.note));
  assert.ok(!/已晋级/.test(model.note) || /(并非|不是|非)已晋级/.test(model.note));
  assert.ok(!/new level\s*=/i.test(model.note));

  var meta = UI.stateBadgeMeta('PROMOTION_REVIEW_ELIGIBLE');
  assert.ok(/review eligible/i.test(meta.label));
  // "promoted" may only appear as part of an explicit negation ("not promoted"), never an affirmative claim.
  assert.ok(!/\bpromoted\b/i.test(meta.label) || /not promoted/i.test(meta.label));

  // Other signals must not carry the promotion-review note.
  var notReady = UI.buildReassessmentModel({ signal: 'NOT_READY' });
  assert.strictEqual(notReady.note, null);
})();

// ---- 11. No prescription -> safe empty state ----
(function () {
  var model = UI.buildPrescriptionModel(null, null);
  assert.strictEqual(model.exists, false);
  assert.ok(/No active prescription|没有进行中的处方/.test(model.message));
})();

// ---- 12. No re-test -> safe empty state ----
(function () {
  var prescriptionRecord = {
    prescription_id: 'rx_1', created_at: '2026-01-01T00:00:00.000Z',
    data: { status: 'ACTIVE', source_assessment_id: 'asm_1', source_review_snapshot_id: 'rev_1', primary_bottleneck: 'hard_gate:serve_in_pct' }
  };
  var summaryWithNoRetests = { retest_count: 0, latest_response: 'INCOMPLETE', response_history: [], prescription_effectiveness: 'INCOMPLETE' };
  var model = UI.buildPrescriptionModel(prescriptionRecord, summaryWithNoRetests);
  assert.strictEqual(model.exists, true);
  assert.strictEqual(model.retestCount, 0);
  assert.ok(/No linked re-test|暂无关联的复测/.test(model.noRetestMessage));
})();

// ---- Decimal training level / methodology guards ----
(function () {
  assert.strictEqual(UI.fmtLevel(4.0), '4.0');
  assert.strictEqual(UI.fmtLevel(3.87), 'INCOMPLETE'); // never display a level outside the frozen set
  assert.strictEqual(UI.fmtLevel(null), 'INCOMPLETE');
  assert.strictEqual(typeof UI.deriveValidatedLevel, 'undefined');
  assert.strictEqual(typeof UI.promotePlayer, 'undefined');

  var sNoLevelArg = UI.buildCurrentStatusModel({ target_training_level: 4.0 }, null);
  assert.strictEqual(sNoLevelArg.validatedLevel, 'INCOMPLETE'); // omitted -> INCOMPLETE, never auto-derived
})();

// ---- Fix: Validated Training Level must be READ from persisted data, not hard-coded INCOMPLETE ----

// Persisted validated level = 4.0 -> display 4.0.
(function () {
  var s = UI.buildCurrentStatusModel({ target_training_level: 4.0 }, null, 4.0);
  assert.strictEqual(s.validatedLevel, '4.0');
})();

// Missing validated level -> INCOMPLETE.
(function () {
  var s1 = UI.buildCurrentStatusModel({ target_training_level: 4.0 }, null, null);
  assert.strictEqual(s1.validatedLevel, 'INCOMPLETE');
  var s2 = UI.buildCurrentStatusModel({ target_training_level: 4.0 }, null, undefined);
  assert.strictEqual(s2.validatedLevel, 'INCOMPLETE');
})();

// Invalid/decimal validated level = 3.87 -> INCOMPLETE (never display a non-frozen level).
(function () {
  var s = UI.buildCurrentStatusModel({ target_training_level: 4.0 }, null, 3.87);
  assert.strictEqual(s.validatedLevel, 'INCOMPLETE');
})();

// Validated level must never be derived from CAP or target level — changing those must not affect it.
(function () {
  var a = UI.buildCurrentStatusModel({ target_training_level: 3.0, capability_score: 95, capability_state: 'OK' }, null, null);
  var b = UI.buildCurrentStatusModel({ target_training_level: 5.0, capability_score: 10, capability_state: 'OK' }, null, null);
  assert.strictEqual(a.validatedLevel, 'INCOMPLETE');
  assert.strictEqual(b.validatedLevel, 'INCOMPLETE');
  assert.strictEqual(a.validatedLevel, b.validatedLevel); // same regardless of wildly different CAP/target
})();

// Every allowed validated level renders as itself; nothing outside the frozen set ever passes through.
(function () {
  [3.0, 3.5, 4.0, 4.5, 5.0].forEach(function (lvl) {
    var s = UI.buildCurrentStatusModel({}, null, lvl);
    assert.strictEqual(s.validatedLevel, lvl.toFixed(1));
  });
})();

// ---- Sparkline: only connects real points, no fabricated interpolation ----
(function () {
  var svgEmpty = UI.sparklineSVG([]);
  assert.ok(svgEmpty.indexOf('<path') === -1);
  var svgOne = UI.sparklineSVG([{ date: '2026-01-01', value: 70 }]);
  assert.ok(svgOne.indexOf('<circle') !== -1);
  var svgTwo = UI.sparklineSVG([{ date: '2026-01-01', value: 70 }, { date: '2026-01-08', value: 80 }]);
  assert.ok(svgTwo.indexOf('<path') !== -1);
  var dotCount = (svgTwo.match(/<circle/g) || []).length;
  assert.strictEqual(dotCount, 2); // exactly the two real points, nothing interpolated in between
})();

// ---- Fix: a missing middle observation must break the path, not draw one continuous line across it ----
(function () {
  // 72, null, 78 -- a gap in the middle must NOT be bridged by a single connecting line.
  var svg = UI.sparklineSVG([
    { date: '2026-01-01', value: 72 },
    { date: '2026-01-08', value: null },
    { date: '2026-01-15', value: 78 }
  ]);
  var dotCount = (svg.match(/<circle/g) || []).length;
  assert.strictEqual(dotCount, 2); // only the two real observations are drawn

  var circles = svg.match(/<circle[^>]*cx="([\d.]+)"/g).map(function (m) { return parseFloat(m.match(/cx="([\d.]+)"/)[1]); });
  assert.strictEqual(circles.length, 2);
  // Chronological position preserved: the missing middle slot leaves a real horizontal gap between the two dots
  // (they must NOT be adjacent/compacted as if the null slot never existed).
  assert.ok(circles[1] - circles[0] > 50, 'points must keep their original spaced-out chronological position');

  // Both real points are isolated (segment length 1 each) -> no <path> element connects them at all.
  var pathCount = (svg.match(/<path/g) || []).length;
  assert.strictEqual(pathCount, 0, 'no line may bridge the missing observation');
})();

// A gap followed by two adjacent valid points: only the adjacent pair connects; the isolated leading point does not.
(function () {
  var svg = UI.sparklineSVG([
    { date: '2026-01-01', value: 70 },
    { date: '2026-01-08', value: null },
    { date: '2026-01-15', value: 74 },
    { date: '2026-01-22', value: 76 }
  ]);
  var pathCount = (svg.match(/<path/g) || []).length;
  assert.strictEqual(pathCount, 1); // exactly one segment (points 3 & 4) gets a connecting line
  var dotCount = (svg.match(/<circle/g) || []).length;
  assert.strictEqual(dotCount, 3); // all three real observations are still drawn as points
})();

// Null values are never coerced to 0 when computing the sparkline's value range.
(function () {
  var svg = UI.sparklineSVG([
    { date: '2026-01-01', value: 72 },
    { date: '2026-01-08', value: null },
    { date: '2026-01-15', value: 78 }
  ]);
  // If null had been treated as 0, the y-domain would stretch to include 0, compressing 72/78 near the top.
  // Instead the two dots should sit near the vertical extremes of the (72..78) range, not clustered together.
  var circleYs = svg.match(/<circle[^>]*cy="([\d.]+)"/g).map(function (m) { return parseFloat(m.match(/cy="([\d.]+)"/)[1]); });
  assert.ok(Math.abs(circleYs[0] - circleYs[1]) > 15, 'value range must be computed from real values only, not a fabricated 0');
})();

// ---- Regression guard: forbidden methodology must never appear in the UI source ----
(function () {
  var fs = require('fs');
  var src = fs.readFileSync(require.resolve('../js/review-ui.js'), 'utf8').toLowerCase();
  var forbidden = ['internal_dupr', 'dupr_gap', '.dupr', 'training_dose', 'drop_apex', 'auto_promot', '0.35', '35/25/20/20', "'promoted'", '"promoted"'];
  forbidden.forEach(function (token) {
    assert.ok(src.indexOf(token) === -1, 'forbidden token found in review-ui.js: ' + token);
  });
})();

console.log('review-ui.test.js: all assertions passed');
