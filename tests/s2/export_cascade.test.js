'use strict';
/* S2 Acceptance Gate — deterministic export, cascade delete, and the
 * "no canonical definitions copied into records" guarantee
 * (S2-T19, S2-T20, S2-T21). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createModule } = require(path.join(__dirname, '..', '..', 'js', 'training-evidence.js'));
const { createFakeStore } = require(path.join(__dirname, 'helpers', 'fake_store.js'));
const { createReadyFacade } = require(path.join(__dirname, 'helpers', 'canonical_facade.js'));

const EVIDENCE_FIELDS = [
  'drill_evidence_id', 'training_session_id', 'source_drill_id', 'master_id', 'trial_no',
  'outcome', 'scenario_id', 'target', 'quality', 'notes', 'video_timestamp_ms', 'raw_json', 'created_at'
].sort();

const SESSION_FIELDS = [
  'training_session_id', 'player_id', 'session_date', 'started_at', 'ended_at', 'notes',
  'canonical_schema_version', 'created_at'
].sort();

async function makeModule() {
  const pbStore = createFakeStore([{ player_id: 'plr_1', display_name: 'Alice' }]);
  const pbCanonical = await createReadyFacade();
  const module = createModule({ pbStore: pbStore, pbCanonical: pbCanonical });
  return { module: module, pbStore: pbStore };
}

test('S2-T19: exportSession is deterministic and sorts evidence by trial_no', async () => {
  const { module } = await makeModule();
  const s = await module.createSession({ player_id: 'plr_1' });
  await module.addEvidence({ training_session_id: s.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 3, outcome: 'S' });
  await module.addEvidence({ training_session_id: s.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'F' });
  await module.addEvidence({ training_session_id: s.training_session_id, source_drill_id: 'DRILL-SERVE-DEPTH', trial_no: 2, outcome: 'P' });

  const out1 = await module.exportSession(s.training_session_id);
  const out2 = await module.exportSession(s.training_session_id);
  assert.deepStrictEqual(out1.drill_evidence_events.map((e) => e.trial_no), [1, 2, 3]);
  assert.deepStrictEqual(out2.drill_evidence_events.map((e) => e.drill_evidence_id), out1.drill_evidence_events.map((e) => e.drill_evidence_id));
  assert.equal(out1.training_session.training_session_id, s.training_session_id);
  assert.equal(out1.player.player_id, 'plr_1');
  assert.equal(out1.export_meta.format, 'pb_training_evidence_export_v1');
});

test('S2-T21: exported rows contain only canonical identifiers + raw observation fields — no copied Drill/Master definitions', async () => {
  const { module } = await makeModule();
  const s = await module.createSession({ player_id: 'plr_1' });
  await module.addEvidence({ training_session_id: s.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'S', target: 'x', quality: 'high' });

  const out = await module.exportSession(s.training_session_id);
  assert.deepStrictEqual(Object.keys(out.drill_evidence_events[0]).sort(), EVIDENCE_FIELDS);
  assert.deepStrictEqual(Object.keys(out.training_session).sort(), SESSION_FIELDS);

  // Explicitly assert absence of canonical Drill/Master shape keys.
  const forbidden = ['progression', 'purpose', 'setup', 'feed', 'dose', 'success_criterion', 'primary_kpi', 'secondary_kpis', 'evidence', 'match_transfer', 'source_drill_ids', 'class', 'level_range'];
  forbidden.forEach((k) => {
    assert.ok(!(k in out.drill_evidence_events[0]), 'forbidden canonical field leaked into evidence: ' + k);
  });
});

test('S2-T20: deleteSession cascades to its drill_evidence_events and leaves other sessions untouched', async () => {
  const { module, pbStore } = await makeModule();
  const s1 = await module.createSession({ player_id: 'plr_1' });
  const s2 = await module.createSession({ player_id: 'plr_1' });
  await module.addEvidence({ training_session_id: s1.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'S' });
  await module.addEvidence({ training_session_id: s1.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 2, outcome: 'F' });
  await module.addEvidence({ training_session_id: s2.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'S' });

  await module.deleteSession(s1.training_session_id);

  const s1Evidence = await module.evidenceBySession(s1.training_session_id);
  assert.deepStrictEqual(s1Evidence, []);
  const s1Row = await pbStore.get('training_sessions', s1.training_session_id);
  assert.equal(s1Row, undefined);

  const s2Evidence = await module.evidenceBySession(s2.training_session_id);
  assert.equal(s2Evidence.length, 1);
  const s2Row = await pbStore.get('training_sessions', s2.training_session_id);
  assert.ok(s2Row);
});
