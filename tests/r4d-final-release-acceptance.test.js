/* tests/r4d-final-release-acceptance.test.js — POST-S11-R4-D: Release
 * Candidate Full-System UAT / Final Product Readiness.
 *
 * This is a final release-acceptance GATE, in the same spirit as
 * tests/s10-final-acceptance.test.js and tests/s11-final-acceptance.test.js:
 * it adds no new product logic and computes nothing. Every check either
 * (a) re-reads existing accepted source files and asserts the required
 * fail-safe / governance vocabulary and separation invariants are still
 * present verbatim (never re-derived here), or (b) spawns a directly
 * relevant accepted suite unmodified to prove the eight Final Release
 * Gates (FRG-01..FRG-08) still hold end to end.
 *
 * FRG-01 Product Journey Integrity
 * FRG-02 Assessment Integrity
 * FRG-03 Recommendation / Prescription Integrity
 * FRG-04 Training Execution Integrity
 * FRG-05 Progress / Reassessment Integrity
 * FRG-06 Match Transfer Integrity
 * FRG-07 Data / Regression / Fail-Safe Integrity
 * FRG-08 Real User Release Readiness
 *
 * Run: node tests/r4d-final-release-acceptance.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); }

var MASTER = readSrc('docs/MASTER-CONTROL-V2.md');
var ASSESSMENT_SRC = stripComments(readSrc('js/assessment.js'));
var HOME_UI_SRC = stripComments(readSrc('js/home-priority-dashboard-ui.js'));
var HOME_ADAPTER_SRC = stripComments(readSrc('js/home-dashboard-adapter.js'));
var JOURNEY_SRC = stripComments(readSrc('js/product-journey-orchestrator.js'));
var TREND_SRC = stripComments(readSrc('js/trend-engine.js'));
var PROGRESS_UI_SRC = stripComments(readSrc('js/progress-reassessment-ui.js'));
var PROGRESS_ADAPTER_SRC = stripComments(readSrc('js/progress-reassessment-adapter.js'));
var MATCH_SRC = stripComments(readSrc('js/match-observation-engine.js'));
var REVIEW_SRC = stripComments(readSrc('js/review-engine.js'));
var STORAGE_SRC = stripComments(readSrc('js/storage.js'));

function masterBlock(header) {
  var re = new RegExp('^' + header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n([\\s\\S]*?)(?=\\n\\n\\S|\\n```)', 'm');
  var m = MASTER.match(re);
  return m ? m[0] : '';
}

function spawnSuite(name) {
  return cp.spawnSync(process.execPath, [path.join(__dirname, name)], { encoding: 'utf8' });
}

function run() {

  // ================================================================
  // FRG-01 Product Journey Integrity
  // ================================================================
  (function () {
    var stages = ['NEEDS_ASSESSMENT', 'ASSESSMENT_IN_PROGRESS', 'ASSESSMENT_READY'];
    stages.forEach(function (s) {
      assert.ok(JOURNEY_SRC.indexOf(s) !== -1, 'FRG-01: journey stage "' + s + '" present verbatim in the orchestrator');
    });
    // R4-A/B/C acceptance recorded — the journey-facing UX built on top of the orchestrator.
    var r4a = masterBlock('POST-S11-R4-A');
    assert.ok(r4a && r4a.indexOf('CLOSED / ACCEPTED') !== -1, 'FRG-01: POST-S11-R4-A closed/accepted');
    var r4b = masterBlock('POST-S11-R4-B');
    assert.ok(r4b && r4b.indexOf('CLOSED / ACCEPTED') !== -1, 'FRG-01: POST-S11-R4-B closed/accepted');
  })();

  // ================================================================
  // FRG-02 Assessment Integrity — GP-01/GP-02 required vocabulary.
  // ================================================================
  (function () {
    ['Assessment In Progress', 'Provisional Assessment Score', 'Six Hard Gates'].forEach(function (s) {
      assert.ok(ASSESSMENT_SRC.indexOf(s) !== -1, 'FRG-02: required GP-02 copy "' + s + '" present verbatim');
    });
    // Provisional score is never labeled/treated as the official Validated Level.
    assert.strictEqual(ASSESSMENT_SRC.indexOf('validated_training_level'), -1, 'FRG-02: assessment.js never sets validated_training_level');
  })();

  // ================================================================
  // FRG-03 Recommendation / Prescription Integrity — Your Next Step
  // reads the existing accepted Journey/Home projection verbatim; no
  // local recommendation/priority vocabulary is invented.
  // ================================================================
  (function () {
    assert.strictEqual(/var\s+NEXT_ACTION/.test(ASSESSMENT_SRC), false, 'FRG-03: no local next_action dictionary in assessment.js');
    assert.ok(ASSESSMENT_SRC.indexOf('PBHomeDashboardUI.nextActionLabel') !== -1, 'FRG-03: labels sourced from PBHomeDashboardUI.nextActionLabel');
    assert.ok(ASSESSMENT_SRC.indexOf('PBHomeDashboardUI.routeForNextAction') !== -1, 'FRG-03: routes sourced from PBHomeDashboardUI.routeForNextAction');
    ['putDevelopmentCycle', 'PBWorkflow', 'PBDiagnosis', 'PBRecommendationPriority', 'PBTrainingPrescription'].forEach(function (token) {
      assert.strictEqual(ASSESSMENT_SRC.indexOf(token), -1, 'FRG-03: assessment.js must never reference ' + token);
    });
  })();

  // ================================================================
  // FRG-04 Training Execution Integrity — TRAINING evidence path wired
  // into the accepted training_evidence store (S10-A carry-forward).
  // ================================================================
  (function () {
    assert.ok(STORAGE_SRC.indexOf("training_evidence:") !== -1, 'FRG-04: training_evidence store still declared');
    var s10aCarry = MASTER.indexOf('S10-A Carry-Forward Requirement');
    assert.ok(s10aCarry !== -1, 'FRG-04: S10-A carry-forward requirement (Evidence -> Reassessment loop) documented');
  })();

  // ================================================================
  // FRG-05 Progress / Reassessment Integrity — allowed trend vocabulary
  // only; no automatic validated-level promotion.
  // ================================================================
  (function () {
    ['IMPROVING', 'STABLE', 'DECLINING', 'INSUFFICIENT_DATA', 'UNRESOLVED'].forEach(function (v) {
      assert.ok(TREND_SRC.indexOf(v) !== -1 || PROGRESS_UI_SRC.indexOf(v) !== -1, 'FRG-05: trend vocabulary "' + v + '" present');
    });
    assert.ok(PROGRESS_ADAPTER_SRC.indexOf('BASELINE_UNRESOLVED') !== -1, 'FRG-05: honest BASELINE_UNRESOLVED fail-safe present (never fabricated from first Session Result)');
    assert.strictEqual(PROGRESS_ADAPTER_SRC.indexOf('validated_training_level ='), -1, 'FRG-05: progress/reassessment never assigns validated_training_level');
  })();

  // ================================================================
  // FRG-06 Match Transfer Integrity — critical invariant: TRAINING
  // Evidence != MATCH Evidence. TRAINING improvement must never
  // automatically validate Match Transfer.
  // ================================================================
  (function () {
    assert.strictEqual(MATCH_SRC.indexOf('training_evidence'), -1, 'FRG-06: match-observation-engine.js never reads/writes training_evidence');
    assert.ok(HOME_ADAPTER_SRC.indexOf('MATCH_TRANSFER_NOT_VALIDATED') !== -1, 'FRG-06: honest MATCH_TRANSFER_NOT_VALIDATED fail-safe flag present');
    var known = MASTER.indexOf('KNOWN LIMITATION — MATCH PROGRESS');
    assert.ok(known !== -1, 'FRG-06: KNOWN LIMITATION — MATCH PROGRESS documented in MASTER CONTROL');
    var limBlock = MASTER.slice(known, known + 700);
    assert.ok(limBlock.indexOf('TRAINING Evidence must never be substituted for MATCH Evidence') !== -1, 'FRG-06: TRAINING != MATCH invariant explicitly documented');
  })();

  // ================================================================
  // FRG-07 Data / Regression / Fail-Safe Integrity — DB_VERSION=5,
  // stores=18/18, no fabricated non-standard Validated Level anywhere
  // in the accepted assessment/review pipeline.
  // ================================================================
  (function () {
    assert.ok(/DB_VERSION\s*=\s*5\s*;/.test(STORAGE_SRC), 'FRG-07: DB_VERSION is 5');
    var storesBlockMatch = STORAGE_SRC.match(/var STORES = \{([\s\S]*?)\n  \};/);
    assert.ok(storesBlockMatch, 'FRG-07: STORES config block found');
    var keyPathCount = (storesBlockMatch[1].match(/keyPath:/g) || []).length;
    assert.strictEqual(keyPathCount, 18, 'FRG-07: exactly 18 stores (found ' + keyPathCount + ')');
    // Validated Level Governance — only official levels; the review engine's own read-only
    // reference list is the single accepted source, and it declares no fractional/invented level.
    assert.ok(/var VALIDATED_LEVELS = \[3\.0, 3\.5, 4\.0, 4\.5, 5\.0\]/.test(REVIEW_SRC), 'FRG-07: VALIDATED_LEVELS frozen to 3.0/3.5/4.0/4.5/5.0');
    [/\b3\.7\b/, /\b3\.85\b/, /\b4\.12\b/].forEach(function (re) {
      assert.strictEqual(re.test(REVIEW_SRC), false, 'FRG-07: review-engine.js never invents a non-standard validated level matching ' + re);
    });
  })();

  // ================================================================
  // UAT-01 — P1 mobile-overflow fix (375px): the R4-A/B-added
  // #k-score-disclaimer text (a flex child of .composite .lvl with no
  // min-width:0) forced the Measure tab's layout viewport past 375px,
  // which in turn stretched the fixed nav.tabs bottom bar wide enough
  // to clip its last tab off-screen. Minimal CSS-only fix: min-width:0
  // on .composite .lvl (same pattern as S11-F-R1's own bottom-nav
  // min-width:0 fix), verified in-browser to eliminate the overflow at
  // both 375px and 1280px with no visual regression.
  // ================================================================
  (function () {
    var cssSrc = readSrc('css/app.css');
    assert.ok(/\.composite \.lvl\{[^}]*min-width:0/.test(cssSrc), 'UAT-01: .composite .lvl retains min-width:0 (375px overflow fix)');
  })();

  // ================================================================
  // FRG-08 Real User Release Readiness — directly relevant accepted
  // suites (R4-C's own chain covers R4-B/R4-A/preview/pre-s7; plus the
  // HOME/Journey and MATCH/TRAINING-separation leaf suites not already
  // covered by that chain) must still pass unmodified.
  // ================================================================
  (function () {
    var relevantSuites = [
      'r4c-assessment-action-handoff.test.js',
      'r3b3-home-integration.test.js',
      'match-observation-engine.test.js',
      'progress-reassessment-ui.test.js',
      'trend-engine.test.js',
      'guided-training-action-controller.test.js'
    ];
    relevantSuites.forEach(function (suite) {
      var res = spawnSuite(suite);
      assert.strictEqual(res.status, 0, 'FRG-08: accepted suite ' + suite + ' must still pass unmodified:\n' + res.stdout + res.stderr);
    });
  })();

  // ================================================================
  // R4-D governance — R4-D was subsequently closed by GPT Independent QA
  // (acceptance commit 4676e25); this gate now validates that accepted
  // final state verbatim, rather than the pre-closure PENDING wording it
  // originally asserted. FRG-01..FRG-08 above are untouched by this fix.
  // ================================================================
  (function () {
    var r4d = masterBlock('POST-S11-R4-D');
    assert.ok(r4d, 'GOV-01: POST-S11-R4-D block present in MASTER CONTROL');
    assert.ok(r4d.indexOf('CLOSED / ACCEPTED') !== -1, 'GOV-01: R4-D status is CLOSED / ACCEPTED');
    assert.ok(r4d.indexOf('4676e256f534dcef68ac6f0db52eb40ba578fbfd') !== -1 || r4d.indexOf('4676e25') !== -1,
      'GOV-01: R4-D acceptance commit 4676e25 (or full SHA) is recorded');
    assert.ok(r4d.indexOf('54 / 54 PASS') !== -1, 'GOV-01: R4-D final regression is 54 / 54 PASS');
    assert.ok(r4d.indexOf('GPT Independent Final Acceptance:') !== -1 && r4d.indexOf('PASS') !== -1,
      'GOV-01: R4-D GPT Independent Final Acceptance is PASS');

    // PB-APP-RC1 product baseline must remain frozen at the same commit R4-D accepted.
    assert.ok(MASTER.indexOf('Product Code Baseline:\n4676e256f534dcef68ac6f0db52eb40ba578fbfd') !== -1,
      'GOV-02: PB-APP-RC1 Product Code Baseline remains 4676e25');
    assert.ok(MASTER.indexOf('Product Release Baseline:\nFROZEN') !== -1,
      'GOV-02: PB-APP-RC1 Product Release Baseline remains FROZEN');

    var r4c = masterBlock('POST-S11-R4-C');
    assert.ok(r4c && r4c.indexOf('CLOSED / ACCEPTED') !== -1, 'GOV-03: POST-S11-R4-C recorded CLOSED / ACCEPTED');
    assert.ok(r4c.indexOf('70435196e6a06ee006374de4fb19d7b721a03813') !== -1 || r4c.indexOf('7043519') !== -1, 'GOV-03: R4-C acceptance commit recorded');
  })();

  console.log('r4d-final-release-acceptance.test.js: FRG-01..FRG-08 + governance all assertions passed');
}

try {
  run();
} catch (err) {
  console.error('r4d-final-release-acceptance.test.js: FAILED');
  console.error(err);
  process.exitCode = 1;
}
