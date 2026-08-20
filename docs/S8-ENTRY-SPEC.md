# S8 Entry Spec (S8-0 / S8-A)

Documentation-only boundary freeze for S8, written at S8-0. It defined
what S8 *would* build; S8-0 itself implemented none of it.

**Update (S8-A):** the storage/IndexedDB architecture described below
under "Storage/IndexedDB compatibility for S8 (findings)" is now
implemented — see [`docs/S8-A-DATA-ARCHITECTURE.md`](S8-A-DATA-ARCHITECTURE.md)
for the full schema, indexes, validation rules, and enforced invariants.
S8-A implemented data persistence only: no plan-generation engine,
adherence calculation, `RETEST_READY` calculation, or Training UI exists
yet. Those remain deferred to S8-B onward, per the "Explicitly out of
scope" section below, which is still fully in force.

## Baseline

- Repository: `kevinmaBC/pickleball-4.0`
- Branch: `app-v2-alpha`
- S8-0 started from `2f940c2193683ff4128f6701faea15ff6518986c` (S7-F, clean tree).
- S1–S6: ACCEPTED. S7: CLOSED / ACCEPTED WITH NON-BLOCKING LIMITATIONS.
- Master Control V2 methodology (validated levels, CAP weighting, Match
  Transfer separation, evidence ranks, namespace, hard-gate logic) is
  frozen and **not modified** by S8-0. See `docs/S7-FINAL-ACCEPTANCE.md`
  for the audited state.

## Planned future S8 entities (not implemented yet)

```
TrainingCycle
WeeklyPlan
SessionPlan
SessionLog
CycleSummary
```

These will be built in S8-A onward. S8-0 does not create IndexedDB object
stores, engines, or UI for any of them.

## Required architectural relationship

```
S7 Review Snapshot
        ↓
S7 Prescription
        ↓
Training Cycle
        ↓
Weekly Plan
        ↓
Session Plan
        ↓
Session Log
        ↓
Cycle Summary
        ↓
Re-test
        ↓
Assessment
        ↓
S7 Review
```

`Training Cycle` is anchored to an existing `prescriptions` record
(`prescription_id`, itself anchored to an `assessment_id`). The chain
closes the loop back into the existing S7 assessment/review pipeline
rather than forming a parallel system — S8 consumes S7 output
(`review_snapshots` → `prescriptions`) and eventually produces new S7
input (a `retests` record feeding a new `assessments`/`review_snapshots`
cycle).

## Critical invariants (binding on all future S8 work)

- **Plan != Execution Log.** A `WeeklyPlan`/`SessionPlan` describes intent;
  a `SessionLog` records what actually happened. They are distinct
  records — a plan is never mutated in place to "become" its log.
- **Adherence != Capability.** Whether a player did the prescribed work
  (adherence) is tracked independently of whether they can perform at a
  level (capability, i.e. CAP / validated level). S8 adherence data must
  never be read as a capability signal by S7 logic.
- **Training Completion != Hard Gate Passed.** Finishing a `CycleSummary`
  does not imply any `level_gates` hard gate was met. Gate status is only
  ever produced by the existing S7 review/gate logic, from assessment
  evidence.
- **`RETEST_READY` != `PROMOTED`.** A cycle reaching a re-test-ready state
  is a scheduling signal, not a promotion. Promotion language stays
  scoped to S7's existing `PROMOTION_REVIEW_ELIGIBLE` semantics (review
  eligible, not promoted — see `docs/S7-FINAL-ACCEPTANCE.md`).
- **S8 must not write `validated_training_level` directly.** Only the S7
  Validated Level logic (Capability Threshold + Evidence Confidence +
  Target Hard Gates + Match Validation) may produce that field. S8 writes
  training-cycle data; it does not judge or promote.
- **Match Transfer remains outside CAP.** S8 training-cycle data must not
  be folded into the CAP calculation (`45% Technical / 30% Decision / 25%
  Pressure`), and Match Transfer stays an independent validation layer, as
  in S7.
- **Missing evidence remains `INCOMPLETE`.** S8 must not introduce a `C0`
  evidence rank or otherwise treat missing/insufficient evidence as
  anything other than the canonical `INCOMPLETE` outcome.

## Storage/IndexedDB compatibility for S8 (findings)

Current `pb_v2` database (`js/storage.js`, `DB_VERSION` 2):

- Object stores: `players`, `assessments`, `test_sessions`, `trial_events`
  (S1), plus `review_snapshots`, `prescriptions`, `retests` (S7-A,
  currently empty placeholders with no read/write business logic wired
  in beyond CRUD).
- Migration mechanism: a single `indexedDB.open(DB_NAME, DB_VERSION)` with
  an `onupgradeneeded` handler that only **creates stores that don't
  already exist** (`if (!db.objectStoreNames.contains(name))`). It never
  drops, renames, or rewrites an existing store. This has already been
  exercised safely once (v1 → v2, S7-A) and is covered by
  `tests/storage.test.js`, which seeds a pre-existing v1 database and
  asserts all v1 data survives the v2 upgrade untouched.
