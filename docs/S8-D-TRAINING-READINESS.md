# S8-D: Adherence + Training Exposure + Re-test Readiness

`js/training-readiness-engine.js` (`PBTrainingReadiness`) converts
S8-A/B/C training execution data (`TrainingCycle`, `WeeklyPlan`,
`SessionPlan`, `SessionLog`) into a deterministic readiness summary. It
answers three questions only: was the plan executed, did the required
targets get enough exposure, and is the cycle ready for a formal
re-test. **It never answers whether capability improved, a hard gate
passed, Match Validation passed, the validated level changed, or the
player should be promoted** — those remain exclusively S7 review-engine
concerns.

## Data flow

```
TrainingCycle (S8-A/B: primary_bottleneck, retest_targets, failed_hard_gates)
        +
WeeklyPlan / SessionPlan (S8-B: assignments[] — role, target metric, namespace)
        +
SessionLog (S8-C: COMPLETE | PARTIAL | SKIPPED, or absent)
        ↓
calculateAdherence(cycle_id)        -- session-level completion stats
calculateTrainingExposure(cycle_id) -- per-assignment exposure, derived from the same data
        ↓
evaluateRetestReadiness(cycle_id)   -- R1-R4 gates -> READY | NOT_READY | INCOMPLETE
        ↓
buildCycleSummary(cycle_id)         -- persists via existing S8-A cycle_summaries store
```

No new IndexedDB store or index was added — `js/storage.js` is
completely untouched by S8-D. The existing `cycle_summaries` schema
(specifically its free-form `training_exposure` object field) already
had everything this stage needed to persist.

## Public API

```js
PBTrainingReadiness.calculateAdherence(cycle_id)
PBTrainingReadiness.calculateTrainingExposure(cycle_id)
PBTrainingReadiness.evaluateRetestReadiness(cycle_id)
PBTrainingReadiness.buildCycleSummary(cycle_id)
```

All four return Promises. `calculateTrainingExposure`,
`evaluateRetestReadiness`, and `buildCycleSummary` reject with
`ReadinessError('CYCLE_NOT_FOUND', ...)` for an unknown `cycle_id`.

## Adherence formula (Section 4, frozen)

Per `SessionPlan`, credit = `1.00` if its `SessionLog.status` is
`COMPLETE`, `0.50` if `PARTIAL`, `0.00` if `SKIPPED`, `0.00` if no
`SessionLog` exists at all ("NO LOG"):

```
completion_equivalent = Σ session credit
adherence_rate        = completion_equivalent / planned_sessions
```

`calculateAdherence` returns `{ planned_sessions, complete_sessions,
partial_sessions, skipped_sessions, unlogged_sessions,
completion_equivalent, adherence_rate }`. `adherence_rate` is `null`
(never `0`) when `planned_sessions === 0` — division by zero isn't a
real "0% adherence," it's "not calculable." Verified against the
brief's own worked example (14 COMPLETE + 2 PARTIAL + 1 SKIPPED + 1 NO
LOG out of 18 → `completion_equivalent = 15`, `adherence_rate =
15/18`).

## Training exposure formula (Section 5/6/7/9)

Every `(SessionPlan, assignment)` pair is one "occurrence." An
occurrence's credit is inherited from its own session's credit (S8-C
has no per-assignment execution status yet, only per-session) — the
same `1.00 / 0.50 / 0.00` values as adherence.

- **Primary bottleneck exposure** (Section 6): the authoritative
  bottleneck is read straight from `TrainingCycle.primary_bottleneck`
  (already copied there from `Prescription.data.primary_bottleneck` at
  S8-B build time) — never recomputed. It's parsed into a concrete
  metric the same way S8-B parses it (`'hard_gate:' + metric` →
  `metric`; `'match_validation'` → `'match_transfer_score'`;
  `'capability_threshold'` / `'evidence'` → no single metric).
  `primary_exposure_rate = Σ credit / count` over every occurrence with
  `role === 'PRIMARY'` and `target === <that metric>`. If the
  bottleneck has no mappable metric, or no `PRIMARY`-role occurrence
  exists at all, the rate is `null` and a `primary_incomplete_reason`
  string is set — this is what drives R2's `INCOMPLETE` state.
