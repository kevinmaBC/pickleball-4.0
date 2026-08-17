'use strict';
/* S1 Acceptance Gate — architecture constraints and Legacy Data
 * Dependency Map shape (S1-T15/T16/T18/T19). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

test('S1-T15: no package.json anywhere in the repository', () => {
  const files = walk(ROOT, []);
  const pkgFiles = files.filter((f) => path.basename(f) === 'package.json');
  assert.deepStrictEqual(pkgFiles, []);
});

test('S1-T16: no lockfiles / node_modules / bundler or database config present', () => {
  const files = walk(ROOT, []).map((f) => path.basename(f));
  const forbidden = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'webpack.config.js', 'vite.config.js'];
  forbidden.forEach((name) => {
    assert.ok(!files.includes(name), 'forbidden architecture file present: ' + name);
  });
  assert.ok(!fs.existsSync(path.join(ROOT, 'node_modules')));
});

test('S1-T19: no extra canonical dataset — data/canonical contains only the two S0 runtime files', () => {
  const canonicalDir = path.join(ROOT, 'data', 'canonical');
  const files = fs.readdirSync(canonicalDir).sort();
  assert.deepStrictEqual(files, ['seed_data.json', 'seed_data.schema.json']);
});

test('S1-T18: Legacy Data Dependency Map exists at docs/architecture and covers required symbols', () => {
  const mapPath = path.join(ROOT, 'docs', 'architecture', 'legacy_data_dependency_map.json');
  assert.ok(fs.existsSync(mapPath), 'docs/architecture/legacy_data_dependency_map.json must exist');
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  assert.ok(Array.isArray(map.entries), 'map.entries must be an array');
  const symbols = map.entries.map((e) => e.symbol);
  ['WEEKS', 'GLOSSARY', 'TOC', 'MODULES', 'GATES'].forEach((sym) => {
    assert.ok(symbols.includes(sym), 'dependency map missing required symbol: ' + sym);
  });
  map.entries.forEach((e) => {
    assert.equal(typeof e.file, 'string');
    assert.equal(typeof e.description, 'string');
    assert.equal(typeof e.canonical_relationship, 'string');
    assert.equal(typeof e.migration_status, 'string');
  });
});

test('S1-T20 (structural half): canonical source files are untouched by this dependency map / facade work', () => {
  const authorityPath = path.join(ROOT, 'docs', 'handoff', 'phase0-s0', 'seed_data.json');
  const runtimePath = path.join(ROOT, 'data', 'canonical', 'seed_data.json');
  const authority = JSON.parse(fs.readFileSync(authorityPath, 'utf8'));
  const runtime = JSON.parse(fs.readFileSync(runtimePath, 'utf8'));
  assert.equal(authority.masters.length, 13);
  assert.equal(runtime.masters.length, 13);
  assert.equal(authority.drills.length, 35);
  assert.equal(runtime.drills.length, 35);
});
