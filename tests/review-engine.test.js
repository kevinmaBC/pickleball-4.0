/* tests/review-engine.test.js — S7-B: Review Snapshot Engine (pure functions)
 * Run: node tests/review-engine.test.js
 */
var assert = require('assert');

global.PBNamespace = require('../js/namespace.js');
delete require.cache[require.resolve('../js/review-engine.js')];
var PBReview = require('../js/review-engine.js');

// ---- 1. CAP formula: T=80, D=70, P=60 -> 72 ----
(function () {
  var r = PBReview.computeCAP(80, 70, 60);
  assert.strictEqual(r.capability_score, 72);
  assert.strictEqual(r.capability_state, 'OK');
})();

// ---- 2. Missing Pressure -> CAP INCOMPLETE (never 0) ----
(function () {
  var r = PBReview.computeCAP(80, 70, null);
  assert.strictEqual(r.capability_score, null);
  assert.strictEqual(r.capability_state, 'INCOMPLETE');
})();
(function () {
  var r = PBReview.computeCAP(null, 70, 60); // missing Technical too
  assert.strictEqual(r.capability_score, null);
  assert.strictEqual(r.capability_state, 'INCOMPLETE');
})();
(function () {
  var r = PBReview.computeCAP(80, null, 60); // missing Decision
  assert.strictEqual(r.capability_score, null);
  assert.strictEqual(r.capability_state, 'INCOMPLETE');
})();

// ---- 3. Match Transfer score changes -> CAP unchanged (computeCAP has no match-transfer input at all) ----
(function () {
  assert.strictEqual(PBReview.computeCAP.length, 3, 'computeCAP must only take technical/decision/pressure');
  var a = PBReview.computeCAP(80, 70, 60);
  var b = PBReview.computeCAP(80, 70, 60); // simulate two snapshots differing only in match_transfer_score elsewhere
  assert.strictEqual(a.capability_score, b.capability_score);
})();

// ---- 4. Decimal Training Level never generated ----
(function () {
  assert.deepStrictEqual(PBReview.VALIDATED_LEVELS, [3.0, 3.5, 4.0, 4.5, 5.0]);
  PBReview.VALIDATED_LEVELS.forEach(function (lvl) {
    assert.ok([3.0, 3.5, 4.0, 4.5, 5.0].indexOf(lvl) !== -1);
  });
  // The engine must never expose a level-derivation function (proves no decimal-level logic exists).
  assert.strictEqual(typeof PBReview.deriveValidatedLevel, 'undefined');
  assert.strictEqual(typeof PBReview.validated_training_level, 'undefined');
})();

// ---- 5. Unknown/missing required evidence -> INCOMPLETE, never 0 ----
(function () {
  var tech = PBReview.computeTechnicalDomain({});
  assert.strictEqual(tech.score, null);
  assert.strictEqual(tech.state, 'INCOMPLETE');

  var dec = PBReview.computeDecisionDomain({});
  assert.strictEqual(dec.score, null);
  assert.strictEqual(dec.state, 'INCOMPLETE');

  var pres = PBReview.computePressureDomain({});
  assert.strictEqual(pres.score, null);
  assert.strictEqual(pres.state, 'INCOMPLETE');

  var gate = PBReview.evalHardGate('serve_in_pct', { threshold: 85 }, null, null, 5, null);
  assert.strictEqual(gate.status, 'INCOMPLETE');
  assert.strictEqual(gate.current_value, null);

  var ev = PBReview.determineEvidenceConfidence(null, null);
  assert.strictEqual(ev.evidence_confidence, null);
  assert.strictEqual(ev.evidence_state, 'INCOMPLETE');
})();

// T08 Decision Guard: even with data present, must be SIMPLIFIED, never claimed as full SSS2.0.
(function () {
  var dec = PBReview.computeDecisionDomain({ T08: { quality_pct: 88 } });
  assert.strictEqual(dec.score, 88);
  assert.strictEqual(dec.state, 'SIMPLIFIED');
  assert.deepStrictEqual(dec.contributing_tests, ['ASMT-08']);
})();

