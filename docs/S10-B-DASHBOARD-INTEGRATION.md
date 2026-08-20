# S10-B: Recommendation / Priority Dashboard Integration

Implementation Engineer role — this stage adds a Recommendation /
Priority Dashboard Integration Layer that projects the already-accepted
S9 Recommendation / Priority / Training Prescription output plus S10-A
Workflow state into a deterministic, presentation-safe Dashboard View
Model. It is a Decision Presentation Layer, not a Decision Engine.

## Baseline

- Branch: `app-v2-alpha`
- Starting HEAD (verified at S10-B start): `bd96b6c` (accepted S10-A)
- Working tree at start: clean

## Files added

- `js/dashboard-integration-engine.js` — `PBDashboard`, the S10-B
  Dashboard View Model source of truth.
- `tests/dashboard-integration-engine.test.js` — targeted S10-B tests.
- `docs/MASTER-CONTROL-V2.md` — canonical Stage Control + Acceptance
  Commit Ledger (Step 0 of this package).
- `docs/S10-B-DASHBOARD-INTEGRATION.md` (this file).

## Files modified

None. All S1–S9 and S10-A production files are untouched.

## Design decision: zero engine/storage coupling (same pattern as S10-A)

`js/dashboard-integration-engine.js` never `require`s or reads
`PBMatchObservation` / `PBPerformanceAnalysis` / `PBDiagnosis` /
`PBRecommendationPriority` / `PBTrainingPrescription` / `PBWorkflow` /
`PBStore`. It only accepts already-computed Recommendation /
Prescription / SkillGap / Workflow-cycle objects (or plain reference
values) from the caller and projects them. This is the same structural
guarantee `js/workflow-integration-engine.js` (S10-A) uses to prove it
never recalculates an upstream decision, applied here to prove the
dashboard adapter implements no priority formula, no recommendation
mapping, and no prescription mapping (Rule 1/Rule 2). Test #26/27/28
enforce this with a comment-stripped structural source scan, the same
technique S10-A's own test #22 uses.

One consequence: **no DOM/UI wiring, no `index.html`/`sw.js` changes,
no persistence changes** were made in this pass. Every one of the 20
acceptance criteria and 28 required tests in the frozen S10-B package
concerns the adapter/View Model, not rendered HTML — and the package
explicitly allows this ("S10-B may include" list/card presentation,
framed as additive, not mandatory) while separately requiring "Keep
DOM/CSS modifications minimal" and "Do NOT perform a broad visual
redesign." This matches the observed repo convention that S9-B through
S9-F and S10-A also shipped as pure engines with no UI wiring in this
directory's flat `js/` layout — none of them are referenced from
`index.html` or `sw.js` either. A future stage can wire this adapter
into `js/review-ui.js` or a new UI file once that specific work is
scoped. The View Model is fully regenerable from accepted domain/
workflow data (§18), so no persistence was added — `BLOCKED` was never
triggered because nothing here required a schema change.

## Dashboard View Model contract

`projectRecommendation({ recommendation, prescription?, workflow?,
skill_gaps?, evidence_refs? })` returns:

```json
{
  "dashboard_item": {
    "recommendation_id": "...",
    "rank": 1,
    "rank_status": "RESOLVED",
    "priority_tier": "HIGH",
    "priority_score": 74,
    "skill": "drop",
    "context": null,
    "recommendation_code": "IMPROVE_SHOT_EXECUTION",
    "status": "ACTIVE",
    "engine_status": "recommended",
    "traceability": {
      "source_skill_gap_ids": [],
      "evidence_pattern_ids": [],
      "evidence_refs": []
    },
    "prescription_ref": "...",
    "prescription_status": "AVAILABLE",
    "prescription_summary": { "...": "see §C below" },
    "workflow_state": "PRESCRIPTION_READY",
    "reassessment_pending": false,
    "presentation_notes": [],
    "schema_version": "1.0",
    "dashboard_version": "S10-B-V1"
  }
}
```

`projectDashboardList(items)` maps an array of the same `opts` shape
through `projectRecommendation`, sorts by upstream `rank` ascending
(missing rank sorts last, ties preserve input order via `Array#sort`'s
ES2019+ stability guarantee), and wraps the result with `item_count`
and — when the list is empty — an explicit `message_code:
"NO_RECOMMENDATION"` so an empty dashboard is never silently
indistinguishable from "nothing wrong."

## Information model mapping (§9)

- **A — Current Focus**: `rank`/`priority_tier`/`priority_score`/
  `skill`/`recommendation_code`/`status`, all read verbatim from the
  input Recommendation.
