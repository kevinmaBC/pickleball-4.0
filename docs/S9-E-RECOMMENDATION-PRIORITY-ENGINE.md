# S9-E: Recommendation Prioritization Engine

Implements the **Recommendation Priority Source of Truth**: consumes
S9-D's `DiagnosisResult` / `SkillGap[]` exclusively and answers *"which
diagnosed Skill Gaps should be improved first?"* **It does not answer
how to train them** — no drill selection, no repetition count, no
session duration/frequency, no training calendar. That is S9-F Training
Prescription, explicitly out of scope here.

```
S9-D DiagnosisResult (skill_gaps[])
  -> Eligibility Gate (status==='supported', diagnosis_code mapped, priority_signal present)
  -> Diagnosis -> Recommendation mapping (DIAGNOSIS_TO_RECOMMENDATION)
  -> Deduplication (player+match+recommendation_code+skill+context; max aggregation)
  -> Priority Tier (centralized operational bands)
  -> Reason Signals (centralized deterministic labels)
  -> Deterministic Ranking
  -> RecommendationResult
```

## Source-of-truth chain (unchanged)

S9-B Observation → S9-C Performance Pattern → S9-D Diagnosis/Skill Gap
→ **S9-E Recommendation Priority**. This file never reads raw
`trial_events`, never recomputes S9-C metrics/patterns, never
recreates an S9-D diagnosis, and never recomputes S9-D
`severity_score`/`confidence_score`/`priority_signal` — every one of
those is read verbatim off the `SkillGap` S9-D already produced.
`js/match-observation-engine.js`, `js/performance-analysis-engine.js`,
and `js/diagnosis-engine.js` are all **untouched**. The pure
`prioritizeDiagnosis()` function never touches `PBStore`,
`PBMatchObservation`, or `PBPerformanceAnalysis` at all — the only
dependency, and only from the optional storage-backed
`prioritizeMatch()` convenience wrapper, is `PBDiagnosis`.

## Diagnosis → Recommendation mapping (`DIAGNOSIS_TO_RECOMMENDATION`)

Frozen, shot-agnostic recommendation codes — `skill` (carried through
unchanged from the `SkillGap`) expresses the specific shot separately,
avoiding an `IMPROVE_DROP`/`IMPROVE_RESET`/`IMPROVE_DINK`/… explosion:

| diagnosis_code | recommendation_code |
|---|---|
| `SHOT_EXECUTION_GAP` | `IMPROVE_SHOT_EXECUTION` |
| `SHOT_CONTROL_GAP` | `IMPROVE_SHOT_CONTROL` |
| `SHOT_SELECTION_GAP` | `IMPROVE_SHOT_SELECTION` |
| `SHOT_CONSISTENCY_GAP` | `IMPROVE_SHOT_CONSISTENCY` |
| `TRANSITION_EXECUTION_GAP` | `IMPROVE_TRANSITION_EXECUTION` |
| `TRANSITION_CONTROL_GAP` | `IMPROVE_TRANSITION_CONTROL` |

`TRANSITION_CONTROL_GAP` has no S9-D producer yet (S9-D's own
`PATTERN_TO_DIAGNOSIS` never emits it), but the mapping is kept ready
per the frozen V1 vocabulary. Any `diagnosis_code` not in this table —
including a genuinely unknown/future code — is **never guessed**; it
defers with `reason: 'UNSUPPORTED_DIAGNOSIS'`.

## Eligibility Gate

A `SkillGap` becomes an active recommendation only if all three hold:

1. `status === 'supported'` (anything else → deferred, `reason:
   'INVALID_SKILL_GAP'` — S9-E never reinterprets upstream status).
2. `diagnosis_code` is in `DIAGNOSIS_TO_RECOMMENDATION` (else →
   deferred, `reason: 'UNSUPPORTED_DIAGNOSIS'`).
3. `priority_signal != null` (else → deferred, `reason:
   'MISSING_PRIORITY_SIGNAL'` — `null` is never converted to `0`;
   deferred entries never carry a fabricated `priority_score` field at
   all).

Every rejection produces one `deferred_recommendations[]` entry —
nothing is silently discarded.

## Priority Score (frozen)

`priority_score = SkillGap.priority_signal`, verbatim. **No new
weighted formula, no tactical-impact bonus, no level modifier, no
player-rating input.** S9-E V1 inherits S9-D's already-computed signal
exactly.

## Priority Tier (`PRIORITY_TIER_THRESHOLDS`)

```js
PRIORITY_TIER_THRESHOLDS = { HIGH_MIN: 70, MEDIUM_MIN: 40 }
// priority_score >= 70            -> HIGH
// 40 <= priority_score < 70       -> MEDIUM
// priority_score < 40             -> LOW
```

**These are Operational Recommendation Priority Bands only.** They are
explicitly **not** 3.0/3.5/4.0/4.5/5.0 player-level benchmarks, not
player/skill rating, not DUPR, not an assessment grade, and not a
Master Control V2 Hard Gate threshold. Computed strictly after
deduplication/merge is finalized (§19 — tier is never computed before
merging, then left stale).