// Technical domain: explicit averaging over the fixed technical-category test set, canonical IDs surfaced.
(function () {
  var tech = PBReview.computeTechnicalDomain({ T01: { quality_pct: 90 }, T02: { quality_pct: 80 } });
  assert.strictEqual(tech.score, 85);
  assert.strictEqual(tech.state, 'OK');
  assert.deepStrictEqual(tech.contributing_tests, ['ASMT-01', 'ASMT-02']);
})();

// ---- 6. Minimum-direction hard gate: correct MET / BORDERLINE / NOT_MET ----
(function () {
  var cfg = { threshold: 85, min_trials: 40 };
  var met = PBReview.evalHardGate('serve_in_pct', cfg, 90, 40, 5, 'ASMT-01');
  assert.strictEqual(met.direction, 'min');
  assert.strictEqual(met.status, 'MET');

  var borderline = PBReview.evalHardGate('serve_in_pct', cfg, 82, 40, 5, 'ASMT-01'); // within 85-5..85
  assert.strictEqual(borderline.status, 'BORDERLINE');

  var notMet = PBReview.evalHardGate('serve_in_pct', cfg, 70, 40, 5, 'ASMT-01');
  assert.strictEqual(notMet.status, 'NOT_MET');
})();

// ---- 7. Maximum-direction hard gate: correct direction (lower-is-better, e.g. ue_per_game_max) ----
(function () {
  var cfg = { threshold: 9, min_games: 2 };
  var met = PBReview.evalHardGate('ue_per_game_max', cfg, 7, 2, 5, 'match');
  assert.strictEqual(met.direction, 'max');
  assert.strictEqual(met.status, 'MET'); // lower is better: 7 <= 9

  var borderline = PBReview.evalHardGate('ue_per_game_max', cfg, 12, 2, 5, 'match'); // within 9..14
  assert.strictEqual(borderline.status, 'BORDERLINE');

  var notMet = PBReview.evalHardGate('ue_per_game_max', cfg, 20, 2, 5, 'match');
  assert.strictEqual(notMet.status, 'NOT_MET');
})();

// ---- 8. Insufficient sample -> not formally MET (downgraded to BORDERLINE even though value clears threshold) ----
(function () {
  var cfg = { threshold: 85, min_trials: 40 };
  var g = PBReview.evalHardGate('serve_in_pct', cfg, 95, 10, 5, 'ASMT-01'); // value clearly MET but only 10/40 trials
  assert.strictEqual(g.sample_ok, false);
  assert.notStrictEqual(g.status, 'MET');
  assert.strictEqual(g.status, 'BORDERLINE');
})();

// ---- 9. Required match validation missing -> INCOMPLETE ----
(function () {
  var r = PBReview.evalMatchValidation(true, 70, null);
  assert.strictEqual(r.required, true);
  assert.strictEqual(r.state, 'INCOMPLETE');
})();
(function () {
  // Not required at all: still exposed as INCOMPLETE per the snapshot's default shape, never fabricated MET.
  var r = PBReview.evalMatchValidation(false, null, null);
  assert.strictEqual(r.required, false);
  assert.strictEqual(r.state, 'INCOMPLETE');
})();
(function () {
  var metR = PBReview.evalMatchValidation(true, 70, 75);
  assert.strictEqual(metR.state, 'MET');
  var notMetR = PBReview.evalMatchValidation(true, 70, 50);
  assert.strictEqual(notMetR.state, 'NOT_MET');
})();

// ---- 10. Failed hard gate -> eligible as primary bottleneck candidate ----
(function () {
  var gates = [
    PBReview.evalHardGate('serve_in_pct', { threshold: 85, min_trials: 40 }, 60, 40, 5, 'ASMT-01'), // NOT_MET, deficit 25
    PBReview.evalHardGate('return_in_pct', { threshold: 80, min_trials: 40 }, 78, 40, 5, 'ASMT-02')  // BORDERLINE
  ];
  var b = PBReview.determinePrimaryBottleneck({
    hardGates: gates,
    capabilityThresholdState: 'MET',
    matchValidationRequired: false,
    matchValidationState: 'INCOMPLETE',
    evidenceState: 'DETERMINED',
    evidenceConfidence: 'C2',
    evidenceMin: 'C2'
  });
  assert.strictEqual(b.bottleneck_state, 'DETERMINED');
  assert.strictEqual(b.primary_bottleneck, 'hard_gate:serve_in_pct');
})();

