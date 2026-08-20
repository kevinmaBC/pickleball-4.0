# S9-F: Training Prescription Integration

Implements the **Training Prescription Contract Source of Truth**:
consumes S9-E's `RecommendationResult` / `Recommendation[]` exclusively
and answers *"what training contract should correspond to this ranked
recommendation?"* **It does not answer specific ball/rep counts,
minutes, weekly frequency, or session structure** — that is S9-G
Session Builder, explicitly out of scope here. Deterministic mapping
only; no free-form or LLM-authored plan.

```
S9-E RecommendationResult (recommendations[])
  -> Eligibility Gate (status==='recommended', code mapped, rank/score/tier present)
  -> Recommendation -> Prescription mapping (RECOMMENDATION_TO_PRESCRIPTION)
  -> Training Objective / Training Mode / Drill Family / KPI Profile
  -> Priority inheritance (unchanged from Recommendation)
  -> Dosage Profile (from priority_tier)
  -> Reassessment Profile (default)
  -> TrainingPrescriptionResult
```

## Source-of-truth chain (unchanged)

S9-B Observation → S9-C Performance Pattern → S9-D Diagnosis/Skill Gap
→ S9-E Recommendation Priority → **S9-F Training Prescription
Contract**. This file never reads raw `trial_events`, never recomputes
S9-C metrics/patterns, never recreates an S9-D diagnosis, and never
reprioritizes — `priority_rank`/`priority_score`/`priority_tier` are
read verbatim off the `Recommendation` S9-E already produced.
`js/match-observation-engine.js`, `js/performance-analysis-engine.js`,
`js/diagnosis-engine.js`, and `js/recommendation-priority-engine.js`
are all **untouched**. The pure `prescribeRecommendations()` function
never touches `PBStore`, `PBMatchObservation`, `PBPerformanceAnalysis`,
or `PBDiagnosis` — the only dependency, and only from the optional
storage-backed `prescribeMatch()` convenience wrapper, is
`PBRecommendationPriority`.

## Minimal repository mapping finding: no exact-match registry exists

Before writing any mapping, the repo was searched for an existing
drill registry or KPI benchmark registry to reuse (per the design
freeze's "reuse before add" instruction). One was found —
`data/prescription_rules_v2_3_1.json`'s `BLOCK` values, consumed by
`js/training-plan-engine.js`'s `buildMetricToBlock()` (its own comment
calls it "the only existing drill/content reference," 唯一现存
drill/内容引用) — but it is **keyed by S1–S8 raw T01–T09 metric names**
(e.g. `drop_ball_quality_pct`, `reset_ball_quality_pct`), a
fundamentally different identifier space from S9-F's diagnosis-driven
`drill_family_code` taxonomy (`SHOT_EXECUTION`/`SHOT_CONTROL`/…, which
spans any rally-observed `shot` value from S9-B's ASMT-10 data, not one
specific T0x test). There is no exact semantic match between the two,
so per the design freeze's explicit rule ("reuse only if semantic match
is exact") **this registry is not reused**. No KPI numerical benchmark
registry of any kind was found either. Both `resolved_drill_ids` and
`kpi_target_value` therefore stay unresolved for every V1 prescription
— this is the expected, designed-for default, not a gap to silently
paper over.

## Recommendation → Prescription mapping (`RECOMMENDATION_TO_PRESCRIPTION`)

Frozen, single centralized config:

| recommendation_code | training_objective_code | training_mode | drill_family_code | kpi_profile_code |
|---|---|---|---|---|
| `IMPROVE_SHOT_EXECUTION` | `SHOT_EXECUTION` | `TECHNICAL_REPETITION` | `SHOT_EXECUTION` | `EXECUTION_SUCCESS_RATE` |
| `IMPROVE_SHOT_CONTROL` | `SHOT_CONTROL` | `CONTROL_REPETITION` | `SHOT_CONTROL` | `ERROR_RATE` |
| `IMPROVE_SHOT_SELECTION` | `SHOT_SELECTION` | `DECISION_SCENARIO` | `SHOT_SELECTION` | `DECISION_SUCCESS_RATE` |
| `IMPROVE_SHOT_CONSISTENCY` | `SHOT_CONSISTENCY` | `CONSISTENCY_BLOCK` | `SHOT_CONSISTENCY` | `CONSISTENCY_RATE` |
| `IMPROVE_TRANSITION_EXECUTION` | `TRANSITION_EXECUTION` | `TRANSITION_SCENARIO` | `TRANSITION_EXECUTION` | `TRANSITION_SUCCESS_RATE` |
| `IMPROVE_TRANSITION_CONTROL` | `TRANSITION_CONTROL` | `TRANSITION_SCENARIO` | `TRANSITION_CONTROL` | `TRANSITION_CONTROL_RATE` |

`training_mode` is drawn only from the frozen V1 taxonomy
(`TECHNICAL_REPETITION`, `CONTROL_REPETITION`, `DECISION_SCENARIO`,
`CONSISTENCY_BLOCK`, `TRANSITION_SCENARIO`) — no new modes invented. An
unmapped `recommendation_code` is **never guessed**; it defers with
`reason: 'UNSUPPORTED_RECOMMENDATION'`.

## Eligibility Gate

A `Recommendation` becomes a `Prescription` only if, in order:

1. It is a real object with `status === 'recommended'` (else → deferred,
   `reason: 'INVALID_RECOMMENDATION'`).
2. It has a non-null `recommendation_code` (else → deferred,
   `reason: 'INVALID_RECOMMENDATION'`).
3. That code is in `RECOMMENDATION_TO_PRESCRIPTION` (else → deferred,
   `reason: 'UNSUPPORTED_RECOMMENDATION'`).
