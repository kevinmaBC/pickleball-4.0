'use strict';
/* S3 Acceptance Gate — determinism and stable sorting (S3-T31, T32). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEnv, addTrials } = require('./helpers/build_env.js');

test('S3-T31: identical filter input produces a deep-equal snapshot across repeated calls', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S', 'P', 'F', 'I']);
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-RESET-TOUCH', ['S', 'S']);

  const filter = { player_id: 'plr_1', date_from: '2026-01-01', date_to: '2026-12-31' };
  const snapA = await env.pbTrainingAnalytics.computeSnapshot(filter);
  const snapB = await env.pbTrainingAnalytics.computeSnapshot(filter);
  assert.deepStrictEqual(snapA, snapB);
});

test('S3-T32: by_drill/by_master/by_kpi stay in frozen canonical/lexicographic order regardless of evidence insertion order', async () => {
  const forward = await buildEnv([{ player_id: 'plr_fwd', display_name: 'Fwd' }]);
  const sessF = await forward.pbTrainingEvidence.createSession({ player_id: 'plr_fwd', session_date: '2026-08-01' });
  await addTrials(forward.pbTrainingEvidence, sessF.training_session_id, 'DRILL-BALANCE', ['S']);
  await addTrials(forward.pbTrainingEvidence, sessF.training_session_id, 'DRILL-RESET-TOUCH', ['P']);
  await addTrials(forward.pbTrainingEvidence, sessF.training_session_id, 'DRILL-MATCH-RULES', ['F']);

  const reverse = await buildEnv([{ player_id: 'plr_rev', display_name: 'Rev' }]);
  const sessR = await reverse.pbTrainingEvidence.createSession({ player_id: 'plr_rev', session_date: '2026-08-01' });
  await addTrials(reverse.pbTrainingEvidence, sessR.training_session_id, 'DRILL-MATCH-RULES', ['F']);
  await addTrials(reverse.pbTrainingEvidence, sessR.training_session_id, 'DRILL-RESET-TOUCH', ['P']);
  await addTrials(reverse.pbTrainingEvidence, sessR.training_session_id, 'DRILL-BALANCE', ['S']);

  const snapFwd = await forward.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_fwd' });
  const snapRev = await reverse.pbTrainingAnalytics.computeSnapshot({ player_id: 'plr_rev' });

  assert.deepEqual(snapFwd.by_drill.map((r) => r.source_drill_id), snapRev.by_drill.map((r) => r.source_drill_id));
  assert.deepEqual(snapFwd.by_master.map((r) => r.master_id), snapRev.by_master.map((r) => r.master_id));
  assert.deepEqual(snapFwd.by_kpi.map((r) => r.kpi_id), snapRev.by_kpi.map((r) => r.kpi_id));
  assert.deepEqual(snapFwd.by_kpi.map((r) => r.kpi_id), [...snapFwd.by_kpi.map((r) => r.kpi_id)].sort());
});
