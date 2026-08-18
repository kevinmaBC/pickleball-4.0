'use strict';
/* S6 Acceptance Gate — ancestry (T01), canonical/DB-baseline regression (T08, T09),
 * and the S6-specific forbidden-logic guards (T47, T48, T49): PBAssessmentExplainer
 * must never depend on PBStore/PBCanonical/PBTrainingAnalytics/PBPlayerTrainingState,
 * must never reference PBAssessmentClassifier's own internal comparator functions
 * (it only ever reads the booleans/numbers already present in a supplied s5Result),
 * and must contain no bottleneck/recommendation/prescription/P0-P6/promotion/DUPR/S7
 * vocabulary. Mirrors tests/s5/architecture_guard.test.js technique, re-pointed at
 * js/assessment-explainer.js and the S5 frozen base commit c5be57b. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const BASE_COMMIT = 'c5be57b8f597f999ac0faa503dbb4e3f8ccc6794';
const src = fs.readFileSync(path.join(ROOT, 'js', 'assessment-explainer.js'), 'utf8');
function codeOnly(s) { const headerEnd = s.indexOf('*/'); return headerEnd === -1 ? s : s.slice(headerEnd + 2); }
const code = codeOnly(src);

test('S6-T01: exact S5 ancestry — HEAD is a descendant of (or equal to) the frozen S5 base commit c5be57b', () => {
  const isAncestor = (() => {
    try {
      execSync(`git merge-base --is-ancestor ${BASE_COMMIT} HEAD`, { cwd: ROOT, stdio: 'ignore' });
      return true;
    } catch (e) {
      return false;
    }
  })();
  assert.ok(isAncestor, `HEAD must descend from the frozen S5 base commit ${BASE_COMMIT}`);
});

test('S6-T08: canonical 13/35 still unchanged after S6 work', () => {
  const seedData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'canonical', 'seed_data.json'), 'utf8'));
  assert.equal(seedData.masters.length, 13);
  assert.equal(seedData.drills.length, 35);
});

test('S6-T09: no IndexedDB schema/version change — DB_VERSION and the full STORES key set are exactly the S5 baseline', () => {
  const storageSrc = fs.readFileSync(path.join(ROOT, 'js', 'storage.js'), 'utf8');
  const versionMatch = storageSrc.match(/var DB_VERSION = (\d+);/);
  assert.ok(versionMatch, 'DB_VERSION assignment found');
  assert.equal(versionMatch[1], '2', 'DB_VERSION must remain 2 — S6 introduces no new store');

  const storeNameMatches = [...storageSrc.matchAll(/^\s{4}(\w+):\s*\{ keyPath:/gm)].map((m) => m[1]);
  assert.deepEqual(
    storeNameMatches.sort(),
    ['assessments', 'drill_evidence_events', 'players', 'test_sessions', 'training_sessions', 'trial_events'].sort(),
    'exactly the S5 baseline stores — no new object store introduced'
  );
});

test('S6-T49: assessment-explainer.js never references PBStore/PBCanonical/PBTrainingAnalytics/PBPlayerTrainingState/indexedDB — no storage dependency of any kind', () => {
  const forbiddenIdentifiers = ['PBStore', 'PBCanonical', 'PBTrainingAnalytics', 'PBPlayerTrainingState', 'indexedDB', 'pbStore', 'pbCanonical', 'pbTrainingAnalytics'];
  forbiddenIdentifiers.forEach((needle) => {
    assert.ok(!code.includes(needle), 'assessment-explainer.js must never reference ' + needle);
  });
});

test('S6-T48: no bottleneck/recommendation/prescription/P0-P6/promotion/DUPR/S7 vocabulary anywhere in assessment-explainer.js', () => {
  assert.ok(!code.toLowerCase().includes('bottleneck'), '"bottleneck" must never appear');
  assert.ok(!code.toLowerCase().includes('recommend'), '"recommend" must never appear');
  assert.ok(!code.toLowerCase().includes('prescri'), '"prescri*" must never appear');
  assert.doesNotMatch(code, /\bP[0-6]\b/, 'no standalone P0-P6 planning tokens');
  assert.ok(!code.toLowerCase().includes('promot'), '"promot*" (promotion workflow) must never appear');
  assert.ok(!code.toLowerCase().includes('dupr'), '"dupr" must never appear');
  assert.doesNotMatch(code, /\bS7\b/, '"S7" must never appear (outside this guard file itself)');
});

test('S6-T47: no independent re-derivation of S5 pass/fail logic — assessment-explainer.js never fetches/loads config, never reads PBAssessmentClassifier internals, and never assigns classification_status/level_status from anything other than a direct read of the supplied s5Result', () => {
  assert.ok(!code.includes('fetch('), 'assessment-explainer.js must be pure/sync — no fetch of any kind (S6_CONSTRUCTION_PACKAGE: consume S5 output, do not reproduce S5 classifier logic)');
  assert.ok(!code.includes('PBAssessmentClassifier'), 'must never reference the S5 module directly — only the plain s5Result object passed in');
  assert.match(code, /classification_status:\s*status,/, 'the only classification_status assignment must be exactly the local `status` variable, itself read verbatim from s5Result.level_status');
});

test('S6: still no package.json / lockfiles / node_modules / bundler config anywhere in the repository', () => {
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

test('S6: frozen S5 module and frozen config authorities remain byte-unmodified (git diff empty against tracked baseline)', () => {
  const diff = execSync(`git diff --name-only -- js/assessment-classifier.js schemas/scoring_engine_reference_v2_3_1.py data/level_gates_v2_3_1.json data/evidence_confidence_v2_3_1.json`, { cwd: ROOT }).toString().trim();
  assert.equal(diff, '', 'frozen S5 module and methodology authorities must show zero diff: ' + diff);
});