- **Per-retest-target exposure** (Section 7): for *every* metric in
  `TrainingCycle.retest_targets` independently (never averaged), the
  same `Σ credit / count` is computed over **all** occurrences of that
  metric anywhere in the cycle (any role, any week) — not just the
  `RETEST` week's prep sessions, since earlier `PRIMARY`/`SUPPORT` work
  on that same metric is real exposure too. Output is keyed by the
  occurrence's real `assessment_namespace` (e.g. `"ASMT-05": 0.85`),
  matching the brief's example shape. If a target has **zero**
  occurrences anywhere, its value is `null` — an unmapped required
  target, exactly Section 7's "if a required retest target cannot be
  mapped safely" case.

  **Update (S8-E):** each entry in `retest_target_detail[]` also carries
  `meets_threshold` (boolean, or `null` when unmapped) — the same
  `exposure_rate >= RETEST_READINESS_THRESHOLDS.MIN_RETEST_TARGET_EXPOSURE`
  comparison R3 already performs in aggregate, now also attached per
  target. No new threshold and no changed gate result; R3's own
  aggregate check was simplified to `detail.every(d => d.meets_threshold)`
  so the comparison exists in exactly one place. This exists so
  `js/training-ui.js` can render "EXPOSURE MET"/"EXPOSURE BELOW TARGET"
  per target without duplicating threshold logic in the UI — see
  [`docs/S8-E-TRAINING-UI.md`](S8-E-TRAINING-UI.md).
- **Match Transfer exposure** (Section 9): computed **by metric**
  (`target === 'match_transfer_score'`), not by role. This matters
  because S8-B gives both the `PRESSURE_TRANSFER`-week assignment and
  the `MATCH_TRANSFER`-week assignment the same `role: 'TRANSFER'` —
  filtering by role alone would conflate two different training
  targets. Purely informational output; it never enters CAP, is never
  read as a capability score, and is never treated as formal Match
  Validation. If `match_transfer_score` happens to also be a declared
  retest target (only when `primary_bottleneck === 'match_validation'`),
  it's evaluated by R3/R4 like any other target — training exposure
  feeding a re-test-scheduling decision is not the same thing as that
  exposure *being* Match Validation, which is the actual invariant.

No drill-level completion percentages are invented — `attempts` /
`successful` / `measured_value` from `SessionLog.results[]` are not
used here at all (that's S8-C's per-result detail, not a cycle-level
aggregate S8-D needs).

## R1-R4 readiness gates (Section 10/11)

Thresholds are centralized in one exported constant, never scattered:

```js
PBTrainingReadiness.RETEST_READINESS_THRESHOLDS
// { MIN_ADHERENCE: 0.80, MIN_PRIMARY_EXPOSURE: 0.75, MIN_RETEST_TARGET_EXPOSURE: 0.70 }
```

| Gate | Condition | PASS | FAIL | INCOMPLETE |
|---|---|---|---|---|
| **R1** Adherence | `adherence_rate >= 0.80` | met | not met | `planned_sessions === 0` |
| **R2** Primary Bottleneck Exposure | `primary_exposure_rate >= 0.75` | met | not met | bottleneck unmappable, or zero PRIMARY occurrences |
| **R3** Retest Target Coverage | **every** target's `exposure_rate >= 0.70` (no averaging — one below-threshold target fails the whole gate) | all met | any target below threshold | any target has zero occurrences (unmapped), or no targets defined |
| **R4** Execution Evidence Sufficiency | **every** target has ≥1 occurrence in a `COMPLETE`/`PARTIAL` session | all met | any target has occurrences but none ever executed | same as R3 (can't evaluate what can't be mapped) |

All boundary comparisons are `>=`, confirmed at exactly `0.80` / `0.75`
/ `0.70` in tests (E/F/G).

## READY / NOT_READY / INCOMPLETE (Section 12)

```
overall = 'INCOMPLETE' if any gate is INCOMPLETE   -- always wins, even if other gates PASS
        = 'READY'      if all four gates PASS
        = 'NOT_READY'  otherwise (at least one clear FAIL, none INCOMPLETE)
```

