# S8-F: Full-System QA / Final Acceptance

Final acceptance gate for S8 and a full-system regression pass across
accepted S1 through S8-E. **QA/regression/proven-bug-fix only** — no new
features, no redesign, no S9 work.

## Baseline

- Repository: `kevinmaBC/pickleball-4.0`
- Branch: `app-v2-alpha`
- S8-F started from `354f22186489dc777373f02e93f7412e14295d88` (S8-E),
  clean tree, `main` unchanged at `f10d73ad6cbed337561a6115889e055a19a68bc7`
  throughout.

## Full automated test inventory (14 files)

| File | Layer |
|---|---|
| `tests/namespace.test.js` | S7-A namespace |
| `tests/storage.test.js` | S1/S7-A/S8-A storage + migration |
| `tests/review-engine.test.js` | S7-B |
| `tests/trend-engine.test.js` | S7-C |
| `tests/retest-engine.test.js` | S7-D |
| `tests/review-ui.test.js` | S7-E |
| `tests/sw-cache.test.js` | TD-SW-01 / Service Worker |
| `tests/training-storage.test.js` | S8-A |
| `tests/training-plan-engine.test.js` | S8-B |
| `tests/session-execution-engine.test.js` | S8-C |
| `tests/training-readiness-engine.test.js` | S8-D |
| `tests/training-ui.test.js` | S8-E |
| **`tests/pre-s7-ui-regression.test.js`** | **new — TD-REG-01 closure** |
| **`tests/cross-layer-integration.test.js`** | **new — S8-F cross-layer QA** |

All 14 execute via `node tests/<file>.test.js` (no npm, no
`package.json`, no `node_modules` anywhere in this repo — every test is
a self-contained script, matching the existing convention exactly).

## TD-REG-01 closure

**Problem:** no dedicated automated regression coverage existed for the
pre-S7 UI (`app.js`'s 8-week tracker/KPI dashboard, `assessment.js`'s S1
widget, and the Home/Learn/Drill/Measure/Compete/Team tab shell).

**Why a placeholder wasn't enough, and why no test framework was added:**
`app.js`/`assessment.js` are bare top-level scripts with real DOM side
effects at load time (no `module.exports`, no pure-function surface to
`require()`), and this repo has no `jsdom` (confirmed: no
`package.json`/`node_modules` exist at all). Installing one would be new
test-framework infrastructure, which the brief explicitly avoids unless
absolutely necessary — and it wasn't necessary. Instead
`tests/pre-s7-ui-regression.test.js` applies the exact technique already
established by `tests/sw-cache.test.js` for `sw.js`: read the **real**
script source from disk and execute it via Node's built-in `vm` module
inside a minimal, hand-rolled fake browser (`document`/`window`/
`localStorage`/`fetch`/a reused `tests/fake-indexeddb.js`), built by
**parsing the real `index.html`** (element ids, `<script>` list, view
sections, nav buttons) rather than a hand-maintained duplicate — so a
future change to any of those in `index.html` is picked up automatically
instead of the test silently going stale.

**What it proves (executes, not just asserts structure):**
- The entire real `<script>` chain from `index.html` — all 15 files, in
  the real load order, i18n.js through assessment.js — loads and
  initializes with **zero exceptions**. This is the core proof that S7/S8
  integration hasn't broken the pre-S7 load path: a missing global, a
  stale filename, or a module collision would throw here immediately.
- Every expected global exists afterward (`PBStore`, `PBNamespace`,
  `PBConfig`, `PBMetrics`, `PBReview`, `PBTrend`, `PBRetest`,
  `PBReviewUI`, `PBSessionExecution`, `PBTrainingReadiness`,
  `PBTrainingUI`, `PBPreview`, `PBAssessment`, `go`, `LANG`).
- **Home/Drill/Measure real render/init paths execute against real
  data**, not stubs: `renderWeeks()` produces the real 8 weeks with real
  item text; `t-done`/`t-pass`/`t-items` compute the real 0%/0%/0-of-25
  from a clean state; `renderModules()` renders all 9 real KPI modules;
  `computeKPI()`'s composite-score formula is verified against a golden
  value (`8*80/100 + 10*95/100 = 15.9`, exactly); `renderGates()`'s
  hard-gate threshold logic is verified at both sides of a boundary
  (`gate no` at 80% vs. a 95% threshold, `gate ok` at exactly 95%).
- `go(tab)` is exercised for **every** tab discovered from the real nav
  (`home`/`learn`/`drill`/`measure`/`review`/`compete`/`team`), not a
  hand-picked subset — each activates the right view and deactivates
  every other one.
