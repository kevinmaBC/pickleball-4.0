# S11-D — Progress / Reassessment Experience

Stage: `S11-D`
Status: `IMPLEMENTED / GPT QA PENDING`
Files:
- `js/progress-reassessment-adapter.js`
- `js/progress-reassessment-ui.js`
- `tests/progress-reassessment-adapter.test.js`
- `tests/progress-reassessment-ui.test.js`
- `index.html` (`#v-progress` view + 6 new `<script>` tags)
- `css/app.css` (`#progress-reassessment-app` scope)
- `js/home-priority-dashboard-ui.js` (REVIEW_PROGRESS/REVIEW_REASSESSMENT route here)
- `js/guided-training-ui.js` (post-completion CTA driven by refreshed Journey)
- `js/i18n.js` (one-line `refreshDynamic()` hook)
- `sw.js` (precache list + version bump)
- `docs/MASTER-CONTROL-V2.md` (Step 0 — S11-C closure + S11-D entry)
- `tests/s10-final-acceptance.test.js` (FA24 authorized-S11-D allowlist)

## 1. Purpose

Turns already-existing S10-E Progress/Reassessment truth plus S11-A
Journey truth into an understandable user-facing experience. The page
must answer:
1. What am I training?
2. What changed?
3. How much evidence exists?
4. Is this TRAINING or MATCH evidence?
5. Am I ready for reassessment?
6. What should I do next?

S11-D is READ -> PROJECT -> EXPLAIN -> ROUTE. It is not a Progress
Engine, Reassessment Engine, Diagnosis Engine, Recommendation Engine,
or Level Promotion Engine.

## 2. Source-of-Truth Boundaries

| Concept | Owner |
|---|---|
| Diagnosis / Recommendation / Priority / Prescription | S9 |
| Development Cycle | S10-A |
| Prescription Workflow | S10-C |
| Session Result / TRAINING Evidence | S10-D |
| KPI Baseline / Progress / Reassessment | S10-E |
| Journey / next_action | S11-A |
| HOME | S11-B |
| Guided Training | S11-C |
| Progress/Reassessment UX | **S11-D** (this stage) |

`js/progress-reassessment-adapter.js` has zero runtime dependency on
`PBDiagnosis`/`PBRecommendationPriority`/`PBTrainingPrescription` (no
S9 rerun) and never calls an S10 mutation entry point
(`PBWorkflow.transition`, `PBPrescriptionWorkflow.transition`/
`startTraining`, `PBSessionEvidence.transition`,
`PBSessionEvidencePersistence.completeSessionDurable`,
`PBProgressReassessmentPersistence.runReassessmentDurable`/
`captureBaselineDurable`/`supersedePrescriptionWorkflowDurable`/
`completeCycleDurable`) — structurally verified (D-T14/D-T15). It is
read-side only.

## 3. Progress View Model

```js
{
  progress_reassessment: {
    player_id,
    cycle: { cycle_id, state, kpi_profile_code, training_objective_code, training_mode, workflow_state } | null,
    training_progress: { status, baseline, current, delta, trend, evidence_count, source: 'TRAINING' } | null,
    match_transfer: { status, numeric_progress, validated },
    reassessment: { required, state },
    journey: { stage, status },
    next_action: { code, enabled, target_ref },
    flags: [],
    schema_version: '1.0',
    view_version: 'S11-D-V1'
  }
}
```

`composeProgressReassessment(opts)` is pure (no DOM/PBStore) — the unit
tested contract. `loadProgressReassessment(player_id)` is the thin IO
layer.

## 4. Baseline Semantics

KPI Baseline belongs to S10-E and is **read-only** here:
`js/progress-reassessment-adapter.js` reads
`PBStore.getCycleKpiBaseline(PBCycleBaseline.baselineId(cycle_id))`
directly (a deterministic id lookup, never a calculation) to check
existence, and never calls
`PBProgressReassessmentPersistence.captureBaselineDurable` (that would
create/persist a baseline). If no baseline record exists at all,
`training_progress`/`match_transfer` both report
`status: 'BASELINE_UNRESOLVED'` — never the first Session Result used
as a substitute baseline.

## 5. Current / Delta / Trend Semantics

The only progress-producing call is
`PBProgressReassessmentPersistence.getCurrentProgressDurable` — the
already-accepted S10-E-R1 read+project composition (reads the
immutable persisted baseline + persisted `training_evidence`, then
calls `PBProgressTracking`'s pure `computeProgressSnapshot`; it writes
nothing). `baseline`/`current`/`delta`/`trend`/`evidence_count` are
copied verbatim from its returned `progress_snapshot`
(`baseline_value`/`current_value`/`absolute_delta`/`trend`/
`evidence_count`) — never recomputed by this file (structurally proven:
D-T02–D-T07, plus the source scan proving no direct call to
`computeProgressSnapshot`/`PBProgressTracking`).

