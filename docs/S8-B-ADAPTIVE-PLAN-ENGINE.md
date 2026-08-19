# S8-B: Adaptive Plan Engine

`js/training-plan-engine.js` (`PBTrainingPlan`) turns an accepted S7
Review Snapshot + Prescription into a planned `TrainingCycle` →
`WeeklyPlan[]` → `SessionPlan[]` hierarchy, persisted through the S8-A
storage API. **It plans; it does not execute.** No `SessionLog`,
adherence, training-exposure score, `RETEST_READY`, or promotion output
exists anywhere in this module.

## Engine inputs

```js
PBTrainingPlan.buildTrainingCyclePlan({
  source_review_snapshot_id: '...',
  source_prescription_id: '...',
  validated_level_at_start: 3.5,   // one of 3.0/3.5/4.0/4.5/5.0
  target_level: 4.0,               // one of 3.0/3.5/4.0/4.5/5.0
  cycle_length_weeks: 6,           // 4 | 5 | 6, default 6
  sessions_per_week: 3,            // 2 | 3 | 4, default 3
  start_date: 'YYYY-MM-DD'         // default: today (UTC)
});
```

`primary_bottleneck` and `failed_hard_gates` are **not** accepted as
input fields — the engine always retrieves them from the stored S7
records rather than trusting duplicated caller-supplied diagnostic data
(Section 7 of the task brief). Specifically:

- `primary_bottleneck` is read from `prescriptions.data.primary_bottleneck`
  — the Prescription record is treated as the authoritative planning
  input (Section 13), and `js/retest-engine.js`'s `issuePrescriptionFromSnapshot`
  already copies this value verbatim from the snapshot at issuance time,
  so it is the same value either way, just read from its authoritative
  home.
- `bottleneck_state` and `failed_hard_gates` only exist on the
  `review_snapshots` record (the Prescription doesn't carry them), so
  those are read from there.

Returns a Promise resolving to
`{ trainingCycle, weeklyPlans: [...], sessionPlans: [...] }` (the
persisted records, with real IDs), or rejecting with a `PlanningError`
(`.code` is one of the stable codes listed below) — never with a
partially-created plan (see Atomicity below).

## Deterministic behavior (Section 8)

`buildPlanStructure(ctx)` is exported as a **pure, synchronous, I/O-free
function** — same `ctx` in, same logical structure out, always. It
contains all of the engine's actual planning logic (phase mapping,
objective construction, drill assignment). `buildTrainingCyclePlan` is a
thin async orchestrator around it: load static config → read S7 source
records → duplicate-check → call `buildPlanStructure` → persist. No
randomness, no LLM/network/cloud call, no hidden heuristic scoring
anywhere in either function. `tests/training-plan-engine.test.js`
verifies `buildPlanStructure(ctx)` called twice with the same `ctx`
produces `assert.deepStrictEqual` output (phase sequence, objective
sequence, drill mapping, session structure) — IDs/timestamps only appear
after persistence, so the pure output has none to vary.

## Cycle-length / sessions-per-week rules (Section 9/10)

| Field | Allowed | Default | Rejected as |
|---|---|---|---|
| `cycle_length_weeks` | 4, 5, 6 | 6 | non-integer, `<4`, `>6` → `INVALID_CYCLE_LENGTH` |
| `sessions_per_week` | 2, 3, 4 | 3 | anything else → `INVALID_SESSIONS_PER_WEEK` |

## Weekly phase mapping (Section 11)

```
6-week: ACQUISITION, STABILIZATION, DECISION_INTEGRATION, PRESSURE_TRANSFER, MATCH_TRANSFER, RETEST
5-week: ACQUISITION, STABILIZATION, DECISION_INTEGRATION, PRESSURE_TRANSFER, RETEST
4-week: ACQUISITION, DECISION_INTEGRATION, PRESSURE_TRANSFER, RETEST
```

Exported verbatim as `PBTrainingPlan.PHASE_MAPS`. `week_number` is always
contiguous from 1 with no gaps or duplicates (one `WeeklyPlan` per phase
entry, in order).

## Prescription / bottleneck consumption (Section 12/13)