- Assessment namespace handling: canonical `TECH-xx` / `DEC-xx` /
  `ASMT-01..10` with legacy `T01..T10` aliases, resolved by
  `js/namespace.js`; storage itself is namespace-agnostic (it stores
  whatever `test_id` string it's given).
- Review Snapshot / Prescription / Retest persistence: each is its own
  store, keyed by its own id, indexed `by_assessment`. `retests` also
  carries an optional `prescription_id` foreign key.

**Conclusion (as assessed at S8-0): the existing architecture safely
supports S8's future entities without any change at that time.** The
same additive-only `onupgradeneeded` pattern was expected to extend
cleanly to a `DB_VERSION` 3 that adds `training_cycles`, `weekly_plans`,
`session_plans`, `session_logs`, and `cycle_summaries` stores, each
indexed back to its parent, mirroring the existing
`by_assessment`/`by_session` index convention. No preparatory schema
change was made in S8-0.

**S8-A implemented exactly this.** `DB_VERSION` is now 3; the five stores
above exist with the indexes predicted here. See
[`docs/S8-A-DATA-ARCHITECTURE.md`](S8-A-DATA-ARCHITECTURE.md) for the
implemented schema, parent/source validation, and enforced invariants.

**Update (S8-B):** the `TrainingCycle → WeeklyPlan → SessionPlan` planning
layer referenced in the architectural relationship above is now
implemented as a deterministic engine
(`js/training-plan-engine.js`/`PBTrainingPlan`) that consumes an accepted
S7 Review Snapshot + Prescription and persists the planned structure
through the S8-A storage API. See
[`docs/S8-B-ADAPTIVE-PLAN-ENGINE.md`](S8-B-ADAPTIVE-PLAN-ENGINE.md).
`SessionLog`, `CycleSummary`, adherence, and `RETEST_READY` remain
entirely unimplemented, per the invariants below.

**Update (S8-C):** the `SessionPlan → SessionLog` step is now implemented
as `js/session-execution-engine.js`/`PBSessionExecution` — a
START/ACTIVE/COMPLETE|PARTIAL|SKIPPED lifecycle that turns an existing
`SessionPlan` into a persisted `SessionLog` through the S8-A storage API.
See [`docs/S8-C-SESSION-EXECUTION-ENGINE.md`](S8-C-SESSION-EXECUTION-ENGINE.md).
`CycleSummary`, adherence, training-exposure scoring, and `RETEST_READY`
remain entirely unimplemented — S8-C only records session-level
execution facts.

**Update (S8-D):** the `SessionLog → CycleSummary → Re-test` step
(adherence, training exposure, R1-R4 re-test-readiness gates) is now
implemented as `js/training-readiness-engine.js`/`PBTrainingReadiness`,
persisting through the existing S8-A `cycle_summaries` store with zero
storage-schema changes. See
[`docs/S8-D-TRAINING-READINESS.md`](S8-D-TRAINING-READINESS.md).
`RETEST_READY` here means only "sufficient training execution/exposure
to justify a formal re-test" — it is never capability, a passed hard
gate, or a promotion signal, and no actual re-test/promotion is
triggered by this stage.

**Update (S8-E):** the full `TODAY → TRAINING CYCLE → SESSION → PROGRESS
→ RE-TEST READINESS → MEASURE` flow now has a thin UI layer,
`js/training-ui.js`/`PBTrainingUI`, folded into the existing HOME/DRILL/
REVIEW/MEASURE tabs (no new top-level nav). It renders S8-A→D data and
calls `PBSessionExecution`/`PBTrainingReadiness` only — it contains no
adherence/exposure/R1-R4/threshold logic of its own. See
[`docs/S8-E-TRAINING-UI.md`](S8-E-TRAINING-UI.md). All S8 engines
(S8-A through S8-D) remain unmodified except one additive, non-semantic
field on `training-readiness-engine.js`'s existing output (documented
there and in the S8-E doc).

**Update (S8-F):** full-system QA / final acceptance gate for S8.
TD-REG-01 is now **CLOSED** — see
[`docs/S8-F-FINAL-QA.md`](S8-F-FINAL-QA.md) for the full test inventory,
closure evidence, cross-layer integration QA, Master Control V2 and S8
invariant audits, and the one MAJOR mobile-viewport defect found and
fixed (a pre-existing Home-tab table missing a horizontal-scroll
wrapper — unrelated to S1–S8 logic, two-line `index.html` fix with
regression coverage added). No S8 engine or storage logic was changed.

## Service Worker (TD-SW-01)

Resolved in this commit. See `docs/SW-CACHE-POLICY.md` for the full
policy. Summary: navigation and code/data assets (`js`/`css`/`json`) now
use network-first instead of stale-while-revalidate, so a deploy can no
longer leave an already-installed client silently serving stale
application logic — independent of whether `sw.js`'s `CACHE` constant was
bumped. Obsolete cache versions continue to be purged on `activate`.

## Explicitly out of scope for S8-0

- Training Cycle engine, weekly-plan engine, session execution engine,
  adherence engine, retest-readiness engine — none implemented.
- No new S8 UI.
- `TD-REG-01` (automated regression suite for pre-S7 UI modules) —
  deferred to S8-F.
- No redesign of S1–S7 or Master Control V2 methodology.
