# S8-E: Training / Cycle UI

`js/training-ui.js` (`PBTrainingUI`) is a thin UI layer over the accepted
S8-A→D architecture. It reads persisted training data, calls
`PBSessionExecution` and `PBTrainingReadiness`, and renders what they
return. **It contains no business logic** — no adherence math, no
exposure math, no R1–R4 decisions, no threshold comparisons, no CAP,
Hard Gate, Match Validation, or Validated Level handling.

## Purpose / user flow

```
TODAY → TRAINING CYCLE → SESSION → PROGRESS → RE-TEST READINESS → MEASURE
```

Per the task brief's explicit navigation strategy ("do not add a new
top-level navigation system"), this flow is folded into the **existing**
bottom-nav tabs rather than a new one:

| Existing tab | New content added |
|---|---|
| **HOME** (`v-home`) | "Today's Training" card — `#training-today-app` |
| **DRILL** (`v-drill`) | "Training Cycle / Session" app — `#training-cycle-app` (the main interactive surface: player picker, cycle/week/session drill-down, execution controls) |
| **REVIEW** (`v-review`) | "Training Progress / Re-test Readiness" — `#training-progress-app`, alongside the existing S7-E Review/Trend content |
| **MEASURE** (`v-measure`) | Unchanged — this is already the existing formal-assessment/re-test destination; the READY-state CTA just calls `go('measure')` |

All three mount points are one JS module instance sharing module-level
state (selected player, selected cycle/session, in-flight/busy flag),
since they live on the same page at the same time — no new routing or
caching layer was introduced (Section 23).

## UI → engine boundary

Every calculated value the UI displays is read, not computed:

- `PBSessionExecution.startSession / completeSession / partialSession /
  skipSession / getSessionExecutionState` — the *only* execution API the
  UI calls. `training-ui.js` never calls `PBStore.createSessionLog` or
  `PBStore.put('session_logs', ...)` directly (verified by a structural
  test — Section 8's "do not write SessionLogs directly" is enforced,
  not just documented).
- `PBTrainingReadiness.buildCycleSummary` — the UI's Progress view calls
  this (which both recalculates *and* persists via the real engine) and
  renders the returned `CycleSummary` verbatim. It never sums
  `SessionLog`s or compares an exposure rate to a threshold itself.
- **`js/training-readiness-engine.js` gained one minimal, additive field**
  for this stage: `retest_target_detail[].meets_threshold` (boolean).
  Section 15 requires per-target "EXPOSURE MET / EXPOSURE BELOW TARGET"
  wording; Section 21 forbids the UI from itself comparing against the
  frozen `0.70` threshold. Before this addition, S8-D only exposed the
  *aggregate* R3 pass/fail, not a per-target boolean — so satisfying both
  requirements at once was impossible without either the UI duplicating
  the comparison (forbidden) or the engine surfacing one more field it
  already computes internally. The fix reuses the *existing*
  `RETEST_READINESS_THRESHOLDS.MIN_RETEST_TARGET_EXPOSURE` constant — no
  new threshold, no changed gate result, no new business rule; R3's own
  aggregate check was simplified to reuse this same field
  (`detail.every(d => d.meets_threshold)`) so the comparison exists in
  exactly one place in the whole codebase. All existing S8-D tests still
  pass unmodified.
- Similarly, `PBTrainingUI.pickCurrentCycle` / `pickNextSession` are pure
  **data selection**, not calculation: they filter/sort already-persisted
  records (by `status`, `start_date`, `week_number`/`sequence`) to answer
  "which cycle/session is current" — no new semantics are invented, and
  no calendar/scheduling logic exists (explicitly out of scope).

## Views