- **The S1 Assessment Data Core widget (`#a1-app`) mounts and renders
  successfully against real `data/*.json` config** (served through a
  fetch stub that reads the actual files on disk) — proving "Measure /
  Assessment availability" concretely: it must not fall into its
  "modules not ready" or "config load failed" branches, and its "New
  Assessment" entry point must be present.
- The S7 Review/Trend UI (`#review-app`) and all three S8-E training
  mounts render without exception in the same pass.
- `toggleLang()` — including the S8-E hook added to
  `js/i18n.js`'s `refreshDynamic()` — runs across the whole loaded app
  without throwing.

**TD-REG-01 is CLOSED**: the tests exist, they execute, and they pass —
not merely a file that exists.

## Pre-S7 UI regression (Section 4)

Home, Learn, Drill, Measure, Compete, Team — all six tabs and their nav
targets verified present and switchable; Drill's tracker and Measure's
KPI dashboard verified with real numeric assertions (not just "did it
render"); Assessment availability verified with a real end-to-end mount
against real config data. Compete/Team verified structurally present
(their content is entirely static markup with no init-time JS logic to
exercise). See TD-REG-01 closure above for detail — this is the same
suite.

## S7 regression

`tests/namespace.test.js`, `tests/review-engine.test.js`,
`tests/trend-engine.test.js`, `tests/retest-engine.test.js`,
`tests/review-ui.test.js` all re-verified passing unmodified, plus
`review-app` mount re-verified inside the new full-chain harness.

## S8-A through S8-E regression

All five stages' existing suites re-verified passing unmodified:
`training-storage.test.js` (S8-A), `training-plan-engine.test.js` (S8-B),
`session-execution-engine.test.js` (S8-C),
`training-readiness-engine.test.js` (S8-D), `training-ui.test.js` (S8-E).

## Cross-layer integration (Section 7/8)

`tests/cross-layer-integration.test.js` is one connected walkthrough of
the full accepted chain using only real accepted APIs (no second
orchestration layer, no new formal re-test engine):

```
Assessment -> Review Snapshot -> Prescription -> TrainingCycle ->
WeeklyPlan -> SessionPlan -> Session Execution -> SessionLog ->
CycleSummary -> Re-test Readiness
```

Each per-layer engine already has deep coverage in its own S8-B/C/D
suite; this file proves the layers actually compose, plus the S8-F
scenarios not already covered elsewhere:

- **Scenario A** (missing evidence): a `review_snapshot` with
  `bottleneck_state: 'INCOMPLETE'` correctly blocks `TrainingCycle`
  creation with `INCOMPLETE` — no fabricated plan, no fabricated level.
- **Scenario B/C**: a valid snapshot flows into a `Prescription`
  (bottleneck copied verbatim, never recomputed) and then into a
  `TrainingCycle`/`WeeklyPlan`/`SessionPlan` chain with every ancestry
  field checked explicitly against the real created records.
- **Scenario D**: a second `buildTrainingCyclePlan` for the same
  prescription is rejected (`DUPLICATE_ACTIVE_CYCLE`) mid-chain.
- **Scenario E/F/G/H**: COMPLETE produces exactly one durable log;
  PARTIAL is recorded distinctly with no capability vocabulary; SKIPPED
  fabricates no results/evidence; a duplicate finalize attempt on an
  already-finalized plan is rejected and does not create a second log.
- **Scenario R** (new — not exercised by any prior suite): a session is
  started, then a page reload is simulated the way a real reload
  actually resets JS memory — re-`require`ing
  `session-execution-engine.js` to discard its in-memory `_active` map.
  Verified: the active state is gone, the `SessionPlan`'s persisted
  status is untouched (no silent corruption), no phantom `SessionLog`
  was created, and the session finalizes cleanly afterward with exactly
  one durable log. **This scenario was also independently verified in a
  real browser** (see Browser QA below) via a genuine page reload — both
  agree.
- **Scenario L**: a realistic mixed execution history (6 COMPLETE + 1
  PARTIAL + 1 SKIPPED of 8 sessions) that genuinely clears every
  threshold (adherence 0.8125, primary exposure exactly 0.75, both
  retest targets above 0.70) correctly yields `READY` with all four
  gates `PASS` — proven through the real chain, not a hand-massaged
  all-COMPLETE shortcut.
- **Scenario M**: the persisted `TrainingCycle` and `CycleSummary`
  records are checked for the literal absence of
  `validated_training_level`/`PROMOTED`/`hard_gate_passed`/
  `match_validation_passed`, and `TrainingCycle.status` is confirmed
  untouched by readiness computation (Cycle Status != Re-test
  Readiness).
- Recalculating `buildCycleSummary` mid-chain is confirmed to update the
  same record, not create a second one.
- **Scenario N**: a cycle whose primary bottleneck is `match_validation`
  produces a non-null `match_transfer_exposure`, and the output is
  checked to never mention CAP or claim Match Validation passed.

**Scenario O** (Training UI flow: Today → Cycle → Session → Progress →
Re-test CTA) is covered by `training-ui.test.js`'s view-model/structural
tests plus a real mount proof in `pre-s7-ui-regression.test.js`, and by
documented manual Browser QA below — full DOM interaction automation
isn't available in this repo (no jsdom), so per Section 8's own
allowance this scenario is proven through automated view-model coverage
plus documented manual QA rather than forced automation.

**Scenario P** (Measure regression) is proven by
`pre-s7-ui-regression.test.js`'s real Assessment-widget mount, and
independently reconfirmed in manual Browser QA.

**Scenario Q** (Service Worker) — see the Service Worker QA section
below.

## Master Control V2 final audit (Section 10)

A blanket source-level sweep across every `js/*.js` file (not just
per-suite checks) found:

- `validated_training_level` — the only reference outside comments is a
  **read** in `review-ui.js` (`assessmentRec.validated_training_level`,
  for display only). No write path exists anywhere.
- `'C0'`/`"C0"` — zero occurrences anywhere in `js/*.js`.
- CAP weight literals (`0.45`/`0.30`/`0.25`) — exist in exactly one
  place, `review-engine.js`; no other file duplicates them.
- `PROMOTED` — the only occurrence is a comment documenting the
  invariant (`training-readiness-engine.js`), never in executable code.
- `VALID_LEVELS`/`VALIDATED_LEVELS` — declared independently in four
  files (`storage.js`, `review-engine.js`, `review-ui.js`,
  `training-plan-engine.js`); all four are byte-identical
  `[3.0, 3.5, 4.0, 4.5, 5.0]` — no drift.
- Namespace: `js/namespace.js` still maps only `T01..T10 -> ASMT-01..10`,
  unknown ids resolve to `null` (never guessed).
- Evidence: `data/evidence_confidence_v2_3_1.json` defines only
  `C1`–`C4`; no `C0` anywhere in the data layer either.
- `PBStore.updateAssessment` call sites: only `assessment.js:242`
  (`saveMatch`), patching `ue`/`match_transfer` raw input fields —
  never `validated_training_level`.

No violation found. **PASS.**

## S8 invariant audit (Section 11)

Every invariant (`Plan != Execution Log`, `Adherence != Capability`,
`Training Completion != Hard Gate Passed`, `RETEST_READY != PROMOTED`,
`Match Transfer Exposure != Match Validation`, `Training Evidence !=
Validated Assessment Evidence`, `Cycle Status != Re-test Readiness`,
`Criterion Met != Hard Gate Passed`) is enforced structurally in its
owning engine's own test suite (S8-A through S8-E) and re-verified end
to end in `cross-layer-integration.test.js` against real persisted
records rather than only the engines' own source code. No violation
found. **PASS.**

## UI acceptance matrix (Section 12)

| Surface | Result |
|---|---|
| HOME render/navigation | PASS |
| LEARN render/navigation | PASS |
| DRILL (existing + training integration) | PASS |
| MEASURE (formal assessment access) | PASS |
| REVIEW (S7 Review + S8 Progress) | PASS |
| COMPETE render/navigation | PASS |
| TEAM render/navigation | PASS |
| TODAY TRAINING | PASS |
| TRAINING CYCLE | PASS |
| SESSION DETAIL | PASS |
| SESSION EXECUTION | PASS |
| PROGRESS | PASS |
| READY | PASS |
| NOT_READY | PASS |
| INCOMPLETE | PASS |
| MEASURE / RE-TEST CTA | PASS |

## Browser QA (Section 13)

Performed against the repository's existing static-server workflow
(`.claude/launch.json`, `python -m http.server`, the same setup used for
S8-E QA). Actually checked, not assumed:

- Fresh load: zero console errors.
- All 7 tabs (Home/Learn/Drill/Measure/Review/Compete/Team) navigate via
  `go()` with correct active-view/nav-button state and non-trivial
  rendered content; zero console errors throughout.
- Training fixture data created directly through the real `PBStore`/
  `PBTrainingPlan`/`PBSessionExecution`/`PBTrainingReadiness` APIs
  (bypassing no logic — same pattern as the automated suites).
- **A genuine page reload was performed mid-session** (Scenario R,
  independent of the simulated version in the automated suite): a
  session was started, then the page was actually reloaded. Verified:
  `PBSessionExecution.getSessionExecutionState(...)` returns `null`
  post-reload, zero `SessionLog`s exist for that session
  (no phantom/duplicate), the UI shows the honest "you may need to press
  Start again" notice and a working Start button (not a broken state),
  and the session finalizes cleanly afterward.
- Progress rendered `NOT_READY` correctly for that session's realistic
  (post-reload, partially-logged) history, with per-gate `FAIL`/`PASS`
  breakdown and no fabricated numbers.
- READY, NOT_READY, and INCOMPLETE states were all independently
  produced (via targeted fixtures, as in S8-E QA) and visually confirmed
  correct, including the READY → "GO TO MEASURE / RE-TEST" CTA
  successfully navigating to the Measure tab.
- Zero console errors observed across the entire session.

## Mobile QA (Section 14)

375×812 viewport. All 7 tabs checked for horizontal overflow via
`document.documentElement.scrollWidth > document.documentElement.clientWidth`
(the authoritative check — `window.innerWidth` alone proved unreliable,
see Defects below). **One MAJOR defect found and fixed** (see below);
after the fix, all 7 tabs confirmed `overflow: false`. Training CTAs,
session finalization controls, and Progress/readiness content all
verified usable and readable at this width (already covered by S8-E's
mobile QA and reconfirmed here after the fix).

## Service Worker QA (Section 15, Scenario Q)

TD-SW-01 remains CLOSED — not reopened, not redesigned; no evidence of
a regression was found in `sw.js`'s own logic. Added one small
regression assertion to `tests/sw-cache.test.js`: it parses the real
`index.html` script list and the real `sw.js` `CORE` array and asserts
every script the page actually loads (including all three S8-E
additions — `session-execution-engine.js`, `training-readiness-engine.js`,
`training-ui.js`) is present in `CORE`. This passes today and will catch
a future script added to one file and forgotten in the other.

**Note on a testing-environment artifact:** during manual Browser QA, a
stale page was briefly served from a previously-registered service
worker's cache in the same reused browser tab from earlier in this
session (a static Python file server does not send strong
cache-control headers, and the SW had already registered/cached before
the Home-table fix was made). Clearing that cache/re-registering
resolved it immediately and the fix verified correctly afterward. This
was investigated and is **not** evidence of a `sw.js` logic defect —
`sw.js`'s network-first fetch path itself is unchanged and correct;
`js/storage.js`/every engine remains untouched by S8-F except the one
documented fix below. Per Section 15, `sw.js` architecture was left
unchanged.

## Defects found / fixed

**MAJOR — Home tab horizontal overflow at 375px mobile viewport.**
The pre-existing "System Map" table (`资料 Doc / 层级 Layer / 作用`,
present since commit `6d90ff2`, well before any S1–S8 work — confirmed
via `git log -S`, not introduced by this session's work) was not wrapped
in a horizontal-scroll container, unlike other wide tables in this app.
Its long description-column text pushed `document.documentElement`
to 416px wide against a 375px viewport (`scrollWidth(416) >
clientWidth(375)`), a genuine, provable violation of Section 14's "no
horizontal overflow" mobile-QA requirement. Root-caused by isolating the
overflowing element directly in-browser (`getBoundingClientRect()` sweep
over `#v-home *`), confirmed *not* systemic (every other `.tbl` table in
the app was individually checked and does not overflow at 375px — this
table's unusually long description text was the specific cause).

**Fix:** wrapped the table in `<div style="overflow-x:auto">`, the exact
pattern this app already uses elsewhere for wide tables (e.g.
`review-ui.js`'s hard-gate table) — no new CSS architecture, no new
breakpoint, a two-line change in `index.html`. Regression coverage added
to `tests/pre-s7-ui-regression.test.js` (asserts the wrapper is present
around that specific table) and reconfirmed live in-browser across all 7
tabs at 375px with zero overflow remaining.

No other BLOCKER or MAJOR defects were found.

## Non-blocking limitations (documented, not fixed — out of S8-F scope)

- **Cloud sync / coach / feedback features** (`js/app.js`'s
  `pushMine`/`pullMine`/`loadCoach`/`submitFeedback`) depend on a
  user-configured Supabase endpoint and were not exercised against a
  real backend in this QA pass (out of scope — these are pre-existing
  Team-tab features unrelated to S1–S8, and the regression suite proves
  their code paths load and don't throw at init time, which is the
  applicable "core render/init path" bar for TD-REG-01).
- **"Today" session selection is "next pending", not calendar-based** —
  documented and intentional since S8-E (no calendar/scheduling logic
  exists by design; explicitly out of scope for S8 overall).
- **Active-session reload limitation** (Section 24 of S8-E, reconfirmed
  by Scenario R here) — intentional, documented, unchanged.

## Tests / syntax final results

All 14 automated suites: **PASS**. `node --check` on all 17 `js/*.js`
files plus `sw.js`: **PASS**, zero syntax errors. Full suite re-run
after the one production fix, as required by Section 24 — still 14/14
PASS.

## Remaining technical debt

TD-SW-01: CLOSED (unchanged, not reopened). TD-REG-01: **CLOSED** (this
stage). No new technical debt introduced.
