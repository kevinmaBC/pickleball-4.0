# S11-B — Home / Priority Dashboard Experience

Stage: `S11-B`
Status: `IMPLEMENTED / GPT QA PENDING`
Files:
- `js/home-dashboard-adapter.js`
- `js/home-priority-dashboard-ui.js`
- `tests/home-dashboard-adapter.test.js`
- `tests/home-priority-dashboard-ui.test.js`
- `index.html` (new panel + 3 new `<script>` tags)
- `css/app.css` (`.hpd-*` block)
- `js/i18n.js` (one-line `refreshDynamic()` hook)
- `docs/MASTER-CONTROL-V2.md` (Step 0 — S11-A closure + S11-B entry)
- `tests/s10-final-acceptance.test.js` (FA24 authorized-S11-B allowlist)

## 1. Purpose

HOME must answer, for the current player, in one panel:

> 1. What should I focus on?
> 2. Why does it matter?
> 3. What should I do next?

S11-B is a **product/presentation integration layer**. It is not a
Decision Engine, Priority Engine, Recommendation Engine, Prescription
Engine, Progress Engine, Reassessment Engine, or Workflow State Machine.

## 2. Authority Boundaries

| Concept | Owner |
|---|---|
| Diagnosis / Recommendation / Priority / Prescription | S9 |
| Development Cycle | S10-A |
| Dashboard Projection | S10-B (`js/dashboard-integration-engine.js`) |
| Prescription Workflow | S10-C |
| Session / Evidence | S10-D |
| Progress / Reassessment | S10-E |
| Journey Projection | S11-A (`js/product-journey-orchestrator.js`) |
| Home Experience | **S11-B** (this stage) |

Hard rules, all structurally enforced by
`tests/home-dashboard-adapter.test.js` / `tests/home-priority-dashboard-ui.test.js`:
- Home UI != Decision Engine — `js/home-priority-dashboard-ui.js` never
  calls any S9/S10/S11-A engine directly, only
  `PBHomeDashboardAdapter.loadHomeDashboard`.
- Home View != Dashboard Engine / Journey Engine — the adapter never
  re-implements `PBDashboard.projectDashboardList` or
  `PBProductJourney.projectJourney`; it only calls and composes them.
- Exactly one primary CTA, and it always comes from
  `journey.next_action` verbatim.