The engine never recomputes a bottleneck. `prescriptions.data.primary_bottleneck`
is a string produced by `js/review-engine.js`'s `determinePrimaryBottleneck`,
in one of these shapes:

- `'hard_gate:' + metric` — a specific failed hard-gate metric.
- `'match_validation'` — mapped to the fixed metric `match_transfer_score`.
- `'capability_threshold'` / `'evidence'` — aggregate-level bottlenecks
  with no single metric to plan a drill against.

If `review_snapshots.bottleneck_state !== 'DETERMINED'` (i.e. `INCOMPLETE`
or `NONE`) or `primary_bottleneck` is missing, the engine rejects with
`PlanningError('INCOMPLETE', ...)` — it never fabricates a bottleneck to
proceed anyway (Section 12).

## Drill mapping (Section 14)

Reuses the repository's existing content mapping,
`data/prescription_rules_v2_3_1.json` (`metric -> BLOCK`, e.g.
`reset_ball_quality_pct -> RESET_TRANSITION_BLOCK`) — this file already
existed in the repo (added at S1) and was unused by any JS module until
now. No parallel drill catalog was invented. `assessment_namespace` is
derived by mapping the metric to its owning test id via
`data/test_definitions_v2_3_1.json` (`metric -> T0x`), then converting
that id through the existing `js/namespace.js` (`T0x -> ASMT-0x`) — the
same reuse rule as S8-A/S8-0 ("do not create a second competing
normalization system").

**Note on `TECH-xx` / `DEC-xx`:** the task brief's example assignment
JSON lists `TECH-xx | DEC-xx | ASMT-xx` as acceptable
`assessment_namespace` formats. A repo-wide search found `TECH-xx` and
`DEC-xx` are *not* concrete IDs anywhere in this codebase — only
`ASMT-01..10` (via `js/namespace.js`) is a real, defined namespace.
Emitting `TECH-xx`/`DEC-xx` would mean fabricating a namespace with no
backing data, which Section 14 explicitly forbids ("do not create fake
drill IDs" — the same principle applies to fabricating IDs in an
unbacked namespace). The engine therefore always emits the real
canonical `ASMT-xx` id.

If a metric has no entry in `prescription_rules_v2_3_1.json`, or its test
id has no canonical namespace, that assignment is unresolved. For the
**primary** bottleneck this is fatal: the whole build rejects with
`PlanningError('INCOMPLETE_MAPPING', ...)` before any write happens.
Secondary/decision/pressure candidates that fail to resolve are simply
omitted from that week's supporting content (not fatal — they're
optional enrichment, not the mandatory planning target), so session
counts are never silently short.

## Weekly objective / session structure (Section 15/16)

Each `WeeklyPlan.objectives[]` entry is
`{ type, namespace, target, source: 'review_snapshot' }` (`source` is
`'review_snapshot'`, not the brief's illustrative `'prescription'`,
because `primary_bottleneck`/`failed_hard_gates` literally live on the
`review_snapshots` record in this codebase — accuracy over matching the
illustrative sample verbatim). `type` is one of:

- `PRIMARY_BOTTLENECK` — the mandatory primary-bottleneck assignment.
- `SECONDARY_DEFICIT` — a supporting/decision/pressure/match-transfer
  assignment sourced from another `failed_hard_gates` entry.
- `RETEST_TARGET` — a re-test-preparation assignment.

Every session in a given week shares the same deterministic
`assignments[]` (1–2 blocks): a mandatory `PRIMARY` block, plus one
`SUPPORT`/`TRANSFER` block when the phase calls for it and a valid
mapping exists. This matches Section 16's "primary / supporting /
transfer" session template while staying minimal — sessions within a
week aren't artificially varied, since there's no non-fabricated basis to
vary them on.

Each assignment:
```json
{
  "assessment_namespace": "ASMT-05",
  "drill_id": "RESET_TRANSITION_BLOCK",
  "role": "PRIMARY | SUPPORT | TRANSFER | RETEST_PREP",
  "target": "reset_ball_quality_pct",
  "planned_volume": "1 session block",
  "success_criterion": "reset_ball_quality_pct >= 50"
}
```
`success_criterion` is built from the real `threshold`/`direction`
already stored on the matching `failed_hard_gates` row — not invented.