## Reason Signals (`REASON_SIGNAL_THRESHOLDS`)

Only four deterministic labels are ever produced, each independently
gated and deduplicated by construction (a condition can fire at most
once per recommendation):

- `HIGH_SEVERITY` if `severity_score >= 70`
- `HIGH_CONFIDENCE` if `confidence_score >= 70`
- `HIGH_PRIORITY_SIGNAL` if `priority_score >= 70`
- `MULTIPLE_EVIDENCE` if `source_skill_gap_ids.length > 1`

No `FOUNDATIONAL_SKILL`/`LEVEL_LIMITING`/`BLOCKS_ADVANCEMENT`/
`MATCH_CRITICAL`/`TACTICALLY_URGENT`/`MENTAL_WEAKNESS` or any other
invented reason — structurally checked in the test suite.

## Deduplication

Identity: `player_id + match_id + recommendation_code + skill +
context`. Same identity → merge: `source_skill_gap_ids` unioned
(deduplicated), `severity_score`/`confidence_score`/
`diagnosis_priority_signal`/`priority_score` each **independently
max-aggregated** — never summed, never averaged (`max(74,72)=74`, not
`146`; a merge's `severity_score` and `confidence_score` come from
whichever contributing gap had the higher value for *that* field, not
necessarily the same gap — verified with the exact worked example from
the design freeze). Different `skill` or `context` never merges, even
under the same `recommendation_code`.

## Deterministic Ranking

Strict comparator, applied in order, with no random tie-break:

1. `priority_score` DESC
2. `confidence_score` DESC
3. `severity_score` DESC
4. `recommendation_code` ASC
5. `skill` ASC (`null` sorts last, stably)
6. `context` ASC (`null` sorts last, stably)

By construction no two recommendations can tie on all six keys, since
deduplication already guarantees identity uniqueness. `rank = index +
1` after sorting. **No truncation** — every eligible recommendation is
retained; "top" is simply `rank === 1`.

## RecommendationResult

```js
{
  match_id, player_id,
  recommendations: [],            // never truncated
  deferred_recommendations: [],
  top_recommendation_id,          // recommendations[0].recommendation_id, or null if none
  recommendation_count,           // === recommendations.length
  recommendation_version: 'S9-E-V1'
}
```

No new confidence system: every `Recommendation` already carries
`confidence_score` (inherited from S9-D); S9-E introduces no
`recommendation_confidence`/`overall_recommendation_confidence`.

## Input validation / partial data

Throws `RecommendationError('INVALID_INPUT', …)` for a missing
`diagnosisResult`, a missing `match_id`, or a non-array `skill_gaps`. A
missing/empty `skill_gaps` array and individual malformed entries
(`null`, or an object with no recognizable shape) degrade safely — each
malformed entry becomes one `deferred_recommendations` entry with
`reason: 'INVALID_SKILL_GAP'`, never an undefined-property crash.

## Public API

`prioritizeDiagnosis(diagnosisResult)` — pure function, independently
testable, zero storage access. `prioritizeMatch(matchId, playerId)` —
storage-backed convenience wrapper: `PBDiagnosis.diagnoseMatch(matchId,
playerId)` → `prioritizeDiagnosis(...)`. No new REST route.

## Non-scope (explicitly not implemented here)

Drill selection, repetition/duration/frequency/session prescription,
training calendar, any player-level rating promotion/demotion, any
3.0–5.0 benchmark creation or reinterpretation of priority tiers as a
rating standard, any LLM/ML dependency, any direct call to
`PBPerformanceAnalysis` or `PBStore`, any change to
`js/match-observation-engine.js`, `js/performance-analysis-engine.js`,
or `js/diagnosis-engine.js`.

## Tests

`tests/recommendation-priority-engine.test.js`: input validation, all
five S9-D-producible diagnosis→recommendation mappings plus the
not-yet-producible `TRANSITION_CONTROL_GAP` mapping, unsupported
diagnosis codes (no guessing), missing `priority_signal` (never
defaulted to 0), non-`supported` status handling, all five priority
tier boundaries (70/69.9/40/39.9/0), deduplication with the exact
merge-aggregation worked example from the design freeze, distinct
identity non-merging, all four reason signals individually and combined
(deduplicated), full deterministic ranking (including tie-break order
and stable null handling), no-truncation with 5 simultaneous eligible
recommendations, `top_recommendation_id` presence/absence, partial/
malformed-input safety, deterministic repeated execution, and three
integration flows (A: a real S9-B→S9-C→S9-D→S9-E chain producing an
active recommendation, exercising both `prioritizeDiagnosis` and
`prioritizeMatch`; B: a real low-confidence fixture proving the
downstream block is never bypassed; C: an unsupported-pattern-type
fixture proving no active recommendation is ever produced for it).
Structural checks confirm the source contains no drill/prescription/
dosage/rating-change/LLM reference, no direct `PBStore`/
`PBMatchObservation`/`PBPerformanceAnalysis` reference, no invented
reason-signal vocabulary, and no player-level benchmark literal in
actual code. Full existing regression suite (S1 through S9-D)
re-verified passing alongside it.
