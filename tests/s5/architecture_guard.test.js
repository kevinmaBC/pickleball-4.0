'use strict';
/* S5 Acceptance Gate — ancestry (T01), canonical/DB-baseline regression (T07, T08),
 * no-npm/framework guard, and the S5-specific forbidden-logic guards (T48-T56):
 * PBAssessmentClassifier must never depend on PBStore/PBCanonical/PBTrainingAnalytics/
 * PBPlayerTrainingState (T48, and by construction T49/T50/T55), and must contain no
 * bottleneck/recommendation/prescription/P0-P6/promotion/DUPR logic (T51-T54) and no
 * IndexedDB/schema change (T56). Mirrors tests/s3/architecture_guard.test.js and
 * tests/s4/architecture_guard.test.js technique, re-pointed at
 * js/assessment-classifier.js. Unlike S3/S4's guard, S5's forbidden list does NOT
 * include "threshold"/"weight"/"gate"/"pass_fail" — those are the legitimate,
 * required vocabulary of a gate/capability-score classifier and are exactly what
 * S5 is authorized to implement (S5_SCOPE.md MAY-calculate items 1-2). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const BASE_COMMIT = 'cb8b67a5b9b28c34f64b4efe93ca61de08e49e23';
const src = fs.readFileSync(path.join(ROOT, 'js', 'assessment-classifier.js'), 'utf8');
function codeOnly(s) { const headerEnd = s.indexOf('*/'); return headerEnd === -1 ? s : s.slice(headerEnd + 2); }
const code = codeOnly(src);

test('S5-T01: exact S4 ancestry — HEAD is an descendant of (or equal to) the frozen S4 base commit', () => {
  const isAncestor = (() => {
    try {
      execSync(`git merge-base --is-ancestor ${BASE_COMMIT} HEAD`, { cwd: ROOT, stdio: 'ignore' });
      return true;
    } catch (e) {
      return false;
    }
  })();
  assert.ok(isAncestor, `HEAD must descend from the frozen S4 base commit ${BASE_COMMIT}`);
});

test('S5-T07 (canonical regression): canonical 13/35 still unchanged after S5 work', () => {
  const seedData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'canonical', 'seed_data.json'), 'utf8'));
  assert.equal(seedData.masters.length, 13);
  assert.equal(seedData.drills.length, 35);
});

test('S5-T08: no IndexedDB schema/version change — DB_VERSION and the full STORES key set are exactly the S4 baseline', () => {
  const storageSrc = fs.readFileSync(path.join(ROOT, 'js', 'storage.js'), 'utf8');
  const versionMatch = storageSrc.match(/var DB_VERSION = (\d+);/);
  assert.ok(versionMatch, 'DB_VERSION assignment found');
  assert.equal(versionMatch[1], '2', 'DB_VERSION must remain 2 — S5 introduces no new store');

  const storeNameMatches = [...storageSrc.matchAll(/^\s{4}(\w+):\s*\{ keyPath:/gm)].map((m) => m[1]);
  assert.deepEqual(
    storeNameMatches.sort(),
    ['assessments', 'drill_evidence_events', 'players', 'test_sessions', 'training_sessions', 'trial_events'].sort(),
    'exactly the S4 baseline stores — no new object store introduced'
  );
});

test('S5-T48/T55/T56: assessment-classifier.js never references PBStore/PBCanonical/PBTrainingAnalytics/PBPlayerTrainingState/indexedDB — no storage dependency of any kind', () => {
  const forbiddenIdentifiers = ['PBStore', 'PBCanonical', 'PBTrainingAnalytics', 'PBPlayerTrainingState', 'indexedDB', 'pbStore', 'pbCanonical', 'pbTrainingAnalytics'];
  forbiddenIdentifiers.forEach((needle) => {
    assert.ok(!code.includes(needle), 'assessment-classifier.js must never reference ' + needle);
  });
});

test('S5-T49: no S3 training-rate -> formal-metric mapping — no S/P/F/I outcome-count or trial/evidence-aggregation vocabulary', () => {
  const forbidden = ['outcome_S_count', 'outcome_P_count', 'outcome_F_count', 'outcome_I_count',
    'trial_count', 'drill_evidence', 'computeSnapshot', 'trialsBySession', 'by_drill', 'by_master', 'by_kpi'];
  forbidden.forEach((needle) => {
    assert.ok(!code.includes(needle), 'assessment-classifier.js must not reference S3 training-analytics vocabulary: ' + needle);
  });
});

test('S5-T50: no evidence-confidence derivation — evidence_confidence is read as an explicit input, never computed from counts/dates/sessions', () => {
  // The only place "evidence_confidence" may appear is as an explicit input field name being
  // read (input.evidence_confidence) or echoed into a diagnostic object — never assigned to
  // from an expression involving counts, lengths, or dates.
  assert.doesNotMatch(code, /evidence_confidence\s*=\s*(?!.*input\.)/, 'evidence_confidence must never be computed/assigned, only read from explicit input');
  ['session_date', 'test_dates', '.length >=', 'daysSince', 'dateDiff'].forEach((needle) => {
    assert.ok(!code.includes(needle), 'no count/date-driven confidence-derivation vocabulary: ' + needle);
  });
});

test('S5-T51: no bottleneck-inference vocabulary anywhere in assessment-classifier.js', () => {
  assert.ok(!code.toLowerCase().includes('bottleneck'), '"bottleneck" must never appear in assessment-classifier.js');
});

test('S5-T52: no recommendation/prescription generation vocabulary anywhere in assessment-classifier.js', () => {
  assert.ok(!code.toLowerCase().includes('recommend'), '"recommend" must never appear in assessment-classifier.js');
  assert.ok(!code.toLowerCase().includes('prescri'), '"prescri*" must never appear in assessment-classifier.js');
});

test('S5-T53: no P0-P6 / promotion-workflow vocabulary anywhere in assessment-classifier.js', () => {
  assert.doesNotMatch(code, /\bP[0-6]\b/, 'no standalone P0-P6 planning tokens');
  assert.ok(!code.toLowerCase().includes('promot'), '"promot*" (promotion workflow) must never appear');
});

test('S5-T54: no DUPR interpretation/arithmetic vocabulary anywhere in assessment-classifier.js', () => {
  assert.ok(!code.toLowerCase().includes('dupr'), '"dupr" must never appear in assessment-classifier.js');
});

function stripAllComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
}

test('S5-T51-T54 (data authority check): prescription_rules_v2_3_1.json and evidence_confidence_v2_3_1.json are never actually read/required/fetched by assessment-classifier.js CODE (mentions in explanatory comments disclaiming this are expected and fine)', () => {
  const codeNoComments = stripAllComments(code);
  assert.ok(!codeNoComments.includes('prescription_rules'), 'assessment-classifier.js must never load prescription_rules_v2_3_1.json (S8 boundary)');
  assert.ok(!codeNoComments.includes('evidence_confidence_v2_3_1.json'), 'evidence_confidence_v2_3_1.json is input-domain reference only — never fetched at runtime by executable code');
});

test('S5: still no package.json / lockfiles / node_modules / bundler config anywhere in the repository', () => {
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

test('S5: Frozen Python Reference and Frozen JSON authority are byte-unmodified (git diff empty against tracked baseline)', () => {
  const diff = execSync(`git diff --name-only -- schemas/scoring_engine_reference_v2_3_1.py data/level_gates_v2_3_1.json data/evidence_confidence_v2_3_1.json`, { cwd: ROOT }).toString().trim();
  assert.equal(diff, '', 'frozen methodology authorities must show zero diff: ' + diff);
});
