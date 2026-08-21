# S11-E — History / Explainability / Recovery

Stage: `S11-E`
Status: `IMPLEMENTED / GPT QA PENDING`
Files:
- `js/history-explainability-adapter.js`
- `js/history-explainability-ui.js`
- `tests/history-explainability-adapter.test.js`
- `tests/history-explainability-ui.test.js`
- `index.html` (`#v-history` view + 2 new `<script>` tags + minimal static HOME link)
- `css/app.css` (`#history-explainability-app` scope)
- `js/i18n.js` (2 new static dictionary keys + one-line `refreshDynamic()` hook)
- `sw.js` (precache list + version bump)
- `docs/MASTER-CONTROL-V2.md` (Step 0 — S11-D closure + S11-E entry)
- `tests/s10-final-acceptance.test.js` (FA24 authorized-S11-E allowlist)

## 1. Purpose

Answers: What happened before? Why is the app showing this current
state? Which parts of my state survive reload? Which parts are not
durably available? S11-E is READ -> DERIVE HISTORY -> TRACE -> EXPLAIN
-> REPORT RECOVERY STATUS. It is not a Decision Engine, Progress
Engine, Reassessment Engine, Repair Engine, or Audit Persistence
Engine. History is reconstructed from durable records — it is never
recreated by rerunning business logic.

## 2. Source-of-Truth Boundaries

| Concept | Owner |
|---|---|
| Diagnosis / Recommendation / Priority / Prescription | S9 |
| Development Cycle | S10-A |
| Prescription Workflow / prescription_snapshot | S10-C |
| Session Result / TRAINING Evidence | S10-D |
| Baseline / Progress / Reassessment | S10-E |
| Journey | S11-A |
| HOME | S11-B |
| Guided Training | S11-C |
| Progress UX | S11-D |
| History / Explainability / Recovery View | **S11-E** (this stage) |

`js/history-explainability-adapter.js` has zero runtime dependency on
`PBDiagnosis`/`PBRecommendationPriority`/`PBTrainingPrescription` (no
S9 rerun) and never calls an S10/S11-C mutation entry point
(`PBWorkflow.transition`, `PBPrescriptionWorkflow.transition`/
`startTraining`, `PBSessionEvidence.transition`,
`PBSessionEvidencePersistence.completeSessionDurable`,
`PBProgressReassessmentPersistence.runReassessmentDurable`/
`captureBaselineDurable`/`supersedePrescriptionWorkflowDurable`/
`completeCycleDurable`) — structurally verified. It is read-side only.

## 3. No-New-History-Store Decision

No `history_events`/`audit_log`/`timeline`/`recovery`/`explanation`
store was added. `DB_VERSION` stays `5`, all 18 existing stores
unchanged. The full History/Explainability/Recovery View Model is
recomputed fresh from `PBStore` reads (development_cycles,
prescription_workflows, session_results, training_evidence,
reassessments, cycle_kpi_baselines) plus the already-accepted S10-E-R1
`getCurrentProgressDurable` read+project composition, every time it is
requested — a disposable derived projection, exactly like every other
S11 view model in this repo.

## 4. Cycle History Model

Every persisted Development Cycle for the player is listed, sorted
most-recently-updated first (ties broken by `cycle_id` for
determinism) — the same "most recently updated wins" tie-break used
throughout S11-A/B/C/D to pick the *current* cycle (`is_current: true`
on exactly one). No new "current cycle" business rule was invented.

## 5. Timeline Vocabulary

```
CYCLE_CREATED, BASELINE_AVAILABLE, PRESCRIPTION_WORKFLOW_CREATED,
PRESCRIPTION_ACTIVATED, TRAINING_STARTED, SESSION_COMPLETED,
TRAINING_EVIDENCE_RECORDED, PROGRESS_AVAILABLE, REASSESSMENT_REQUIRED,
REASSESSMENT_COMPLETED, CYCLE_COMPLETED
```