`delta` stays the raw absolute ratio delta (e.g. `0.12`); the UI
formats it as a **percentage-point** change (`+12`), never as a
percent-of-baseline change (`+12%`) — a 0.62 → 0.74 move is always
"62% → 74%, +12 percentage points," never "+12%" (which would imply a
different, larger relative change).

## 6. Evidence Count

`training_progress.evidence_count` is the exact upstream count from
the progress snapshot, displayed as "N sessions" — never converted
into a readiness verdict. Readiness stays entirely S10-E/S11-A's job.

## 7. TRAINING/MATCH Separation

`training_progress` and `match_transfer` are always two completely
independent objects. `match_transfer.numeric_progress` is only ever
populated from a genuinely resolved MATCH `progress_snapshot`
(`trend` in `IMPROVING`/`DECLINING`/`STABLE`) — TRAINING's own
`current`/`delta`/`trend` never substitutes for it (D-T08/D-T09/D-T10,
and the UI's own D-U13 check that no TRAINING value ever leaks into
the Match Transfer card).

## 8. Match Transfer Limitation

No durable `kpi_profile_code`-aligned MATCH Evidence store exists yet
(carried forward unchanged from S10/S11-A/S11-B/S11-C). The adapter
calls `getCurrentProgressDurable` for the MATCH source with
`match_evidence: []`, so `match_transfer.status` legitimately stays
`INSUFFICIENT_DATA` (or `BASELINE_UNRESOLVED`) and `validated` stays
`false` in the live app today — never a fabricated MATCH number.
**Classification: NON-BLOCKING**, provided the UI stays honest (it
does). Fixed bilingual wording, shown whenever TRAINING is `IMPROVING`
but MATCH transfer is not yet validated:
> 中文：训练表现正在改善，但是否已经转化为真实比赛能力，仍需要真实比赛验证。
> English: Training performance may be improving, but match transfer still requires real-match validation.

## 9. Progress != Level

No fractional validated level is ever generated or displayed
(`3.87`/`4.12`-style values never appear — checked structurally in
both test suites). No automatic promotion (e.g. `3.5 -> 4.0`) is ever
rendered from training progress. If a validated level were ever shown,
it would have to be copied verbatim from accepted upstream data — this
stage doesn't display one at all, since no such field is read from any
upstream source here.

## 10. Reassessment Experience

The sole authoritative stale/reassessment signal — the same one
S11-A/S11-C already use —
`development_cycle.state === 'REASSESSMENT_READY'` or
`journey.stage === 'READY_TO_REASSESS'` — drives
`reassessment.required`. When required, a high-priority banner renders
(never shown otherwise — §28 neutral state):
> 中文: 已进入真实比赛复测阶段 / 出现新的训练证据，现在需要真实比赛验证。
> English: Ready for Match Reassessment / New training evidence exists. Real-match validation is now required.

`reassessment.state` (e.g. `COMPLETED`) is copied verbatim from the
latest persisted reassessment record for this cycle, when one exists —
never a new reassessment decision.

## 11. CTA Routing

Exactly one primary CTA, always derived from `journey.next_action`
verbatim — S11-D never invents its own next-action logic.

| `next_action.code` | routes to |
|---|---|
| `REVIEW_PROGRESS` / `REVIEW_REASSESSMENT` | `progress` (this page) |
| `RECORD_REAL_MATCH` | `measure` (S11-D does not own Match Observation) |
| `ACTIVATE_PRESCRIPTION`/`START_TRAINING`/`CONTINUE_TRAINING`/`RESUME_SESSION` | `guided` |
| `START_ASSESSMENT`/`START_NEXT_CYCLE` | `measure` |
| `REVIEW_RECOMMENDATION` | `review` |

HOME's own routing (`js/home-priority-dashboard-ui.js`) is updated to
match. Guided Training's post-completion screen
(`js/guided-training-ui.js`) now calls
`PBGuidedTrainingController.refreshJourney(...)` after a successful
completion and renders its CTA from the **refreshed** Journey's
`next_action` (e.g. "View Progress" -> `progress`, "Record Real Match"
-> `measure`) — never a locally-decided action, falling back to
"Back to Home" only when no next_action is available.

## 12. Empty / Partial States

- **No progress at all** (no cycle): "No training progress is
  available yet." / "目前尚无可用的训练进步数据。" — CTA still comes from
  Journey (never a fabricated "Continue training").
- **Baseline missing**: "Baseline not available. Progress cannot yet
  be compared." / "基准值不可用，暂无法比较训练进步。"
