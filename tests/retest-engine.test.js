/* tests/retest-engine.test.js — S7-D: Prescription + Re-test Linkage
 * Run: node tests/retest-engine.test.js
 */
var assert = require('assert');

global.PBTrend = require('../js/trend-engine.js');
delete require.cache[require.resolve('../js/retest-engine.js')];
var PBRetest = require('../js/retest-engine.js');

function gate(metric, direction, threshold, current, perf, sample, status) {
  return { metric: metric, direction: direction, threshold: threshold, current_value: current, performance_state: perf, sample_state: sample, status: status };
}
function snap(fields) {
  var base = {
    review_snapshot_id: null, assessment_id: 'asm', player_id: 'plr_1', assessment_date: '2026-01-01',
    target_training_level: 4.0, capability_score: null, capability_threshold_state: 'INCOMPLETE',
    match_transfer_score: null, match_transfer_mode: null, match_validation_required: false, match_validation_state: 'INCOMPLETE',
    evidence_state: 'INCOMPLETE', evidence_confidence: null,
    hard_gates: [], primary_bottleneck: null, bottleneck_state: 'INCOMPLETE', validation_state: 'INCOMPLETE',
    schema_version: '2.3.1', benchmark_version: '2.1.1', protocol_version: '2.2.1'
  };
  Object.keys(fields || {}).forEach(function (k) { base[k] = fields[k]; });
  return base;
}

// ---- 1. Failed hard gate: NOT_MET -> MET => POSITIVE_RESPONSE ----
(function () {
  var baseline = snap({ hard_gates: [gate('serve_in_pct', 'min', 85, 60, 'NOT_MET', 'SUFFICIENT', 'NOT_MET')] });
  var retest = snap({ hard_gates: [gate('serve_in_pct', 'min', 85, 90, 'MET', 'SUFFICIENT', 'MET')] });
  var r = PBRetest.evaluateRetest({ baseline: baseline, retest: retest, primaryBottleneck: 'hard_gate:serve_in_pct' });
  assert.strictEqual(r.response_state, 'POSITIVE_RESPONSE');
  assert.strictEqual(r.previous_status, 'NOT_MET');
  assert.strictEqual(r.current_status, 'MET');
})();

// ---- 2. Failed hard gate: NOT_MET -> BORDERLINE => deterministic (POSITIVE_RESPONSE, per section 8.A's explicit example list) ----
(function () {
  var baseline = snap({ hard_gates: [gate('serve_in_pct', 'min', 85, 60, 'NOT_MET', 'SUFFICIENT', 'NOT_MET')] });
  var retest = snap({ hard_gates: [gate('serve_in_pct', 'min', 85, 82, 'BORDERLINE', 'SUFFICIENT', 'BORDERLINE')] });
  var r = PBRetest.evaluateRetest({ baseline: baseline, retest: retest, primaryBottleneck: 'hard_gate:serve_in_pct' });
  assert.strictEqual(r.response_state, 'POSITIVE_RESPONSE');
})();

// ---- 3. Same failed gate, stable metric -> NO_MEANINGFUL_CHANGE ----
(function () {
  var baseline = snap({ hard_gates: [gate('serve_in_pct', 'min', 85, 70, 'NOT_MET', 'SUFFICIENT', 'NOT_MET')] });
  var retest = snap({ hard_gates: [gate('serve_in_pct', 'min', 85, 71, 'NOT_MET', 'SUFFICIENT', 'NOT_MET')] }); // +1pp, below the ±5 band
  var r = PBRetest.evaluateRetest({ baseline: baseline, retest: retest, primaryBottleneck: 'hard_gate:serve_in_pct' });
  assert.strictEqual(r.response_state, 'NO_MEANINGFUL_CHANGE');
})();

