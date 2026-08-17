'use strict';
/* S2 Acceptance Gate — architecture constraints, no-scoring-logic guard,
 * canonical count regression, and README correction (S2-T22, S2-T25,
 * S2-T27, S2-T28). */
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

test('S2-T25: still no package.json / lockfiles / node_modules / bundler config anywhere in the repository', () => {
  const files = walk(ROOT, []);
  const basenames = files.map((f) => path.basename(f));
  assert.deepStrictEqual(basenames.filter((f) => f === 'package.json'), []);
  ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'webpack.config.js', 'vite.config.js'].forEach((name) => {
    assert.ok(!basenames.includes(name), 'forbidden architecture file present: ' + name);
  });
  assert.ok(!fs.existsSync(path.join(ROOT, 'node_modules')));
});

test('S2-T25: data/canonical still contains only the two S0 runtime files (no second canonical fetch/copy introduced)', () => {
  const canonicalDir = path.join(ROOT, 'data', 'canonical');
  const files = fs.readdirSync(canonicalDir).sort();
  assert.deepStrictEqual(files, ['seed_data.json', 'seed_data.schema.json']);
});

test('S2-T22: training-evidence.js contains no scoring/recommendation/promotion/P0-P6 logic', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'training-evidence.js'), 'utf8');
  // Drop the top-of-file header comment block, which intentionally *disclaims*
  // scoring/P0-P6 logic in prose and would otherwise false-positive on itself.
  const headerEnd = src.indexOf('*/');
  const code = headerEnd === -1 ? src : src.slice(headerEnd + 2);

  const forbiddenSubstrings = [
    'recommend', 'prescri', 'promot', 'capability_score', 'readiness',
    'bottleneck', 'today_screen', 'gate_threshold', 'validated_training_level'
  ];
  forbiddenSubstrings.forEach((needle) => {
    assert.ok(!code.toLowerCase().includes(needle), 'forbidden keyword found in training-evidence.js: ' + needle);
  });
  assert.doesNotMatch(code, /\bP[0-6]\b/, 'no standalone P0-P6 planning tokens in training-evidence.js code (outside the disclaiming header comment)');
});

test('training-evidence.js never accepts a caller-supplied master_id parameter path in addEvidence', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js', 'training-evidence.js'), 'utf8');
  assert.doesNotMatch(src, /opts\.master_id/, 'addEvidence must never read opts.master_id');
});

test('S2-T27: canonical 13/35 unchanged (data/canonical/seed_data.json)', () => {
  const seedData = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'canonical', 'seed_data.json'), 'utf8'));
  assert.equal(seedData.masters.length, 13);
  assert.equal(seedData.drills.length, 35);
});

test('S0 canonical source authority file is untouched', () => {
  const authority = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'handoff', 'phase0-s0', 'seed_data.json'), 'utf8'));
  assert.equal(authority.masters.length, 13);
  assert.equal(authority.drills.length, 35);
});

test('S2-T28: stale README statement about canonical runtime wiring is corrected', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /deferred to a later sprint/);
  assert.match(readme, /wired into `index\.html`/);
  assert.match(readme, /training-evidence\.js/);
});