- **Match missing**: "Match KPI evidence is not yet available. Match
  Progress remains unresolved." / "比赛 KPI 证据尚不可用，比赛进步仍未解析。" —
  never presented as failure.
- **Reassessment not ready**: neutral state ("Reassessment is not
  currently required." / "当前无需复测。"), never the Ready banner.

## 13. History Boundary

S11-D shows only current progress, current reassessment status, and
the latest reassessment summary if one already exists. It does not
build a full cycle history, full recommendation history, or evidence
lineage browser — that is explicitly out of scope, reserved for S11-E.

## 14. Persistence Decision

No new `IndexedDB` store, no `DB_VERSION` change (`DB_VERSION` stays
`5`, all 18 existing stores unchanged). This stage newly wires the
previously-unused S10-E-R1 engines (`cycle-baseline-engine.js`,
`progress-tracking-engine.js`, `reassessment-engine.js`,
`progress-reassessment-persistence.js`) into `index.html`'s script
chain for the first time; it does not change their schema or behavior.
Every `PBStore` call in the adapter is a read (structurally verified).

## 15. Mobile UX

Reuses the established `.hpd-*`/`.gt-*` primitives scoped to
`#progress-reassessment-app` — cards stack vertically by default, the
primary CTA stays full-width with a large touch target, and no new
`@media` breakpoint is introduced (checked structurally).

## 16. Tests

```bash
node tests/progress-reassessment-adapter.test.js
node tests/progress-reassessment-ui.test.js
```

Adapter suite covers D-T01–D-T16, including a real fake-IndexedDB
end-to-end case (genuine `PBCycleBaseline`/`PBProgressTracking`/
`PBProgressReassessmentPersistence` engines) proving the adapter reads
a real persisted Development Cycle, captures-then-reads a real
baseline, and reports `BASELINE_UNRESOLVED` honestly before capture and
`RESOLVED` after. UI suite covers D-U01–D-U14: bilingual rendering,
Baseline/Current/Change/Trend/Evidence display, percentage-point
formatting, the MATCH-unresolved and reassessment-banner wording, CTA
routing, no-fractional-level / no-training-as-match checks, and
exactly-one-primary-CTA.

`tests/pre-s7-ui-regression.test.js` re-executes the entire real script
chain (now including the 6 new `<script>` tags) against a fake DOM/
IndexedDB, proving nothing throws on load and `toggleLang()` still
works end-to-end.

## 17. Acceptance Gates

| Gate | Description | Status |
|---|---|---|
| D01 | S11-C accepted baseline lineage (`fa05c70` ancestor of HEAD) | PASS |
| D02 | MASTER CONTROL S11-C closure recorded | PASS |
| D03 | Progress UX consumes existing S10-E output | PASS |
| D04 | No Progress recalculation | PASS (D-T02–D-T07) |
| D05 | Immutable Baseline preserved | PASS (D-T16) |
| D06 | Current/Delta/Trend semantics preserved | PASS |
| D07 | Evidence Count traceable | PASS (D-T07) |
| D08 | TRAINING/MATCH separation preserved | PASS (D-T08–D-T10) |
| D09 | TRAINING Progress != MATCH Transfer | PASS |
| D10 | Progress != Validated Level | PASS (D-T11) |
| D11 | MATCH limitation represented honestly | PASS |
| D12 | No DB/schema change | PASS |
| D13 | Reassessment readiness comes from existing authority | PASS (D-T12) |
| D14 | next_action comes from S11-A | PASS (D-T13) |
| D15 | Real Match routes into accepted existing path | PASS |
| D16 | No S9 rerun | PASS (D-T14) |
| D17 | No S10 mutation ownership | PASS (D-T15) |
| D18 | Bilingual + mobile UX | PASS |
| D19 | FA24 governance updated narrowly | PASS |
| D20 | Full regression PASS | see final report |

## 18. Known Limitations

Carried forward from S10/S11-A/S11-B/S11-C: no durable
`kpi_profile_code`-aligned MATCH Evidence store exists, so
`match_transfer.validated` stays `false` in the live app today (see
§8). No baseline-capture writer exists anywhere in this app either
(`PBProgressReassessmentPersistence.captureBaselineDurable` is never
called in any production code path), so `training_progress.status`
will honestly read `BASELINE_UNRESOLVED` for a fresh cycle until a
future stage wires that capture step — this is exactly the same
"honest empty state, not a fabricated one" pattern already accepted
for S11-B/S11-C's own known limitations. Both are classified
**NON-BLOCKING** for S11-D.

## 19. Implementation Verdict

`IMPLEMENTED` — ready for GPT independent QA. This document does not
self-declare S11-D `CLOSED / ACCEPTED`; GPT owns final acceptance per
`docs/MASTER-CONTROL-V2.md`'s Version Control Rules (VC-06).
