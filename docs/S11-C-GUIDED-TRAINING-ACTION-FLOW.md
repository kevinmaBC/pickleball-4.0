# S11-C — Guided Training Action Flow

Stage: `S11-C`
Status: `IMPLEMENTED / GPT QA PENDING`
Files:
- `js/guided-training-action-controller.js`
- `js/guided-training-ui.js`
- `tests/guided-training-action-controller.test.js`
- `tests/guided-training-ui.test.js`
- `index.html` (`#v-guided` view + 6 new `<script>` tags)
- `css/app.css` (`.gt-*` block + `#guided-training-app` `.hpd-*` scope)
- `js/home-priority-dashboard-ui.js` (routes 4 next_actions into Guided Training)
- `js/i18n.js` (one-line `refreshDynamic()` hook)
- `sw.js` (precache list + version bump)
- `docs/MASTER-CONTROL-V2.md` (Step 0 — S11-B closure + S11-C entry)
- `tests/s10-final-acceptance.test.js` (FA24 authorized-S11-C allowlist)

## 1. Purpose

Takes a legitimate S11-B `next_action` (`ACTIVATE_PRESCRIPTION` /
`START_TRAINING` / `CONTINUE_TRAINING` / `RESUME_SESSION`) through the
already-accepted S10-C / S10-D execution chain, without creating a new
decision engine:

```
S11-B next_action
      v
S11-C Guided Action Controller
      v
S10-C Prescription Workflow -> Session Intent
      v
S10-D Session Execution -> Session Result -> TRAINING Evidence
      v
S10-A ADD_EVIDENCE
      v
refreshed S11-A Journey
```

## 2. Frozen Source-of-Truth Boundaries

| Concept | Owner |
|---|---|
| Recommendation / Priority / Prescription | S9 |
| Development Cycle | S10-A |
| Prescription Workflow lifecycle / Session Intent | S10-C |
| Session Execution / Session Result / TRAINING Evidence | S10-D |
| Progress / Reassessment | S10-E |
| Journey State | S11-A |
| HOME CTA | S11-B |
| Action Orchestration | **S11-C** (this stage) |

S11-C may orchestrate mutation; it may not own any mutation rule.
`js/guided-training-action-controller.js` never assigns
`workflow.state`/`execution.state`/`cycle.state` directly (structurally
verified — see §15 C-T11), never creates TRAINING Evidence itself
(C-T12), never reruns the S9 decision pipeline (C-T13), and never
bridges through the old S8 TrainingCycle/WeeklyPlan/SessionPlan/
session-execution-engine.js lineage (C-T14) — S10-C already froze the
correct minimal bridge (Prescription Workflow -> session_intent -> S10-D
Session Execution); that is the only path used.

## 3. Action Flow

`js/guided-training-action-controller.js` exposes:

```js
activatePrescription({ workflow_id })       // -> { workflow }
startTraining({ workflow_id, recommendation_ref? }) // -> { workflow, session_execution }
resolveSessionState({ workflow_id })        // -> { state, workflow, session_execution }
resolveCurrentCycle({ player_id })          // -> development_cycle | null
completeSession({ attempts, successful_attempts, development_cycle_id }) // -> { session_result, evidence, development_cycle }
refreshJourney({ player_id, development_cycle_id? }) // -> { journey }  (PBProductJourney, verbatim)
getActiveSession() / clearActiveSession()
```

`js/guided-training-ui.js` (mounted at `#guided-training-app`, inside
the dedicated `#v-guided` view) calls only this controller — never
`PBPrescriptionWorkflow`/`PBSessionEvidence`/
`PBSessionEvidencePersistence`/`PBProductJourney` directly (structurally
verified in `tests/guided-training-ui.test.js`).

## 4. Activate Contract (`ACTIVATE_PRESCRIPTION`)

1. Re-read the persisted Prescription Workflow by `workflow_id`.
2. Re-read the current persisted Development Cycle for
   `workflow.player_id` (most-recently-updated one; all cycle states
   are legitimate inputs, none filtered).
