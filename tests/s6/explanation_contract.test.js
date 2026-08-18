'use strict';
/* S6 Test Matrix T10-T15, T31-T32, T42-T44: explanation.classification_status agrees
 * with the real S5 level_status for all five reachable statuses (INCOMPLETE,
 * LOW_CONFIDENCE, PASS, BORDERLINE, FAIL); S6 can never override it; summary.reason_code
 * is exact for each status; blocker reason codes are exact and never bottleneck
 * vocabulary; missing_inputs is exact on INCOMPLETE. */
const test = require('node:test');
const assert = require('node:assert/strict');

const { classifyAndExplain, LEVEL_GATES } = require('./helpers/s5_fixture.js');

const GOOD_COMPONENTS = { technical_score: 95, decision_score: 95, pressure_score: 95 };
const GOOD_METRICS_40 = { serve_in_pct: 97, return_quality_pct: 80, drop_ball_quality_pct: 75, reset_ball_quality_pct: 70, shot_selection_pct: 85, pressure_success_pct: 75, ue_per_game: 2 };

test('S6-T10/T13/T42: INCOMPLETE — explanation.classification_status agrees with S5, reason_code exact, missing_inputs exact, hard_gates empty, capability.status null', () => {
  const { s5Result, explanation } = classifyAndExplain('3.0', {
    target_level: 3.0,
    metrics: {},
    component_scores: { technical_score: 90, decision_score: null, pressure_score: 90 },
    evidence_confidence: 'C4'
  });
  assert.equal(s5Result.level_status, 'INCOMPLETE');
  assert.equal(explanation.classification_status, 'INCOMPLETE');
  assert.equal(explanation.summary.reason_code, 'INCOMPLETE_INPUT');
  assert.deepEqual(explanation.hard_gates, []);
  assert.equal(explanation.capability.status, null);
  assert.deepEqual(explanation.missing_inputs, s5Result.missing_inputs);
  assert.ok(explanation.missing_inputs.includes('decision_score'));
});

test('S6-T11/T32: LOW_CONFIDENCE — explanation.classification_status agrees with S5, reason_code exact, blocking_reasons exact and contains no bottleneck vocabulary', () => {
  const { s5Result, explanation } = classifyAndExplain('4.0', {
    target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS,
    evidence_confidence: 'C2', match_transfer_score: 100
  });
  assert.equal(s5Result.level_status, 'LOW_CONFIDENCE');
  assert.equal(explanation.classification_status, 'LOW_CONFIDENCE');
  assert.equal(explanation.summary.reason_code, 'EVIDENCE_BELOW_MINIMUM');
  assert.deepEqual(explanation.blocking_reasons, ['EVIDENCE_BELOW_MINIMUM']);
  assert.ok(!JSON.stringify(explanation).toLowerCase().includes('bottleneck'));
});

test('S6-T12/T44: PASS — explanation.classification_status agrees with S5, reason_code exact, blocking_reasons empty', () => {
  const { s5Result, explanation } = classifyAndExplain('4.0', {
    target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS,
    evidence_confidence: 'C4', match_transfer_score: 100
  });
  assert.equal(s5Result.level_status, 'PASS');
  assert.equal(explanation.classification_status, 'PASS');
  assert.equal(explanation.summary.reason_code, 'PASS_ALL_REQUIREMENTS');
  assert.deepEqual(explanation.blocking_reasons, []);
});

test('S6-T14/T43: BORDERLINE — explanation.classification_status agrees with S5, reason_code exact, blocking_reasons empty (no failed gate exists in a BORDERLINE result)', () => {
  const cfg = LEVEL_GATES.levels['4.0'];
  const allPassMetrics = {};
  Object.keys(cfg.hard_gates).forEach((gateKey) => {
    const isMax = gateKey.endsWith('_max');
    const sourceKey = isMax ? gateKey.slice(0, -4) : gateKey;
    const threshold = cfg.hard_gates[gateKey].threshold;
    allPassMetrics[sourceKey] = isMax ? Math.max(0, threshold - 1) : threshold + 1;
  });
  const cmin = cfg.capability_min;
  const x = cmin - 5; // exact borderline band boundary, mirrors tests/s5/classification_status.test.js T34
  const { s5Result, explanation } = classifyAndExplain('4.0', {
    target_level: 4.0, metrics: allPassMetrics,
    component_scores: { technical_score: x, decision_score: x, pressure_score: x },
    evidence_confidence: 'C4', match_transfer_score: 100
  });
  assert.equal(s5Result.level_status, 'BORDERLINE');
  assert.equal(explanation.classification_status, 'BORDERLINE');
  assert.equal(explanation.summary.reason_code, 'BORDERLINE_CLASSIFICATION');
  assert.deepEqual(explanation.blocking_reasons, []);
});

test('S6-T15/T31: FAIL (hard gate) — explanation.classification_status agrees with S5, reason_code HARD_GATE_FAIL, blocker reason codes exact per gate direction', () => {
  const badMetrics = Object.assign({}, GOOD_METRICS_40, { reset_ball_quality_pct: 61 }); // required 65 (MIN gate)
  const { s5Result, explanation } = classifyAndExplain('4.0', {
    target_level: 4.0, metrics: badMetrics, component_scores: GOOD_COMPONENTS,
    evidence_confidence: 'C4', match_transfer_score: 100
  });
  assert.equal(s5Result.level_status, 'FAIL');
  assert.equal(explanation.classification_status, 'FAIL');
  assert.equal(explanation.summary.reason_code, 'HARD_GATE_FAIL');
  const failedGate = explanation.hard_gates.find((g) => g.metric === 'reset_ball_quality_pct');
  assert.equal(failedGate.status, 'FAIL');
  assert.equal(failedGate.direction, 'MIN');
  assert.equal(failedGate.reason_code, 'GATE_BELOW_MINIMUM');
  assert.ok(explanation.blocking_reasons.includes('GATE_BELOW_MINIMUM:reset_ball_quality_pct'));
});

test('S6-T15: S6 can never override level_status — classification_status is always a strict verbatim copy of s5Result.level_status across every reachable status', () => {
  const fixtures = [
    ['3.0', { target_level: 3.0, metrics: {}, component_scores: { technical_score: 90, decision_score: null, pressure_score: 90 }, evidence_confidence: 'C4' }],
    ['4.0', { target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C2', match_transfer_score: 100 }],
    ['4.0', { target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 100 }],
    ['4.0', { target_level: 4.0, metrics: Object.assign({}, GOOD_METRICS_40, { reset_ball_quality_pct: 61 }), component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 100 }],
    ['4.0', { target_level: 4.0, metrics: GOOD_METRICS_40, component_scores: GOOD_COMPONENTS, evidence_confidence: 'C4', match_transfer_score: 69 }]
  ];
  fixtures.forEach(([label, input]) => {
    const { s5Result, explanation } = classifyAndExplain(label, input);
    assert.equal(explanation.classification_status, s5Result.level_status, `explanation must never diverge from S5's own level_status for ${JSON.stringify(input)}`);
  });
});
