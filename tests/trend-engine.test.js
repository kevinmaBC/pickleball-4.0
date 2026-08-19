/* tests/trend-engine.test.js — S7-C: Longitudinal Trend Engine (pure functions)
 * Run: node tests/trend-engine.test.js
 */
var assert = require('assert');

delete require.cache[require.resolve('../js/trend-engine.js')];
var PBTrend = require('../js/trend-engine.js');

function pt(assessment_id, assessment_date, fields) {
  var base = {
    assessment_id: assessment_id,
    assessment_date: assessment_date,
    review_snapshot_id: 'rev_' + assessment_id,
    schema_version: '2.3.1',
    benchmark_version: '2.1.1',
    protocol_version: '2.2.1'
  };
  Object.keys(fields || {}).forEach(function (k) { base[k] = fields[k]; });
  return base;
}

// ---- History State: 0/1/2/3+ assessments ----
(function () {
  assert.strictEqual(PBTrend.classifyHistoryState(0), 'INCOMPLETE');
  assert.strictEqual(PBTrend.classifyHistoryState(1), 'BASELINE_ONLY');
  assert.strictEqual(PBTrend.classifyHistoryState(2), 'DIRECTIONAL');
  assert.strictEqual(PBTrend.classifyHistoryState(3), 'TREND_ELIGIBLE');
  assert.strictEqual(PBTrend.classifyHistoryState(5), 'TREND_ELIGIBLE');
  assert.strictEqual(PBTrend.classifyHistoryState(null), 'INCOMPLETE');
})();

// ---- Normal 0-100 trend: 70->76 IMPROVING, 76->72 STABLE, 80->73 DECLINING ----
(function () {
  var t1 = PBTrend.buildTrend([pt('a1', '2026-01-01', { technical_score: 70 }), pt('a2', '2026-01-08', { technical_score: 76 })],
    function (p) { return p.technical_score; }, 'higher');
  assert.strictEqual(t1.raw_delta, 6);
  assert.strictEqual(t1.state, 'IMPROVING');

  var t2 = PBTrend.buildTrend([pt('a1', '2026-01-01', { technical_score: 76 }), pt('a2', '2026-01-08', { technical_score: 72 })],
    function (p) { return p.technical_score; }, 'higher');
  assert.strictEqual(t2.raw_delta, -4);
  assert.strictEqual(t2.state, 'STABLE');

  var t3 = PBTrend.buildTrend([pt('a1', '2026-01-01', { technical_score: 80 }), pt('a2', '2026-01-08', { technical_score: 73 })],
    function (p) { return p.technical_score; }, 'higher');
  assert.strictEqual(t3.raw_delta, -7);
  assert.strictEqual(t3.state, 'DECLINING');
})();

// ---- Lower-is-better: UE/game 7->5 IMPROVING, UE/game 4->7 DECLINING (band=0, not the 0-100 ±5 rule) ----
(function () {
  var ue1 = PBTrend.buildTrend([pt('a1', '2026-01-01', { ue: 7 }), pt('a2', '2026-01-08', { ue: 5 })],
    function (p) { return p.ue; }, 'lower', null, 0);
  assert.strictEqual(ue1.normalized_improvement_delta, 2); // baseline(7) - current(5)
  assert.strictEqual(ue1.state, 'IMPROVING');

  var ue2 = PBTrend.buildTrend([pt('a1', '2026-01-01', { ue: 4 }), pt('a2', '2026-01-08', { ue: 7 })],
    function (p) { return p.ue; }, 'lower', null, 0);
  assert.strictEqual(ue2.normalized_improvement_delta, -3);
  assert.strictEqual(ue2.state, 'DECLINING');

  // sanity: direction correctly inverts sign for lower-is-better even under the default band
  assert.strictEqual(PBTrend.computeNormalizedDelta(7, 5, 'lower'), 2);
  assert.strictEqual(PBTrend.computeNormalizedDelta(70, 76, 'higher'), 6);
})();

