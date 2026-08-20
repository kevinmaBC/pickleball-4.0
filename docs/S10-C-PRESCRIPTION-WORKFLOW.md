# S10-C: Training Prescription Workflow Integration

Implementation Engineer role — this stage wraps the already-accepted
S9-F Training Prescription output in a lifecycle (`DRAFTED → ACTIVE →
IN_PROGRESS`, plus `DEFERRED`/`UNRESOLVED`/`CANCELLED`/`SUPERSEDED`),
answering "what prescription is active, can it be activated, can
training start, which existing training structure should receive it."
It does not record actual training results — that is explicitly S10-D.

## Baseline

- Branch: `app-v2-alpha`
- Starting HEAD (verified at S10-C start): `4426250` /
  `44262501ce29fab4a5345bcba24149b34285bbb7` (accepted S10-B)
- Working tree at start: clean

## Files added

- `js/prescription-workflow-engine.js` — `PBPrescriptionWorkflow`, the
  S10-C lifecycle source of truth.
- `tests/prescription-workflow-engine.test.js` — targeted S10-C tests.
- `docs/S10-C-PRESCRIPTION-WORKFLOW.md` (this file).

## Files modified

- `docs/MASTER-CONTROL-V2.md` — Step 0 writeback (S10-B → CLOSED/
  ACCEPTED, S10-C → IMPLEMENTATION IN PROGRESS, then → IMPLEMENTED /
  GPT QA PENDING before this commit).

No S9, S10-A, or S10-B production file is modified.

## §6 Reuse-before-add decision: ADD MINIMAL BRIDGE (not REUSE, not BLOCKED)

Before writing any bridge code, `js/training-plan-engine.js` (S8-B) and
`js/storage.js`'s S8-A `training_cycles`/`weekly_plans`/`session_plans`
stores were inspected to check whether they could accept S9-F
Prescription output directly. Two concrete, disqualifying findings:

1. **Different FK lineage.** `PBStore.createTrainingCycle` requires
   `source_review_snapshot_id` and `source_prescription_id` to already
   exist as real records in the S7-A `review_snapshots`/`prescriptions`
   stores (`js/storage.js:325-329`), and `js/training-plan-engine.js`'s
   planning entry point re-validates the same two records
   (`js/storage.js` calls at `js/training-plan-engine.js:366-372`,
   throwing `MISSING_SOURCE_REVIEW_SNAPSHOT`/`MISSING_SOURCE_PRESCRIPTION`
   otherwise). That FK chain is rooted in S7's CAP/hard-gate/bottleneck
   Review Snapshot system — a different domain lineage than S9-F's
   per-match, per-skill-gap recommendation pipeline, which produces
   neither a Review Snapshot nor a record in the S7-A `prescriptions`
   store (S9-F's `prescription_id` values like `rx:m1:rec_1` are never
   written there). Reusing `createTrainingCycle` would require
   fabricating fake Review Snapshot/S7-A-Prescription records purely to
   satisfy foreign keys — corrupting both sides' semantics.