// ---- 4. MET -> NOT_MET -> NEGATIVE_RESPONSE ----
(function () {
  var baseline = snap({ hard_gates: [gate('serve_in_pct', 'min', 85, 90, 'MET', 'SUFFICIENT', 'MET')] });
  var retest = snap({ hard_gates: [gate('serve_in_pct', 'min', 85, 60, 'NOT_MET', 'SUFFICIENT', 'NOT_MET')] });
  var r = PBRetest.evaluateRetest({ baseline: baseline, retest: retest, primaryBottleneck: 'hard_gate:serve_in_pct' });
  assert.strictEqual(r.response_state, 'NEGATIVE_RESPONSE');
})();

// A same-tier numeric worsening (not a rank drop) must also be flagged NEGATIVE_RESPONSE per section 8.D's
// "or a meaningful worsening in the relevant bottleneck metric" clause.
(function () {
  var baseline = snap({ hard_gates: [gate('serve_in_pct', 'min', 85, 70, 'NOT_MET', 'SUFFICIENT', 'NOT_MET')] });
  var retest = snap({ hard_gates: [gate('serve_in_pct', 'min', 85, 60, 'NOT_MET', 'SUFFICIENT', 'NOT_MET')] }); // -10pp, still NOT_MET both times
  var r = PBRetest.evaluateRetest({ baseline: baseline, retest: retest, primaryBottleneck: 'hard_gate:serve_in_pct' });
  assert.strictEqual(r.response_state, 'NEGATIVE_RESPONSE');
})();

// ---- 5. Missing re-test evidence -> INCOMPLETE ----
(function () {
  var baseline = snap({ hard_gates: [gate('serve_in_pct', 'min', 85, 60, 'NOT_MET', 'SUFFICIENT', 'NOT_MET')] });
  var retest = snap({ hard_gates: [] }); // gate never captured at retest
  var r = PBRetest.evaluateRetest({ baseline: baseline, retest: retest, primaryBottleneck: 'hard_gate:serve_in_pct' });
  assert.strictEqual(r.response_state, 'INCOMPLETE');

  var r2 = PBRetest.evaluateRetest({ baseline: null, retest: null, primaryBottleneck: 'hard_gate:serve_in_pct' });
  assert.strictEqual(r2.response_state, 'INCOMPLETE');

  var r3 = PBRetest.evaluateRetest({ baseline: baseline, retest: retest, primaryBottleneck: null });
  assert.strictEqual(r3.response_state, 'INCOMPLETE');
})();

// ---- 6. Missing value must not become 0 ----
(function () {
  var baseline = snap({ capability_threshold_state: 'NOT_MET', capability_score: null }); // CAP INCOMPLETE at baseline
  var retest = snap({ capability_threshold_state: 'NOT_MET', capability_score: null });
  var r = PBRetest.classifyCapabilityBottleneckResponse(baseline, retest);
  // Both sides NOT_MET but capability_score is null on both -> cannot compute a numeric trend -> INCOMPLETE, never 0/STABLE.
  assert.strictEqual(r.response_state, 'INCOMPLETE');

  var evBaseline = snap({ evidence_state: 'INCOMPLETE', evidence_confidence: null });
  var evRetest = snap({ evidence_state: 'DETERMINED', evidence_confidence: 'C2' });
  var evR = PBRetest.classifyEvidenceBottleneckResponse(evBaseline, evRetest);
  assert.strictEqual(evR.response_state, 'INCOMPLETE'); // baseline evidence unverifiable, never treated as "worst tier"
})();

// ---- 7. Match Transfer changes must not change CAP / capability-bottleneck response ----
(function () {
  var baselineA = snap({ capability_threshold_state: 'MET', capability_score: 78, match_transfer_score: 40 });
  var retestA = snap({ capability_threshold_state: 'MET', capability_score: 85, match_transfer_score: 40 });
  var baselineB = snap({ capability_threshold_state: 'MET', capability_score: 78, match_transfer_score: 95 }); // match transfer changed
  var retestB = snap({ capability_threshold_state: 'MET', capability_score: 85, match_transfer_score: 5 });    // match transfer changed
  var rA = PBRetest.classifyCapabilityBottleneckResponse(baselineA, retestA);
  var rB = PBRetest.classifyCapabilityBottleneckResponse(baselineB, retestB);
  assert.deepStrictEqual(rA, rB);
  assert.strictEqual(rA.response_state, 'PARTIAL_RESPONSE'); // same MET tier, capability_score improved 78->85
})();

