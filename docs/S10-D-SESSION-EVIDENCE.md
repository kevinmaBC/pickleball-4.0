# S10-D: Training Session Execution + Evidence Capture

Implementation Engineer role — this stage executes the frozen chain
`S9-F Prescription → S10-C Prescription Workflow → Session Intent →
S10-D Session Execution → Session Result → TRAINING Evidence → S10-A
ADD_EVIDENCE → Reassessment Eligibility`. Execution produces Result.
Result produces Evidence. Evidence drives Reassessment. This stage does
not calculate progress, trends, KPI verdicts, or any new
recommendation/priority/prescription decision — that stays S9/S10-E.

## Baseline

- Branch: `app-v2-alpha`
- Starting HEAD (verified at S10-D start): `ca3e732` /
  `ca3e7322f8cd02210e9c6fb867742c4520e32f8e` (accepted S10-C)
- Working tree at start: clean

## Files added

- `js/session-evidence-engine.js` — `PBSessionEvidence`, the S10-D
  Session Execution / Session Result / TRAINING Evidence source of
  truth.
- `tests/session-evidence-engine.test.js` — targeted S10-D tests.
- `docs/S10-D-SESSION-EVIDENCE.md` (this file).

## Files modified

- `docs/MASTER-CONTROL-V2.md` — Step 0 writeback (S10-C → CLOSED/
  ACCEPTED, S10-D → IMPLEMENTATION IN PROGRESS, then → IMPLEMENTED /
  GPT QA PENDING before this commit).

No S9, S10-A, S10-B, or S10-C production file is modified.

## §6 Execution bridge decision: ADD MINIMAL EXECUTION BRIDGE

Before writing any bridge code, `js/session-execution-engine.js` (S8-C)
was inspected to check whether it could execute S10-C's Session Intent
directly. One disqualifying finding, on top of the FK-lineage
incompatibility S10-C's own bridge decision already documented for
S8-B/S8-A:

`startSession`/`finalizeSession` both begin with
`PBStore.getSessionPlan(session_plan_id)` (`js/session-execution-
engine.js:170,222`) — they can only operate on a **persisted** S8-A
`session_plans` record. That record's own FK chain (`week_plan_id` →
`weekly_plans` → `cycle_id` → `training_cycles` →
`source_review_snapshot_id`/`source_prescription_id` in the S7-A
`review_snapshots`/`prescriptions` stores) is exactly the CAP/
bottleneck-periodization lineage `docs/S10-C-PRESCRIPTION-WORKFLOW.md`
already established as incompatible with S9-F's per-match recommendation
pipeline. S10-C's `session_intent` is a transient, unpersisted plain
object — it has no `session_plan_id` `PBStore.getSessionPlan` could ever
resolve. Reusing S8-C would require fabricating a fake S8-A
TrainingCycle/WeeklyPlan/SessionPlan chain purely to satisfy its
lookups, which is explicitly forbidden (§6/§30 "no fabricated S8 FK
records").

`js/session-evidence-engine.js` is therefore a **minimal execution
bridge**. It reuses S8-C's proven *architecture pattern* — an in-flight
`ACTIVE` state is just a plain object (no persistence), and only a
terminal `COMPLETE` call produces a "real" record, with one
finalization enforced explicitly (`DUPLICATE_FINALIZATION`, mirroring
S8-C's own `SESSION_ALREADY_FINALIZED`) — without touching S8-A's
FK-validated storage at all. S8-C itself is untouched and continues to
serve its original CAP/bottleneck-driven use case.

## Persistence decision

**No new IndexedDB store, no `js/storage.js` change, no `PBStore` call
anywhere in this file** (test #32 proves this structurally). Every
function is a pure transform on plain objects, exactly like S10-A/B/C
before it. Duplicate protection for both finalization (`execution.state`
already terminal) and evidence (`development_cycle.evidence_refs`
already contains the deterministic id) reuses state the caller *already
holds* — no new storage was needed to satisfy §11/§15's duplicate-
protection requirements.

This does **not** mean durable cross-reload survival was solved: it
genuinely was not, and this is reported honestly rather than glossed
over. §21's decision hierarchy was followed to the letter:

1. *Reuse existing S8 session/result persistence* — rejected above (FK
   lineage incompatible).
2. *Reuse existing accepted S10/S8 records* — there is nothing to reuse:
   S10-A/B/C added zero persisted stores, so there is no existing S10
   record for a Session Result/Evidence to live in. The other candidate
   generic envelope stores (S7-A's `review_snapshots`/`prescriptions`/
   `retests`, all keyed by `assessment_id`) belong to a different
   domain concept (CAP/promotion-review) and reusing them would be the
   same category of semantic corruption already rejected for S8's
   stores — not a legitimate "existing accepted S10/S8 record" for this
   data.
3. Durable storage genuinely requires a new, purpose-built store — which
   §21/§30 explicitly reserve for GPT approval, not self-authorization.

Given that, this pass delivers 100% of the pure domain logic (session
lifecycle, numeric validation, the Evidence Eligibility Gate, TRAINING
Evidence construction, and the mandatory S10-A `ADD_EVIDENCE` bridge —
everything the 39 targeted tests in §27 cover) and reports the
reload-survival gap explicitly rather than inventing a store to paper
over it or declaring the whole package BLOCKED when the vast majority of
it has no persistence dependency at all. This mirrors the two-phase
pattern already established twice in this codebase: S10-A shipped with
zero persistence (accepted), and S10-B shipped adapter-only with UI
wiring deferred to a separate, explicitly-scoped follow-up (S10-B-R1).
A durable-evidence-store decision, if GPT wants one, is a natural
"S10-D-R1"-shaped follow-up once that specific architecture question is
answered — not something to self-authorize here.

Tests #33/34 ("production persistence behavior tested honestly" /
"reload does not duplicate ... where persistence exists") are satisfied
by testing exactly what exists: duplicate-finalization and
duplicate-evidence protection both survive a plain-object
serialize/deserialize round-trip (the only "reload" this transient
architecture can honestly claim), using no fabricated persistence layer.

## Design decision: exactly one legitimate upstream dependency

Unlike S10-A/B/C's zero-coupling engines, Rule 4 explicitly requires
this file to call the accepted S10-A `ADD_EVIDENCE` transition itself
(not leave it to the caller). `js/session-evidence-engine.js` therefore
has exactly one legitimate upstream dependency — `PBWorkflow` (S10-A) —
guarded the same way S9-E only calls `PBDiagnosis` and S9-F only calls
`PBRecommendationPriority` (a `wfEngine()` helper that throws
`DEP_MISSING` if `PBWorkflow` isn't loaded). It never references
`PBMatchObservation`/`PBPerformanceAnalysis`/`PBDiagnosis`/
`PBRecommendationPriority`/`PBTrainingPrescription`/
`PBPrescriptionWorkflow`/`PBDashboard`/`PBStore` (test #32, structural
scan). S10-A alone decides the resulting workflow state — this file
never assigns `REASSESSMENT_READY` itself (test #26/#27 prove the
returned state is exactly what `PBWorkflow.transition` independently
computes).

`PBWorkflow.createEvidence()` (S10-A's own generic Evidence
constructor) is deliberately **not** called here, even though Evidence
"aligns with S10-A semantics" per §14: it mints a random `uid('ev')`,
which would break the deterministic identity §15 requires (a second
build for the same session/KPI must yield the same id). Instead this
file builds the Evidence object itself, reusing S10-A's actual field
convention (`skill`/`kpi`/`value`/`context`/`confidence`/`timestamp`)
plus the S10-D-specific traceability fields (`session_ref`,
`prescription_ref`, `recommendation_ref`), with a deterministic
`evidence_id = 'ev:' + session_id + ':' + kpi_profile_code`.

## Contracts

**Session Execution** (`createSessionExecution({ session_intent,
recommendation_ref? })`): validates the S10-C `session_intent` shape
(`session_id`, `prescription_ref`, `player_id`, `kpi_profile_code`
required), returns a `PLANNED` execution object.
`recommendation_ref` is accepted as an optional caller-supplied field
(§9/§20: "directly or through Prescription Workflow") since S10-C's
`session_intent` itself doesn't carry it and this file does not depend
on `PBPrescriptionWorkflow` to look it up.

**Lifecycle**: `PLANNED → ACTIVE → COMPLETED` (main), plus
`PARTIAL`/`SKIPPED`/`CANCELLED`/`INVALID` (auxiliary). `transition()`
handles the simple moves (`START`, `SKIP`, `CANCEL`); `completeSession()`
is a dedicated function (like S10-C's `startTraining`) because it
validates numerics and returns a distinctly-shaped `session_result`
object rather than just an execution with a new `state`. `INVALID` is
part of the frozen state vocabulary but no action transitions into it
here — malformed input is always rejected with an explicit error
instead (matching S10-C's precedent for its own unused `UNRESOLVED`
auxiliary state).

**Session Result** (`completeSession(execution, { attempts,
successful_attempts, completed_at? })`): requires `execution.state ===
'ACTIVE'`; rejects with `DUPLICATE_FINALIZATION` if already terminal.
`attempts`/`successful_attempts` must be non-negative integers,
`successful_attempts <= attempts`. `result_value = successful_attempts /
attempts`, rounded; `null` (never `NaN`) when `attempts === 0` — a
0-attempt session can still finalize as a Session Result, it just can't
support a ratio.

**Evidence Eligibility Gate** (`canGenerateEvidence(session_result)`):
`status === 'COMPLETED'`, `attempts > 0`, valid `successful_attempts`,
finite `result_value`, and `session_id`/`prescription_ref`/`player_id`/
`kpi_profile_code` all present — the `attempts <= 0` case (test #8) is
rejected *here*, deliberately kept separate from whether `completeSession`
itself succeeds (Rule 1: Result and Evidence are different gates).

**TRAINING Evidence** (`buildTrainingEvidence(session_result)`):
`source` is always exactly `'TRAINING'`. `PARTIAL`/`SKIPPED`/
`CANCELLED` executions never reach `COMPLETED`, so they can never pass
the gate — and per Rule 3, `transition('SKIP'|'CANCEL', ...)` never
attaches `attempts`/`successful_attempts`/`result_value` fields at all
(test #15: the fields are `undefined`, not `0`) — "not performed" is
structurally incapable of looking like "performance zero".

**S10-A bridge** (`submitTrainingEvidence(session_result,
development_cycle)`): requires a `development_cycle` with a recognized
`PBWorkflow` state (§17 "legitimate development cycle") — rejects
`MISSING_DEVELOPMENT_CYCLE` otherwise, never fabricating one (this file
has no `baseline_ref`/`player_id`-sufficient context to legitimately
call `PBWorkflow.createDevelopmentCycle` itself even if it wanted to).
Checks `development_cycle.evidence_refs` for the deterministic
`evidence_id` first (`DUPLICATE_EVIDENCE` if already present), then
calls `PBWorkflow.transition(development_cycle, 'ADD_EVIDENCE', {
evidence_ref })` itself (Rule 4) and returns whatever cycle S10-A
computed — including a `REASSESSMENT_READY` state if the cycle already
had a recommendation on file (test #27).

## Tests

`node tests/session-evidence-engine.test.js` — all 39 §27 targeted
cases across contract/lifecycle, numeric validation, completion,
non-evidence states, evidence, the S10-A bridge, separation,
persistence/reload, and architecture protection. The suite also spawns
the four most directly-relevant accepted suites
(`workflow-integration-engine.test.js`,
`dashboard-integration-engine.test.js`,
`prescription-workflow-engine.test.js`, `s9-full-system-qa.test.js`) as
child processes and asserts each still exits 0, unmodified.

Full regression: `node tests/*.test.js` — see commit report for the
exact suite count. No existing test file was modified.

## Acceptance criteria self-check (not final acceptance — GPT owns that)

| # | Criterion | Status |
|---|---|---|
| 1 | MASTER CONTROL records S10-C CLOSED/ACCEPTED @ ca3e732 | `docs/MASTER-CONTROL-V2.md` |
| 2 | S10-D status is GPT QA pending | `docs/MASTER-CONTROL-V2.md` |
| 3 | S10-C Session Intent consumed correctly | `createSessionExecution`, tests #1 |
| 4 | Session lifecycle implemented | `transition`/`completeSession`, tests #2-4 |
| 5 | Valid completion creates one Session Result | Test #10 |
| 6 | Duplicate completion blocked | Test #11, `DUPLICATE_FINALIZATION` |
| 7 | Only valid COMPLETED result creates TRAINING Evidence | Tests #12-14, `canGenerateEvidence` |
| 8 | PARTIAL/SKIPPED/CANCELLED create no Evidence | Tests #12-14 |
| 9 | No non-performance state becomes zero performance | Test #15 |
| 10 | Evidence source is TRAINING | Test #17 |
| 11 | Evidence traceability preserved | Tests #18-22 |
| 12 | Duplicate evidence blocked/idempotent | Test #23 |
| 13 | Evidence explicitly enters S10-A ADD_EVIDENCE | Tests #24/25 |
| 14 | development_cycle evidence_refs updates | Test #25 |
| 15 | S10-A controls reassessment state | Tests #26/27 |
| 16 | S10-D does not create new recommendation/priority | Test #28 |
| 17 | S10-D does not calculate progress verdict/trend | Test #31 |
| 18 | S8 execution semantics reused where safe | §6 decision above (pattern reused, storage not) |
| 19 | No fake S8 lineage | No `PBStore` reference at all (test #32) |
| 20 | No unauthorized persistence redesign | No new store; gap reported explicitly above |
| 21 | Reload/idempotency safe or accurately BLOCKED | Reported: duplicate-protection safe *for the state that exists*; durable cross-reload survival explicitly flagged, not silently skipped |
| 22 | Deterministic business outputs | Test #9 (`result_value`), deterministic `evidence_id` |
| 23 | Targeted tests PASS | `session-evidence-engine.test.js` |
| 24 | Relevant/full regression PASS | See commit report |
| 25 | Claude STOPPED before S10-E | This report is the stop point |

## Implementation Verdict

```
READY FOR GPT INDEPENDENT ACCEPTANCE
```