// Bottleneck picks the largest deficit among multiple failed gates.
(function () {
  var gates = [
    PBReview.evalHardGate('serve_in_pct', { threshold: 85 }, 80, null, 5, 'ASMT-01'),   // BORDERLINE, not a failed gate
    PBReview.evalHardGate('return_in_pct', { threshold: 80 }, 30, null, 5, 'ASMT-02')   // NOT_MET, deficit 50 -> the failed gate
  ];
  var b = PBReview.determinePrimaryBottleneck({ hardGates: gates, capabilityThresholdState: 'MET', matchValidationRequired: false, matchValidationState: 'INCOMPLETE', evidenceState: 'DETERMINED', evidenceConfidence: 'C2', evidenceMin: 'C2' });
  assert.strictEqual(b.primary_bottleneck, 'hard_gate:return_in_pct');
})();

// No bottleneck when everything passes -> NONE, not INCOMPLETE (positive case is distinct from "unknown").
(function () {
  var b = PBReview.determinePrimaryBottleneck({
    hardGates: [PBReview.evalHardGate('serve_in_pct', { threshold: 85 }, 95, 40, 5, 'ASMT-01')],
    capabilityThresholdState: 'MET',
    matchValidationRequired: false,
    matchValidationState: 'INCOMPLETE',
    evidenceState: 'DETERMINED',
    evidenceConfidence: 'C2',
    evidenceMin: 'C2'
  });
  assert.strictEqual(b.primary_bottleneck, null);
  assert.strictEqual(b.bottleneck_state, 'NONE');
})();

// ---- Hard-gate aggregate state priority: NOT_MET > INCOMPLETE > BORDERLINE > MET ----
(function () {
  assert.strictEqual(PBReview.aggregateHardGateState([]), 'INCOMPLETE');
  assert.strictEqual(PBReview.aggregateHardGateState([{ status: 'MET' }, { status: 'BORDERLINE' }]), 'BORDERLINE');
  assert.strictEqual(PBReview.aggregateHardGateState([{ status: 'MET' }, { status: 'INCOMPLETE' }]), 'INCOMPLETE');
  assert.strictEqual(PBReview.aggregateHardGateState([{ status: 'NOT_MET' }, { status: 'INCOMPLETE' }]), 'NOT_MET');
  assert.strictEqual(PBReview.aggregateHardGateState([{ status: 'MET' }, { status: 'MET' }]), 'MET');
})();

// ---- Capability threshold ----
(function () {
  assert.strictEqual(PBReview.evalCapabilityThreshold('OK', 80, 76).state, 'MET');
  assert.strictEqual(PBReview.evalCapabilityThreshold('OK', 70, 76).state, 'NOT_MET');
  assert.strictEqual(PBReview.evalCapabilityThreshold('INCOMPLETE', null, 76).state, 'INCOMPLETE');
})();

// ---- Evidence confidence: C2 only when >=2 test dates AND >=2 games; else C1 baseline; never C3/C4 in S7-B ----
(function () {
  assert.strictEqual(PBReview.determineEvidenceConfidence(1, 1).evidence_confidence, 'C1');
  assert.strictEqual(PBReview.determineEvidenceConfidence(2, 2).evidence_confidence, 'C2');
  assert.strictEqual(PBReview.determineEvidenceConfidence(5, 5).evidence_confidence, 'C2'); // capped at C2, never C3/C4
  assert.strictEqual(PBReview.determineEvidenceConfidence(0, 0).evidence_confidence, 'C1');
})();

