'use strict';
/* S3 Acceptance Gate — no-mutation guard, no-schema-change guard, no-scoring
 * guard, no-npm/framework guard (S3-T33, T34, T35, T39). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildEnv, addTrials } = require('./helpers/build_env.js');

const ROOT = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'training-analytics.js'), 'utf8');

test('S3-T33 (static): training-analytics.js source never calls PBStore write/delete methods', () => {
  const headerEnd = src.indexOf('*/');
  const code = headerEnd === -1 ? src : src.slice(headerEnd + 2);
  assert.doesNotMatch(code, /pbStore\.put\(/, 'must never call pbStore.put');
  assert.doesNotMatch(code, /pbStore\.del\(/, 'must never call pbStore.del');
  assert.doesNotMatch(code, /pbStore\.clearAll\(/, 'must never call pbStore.clearAll');
});

test('S3-T33 (behavioral): computeSnapshot never triggers a write/delete even when the underlying store would throw on one', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S', 'P', 'F', 'I']);

  const guardedStore = Object.assign({}, env.pbStore, {
    put: () => { throw new Error('put() must never be called by PBTrainingAnalytics'); },
    del: () => { throw new Error('del() must never be called by PBTrainingAnalytics'); }
  });
  const trainingAnalyticsFactory = require(path.join(ROOT, 'js', 'training-analytics.js'));
  const guardedAnalytics = trainingAnalyticsFactory.createModule({ pbStore: guardedStore, pbCanonical: env.pbCanonical });

  const snap = await guardedAnalytics.computeSnapshot({ player_id: 'plr_1' });
  assert.equal(snap.overall.trial_count_total, 4, 'computation still succeeds using only read methods');
});

test('S3-T34: no IndexedDB schema/version change — DB_VERSION and the full STORES key set are exactly the S2 baseline', () => {
  const storageSrc = fs.readFileSync(path.join(ROOT, 'js', 'storage.js'), 'utf8');
  const versionMatch = storageSrc.match(/var DB_VERSION = (\d+);/);
  assert.ok(versionMatch, 'DB_VERSION assignment found');
  assert.equal(versionMatch[1], '2', 'DB_VERSION must remain 2 — S3 introduces no derived-metrics store');

  const storeNameMatches = [...storageSrc.matchAll(/^\s{4}(\w+):\s*\{ keyPath:/gm)].map((m) => m[1]);
  assert.deepEqual(
    storeNameMatches.sort(),
    ['assessments', 'drill_evidence_events', 'players', 'test_sessions', 'training_sessions', 'trial_events'].sort(),
    'exactly the S2 baseline stores — no new object store introduced'
  );
});

test('S3-T35: training-analytics.js contains no scoring/threshold/pass-fail/recommendation/promotion/P0-P6 logic', () => {
  const headerEnd = src.indexOf('*/');
  const code = headerEnd === -1 ? src : src.slice(headerEnd + 2);
  const forbiddenSubstrings = [
    'recommend', 'prescri', 'promot', 'capability_score', 'readiness', 'confidence_score',
    'bottleneck', 'today_screen', 'gate_threshold', 'validated_training_level',
    'threshold', 'pass_fail', 'passfail', 'weight', 'ranking', 'rank_'
  ];
  forbiddenSubstrings.forEach((needle) => {
    assert.ok(!code.toLowerCase().includes(needle), 'forbidden keyword found in training-analytics.js: ' + needle);
  });
  assert.doesNotMatch(code, /\bP[0-6]\b/, 'no standalone P0-P6 planning tokens in training-analytics.js code (outside the disclaiming header comment)');
});

test('S3-T39: still no package.json / lockfiles / node_modules / bundler config anywhere in the repository', () => {
  function walk(dir, out) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  }
  const files = walk(ROOT, []);
  const basenames = files.map((f) => path.basename(f));
  assert.deepStrictEqual(basenames.filter((f) => f === 'package.json'), []);
  ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'webpack.config.js', 'vite.config.js'].forEach((name) => {
    assert.ok(!basenames.includes(name), 'forbidden architecture file present: ' + name);
  });
  assert.ok(!fs.existsSync(path.join(ROOT, 'node_modules')));
});

test('S3-T27 (canonical regression): canonical 13/35 still unchanged after S3 work', () => {
  const seedData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'canonical', 'seed_data.json'), 'utf8'));
  assert.equal(seedData.masters.length, 13);
  assert.equal(seedData.drills.length, 35);
});
