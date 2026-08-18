'use strict';
/* S4 Acceptance Gate — canonical/DB-baseline regression (T06, T07), no-write
 * guard (T34), no-scoring/no-forbidden-logic guards (T20, T35, T36, T37),
 * and no-npm/framework guard (T41). Mirrors tests/s3/architecture_guard.test.js
 * technique exactly, re-pointed at js/player-training-state.js and extended
 * for S4's specific field-name collisions: the module legitimately contains
 * the literal field names `recommended_block_id`/`primary_bottleneck`/
 * `secondary_bottleneck` for pass-through, so the guard checks that
 * "recommend"/"bottleneck" never appear *outside* those exact field names,
 * rather than banning the substrings outright the way S3 could. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildEnv, addTrials } = require('./helpers/build_env.js');

const ROOT = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'js', 'player-training-state.js'), 'utf8');
function codeOnly(s) { const headerEnd = s.indexOf('*/'); return headerEnd === -1 ? s : s.slice(headerEnd + 2); }
const code = codeOnly(src);

test('S4-T06 (canonical regression): canonical 13/35 still unchanged after S4 work', () => {
  const seedData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'canonical', 'seed_data.json'), 'utf8'));
  assert.equal(seedData.masters.length, 13);
  assert.equal(seedData.drills.length, 35);
});

test('S4-T07: no IndexedDB schema/version change — DB_VERSION and the full STORES key set are exactly the S3 baseline', () => {
  const storageSrc = fs.readFileSync(path.join(ROOT, 'js', 'storage.js'), 'utf8');
  const versionMatch = storageSrc.match(/var DB_VERSION = (\d+);/);
  assert.ok(versionMatch, 'DB_VERSION assignment found');
  assert.equal(versionMatch[1], '2', 'DB_VERSION must remain 2 — S4 introduces no new store');

  const storeNameMatches = [...storageSrc.matchAll(/^\s{4}(\w+):\s*\{ keyPath:/gm)].map((m) => m[1]);
  assert.deepEqual(
    storeNameMatches.sort(),
    ['assessments', 'drill_evidence_events', 'players', 'test_sessions', 'training_sessions', 'trial_events'].sort(),
    'exactly the S3 baseline stores — no new object store introduced'
  );
});

test('S4-T34 (static): player-training-state.js source never calls PBStore write/delete methods', () => {
  assert.doesNotMatch(code, /pbStore\.put\(/, 'must never call pbStore.put');
  assert.doesNotMatch(code, /pbStore\.del\(/, 'must never call pbStore.del');
  assert.doesNotMatch(code, /pbStore\.clearAll\(/, 'must never call pbStore.clearAll');
});

test('S4-T34 (behavioral): getPlayerTrainingState never triggers a write/delete even when the underlying store would throw on one', async () => {
  const env = await buildEnv([{ player_id: 'plr_1', display_name: 'P1' }]);
  const session = await env.pbTrainingEvidence.createSession({ player_id: 'plr_1', session_date: '2026-08-01' });
  await addTrials(env.pbTrainingEvidence, session.training_session_id, 'DRILL-BALANCE', ['S']);

  const guardedStore = Object.assign({}, env.pbStore, {
    put: () => { throw new Error('put() must never be called by PBPlayerTrainingState'); },
    del: () => { throw new Error('del() must never be called by PBPlayerTrainingState'); }
  });
  const factory = require(path.join(ROOT, 'js', 'player-training-state.js'));
  const guardedState = factory.createModule({ pbStore: guardedStore, pbCanonical: env.pbCanonical, pbTrainingAnalytics: env.pbTrainingAnalytics });
  const snap = await guardedState.getPlayerTrainingState({ player_id: 'plr_1' });
  assert.equal(snap.training_state.analytics.overall.trial_count_total, 1, 'computation still succeeds using only read methods');
});

test('S4-T20/T35/T36: no capability score / validated-level / confidence / gate / weighting formulas from scoring_engine_reference are ported or reimplemented', () => {
  const forbiddenSubstrings = [
    'capability_score(', 'gate_pass(', 'classify(', 'validated_level(', 'dupr_context(',
    'EVIDENCE_RANK', 'hard_gates', 'capability_min', 'evidence_min', 'gate_threshold',
    'scoring_engine_reference',
    // capability_score formula weights from schemas/scoring_engine_reference_v2_3_1.py
    '0.45', '0.30', '0.25',
    'readiness', 'confidence_score', 'pass_fail', 'passfail', 'ranking', 'rank_', 'weight'
  ];
  forbiddenSubstrings.forEach((needle) => {
    assert.ok(!code.toLowerCase().includes(needle.toLowerCase()), 'forbidden keyword found in player-training-state.js: ' + needle);
  });
});

test('S4-T37: no recommendation/prescription/promotion/P0-P6 logic — "recommend" and "bottleneck" appear only as the frozen pass-through field names', () => {
  assert.doesNotMatch(code, /prescri/i, 'no prescription logic');
  assert.doesNotMatch(code, /promot/i, 'no promotion logic');
  assert.doesNotMatch(code, /\bP[0-6]\b/, 'no standalone P0-P6 planning tokens');

  // "recommend" is legitimate only inside the literal field name recommended_block_id.
  const withoutFieldName = code.replace(/recommended_block_id/g, '');
  assert.doesNotMatch(withoutFieldName, /recommend/i, '"recommend" must not appear outside the recommended_block_id pass-through field name');

  // "bottleneck" is legitimate only inside primary_bottleneck / secondary_bottleneck.
  const withoutBottleneckFields = code.replace(/primary_bottleneck/g, '').replace(/secondary_bottleneck/g, '');
  assert.doesNotMatch(withoutBottleneckFields, /bottleneck/i, '"bottleneck" must not appear outside the frozen pass-through field names');
});

test('S4-T41: still no package.json / lockfiles / node_modules / bundler config anywhere in the repository', () => {
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
