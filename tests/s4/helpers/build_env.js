'use strict';
/* Builds a full in-memory S4 test environment: an S4-local fake PBStore
 * (extends the S2 fake-store contract with an `assessments` store), a real
 * PBCanonical facade over real seed data (reusing the S2 injected-loader
 * helper), a real PBTrainingEvidence module (used only to seed realistic
 * training evidence through the actual validated write path), a real
 * PBTrainingAnalytics module, and the real PBPlayerTrainingState module
 * under test — none of these are reimplemented by hand. */
var path = require('node:path');

var ROOT = path.join(__dirname, '..', '..', '..');
var fakeStoreHelper = require(path.join(__dirname, 'fake_store.js'));
var canonicalFacadeHelper = require(path.join(ROOT, 'tests', 's2', 'helpers', 'canonical_facade.js'));
var trainingEvidenceFactory = require(path.join(ROOT, 'js', 'training-evidence.js'));
var trainingAnalyticsFactory = require(path.join(ROOT, 'js', 'training-analytics.js'));
var playerTrainingStateFactory = require(path.join(ROOT, 'js', 'player-training-state.js'));

function buildEnv(seedPlayers) {
  var pbStore = fakeStoreHelper.createFakeStore(seedPlayers);
  return canonicalFacadeHelper.createReadyFacade().then(function (pbCanonical) {
    var pbTrainingEvidence = trainingEvidenceFactory.createModule({ pbStore: pbStore, pbCanonical: pbCanonical });
    var pbTrainingAnalytics = trainingAnalyticsFactory.createModule({ pbStore: pbStore, pbCanonical: pbCanonical });
    var pbPlayerTrainingState = playerTrainingStateFactory.createModule({
      pbStore: pbStore, pbCanonical: pbCanonical, pbTrainingAnalytics: pbTrainingAnalytics
    });
    return {
      pbStore: pbStore,
      pbCanonical: pbCanonical,
      pbTrainingEvidence: pbTrainingEvidence,
      pbTrainingAnalytics: pbTrainingAnalytics,
      pbPlayerTrainingState: pbPlayerTrainingState
    };
  });
}

// Sequentially add one evidence row per outcome in `outcomes`, trial_no starting at 1
// (or opts.trial_no_start), all against the same session/drill. (Mirrors tests/s3/helpers.)
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

// Directly writes an assessment row into the fake store — mirrors the shape
// PBStore.createAssessment produces in js/storage.js, without requiring
// storage.js itself (which assumes a real browser `indexedDB` global and
// cannot be constructed standalone in Node). Any extra fields in `patch`
// (e.g. technical_score, match_transfer, dupr) are merged verbatim so tests
// can exercise the field-projection whitelist against realistic/edge shapes.
function addAssessment(pbStore, opts) {
  opts = opts || {};
  var a = Object.assign({
    assessment_id: opts.assessment_id || pbStore._uid('asm'),
    player_id: opts.player_id,
    assessment_date: opts.assessment_date || '2026-01-01',
    assessment_tier: opts.assessment_tier || 'standard',
    target_training_level: (opts.target_training_level == null ? 4.0 : opts.target_training_level),
    schema_version: (opts.schema_version === undefined ? '2.3.1' : opts.schema_version),
    benchmark_version: (opts.benchmark_version === undefined ? '2.1.1' : opts.benchmark_version),
    protocol_version: (opts.protocol_version === undefined ? '2.2.1' : opts.protocol_version),
    created_at: opts.created_at || '2026-01-01T00:00:00.000Z'
  }, opts.patch || {});
  return pbStore.put('assessments', a);
}

module.exports = {
  buildEnv: buildEnv,
  addTrials: addTrials,
  addAssessment: addAssessment,
  seedData: canonicalFacadeHelper.seedData
};