A timeline event is created **only** when a persisted record actually
proves it — e.g. `SESSION_COMPLETED` only when a `session_results`
record exists for that cycle, `TRAINING_EVIDENCE_RECORDED` only when a
`training_evidence` record's `evidence_id` is present, `REASSESSMENT_
REQUIRED` only when `development_cycle.state === 'REASSESSMENT_READY'`.
No event is ever guessed from absence of evidence.

## 6. Deterministic Ordering

Timestamps come only from real persisted fields (`created_at`/
`updated_at`/`activated_at`/`started_at`/`completed_at`/
`captured_at`/`timestamp`) — never `Date.now()`/`new Date()`. A
`TRAINING_STARTED` event is only trusted with `workflow.updated_at`
while `workflow.state === 'IN_PROGRESS'` (no later transition has
overwritten it since `startTraining` ran); once the workflow moves on
(e.g. `CANCELLED`), the original start time is genuinely lost, so the
event still appears (proven by `session_refs` being non-empty) but
with `occurred_at: null, time_status: 'UNKNOWN_TIME'` — never a
fabricated timestamp. Events sort by real timestamp when both sides
are known and differ; otherwise the fixed vocabulary order above (with
a stable per-item ref tie-break) keeps ordering fully deterministic.

## 7. Explainability Model

"Why This Training?" is pure traceability, not a free-form AI
explanation: `recommendation_ref`, `priority_rank`/`priority_tier`,
`training_objective_code`, `training_mode`, `kpi_profile_code` are
copied verbatim from the current Prescription Workflow's own
`prescription_snapshot`, labeled `source: 'PRESCRIPTION_WORKFLOW_
SNAPSHOT'`. No S9 recommendation/prescription is ever regenerated.

## 8. Prescription Snapshot Traceability

Every field displayed in "Why This Training?" is read directly off
`workflow.prescription_snapshot` — the exact frozen field set S10-C
itself defines (`docs/S10-C-PRESCRIPTION-WORKFLOW.md`) — never
recomputed, never reinterpreted. Detail mode additionally exposes the
raw `workflow_id`/`workflow_state`/`drill_resolution_status`/
`kpi_target_status` machine codes (§34: raw codes stay traceable in
detail mode even though the simple view shows translated labels).

## 9. Evidence Lineage