2. **Opposite unresolved-drill philosophy.** `js/training-plan-engine.js`
   `throw PlanningError('INCOMPLETE_MAPPING', 'no drill mapping exists
   for primary_bottleneck type...')` when a drill can't be resolved
   (`js/training-plan-engine.js:205`) — planning simply fails. S9-F/
   S10-C's frozen rule is the opposite: `drill_resolution_status:
   'UNRESOLVED'` is a valid, non-blocking outcome that must never be
   fabricated around (§11). Forcing S9-F prescriptions through S8-B's
   planning algorithm would either throw on every unresolved-drill
   prescription or require inventing a drill id to avoid the throw —
   both forbidden.

Given this, `js/prescription-workflow-engine.js` is a **minimal bridge**:
it borrows S8 SessionPlan's field vocabulary for the `session_intent`
shape (`session_id`, `status: 'PLANNED'`, etc. — see §15 below) for
familiarity, but never calls `js/training-plan-engine.js` or any S8-A
storage CRUD function. Nothing is deleted or bypassed — S8's own
TrainingCycle/WeeklyPlan/SessionPlan system continues to serve its
original CAP/bottleneck-driven use case untouched; S10-C simply does not
force S9-F's different-shaped data through it.

## Design decision: zero engine/storage coupling (same pattern as S10-A/B)

`js/prescription-workflow-engine.js` never `require`s or reads
`PBMatchObservation` / `PBPerformanceAnalysis` / `PBDiagnosis` /
`PBRecommendationPriority` / `PBTrainingPrescription` / `PBWorkflow` /
`PBDashboard` / `PBStore`. It only accepts an already-computed S9-F
Prescription object from the caller and wraps it. Test #24 and #29-32
structurally prove this via a comment-stripped source scan (same
technique as S10-A test #22 and S10-B tests #26-28) — including an
explicit scan for session-result vocabulary
(`successful_attempts`/`result_value`/`TRAINING_EVIDENCE`) to prove no
S10-D encroachment.

One consequence: **no new IndexedDB store, no `js/storage.js` changes,
no UI wiring** in this pass. `session_intent` is a plain returned
object, never persisted — nothing in §22's 32 required tests or §28's
22 acceptance criteria requires persistence or a rendered UI, and
adding either now would risk exactly the kind of premature/duplicate
storage §20 forbids. Precedent: S10-A shipped with zero persistence and
was accepted; S10-B shipped as adapter-only and was judged "CORE ADAPTER
PASS" with UI wiring explicitly deferred to a separate, GPT-requested
follow-up (S10-B-R1). This stage follows the same two-phase pattern —
if GPT's QA wants a "S10-C-R1" UI wiring pass (e.g. an "Activate" /
"Start Training" affordance on the existing S10-B Recommendation/
Training Focus card), that is a natural, narrowly-scoped follow-up, not
something to speculatively build now.

## Contract

`createPrescriptionWorkflow({ prescription, player_id?, workflow_id? })`
returns:

```json
{
  "prescription_workflow": {
    "workflow_id": "...",
    "prescription_ref": "...",
    "recommendation_ref": "...",
    "player_id": "...",
    "state": "DRAFTED",
    "session_refs": [],
    "activated_at": null,
    "completed_at": null,
    "superseded_by": null,
    "prescription_snapshot": { "...": "all 15 §7 fields, copied verbatim" },
    "schema_version": "1.0",
    "contract_version": "S10-C-V1",
    "created_at": "...",
    "updated_at": "..."
  }
}
```

`prescription_snapshot` holds all 15 fields §7 requires
(`prescription_id`, `source_recommendation_id`,
`training_objective_code`, `training_mode`, `drill_family_code`,
`priority_rank`, `priority_score`, `priority_tier`, `kpi_profile_code`,
`kpi_target_value`, `kpi_target_status`, `dosage_profile_code`,
`resolved_drill_ids`, `drill_resolution_status`,
`reassessment_profile_code`, `status`) copied verbatim at creation time
and never mutated afterward — it is the "what prescription is active"
answer, distinct from `state` (the "can it be activated / has training
started" answer). Test #19 proves `prescription_snapshot.status` never
changes even as `state` moves DRAFTED → ACTIVE → IN_PROGRESS (§18).

## State model

Main states (§9): `DRAFTED`, `ACTIVE`, `IN_PROGRESS`, `COMPLETED`,
`EVALUATED`. Auxiliary states: `DEFERRED`, `UNRESOLVED`, `CANCELLED`,
`SUPERSEDED`. `COMPLETED`/`EVALUATED` are valid `state` values (test #5
checks they're in `PW.MAIN_STATES`) but **no S10-C action transitions
into them** — reaching `COMPLETED` requires a real session result,
which is explicitly S10-D's responsibility (§3/§14), not this file's.

`transition(workflow, action, payload)` handles `ACTIVATE` /
`MARK_UNRESOLVED` / `DEFER` / `RESUME` / `CANCEL` via the frozen table in
`PW.VALID_TRANSITIONS`; any `(state, action)` pair absent from it is
rejected as `INVALID_INPUT`. It is pure — returns a new workflow object
or throws, never mutates its input.

## Activation gate (§10)

`canActivate(prescription_snapshot)` checks, in order:
`MISSING_PRESCRIPTION` → `MISSING_RECOMMENDATION_REF` →
`INVALID_PRESCRIPTION_STATUS` (must be exactly `'prescribed'`) →
`MISSING_PRIORITY` (rank/score/tier all required) →
`MISSING_TRAINING_OBJECTIVE` → `MISSING_TRAINING_MODE` →
`MISSING_KPI_PROFILE`. `drill_resolution_status === 'UNRESOLVED'` and
`kpi_target_status === 'BENCHMARK_NOT_RESOLVED'` are never checked here
— they never block eligibility (§11/§12, tests #13/#15).
`transition(workflow, 'ACTIVATE', {})` runs this gate and throws the
matching code on failure — never a silent no-op activation.

## Staleness (§16, Rule 5)

`ACTIVATE` and `startTraining` both accept `payload.stale === true` and
throw `STALE_RECOMMENDATION` when set (tests #25/#26). S10-C never
decides staleness itself — it has no dependency on `PBWorkflow` (S10-A)
or any evidence/reassessment logic, so it only honors whatever boolean
signal the caller already determined (e.g. from an S10-A
`development_cycle.state === 'REASSESSMENT_READY'`, or an S10-B
dashboard item's `reassessment_pending`). This keeps the zero-coupling
guarantee intact while still enforcing the rule deterministically.

## START_TRAINING (§14/§15)

`startTraining(workflow, payload)` — a dedicated function (not the
generic `transition` table, since it both changes state and returns a
richer shape) — requires `workflow.state === 'ACTIVE'`, applies the
staleness check above, and returns:

```json
{
  "workflow": { "...": "state: IN_PROGRESS, session_refs appended" },
  "session_intent": {
    "session_id": "...",
    "prescription_ref": "...",
    "player_id": "...",
    "status": "PLANNED",
    "training_objective_code": "...",
    "training_mode": "...",
    "kpi_profile_code": "...",
    "schema_version": "1.0"
  }
}
```

`session_intent` never carries `attempts`/`successful_attempts`/
`result_value`/`completed`/`evidence_type`/a drill id/a numeric dosage
(tests #14/#18/#20/#21) — it is planned intent only.

## Supersession (§17)

`supersede(oldWorkflow, newPrescriptionOpts)` moves the old workflow to
`SUPERSEDED` (recording `superseded_by`) and creates a brand-new
`DRAFTED` workflow via `createPrescriptionWorkflow` for the replacement
prescription — both objects are returned; nothing is deleted, and the
old workflow's `prescription_ref`/`activated_at`/`session_refs` history
stays exactly as it was (test #27). Only valid from
`DRAFTED`/`ACTIVE`/`IN_PROGRESS`/`DEFERRED`.

## Tests

`node tests/prescription-workflow-engine.test.js` — all 32 §22 targeted
cases across contract/lifecycle, activation, unresolved semantics,
separation, S8 bridge, staleness/supersession, determinism, and
architecture protection. The suite also spawns the four most
directly-relevant accepted suites
(`training-prescription-engine.test.js`, `s9-full-system-qa.test.js`,
`workflow-integration-engine.test.js`,
`dashboard-integration-engine.test.js`) as child processes and asserts
each still exits 0, unmodified.

Full regression: `node tests/*.test.js` — see commit report for the
exact suite count. No existing test file was modified.

## Acceptance criteria self-check (not final acceptance — GPT owns that)

| # | Criterion | Status |
|---|---|---|
| 1 | MASTER CONTROL S10-B acceptance writeback completed | `docs/MASTER-CONTROL-V2.md`: S10-B → CLOSED/ACCEPTED, commit `4426250` |
| 2 | S10-C status recorded as GPT QA pending | `docs/MASTER-CONTROL-V2.md`: S10-C → IMPLEMENTED / GPT QA PENDING |
| 3 | S9-F prescription consumed verbatim | `prescription_snapshot`, all 15 fields, tests #3/#4 |
| 4 | Prescription workflow lifecycle implemented | `createPrescriptionWorkflow`/`transition`/`startTraining`/`supersede` |
| 5 | Prescription status / workflow state separated | Test #19 |
| 6 | S8 architecture reused before add | §6 decision above, with concrete evidence |
| 7 | No parallel training planning system | Test #24 — zero `PBStore`/persistence coupling |
| 8 | UNRESOLVED drill remains valid | Test #13 |
| 9 | BENCHMARK_NOT_RESOLVED remains valid | Test #15 |
| 10 | No fabricated drill | Tests #14/#18 |
| 11 | No fabricated KPI target | Test #16 |
| 12 | No fabricated numeric dosage | Tests #17/#18 |
| 13 | Start Training gate exists | `startTraining`, requires `state === 'ACTIVE'` |
| 14 | Stale prescription blocks new training | Tests #25/#26 |
| 15 | Supersession preserves history | Test #27 |
| 16 | Session Plan/Intent != Session Result | Tests #20/#21 |
| 17 | No S10-D evidence logic implemented | Tests #21/#32 |
| 18 | Deterministic behavior preserved | Test #28 |
| 19 | Targeted tests PASS | `prescription-workflow-engine.test.js` |
| 20 | Relevant regression PASS | See commit report |
| 21 | S1–S10-B accepted behavior preserved | No production file outside this stage's additions touched |
| 22 | Claude STOPPED before S10-D | This report is the stop point |

## Implementation Verdict

```
READY FOR GPT INDEPENDENT ACCEPTANCE
```
