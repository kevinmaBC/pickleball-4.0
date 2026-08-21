# S11-A — Product Journey Orchestrator / User State Contract

Stage: `S11-A`
Status: `IMPLEMENTED / GPT QA PENDING`
Files:
- `js/product-journey-orchestrator.js`
- `tests/product-journey-orchestrator.test.js`
- `docs/MASTER-CONTROL-V2.md` (Step 0 — S10-FINAL closure)

## 1. Purpose

Answers exactly one question:

> What stage of the product journey is the player currently in, and
> what is the single primary next user action?

`js/product-journey-orchestrator.js` (global `PBProductJourney`) is an
**Orchestration / Projection** layer, analogous in kind to
`js/dashboard-integration-engine.js` (S10-B): a pure, deterministic
function over already-computed S9/S10 domain objects that produces one
disposable **Product Journey View Model**. It is not a Decision Engine,
Workflow State Machine, Persistence Authority, Recommendation Engine,
Training Prescription Engine, Progress Engine, or Reassessment Engine.

Frozen architecture:

```
S9 Engines
    v
S10 Domain / Workflow Engines
    v
S11-A Product Journey Orchestrator
    v
future S11 UI
```

## 2. Frozen Authority Boundaries

Unchanged Sources of Truth:

| Concept                        | Owner  |
|---------------------------------|--------|
| Diagnosis / Recommendation / Priority / Training Prescription | S9 |
| Development Cycle state         | S10-A (`js/workflow-integration-engine.js`) |
| Prescription Workflow state     | S10-C (`js/prescription-workflow-engine.js`) |
| Session Result / TRAINING Evidence | S10-D (`js/session-evidence-engine.js`) |
| Progress / Reassessment         | S10-E-R1 (`js/progress-tracking-engine.js`, `js/reassessment-engine.js`) |
| Product Journey Projection      | **S11-A** (this file) |

`js/product-journey-orchestrator.js` has **zero runtime dependency** on
any S9/S10 engine or on `js/storage.js` — it never `require()`s or
reads any of their globals (`PBDiagnosis`, `PBRecommendationPriority`,
`PBTrainingPrescription`, `PBWorkflow`, `PBPrescriptionWorkflow`,
`PBSessionEvidence`, `PBProgressTracking`, `PBReassessment`,
`PBCycleBaseline`, `PBStore`). It only accepts already-computed plain
objects from the caller. This is proven structurally by
`tests/product-journey-orchestrator.test.js` T12/T13/T14/T17 (source
scans for the forbidden tokens above, plus `require(`).

Hard boundaries preserved:
- UI != Engine
- Journey State != Workflow State (`journey.stage` is never written
  onto `development_cycle.state` / `prescription_workflow.state`, and
  vice versa — both stay verbatim in `journey.workflow_context`)
- Orchestrator != Decision Engine
- Recommendation != Priority != Prescription
- Prescription != Prescription Workflow != Session Result
- Session Result != Evidence
- Progress != Recommendation
- TRAINING Progress != MATCH Transfer

## 3. Seven Product Journey Stages

```
NEEDS_ASSESSMENT
REVIEW_RECOMMENDATION
READY_TO_TRAIN
TRAINING_IN_PROGRESS
REVIEW_PROGRESS
READY_TO_REASSESS
CYCLE_COMPLETE
```

These are presentation/product stages — a frozen local constant
(`PBProductJourney.JOURNEY_STAGES`) never derived from, or written
back onto, `development_cycle.state`.

## 4. Journey Status

Separate from `stage`. One of `READY / PARTIAL / UNRESOLVED / BLOCKED`
(`PBProductJourney.JOURNEY_STATUSES`). No eighth stage
(`ERROR`/`FAILED`/`UNRESOLVED`) is ever introduced — unresolved
conditions are additive `status` + `presentation_flags` only.

## 5. Input Contract

```js
PBProductJourney.projectJourney({
  player,                  // { player_id, ... }
  development_cycle,       // S10-A development_cycle object, or omitted/null
  recommendations,         // S9-E Recommendation[]
  prescriptions,           // S9-F Prescription[]
  prescription_workflows,  // S10-C PrescriptionWorkflow[]
  session_results,         // S10-D session_execution-shaped objects (state: 'ACTIVE' marks a resumable session)
  progress,                // S10-E-R1 progress_snapshot[] (TRAINING and/or MATCH source)
  reassessment              // S10-E-R1 reassessment record(s), or null
});
```

`player_id` resolves from `player.player_id`, falling back to
`development_cycle.player_id`. All array inputs default to `[]` when
omitted. `projectJourney` never calls `diagnoseMatch`,
`prioritizeDiagnosis`, `prescribeRecommendations`, `computeProgress`,
`computeProgressSnapshot`, or `runReassessment`/
`checkReassessmentEligibility`, and never constructs a
`DevelopmentCycle`, `PrescriptionWorkflow`, `SessionResult`, `Evidence`,
or `Reassessment` record — it only reads what the caller already
computed.