// ---- 8. Training metric improves but Match Transfer remains unconfirmed/incomplete: outputs stay separate ----
(function () {
  var baseline = snap({
    hard_gates: [gate('serve_in_pct', 'min', 85, 60, 'NOT_MET', 'SUFFICIENT', 'NOT_MET')],
    match_transfer_score: null, match_validation_required: true, match_validation_state: 'INCOMPLETE'
  });
  var retest = snap({
    hard_gates: [gate('serve_in_pct', 'min', 85, 92, 'MET', 'SUFFICIENT', 'MET')],
    match_transfer_score: null, match_validation_required: true, match_validation_state: 'INCOMPLETE'
  });
  var r = PBRetest.evaluateRetest({ baseline: baseline, retest: retest, primaryBottleneck: 'hard_gate:serve_in_pct' });
  assert.strictEqual(r.response_state, 'POSITIVE_RESPONSE'); // bottleneck-specific evidence resolved
  assert.strictEqual(r.match_transfer_response, 'INCOMPLETE'); // independent track, no match evidence at all

  // Match Transfer evidence present but not yet confirmed (still trending up) — still independent of the core response.
  var retest2 = snap({
    hard_gates: [gate('serve_in_pct', 'min', 85, 92, 'MET', 'SUFFICIENT', 'MET')],
    match_transfer_score: 55, match_validation_required: true, match_validation_state: 'NOT_MET'
  });
  var baseline2 = snap({
    hard_gates: [gate('serve_in_pct', 'min', 85, 60, 'NOT_MET', 'SUFFICIENT', 'NOT_MET')],
    match_transfer_score: 40, match_validation_required: true, match_validation_state: 'NOT_MET'
  });
  var r2 = PBRetest.evaluateRetest({ baseline: baseline2, retest: retest2, primaryBottleneck: 'hard_gate:serve_in_pct' });
  assert.strictEqual(r2.response_state, 'POSITIVE_RESPONSE');
  assert.strictEqual(r2.match_transfer_response, 'IMPROVING_NOT_CONFIRMED');
})();

// ---- 9. Multiple re-tests preserve chronological response_history (not overwritten) ----
(function () {
  var records = [
    { retest_id: 'rt_3', created_at: '2026-03-01T00:00:00.000Z', data: { retest_date: '2026-03-01', response_state: 'POSITIVE_RESPONSE', match_transfer_response: 'CONFIRMED' } },
    { retest_id: 'rt_1', created_at: '2026-01-01T00:00:00.000Z', data: { retest_date: '2026-01-01', response_state: 'NO_MEANINGFUL_CHANGE', match_transfer_response: 'INCOMPLETE' } },
    { retest_id: 'rt_2', created_at: '2026-02-01T00:00:00.000Z', data: { retest_date: '2026-02-01', response_state: 'PARTIAL_RESPONSE', match_transfer_response: 'NOT_CONFIRMED' } }
  ];
  var summary = PBRetest.summarizePrescriptionResponses(records);
  assert.strictEqual(summary.retest_count, 3);
  assert.deepStrictEqual(summary.response_history.map(function (h) { return h.retest_id; }), ['rt_1', 'rt_2', 'rt_3']);
  assert.strictEqual(summary.latest_response, 'POSITIVE_RESPONSE');
  assert.strictEqual(summary.prescription_effectiveness, 'EFFECTIVE');
})();