- Priority ordering always comes from `dashboard.items[0]`
  (S10-B's own upstream-rank-only ordering) — never re-sorted.
- `REASSESSMENT_READY` always overrides a training CTA (inherited
  structurally from S11-A's own frozen precedence — S11-B never
  second-guesses it).
- TRAINING progress never substitutes for MATCH progress.

## 3. Data Flow

```
Persisted S9/S10 data (PBStore reads only)
        v
S10-B Dashboard Projection (PBDashboard.projectDashboardList)
        +
S11-A Journey Projection (PBProductJourney.projectJourney)
        v
S11-B Home Experience Adapter (js/home-dashboard-adapter.js)
        v
S11-B Home UI (js/home-priority-dashboard-ui.js)
```

Recommendations/prescriptions are **not persisted anywhere** in this
repository (confirmed: `js/storage.js` has no recommendation/S9-shaped-
prescription store). **S11-B-R1 architecture repair:** S11-B never
regenerates S9 decisions to work around that gap. The adapter's
`loadDashboard` function does not call `PBDiagnosis`/
`PBRecommendationPriority`/`PBTrainingPrescription` at all — re-running
the S9 chain on every Home render (the original S11-B implementation's
approach, matching `js/review-ui.js`'s own `loadDashboardData`) was
itself a form of *deciding* the Recommendation/Prescription on S11-B's
own initiative, not merely projecting an already-decided one, and broke
the frozen "Home Dashboard Adapter may not decide" boundary. Instead,
`loadDashboard` always calls `PBDashboard.projectDashboardList([])` —
the same accepted, honest empty-state contract S10-B itself already
defines — since there is currently no prepared Dashboard data
available to read. See §16 "Known Limitation" below.

`development_cycle` is read via `PBStore.listDevelopmentCyclesByPlayer`
(picking the most recently updated one, any state — all 9 states are
handled by S11-A itself). No writer creates a `development_cycle`
anywhere in this repository yet (confirmed:
`tests/pre-s7-ui-regression.test.js`'s own `expectedGlobals` comment —
*"PBWorkflow/S10-A is not script-included: no persisted cycle to read
yet"*), so in the shipped app today this will honestly resolve to "no
active cycle" (`NEEDS_ASSESSMENT`) for a fresh player — never fabricated.
`progress` is passed as `[]` for the same reason (no progress-snapshot
persistence/writer exists yet); S11-A already handles this honestly
(`status: 'PARTIAL'`, `PROGRESS_NOT_YET_AVAILABLE` flag), so S11-B does
not need to pull in the entire S10-E-R1 engine chain to stay honest.

## 4. Home Sections

Five logical sections, in `js/home-priority-dashboard-ui.js`'s
`renderHomePanelHTML`:
1. **Journey Status** — `journey.stage` (bilingual label) + `journey.status`.
2. **Current Focus** — `home_dashboard.focus` (S10-B `dashboard.items[0]`).
3. **Why This Matters** — `home_dashboard.why` (traceability only).
4. **Training Direction** — `home_dashboard.training` (S10-B `prescription_summary`).
5. **Primary Next Action** — the single CTA from `next_action`.

Placement: `index.html`, inside `#v-home`, between the existing `.hero`
block and the S8-E "Today's Training" card. All legacy HOME content
(Learn/Drill/Measure/Compete loop, Today's Training, Six Hard Gates,
System Map) is unchanged.

## 5. Adapter Contract (`js/home-dashboard-adapter.js`)

```js
PBHomeDashboardAdapter.composeHomeDashboard({
  player_id, journey /* PBProductJourney .journey */, dashboard /* PBDashboard .dashboard */
})
// -> { home_dashboard: { player_id, journey:{stage,status,headline_code},
//      focus, why, training, next_action, flags, schema_version, view_version } }

PBHomeDashboardAdapter.loadHomeDashboard(player_id) // browser-only IO orchestration, returns a Promise
```

`composeHomeDashboard` is pure (no DOM/PBStore) and is the unit tested
in `tests/home-dashboard-adapter.test.js`. `loadHomeDashboard` is the
thin IO layer: read `PBStore` (development cycle, prescription
workflows, session results, reassessments — all reads, never writes),
call `PBDashboard.projectDashboardList([])` (no prepared Dashboard data
is currently available to read — see §16) and
`PBProductJourney.projectJourney`, then call `composeHomeDashboard`.
`js/home-dashboard-adapter.js` has **zero runtime dependency** on
`PBDiagnosis`, `PBRecommendationPriority`, or `PBTrainingPrescription`
— structurally verified by `tests/home-dashboard-adapter.test.js`'s
R1-T04 source scan.

## 6. UI Contract (`js/home-priority-dashboard-ui.js`)

Pure, Node-testable functions (no DOM/PBStore/global `LANG`):
`stageLabel(stage, en)`, `statusLabel(status, en)`,
`nextActionLabel(code, en)`, `routeForNextAction(code)`,
`flagMessage(flagCode, en)`, `renderHomePanelHTML(home_dashboard, en)`.

DOM-only (manual-QA'd, same convention as `js/training-ui.js`/
`js/review-ui.js`): `mount()`/`render()`/`onClick()`, self-mounting via
the same UMD wrapper pattern on `#home-priority-dashboard-app`.

## 7. CTA Routing

| `next_action.code` | routes to |
|---|---|
| `START_ASSESSMENT` | `measure` |
| `REVIEW_RECOMMENDATION` | `review` |
| `ACTIVATE_PRESCRIPTION` | `review` (no domain mutation — navigation only) |
| `START_TRAINING` / `CONTINUE_TRAINING` / `RESUME_SESSION` | `drill` |
| `REVIEW_PROGRESS` / `REVIEW_REASSESSMENT` | `review` |
| `RECORD_REAL_MATCH` / `START_NEXT_CYCLE` | `measure` |
| `NONE` | (no route) |

S11-B never calls `PBWorkflow.transition`, `PBPrescriptionWorkflow
.transition/startTraining/supersede`, or any reassessment/session-
evidence engine — verified structurally by both test files' forbidden-
token source scans.

## 8. Empty States

- **New player** (no cycle, no recommendation): Journey = Assessment
  Needed, Current Focus = "Not available yet", Primary CTA = Start
  Assessment. Never presented as "everything is fine."
- **Recommendation without prescription**: Current Focus available,
  Training Direction = "not yet available", Primary CTA still driven
  by S11-A (never fabricated training content).

## 9. Unresolved States

`drill_resolution_status === 'UNRESOLVED'` renders the exact frozen
bilingual message (never hides the prescription, never fabricates a
drill, never marks it FAILED):
> 中文: 训练方向已确定，具体 Drill 尚未解析。
> English: Training direction is available. Specific drill is not yet resolved.

`kpi_target_status === 'BENCHMARK_NOT_RESOLVED'` is preserved honestly
alongside it.

## 10. Reassessment State

`journey.stage === 'READY_TO_REASSESS'` always renders a prominent
"Match Reassessment Required" banner with Primary CTA
`RECORD_REAL_MATCH`. Old recommendation/prescription stay visible
(via `focus`/`training`, still sourced from the live S10-B projection)
but the composed `flags` always include `REASSESSMENT_REQUIRED` and,
when a stale ref exists, `STALE_RECOMMENDATION`/`STALE_PRESCRIPTION`
(both copied verbatim from S11-A). `START_TRAINING`/`CONTINUE_TRAINING`
can never appear as the primary CTA in this stage — S11-A's own frozen
precedence already guarantees this structurally.

## 11. TRAINING/MATCH Wording

Fixed bilingual methodology wording, always shown for
`READY_TO_REASSESS`:
> 中文：训练进步尚不能等同于比赛能力提升，需要真实比赛验证。
> English: Training progress does not yet confirm match transfer. A real match reassessment is required.

Whenever MATCH progress is not a genuinely resolved value (absent,
`UNRESOLVED`, or `INSUFFICIENT_DATA`), the adapter adds an additive
`MATCH_TRANSFER_NOT_VALIDATED` flag (never fabricating a numeric MATCH
value, never substituting TRAINING progress for it), rendered as:
> 中文: 比赛迁移：尚未验证
> English: Match Transfer: Not yet validated

## 12. Mobile Requirement

`.hpd-cta` is full-width (`width:100%`) with `padding:14px` (>=12px
large-touch-target baseline, matching `.tr-cta`). No new `@media`
breakpoint was introduced — the app is deliberately single-column
mobile-first throughout (verified by
`tests/home-priority-dashboard-ui.test.js`'s CSS structural check).
Cards (`.hpd-card`) stack vertically by default (no grid/flex-row
layout), and there is no dense table in the S11-B panel.

## 13. Persistence Decision

No new `IndexedDB` store, no `DB_VERSION` change (`DB_VERSION` stays
`5`, all 18 existing stores unchanged). The Home Experience View Model
is a **derived / disposable view model**, regenerated on every
render — every `PBStore` call in `js/home-dashboard-adapter.js` is a
read; nothing is ever `put()`/created (structurally verified by
`tests/home-dashboard-adapter.test.js`).

## 14. Tests

```bash
node tests/home-dashboard-adapter.test.js
node tests/home-priority-dashboard-ui.test.js
```

Adapter suite covers A1–A8 (new player, recommendation ready,
prescription ready, training active, progress recorded, reassessment
ready, drill unresolved, MATCH insufficient data) plus the S11-B-R1
required cases R1-T01–R1-T05 (no prepared Dashboard, prepared Dashboard
supplied with rank/no-reranking preserved, reassessment without a
Dashboard focus, no-S9-execution structural scan, deterministic
composition), next_action/rank-order preservation, determinism,
structurally-invalid-input error codes, and forbidden-engine-call
source scans. UI suite covers
bilingual stage labels, the CTA route table, exactly-one-primary-CTA +
disabled handling, the UNRESOLVED/reassessment/MATCH-transfer/new-
player wording, determinism, the thin-UI structural scan, and the
mobile-CTA CSS check.

Both `node tests/product-journey-orchestrator.test.js` and
`node tests/dashboard-integration-engine.test.js` (S11-B's two upstream
dependencies) are also re-run inside
`tests/home-dashboard-adapter.test.js` itself, and
`tests/pre-s7-ui-regression.test.js` re-executes the entire real
script chain (now including the 3 new `<script>` tags) against a fake
DOM/IndexedDB to prove nothing throws on load and `toggleLang()` still
works end-to-end.

## 15. Acceptance Gates

| Gate | Description | Status |
|---|---|---|
| B01 | S11-A accepted baseline lineage (`e28c24c` ancestor of HEAD) | PASS |
| B02 | MASTER CONTROL S11-A closure recorded | PASS |
| B03 | Home uses S11-A Journey output | PASS |
| B04 | Home uses S10-B Dashboard output | PASS |
| B05 | UI does not recompute recommendation | PASS |
| B06 | UI does not recompute priority | PASS |
| B07 | UI does not recompute prescription | PASS |
| B08 | Exactly one primary CTA | PASS |
| B09 | CTA derives from `journey.next_action` | PASS |
| B10 | Upstream rank ordering preserved | PASS |
| B11 | `REASSESSMENT_READY` overrides training CTA | PASS |
| B12 | UNRESOLVED preserved | PASS |
| B13 | TRAINING/MATCH wording separation | PASS |
| B14 | New-player empty state truthful | PASS |
| B15 | Bilingual core labels | PASS |
| B16 | 375px mobile no overflow | PASS |
| B17 | No DB schema change | PASS |
| B18 | Full regression PASS | see final report |

## 16. Known Limitation

Prepared Recommendation / Dashboard data may not always be available
after reload, because durable S9 Recommendation / Prescription
persistence has not yet been architected anywhere in this repository
(`js/storage.js` has no such store, and no such store is added here —
see §19 "Database Freeze").

**Classification:** NON-BLOCKING for S11-B.

**Condition:** HOME must represent the missing state honestly —
`focus`/`why`/`training` render as "not available yet" (never a
fabricated recommendation, never presented as "everything is fine")
whenever `dashboard.items` is empty. This is the correct, accepted
behavior for S11-B; a future stage that adds durable S9 output is the
right place to close this gap, not S11-B re-running S9 on every render
(the defect S11-B-R1 repairs — see §3).

## 17. Findings

**S11-B-R1 (this repair):** the original S11-B implementation called
`PBDiagnosis.diagnoseMatch -> PBRecommendationPriority
.prioritizeDiagnosis -> PBTrainingPrescription.prescribeRecommendations`
inside `js/home-dashboard-adapter.js` on every `loadHomeDashboard`
call, reasoning it mirrored `js/review-ui.js`'s own accepted pattern.
On review this was found to violate S11-B's own frozen boundary
("Home Dashboard Adapter may not decide a recommendation/priority/
prescription") — regenerating a decision on demand is still deciding
it, not projecting an already-decided one, regardless of precedent
elsewhere in the repo. Repaired: the adapter now has zero runtime
dependency on the S9 decision pipeline and always projects an honest
empty Dashboard when no prepared data exists (§16).

`tests/s10-final-acceptance.test.js` continues to run clean after the
FA24 allowlist update from the original S11-B implementation (adds the
exact 5 S11-B files alongside the existing 3 S11-A files); it still
rejects any other S11-named file, including a hypothetical S11-C+.

## 18. Implementation Verdict

`IMPLEMENTED` — ready for GPT independent QA. This document does not
self-declare S11-B `CLOSED / ACCEPTED`; GPT owns final acceptance per
`docs/MASTER-CONTROL-V2.md`'s Version Control Rules (VC-06).