3. Derive `stale` **only** from the authoritative persisted cycle:
   `development_cycle.state === 'REASSESSMENT_READY'`.
4. Call `PBPrescriptionWorkflow.transition(workflow, 'ACTIVATE', { stale })`
   — every activation-eligibility code (`MISSING_PRIORITY`,
   `MISSING_TRAINING_OBJECTIVE`, `MISSING_TRAINING_MODE`,
   `MISSING_KPI_PROFILE`, `INVALID_PRESCRIPTION_STATUS`,
   `STALE_RECOMMENDATION`) is S10-C's own decision, never duplicated
   here.
5. Persist the updated workflow via
   `PBSessionEvidencePersistence.persistPrescriptionWorkflow`.

## 5. Start Training Contract (`START_TRAINING`)

1. Re-read persisted Prescription Workflow + Development Cycle (same
   pattern as Activate).
2. **Double-start protection**: if the persisted `workflow.state` is
   already `IN_PROGRESS`, reject with the controller-level
   `ALREADY_IN_PROGRESS` — never a second `session_intent`.
3. Stale check (same authoritative signal as Activate).
4. Call `PBPrescriptionWorkflow.startTraining(workflow, { stale })` ->
   `{ workflow, session_intent }`.
5. Persist the updated workflow.
6. Call `PBSessionEvidence.createSessionExecution({ session_intent,
   recommendation_ref })`, then `PBSessionEvidence.transition(execution,
   'START')`.
7. Store the resulting `ACTIVE` execution as the sole in-memory active
   session (§6). No Evidence/Result is created at this step.

## 6. Session Intent / Execution / Result / Evidence Separation

Kept distinct throughout, never collapsed:

| Concept | Produced by | Shape |
|---|---|---|
| Session Intent | `PBPrescriptionWorkflow.startTraining` | `status: 'PLANNED'` |
| Session Execution | `PBSessionEvidence.createSessionExecution` / `.transition` | `state: 'ACTIVE'` once started |
| Session Result | `PBSessionEvidence.completeSession` (inside `completeSessionDurable`) | `status: 'COMPLETED'`, `result_value` |
| TRAINING Evidence | `PBSessionEvidence.buildTrainingEvidence` (inside `completeSessionDurable`) | `source: 'TRAINING'` |

Exactly one in-memory active Session Execution is held at a time
(`{ workflow_id, session_execution }`), **never persisted** — no new
IndexedDB store, no `localStorage`/`sessionStorage` workaround. A page
reload loses it (see §10).

## 7. Durable Completion Chain

`Complete & Save` calls only
`PBSessionEvidencePersistence.completeSessionDurable({ session_execution,
attempts, successful_attempts, development_cycle_id })`. The controller
never independently calculates `result_value`, never creates/persists
Evidence itself, never calls `ADD_EVIDENCE`, and never changes
Development Cycle state directly — all of that is S10-D/S10-D-R1's own
job. Numeric validation (`attempts >= 0` integer,
`successful_attempts <= attempts`, the Evidence Eligibility Gate for
0-attempt sessions) is entirely S10-D's; S11-C preserves the raw
rejection code (`INVALID_ATTEMPTS`/`INVALID_SUCCESS_COUNT`) rather than
re-validating.

Idempotency is inherited verbatim from
`PBSessionEvidencePersistence.completeSessionDurable`: an identical
replay reuses the existing persisted Session Result/Evidence; a
conflicting-payload replay rejects with `DUPLICATE_FINALIZATION`. No
second idempotency algorithm exists in S11-C.

No S10-C-owned result-driven completion transition
(`workflow.state = COMPLETED/EVALUATED`) is ever performed — S10-C
intentionally does not own that transition, and a workflow legitimately
stays `IN_PROGRESS` after a session completes. Product-level navigation
after completion follows the refreshed Development Cycle / Journey
instead (`refreshJourney`), never a local decision.

After a successful completion, the controller clears the in-memory
active session (§24 of the frozen package); a **rejected** attempt
(e.g. `INVALID_ATTEMPTS`) leaves it intact so the UI can let the user
correct and resubmit.