// ---- Effectiveness mapping ----
(function () {
  assert.strictEqual(PBRetest.mapResponseToEffectiveness('POSITIVE_RESPONSE'), 'EFFECTIVE');
  assert.strictEqual(PBRetest.mapResponseToEffectiveness('PARTIAL_RESPONSE'), 'PARTIALLY_EFFECTIVE');
  assert.strictEqual(PBRetest.mapResponseToEffectiveness('NO_MEANINGFUL_CHANGE'), 'NOT_EFFECTIVE');
  assert.strictEqual(PBRetest.mapResponseToEffectiveness('NEGATIVE_RESPONSE'), 'POSSIBLE_REGRESSION');
  assert.strictEqual(PBRetest.mapResponseToEffectiveness('INCOMPLETE'), 'INCOMPLETE');
})();

// ---- Reassessment signal: reuses S7-B validation_state, never invents a new formula ----
(function () {
  assert.strictEqual(PBRetest.determineReassessmentSignal('VALIDATION_ELIGIBLE', null), 'PROMOTION_REVIEW_ELIGIBLE');
  assert.strictEqual(PBRetest.determineReassessmentSignal('NOT_ELIGIBLE', 'POSITIVE_RESPONSE'), 'RETEST_RECOMMENDED');
  assert.strictEqual(PBRetest.determineReassessmentSignal('NOT_ELIGIBLE', 'NEGATIVE_RESPONSE'), 'NOT_READY');
  assert.strictEqual(PBRetest.determineReassessmentSignal('INCOMPLETE', null), 'INCOMPLETE');
  assert.strictEqual(PBRetest.determineReassessmentSignal(null, null), 'INCOMPLETE');
})();

// ---- Decimal training level / methodology guards ----
(function () {
  var TRAINING_LEVELS = [3.0, 3.5, 4.0, 4.5, 5.0];
  assert.strictEqual(typeof PBRetest.deriveValidatedLevel, 'undefined');
  assert.strictEqual(typeof PBRetest.promotePlayer, 'undefined');
  TRAINING_LEVELS.forEach(function (l) { assert.ok([3.0, 3.5, 4.0, 4.5, 5.0].indexOf(l) !== -1); });
})();

