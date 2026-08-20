# S10-B-R1: Minimal UI Wiring Rework

Follow-up to S10-B (`3f4331d`) after GPT Independent QA verdict "CORE
ADAPTER PASS" — the Dashboard View Model existed and passed tests but
was not yet wired into a user-visible surface. This rework closes
exactly that one gap: `Dashboard View Model → User-visible UI`. No
S10-B projection rule changed.

## Baseline

- Branch: `app-v2-alpha`
- Starting HEAD (verified at start): `3f4331d` (S10-B core adapter)
- Working tree at start: clean

## What was added to the existing Review surface

A new read-only Section 7 ("Recommendation / Training Focus") was added
to `js/review-ui.js` — the same file S7-E already uses as a read-only
presentation layer for Review/Trend. No new navigation architecture was
introduced.

## Data orchestration (read-only, no new persistence)

`findLatestMatchSessionId(player_id)` locates the selected player's most
recent S9-A Match Observation session using only existing public APIs:
`PBStore.assessmentsByPlayer` → `PBStore.sessionsByAssessment`, filtered
by the existing `PBNamespace.isMatchCapture(test_id)` helper. No new
query, index, or store.

`loadDashboardData(player_id)` then runs the existing, accepted S9 chain
through its own public entry points only:

1. `PBDiagnosis.diagnoseMatch(matchSessionId, player_id)` (storage-backed)
2. `PBRecommendationPriority.prioritizeDiagnosis(diagnosisResult)` (pure)
3. `PBTrainingPrescription.prescribeRecommendations(recommendationResult)` (pure)

— then pairs each recommendation with its matching prescription (by
`source_recommendation_id`) and skill gaps (by `source_skill_gap_ids`),
and projects the bundle through `PBDashboard.projectDashboardList`. No
S9 logic is duplicated; every number/code the UI shows is read, never
recomputed.

**No S10-A Workflow Cycle is persisted anywhere in this repository** —
S10-A shipped deliberately without a persistence layer (see
`docs/S10-A-WORKFLOW-INTEGRATION.md`). Rather than inventing storage to
fill that gap, `workflow` is simply left unset in the orchestration
call; `PBDashboard`'s existing contract already renders that honestly as
`workflow_state: 'UNRESOLVED'` (never fabricating a `PRESCRIPTION_READY`/
`REASSESSMENT_READY` state that doesn't exist). This was a legitimate
read of §7 of the S10-B-R1 package — it does not trigger `BLOCKED`
because no persistence is actually required to close the wiring gap
honestly.

A dashboard-pipeline failure (e.g. a corrupt session) is caught and
degrades to the same honest empty state `PBDashboard.projectDashboardList([])`
itself defines, rather than blanking out the rest of the Review page.

## Rendering

`dashboardItemCard(item)` and `renderSection7(model)` are pure
HTML-string functions (same category as the existing `sparklineSVG`) —
they read `rank`/`priority_score`/`priority_tier`/`recommendation_code`/
`prescription_summary`/`workflow_state` straight off the View Model and
never compute, sort, or reinterpret any of them. Unresolved rank shows
literal "Rank unresolved" wording, never `#0`/`#999`. `UNRESOLVED` and
`BENCHMARK_NOT_RESOLVED` machine codes are always shown as visible
badges alongside their humanized wording. `REASSESSMENT_READY` renders
an explicit warning banner while leaving the existing recommendation
and prescription summary visible for history. All new CSS reuses the
existing `rv-*` classes from `css/app.css` — zero new CSS was added.

## Script chain / PWA

Six scripts were added to `index.html`'s script chain, in dependency
order, immediately before `review-ui.js` (which now depends on them at
render time): `match-observation-engine.js` → `performance-analysis-engine.js`
→ `diagnosis-engine.js` → `recommendation-priority-engine.js` →
`training-prescription-engine.js` → `dashboard-integration-engine.js`.
This is the first time these S9-B–F engines are loaded in the browser at
all — they previously existed only as Node-tested modules. `PBWorkflow`
(S10-A) is intentionally **not** added to the script chain: nothing in
this UI reads a persisted workflow cycle (see above), so loading it
would be dead weight.

`sw.js`'s `CACHE` was bumped `pb40-v22` → `pb40-v23` and `CORE` was
extended with the same six script paths, following this repository's
established policy (`docs/SW-CACHE-POLICY.md`) of bumping the cache
version whenever new core scripts are added — code/data resources are
already network-first, so this only affects the offline-fallback set.

## Tests

`node tests/s10-b-r1-dashboard-wiring.test.js` — all 14 items required
by §10 of the S10-B-R1 package: script-chain presence and load order
(1), Section 7 mount (2), ranked rendering from the View Model (3-4),
unresolved drill (5) and KPI (6) wording with machine codes intact,
reassessment warning (7), honest empty state (8), a structural scan
proving no ranking/scoring formula or S9/S10-B mapping table exists in
`js/review-ui.js` (9), and that `review-ui.test.js`,
`pre-s7-ui-regression.test.js`, `s9-full-system-qa.test.js`,
`workflow-integration-engine.test.js`, and
`dashboard-integration-engine.test.js` all still pass unmodified
(10-14). `tests/pre-s7-ui-regression.test.js` was extended (not
rewritten) with the six new expected globals so its real full-script-
chain load path proves the new scripts genuinely load without
exceptions.

Full regression: `node tests/*.test.js` — 25/25 suites pass. No existing
test file's assertions were removed or weakened.

## Manual browser verification

Ran the app via the repo's existing static server config
(`.claude/launch.json` → `pb-static`), navigated to Review, and
confirmed: no console errors; the honest empty state renders for a
player with no match session (all fixture players in the dev DB had
none); a synthetic populated `dashboard_item` (matching the real
`PBDashboard.projectRecommendation` output shape) renders every field
correctly — rank, tier, skill, recommendation, evidence traceability,
prescription summary, unresolved drill/KPI wording, and the
reassessment banner; and at the repository's 375px mobile QA width,
`document.documentElement.scrollWidth === clientWidth` (no horizontal
overflow) with that fully populated card rendered.

## Forbidden-area check

No change to: S9 recommendation/priority/prescription algorithms, S10-A
workflow architecture, S10-B projection rules, database schema. No
S10-C/session-execution/progress-analytics work started.

## Verdict

```
READY FOR GPT INDEPENDENT ACCEPTANCE
```
