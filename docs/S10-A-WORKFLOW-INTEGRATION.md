# S10-A: Product Workflow Integration Architecture Implementation

Implementation Engineer role — this stage adds a Product Workflow
Integration Layer that connects the already-accepted S1–S9 domain
outputs (Player Profile → Assessment/Match Observation → Evidence →
Findings → Recommendation → Priority → Training Prescription → Training
Session → Progress → Reassessment) into one versioned Development Cycle
contract and state model. It introduces no new recommendation, scoring,
or assessment engine.

## Baseline

- Branch: `app-v2-alpha`
- Starting HEAD (verified at S10-A start): `147de73`
- Working tree at start: clean

## Files added

- `js/workflow-integration-engine.js` — `PBWorkflow`, the S10-A workflow
  contract / state machine source of truth.
- `tests/workflow-integration-engine.test.js` — targeted S10-A tests.
- `docs/S10-A-WORKFLOW-INTEGRATION.md` (this file).

## Files modified

None. All S1–S9 production files are untouched.

## Design decision: zero engine/storage coupling

`js/workflow-integration-engine.js` never `require`s or reads
`PBMatchObservation` / `PBPerformanceAnalysis` / `PBDiagnosis` /
`PBRecommendationPriority` / `PBTrainingPrescription` / `PBStore`. It
only accepts already-computed reference IDs and values from the caller
(`recommendation_refs`, `priority_ref`, `prescription_refs`, KPI
numbers, etc.) and stores them as opaque references. This is the
strongest available guarantee of Rule 3 ("workflow references existing
domain outputs, never recalculates them") — it is structurally
impossible for this file to recompute an S9 decision, not just
conventionally discouraged. Test #22 enforces this with a structural
source scan (see below).

One consequence: S10-A adds **no new IndexedDB stores** and makes **no
changes to `js/storage.js`**. Nothing in the required contract, state
model, or test list (§16 of the spec) requires persistence — a
Development Cycle, Training Session record, and Progress record are all
plain returned objects the caller (a future S10-B+ stage) is free to
persist through the existing `js/storage.js` CRUD conventions once a UI
needs it. This keeps the persistence layer at zero risk of BLOCKED per
§13, and matches the observed repo convention that S9-B through S9-F
also shipped as pure engines with no UI/storage wiring in this
directory's flat `js/` layout (none of them are in `index.html` or
`sw.js` either — that wiring is deferred to the UI stages that consume
them).

## Contract

`createDevelopmentCycle({ player_id, baseline_ref, cycle_id? })` returns:

```json
{
  "development_cycle": {
    "cycle_id": "...",
    "player_id": "...",
    "baseline_ref": "...",
    "evidence_refs": [],
    "recommendation_refs": [],
    "priority_ref": null,
    "prescription_refs": [],
    "training_session_refs": [],
    "progress_evidence_refs": [],
    "reassessment_ref": null,
    "evidence_ref_count_at_last_recommendation": 0,
    "state": "BASELINE_READY",
    "schema_version": "1.0",
    "created_at": "...",
    "updated_at": "..."
  }
}
```