## 6. Output Contract

```js
{
  journey: {
    player_id, cycle_ref,
    stage, status,
    headline_code,               // the raw development_cycle.state (or 'NO_ACTIVE_CYCLE'), preserved verbatim
    next_action: { code, enabled, target_ref },
    secondary_actions: [],
    current_focus: { recommendation_ref, priority_rank, prescription_ref },
    workflow_context: { development_cycle_state, prescription_workflow_state },
    progress_context: { training, match } | null,
    reassessment: { required, match_required, reassessment_ref },
    presentation_flags: [ ... ],
    schema_version: '1.0',
    journey_version: 'S11-A-V1'
  }
}
```

## 7. Next Action Vocabulary

```
START_ASSESSMENT, REVIEW_RECOMMENDATION, ACTIVATE_PRESCRIPTION,
START_TRAINING, CONTINUE_TRAINING, RESUME_SESSION, REVIEW_PROGRESS,
RECORD_REAL_MATCH, REVIEW_REASSESSMENT, START_NEXT_CYCLE, NONE
```

Exactly one primary `next_action` is always emitted
(`PBProductJourney.NEXT_ACTIONS`). `next_action` identifies product
navigation intent only — it never executes the underlying domain
action (that stays owned by `PBWorkflow`/`PBPrescriptionWorkflow`/
`PBSessionEvidence`, called by a future S11 UI layer, never by this
file).

## 8. Stage Mapping

`development_cycle.state` is the sole primary signal for `stage`.
Prescription workflow / session / progress objects only ever choose
**between** next_actions already implied by that state — they never
upgrade or override the stage.

| `development_cycle.state`        | `stage`               | `next_action`                                   |
|-----------------------------------|------------------------|--------------------------------------------------|
| *(no cycle)*                      | `NEEDS_ASSESSMENT`     | `START_ASSESSMENT`                                |
| `BASELINE_READY` / `EVIDENCE_AVAILABLE` | `NEEDS_ASSESSMENT` | `START_ASSESSMENT`                          |
| `RECOMMENDATION_READY`            | `REVIEW_RECOMMENDATION`| `REVIEW_RECOMMENDATION` (or `ACTIVATE_PRESCRIPTION` only if an eligible prescription+workflow already exists) |
| `PRESCRIPTION_READY`              | `READY_TO_TRAIN`       | `ACTIVATE_PRESCRIPTION` (workflow `DRAFTED`) / `START_TRAINING` (workflow `ACTIVE`) |
| `TRAINING_ACTIVE`                 | `TRAINING_IN_PROGRESS` | `RESUME_SESSION` (resumable session found) / `CONTINUE_TRAINING` |
| `SESSION_COMPLETED` / `PROGRESS_RECORDED` | `REVIEW_PROGRESS` | `REVIEW_PROGRESS`                        |
| `REASSESSMENT_READY`              | `READY_TO_REASSESS`    | `RECORD_REAL_MATCH` (always — see §9)             |
| `CYCLE_COMPLETED`                 | `CYCLE_COMPLETE`       | `START_NEXT_CYCLE`                                |

No S10-C activation-gate logic, S10-A transition logic, or S10-E
progress/reassessment formula is re-implemented — each case only reads
`state`/`prescription_ref`/`session_id` fields already computed
upstream.

## 9. Conflict Precedence

Frozen precedence: `REASSESSMENT_REQUIRED > TRAINING > PRESCRIPTION >
RECOMMENDATION > ASSESSMENT`.

Because `development_cycle.state` is a single enum
(`REASSESSMENT_READY` is a distinct state, never co-occurring with
`PRESCRIPTION_READY`/`TRAINING_ACTIVE`), precedence is structurally
guaranteed: whenever `development_cycle.state === 'REASSESSMENT_READY'`,
`stage` is always `READY_TO_REASSESS` and `next_action.code` is always
`RECORD_REAL_MATCH` — regardless of whether an old
`prescription_workflow` for the same cycle is still `ACTIVE` or
`IN_PROGRESS` in the input. `secondary_actions` stays empty, so no
enabled `START_TRAINING`/`CONTINUE_TRAINING` action can leak through
either. Verified by `tests/product-journey-orchestrator.test.js` T09.

## 10. Stale Recommendation / Prescription Rule

When `development_cycle.state === 'REASSESSMENT_READY'`, the old
recommendation/prescription refs remain visible in `current_focus`
(never erased) but `presentation_flags` always includes
`REASSESSMENT_REQUIRED`, plus `STALE_RECOMMENDATION` /
`STALE_PRESCRIPTION` when those refs are present. `workflow_context`
still reports the old `prescription_workflow_state` verbatim (e.g.
`ACTIVE`/`IN_PROGRESS`) so history is never simply invisible. Verified
by T09/T20.

## 11. Unresolved Semantics

