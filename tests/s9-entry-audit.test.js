/* tests/s9-entry-audit.test.js — S9-0: Match Validation Entry Audit
 *
 * Converts the S9-0 audit's most load-bearing findings into a permanent
 * regression guard, so a future change can't silently invalidate the
 * facts docs/S9-0-MATCH-VALIDATION-ENTRY-AUDIT.md was written against:
 *   - the 4.0 match threshold (70) has exactly one authoritative source;
 *   - 3.0/3.5/4.5/5.0 have no match_validation rule (4.5/5.0 confirmed
 *     provisional, not silently guessed);
 *   - T10 is normalized through the exact same alias mechanism as
 *     T01-T09, never special-cased;
 *   - CAP computation never takes match_transfer_score as an input;
 *   - S8-D's match_transfer_exposure never references CAP/capability;
 *   - the Compete tab currently has no mount point (documents the
 *     current reuse-path baseline for a future S9-A UI decision).
 *
 * This is an audit-artifact test (S9-0 made zero production-code
 * changes), not a new engine's test suite.
 * Run: node tests/s9-entry-audit.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var levelGates = require(path.join(ROOT, 'data', 'level_gates_v2_3_1.json'));
var reviewEngineSrc = fs.readFileSync(path.join(ROOT, 'js', 'review-engine.js'), 'utf8');
var readinessSrc = fs.readFileSync(path.join(ROOT, 'js', 'training-readiness-engine.js'), 'utf8');
var assessmentSrc = fs.readFileSync(path.join(ROOT, 'js', 'assessment.js'), 'utf8');
var indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var PBNamespace = require('../js/namespace.js');

function run() {
  // ---- Q5: 4.0 match threshold — single authoritative source ----
  assert.strictEqual(levelGates.levels['4.0'].match_validation.required, true);
  assert.strictEqual(levelGates.levels['4.0'].match_validation.min_match_transfer_score, 70, 'the 4.0 match threshold is 70, preserved exactly, not recalibrated');

  ['3.0', '3.5'].forEach(function (lvl) {
    assert.strictEqual(levelGates.levels[lvl].match_validation, undefined, lvl + ' has no match_validation rule configured');
  });

  // No hard-coded duplicate of the threshold value outside the JS lines that read it from levelCfg.
  var duplicateThresholdPattern = /min_match_transfer_score\s*[:=]\s*70(?!\s*;?\s*\/\/.*levelCfg)/;
  // (the only two legitimate JS occurrences read the property off levelCfg, they never assign a literal 70 to it)
  ['js/review-engine.js', 'js/preview.js'].forEach(function (rel) {
    var src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.ok(src.indexOf('levelCfg.match_validation.min_match_transfer_score') !== -1, rel + ' must read the threshold from levelCfg, not a private constant');
    assert.strictEqual(/min_match_transfer_score\s*[:=]\s*70/.test(src), false, rel + ' must not hard-code a duplicate 70 literal for this threshold');
  });

  // ---- Q6: 4.5 / 5.0 status — provisional, no threshold invented anywhere ----
  ['4.5', '5.0'].forEach(function (lvl) {
    assert.strictEqual(levelGates.levels[lvl].match_validation, undefined, lvl + ' has no match_validation rule configured (must not be silently guessed)');
    assert.strictEqual(levelGates.levels[lvl].status, 'provisional', lvl + ' is explicitly marked provisional in the frozen config');
  });

  // ---- Q3: T10 normalized through the exact same alias mechanism as T01-T09, never special-cased ----
  assert.strictEqual(PBNamespace.toCanonical('T10'), 'ASMT-10');
  assert.strictEqual(PBNamespace.toLegacy('ASMT-10'), 'T10');
  assert.strictEqual(PBNamespace.LEGACY_TO_CANONICAL.T10, 'ASMT-10');
  // Structural: no code branch anywhere treats "T10" as authoritative independent of the alias table.
  var namespaceSrc = fs.readFileSync(path.join(ROOT, 'js', 'namespace.js'), 'utf8');
  assert.strictEqual(/if\s*\([^)]*===\s*['"]T10['"]/.test(namespaceSrc), false, 'namespace.js must not special-case T10 with its own branch');

  // ---- Section 7 / Q1 sibling check: CAP never takes match_transfer_score as an input ----
  var capFnMatch = /function computeCAP\(([^)]*)\)\s*\{([\s\S]*?)\n  \}/.exec(reviewEngineSrc);
  assert.ok(capFnMatch, 'computeCAP function must be found in review-engine.js');
  assert.strictEqual(capFnMatch[1].indexOf('match'), -1, 'computeCAP\'s parameter list must not include any match-related argument');
  assert.strictEqual(capFnMatch[2].toLowerCase().indexOf('match'), -1, 'computeCAP\'s body must never reference match data');
  assert.ok(/var CAP_WEIGHTS\s*=\s*\{\s*technical:\s*0\.45,\s*decision:\s*0\.30?,\s*pressure:\s*0\.25\s*\}/.test(reviewEngineSrc), 'CAP weights (45/30/25) exist exactly as frozen');

  // ---- S8-D match_transfer_exposure never enters CAP (structural, matches training-readiness-engine.test.js's own guard) ----
  var exposureFnMatch = /function calculateTrainingExposure\([\s\S]*?\n  \}\n\}/.exec(readinessSrc) || /calculateTrainingExposure = function[\s\S]*?\n  \};?/.exec(readinessSrc);
  var scopedSrc = exposureFnMatch ? exposureFnMatch[0] : readinessSrc;
  assert.strictEqual(scopedSrc.indexOf('capability_score'), -1, 'match_transfer_exposure computation must never reference capability_score');
  assert.strictEqual(scopedSrc.toUpperCase().indexOf('CAP_WEIGHTS'), -1, 'match_transfer_exposure computation must never reference CAP weights');

  // ---- Q2: existing match_validation_state vocabulary is MET|NOT_MET|INCOMPLETE, not VALIDATED|NOT_VALIDATED ----
  // (documents the naming-adjacency finding in the audit -- a future S9 "Match Validation State"
  // must reconcile with this existing field/vocabulary rather than silently diverging from it)
  assert.ok(reviewEngineSrc.indexOf("state: (matchTransferScore >= minScore) ? 'MET' : 'NOT_MET'") !== -1, 'evalMatchValidation must still return MET/NOT_MET, the existing vocabulary S9-A must reconcile with');
  assert.strictEqual(reviewEngineSrc.indexOf("'VALIDATED'"), -1, 'no VALIDATED/NOT_VALIDATED enum value exists yet in review-engine.js (S9-0 adds none)');

  // ---- Q7: Compete tab currently has no mount point (documents the S9-A UI reuse-path baseline) ----
  var competeMatch = /<section class="view" id="v-compete">([\s\S]*?)<\/section>/.exec(indexHtml);
  assert.ok(competeMatch, 'v-compete section must exist');
  assert.strictEqual(/id="[a-z0-9-]*-app"/.test(competeMatch[1]), false, 'v-compete currently has no dedicated JS-mount div (a future S9-A UI would need to add one, matching the #review-app/#training-cycle-app pattern)');

  // ---- Q1/Q4: Match Entry path exists (assessment.js), distinct from live_match feed_mode ----
  assert.ok(assessmentSrc.indexOf('function renderMatch()') !== -1, 'the T10-lite Match Entry screen (renderMatch) must exist');
  assert.ok(assessmentSrc.indexOf('function saveMatch(') !== -1, 'saveMatch must exist as the sole match_transfer_score write path');
  assert.ok(assessmentSrc.indexOf("PBStore.updateAssessment(aid") !== -1, 'saveMatch must persist through the existing assessments store, not a new store');

  console.log('s9-entry-audit.test.js: all assertions passed');
}

try {
  run();
} catch (err) {
  console.error('s9-entry-audit.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
}
