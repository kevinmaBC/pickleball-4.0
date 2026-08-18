'use strict';
/* S3 Acceptance Gate — KPI observation grouping (S3-T21, T22, T23). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildEnv, addTrials } = require('./helpers/build_env.js');

const authority = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'handoff', 'phase0-s0', 'seed_data.json'), 'utf8'));

function expectedKpiIdSet() {
  const set = {};
  authority.drills.forEach((d) => {
    set[d.primary_kpi] = true;
    d.secondary_kpis.split(';').map((s) => s.trim()).filter((s) => s.length > 0).forEach((k) => { set[k] = true; });
  });
  return Object.keys(set).sort();
}

test('S3-T21: KPI groups derive only from canonical ids (independently cross-checked against seed_data.json)', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1' });
  const ids = snap.by_kpi.map((r) => r.kpi_id);
  assert.deepEqual(ids, expectedKpiIdSet());
  assert.deepEqual(ids, [...ids].sort(), 'by_kpi must be lexicographically sorted by kpi_id');
});

test('S3-T22: KPI Drill sets are exact and structural (unaffected by which evidence exists)', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1' });
  const byId = {};
  snap.by_kpi.forEach((r) => { byId[r.kpi_id] = r; });

  // KPI-FOUND: primary for exactly the 4 FM-01 drills, no secondary role anywhere.
  const found = byId['KPI-FOUND'];
  assert.deepEqual(found.primary_for_drill_ids, ['DRILL-BALANCE', 'DRILL-BALANCE-BREATH', 'DRILL-GRIP', 'DRILL-READY']);
  assert.deepEqual(found.secondary_for_drill_ids, []);
  assert.deepEqual(found.referenced_drill_ids, ['DRILL-BALANCE', 'DRILL-BALANCE-BREATH', 'DRILL-GRIP', 'DRILL-READY']);

  // KPI-TARGET: never a primary_kpi anywhere in canonical data, only ever secondary.
  const target = byId['KPI-TARGET'];
  assert.deepEqual(target.primary_for_drill_ids, []);
  assert.ok(target.secondary_for_drill_ids.includes('DRILL-DRIVE-5TH'));
  assert.ok(target.secondary_for_drill_ids.includes('DRILL-TARGET'));
  assert.equal(target.evidence_bearing_drill_ids.length, 0, 'no evidence recorded yet');

  // referenced_drill_ids is canonical-order, not insertion order.
  assert.deepEqual(target.referenced_drill_ids, [...target.referenced_drill_ids].sort((a, b) => {
    const order = authority.drills.map((d) => d.source_drill_id);
    return order.indexOf(a) - order.indexOf(b);
  }));
});

test('S3-T22: evidence_bearing_drill_ids reflects filtered evidence; referenced_drill_ids does not change', async () => {
  const env = await buildEnv([{ player_id: 'plr_2', display_name: 'P2' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_2', session_date: '2026-08-01' });
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-TARGET', ['S']);

  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_2' });
  const target = snap.by_kpi.find((r) => r.kpi_id === 'KPI-TARGET');
  assert.deepEqual(target.evidence_bearing_drill_ids, ['DRILL-TARGET']);
  assert.equal(target.trial_count_total, 1);
  assert.ok(target.referenced_drill_ids.length > 1, 'referenced set is the full canonical set, not narrowed to evidence-bearing drills');
});

test('S3-T23: no KPI threshold/weight/score field ever appears on a by_kpi row', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1' });
  const allowedKeys = new Set([
    'kpi_id', 'primary_for_drill_ids', 'secondary_for_drill_ids', 'referenced_drill_ids', 'evidence_bearing_drill_ids',
    'trial_count_total', 'outcome_S_count', 'outcome_P_count', 'outcome_F_count', 'outcome_I_count', 'valid_trial_count',
    'S_rate_total', 'P_rate_total', 'F_rate_total', 'I_rate_total', 'S_rate_valid', 'P_rate_valid', 'F_rate_valid'
  ]);
  snap.by_kpi.forEach((row) => {
    Object.keys(row).forEach((k) => assert.ok(allowedKeys.has(k), 'unexpected field on by_kpi row: ' + k));
  });
});