`INCOMPLETE` is never collapsed into `NOT_READY` — the Master Control
"Missing = INCOMPLETE" rule is preserved exactly, and takes priority
even when R1/R2 both PASS (test J: high adherence + high primary
exposure, but one retest target has no mapping anywhere → overall
`INCOMPLETE`, not `NOT_READY`).

## CycleSummary persistence (Section 13/14)

`buildCycleSummary(cycle_id)`: one current `CycleSummary` per cycle.
`PBStore.getCycleSummaryByCycle(cycle_id)` checks for an existing
record — if found, `updateCycleSummary` overwrites it in place; if not,
`createCycleSummary` makes one. Recalculating never creates a second
record for the same cycle (verified in tests — `by_cycle` index still
returns exactly one row after multiple `buildCycleSummary` calls).

Uses the existing schema fields as-is: `planned_sessions`,
`completed_sessions` (= `complete_sessions` count), `adherence` (=
`adherence_rate`), `retest_readiness` (`READY`/`NOT_READY`/`INCOMPLETE`
— already the exact frozen enum from S8-A), `next_action` (`'RETEST'`
when ready, else `'NONE'`). Everything else (per-status counts,
`completion_equivalent`, `primary_exposure_rate`,
`retest_target_exposure`, `match_transfer_exposure`, the full R1-R4
gate detail, the thresholds used, and a `calculated_at` timestamp) is
stored inside the existing free-form `training_exposure` object field —
no schema change needed. `calculated_at` is pure metadata; it's never
read back into any comparison.

**Forbidden fields** (Section 14) — verified absent from every
persisted `CycleSummary` and structurally absent from the engine's own
source code (comments stripped): `validated_training_level`,
`new_level`, `promoted_level`, `capability_score`, `CAP_score`,
`hard_gate_passed`, `match_validation_passed`, `promotion_status`.

## Cycle lifecycle (Section 15)

`buildCycleSummary` never mutates `TrainingCycle.status`. Verified: a
cycle with every `SessionPlan` finalized and a `READY` summary built
still has `status: 'PLANNED'` afterward — readiness computation and
cycle lifecycle mutation remain fully separate, exactly as required.

## Master Control safety

No file outside `js/training-readiness-engine.js` was touched by S8-D
except this documentation set — `js/storage.js` is unmodified, and none
of the S7 review/trend/retest engines, `js/training-plan-engine.js`, or
`js/session-execution-engine.js` were changed. The engine never writes
`validated_training_level`, never computes a CAP score, never evaluates
or passes a Hard Gate, never performs Match Validation, and never
creates a retest/promotion record. `RETEST_READY` here means exactly
what Section 16 defines: sufficient training execution/exposure to
justify scheduling a *formal* re-test — nothing more.

## Determinism (Section 17)

Every calculation is a pure transform over already-persisted data — no
randomness, no LLM/AI scoring, no external/cloud calls, no
time-dependent scoring logic. `calculated_at` reflects generation time
but is metadata only, never part of any gate comparison.

## Tests (`tests/training-readiness-engine.test.js`)

Covers all required scenarios A–T from the task brief: all-COMPLETE
adherence; PARTIAL=0.5/SKIPPED=0/NO-LOG=0; the brief's exact worked
example (15/18); all three thresholds at their exact `0.80`/`0.75`/`0.70`
boundaries (PASS, not FAIL); one under-exposed retest target failing R3
without being averaged away by a well-trained one (→ `NOT_READY`); high
adherence with insufficient primary exposure (→ `NOT_READY`, built via a
synthetic S8-A-only fixture — see the code comment on why a *real* S8-B
cycle structurally can't produce this combination, since `PRIMARY` is
scheduled into nearly every week); a required target missing
authoritative mapping (→ `INCOMPLETE`, overriding otherwise-passing
R1/R2); a target planned but never executed (→ R4 `FAIL`/`NOT_READY`);
broken/corrupted `primary_bottleneck` ancestry (→ `INCOMPLETE`) and an
unknown `cycle_id` (→ `CYCLE_NOT_FOUND` rejection); match-transfer
exposure structurally isolated from CAP/Match Validation; no
`validated_training_level`/Hard-Gate/promotion vocabulary anywhere in
output or source; `CycleSummary` persistence through the real
`PBStore`; and no duplicate `CycleSummary` on recalculation. All prior
S1–S8-C suites re-verified passing alongside it.
