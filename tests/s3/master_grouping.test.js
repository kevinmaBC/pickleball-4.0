'use strict';
/* S3 Acceptance Gate — Master observation grouping (S3-T17, T18, T19, T20). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildEnv, addTrials } = require('./helpers/build_env.js');

const authority = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'handoff', 'phase0-s0', 'seed_data.json'), 'utf8'));

test('S3-T17/T20: all 13 canonical Masters are represented, in frozen canonical order', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1' });
  const ids = snap.by_master.map((r) => r.master_id);
  assert.deepEqual(ids, authority.masters.map((m) => m.master_id));
  assert.equal(snap.by_master.length, 13);
});

test('S3-T18: Master evidence coverage counts are exact', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  // Evidence in exactly 2 of 13 masters: FM-01 (via DRILL-BALANCE) and FM-02 (via DRILL-SERVE-DEPTH).
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S']);
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-SERVE-DEPTH', ['P']);

  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1' });
  assert.equal(snap.coverage.master_count_with_evidence, 2);
  assert.equal(snap.coverage.master_count_without_evidence, 11);
  assert.equal(snap.coverage.drill_count_with_evidence, 2);
  assert.equal(snap.coverage.drill_count_without_evidence, 33);
});

test('S3-T19: Master aggregate reconciles exactly to the sum of its constituent Drill groups', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  // FM-01 has 4 drills; put evidence on 2 of them with different outcome mixes.
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S', 'S', 'F']);
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-GRIP', ['P', 'I']);

  const snap = await env.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_1' });
  const fm01 = snap.by_master.find((r) => r.master_id === 'FM-01');
  const constituents = snap.by_drill.filter((r) => r.master_id === 'FM-01');

  const summed = constituents.reduce((acc, r) => ({
    outcome_S_count: acc.outcome_S_count + r.outcome_S_count,
    outcome_P_count: acc.outcome_P_count + r.outcome_P_count,
    outcome_F_count: acc.outcome_F_count + r.outcome_F_count,
    outcome_I_count: acc.outcome_I_count + r.outcome_I_count,
    trial_count_total: acc.trial_count_total + r.trial_count_total
  }), { outcome_S_count: 0, outcome_P_count: 0, outcome_F_count: 0, outcome_I_count: 0, trial_count_total: 0 });

  assert.equal(fm01.outcome_S_count, summed.outcome_S_count);
  assert.equal(fm01.outcome_P_count, summed.outcome_P_count);
  assert.equal(fm01.outcome_F_count, summed.outcome_F_count);
  assert.equal(fm01.outcome_I_count, summed.outcome_I_count);
  assert.equal(fm01.trial_count_total, summed.trial_count_total);
  assert.equal(fm01.trial_count_total, 5);
});
