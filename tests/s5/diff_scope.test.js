'use strict';
/* S5 Test Matrix T63: the full working-tree diff against the frozen S4 base commit is
 * limited to exactly the approved S5 Construction Package scope — no other S0-S4 file was
 * touched. Mirrors the git-status discipline every prior S-phase's completion report
 * performs manually, but as an automated, re-runnable guard. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const BASE_COMMIT = 'cb8b67a5b9b28c34f64b4efe93ca61de08e49e23';

const ALLOWED_MODIFIED = new Set(['index.html', 'sw.js']);
const ALLOWED_NEW_PREFIXES = ['js/assessment-classifier.js', 'tests/s5/', 'docs/handoff/phase0-s5/'];

function isAllowedNew(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  return ALLOWED_NEW_PREFIXES.some((p) => norm === p || norm.startsWith(p));
}

test('S5-T63: modified (tracked) files against the S4 base commit are exactly index.html and sw.js — no other S0-S4 file changed', () => {
  const diffOut = execSync(`git diff --name-only ${BASE_COMMIT}`, { cwd: ROOT }).toString().trim();
  const changed = diffOut ? diffOut.split('\n') : [];
  const unexpected = changed.filter((f) => !ALLOWED_MODIFIED.has(f));
  assert.deepEqual(unexpected, [], 'unexpected modified files outside the S5 Construction Package scope: ' + JSON.stringify(unexpected));
});

test('S5-T63: every new (untracked) file falls under js/assessment-classifier.js, tests/s5/, or docs/handoff/phase0-s5/', () => {
  const statusOut = execSync('git status --porcelain', { cwd: ROOT }).toString();
  const untracked = statusOut.split('\n')
    .filter((line) => line.startsWith('??'))
    .map((line) => line.slice(3).trim());
  const offenders = [];
  untracked.forEach((entry) => {
    // a "??" directory entry (e.g. "tests/s5/") represents everything under it — check the
    // directory path itself; individual-file "??" entries are checked directly.
    if (!isAllowedNew(entry)) offenders.push(entry);
  });
  assert.deepEqual(offenders, [], 'unexpected new/untracked paths outside the S5 Construction Package scope: ' + JSON.stringify(offenders));
});

test('nothing is staged for commit', () => {
  const staged = execSync('git diff --name-only --cached', { cwd: ROOT }).toString().trim();
  assert.equal(staged, '', 'no file should be staged during S5 implementation');
});
