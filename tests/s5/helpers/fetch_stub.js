'use strict';
/* Node-side fetch stub for testing PBAssessmentClassifier.loadConfig(), which uses the
 * real browser `fetch` API against relative paths (e.g. './data/level_gates_v2_3_1.json').
 * Node's built-in global fetch cannot resolve bare relative paths, so this stub maps the
 * exact same relative paths loadConfig() requests to the real files on disk via fs — it
 * exercises the real loadConfig() code path (parsing + version cross-check + caching), not
 * a reimplementation of it. The real end-to-end browser fetch is additionally verified in
 * the S5 completion report's real-browser proof. */
const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('./level_gates.js');

function installFetchStub() {
  const original = global.fetch;
  global.fetch = async function (url) {
    const rel = String(url).replace(/^\.\//, '');
    const filePath = path.join(ROOT, rel);
    if (!fs.existsSync(filePath)) {
      return { ok: false, status: 404, json: async () => { throw new Error('not found'); } };
    }
    const body = fs.readFileSync(filePath, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  };
  return function restore() {
    if (original === undefined) delete global.fetch;
    else global.fetch = original;
  };
}

module.exports = { installFetchStub };