## Phase-specific behavior (Section 17)

| Phase | Content |
|---|---|
| ACQUISITION | `[primary]` only |
| STABILIZATION | `[primary, firstSecondaryDeficit?]` |
| DECISION_INTEGRATION | `[primary, decisionDeficit?]` — decision block only included if a `failed_hard_gates` entry maps to a `decision`-category test (e.g. `shot_selection_pct`/T08); never fabricated |
| PRESSURE_TRANSFER | `[primary, pressureDeficit?]` — same rule, `pressure`/`technical_pressure`-category tests |
| MATCH_TRANSFER | `[primary, matchTransferExposure]` — always `match_transfer_score` → `MATCH_TRANSFER_BLOCK`; this is training exposure, never a Match Validation result, never folded into CAP |
| RETEST | `retestAssignments` only (no primary block) — one `RETEST_PREP` entry per unique metric in `failed_hard_gates ∪ {primary metric}`; no actual re-test is performed |

## TrainingCycle creation (Section 18/19)

Created via `PBStore.createTrainingCycle(...)` with
`status: 'PLANNED'` (never auto-`ACTIVE`), all fields from Section 18's
required list, plus `retest_targets` computed as the deduplicated union
of `failed_hard_gates` metrics and the primary bottleneck's metric (so
it's never empty even when the primary bottleneck is `match_validation`
with no failed hard gates). `planned_end_date` is `start_date + weeks*7`
days, computed with UTC calendar arithmetic
(`Date.UTC(y, m-1, d) + days*86400000`) so it never drifts with the
runtime's local timezone.

## Duplicate / failure protection (Section 22/23/24)

- **Duplicate protection:** `js/storage.js` gained one minimal addition,
  `listTrainingCyclesByPrescription(prescription_id)`, reusing the
  `by_prescription` index already created in S8-A (no new store, no new
  index). If any existing cycle for that prescription has status
  `PLANNED` or `ACTIVE`, the build rejects with
  `PlanningError('DUPLICATE_ACTIVE_CYCLE', ...)` before any write. A
  prior `COMPLETED`/`ABORTED` cycle does **not** block a new build
  (Section 24) — the duplicate check only looks at `PLANNED`/`ACTIVE`.
- **Atomicity/failure strategy (Section 22):** the chosen strategy is
  *validate-and-build-fully-in-memory-first*. All validation (bounds,
  levels, bottleneck-state, drill/namespace mapping) happens inside the
  pure, synchronous `buildPlanStructure` before any storage write is
  attempted — by the time persistence starts, every write is expected to
  succeed, since the only realistic remaining failure mode is a genuine
  IndexedDB-level error (not a planning-logic error). As a defensive
  second layer, `persistPlan` wraps the sequential
  `createTrainingCycle` → `createWeeklyPlan` × N → `createSessionPlan` × N
  calls in a `.catch` that best-effort deletes (via `PBStore.del`) any
  cycle/week/session records already created before re-throwing, so a
  failure never leaves a half-populated `TrainingCycle` behind. True
  single-transaction atomicity across five IndexedDB object stores would
  require redesigning the storage layer's transaction handling, which
  Section 22 explicitly says not to do for this stage — this two-layer
  approach (front-loaded validation + best-effort rollback) was judged
  the safest practical strategy within that constraint.

## Generated record counts

- Exactly `cycle_length_weeks` `WeeklyPlan` records, `week_number` 1..N
  contiguous.
- Exactly `cycle_length_weeks × sessions_per_week` `SessionPlan` records.
- Zero `SessionLog` records (verified in tests).
- Zero `CycleSummary` records — Section 27's preferred behavior
  ("do not create CycleSummary until later stages need it") is followed
  exactly; `getCycleSummaryByCycle` returns `null` after a build.

## Explicit non-scope (unchanged from the task brief)

Session execution, `SessionLog` workflow, adherence calculation, training
exposure scoring, `RETEST_READY` calculation, `CycleSummary` engine,
automatic cycle activation/completion, any Training UI, video/match
analysis, cloud backend, LLM planning, coach features. None of these
exist in `js/training-plan-engine.js`. S8-C onward remains unstarted.