// ---- Missing values: 72 -> null -> 78 must not be treated as zero ----
(function () {
  var points = [
    pt('a1', '2026-01-01', { capability_score: 72 }),
    pt('a2', '2026-01-08', { capability_score: null }), // e.g. CAP INCOMPLETE for this assessment
    pt('a3', '2026-01-15', { capability_score: 78 })
  ];
  var trend = PBTrend.buildTrend(points, function (p) { return p.capability_score; }, 'higher');
  assert.strictEqual(trend.point_count, 2); // only the two valid points
  assert.strictEqual(trend.missing_point_count, 1);
  assert.strictEqual(trend.baseline_value, 72);
  assert.strictEqual(trend.current_value, 78);
  assert.strictEqual(trend.raw_delta, 6);
  trend.series.forEach(function (s) { assert.notStrictEqual(s.value, 0); });
  assert.strictEqual(trend.series.some(function (s) { return s.value == null; }), false);
})();

// ---- Duplicate Assessment: same assessment_id, use only the latest generated snapshot ----
(function () {
  var records = [
    { assessment_id: 'asm_1', review_snapshot_id: 'rev_old', generated_at: '2026-01-01T00:00:00.000Z', data: { note: 'old' } },
    { assessment_id: 'asm_1', review_snapshot_id: 'rev_new', generated_at: '2026-01-02T00:00:00.000Z', data: { note: 'new' } },
    { assessment_id: 'asm_2', review_snapshot_id: 'rev_2', generated_at: '2026-01-01T00:00:00.000Z', data: { note: 'only' } }
  ];
  var canonical = PBTrend.selectCanonicalSnapshots(records);
  assert.strictEqual(canonical.length, 2);
  var forAsm1 = canonical.filter(function (r) { return r.assessment_id === 'asm_1'; })[0];
  assert.strictEqual(forAsm1.review_snapshot_id, 'rev_new');
  assert.strictEqual(forAsm1.data.note, 'new');
})();

// ---- 6-week window: exclude snapshots older than 42 days from the latest assessment date ----
(function () {
  var points = [
    pt('a1', '2025-11-01'), // > 42 days before 2026-01-01 latest -> excluded
    pt('a2', '2025-11-25'), // = 2026-01-01 minus 37 days -> included
    pt('a3', '2026-01-01')  // latest
  ];
  var windowed = PBTrend.filterTrailingWindow(points, 42);
  assert.strictEqual(windowed.window_end, '2026-01-01');
  assert.strictEqual(windowed.window_start, '2025-11-20'); // 2026-01-01 minus 42 days
  var ids = windowed.points.map(function (p) { return p.assessment_id; });
  assert.deepStrictEqual(ids, ['a2', 'a3']);
  assert.strictEqual(ids.indexOf('a1'), -1);
})();

// ---- Bottleneck Movement ----
(function () {
  function h(bn, state) { return { primary_bottleneck: bn, bottleneck_state: (state || 'DETERMINED') }; }

  var persistent = PBTrend.detectBottleneckMovement([h('hard_gate:reset_ball_quality_pct'), h('hard_gate:reset_ball_quality_pct')]);
  assert.strictEqual(persistent.state, 'PERSISTENT');
  assert.strictEqual(persistent.previous_bottleneck, 'hard_gate:reset_ball_quality_pct');
  assert.strictEqual(persistent.current_bottleneck, 'hard_gate:reset_ball_quality_pct');

  var shifted = PBTrend.detectBottleneckMovement([h('hard_gate:reset_ball_quality_pct'), h('evidence')]);
  assert.strictEqual(shifted.state, 'SHIFTED');
  assert.strictEqual(shifted.previous_bottleneck, 'hard_gate:reset_ball_quality_pct');
  assert.strictEqual(shifted.current_bottleneck, 'evidence');

  var cleared = PBTrend.detectBottleneckMovement([h('hard_gate:reset_ball_quality_pct'), h(null, 'NONE')]);
  assert.strictEqual(cleared.state, 'CLEARED');
  assert.strictEqual(cleared.previous_bottleneck, 'hard_gate:reset_ball_quality_pct');
  assert.strictEqual(cleared.current_bottleneck, null);

  var incomplete = PBTrend.detectBottleneckMovement([h('hard_gate:reset_ball_quality_pct', 'INCOMPLETE')]);
  assert.strictEqual(incomplete.state, 'INCOMPLETE');

  var noHistory = PBTrend.detectBottleneckMovement([]);
  assert.strictEqual(noHistory.state, 'INCOMPLETE');
})();

