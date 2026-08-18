'use strict';
/* S3 Acceptance Gate — Drill observation grouping (S3-T12, T13, T14, T15, T16). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildEnv, addTrials } = require('./helpers/build_env.js');

// Independent re-read of the authority file, not through the module under test — mirrors S2-T14's pattern.
const authority = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'handoff', 'phase0-s0', 'seed_data.json'), 'utf8'));

test('S3-T12/T16: by_drill contains exactly the 35 canonical Drill ids, in frozen canonical order', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1' });
  const ids = snap.by_drill.map((r) => r.source_drill_id);
  assert.deepEqual(ids, authority.drills.map((d) => d.source_drill_id));
});

test('S3-T13: Drill->Master mapping matches canonical ownership exactly, cross-checked independently against seed_data.json', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1' });

  const expectedOwner = {};
  authority.masters.forEach((m) => m.source_drill_ids.forEach((did) => { expectedOwner[did] = m.master_id; }));

  snap.by_drill.forEach((row) => {
    assert.equal(row.master_id, expectedOwner[row.source_drill_id], row.source_drill_id + ' master mismatch');
  });
  // Spot check a couple of specific, hand-verified pairs.
  assert.equal(snap.by_drill.find((r) => r.source_drill_id === 'DRILL-BALANCE').master_id, 'FM-01');
  assert.equal(snap.by_drill.find((r) => r.source_drill_id === 'DRILL-MATCH-RULES').master_id, 'SM-01');
});

test('S3-T14: primary_kpi identifier is copied exactly from canonical data', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1' });
  const byId = {};
  snap.by_drill.forEach((r) => { byId[r.source_drill_id] = r; });
  authority.drills.forEach((d) => {
    assert.equal(byId[d.source_drill_id].primary_kpi, d.primary_kpi);
  });
});

test('S3-T15: secondary KPI parsing of the ";"-delimited canonical string is deterministic', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  assert.deepEqual(env.pbTrainingAnalytics._parseSecondaryKpis('KPI-A; KPI-B'), ['KPI-A', 'KPI-B']);
  assert.deepEqual(env.pbTrainingAnalytics._parseSecondaryKpis('KPI-X'), ['KPI-X']);
  assert.deepEqual(env.pbTrainingAnalytics._parseSecondaryKpis(''), []);
  assert.deepEqual(env.pbTrainingAnalytics._parseSecondaryKpis(undefined), []);

  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1' });
  const byId = {};
  snap.by_drill.forEach((r) => { byId[r.source_drill_id] = r; });
  authority.drills.forEach((d) => {
    const expected = d.secondary_kpis.split(';').map((s) => s.trim()).filter((s) => s.length > 0);
    assert.deepEqual(byId[d.source_drill_id].secondary_kpi_ids, expected, d.source_drill_id);
  });
});

test('Drill order stays frozen regardless of the order evidence was recorded in', async () => {
  const env = await buildEnv([{ player_id: 'plr_2', display_name: 'P2' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_2', session_date: '2026-08-01' });
  // Record evidence in reverse-canonical drill order.
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-MATCH-RULES', ['S']);
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S']);

  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_2' });
  const ids = snap.by_drill.map((r) => r.source_drill_id);
  assert.deepEqual(ids, authority.drills.map((d) => d.source_drill_id), 'insertion order must not affect output order');
});