## 8. Stale Behavior

Frozen stale signal: `development_cycle.state === 'REASSESSMENT_READY'`,
re-read from persistence immediately before every mutating
Activate/Start call — the UI's own possibly-stale in-memory journey
state is never trusted for this decision. If stale: Activate/Start are
both blocked, `STALE_RECOMMENDATION` surfaces verbatim, and no
Prescription is regenerated.

## 9. UNRESOLVED Behavior

`drill_resolution_status === 'UNRESOLVED'` still allows Activate/Start
(S10-C never gates on it) and renders the frozen bilingual message
(never hides the prescription, never fabricates a drill):
> 中文: 训练方向已确定，具体 Drill 尚未解析。
> English: Training direction is available. Specific drill is not yet resolved.

`kpi_target_status === 'BENCHMARK_NOT_RESOLVED'` is preserved
explicitly alongside it, never inventing a target value:
> 中文: 基准值尚未解析。
> English: Benchmark not yet resolved.

## 10. Reload Limitation

**ACTIVE Guided Training Session is in-memory only.** If a reload
happens after Start but before Complete, the persisted workflow may
remain `IN_PROGRESS` while the active execution is lost — the
controller never reconstructs it from `workflow.session_refs`/
`session_result`/a session_intent id (that would be fabricating a
resume). `resolveSessionState` reports this honestly as the
`ACTIVE_SESSION_LOST` presentation state, and the UI shows:
> 中文: 上一次进行中的训练未保留，无法直接恢复。
> English: The previous active training session was not preserved and cannot be resumed directly.

**Classification: NON-BLOCKING**, provided the UI stays honest (it
does — no recovery is ever pretended).

## 11. No-S8-Bridge Decision

S11-C does not route through `TrainingCycle`/`WeeklyPlan`/
`SessionPlan`/`js/session-execution-engine.js` (S8-C) for S9/S10
prescriptions — that lineage is FK-rooted in S7-A
`review_snapshots`/`prescriptions`, an entirely different lineage than
S9/S10's per-match Prescription Workflow (same bridge-decision
reasoning `js/prescription-workflow-engine.js`'s own header comment
already documents for S10-C). Structurally verified: the controller
never references `PBTrainingPlan`, `PBSessionExecution`,
`getSessionPlan`, or `session_plans`/`training_cycles`/`weekly_plans`
(C-T14). The pre-existing S8-E UI (Today's Training / Training Cycle /
Session Plan / Training Progress) is untouched and still reachable via
the `drill`/`review` tabs.

## 12. No-S9-Rerun

`js/guided-training-action-controller.js` and `js/guided-training-ui.js`
have zero runtime dependency on `PBDiagnosis`, `PBRecommendationPriority`,
or `PBTrainingPrescription` — structurally verified (C-T13 and the UI's
own forbidden-token scan).

## 13. Persistence Decision

No new `IndexedDB` store, no `DB_VERSION` change (`DB_VERSION` stays
`5`, all 18 existing stores unchanged). The existing durable stores
(`development_cycles`, `prescription_workflows`, `session_results`,
`training_evidence`) are sufficient — this stage only newly *wires*
the already-accepted engines that read/write them
(`workflow-integration-engine.js`, `prescription-workflow-engine.js`,
`session-evidence-engine.js`, `session-evidence-persistence.js`) into
`index.html`'s script chain for the first time; it does not change
their schema or behavior.

## 14. UI Behavior

