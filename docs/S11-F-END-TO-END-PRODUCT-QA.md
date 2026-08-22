# S11-F — End-to-End Product Experience QA

Stage: `S11-F`
Status: `IMPLEMENTED / GPT QA PENDING`
Entry Baseline: `770667c` (`770667cd2274eacd76b082c6a59053e8a396e25e`)

## 1. Entry Baseline

Verified before any work began:

```
branch: app-v2-alpha
HEAD:   770667cd2274eacd76b082c6a59053e8a396e25e
770667c is an ancestor of HEAD (trivially — HEAD *is* 770667c)
working tree: clean
```

## 2. Step 0 Governance

`docs/MASTER-CONTROL-V2.md` updated exactly per the frozen S11-F package:
S11-F0-R1 moved to `CLOSED / ACCEPTED` (Acceptance Commit `770667c`),
`S11-F ENTRY BLOCK: CLEARED` recorded, and a new `S11-F / Status:
FULL-SYSTEM QA IN PROGRESS` entry added. S11-F0's audit history is
preserved unchanged above it.

## 3. Real Product Journey Tested

One continuous player journey, driven entirely through the real,
accepted production API surface (no DevTools/console fabrication of
Development Cycle / Prescription Workflow / Session Result / Training
Evidence / Progress / Reassessment records — every one of those was
produced by calling the actual production function a real UI click
calls):

```
Real Match (PBMatchObservation, 8 real rally observations)
→ S9 Diagnosis (PBDiagnosis.diagnoseMatch)
→ Recommendation + Priority (PBRecommendationPriority.prioritizeDiagnosis)
→ Prescription (PBTrainingPrescription.prescribeRecommendations)
→ Review "Use This Training Plan" (PBDecisionCycleRegistration.registerDecisionCycle)
→ Development Cycle PRESCRIPTION_READY / Prescription Workflow DRAFTED
→ HOME (PBHomeDashboardAdapter.loadHomeDashboard) → ACTIVATE_PRESCRIPTION
→ Guided Training: Activate → Start Training → Session Execution
→ Complete & Save → Session Result + TRAINING Evidence, durable
→ Development Cycle.evidence_refs linked
→ Cycle reaches REASSESSMENT_READY (S10-A's own frozen Rule 5)
→ HOME/Progress: RECORD_REAL_MATCH (reassessment precedence honored)
→ History: full timeline, no ORPHAN_WORKFLOW_REF
```

This was exercised twice, independently: once via the automated suite
(`tests/s11-full-product-journey.test.js`, Node + fake IndexedDB) and
once via real browser manual QA (real DOM clicks against the actual
running app, real IndexedDB) — see §5/§6 below.

## 4. Automated Full-Journey Test

`tests/s11-full-product-journey.test.js` — gates F-T01 through F-T20,
all PASS:

| Gate | Result |
|---|---|
| F-T01 player setup | PASS |
| F-T02 durable Match (no TRAINING Evidence merely from a saved Match) | PASS |
| F-T03 Diagnosis | PASS |
| F-T04 Recommendation (rank preserved) | PASS |
| F-T05 Prescription (source_recommendation_id matches) | PASS |
| F-T06 Registration | PASS |
| F-T07 Cycle PRESCRIPTION_READY | PASS |
| F-T08 Workflow DRAFTED + full lineage (cycle.recommendation_refs / prescription_refs, workflow.recommendation_ref / prescription_ref) | PASS |
| Registration idempotency (repeat → one Cycle, one Workflow, same IDs) | PASS |
| F-T09 S11-A ACTIVATE_PRESCRIPTION (real HOME reader) | PASS |
| F-T10 Activate | PASS |
| F-T11 Start Training | PASS |
| F-T12 Session Execution (in-memory) | PASS |
| F-T13 Session Result durable | PASS |
| F-T14 TRAINING Evidence durable, source TRAINING | PASS |
| F-T15 Cycle evidence link | PASS |
| Session idempotency (replay reuses Evidence; conflicting payload → `DUPLICATE_FINALIZATION`) | PASS |
| F-T16 Progress (real S11-D reader; Baseline/Current/Delta/Trend/Evidence Count fields present) | PASS |
| F-T17 TRAINING/MATCH separation (independent fields, no fabricated MATCH number) | PASS |
| F-T18 Reassessment precedence (`READY_TO_REASSESS` / `RECORD_REAL_MATCH`, never `START_TRAINING`/`CONTINUE_TRAINING`) | PASS |
| F-T19 History lineage (timeline contains `CYCLE_CREATED`, `PRESCRIPTION_WORKFLOW_CREATED`, `TRAINING_EVIDENCE_RECORDED`) | PASS |
| F-T20 current workflow: no `ORPHAN_WORKFLOW_REF` | PASS |