// ---- Validation eligibility ----
(function () {
  var allPass = PBReview.evalValidationEligibility({
    capabilityThresholdState: 'MET', hardGateState: 'MET',
    evidenceState: 'DETERMINED', evidenceConfidence: 'C2', evidenceMin: 'C2',
    matchValidationRequired: false, matchValidationState: 'INCOMPLETE'
  });
  assert.strictEqual(allPass, 'VALIDATION_ELIGIBLE');

  var failedGate = PBReview.evalValidationEligibility({
    capabilityThresholdState: 'MET', hardGateState: 'NOT_MET',
    evidenceState: 'DETERMINED', evidenceConfidence: 'C2', evidenceMin: 'C2',
    matchValidationRequired: false, matchValidationState: 'INCOMPLETE'
  });
  assert.strictEqual(failedGate, 'NOT_ELIGIBLE');

  var unknownEvidence = PBReview.evalValidationEligibility({
    capabilityThresholdState: 'MET', hardGateState: 'MET',
    evidenceState: 'INCOMPLETE', evidenceConfidence: null, evidenceMin: 'C2',
    matchValidationRequired: false, matchValidationState: 'INCOMPLETE'
  });
  assert.strictEqual(unknownEvidence, 'INCOMPLETE');

  var insufficientEvidenceRank = PBReview.evalValidationEligibility({
    capabilityThresholdState: 'MET', hardGateState: 'MET',
    evidenceState: 'DETERMINED', evidenceConfidence: 'C1', evidenceMin: 'C2',
    matchValidationRequired: false, matchValidationState: 'INCOMPLETE'
  });
  assert.strictEqual(insufficientEvidenceRank, 'NOT_ELIGIBLE');

  var missingMatchValidation = PBReview.evalValidationEligibility({
    capabilityThresholdState: 'MET', hardGateState: 'MET',
    evidenceState: 'DETERMINED', evidenceConfidence: 'C2', evidenceMin: 'C2',
    matchValidationRequired: true, matchValidationState: 'INCOMPLETE'
  });
  assert.strictEqual(missingMatchValidation, 'INCOMPLETE');
})();

// ---- buildMetricToTest derives from test_definitions data, not a hardcoded duplicate table ----
(function () {
  var map = PBReview.buildMetricToTest({
    tests: {
      T01: { metrics: { serve_in_pct: {} } },
      T09: { metrics: { pressure_success_pct: {} } }
    }
  });
  assert.strictEqual(map.serve_in_pct, 'T01');
  assert.strictEqual(map.pressure_success_pct, 'T09');
})();

// ---- countDistinctDates ----
(function () {
  assert.strictEqual(PBReview.countDistinctDates([
    { started_at: '2026-01-01T10:00:00.000Z' },
    { started_at: '2026-01-01T14:00:00.000Z' },
    { started_at: '2026-01-05T10:00:00.000Z' }
  ]), 2);
  assert.strictEqual(PBReview.countDistinctDates([]), 0);
})();

// ---- Regression guard (section 21): forbidden methodology must never appear in the engine source ----
(function () {
  var fs = require('fs');
  var src = fs.readFileSync(require.resolve('../js/review-engine.js'), 'utf8').toLowerCase();
  // Note: bare "dupr" is intentionally excluded — the file's own compliance comment
  // ("do not introduce DUPR/Internal DUPR/DUPR Gap") legitimately contains that substring.
  var forbidden = ['internal_dupr', 'dupr_gap', '.dupr', 'training_dose', 'drop_apex', 'auto_promot', '0.35', '35/25/20/20'];
  forbidden.forEach(function (token) {
    assert.ok(src.indexOf(token) === -1, 'forbidden token found in review-engine.js: ' + token);
  });
  // exact frozen CAP weights
  assert.strictEqual(PBReview.CAP_WEIGHTS.technical, 0.45);
  assert.strictEqual(PBReview.CAP_WEIGHTS.decision, 0.30);
  assert.strictEqual(PBReview.CAP_WEIGHTS.pressure, 0.25);
})();

console.log('review-engine.test.js: all assertions passed');
