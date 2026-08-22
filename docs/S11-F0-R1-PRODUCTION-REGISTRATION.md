# S11-F0-R1 — Production Decision Registration Entry

Stage: `S11-F0-R1`
Status: `IMPLEMENTED / GPT QA PENDING`
Baseline: `263b946` (S11-F0 audit acceptance commit)

## 1. Purpose

`docs/S11-F0-PRESCRIPTION-LINEAGE-AUDIT.md` (S11-F0) found that no
production code path in this repository ever durably registers a
Prescription Workflow — the `ORPHAN_WORKFLOW_REF` finding S11-E's
integrity check correctly raised was a symptom, not the root cause.
GPT reviewed that audit and redefined the root cause as
`MISSING_PRODUCTION_DECISION_REGISTRATION_ENTRY`: this repo's S9
Recommendation/Prescription output is always transient and in-memory
(recomputed fresh on every Review page load — see `js/review-ui.js`'s
`loadDashboardData`), and no production UI action ever turns that
transient output into a durable S10-A Development Cycle / S10-C
Prescription Workflow pair.

This stage builds exactly that one missing production entry point: a
"Use This Training Plan" action on the existing Review dashboard,
wired to a new durable, idempotent registration API.

## 2. Root Cause (redefined)

Primary: `MISSING_PRODUCTION_DECISION_REGISTRATION_ENTRY` — no caller
in this repository ever calls `PBWorkflow.createDevelopmentCycle` /
`PBWorkflow.transition(..., 'GENERATE_RECOMMENDATION'/'GENERATE_PRESCRIPTION', ...)`
or `PBPrescriptionWorkflow.createPrescriptionWorkflow` from a real user
action; every existing occurrence is a test fixture or a manual QA
console call (S11-F0 §3).

Secondary (now resolved for any registration going through this new
entry point): `PRESCRIPTION_WORKFLOW_CYCLE_LINK_MISSING` —
`ORPHAN_WORKFLOW_REF` will no longer occur for a Prescription Workflow
created via `registerDecisionCycleDurable`, because it always creates
the Prescription Workflow and its linking Development Cycle together,
in the same call, with `prescription_ref` recorded into the cycle's
`prescription_refs` via the real `GENERATE_PRESCRIPTION` transition.
Historical, already-orphaned records from before this stage are left
exactly as they are — never auto-repaired (see §9).

## 3. What Was Built

### 3.1 `js/session-evidence-persistence.js` — `registerDecisionCycleDurable`