4. It has non-null `rank`, `priority_score`, and `priority_tier`, and
   the tier resolves to a known dosage profile (else → deferred,
   `reason: 'MISSING_PRIORITY'`).

A missing drill resolution or KPI numerical target is **never** a
reason to defer — see below.

## Priority inheritance (hard rule)

`priority_rank = Recommendation.rank`, `priority_score =
Recommendation.priority_score`, `priority_tier =
Recommendation.priority_tier` — all three copied verbatim, never
recomputed. S9-F does not reorder or rescore anything.

## Dosage Profile (`PRIORITY_TO_DOSAGE_PROFILE`)

```js
{ HIGH: 'PRIMARY_FOCUS', MEDIUM: 'STANDARD_FOCUS', LOW: 'LIGHT_FOCUS' }
```

A relative label only — **never** reps, minutes, sessions/week, or a
training calendar. Derived directly from the inherited `priority_tier`,
with no new threshold re-derivation.

## Drill resolution: family vs. specific drill

`drill_family_code` is always set (from the mapping table).
`resolved_drill_ids` is always `[]` and `drill_resolution_status` is
always `'UNRESOLVED'` in V1, per the repo-mapping finding above — no
drill ID is ever fabricated to fill the field. **Unresolved drill
resolution is not prescription failure**: `status` stays `'prescribed'`
as long as the recommendation mapping itself resolves (verified
directly in the test suite).

## KPI Profile: what to measure, not a target number

`kpi_profile_code` identifies *what* to measure (from the mapping
table). `kpi_target_value` is always `null` and `kpi_target_status` is
always `'BENCHMARK_NOT_RESOLVED'` — no fabricated `80%`/`75%`/`90%`,
and never interpretable as a 3.0/3.5/4.0/4.5/5.0 player-level standard.

## Reassessment Profile

Every prescription carries `reassessment_profile_code:
'MATCH_RECHECK'` (`DEFAULT_REASSESSMENT_PROFILE`) — no repo-registered,
more specific reassessment registry (`7 days`/`14 days`/`after 4
sessions`) was found during minimal repository mapping, so no such
interval is invented. **Reassessment never implies rating
promotion/demotion** — it means only "re-enter the Observation →
Analysis → Diagnosis → Priority loop."

## Prescription Identity

`player_id + match_id + source_recommendation_id` — **one
Recommendation produces exactly one Prescription**. S9-F performs no
merging (S9-E already deduplicated at the recommendation layer); this
stage is a 1:1 deterministic transform.

## TrainingPrescriptionResult

```js
{
  match_id, player_id,
  prescriptions: [],            // never truncated
  deferred_prescriptions: [],
  primary_prescription_id,      // the prescription whose source Recommendation had rank===1, or null
  prescription_count,           // === prescriptions.length
  prescription_version: 'S9-F-V1'
}
```

## Traceability

Each `Prescription.source_recommendation_id` maps back to exactly one
S9-E `Recommendation.recommendation_id` — never a copy of the
recommendation payload (e.g. `source_skill_gap_ids` is not carried onto
the prescription; verified directly in the test suite).

## Input validation / partial data

Throws `PrescriptionError('INVALID_INPUT', …)` for a missing
`recommendationResult`, a missing `match_id`, or a non-array
`recommendations`. A missing/empty `recommendations` array and
individual malformed entries (`null`, `{}`, wrong `status`, missing
`recommendation_code`, missing priority fields) all degrade safely to a
`deferred_prescriptions` entry, never an undefined-property crash.

## Public API

`prescribeRecommendations(recommendationResult)` — pure function,
independently testable, zero storage access. `prescribeMatch(matchId,
playerId)` — storage-backed convenience wrapper:
`PBRecommendationPriority.prioritizeMatch(matchId, playerId)` →
`prescribeRecommendations(...)`. No new REST route.

## Non-scope (explicitly not implemented here)

Warm-up/block/cool-down session structure, session duration/order,
weekly training calendar, specific ball/rep counts, specific named
drills (beyond a family code), any fabricated numerical KPI benchmark,
any player-level rating promotion/demotion, any 3.0–5.0 benchmark
creation, any root-cause/biomechanics diagnosis (grip, paddle face,
late contact, footwork, mental), any LLM/ML dependency, any direct call
to `PBDiagnosis`/`PBPerformanceAnalysis`/`PBMatchObservation`/
`PBStore`, any change to the four upstream S9 engine files.

## Tests

`tests/training-prescription-engine.test.js`: input validation, all six
frozen recommendation→prescription mappings, unsupported
recommendation codes (no guessing), all three dosage-profile mappings,
priority inheritance (rank/score/tier unchanged), drill-unresolved ≠
prescription-failure, KPI-target-unresolved (no fabricated number),
reassessment profile default, six distinct malformed-input scenarios
(each asserted to the correct specific defer reason), empty-input
safety, primary-prescription selection, no-truncation with 5
simultaneous eligible prescriptions, deterministic repeated execution,
traceability (no payload copying), and three integration flows (A: a
real S9-B→S9-C→S9-D→S9-E→S9-F chain producing a prescription,
exercising both `prescribeRecommendations` and `prescribeMatch`; B: a
real low-confidence fixture proving the downstream block is never
bypassed; C: an unsupported-pattern-type fixture proving no
prescription is ever produced for it). Structural checks confirm the
source contains no session/calendar/dosage-number/rating-change/LLM
reference, no direct dependency on any upstream-of-S9-E module, no
root-cause/biomechanics phrase, and no player-level benchmark literal
in actual code. Full existing regression suite (S1 through S9-E)
re-verified passing alongside it.
