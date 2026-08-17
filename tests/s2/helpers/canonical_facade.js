'use strict';
/* Builds a real, ready PBCanonical facade backed by the real S0 seed data,
 * using the same injected-loader pattern as tests/s1/facade_lifecycle.test.js,
 * so S2 tests exercise the actual canonical-runtime.js code (including the
 * S2 schemaVersion extension) rather than a hand-rolled substitute. */
var path = require('node:path');

var ROOT = path.join(__dirname, '..', '..', '..');
var seedData = require(path.join(ROOT, 'data', 'canonical', 'seed_data.json'));
var PBMasters = require(path.join(ROOT, 'js', 'masters-repo.js'));
var canonicalRuntime = require(path.join(ROOT, 'js', 'canonical-runtime.js'));

function createReadyFacade() {
  var facade = canonicalRuntime.createFacade({
    pbMasters: { load: function () { return Promise.resolve(PBMasters.buildIndex(seedData)); } },
    url: 'x'
  });
  return facade.ready.then(function () { return facade; });
}

module.exports = { createReadyFacade: createReadyFacade, seedData: seedData };