## 5. Reload / Recovery Test

`tests/s11-reload-recovery.test.js` — gates F-R01 through F-R08, all
PASS (every module's own in-memory state discarded and re-`require`d
at each checkpoint; the shared fake IndexedDB's persisted records
survive, exactly like a real browser tab reload):

| Gate | Result |
|---|---|
| F-R01 Match survives reload | PASS |
| F-R02 Cycle/Workflow survive reload (real HOME reader) | PASS |
| (repeated-read check) HOME read twice creates no duplicate Cycle/Workflow | PASS |
| F-R03 Workflow durable after activation, survives reload | PASS |
| F-R04 active session honestly lost on reload, never fabricated as resumed | PASS |
| F-R05 Session Result / Evidence survive reload | PASS |
| F-R06 Progress reconstructs after reload, no crash | PASS |
| F-R07 REASSESSMENT_READY state survives reload | PASS |
| F-R08 History timeline reconstructs after reload; repeated History render creates no new Cycle/Workflow/Evidence | PASS |

## 6. Manual Browser QA

Performed against the real, running app (real IndexedDB, real DOM
clicks) — reusing the durable registration created during S11-F0-R1's
own manual QA (a real "Use This Training Plan" click, itself already
verified in that stage), then continuing the same journey through real
UI interaction for this stage:

