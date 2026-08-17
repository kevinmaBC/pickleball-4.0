'use strict';
/* S2 Acceptance Gate — outcome/trial_no/timestamp/raw_json validation and the
 * frozen uniqueness rule (training_session_id + source_drill_id + trial_no)
 * (S2-T15, S2-T16, plus the additional owner-mandated duplicate-trial guard). */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createModule } = require(path.join(__dirname, '..', '..', 'js', 'training-evidence.js'));
const { createFakeStore } = require(path.join(__dirname, 'helpers', 'fake_store.js'));
const { createReadyFacade } = require(path.join(__dirname, 'helpers', 'canonical_facade.js'));

async function makeModule() {
  const pbStore = createFakeStore([{ player_id: 'plr_1' }]);
  const pbCanonical = await createReadyFacade();
  const module = createModule({ pbStore: pbStore, pbCanonical: pbCanonical });
  const session = await module.createSession({ player_id: 'plr_1' });
  return { module: module, session: session };
}

test('S2-T15: S/P/F/I are all accepted', async () => {
  const { module, session } = await makeModule();
  const outcomes = ['S', 'P', 'F', 'I'];
  for (let i = 0; i < outcomes.length; i++) {
    const e = await module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: i + 1, outcome: outcomes[i] });
    assert.equal(e.outcome, outcomes[i]);
  }
});

test('S2-T16: an invalid outcome is rejected', async () => {
  const { module, session } = await makeModule();
  await assert.rejects(
    module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'X' }),
    /outcome must be one of S \| P \| F \| I/
  );
  await assert.rejects(
    module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: undefined }),
    /outcome must be one of/
  );
});

test('trial_no must be a positive integer', async () => {
  const { module, session } = await makeModule();
  for (const bad of [0, -1, 1.5, 'a', null, undefined]) {
    await assert.rejects(
      module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: bad, outcome: 'S' }),
      /trial_no must be a positive integer/
    );
  }
});

test('video_timestamp_ms accepts null or a non-negative integer, rejects negative/non-integer', async () => {
  const { module, session } = await makeModule();
  const ok1 = await module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'S', video_timestamp_ms: null });
  assert.equal(ok1.video_timestamp_ms, null);
  const ok2 = await module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 2, outcome: 'S', video_timestamp_ms: 0 });
  assert.equal(ok2.video_timestamp_ms, 0);
  await assert.rejects(
    module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 3, outcome: 'S', video_timestamp_ms: -5 }),
    /video_timestamp_ms must be a non-negative integer/
  );
  await assert.rejects(
    module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 4, outcome: 'S', video_timestamp_ms: 1.5 }),
    /video_timestamp_ms must be a non-negative integer/
  );
});

test('raw_json must be a plain object; defaults to {} when omitted', async () => {
  const { module, session } = await makeModule();
  const defaulted = await module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'S' });
  assert.deepStrictEqual(defaulted.raw_json, {});
  await assert.rejects(
    module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 2, outcome: 'S', raw_json: ['not', 'an', 'object'] }),
    /raw_json must be a plain object/
  );
  await assert.rejects(
    module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 3, outcome: 'S', raw_json: 'nope' }),
    /raw_json must be a plain object/
  );
});

test('owner-mandated uniqueness: duplicate (training_session_id, source_drill_id, trial_no) is rejected deterministically', async () => {
  const { module, session } = await makeModule();
  await module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'S' });
  await assert.rejects(
    module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'F' }),
    /duplicate trial_no 1 for source_drill_id "DRILL-BALANCE"/
  );
});

test('uniqueness is scoped per (session, drill) — same trial_no is allowed for a different drill in the same session', async () => {
  const { module, session } = await makeModule();
  await module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'S' });
  const e2 = await module.addEvidence({ training_session_id: session.training_session_id, source_drill_id: 'DRILL-SERVE-DEPTH', trial_no: 1, outcome: 'S' });
  assert.equal(e2.trial_no, 1);
  assert.equal(e2.source_drill_id, 'DRILL-SERVE-DEPTH');
});

test('uniqueness is scoped per session — same (drill, trial_no) is allowed in a different training session', async () => {
  const pbStoreHelper = require(path.join(__dirname, 'helpers', 'fake_store.js'));
  const canonicalHelper = require(path.join(__dirname, 'helpers', 'canonical_facade.js'));
  const pbStore = pbStoreHelper.createFakeStore([{ player_id: 'plr_1' }]);
  const pbCanonical = await canonicalHelper.createReadyFacade();
  const module = createModule({ pbStore: pbStore, pbCanonical: pbCanonical });
  const s1 = await module.createSession({ player_id: 'plr_1' });
  const s2 = await module.createSession({ player_id: 'plr_1' });
  await module.addEvidence({ training_session_id: s1.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'S' });
  const e = await module.addEvidence({ training_session_id: s2.training_session_id, source_drill_id: 'DRILL-BALANCE', trial_no: 1, outcome: 'S' });
  assert.equal(e.training_session_id, s2.training_session_id);
});