`Session Result -> TRAINING Evidence -> cycle.evidence_refs` is
reconstructed by joining `session_results` (by `prescription_ref`) to
`training_evidence` (by `session_ref`), showing only fields that
actually exist: `session_result_id`, `prescription_ref`,
`recommendation_ref`, `attempts`, `successful_attempts`,
`result_value`, `evidence_id`, `kpi_profile_code`, `source`. A session
result with no matching evidence (e.g. a legitimate 0-attempt session
that never passed S10-D's Evidence Eligibility Gate) still appears,
with `evidence_id: null` — flagged (`SESSION_RESULT_WITHOUT_EVIDENCE`)
as an honest data-shape note, never treated as corruption.

## 10. Progress Explainability Boundary

The adapter never calls `PBProgressTracking.computeProgressSnapshot`
directly and never re-implements the delta/trend formula. The only
progress-producing call is `PBProgressReassessmentPersistence
.getCurrentProgressDurable` (the same already-accepted S10-E-R1
read+project composition `js/progress-reassessment-adapter.js` (S11-D)
already uses) — its `baseline_value`/`current_value`/`absolute_delta`/
`trend`/`evidence_count` are copied verbatim into `progress_summary`,
labeled `authority: 'S10-E'`. If no baseline was ever captured for a
cycle, `progress_summary.status` honestly reads `BASELINE_UNAVAILABLE`
— never a fabricated value.

## 11. Recovery Model

Recovery means reconstructing UI context from durable facts — it does
not mean fabricating missing transient state. `recoverable` /
`unrecoverable` are fixed, architecture-level statements (what this
repo's durable stores can/cannot ever reconstruct, independent of any
one player's actual data):

```js
recoverable:   ['DEVELOPMENT_CYCLE','PRESCRIPTION_WORKFLOW','SESSION_RESULTS','TRAINING_EVIDENCE','BASELINE','REASSESSMENT']
unrecoverable: ['ACTIVE_SESSION_EXECUTION','FULL_S9_RECOMMENDATION_DETAIL','MATCH_KPI_EVIDENCE']
```

`status` (`FULL`/`PARTIAL`/`LIMITED`) is the one thing that varies per
player: `LIMITED` when no Development Cycle exists at all (key durable
context itself missing); `PARTIAL` when a cycle exists but a known
non-durable detail is missing or an integrity flag fired; `FULL`
otherwise. Normal known limitations (e.g. MATCH progress being
unresolved) are never labeled as corruption.

## 12. Recoverable / Unrecoverable State

`ACTIVE_SESSION_EXECUTION` is checked live and honestly: the adapter
may read `PBGuidedTrainingController.getActiveSession()` (a read-only
getter of in-memory state, when that module happens to be loaded) to
see whether the *current* browser tab still holds a live execution for
the workflow in question — it is never reconstructed from
`session_refs`/`session_result`/a session_intent id after reload.
`FULL_S9_RECOMMENDATION_DETAIL` and `MATCH_KPI_EVIDENCE` are always
unrecoverable (no durable store exists for either).

## 13. Integrity Checks

Read-only, CHECK -> FLAG, never CHECK -> MODIFY:
- `ORPHAN_WORKFLOW_REF` — a workflow's `prescription_ref` isn't
  referenced by any cycle's `prescription_refs`.
- `ORPHAN_EVIDENCE_REF` — a training_evidence's `evidence_id` isn't
  referenced by any cycle's `evidence_refs`.
- `SESSION_RESULT_WITHOUT_EVIDENCE` — a session_result exists with no
  matching training_evidence (legitimate for 0-attempt sessions).

No record is ever deleted, rewritten, or backfilled by this stage.

## 14. No-Auto-Repair Rule

Forbidden and never performed: deleting records, rewriting refs,
adding missing evidence, regenerating recommendations, resetting a
workflow or cycle, or changing timestamps. An inconsistency is reported
("Data consistency issue detected") — never silently fixed.

## 15. Known Limitations

Carried forward, all **NON-BLOCKING**: no durable full S9
Recommendation/Prescription detail store (`S9_DETAIL_NOT_DURABLE`); no
durable KPI-aligned MATCH Evidence store (`MATCH_PROGRESS_UNRESOLVED`);
the ACTIVE Guided Training Session remains in-memory only across
reload (`ACTIVE_SESSION_NOT_DURABLE`) — shown honestly, never
reconstructed.

## 16. Bilingual / Mobile UX

Core labels (History/历史, Development Timeline/发展时间线, Why This
Training?/为什么练这个？, Evidence Lineage/证据链, Recovery Status/恢复状态,
Current Cycle/当前周期, Historical Cycle/历史周期, Partially Recoverable/
可部分恢复, Data Unavailable/数据不可用, Integrity Warning/数据一致性警告) are
all bilingual via the same `en`-boolean pure-render pattern every other
S11 UI module uses, wired into `js/i18n.js`'s existing
`refreshDynamic()` convention. `#history-explainability-app` reuses the
established `.hpd-*`/`.gt-*` primitives — cards stack vertically, no
new `@media` breakpoint (checked structurally), no dense table.

History is reached only via one small static secondary-navigation link
on HOME (`index.html`, translated via `data-i18n`) — it is never the
primary CTA and never substitutes for `journey.next_action`.

## 17. Tests

```bash
node tests/history-explainability-adapter.test.js
node tests/history-explainability-ui.test.js
```

Adapter suite covers E-T01–E-T16: deterministic cycle listing/current-
cycle marking, timeline events created only from proven persisted
facts (with a real fake-IndexedDB end-to-end case), Prescription
Snapshot/recommendation_ref/evidence-lineage/TRAINING-source
preservation, MATCH honesty, no-S9/no-mutation structural scans,
active-session/S9-detail honesty, integrity-flag-only checks, and
deterministic timestamp handling. UI suite covers E-U01–E-U14:
bilingual labels, cycle list + chronological timeline + current-cycle
marker rendering, Why-This-Training/Evidence-Lineage/Recovery-Status
rendering, all three known-limitation wordings, integrity warnings, no
invented causal explanation, 375px CSS structural check, and raw
machine codes appearing only in detail mode.

## 18. Acceptance Gates

| Gate | Description | Status |
|---|---|---|
| E01 | S11-D accepted baseline lineage (`f9d9af3` ancestor of HEAD) | PASS |
| E02 | MASTER CONTROL S11-D closure recorded | PASS |
| E03 | History derived from persisted facts only | PASS |
| E04 | No new history/audit persistence | PASS |
| E05 | Timeline chronology deterministic | PASS (E-T15) |
| E06 | Development Cycle history preserved | PASS (E-T01/E-T02) |
| E07 | Prescription Workflow/Snapshot lineage preserved | PASS (E-T04) |
| E08 | Session Result -> TRAINING Evidence lineage preserved | PASS (E-T06/E-T07) |
| E09 | Explainability uses traceability, not invented causality | PASS |
| E10 | Missing durable S9 detail represented honestly | PASS (E-T13) |
| E11 | TRAINING/MATCH separation preserved | PASS |
| E12 | MATCH limitation represented honestly | PASS (E-T08) |
| E13 | Active Guided Session reload limitation represented honestly | PASS (E-T12) |
| E14 | Durable state reconstructs after reload | PASS |
| E15 | Integrity checks are read-only | PASS (E-T14) |
| E16 | No automatic repair | PASS |
| E17 | No S9 rerun | PASS (E-T09) |
| E18 | No S10 mutation/recalculation | PASS (E-T10/E-T11) |
| E19 | Bilingual + 375px mobile | PASS |
| E20 | Full regression PASS | see final report |

## 19. Implementation Verdict

`IMPLEMENTED` — ready for GPT independent QA. This document does not
self-declare S11-E `CLOSED / ACCEPTED`; GPT owns final acceptance per
`docs/MASTER-CONTROL-V2.md`'s Version Control Rules (VC-06).