Screens (`js/guided-training-ui.js`'s `renderGuidedTrainingHTML`, one
`mode` per screen, exactly one primary action each):
`READY_TO_ACTIVATE`, `READY_TO_START`, `ACTIVE_SESSION` (Objective /
Mode / KPI / Status = Training in Progress + Attempts/Successful
Attempts inputs + Complete & Save), `SESSION_LOST`, `COMPLETED`
("Session Result Saved" [+ "TRAINING Evidence Recorded" when eligible]
— never a fabricated improvement/validated-level/match-transfer claim).
HOME routes `ACTIVATE_PRESCRIPTION`/`START_TRAINING`/
`CONTINUE_TRAINING`/`RESUME_SESSION` here via
`js/home-priority-dashboard-ui.js`'s `openForAction` handoff (workflow_id
+ player_id only — no domain state passed, the Guided Training screen
re-resolves everything from persistence itself). Legacy S8-E UI
(Today's Training / Training Cycle / Session Plan / Training Progress)
is unchanged and still present. Mobile: `.gt-cta`/`.hpd-cta` stay
full-width, single-column result-entry form, no new `@media` breakpoint
(the app is deliberately single-column mobile-first throughout).

## 15. Tests

```bash
node tests/guided-training-action-controller.test.js
node tests/guided-training-ui.test.js
```

Controller suite (fake-IndexedDB, real S10-C/S10-D/S10-D-R1/S11-A
engines — same "genuine reload" convention as
`tests/session-evidence-persistence.test.js`) covers C-T01–C-T16:
Activate/Start success + persistence, stale blocking both, UNRESOLVED/
BENCHMARK_NOT_RESOLVED remaining explicit, double-start protection,
durable completion delegation + idempotent replay + conflicting-payload
rejection, structural no-direct-state-assignment /
no-direct-evidence-creation / no-S9 / no-S8-bridge scans, the
ACTIVE_SESSION_LOST reload-loss presentation state, and post-completion
Journey refresh via the real `PBProductJourney`. UI suite covers
bilingual labels, the UNRESOLVED/BENCHMARK_NOT_RESOLVED/session-lost
wording, exactly-one-primary-action per screen, the Attempts/Successful
Attempts + Complete & Save controls, stale error translation, the
thin-UI structural scan, and a check against any local
`result_value`/validated-level-promotion wording.

`tests/pre-s7-ui-regression.test.js` re-executes the entire real script
chain (now including the 6 new `<script>` tags and `PBWorkflow`/
`PBPrescriptionWorkflow`/`PBSessionEvidence` becoming live globals for
the first time) against a fake DOM/IndexedDB, proving nothing throws on
load and `toggleLang()` still works end-to-end.

## 16. Acceptance Gates

| Gate | Description | Status |
|---|---|---|
| C01 | S11-B accepted baseline lineage (`e06c0a0` ancestor of HEAD) | PASS |
| C02 | MASTER CONTROL S11-B closure recorded | PASS |
| C03 | Guided Action uses persisted Prescription Workflow | PASS |
| C04 | ACTIVATE delegated to S10-C | PASS |
| C05 | START_TRAINING delegated to S10-C | PASS |
| C06 | Session Execution delegated to S10-D | PASS |
| C07 | Session completion delegated to S10-D-R1 persistence | PASS |
| C08 | No S9 re-execution | PASS (C-T13) |
| C09 | No duplicate activation logic | PASS |
| C10 | No duplicate evidence logic | PASS (C-T12) |
| C11 | Stale recommendation blocks training | PASS (C-T03/C-T04) |
| C12 | UNRESOLVED drill remains trainable | PASS (C-T05) |
| C13 | BENCHMARK_NOT_RESOLVED remains explicit | PASS (C-T06) |
| C14 | Attempts/success validation comes from S10-D | PASS |
| C15 | No workflow COMPLETED fabrication | PASS |
| C16 | Refresh/reload limitation honest | PASS (C-T15) |
| C17 | Exactly one active in-memory execution | PASS |
| C18 | Bilingual UI + 375px mobile | PASS |
| C19 | DB_VERSION remains 5 / 18 stores | PASS |
| C20 | Full regression PASS | see final report |

## 17. Findings

None. `tests/s10-final-acceptance.test.js`'s FA24 allowlist is extended
with the exact 6 new S11-C artifacts alongside the existing S11-A/S11-B
files; it still rejects any other S11-named file, including a
hypothetical S11-D+.

## 18. Implementation Verdict

`IMPLEMENTED` — ready for GPT independent QA. This document does not
self-declare S11-C `CLOSED / ACCEPTED`; GPT owns final acceptance per
`docs/MASTER-CONTROL-V2.md`'s Version Control Rules (VC-06).