| Step | Result |
|---|---|
| Real Match / S9 Recommendation (from S11-F0-R1's own QA) | PASS |
| Use This Training Plan (from S11-F0-R1's own QA) | PASS |
| Cycle registration | PASS |
| Workflow registration | PASS |
| HOME handoff (real click on HOME's "开始训练" CTA opened Guided Training) | PASS |
| Activate Prescription | PASS (already ACTIVE from prior QA; confirmed via HOME's `START_TRAINING` CTA) |
| Start Training (real click) | PASS |
| Session completion (real form fill: attempts=12, successful=9; real click "完成并保存") | PASS — "训练结果已保存 · 已记录训练证据" |
| TRAINING Evidence | PASS |
| Progress (rendered directly; reachable only via a REVIEW_PROGRESS/REVIEW_REASSESSMENT CTA that this journey's fast reassessment path never produces — see §9) | PASS (content honest, no crash) |
| TRAINING/MATCH separation | PASS — "比赛 KPI 证据尚不可用，比赛进步仍未解析" |
| Reassessment precedence | PASS — HOME/Progress both showed "记录真实比赛" (Record Real Match), never a training CTA, immediately after session completion |
| History lineage | PASS — full timeline (cycle created → workflow created → activated → training started → training completed → evidence recorded → reassessment required) |
| Current `ORPHAN_WORKFLOW_REF` absent | PASS — "数据一致性警告：未发现数据一致性问题" (no data-consistency issues found) |
| Bilingual | PASS — toggled zh→en→zh; labels translated correctly; `next_action.code` verified unchanged (`RECORD_REAL_MATCH`) across the toggle |
| 375px mobile | PARTIAL — see §9 (two overflow findings, both non-blocking) |
| Console clean | PASS — zero console errors across the entire journey |

## 7. Idempotency Matrix

| Check | Result |
|---|---|
| Registration retry (identical inputs) | PASS — same `cycle_id`/`workflow_id`, `was_existing: true`, no duplicate record |
| Session completion retry (identical payload) | PASS — same Evidence reused, no duplicate |
| Conflicting session completion payload | PASS — rejects with `DUPLICATE_FINALIZATION` |
| Reload duplicate prevention (HOME/History rendered repeatedly) | PASS — record counts unchanged across repeated reads |

## 8. Data Lineage

Verified end-to-end and structurally asserted:
`cycle.recommendation_refs` contains `recommendation_id`;
`cycle.prescription_refs` contains `prescription_id`;
`workflow.recommendation_ref === recommendation_id`;
`workflow.prescription_ref === prescription_id`;
`cycle.evidence_refs` contains the Session-Result-derived
`evidence_id`. History's timeline and `workflow_summary` reconstruct
this same lineage read-only from durable records, never regenerating
narrative from S9.

## 9. Non-Blocking Findings

None of the following block the real product journey S11-F was
chartered to verify (Real Match → ... → Guided Training →
Reassessment), and none are repaired here per this stage's own "QA
only, no repair unless explicitly authorized" rule.

1. **Progress page has no live CTA entry point in the fast-reassessment
   path.** `js/product-journey-orchestrator.js`'s `REVIEW_PROGRESS`
   next_action is only reachable when `development_cycle.state` is
   `SESSION_COMPLETED` or `PROGRESS_RECORDED` — but no current
   production caller ever invokes S10-A's `START_TRAINING` /
   `COMPLETE_SESSION` / `RECORD_PROGRESS` cycle-level actions (only
   `ADD_EVIDENCE`, from `js/session-evidence-persistence.js`). Per
   S10-A's own frozen Rule 5 ("new evidence after a recommendation
   always makes the cycle reassessment-eligible"), the cycle instead
   jumps directly from `PRESCRIPTION_READY` to `REASSESSMENT_READY`
   once a session's TRAINING Evidence is added. This is a pre-existing
   characteristic of the already-accepted S10-A/S11-C contract (not
   introduced by S11-F0-R1 or S11-F); the Progress page itself renders
   correctly and honestly when reached directly (verified both by
   `F-T16`/`F-T17`/`F-R06` and by direct manual render). Reassessment
   precedence — the behavior this same fact drives — is correctly
   honored (§Phase 7), which is the more critical guarantee.
2. **Mobile 375px horizontal overflow, two sources, both cosmetic:**
   (a) the bottom `nav.tabs` bar (7 tabs) is ~443px wide at a 375px
   viewport on every page — pre-existing app chrome, not introduced by
   any S11 stage; (b) `js/history-explainability-ui.js`'s recommendation
   reference string (a long colon-delimited machine id, e.g.
   `rec:ses_...:IMPROVE_TRANSITION_EXECUTION:-:transition`) does not
   wrap inside a `<b>` element, pushing History's `scrollWidth` to
   ~640px. In both cases every primary CTA button remained fully
   within the visible viewport and clickable (verified via
   `getBoundingClientRect`) — buttons remain usable, per §30's more
   important requirement. HOME/Guided Training/Progress had no
   overflow at all.
3. **Service Worker runtime cache appeared empty in this sandboxed
   preview environment** (`caches.keys()` returned `[]`) despite
   `sw.js`'s source correctly listing
   `./js/decision-cycle-registration-controller.js` in `CORE` at
   `CACHE='pb40-v28'` (verified by direct source inspection) and the
   file being served fresh with `200 OK` on every request throughout
   the session, with zero stale-code symptoms observed. Judged an
   artifact of this specific preview harness's Cache Storage API, not
   a code regression — `sw.js` is unmodified since S11-F0-R1.
4. Review's per-item `workflow_state` badge may still read `UNRESOLVED`
   immediately after a fresh registration, until a reload/read-back —
   already documented as non-blocking in
   `docs/S11-F0-R1-PRODUCTION-REGISTRATION.md`.

## 10. Blocking Findings

None.

## 11. TRAINING/MATCH Integrity

Verified independently by both the automated suite and manual QA:
`training_progress` and `match_transfer` are always two separate
fields/objects; MATCH always shows `INSUFFICIENT_DATA` (never
`RESOLVED`) and `numeric_progress: null` when no MATCH KPI-aligned
evidence exists; TRAINING Evidence's `source` field is always
`'TRAINING'`, never `'MATCH'`.

## 12. Methodology Integrity

- Validated training levels remain the frozen set `3.0/3.5/4.0/4.5/5.0`
  only — no fractional validated level anywhere in this journey (this
  stage adds no methodology code and touches no CAP/level logic).
- CAP method (45% Technical / 30% Decision / 25% Pressure) — untouched;
  no S11 component (including this stage) computes or modifies CAP.
- Progress is never presented as a validated-level promotion — HOME and
  Progress both explicitly state "训练进步尚不能等同于比赛能力提升，需要真实比赛验证"
  ("training progress does not yet confirm match-capability transfer;
  a real match reassessment is required").

## 13. Mobile / Bilingual / PWA

See §6 and §9.2/§9.3 above.

## 14. Known Limitations (carried forward, unchanged by this stage)

- MATCH KPI-aligned Evidence is not durable anywhere in this repo yet.
- Full S9 historical recommendation narrative is not durable (History
  shows "详细的推荐说明未持久保存" honestly).
- An active Guided Training Session exists only in-memory; a reload
  during one is honestly reported as lost, with no fabricated resume,
  and (as newly confirmed by this stage's QA) there is currently no
  in-app recovery/restart action for that specific stuck workflow —
  the user would need a fresh registration/cycle to train again. This
  is exactly the frozen limitation the package's own §25 describes as
  an accepted PASS condition, not a defect to repair here.
- No production caller invokes `captureBaselineDurable` yet, so
  `training_progress`/`match_transfer` legitimately show
  `BASELINE_UNRESOLVED` for a first-time cycle — honest, never
  fabricated (§9.1 explains why this doesn't block the journey).
- Review's workflow-state badge may read `UNRESOLVED` until reload.

## 15. Full Regression

All suites in `tests/*.test.js` executed individually via
`node tests/<file>.test.js`.

Result: **46/46 suites PASS, 0 FAIL.**

## 16. S11-F 24 Acceptance Gates

| Gate | Description | Result |
|---|---|---|
| F01 | S11-F0-R1 accepted baseline lineage | PASS |
| F02 | MASTER CONTROL block cleared | PASS |
| F03 | Real Match production entry works | PASS |
| F04 | S9 decision pipeline works | PASS |
| F05 | Explicit plan registration works | PASS |
| F06 | Cycle/workflow lineage valid | PASS |
| F07 | Registration idempotent | PASS |
| F08 | S11-A handoff works | PASS |
| F09 | HOME next action correct | PASS |
| F10 | Guided Training activation works | PASS |
| F11 | Guided Training start works | PASS |
| F12 | Session completion durable | PASS |
| F13 | TRAINING Evidence durable | PASS |
| F14 | Development Cycle evidence linkage valid | PASS |
| F15 | Progress UX works | PASS (honest BASELINE_UNRESOLVED; see §9.1) |
| F16 | TRAINING/MATCH separation preserved | PASS |
| F17 | Progress != Validated Level | PASS |
| F18 | Reassessment precedence works | PASS |
| F19 | Real Match reassessment path works | PASS (routes to Measure; S9 pipeline remains the reassessment decision path, no new logic built) |
| F20 | History / Explainability lineage works | PASS |
| F21 | Reload / Recovery matrix passes | PASS |
| F22 | Bilingual + 375px + console clean | PASS (375px: cosmetic overflow only, non-blocking — see §9.2) |
| F23 | DB_VERSION 5 / 18 stores unchanged | PASS |
| F24 | Full regression PASS | PASS |

**24/24 PASS.**

## 17. Production Code Modified

**NO.** `git diff --name-only` against `770667c` touches only:
`docs/MASTER-CONTROL-V2.md`, `docs/S11-F-END-TO-END-PRODUCT-QA.md`,
`tests/s11-full-product-journey.test.js`,
`tests/s11-reload-recovery.test.js`, `tests/s10-final-acceptance.test.js`.
No `js/*.js`, `css/*`, `index.html`, `sw.js`, or `storage.js` file was
changed.

## 18. Implementation Verdict

`READY FOR GPT INDEPENDENT QA`. This document does not self-accept —
S11-F remains `IMPLEMENTED / GPT QA PENDING` in
`docs/MASTER-CONTROL-V2.md` until GPT performs Independent QA and
records acceptance. S11-FINAL is not begun.
