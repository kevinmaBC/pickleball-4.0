# S8-A: Training Cycle Data Architecture

Implements the S8 persistence foundation for the future Adaptive Training
Cycle system: schema, IDs, parent-child relationships, CRUD, migration
safety, lifecycle status fields, validation boundaries, and source
traceability. **No plan generation, adherence calculation,
`RETEST_READY` calculation, or Training UI is implemented here** — those
belong to later S8 stages (S8-B onward).

## DB v2 → v3 migration

`js/storage.js`: `DB_NAME='pb_v2'`, `DB_VERSION` bumped `2 -> 3`. The
`onupgradeneeded` handler is unchanged and generic — it creates any store
in `STORES` that doesn't already exist in the database
(`if (!db.objectStoreNames.contains(name))`), so adding the five new
entries to `STORES` is sufficient; no new upgrade code path was needed.
This is the same additive-only mechanism already used for the S7-A
v1 → v2 upgrade: it never drops, renames, or rewrites an existing store
or record, and a device on any prior version (even the original v1)
upgrades straight to v3 in one pass. Covered by `tests/storage.test.js`,
which seeds a v1 database and asserts all v1 data, all S7-A stores, and
all five new S8-A stores exist correctly after `PBStore.open()`.

## New stores / indexes

| Store | Key | Indexes |
|---|---|---|
| `training_cycles` | `cycle_id` | `by_prescription` (`source_prescription_id`), `by_review_snapshot` (`source_review_snapshot_id`), `by_status` (`status`) |
| `weekly_plans` | `week_plan_id` | `by_cycle` (`cycle_id`), `by_cycle_week` (`cycle_week_key`) |
| `session_plans` | `session_plan_id` | `by_week` (`week_plan_id`), `by_cycle` (`cycle_id`), `by_status` (`status`) |
| `session_logs` | `session_log_id` | `by_session_plan` (`session_plan_id`), `by_week` (`week_plan_id`), `by_cycle` (`cycle_id`), `by_status` (`status`) |
| `cycle_summaries` | `cycle_summary_id` | `by_cycle` (`cycle_id`), `by_retest_readiness` (`retest_readiness`) |

`by_created_at` was considered and deliberately **not** added: the
existing `getByIndex(store, index, value)` helper only supports exact-key
lookup (`index.getAll(value)`), not a range/cursor scan, so a
per-record-unique timestamp index wouldn't provide chronological listing
— it would just be a second way to fetch a single record. Sorting by
`created_at` client-side over `listTrainingCycles()` mirrors how
`listPlayers()`/`listAssessments()` already work without a sort index.

`by_cycle_week` is backed by a denormalized `cycle_week_key` field
(`cycle_id + '::' + week_number`) rather than a real IndexedDB compound
index, because the existing storage helpers (`getByIndex`, and the test
`fake-indexeddb.js`) only support single-field indexes. This keeps the
new index consistent with every existing index in the file instead of
introducing a second indexing mechanism. `getWeeklyPlanByCycleWeek(cycle_id, week_number)`
wraps it for deterministic week-N lookup.

## ID convention

New IDs reuse the existing `uid(prefix)` helper (`prefix + '_' +
Date.now().toString(36) + random`), following the exact 2–3 letter
lowercase, underscore-joined convention already used for every other
store (`plr_`, `asm_`, `ses_`, `trl_`, `rev_`, `rx_`, `rt_`):

```
tc_...   training_cycles
wp_...   weekly_plans
sp_...   session_plans
sl_...   session_logs
cs_...   cycle_summaries
```

The task brief's `TC-`/`WP-`/`SP-`/`SL-`/`CS-` prefixes were a
"recommended" convention; the brief explicitly permits reusing an
existing, suitable ID strategy instead of introducing a second one, which
is what happened here — no competing global ID mechanism was created.

## Parent-child / source validation

IndexedDB has no relational constraints, so every `createX` helper in
`js/storage.js` performs a lightweight existence check before writing,
and rejects (Promise rejection with a descriptive `Error`, never a
fabricated fallback ID) when a reference is missing:

- `createTrainingCycle` — requires `source_review_snapshot_id` and
  `source_prescription_id`; both are looked up in `review_snapshots` /
  `prescriptions` and must exist.
- `createWeeklyPlan` — requires `cycle_id` to exist in `training_cycles`.
- `createSessionPlan` — requires `week_plan_id` to exist in
  `weekly_plans`; **`cycle_id` is derived from that parent record**
  rather than trusted from the caller, so a session plan can never point
  at a different cycle than its week.
- `createSessionLog` — requires `session_plan_id` to exist in
  `session_plans`; **`week_plan_id` and `cycle_id` are derived from that
  parent record** for the same reason.
- `createCycleSummary` — requires `cycle_id` to exist in
  `training_cycles`.

Deriving the denormalized foreign keys (`session_plans.cycle_id`,
`session_logs.week_plan_id`/`cycle_id`) from the immediate parent, rather
than accepting them from the caller, is what guarantees "no orphan data
created through public S8 storage helpers" — there is no code path that
can produce a session plan/log whose denormalized ancestry disagrees with
its actual parent chain.

## Canonical lifecycle

