'use strict';
/* S2 Acceptance Gate — static IndexedDB schema/version checks (S2-T04, S2-T07, S2-T08).
 * The mandatory *real-browser* migration proof (S2-T05/T06) is performed
 * separately and is not replaced by this static source check. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'storage.js'), 'utf8');

test('S2-T04: DB_VERSION is 2', () => {
  const m = src.match(/var DB_VERSION = (\d+);/);
  assert.ok(m, 'DB_VERSION assignment found');
  assert.equal(m[1], '2');
});

test('existing four stores are still declared with unchanged keyPaths (additive migration)', () => {
  assert.match(src, /players:\s*\{\s*keyPath:\s*'player_id'/);
  assert.match(src, /assessments:\s*\{\s*keyPath:\s*'assessment_id'/);
  assert.match(src, /test_sessions:\s*\{\s*keyPath:\s*'test_session_id'/);
  assert.match(src, /trial_events:\s*\{\s*keyPath:\s*'trial_event_id'/);
});

test('S2-T07: training_sessions store declared with required indexes', () => {
  assert.match(src, /training_sessions:\s*\{\s*keyPath:\s*'training_session_id'/);
  assert.match(src, /\['by_player', 'player_id'\]/);
  assert.match(src, /\['by_session_date', 'session_date'\]/);
});

test('S2-T08: drill_evidence_events store declared with required indexes', () => {
  assert.match(src, /drill_evidence_events:\s*\{\s*keyPath:\s*'drill_evidence_id'/);
  assert.match(src, /\['by_training_session', 'training_session_id'\]/);
  assert.match(src, /\['by_source_drill', 'source_drill_id'\]/);
  assert.match(src, /\['by_master', 'master_id'\]/);
});

test('onupgradeneeded remains a create-if-missing loop over STORES (no destructive branch)', () => {
  assert.match(src, /if \(!db\.objectStoreNames\.contains\(name\)\)/);
  assert.doesNotMatch(src, /deleteObjectStore/);
});

test('PBStore module still loads cleanly in Node (no top-level indexedDB access at require time)', () => {
  const PBStore = require(path.join(__dirname, '..', '..', 'js', 'storage.js'));
  assert.equal(PBStore.DB_NAME, 'pb_v2');
  assert.equal(PBStore.DB_VERSION, 2);
});