// ---- Match Transfer Independence: changing match_transfer_score must not change capability_trend values ----
(function () {
  var pointsA = [
    pt('a1', '2026-01-01', { capability_score: 72, match_transfer_score: 60 }),
    pt('a2', '2026-01-08', { capability_score: 78, match_transfer_score: 60 })
  ];
  var pointsB = [
    pt('a1', '2026-01-01', { capability_score: 72, match_transfer_score: 95 }), // match_transfer changed
    pt('a2', '2026-01-08', { capability_score: 78, match_transfer_score: 10 })  // match_transfer changed
  ];
  var capA = PBTrend.buildTrend(pointsA, function (p) { return p.capability_score; }, 'higher');
  var capB = PBTrend.buildTrend(pointsB, function (p) { return p.capability_score; }, 'higher');
  assert.deepStrictEqual(
    { baseline: capA.baseline_value, current: capA.current_value, delta: capA.raw_delta, state: capA.state },
    { baseline: capB.baseline_value, current: capB.current_value, delta: capB.raw_delta, state: capB.state }
  );
})();

// ---- Overall Domain Trend (Mixed Domain Trend) ----
(function () {
  assert.strictEqual(PBTrend.combineOverallDomainTrend(['IMPROVING', 'DECLINING', 'STABLE']), 'MIXED');
  assert.strictEqual(PBTrend.combineOverallDomainTrend(['STABLE', 'STABLE', 'STABLE']), 'STABLE');
  assert.strictEqual(PBTrend.combineOverallDomainTrend(['IMPROVING', 'STABLE', 'IMPROVING']), 'IMPROVING');
  assert.strictEqual(PBTrend.combineOverallDomainTrend(['DECLINING', 'DECLINING', 'STABLE']), 'DECLINING');
  assert.strictEqual(PBTrend.combineOverallDomainTrend(['INSUFFICIENT_EVIDENCE', 'INSUFFICIENT_EVIDENCE', 'INSUFFICIENT_EVIDENCE']), 'INSUFFICIENT_EVIDENCE');
})();

// ---- Hard Gate Trend: preserves per-point performance_state/sample_state, doesn't collapse sample shortage into decline ----
(function () {
  var points = [
    pt('a1', '2026-01-01', {
      hard_gates: [{ metric: 'serve_in_pct', direction: 'min', threshold: 85, current_value: 90, performance_state: 'MET', sample_state: 'INSUFFICIENT', status: 'INCOMPLETE' }]
    }),
    pt('a2', '2026-01-08', {
      hard_gates: [{ metric: 'serve_in_pct', direction: 'min', threshold: 85, current_value: 92, performance_state: 'MET', sample_state: 'SUFFICIENT', status: 'MET' }]
    })
  ];
  var gt = PBTrend.buildGateTrend('serve_in_pct', points);
  assert.strictEqual(gt.previous_status, 'INCOMPLETE'); // sample-insufficient point, not "regressed"
  assert.strictEqual(gt.current_status, 'MET');
  assert.strictEqual(gt.previous_value, 90);
  assert.strictEqual(gt.current_value, 92);
  assert.strictEqual(gt.history[0].sample_state, 'INSUFFICIENT');
  assert.strictEqual(gt.history[0].performance_state, 'MET'); // numeric performance untouched by sample shortage
  assert.strictEqual(gt.threshold_mixed, false);

  // A gate absent from the latest snapshot is not surfaced in buildHardGateTrends.
  assert.deepStrictEqual(PBTrend.buildHardGateTrends([]), []);
})();