// ---- Integration: prescription linked to correct source review snapshot; retest linked to baseline+retest snapshots ----
function runIntegrationTest() {
  var baselineSnapshotData = snap({
    review_snapshot_id: null, assessment_id: 'asm_1', assessment_date: '2026-01-01',
    primary_bottleneck: 'hard_gate:serve_in_pct', bottleneck_state: 'DETERMINED', target_training_level: 4.0,
    hard_gates: [gate('serve_in_pct', 'min', 85, 60, 'NOT_MET', 'SUFFICIENT', 'NOT_MET')]
  });
  var retestSnapshotData = snap({
    review_snapshot_id: null, assessment_id: 'asm_2', assessment_date: '2026-02-01',
    primary_bottleneck: null, bottleneck_state: 'NONE', target_training_level: 4.0,
    hard_gates: [gate('serve_in_pct', 'min', 85, 92, 'MET', 'SUFFICIENT', 'MET')]
  });

  var db = { prescriptions: {}, retests: {}, reviewSnapshots: {} };
  db.reviewSnapshots.rev_baseline = { review_snapshot_id: 'rev_baseline', assessment_id: 'asm_1', generated_at: '2026-01-01T10:00:00.000Z', data: baselineSnapshotData };
  db.reviewSnapshots.rev_retest = { review_snapshot_id: 'rev_retest', assessment_id: 'asm_2', generated_at: '2026-02-01T10:00:00.000Z', data: retestSnapshotData };

  var uidCounter = 0;
  global.PBStore = {
    _uid: function (prefix) { uidCounter++; return prefix + '_' + uidCounter; },
    get: function (store, key) {
      if (store === 'review_snapshots') return Promise.resolve(db.reviewSnapshots[key] || null);
      if (store === 'prescriptions') return Promise.resolve(db.prescriptions[key] || null);
      if (store === 'retests') return Promise.resolve(db.retests[key] || null);
      return Promise.resolve(null);
    },
    put: function (store, obj) {
      db[store][obj[store === 'prescriptions' ? 'prescription_id' : (store === 'retests' ? 'retest_id' : 'review_snapshot_id')]] = obj;
      return Promise.resolve(obj);
    },
    getAll: function (store) {
      var key = store === 'review_snapshots' ? 'reviewSnapshots' : store;
      return Promise.resolve(Object.keys(db[key] || {}).map(function (k) { return db[key][k]; }));
    },
    createPrescription: function (opts) {
      var rec = {
        prescription_id: this._uid('rx'), assessment_id: opts.assessment_id,
        schema_version: '2.3.1', benchmark_version: '2.1.1', protocol_version: '2.2.1',
        generated_at: new Date().toISOString(), data: opts.data || {}, created_at: new Date().toISOString()
      };
      db.prescriptions[rec.prescription_id] = rec;
      return Promise.resolve(rec);
    },
    createRetest: function (opts) {
      var rec = {
        retest_id: this._uid('rt'), assessment_id: opts.assessment_id, prescription_id: opts.prescription_id || null,
        schema_version: '2.3.1', benchmark_version: '2.1.1', protocol_version: '2.2.1',
        generated_at: new Date().toISOString(), data: opts.data || {}, created_at: new Date().toISOString()
      };
      db.retests[rec.retest_id] = rec;
      return Promise.resolve(rec);
    }
  };
  global.PBStore.createPrescription = global.PBStore.createPrescription.bind(global.PBStore);
  global.PBStore.createRetest = global.PBStore.createRetest.bind(global.PBStore);

  delete require.cache[require.resolve('../js/retest-engine.js')];
  var PBRetestLive = require('../js/retest-engine.js');

  return PBRetestLive.issuePrescriptionFromSnapshot(db.reviewSnapshots.rev_baseline).then(function (rxRecord) {
    // ---- 10. Prescription linked to the correct source review snapshot ----
    assert.strictEqual(rxRecord.data.source_review_snapshot_id, 'rev_baseline');
    assert.strictEqual(rxRecord.data.source_assessment_id, 'asm_1');
    assert.strictEqual(rxRecord.data.player_id, 'plr_1');
    assert.strictEqual(rxRecord.data.target_level, 4.0);
    assert.strictEqual(rxRecord.data.primary_bottleneck, 'hard_gate:serve_in_pct');
    assert.strictEqual(rxRecord.data.status, 'ACTIVE');

    return PBRetestLive.recordRetest({
      player_id: 'plr_1',
      prescription_id: rxRecord.prescription_id,
      baseline_review_snapshot_id: 'rev_baseline',
      retest_review_snapshot_id: 'rev_retest',
      baseline_assessment_id: 'asm_1',
      retest_assessment_id: 'asm_2',
      retest_date: '2026-02-01'
    }).then(function (rtRecord) {
      // ---- 11. Re-test linked to both baseline and re-test snapshots ----
      assert.strictEqual(rtRecord.data.baseline_review_snapshot_id, 'rev_baseline');
      assert.strictEqual(rtRecord.data.retest_review_snapshot_id, 'rev_retest');
      assert.strictEqual(rtRecord.data.baseline_assessment_id, 'asm_1');
      assert.strictEqual(rtRecord.data.retest_assessment_id, 'asm_2');
      assert.strictEqual(rtRecord.prescription_id, rxRecord.prescription_id);
      // The linked prescription's own primary_bottleneck (not re-derived) drove the classification.
      assert.strictEqual(rtRecord.data.response_state, 'POSITIVE_RESPONSE');
      assert.strictEqual(rtRecord.data.bottleneck, 'hard_gate:serve_in_pct');

      return PBRetestLive.getPrescriptionRetestSummary(rxRecord.prescription_id);
    }).then(function (summary) {
      assert.strictEqual(summary.retest_count, 1);
      assert.strictEqual(summary.latest_response, 'POSITIVE_RESPONSE');
      console.log('retest-engine.test.js (integration): all assertions passed');
    });
  });
}

runIntegrationTest().then(function () {
  console.log('retest-engine.test.js: all assertions passed');
}).catch(function (err) {
  console.error('retest-engine.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
});