Raw accepted machine codes (`UNRESOLVED`, `BENCHMARK_NOT_RESOLVED`,
`INSUFFICIENT_DATA`) are read straight from the input
prescription/progress objects and surfaced verbatim as
`presentation_flags` entries (`DRILL_UNRESOLVED`, `KPI_TARGET_UNRESOLVED`,
`MATCH_PROGRESS_INSUFFICIENT_DATA`) — never translated into
`FAILED`/`ERROR`/`NO_TRAINING`/`SUCCESS`. `progress_context.training`/
`.match` objects are passed through with their own `trend`/
`target_status` fields untouched. Verified by T15.

## 12. MATCH Progress Known Limitation

Carried forward unchanged from S10 (`docs/MASTER-CONTROL-V2.md`
"KNOWN LIMITATION — MATCH PROGRESS"): no durable
`kpi_profile_code`-aligned MATCH Evidence store exists, so numeric
MATCH progress may legitimately arrive as `UNRESOLVED`/
`INSUFFICIENT_DATA`. `progress_context.training` and
`progress_context.match` are always two independent fields
(`js/progress-tracking-engine.js`'s own Rule 4) — TRAINING progress is
never substituted for, or implied to stand in for, MATCH progress.
Verified by T16.

## 13. Persistence Decision

Journey projection is a **derived / disposable view model**. It is
never persisted:
- No `IndexedDB` store added, no `DB_VERSION` change (`DB_VERSION`
  stays `5`, all 18 existing stores unchanged).
- `js/product-journey-orchestrator.js` never references `PBStore`,
  `indexedDB`, `IDBKeyRange`, or `localStorage` (T17, source-scanned).
- No `Date.now()`/`new Date()`/randomness anywhere in the decision
  logic — the same input always regenerates the identical output
  (T19).

## 14. Tests

`tests/product-journey-orchestrator.test.js` — run with:

```bash
node tests/product-journey-orchestrator.test.js
```

Covers T01–T20 from the frozen package (new-player / baseline / evidence
/ recommendation / prescription / training-active / session-completed /
progress-recorded / reassessment-precedence / cycle-complete / exactly-
one-primary-action / no-S9-invocation / no-progress-reassessment-
recalculation / no-workflow-transition-ownership / UNRESOLVED
preservation / TRAINING-MATCH separation / no-persistence / DB_VERSION
+ store-count regression guard / deterministic regeneration /
historical-reference preservation), plus explicit structurally-invalid-
input error-code tests and a regression re-run of the S9/S10 suites this
stage's fixtures are shaped from.

## 15. Acceptance Gates

| Gate | Description | Status |
|------|--------------|--------|
| A01 | Baseline lineage (`4024f67` ancestor of HEAD, clean tree) | PASS |
| A02 | MASTER CONTROL final S10 closure recorded | PASS |
| A03 | Journey Orchestrator is pure projection (no I/O, no persistence) | PASS |
| A04 | No S9 Decision Engine invocation | PASS (T12) |
| A05 | No S10 workflow transition ownership | PASS (T14) |
| A06 | Journey Stage != Domain State | PASS |
| A07 | Seven Journey Stages deterministic | PASS |
| A08 | Exactly one primary next_action | PASS (T11) |
| A09 | REASSESSMENT_READY overrides training | PASS (T09) |
| A10 | Stale prescription cannot remain primary Start Training path | PASS (T09/T20) |
| A11 | UNRESOLVED raw codes preserved | PASS (T15) |
| A12 | TRAINING/MATCH separation preserved | PASS (T16) |
| A13 | MATCH Progress limitation preserved | PASS |
| A14 | No new IndexedDB store / DB_VERSION remains 5 | PASS (T18) |
| A15 | Deterministic reload/regeneration | PASS (T19) |
| A16 | Full regression PASS | 34/35 (see §16) |

## 16. Defects / Findings

`tests/s10-final-acceptance.test.js` fails identically at the frozen
baseline commit `4024f67` (verified by running it standalone against
HEAD before any S11-A file was touched) — its assertion
`mc.indexOf('S10-FINAL\nStatus: FINAL QA IN PROGRESS')` expects
`docs/MASTER-CONTROL-V2.md` to still read the transient
"FINAL QA IN PROGRESS" text from mid-way through the S10-FINAL QA pass,
which the repository had already moved past
("IMPLEMENTED / GPT FINAL ACCEPTANCE PENDING") before this stage
began. This is a pre-existing, out-of-scope test/doc snapshot mismatch,
not a regression introduced by S11-A; per this stage's scope boundary
("do not silently fix unrelated technical debt", S9/S10 ownership
untouched) it was left as-is and reported here rather than edited.

## 17. Implementation Verdict

`IMPLEMENTED` — ready for GPT independent QA. This document does not
self-declare S11-A `CLOSED / ACCEPTED`; GPT owns final acceptance per
`docs/MASTER-CONTROL-V2.md`'s Version Control Rules (VC-06).