- **Today** (`buildTodayViewModel`): current week/phase, primary
  bottleneck, the next non-finalized session ("next" = first
  `PLANNED`/`AVAILABLE` `SessionPlan` in `(week_number, sequence)` order
  — there is no per-session calendar date in the S8-A/B schema, so this
  is honestly the *next pending* session, not a literal "today", per the
  brief's own exclusion of calendar scheduling). Empty state ("NO ACTIVE
  TRAINING CYCLE") links back to Review; never fabricates a cycle.
- **Cycle** (`buildCycleViewModel`): target level, validated level at
  start, primary bottleneck, cycle length, and a per-week accordion
  (`<details class="tr-week">`) showing phase and session status counts,
  drilling down to individual sessions.
- **Session** (`buildSessionViewModel`): sequence, week/phase, objective,
  and every `SessionPlan.assignments[]` entry exactly as S8-B produced it
  (role, namespace, drill id, success criterion, planned volume) — no
  role semantics are invented beyond `PRIMARY`/`SUPPORT`/`TRANSFER`/`RETEST_PREP`.
  If finalized, shows the real `SessionLog` (status, results,
  `criterion_met` read verbatim from S8-C, notes) with the required
  disclaimer.
- **Progress** (`buildProgressViewModel`): adherence breakdown, primary
  exposure, per-target exposure (each target rendered independently —
  never averaged to hide a deficient one), match-transfer exposure (only
  shown when non-null), and the four R1–R4 gate tiles, all read straight
  off the persisted `CycleSummary`.

## Session execution

Lifecycle: `SessionPlan (PLANNED/AVAILABLE)` → **Start** (in-memory
active state only — see below) → **COMPLETE / PARTIAL / SKIP**, three
clearly distinct always-visible buttons (never nested in a menu). Inputs
gathered per assignment: `measured_value`, `attempts`, `successful`, plus
one shared `notes` field — exactly the fields S8-C's execution payload
supports, nothing invented. **SKIP requires confirmation**: the first
click swaps the three action buttons for a confirm/cancel prompt; only
a second, explicit "Confirm Skip" click calls
`PBSessionExecution.skipSession`. A single module-level `BUSY` flag gates
every action handler, preventing double-submit while a request is
in-flight. Known `ExecutionError` codes (`SESSION_NOT_FOUND`,
`SESSION_ALREADY_FINALIZED`, `EXECUTION_ASSIGNMENT_MISMATCH`,
`INVALID_TIMESTAMP_ORDER`, etc.) are translated to short bilingual
messages (`translateError`); unrecognized errors fall back to a generic
message — raw error text/stack traces are never shown to the user.

**Session status wording** deliberately avoids "capability" language:
`COMPLETE`/`PARTIAL`/`SKIPPED` are always rendered as plain execution
facts ("training session completed" / "…partially completed" / "…
skipped"), with an explicit on-screen disclaimer wherever a result is
shown: *"Criterion Met ≠ Hard Gate Passed. Training session result ≠
formal assessment result. No level change is implied."*

## Progress / readiness display

`READY` → green banner "RE-TEST READY" + a full-width CTA
("GO TO MEASURE / RE-TEST") that calls `go('measure')`; never
"PROMOTED"/"LEVEL UP"/"NEW VALIDATED LEVEL" (verified — those strings do
not appear anywhere in this file). `NOT_READY` → "MORE TRAINING
REQUIRED" with the R1–R4 tiles shown individually (reusing the app's
existing `.gates`/`.gate`/`.gate.ok`/`.gate.no` styling, the same
component already used for the Six Hard Gates display — an unclassed
`.gate` renders as neutral, which is reused for `INCOMPLETE` so no new
CSS state was needed). `INCOMPLETE` → "READINESS INCOMPLETE" with an
explanation that required data/mapping is missing; the word "FAILED"
never appears in that branch (verified). Per-target exposure uses
"EXPOSURE MET" / "EXPOSURE BELOW TARGET" / "INCOMPLETE" — never "PASSED"
— sourced from the engine's `meets_threshold` field described above, not
a UI-side comparison. Match Transfer exposure, when present, is labeled
"Match Transfer Training Exposure" with the explicit disclaimer
"Training exposure only — not formal Match Validation."

## Mobile-first behavior

No new responsive breakpoints were introduced — the whole app is already
single-column mobile-first with no `@media` layout queries anywhere
except `prefers-reduced-motion`, and the new `.tr-app` CSS follows suit.
The primary action button (`.tr-cta`) is full-width with 14px padding
for a large touch target. Verified structurally (CSS source check) and
manually at a 375×812 mobile viewport with no horizontal overflow
(`document.body.scrollWidth === window.innerWidth`).

## Known limitation: active-session reload (Section 24)

`PBSessionExecution`'s in-progress execution state is intentionally
in-memory only (an S8-C design decision, unchanged here). If the page
reloads mid-session before a result is finalized, that in-progress state
is lost and the UI shows a notice to that effect before the Start button
("If you reload mid-session, unfinalized progress may be lost — you may
need to press Start again."). No new persistent store was added to work
around this — that would be an S8-C architecture change, out of scope
here.

## Master Control safety

No CAP calculation, no Hard Gate evaluation, no Match Validation, no
`validated_training_level` write, no promotion — verified structurally:
the module's own code (comments stripped) never references
`validated_training_level`, `capability_score`, `CAP_score`,
`hard_gate_passed`, `C0`, or `promotion_status`. No threshold constant
(`MIN_ADHERENCE`/`MIN_PRIMARY_EXPOSURE`/`MIN_RETEST_TARGET_EXPOSURE`) is
redeclared in the UI, and no `rate >= 0.7/0.75/0.8`-style comparison
exists in its code — every PASS/FAIL/MET/BELOW-TARGET verdict is read
from engine output.

## Tests

`tests/training-ui.test.js` follows the same convention as
`tests/review-ui.test.js` (this repo has no `jsdom`/DOM-testing
dependency anywhere — the DOM-mounting layer is verified by manual
browser QA, not automated tests, consistent with review-ui.js's existing
precedent). It covers: all four pure view-model builders (Today/Cycle/
Session/Progress, including empty states that never fabricate data), the
per-target MET/BELOW_TARGET/INCOMPLETE labeling, Match Transfer
isolation wording, READY/NOT_READY/INCOMPLETE wording (including that
INCOMPLETE never says "FAILED"), error-message translation (including
that unknown errors never leak raw text), and — via structural source
checks matching the pattern already used in the S8-B/C/D suites — the
thin-UI invariants: exclusive delegation to `PBSessionExecution`, no
direct `SessionLog` writes, the two-step SKIP confirmation, the
double-submit guard, absence of Master-Control-forbidden vocabulary, and
absence of any UI-side threshold comparison. All prior S1–S8-D suites
re-verified passing alongside it (12/12 total).

Manual browser QA (Section 31) was performed against a local static
server with fixture data covering: Home/Today (empty state and an active
cycle with a pending session), Training Cycle (week/session
drill-down), Session detail (assignments, execution form, finalized
result view with `criterion_met` and the disclaimer), the full
Start → Skip (with confirm/cancel) interaction, Progress in all three
readiness states (READY with working "GO TO MEASURE" navigation,
NOT_READY, INCOMPLETE), and a 375px mobile viewport with no horizontal
overflow — zero console errors observed throughout.