`evidence_ref_count_at_last_recommendation` is an additive bookkeeping
field (not in the spec's literal example) used only to detect a stale
recommendation on `GENERATE_PRESCRIPTION` — see below.

## State model

Normal states (§5): `BASELINE_READY → EVIDENCE_AVAILABLE →
RECOMMENDATION_READY → PRESCRIPTION_READY → TRAINING_ACTIVE →
SESSION_COMPLETED → PROGRESS_RECORDED → REASSESSMENT_READY →
CYCLE_COMPLETED`.

Error codes thrown by `transition()` (never a silent no-op — §12):
`INSUFFICIENT_EVIDENCE`, `INVALID_INPUT`, `STALE_RECOMMENDATION`,
`PRESCRIPTION_UNAVAILABLE`, `REASSESSMENT_REQUIRED`.

`transition(cycle, action, payload)` is pure — it returns a new cycle
object or throws a `WorkflowError`, never mutates its input. The full
`state -> action -> nextState` table is frozen in
`WF.VALID_TRANSITIONS`; any `(state, action)` pair absent from it is
rejected as `INVALID_INPUT`.

Rule 5 (new evidence → reassessment eligibility) is implemented as:
`ADD_EVIDENCE` from any state that already has a recommendation on file
(`RECOMMENDATION_READY`/`PRESCRIPTION_READY`/`TRAINING_ACTIVE`/
`SESSION_COMPLETED`/`PROGRESS_RECORDED`) always transitions to
`REASSESSMENT_READY` — it appends to `evidence_refs` but never
overwrites `recommendation_refs`/`prescription_refs`.
`GENERATE_PRESCRIPTION` compares `evidence_refs.length` against the
count captured at the last `GENERATE_RECOMMENDATION` call; a mismatch
(or an empty `recommendation_refs`) throws `STALE_RECOMMENDATION`,
covering both "no recommendation" and "outdated recommendation" as the
same underlying condition — the spec's three named invalid-transition
examples map onto this table as:

| Spec example | Code |
|---|---|
| No Evidence → Recommendation | `INSUFFICIENT_EVIDENCE` |
| No Recommendation → Prescription | `STALE_RECOMMENDATION` |
| No Prescription → Complete Training Session | `PRESCRIPTION_UNAVAILABLE` |

## Evidence contract

`createEvidence({ source, timestamp?, skill?, kpi?, value, context?, confidence? })`.
`source` must be one of `MATCH` / `TRAINING` / `COACH` /
`PLAYER_SELF_REPORT`; at least one of `skill`/`kpi` and a `value` are
required. Unknown sources are rejected, never guessed.

## Training Session contract + evidence bridge (Rule 4)

`recordTrainingSession({ prescription_id, skill, kpi, attempts,
successful_attempts, result_value, completed, session_id? })` validates
the contract (`successful_attempts <= attempts`, non-negative/finite
numerics, boolean `completed`) and returns `{ session, evidence }`.
`evidence` is a `TRAINING`-source Evidence object when `completed ===
true`, and `null` otherwise — a session isn't "done" until it's
complete, and only a completed session becomes evidence.

## Progress contract

`computeProgress({ skill?, kpi?, baseline_kpi, current_kpi,
target_kpi?, evidence_count? })` returns an absolute `delta` (rounded to
avoid IEEE754 artifacts) and `delta_percentage_points` — `0.58 → 0.71`
yields `delta: 0.13`, `delta_percentage_points: 13`, never a relative
13% figure. `trend` is `IMPROVING`/`DECLINING`/`STABLE`; `target_status`
is `MET`/`IN_PROGRESS`/`NOT_SET`. Pure function, deterministic.

## Tests

`node tests/workflow-integration-engine.test.js` — all §16 targeted
cases (contract, state, evidence, training, progress, architecture
protection). Test #22 does a comment-stripped structural scan of
`js/workflow-integration-engine.js` for any reference to
`PBMatchObservation`/`PBPerformanceAnalysis`/`PBDiagnosis`/
`PBRecommendationPriority`/`PBTrainingPrescription`/`PBStore`/`require(`
and asserts none exist. Test #23 spawns the six directly-relevant
accepted S9 suites as child processes and asserts each still exits 0,
unmodified.

Full regression: `node tests/*.test.js` — 23/23 suites pass (22
previously accepted S1–S9 suites + this new one). No existing test file
was modified.

## Acceptance criteria self-check (not final acceptance — GPT owns that)

| # | Criterion | Status |
|---|---|---|
| 1 | S1–S9 frozen engine behavior preserved | No production file outside this stage's two new files touched; full regression 23/23 |
| 2 | Product workflow contract exists | `createDevelopmentCycle` |
| 3 | Workflow is reference-based | Zero engine/storage coupling (see above); refs are opaque strings |
| 4 | Versioned contract exists | `schema_version: "1.0"`, `WORKFLOW_CONTRACT_VERSION: "S10-A-V1"` |
| 5 | Recommendation/Priority/Prescription remain separate | Distinct fields, test #21 |
| 6 | Training Session can produce Evidence | `recordTrainingSession`, Rule 4 |
| 7 | Progress representation exists | `computeProgress` |
| 8 | Reassessment can be triggered by new evidence | `ADD_EVIDENCE → REASSESSMENT_READY` |
| 9 | Invalid transitions fail explicitly | `WorkflowError` with frozen codes, never silent |
| 10 | Deterministic behavior preserved | Pure functions, test #20 |
| 11 | Targeted tests pass | `workflow-integration-engine.test.js` |
| 12 | Relevant regression tests pass | 23/23 suites |

## Implementation Verdict

```
READY FOR GPT INDEPENDENT ACCEPTANCE
```
