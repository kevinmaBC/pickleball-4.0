/* ============================================================
 * build-canonical-data.js — S0 deterministic authority→runtime copy
 *
 * Single Source of Truth (SSOT): docs/handoff/phase0-s0/seed_data.json
 * and docs/handoff/phase0-s0/seed_data.schema.json.
 *
 * This script is the ONLY sanctioned mechanism that produces the
 * runtime copy at data/canonical/. It never edits the authority
 * files. Output is a pure function of the authority file's parsed
 * JSON content (JSON.parse -> JSON.stringify with fixed formatting),
 * so re-running it always reproduces byte-identical output for
 * unchanged input. No manual edits to data/canonical/*.json are
 * permitted — regenerate via this script instead.
 *
 * Usage: node scripts/build-canonical-data.js
 * ============================================================ */
'use strict';

var fs = require('fs');
var path = require('path');

var AUTHORITY_DIR = path.join(__dirname, '..', 'docs', 'handoff', 'phase0-s0');
var RUNTIME_DIR = path.join(__dirname, '..', 'data', 'canonical');

var FILES = ['seed_data.json', 'seed_data.schema.json'];

// Pure: parsed-JSON -> canonical formatted string. Deterministic for
// a given authority payload regardless of the authority file's own
// whitespace/formatting.
function canonicalize(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

// Pure (aside from the read): reads one authority file and returns
// the exact bytes that belong at data/canonical/<filename>.
function buildOne(filename) {
  var srcPath = path.join(AUTHORITY_DIR, filename);
  var raw = fs.readFileSync(srcPath, 'utf8');
  var parsed = JSON.parse(raw); // throws if authority file is not valid JSON
  return canonicalize(parsed);
}

function main() {
  if (!fs.existsSync(RUNTIME_DIR)) fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  FILES.forEach(function (filename) {
    var out = buildOne(filename);
    var destPath = path.join(RUNTIME_DIR, filename);
    fs.writeFileSync(destPath, out, 'utf8');
    console.log('[build-canonical-data] wrote ' + destPath);
  });
}

module.exports = {
  canonicalize: canonicalize,
  buildOne: buildOne,
  AUTHORITY_DIR: AUTHORITY_DIR,
  RUNTIME_DIR: RUNTIME_DIR,
  FILES: FILES
};

if (require.main === module) {
  main();
}
