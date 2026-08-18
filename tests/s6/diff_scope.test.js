'use strict';
/* S6 Test Matrix T52: the full working-tree diff against the frozen S5 base commit is
 * limited to exactly the approved S6 Construction Package scope — no other S0-S5 file
 * was touched. Mirrors tests/s5/diff_scope.test.js technique. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const BASE_COMMIT = 'c5be57b8f597f999ac0faa503dbb4e3f8ccc6794';

const ALLOWED_MODIFIED = new Set(['index.html', 'sw.js']);
const ALLOWED_NEW_PREFIXES = ['js/assessment-explainer.js', 'tests/s6/', 'docs/handoff/phase0-s6/'];

function isAllowedNew(relPath) {
  const norm = relPath.replace(/\\/g, '/');
  return ALLOWED_NEW_PREFIXES.some((p) => norm === p || norm.startsWith(p));
}

test('S6-T52: modified (tracked) files against the S5 base commit are exactly index.html and sw.js — no other S0-S5 file changed', () => {
  const diffOut = execSync(`git diff --name-only ${BASE_COMMIT}`, { cwd: ROOT }).toString().trim();
  const changed = diffOut ? diffOut.split('\n') : [];
  const unexpected = changed.filter((f) => !ALLOWED_MODIFIED.has(f));
  assert.deepEqual(unexpected, [], 'unexpected modified files outside the S6 Construction Package scope: ' + JSON.stringify(unexpected));
});

test('S6-T52: every new (untracked) file falls under js/assessment-explainer.js, tests/s6/, or docs/handoff/phase0-s6/', () => {
  const statusOut = execSync('git status --porcelain', { cwd: ROOT }).toString();
  const untracked = statusOut.split('\n')
    .filter((line) => line.startsWith('??'))
    .map((line) => line.slice(3).trim());
  const offenders = [];
  untracked.forEach((entry) => {
    if (!isAllowedNew(entry)) offenders.push(entry);
  });
  assert.deepEqual(offenders, [], 'unexpected new/untracked paths outside the S6 Construction Package scope: ' + JSON.stringify(offenders));
});

test('nothing is staged for commit', () => {
  const staged = execSync('git diff --name-only --cached', { cwd: ROOT }).toString().trim();
  assert.equal(staged, '', 'no file should be staged during S6 implementation');
});
