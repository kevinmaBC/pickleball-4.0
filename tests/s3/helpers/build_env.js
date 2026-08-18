'use strict';
/* Builds a full in-memory S3 test environment: a fake PBStore (reusing the
 * S2 in-memory double), a real PBCanonical facade over real seed data
 * (reusing the S2 injected-loader helper), a real PBTrainingEvidence module
 * (used only to seed realistic evidence through the actual validated write
 * path — not reimplemented by hand), and the real PBTrainingAnalytics
 * module under test. */
var path = require('node:path');

var ROOT = path.join(__dirname, '..', '..', '..');
var fakeStoreHelper = require(path.join(ROOT, 'tests', 's2', 'helpers', 'fake_store.js'));
var canonicalFacadeHelper = require(path.join(ROOT, 'tests', 's2', 'helpers', 'canonical_facade.js'));
var trainingEvidenceFactory = require(path.join(ROOT, 'js', 'training-evidence.js'));
var trainingAnalyticsFactory = require(path.join(ROOT, 'js', 'training-analytics.js'));

function buildEnv(seedPlayers) {
  var pbStore = fakeStoreHelper.createFakeStore(seedPlayers);
  return canonicalFacadeHelper.createReadyFacade().then(function (pbCanonical) {
    var pbTrainingEvidence = trainingEvidenceFactory.createModule({ pbStore: pbStore, pbCanonical: pbCanonical });
    var pbTrainingAnalytics = trainingAnalyticsFactory.createModule({ pbStore: pbStore, pbCanonical: pbCanonical });
    return {
      pbStore: pbStore,
      pbCanonical: pbCanonical,
      pbTrainingEvidence: pbTrainingEvidence,
      pbTrainingAnalytics: pbTrainingAnalytics
    };
  });
}

// Sequentially add one evidence row per outcome in `outcomes`, trial_no starting at 1
// (or opts.trial_no_start), all against the same session/drill.
function addTrials(pbTrainingEvidence, training_session_id, source_drill_id, outcomes, opts) {
  opts = opts || {};
  var start = opts.trial_no_start || 1;
  return outcomes.reduce(function (p, outcome, idx) {
    return p.then(function () {
      return pbTrainingEvidence.addEvidence({
        training_session_id: training_session_id,
        source_drill_id: source_drill_id,
        trial_no: start + idx,
        outcome: outcome
      });
    });
  }, Promise.resolve());
}

module.exports = { buildEnv: buildEnv, addTrials: addTrials, seedData: canonicalFacadeHelper.seedData };