A new durable, idempotent registration API alongside the existing
S10-D-R1 `completeSessionDurable`. Given
`{player_id, source_match_session_id, recommendation, prescription}`
(the exact in-memory Recommendation + matching Prescription objects
S9's existing, unmodified pipeline already produces):

1. Validates shape (`player_id`, `source_match_session_id`,
   `recommendation.recommendation_id`, `prescription.prescription_id`
   all required) and identity
   (`prescription.source_recommendation_id === recommendation.recommendation_id`,
   else `RECOMMENDATION_PRESCRIPTION_MISMATCH`).
2. Derives a deterministic registration identity — the same composite
   string-key convention this file already uses for
   `evidence_id = 'ev:' + session_id + ':' + kpi_profile_code`:
   - `cycle_id = 'cyc:reg:' + player_id + ':' + source_match_session_id + ':' + recommendation_id`
   - `workflow_id = 'pwf:reg:' + prescription_id`
3. Reads any existing Development Cycle at that `cycle_id`
   (`PBStore.getDevelopmentCycle` — no new store, no new index).
4. If none exists, creates one via `PBWorkflow.createDevelopmentCycle`
   (`baseline_ref = source_match_session_id`) and persists it.
5. Walks the cycle forward through exactly the frozen S10-A chain via
   `PBWorkflow.transition` — `ADD_EVIDENCE` (`evidence_ref =
   source_match_session_id`) → `GENERATE_RECOMMENDATION`
   (`recommendation_refs: [recommendation_id]`, `priority_ref: null` —
   this repo's S9 Recommendation has no separate, stably referenceable
   Priority object of its own) → `GENERATE_PRESCRIPTION`
   (`prescription_refs: [prescription_id]`) — persisting after each
   step, and resuming from whatever state an already-existing cycle is
   already at (never restarting/duplicating a partially-applied prior
   attempt).
6. Reads/creates the Prescription Workflow at the deterministic
   `workflow_id` via `PBPrescriptionWorkflow.createPrescriptionWorkflow`
   (never `ACTIVATE`d).
7. Returns `{development_cycle, prescription_workflow, was_existing}` —
   `was_existing: true` only when nothing at all needed creating (an
   idempotent replay of an already-fully-registered pair).

No business rule is reimplemented: every state decision is delegated
verbatim to `PBWorkflow.transition` / `PBPrescriptionWorkflow.createPrescriptionWorkflow`,
exactly as `completeSessionDurable` already delegates to
`PBWorkflow`/`PBSessionEvidence`.

### 3.2 `js/decision-cycle-registration-controller.js` (new)

The one production caller. `registerDecisionCycle({player_id,
source_match_session_id, recommendation, prescription})` validates
shape and delegates to `PBSessionEvidencePersistence.registerDecisionCycleDurable`.
Zero runtime dependency on `PBDiagnosis` / `PBRecommendationPriority` /
`PBTrainingPrescription` (never reruns S9) and zero runtime dependency
on `PBWorkflow` / `PBPrescriptionWorkflow` directly (every transition
is delegated to the persistence layer, never duplicated here). Always
returns a Promise — a synchronous validation throw from the
persistence layer is caught and converted to a rejection, so its
caller (the Review UI's click handler) can chain `.then/.catch`
unconditionally.

### 3.3 `js/review-ui.js` — "Use This Training Plan"

Added to Section 7 (Recommendation / Training Focus): when the single
top-priority dashboard item (`rank_status === 'RESOLVED'`,
`prescription_status === 'AVAILABLE'`) is shown, its card now also
renders a "Use This Training Plan" (`使用此训练计划`) button. Clicking
it takes the exact in-memory recommendation/prescription pair that
produced that card (kept in a module-level `LAST_RAW_ITEMS`, populated
by the same unmodified `loadDashboardData` S9 pipeline — no S9 rerun
at click time) and calls
`PBDecisionCycleRegistration.registerDecisionCycle(...)`, then renders
one of: pending ("Registering…"), success ("Training plan registered
— go to Guided Training to begin"), already-registered ("This training
plan is already registered"), or the raw error code verbatim
(`registrationErrorPrefix` + `err.code`, never re-worded — same
"frozen codes shown verbatim" convention this file already uses for
every state badge).

The pure view builders (`dashboardItemCard`, `renderSection7`) gained
two new, optional, backward-compatible parameters
(`isPrimaryEligible`, `registrationView`) — every pre-existing call
site/test that invokes `dashboardItemCard(item)` alone is unaffected.
The DOM-mount layer (`render`/`repaint`/`onClick`) is, per this file's
existing convention, not unit-tested (only the pure builders are).

## 4. Explicitly Not Done (scope boundary respected)

- No new IndexedDB object store, no `DB_VERSION` change — the
  registration uses the existing `development_cycles` /
  `prescription_workflows` stores and their existing
  `getDevelopmentCycle`/`putDevelopmentCycle`/`getPrescriptionWorkflow`/
  `putPrescriptionWorkflow` APIs only.
- No S9 algorithm change — `js/diagnosis-engine.js`,
  `js/recommendation-priority-engine.js`,
  `js/training-prescription-engine.js` are untouched and never
  referenced by the new files.
- No S10-A/S10-C rule change — `js/workflow-integration-engine.js` and
  `js/prescription-workflow-engine.js` are untouched; every transition
  used already existed in the frozen `VALID_TRANSITIONS` table.
- Registration ends at `cycle.state = PRESCRIPTION_READY` /
  `workflow.state = DRAFTED`. `START_TRAINING`/`ACTIVATE` are never
  called from this entry point — starting training remains S11-C
  Guided Training's own, separate, later, explicit action (structurally
  enforced — see `tests/decision-cycle-registration-controller.test.js`
  R1-T14).
- No auto-repair of historical, already-orphaned Prescription Workflow
  records created before this stage (via test fixtures / manual QA
  console calls during S11-B–E) — S11-E's `ORPHAN_WORKFLOW_REF` check
  continues to flag them honestly, unmodified.
- The S11-F entry block is **not** cleared here. Only GPT may declare
  S11-F0/S11-F0-R1 `CLOSED / ACCEPTED` and authorize S11-F.

## 5. New Frozen Error Codes

| Code | Meaning |
|---|---|
| `RECOMMENDATION_PRESCRIPTION_MISMATCH` | `prescription.source_recommendation_id` does not match `recommendation.recommendation_id` — never registered. |
| `REGISTRATION_CONFLICT` | The deterministic `cycle_id`/`workflow_id` already durably holds a *different* player/baseline, recommendation, or prescription than this call is registering — existing refs are never overwritten (S10-A Rule 5). |
| `STALE_RECOMMENDATION` | Reused verbatim from S10-A (`js/workflow-integration-engine.js`) — the target cycle is already `REASSESSMENT_READY` (newer evidence has arrived, e.g. via a Guided Training session already completed against this same cycle) and must be re-recommended before it can be prescribed from again. |

`INVALID_INPUT`/`DEP_MISSING` are reused verbatim from this file's
existing conventions, never re-derived.

## 6. Idempotency

A retried call with the identical `{player_id, source_match_session_id,
recommendation, prescription}` always resolves to the same durable
`cycle_id`/`workflow_id` pair (`was_existing: true`), never duplicating
records — see `tests/decision-cycle-registration-controller.test.js`
R1-T02/R1-T07 and `tests/session-evidence-persistence.test.js`
R1-P02. A partially-applied prior attempt (crashed after only the
Development Cycle's `ADD_EVIDENCE` or `GENERATE_RECOMMENDATION` step
persisted) resumes from exactly that point on the next call — R1-T08 /
R1-P05.

## 7. Test Coverage

- `tests/decision-cycle-registration-controller.test.js` — R1-T01
  through R1-T14: end-to-end registration, idempotent replay, conflict
  detection, identity-mismatch rejection, input validation,
  stale-cycle rejection, resumability, two-distinct-recommendations
  non-collision, deterministic id derivation, and structural source
  scans (no S9 engines, no direct `PBWorkflow`/`PBPrescriptionWorkflow`
  reference, no direct state/ref assignment, no `ACTIVATE`/`START_TRAINING`).
- `tests/session-evidence-persistence.test.js` — R1-P01 through
  R1-P06: the same durability contract exercised directly at the
  persistence layer, plus a resumption-from-`RECOMMENDATION_READY`
  case R1-T08 does not cover.
- `tests/review-ui.test.js` — the new pure `dashboardItemCard`/
  `renderSection7` behavior: button only on the eligible primary item,
  never on a lower-ranked one, each `registrationView` phase's
  bilingual copy, a stale `registrationView` for a different
  `recommendation_id` never bleeding onto the wrong card, and
  backward-compatible `dashboardItemCard(item)` single-argument calls.
- `tests/s10-final-acceptance.test.js` FA24 allowlist extended with
  exactly this stage's three new filenames.

## 8. Manual QA (browser)

Performed against the real IndexedDB-backed app (service worker
unregistered + caches cleared before the session, per this project's
established QA precaution):

1. Created a player, ran a live Match Observation session with
   evidence that produces at least one Recommendation + matching
   Prescription.
2. Opened Review / Trend — Section 7 showed the primary recommendation
   card with a "Use This Training Plan" button.
3. Clicked it — button showed "Registering…" then "Training plan
   registered. Development cycle ready — go to Guided Training to
   begin."
4. Clicked it again — idempotent "This training plan is already
   registered." message, no duplicate records (verified via
   `PBStore.listDevelopmentCyclesByPlayer`/`listPrescriptionWorkflowsByPlayer`
   in devtools).
5. Opened Guided Training — the newly-registered Prescription Workflow
   (state `DRAFTED`) was available to activate and start, confirming
   the bridge is real and consumable by the existing S11-C flow
   without any change to that flow.
6. Confirmed via devtools that `cycle.state === 'PRESCRIPTION_READY'`
   and `workflow.state === 'DRAFTED'` immediately after registration —
   training was never auto-started.

## 9. Remaining Findings / Recommendation for GPT

- Historical Prescription Workflow records created via manual QA
  console calls during S11-B through S11-E (before this stage existed)
  remain orphaned and will continue to be flagged by S11-E's
  `ORPHAN_WORKFLOW_REF` check — this is correct, honest behavior, not a
  regression; those records were never created through any accepted
  production path and this stage does not retroactively adopt them.
- The Review dashboard's `workflow_state` badge (S10-B's own
  `projectDashboardItem`) still shows `UNRESOLVED` for a freshly
  registered item until the page is reloaded and a future stage wires
  a durable-cycle read-back into the dashboard projection — that
  read-back was judged out of scope for this narrow registration-entry
  stage (this stage's mandate was the write path) and is left for GPT
  to scope into a future stage if wanted.

## 10. Implementation Verdict

`IMPLEMENTED / GPT QA PENDING`. The S11-F entry block remains active
and unresolved — this document does not clear it, does not declare
S11-F0/S11-F0-R1 `CLOSED / ACCEPTED`, and does not authorize S11-F.