- **B — Why This Matters**: `traceability.source_skill_gap_ids` comes
  straight from the Recommendation; `traceability.evidence_pattern_ids`
  is resolved only when the caller supplies the matching `SkillGap`
  object(s) (never fabricated otherwise — test #14);
  `traceability.evidence_refs` is a caller-supplied or
  workflow-cycle-supplied opaque reference list.
- **C — Training Direction**: `prescription_summary` exposes
  `training_objective_code`/`training_mode`/`drill_family_code`/
  `kpi_profile_code`/`dosage_profile_code`/`drill_resolution_status`/
  `kpi_target_status` verbatim from the input Prescription, plus an
  additive humanized `*_label` for known machine codes
  (`UNRESOLVED` → "Not yet resolved", `BENCHMARK_NOT_RESOLVED` →
  "Benchmark not yet resolved") that never replaces the raw code
  (§13). Never invents `resolved_drill_ids`/`kpi_target_value` beyond
  what was passed in (test #18).
- **D — Workflow Status**: `workflow_state` is a verbatim passthrough
  of the S10-A `development_cycle.state`; `reassessment_pending` is
  `true` exactly when `workflow_state === 'REASSESSMENT_READY'`.

## Stale / reassessment presentation (§14)

When `workflow_state === 'REASSESSMENT_READY'`, the dashboard item
still carries the last-known recommendation and prescription for
audit/history, but always attaches a `presentation_notes` entry
`{ code: 'REASSESSMENT_REQUIRED', message: 'New evidence available.
Reassessment required.' }` — the old recommendation is never presented
as unquestionably current (test #21).

## Empty / partial states (§15)

| Case | Trigger | Signal |
|---|---|---|
| A — no recommendations | `projectDashboardList([])` | `message_code: 'NO_RECOMMENDATION'` |
| B — recommendation, no prescription | `prescription` omitted | `prescription_status: 'NOT_AVAILABLE'` + `PRESCRIPTION_MISSING` note |
| C — prescription, drill unresolved | `drill_resolution_status === 'UNRESOLVED'` | `DRILL_UNRESOLVED` note |
| D — reassessment required | `workflow_state === 'REASSESSMENT_READY'` | `REASSESSMENT_REQUIRED` note |

## Tests

`node tests/dashboard-integration-engine.test.js` — all §20 targeted
cases (projection, priority, separation, traceability, prescription,
workflow, empty/partial, determinism, architecture protection). Test
#26/27/28 do the structural source scan described above. The suite also
spawns the four most directly-relevant accepted suites
(`recommendation-priority-engine.test.js`,
`training-prescription-engine.test.js`, `s9-full-system-qa.test.js`,
`workflow-integration-engine.test.js`) as child processes and asserts
each still exits 0, unmodified.

Full regression: `node tests/*.test.js` — 24/24 suites pass (23
previously accepted S1–S10-A suites + this new one). No existing test
file was modified.

## Acceptance criteria self-check (not final acceptance — GPT owns that)

| # | Criterion | Status |
|---|---|---|
| 1 | MASTER-CONTROL-V2.md exists | `docs/MASTER-CONTROL-V2.md` created this stage |
| 2 | Version Control rules recorded | VC-01..VC-07 in MASTER-CONTROL-V2.md |
| 3 | S9/S10-A accepted baseline recorded | Stage Ledger: S9 `147de73`, S10-A `bd96b6c` |
| 4 | Dashboard View Model exists | `projectRecommendation`/`projectDashboardList` |
| 5 | Dashboard is projection-only | Zero engine/storage coupling (see above) |
| 6 | rank never recomputed | Verbatim passthrough, test #4 |
| 7 | priority_score never recomputed | Verbatim passthrough, test #5 |
| 8 | priority_tier never recomputed | Verbatim passthrough, test #6 |
| 9 | Evidence traceability preserved | `traceability` block, tests #12-14 |
| 10 | Recommendation/Priority/Prescription remain separate | Distinct fields, tests #9-11 |
| 11 | UNRESOLVED semantics preserved | `drill_resolution_status`, test #16 |
| 12 | BENCHMARK_NOT_RESOLVED preserved | `kpi_target_status`, test #17 |
| 13 | REASSESSMENT state visible | `reassessment_pending`, tests #20-21 |
| 14 | no-recommendation state handled honestly | `message_code`, test #22 |
| 15 | deterministic output | Test #25, no timestamps/randomness anywhere in the module |
| 16 | no persistence redesign | No `js/storage.js` changes |
| 17 | targeted tests PASS | `dashboard-integration-engine.test.js` |
| 18 | relevant regression PASS | 24/24 suites |
| 19 | S1–S9 domain algorithms untouched | No production file outside this stage's four new files touched |
| 20 | Claude STOPPED before S10-C | This report is the stop point |

## Implementation Verdict

```
READY FOR GPT INDEPENDENT ACCEPTANCE
```