```
S7 Review Snapshot → S7 Prescription → TrainingCycle → WeeklyPlan
  → SessionPlan → SessionLog → CycleSummary → Retest → Assessment → S7 Review
```

Status enums enforced (reject-only; no automatic transition logic):

| Entity | Field | Allowed values |
|---|---|---|
| `training_cycles` | `status` | `PLANNED`, `ACTIVE`, `COMPLETED`, `ABORTED` |
| `weekly_plans` | `status` | `PLANNED`, `ACTIVE`, `COMPLETED` |
| `weekly_plans` | `phase` | `ACQUISITION`, `STABILIZATION`, `DECISION_INTEGRATION`, `PRESSURE_TRANSFER`, `MATCH_TRANSFER`, `RETEST` |
| `session_plans` | `status` | `PLANNED`, `AVAILABLE`, `COMPLETED`, `SKIPPED` |
| `session_logs` | `status` | `COMPLETE`, `PARTIAL`, `SKIPPED` (required at creation — no default) |
| `cycle_summaries` | `retest_readiness` | `READY`, `NOT_READY`, `INCOMPLETE` (defaults to `INCOMPLETE`) |
| `cycle_summaries` | `next_action` | `RETEST`, `EXTEND`, `REVIEW`, `NONE` (defaults to `NONE`) |

All enum arrays are exported as `PBStore.S8_ENUMS` so later S8 stages and
tests reuse the same single definition instead of redefining it.
`validated_level_at_start` and `target_level` on `training_cycles` are
restricted to the frozen Master Control V2 set `[3.0, 3.5, 4.0, 4.5,
5.0]` — no decimal intermediates (e.g. `3.87`, `4.2`) are ever accepted.

## Invariants enforced by storage, not just documented

- **Plan != Execution Log** — `createSessionPlan`/`updateSessionPlan`
  actively reject any of `results`/`evidence_links`/`notes`/`started_at`/
  `completed_at` (the execution-only fields that belong on
  `session_logs`). A session plan can never accumulate execution data.
- **S8 must not write `validated_training_level` directly** —
  `updateTrainingCycle` rejects any patch containing that key.
- **Missing evidence remains `INCOMPLETE`** — `cycle_summaries.retest_readiness`
  defaults to `INCOMPLETE`, never silently to `READY`, until a future
  stage's engine computes and writes an actual value.
- **Adherence != Capability / Training Completion != Hard Gate Passed /
  RETEST_READY != PROMOTED** — no S8-A code computes adherence, gate
  status, or promotion; `cycle_summaries.planned_sessions` /
  `completed_sessions` / `adherence` / `training_exposure` are stored
  exactly as given (defaulting to `null`/`{}`), never derived. There is
  no code path in `js/storage.js` that writes
  `validated_training_level`, references `capability_score`, or touches
  CAP/Match Transfer.
- **Match Transfer stays outside CAP** — no S8-A field or function
  participates in the CAP calculation (`45/30/25`); CAP logic lives
  entirely in the unmodified S7 review engine.

## Storage API added (`js/storage.js`)

```
createTrainingCycle, getTrainingCycle, listTrainingCycles, updateTrainingCycle
createWeeklyPlan, getWeeklyPlan, listWeeklyPlansByCycle, getWeeklyPlanByCycleWeek, updateWeeklyPlan
createSessionPlan, getSessionPlan, listSessionPlansByWeek, listSessionPlansByCycle, updateSessionPlan
createSessionLog, getSessionLog, listSessionLogsBySessionPlan, listSessionLogsByCycle
createCycleSummary, getCycleSummary, getCycleSummaryByCycle, updateCycleSummary
```

**Update (S8-B):** one minimal addition, `listTrainingCyclesByPrescription(prescription_id)`,
reusing the `by_prescription` index above (no new store/index). Added to
support the Adaptive Plan Engine's duplicate-cycle protection — see
[`docs/S8-B-ADAPTIVE-PLAN-ENGINE.md`](S8-B-ADAPTIVE-PLAN-ENGINE.md).

**Update (S8-C):** one minimal addition, `getFinalSessionLogByPlan(session_plan_id)`,
reusing the `by_session_plan` index above (no new store/index). Added to
support the Session Execution Engine's single-final-log rule — see
[`docs/S8-C-SESSION-EXECUTION-ENGINE.md`](S8-C-SESSION-EXECUTION-ENGINE.md).

(`getWeeklyPlanByCycleWeek` is one addition beyond the brief's minimum
list, needed to satisfy the explicit "`by_cycle_week` should support
deterministic retrieval of week N for a given cycle" requirement.)

## What remains unimplemented (by design)

- Adaptive Plan Engine / prescription-to-plan logic / weekly allocation /
  session recommendation algorithms.
- Adherence calculation and training-exposure scoring.
- `RETEST_READY` calculation (storage only holds whatever value a future
  engine decides to write; it never computes one).
- Automatic cycle completion or automatic level promotion.
- Any Training UI ("Today" screen or otherwise), navigation changes.
- `TD-REG-01` (pre-S7 UI regression suite) — unchanged, still deferred to
  S8-F.

These are explicitly out of scope for S8-A and belong to S8-B through
S8-F.
