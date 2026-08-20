/* tests/training-ui.test.js — S8-E: Training / Cycle UI
 * training-ui.js has no jsdom in this repo's test conventions (same as
 * review-ui.js — the DOM-mounting layer is verified via manual browser QA,
 * not automated tests). This suite covers: the pure view-model builders
 * (Today/Cycle/Session/Progress), error-message translation, and
 * structural source checks proving the thin-UI boundary — the UI
 * delegates every execution action to PBSessionExecution, never writes
 * SessionLogs directly, never duplicates R1-R4/threshold decision logic,
 * and never references CAP/Hard-Gate/Match-Validation/validated-level
 * vocabulary.
 * Run: node tests/training-ui.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');

var UI = require('../js/training-ui.js');
var SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'training-ui.js'), 'utf8');
var CODE_ONLY = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
var CSS = fs.readFileSync(path.join(__dirname, '..', 'css', 'app.css'), 'utf8');

function run() {
  // ==================================================================
  // A/B — Today view model
  // ==================================================================
  (function () { // A. Today view handles an active/current cycle
    var cycle = { cycle_id: 'tc1', primary_bottleneck: 'hard_gate:reset_ball_quality_pct' };
    var weeks = [{ week_number: 1, phase: 'ACQUISITION' }, { week_number: 2, phase: 'STABILIZATION' }];
    var next = { session_plan_id: 'sp2', sequence: 1, week_number: 2, status: 'PLANNED', assignments: [{ role: 'PRIMARY', target: 'reset_ball_quality_pct', drill_id: 'RESET_TRANSITION_BLOCK', assessment_namespace: 'ASMT-05' }] };
    var vm = UI.buildTodayViewModel({ cycle: cycle, weeks: weeks, nextSession: next, executionState: null });
    assert.strictEqual(vm.hasCycle, true);
    assert.strictEqual(vm.weekNumber, 2);
    assert.strictEqual(vm.totalWeeks, 2);
    assert.strictEqual(vm.phase, 'STABILIZATION');
    assert.strictEqual(vm.nextSession.primaryDrillId, 'RESET_TRANSITION_BLOCK');
    assert.strictEqual(vm.allSessionsFinalized, false);
    assert.strictEqual(vm.isSessionActive, false);
  })();

  (function () { // A (continued): active execution state is reflected
    var vm = UI.buildTodayViewModel({
      cycle: { cycle_id: 'tc1' }, weeks: [{ week_number: 1, phase: 'ACQUISITION' }],
      nextSession: { session_plan_id: 'sp1', sequence: 1, week_number: 1, status: 'PLANNED', assignments: [] },
      executionState: { started_at: '2026-01-01T00:00:00.000Z' }
    });
    assert.strictEqual(vm.isSessionActive, true);
  })();

  (function () { // A (continued): all sessions finalized -> no CTA session, no fabricated one
    var vm = UI.buildTodayViewModel({ cycle: { cycle_id: 'tc1' }, weeks: [{ week_number: 1, phase: 'RETEST' }], nextSession: null, executionState: null });
    assert.strictEqual(vm.allSessionsFinalized, true);
    assert.strictEqual(vm.nextSession, null);
  })();

  (function () { // B. Today view handles the no-cycle empty state, never fabricates a cycle
    var vm = UI.buildTodayViewModel({});
    assert.deepStrictEqual(vm, { hasCycle: false });
  })();

  // ==================================================================
  // C — Cycle view model (week/session structure)
  // ==================================================================
  (function () {
    var cycle = { cycle_id: 'tc1', status: 'PLANNED', target_level: 4.0, validated_level_at_start: 3.5, primary_bottleneck: 'hard_gate:reset_ball_quality_pct', start_date: '2026-01-05', planned_end_date: '2026-02-16' };
    var weeklyPlans = [
      { week_plan_id: 'wp2', week_number: 2, phase: 'STABILIZATION', status: 'PLANNED', planned_sessions: 2 },
      { week_plan_id: 'wp1', week_number: 1, phase: 'ACQUISITION', status: 'PLANNED', planned_sessions: 2 }
    ];
    var sessionPlans = [
      { session_plan_id: 'sp1b', week_plan_id: 'wp1', sequence: 2, status: 'COMPLETED', objective: 'x' },
      { session_plan_id: 'sp1a', week_plan_id: 'wp1', sequence: 1, status: 'COMPLETED', objective: 'x' },
      { session_plan_id: 'sp2a', week_plan_id: 'wp2', sequence: 1, status: 'PLANNED', objective: 'y' }
    ];
    var vm = UI.buildCycleViewModel({ cycle: cycle, weeklyPlans: weeklyPlans, sessionPlans: sessionPlans });
    assert.strictEqual(vm.hasCycle, true);
    assert.strictEqual(vm.cycleLengthWeeks, 2);
    assert.deepStrictEqual(vm.weeks.map(function (w) { return w.weekNumber; }), [1, 2], 'weeks sorted ascending regardless of input order');
    assert.deepStrictEqual(vm.weeks[0].sessions.map(function (s) { return s.sequence; }), [1, 2], 'sessions sorted by sequence within a week');
    assert.deepStrictEqual(vm.weeks[0].statusCounts, { COMPLETED: 2 });
    assert.deepStrictEqual(vm.weeks[1].statusCounts, { PLANNED: 1 });
  })();

  (function () { // C (continued): no cycle -> empty state, no fabrication
    assert.deepStrictEqual(UI.buildCycleViewModel({}), { hasCycle: false });
  })();

  // ==================================================================
  // D — Session view model (real SessionPlan assignments, no invented roles)
  // ==================================================================
  (function () {
    var sp = {
      session_plan_id: 'sp1', sequence: 1, status: 'PLANNED', objective: 'primary block',
      assignments: [
        { role: 'PRIMARY', target: 'reset_ball_quality_pct', assessment_namespace: 'ASMT-05', drill_id: 'RESET_TRANSITION_BLOCK', planned_volume: '1 session block', success_criterion: 'reset_ball_quality_pct >= 50' },
        { role: 'SUPPORT', target: 'shot_selection_pct', assessment_namespace: 'ASMT-08', drill_id: 'SSS_DECISION_BLOCK', success_criterion: 'shot_selection_pct >= 65' }
      ]
    };
    var wp = { week_number: 1, phase: 'ACQUISITION' };
    var vm = UI.buildSessionViewModel({ sessionPlan: sp, weeklyPlan: wp, sessionLog: null, executionState: null });
    assert.strictEqual(vm.found, true);
    assert.strictEqual(vm.assignments.length, 2);
    assert.strictEqual(vm.assignments[0].role, 'PRIMARY');
    assert.strictEqual(vm.assignments[1].role, 'SUPPORT');
    assert.strictEqual(vm.assignments[0].successCriterion, 'reset_ball_quality_pct >= 50');
    assert.strictEqual(vm.isFinalized, false);
  })();

  (function () { // D (continued): finalized session shows real SessionLog results, incl. criterion_met as engine-supplied
    var sp = { session_plan_id: 'sp1', sequence: 1, status: 'COMPLETED', assignments: [{ role: 'PRIMARY', target: 'reset_ball_quality_pct', assessment_namespace: 'ASMT-05', drill_id: 'RESET_TRANSITION_BLOCK', success_criterion: 'reset_ball_quality_pct >= 50' }] };
    var log = { status: 'COMPLETE', started_at: '2026-01-05T09:00:00.000Z', completed_at: '2026-01-05T09:30:00.000Z', notes: 'felt good', results: [{ assignment_index: 0, measured_value: 65, criterion_met: true }] };
    var vm = UI.buildSessionViewModel({ sessionPlan: sp, weeklyPlan: { week_number: 1, phase: 'ACQUISITION' }, sessionLog: log, executionState: null });
    assert.strictEqual(vm.isFinalized, true);
    assert.strictEqual(vm.log.status, 'COMPLETE');
    assert.strictEqual(vm.log.results[0].criterionMet, true, 'criterion_met read verbatim from the engine, never recomputed');
    assert.strictEqual(vm.log.results[0].measuredValue, 65);
  })();

  (function () { // D (continued): unknown session -> not fabricated
    assert.deepStrictEqual(UI.buildSessionViewModel({}), { found: false });
  })();

  // ==================================================================
  // J/K — Progress view model renders CycleSummary verbatim, never recomputes
  // ==================================================================
  var progressSummary = {
    cycle_id: 'tc1', planned_sessions: 18, retest_readiness: 'NOT_READY',
    training_exposure: {
      calculated_at: '2026-01-01T00:00:00.000Z', complete_sessions: 14, partial_sessions: 2, skipped_sessions: 1, unlogged_sessions: 1,
      completion_equivalent: 15, adherence_rate: 15 / 18,
      primary_exposure_rate: 0.9, primary_metric: 'reset_ball_quality_pct', primary_namespace: 'ASMT-05',
      retest_target_detail: [
        { metric: 'reset_ball_quality_pct', namespace: 'ASMT-05', exposure_rate: 0.9, occurrence_count: 10, has_complete_or_partial: true, meets_threshold: true },
        { metric: 'shot_selection_pct', namespace: 'ASMT-08', exposure_rate: 0.5, occurrence_count: 4, has_complete_or_partial: true, meets_threshold: false },
        { metric: 'unmapped_metric', namespace: null, exposure_rate: null, occurrence_count: 0, has_complete_or_partial: false, meets_threshold: null }
      ],
      match_transfer_exposure: 0.75,
      gates: {
        R1: { gate: 'R1_ADHERENCE', result: 'PASS', value: 0.833 },
        R2: { gate: 'R2_PRIMARY_EXPOSURE', result: 'PASS', value: 0.9 },
        R3: { gate: 'R3_RETEST_TARGET_COVERAGE', result: 'FAIL' },
        R4: { gate: 'R4_EXECUTION_EVIDENCE', result: 'PASS' }
      },
      thresholds: { MIN_ADHERENCE: 0.8, MIN_PRIMARY_EXPOSURE: 0.75, MIN_RETEST_TARGET_EXPOSURE: 0.7 }
    }
  };
  (function () { // J. adherence numbers are read verbatim, never re-summed from raw logs
    var vm = UI.buildProgressViewModel(progressSummary);
    assert.strictEqual(vm.hasSummary, true);
    assert.strictEqual(vm.adherence.complete, 14);
    assert.strictEqual(vm.adherence.rate, 15 / 18);
    assert.strictEqual(vm.readiness, 'NOT_READY');
  })();

  (function () { // K. each retest target rendered independently, no averaging; MET/BELOW_TARGET read from engine's meets_threshold
    var vm = UI.buildProgressViewModel(progressSummary);
    assert.strictEqual(vm.retestTargets.length, 3);
    assert.strictEqual(vm.retestTargets[0].label, 'EXPOSURE_MET');
    assert.strictEqual(vm.retestTargets[1].label, 'EXPOSURE_BELOW_TARGET', 'the deficient target is shown as deficient, not hidden by averaging with the well-trained one');
    assert.strictEqual(vm.retestTargets[2].label, 'INCOMPLETE', 'unmapped target stays INCOMPLETE, never silently dropped or scored 0');
  })();

  (function () { // no summary -> empty state, never fabricated
    assert.strictEqual(UI.buildProgressViewModel(null).hasSummary, false);
  })();

  // ==================================================================
  // L — Match Transfer isolation: labeled as training exposure, never Match Validation, never in CAP
  // ==================================================================
  (function () {
    var vm = UI.buildProgressViewModel(progressSummary);
    assert.strictEqual(vm.matchTransferExposure, 0.75);
    // Structural: the rendered wording must exist verbatim and be attached specifically to Match Transfer.
    assert.ok(SRC.indexOf('Match Transfer Training Exposure') !== -1, 'UI must label it as training exposure, not a generic score');
    assert.ok(SRC.indexOf('not formal Match Validation') !== -1, 'UI must carry the explicit non-validation disclaimer');
    assert.strictEqual(CODE_ONLY.indexOf('match_validation_passed'), -1);
  })();

  // ==================================================================
  // M/N/O — READY / NOT_READY / INCOMPLETE wording
  // ==================================================================
  (function () {
    assert.ok(SRC.indexOf('GO TO MEASURE') !== -1, 'READY state must offer the re-test CTA wording');
    assert.ok(SRC.indexOf('goto-measure') !== -1, 'READY CTA must be wired to navigate to Measure');
    assert.ok(SRC.indexOf('MORE TRAINING REQUIRED') !== -1, 'NOT_READY state must use the required wording');
    assert.ok(SRC.indexOf('READINESS INCOMPLETE') !== -1, 'INCOMPLETE state must use the required wording');
    assert.ok(SRC.indexOf('PROMOTED') === -1 && SRC.indexOf('LEVEL UP') === -1 && SRC.indexOf('NEW VALIDATED LEVEL') === -1, 'READY must never imply promotion/level-up wording');
    // O: INCOMPLETE branch specifically must not say FAILED.
    var incompleteBranchMatch = /return '<div class="tr-banner"[^;]*READINESS INCOMPLETE[\s\S]*?;\s*\}/.exec(SRC);
    assert.ok(incompleteBranchMatch, 'could locate the INCOMPLETE render branch');
    assert.ok(incompleteBranchMatch[0].toUpperCase().indexOf('FAIL') === -1, 'INCOMPLETE branch text must never say FAILED');
  })();

  // ==================================================================
  // E/F/G/H/I — Execution delegates to PBSessionExecution only (structural: the thin-UI boundary)
  // ==================================================================
  (function () {
    ['PBSessionExecution.startSession(', 'PBSessionExecution.completeSession', 'PBSessionExecution.partialSession', 'PBSessionExecution.skipSession'].forEach(function (call) {
      assert.ok(CODE_ONLY.indexOf(call) !== -1, 'training-ui.js must delegate via ' + call);
    });
    // Never a second execution engine, never a direct SessionLog write from the UI (Section 8).
    assert.strictEqual(CODE_ONLY.indexOf('PBStore.createSessionLog'), -1, 'UI must not write SessionLogs directly — that is PBSessionExecution\'s sole responsibility');
    assert.strictEqual(CODE_ONLY.indexOf("put('session_logs'"), -1);
    // H: SKIP requires a confirmation step before finalizing (two distinct data-act handlers: request vs confirm).
    assert.ok(CODE_ONLY.indexOf("'skip-session'") !== -1 && CODE_ONLY.indexOf("'confirm-skip'") !== -1 && CODE_ONLY.indexOf("'cancel-skip'") !== -1, 'SKIP must go through a separate confirm/cancel step, not finalize on the first click');
    assert.ok(SRC.indexOf('SKIP_CONFIRM_PENDING') !== -1);
    // I: a finalized session cannot re-trigger execution — the render layer only shows action controls when !isFinalized.
    assert.ok(SRC.indexOf('m.isFinalized') !== -1 && SRC.indexOf('renderSessionResultHTML') !== -1, 'finalized sessions must render the read-only result view, not action controls');
    // Double-submit guard exists and gates every action.
    assert.ok(CODE_ONLY.indexOf('if (BUSY) return') !== -1, 'a busy/in-flight guard must prevent double-submit');
  })();

  // ==================================================================
  // P/Q/R/S — Master Control safety: no forbidden vocabulary anywhere in the UI's own code
  // ==================================================================
  (function () {
    ['validated_training_level', 'capability_score', 'CAP_score', 'hard_gate_passed', "'C0'", '"C0"', 'promotion_status'].forEach(function (term) {
      assert.strictEqual(CODE_ONLY.indexOf(term), -1, 'training-ui.js code (outside comments) must not reference ' + term);
    });
  })();

  // ==================================================================
  // T — No duplicated readiness threshold decision logic in the UI
  // ==================================================================
  (function () {
    // The frozen thresholds may appear as *display* values sourced from the engine's own exported
    // config object (e.g. m.thresholds), but the UI must never hardcode a >= 0.8 / 0.75 / 0.7
    // comparison of its own to decide PASS/FAIL/MET, since that decision belongs entirely to
    // PBTrainingReadiness (already computed into .result / .meets_threshold before the UI sees it).
    var comparisonPattern = /(exposure_?[Rr]ate|adherence_?[Rr]ate|\.rate|d\.exposureRate)\s*>=\s*0\.(7|75|8)\b/;
    assert.ok(!comparisonPattern.test(CODE_ONLY), 'UI must not itself compare an exposure/adherence rate against a threshold');
    assert.strictEqual(CODE_ONLY.indexOf('MIN_ADHERENCE ='), -1, 'UI must not declare its own copy of the threshold constants');
    assert.strictEqual(CODE_ONLY.indexOf('MIN_PRIMARY_EXPOSURE ='), -1);
    assert.strictEqual(CODE_ONLY.indexOf('MIN_RETEST_TARGET_EXPOSURE ='), -1);
    // Confirms the UI instead reads engine-supplied booleans/results directly.
    assert.ok(CODE_ONLY.indexOf('d.meets_threshold') !== -1, 'per-target MET/BELOW_TARGET must be read from the engine-supplied meets_threshold field');
    assert.ok(CODE_ONLY.indexOf("gate.result === 'PASS'") !== -1, 'gate tiles must render the engine-supplied .result, not a recomputed verdict');
  })();

  // ==================================================================
  // U — Mobile-first / large touch targets (source-level check; the repo has no
  // responsive-breakpoint or visual-regression tooling to check against, matching
  // its existing practical-test convention)
  // ==================================================================
  (function () {
    var ctaRuleMatch = /\.tr-app \.tr-cta\{([^}]*)\}/.exec(CSS);
    assert.ok(ctaRuleMatch, '.tr-cta rule must exist');
    assert.ok(/width:\s*100%/.test(ctaRuleMatch[1]), 'primary CTA must be full-width (single-column mobile-first, matches the rest of this app)');
    var paddingMatch = /padding:\s*(\d+)px/.exec(ctaRuleMatch[1]);
    assert.ok(paddingMatch && Number(paddingMatch[1]) >= 12, 'primary CTA must have a large touch-target padding');
    // No new responsive breakpoints were introduced (the whole app is deliberately single-column mobile-first).
    var trCssBlock = CSS.slice(CSS.indexOf('S8-E Training'));
    assert.strictEqual(/@media/.test(trCssBlock), false, 'S8-E must not introduce new breakpoints — the app has none, single-column mobile-first throughout');
  })();

  // ==================================================================
  // Determinism / error translation
  // ==================================================================
  (function () {
    assert.strictEqual(UI.translateError({ code: 'SESSION_ALREADY_FINALIZED' }).length > 0, true);
    assert.notStrictEqual(UI.translateError({ code: 'SESSION_ALREADY_FINALIZED' }), UI.translateError({ code: 'INVALID_TIMESTAMP_ORDER' }));
    var unknown = UI.translateError({ code: 'SOME_UNKNOWN_CODE', message: 'raw stack trace nonsense at Object.<anonymous>' });
    assert.strictEqual(unknown.indexOf('at Object'), -1, 'unknown errors must fall back to a generic message, never leak raw error text');
  })();

  // ==================================================================
  // pickCurrentCycle / pickNextSession — pure selection helpers underlying Today/Cycle
  // ==================================================================
  (function () {
    var cycles = [{ cycle_id: 'a', status: 'COMPLETED', start_date: '2026-01-01' }, { cycle_id: 'b', status: 'PLANNED', start_date: '2026-01-05' }, { cycle_id: 'c', status: 'ACTIVE', start_date: '2026-01-02' }];
    assert.strictEqual(UI.pickCurrentCycle(cycles).cycle_id, 'c', 'ACTIVE outranks PLANNED regardless of date');
    assert.strictEqual(UI.pickCurrentCycle([{ status: 'COMPLETED' }, { status: 'ABORTED' }]), null, 'COMPLETED/ABORTED cycles never surface as current');
    assert.strictEqual(UI.pickCurrentCycle([]), null);
  })();
  (function () {
    var sessions = [{ session_plan_id: 's1', week_number: 1, sequence: 2, status: 'COMPLETED' }, { session_plan_id: 's2', week_number: 1, sequence: 1, status: 'PLANNED' }, { session_plan_id: 's3', week_number: 2, sequence: 1, status: 'PLANNED' }];
    assert.strictEqual(UI.pickNextSession(sessions).session_plan_id, 's2');
    assert.strictEqual(UI.pickNextSession([{ status: 'COMPLETED' }, { status: 'SKIPPED' }]), null, 'no pending session -> null, never fabricated');
  })();

  console.log('training-ui.test.js: all assertions passed');
}

run();