// ue_per_game_max hard gate trend: 7 -> 5 must classify IMPROVING (band=0 exception, matches the standalone ue_per_game_trend rule).
(function () {
  var points = [
    pt('a1', '2026-01-01', { hard_gates: [{ metric: 'ue_per_game_max', direction: 'max', threshold: 5, current_value: 7, performance_state: 'NOT_MET', sample_state: 'SUFFICIENT', status: 'NOT_MET' }] }),
    pt('a2', '2026-01-08', { hard_gates: [{ metric: 'ue_per_game_max', direction: 'max', threshold: 5, current_value: 5, performance_state: 'MET', sample_state: 'SUFFICIENT', status: 'MET' }] })
  ];
  var gt = PBTrend.buildGateTrend('ue_per_game_max', points);
  assert.strictEqual(gt.trend_state, 'IMPROVING');
  assert.strictEqual(gt.previous_status, 'NOT_MET');
  assert.strictEqual(gt.current_status, 'MET'); // NOT_MET -> MET is positive gate progression
})();

// Threshold mixed: same metric key evaluated against two different historical thresholds must be flagged, not silently overwritten.
(function () {
  var points = [
    pt('a1', '2026-01-01', { hard_gates: [{ metric: 'serve_in_pct', direction: 'min', threshold: 85, current_value: 88, performance_state: 'MET', sample_state: 'SUFFICIENT', status: 'MET' }] }),
    pt('a2', '2026-01-08', { hard_gates: [{ metric: 'serve_in_pct', direction: 'min', threshold: 90, current_value: 88, performance_state: 'BORDERLINE', sample_state: 'SUFFICIENT', status: 'BORDERLINE' }] })
  ];
  var gt = PBTrend.buildGateTrend('serve_in_pct', points);
  assert.strictEqual(gt.threshold_mixed, true);
  assert.strictEqual(gt.history[0].threshold, 85); // historical point keeps its own stored threshold
  assert.strictEqual(gt.history[1].threshold, 90);
})();

// ---- Version mixed detection ----
(function () {
  var mixed = [pt('a1', '2026-01-01', {}), pt('a2', '2026-01-08', { schema_version: '2.4.0' })];
  assert.strictEqual(PBTrend.detectVersionMixed(mixed), true);
  var same = [pt('a1', '2026-01-01', {}), pt('a2', '2026-01-08', {})];
  assert.strictEqual(PBTrend.detectVersionMixed(same), false);
})();

// ---- Regression guard: forbidden methodology must never appear in the engine source ----
(function () {
  var fs = require('fs');
  var src = fs.readFileSync(require.resolve('../js/trend-engine.js'), 'utf8').toLowerCase();
  var forbidden = ['internal_dupr', 'dupr_gap', '.dupr', 'training_dose', 'drop_apex', 'auto_promot', '0.35', '35/25/20/20'];
  forbidden.forEach(function (token) {
    assert.ok(src.indexOf(token) === -1, 'forbidden token found in trend-engine.js: ' + token);
  });
})();

// ---- Integration: PBTrend.forPlayer wiring (mock PBStore, no real IndexedDB needed) ----
function runIntegrationTest() {
  var snap1 = {
    review_snapshot_id: null, assessment_id: 'asm_1', player_id: 'plr_1', assessment_date: '2025-12-01',
    technical_score: 70, decision_score: 65, pressure_score: 60, capability_state: 'OK',
    capability_score: 66.3, match_transfer_score: null, match_transfer_mode: null,
    hard_gates: [{ metric: 'ue_per_game_max', direction: 'max', threshold: 5, current_value: 7, performance_state: 'NOT_MET', sample_state: 'SUFFICIENT', status: 'NOT_MET' }],
    primary_bottleneck: 'hard_gate:ue_per_game_max', bottleneck_state: 'DETERMINED',
    schema_version: '2.3.1', benchmark_version: '2.1.1', protocol_version: '2.2.1'
  };
  var snap2 = {
    review_snapshot_id: null, assessment_id: 'asm_2', player_id: 'plr_1', assessment_date: '2025-12-15',
    technical_score: 78, decision_score: 72, pressure_score: 68, capability_state: 'OK',
    capability_score: 73.9, match_transfer_score: 75, match_transfer_mode: 'simplified',
    hard_gates: [{ metric: 'ue_per_game_max', direction: 'max', threshold: 5, current_value: 5, performance_state: 'MET', sample_state: 'SUFFICIENT', status: 'MET' }],
    primary_bottleneck: null, bottleneck_state: 'NONE',
    schema_version: '2.3.1', benchmark_version: '2.1.1', protocol_version: '2.2.1'
  };
  // A stale duplicate for asm_1, generated earlier than the canonical one — must be ignored.
  var staleDup = { review_snapshot_id: 'rev_stale', assessment_id: 'asm_1', generated_at: '2025-12-01T09:00:00.000Z', data: Object.assign({}, snap1, { technical_score: 999 }) };
  var canonical1 = { review_snapshot_id: 'rev_1', assessment_id: 'asm_1', generated_at: '2025-12-01T10:00:00.000Z', data: snap1 };
  var canonical2 = { review_snapshot_id: 'rev_2', assessment_id: 'asm_2', generated_at: '2025-12-15T10:00:00.000Z', data: snap2 };

  global.PBStore = {
    assessmentsByPlayer: function (pid) {
      assert.strictEqual(pid, 'plr_1');
      return Promise.resolve([
        { assessment_id: 'asm_1', player_id: 'plr_1', assessment_date: '2025-12-01' },
        { assessment_id: 'asm_2', player_id: 'plr_1', assessment_date: '2025-12-15' },
        { assessment_id: 'asm_3', player_id: 'plr_1', assessment_date: '2025-12-16' } // has no review snapshot at all
      ]);
    },
    reviewSnapshotsByAssessment: function (aid) {
      if (aid === 'asm_1') return Promise.resolve([staleDup, canonical1]);
      if (aid === 'asm_2') return Promise.resolve([canonical2]);
      return Promise.resolve([]); // asm_3: missing snapshot
    }
  };
  delete require.cache[require.resolve('../js/trend-engine.js')];
  var PBTrendLive = require('../js/trend-engine.js');

  return PBTrendLive.forPlayer('plr_1').then(function (result) {
    assert.strictEqual(result.player_id, 'plr_1');
    assert.strictEqual(result.assessment_count, 2); // dedup: asm_1 once (canonical, not stale), asm_2 once
    assert.strictEqual(result.history_state, 'DIRECTIONAL');
    assert.strictEqual(result.window_end, '2025-12-15');

    assert.strictEqual(result.technical_trend.baseline_value, 70); // proves the canonical (not stale=999) record was used
    assert.strictEqual(result.technical_trend.current_value, 78);
    assert.strictEqual(result.technical_trend.state, 'IMPROVING');

    assert.strictEqual(result.capability_trend.baseline_value, 66.3);
    assert.strictEqual(result.capability_trend.current_value, 73.9);

    assert.strictEqual(result.match_transfer_trend.point_count, 1); // asm_1 had no match_transfer_score
    assert.strictEqual(result.match_transfer_trend.series[0].mode, 'simplified');

    assert.strictEqual(result.ue_per_game_trend.baseline_value, 7);
    assert.strictEqual(result.ue_per_game_trend.current_value, 5);
    assert.strictEqual(result.ue_per_game_trend.state, 'IMPROVING');

    var ueGate = result.hard_gate_trends.filter(function (g) { return g.metric === 'ue_per_game_max'; })[0];
    assert.strictEqual(ueGate.previous_status, 'NOT_MET');
    assert.strictEqual(ueGate.current_status, 'MET');

    assert.strictEqual(result.bottleneck_movement.state, 'CLEARED');
    assert.strictEqual(result.bottleneck_movement.previous_bottleneck, 'hard_gate:ue_per_game_max');
    assert.strictEqual(result.bottleneck_movement.current_bottleneck, null);

    // asm_3 falls within the 42-day window (2025-12-16, window covers back to ~2025-11-03) and has no snapshot.
    assert.ok(result.missing_snapshot_assessment_ids.indexOf('asm_3') !== -1);

    console.log('trend-engine.test.js (integration): all assertions passed');
  });
}

runIntegrationTest().then(function () {
  console.log('trend-engine.test.js: all assertions passed');
}).catch(function (err) {
  console.error('trend-engine.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
