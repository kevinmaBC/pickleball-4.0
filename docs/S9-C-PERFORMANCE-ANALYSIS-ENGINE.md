# S9-C: Performance Analysis & Pattern Detection Engine

Implements a **measurement layer** that turns S9-B's structured ASMT-10
rally observations into match/shot/situation/sequence metrics and
deterministic pattern candidates. **It is not a diagnosis or
recommendation engine** — no strength/weakness interpretation, no
coaching summary, no training prescription. Those are explicitly
deferred to a later stage.

```
S9-B trial_events (1 trial_event = 1 rally)
  -> calculateMatchMetrics / calculateShotMetrics / calculateSituationMetrics / calculateSequenceMetrics
  -> detectPatterns (minimum-sample rule -> severity -> confidence -> evidence)
  -> AnalysisSummary
```

No new IndexedDB store, no schema change, no modification to
`js/match-observation-engine.js` — this module only reads
`test_sessions`/`trial_events` via the existing `PBStore` API and calls
`PBMatchObservation.getObservationCompleteness()` (public, read-only) to
reuse S9-B's single authoritative sample-completeness determination
rather than recomputing it.

## Field mapping notes (documented substitutions, not inventions)

- **"shot_type"** (S9-C vocabulary) maps directly to S9-B's existing
  `shot` field — no new vocabulary was added.
- **Situation** uses the existing `phase` field (`serve, return, third,
  transition, nvz, defense, finish`) as the grouping dimension. The
  spec's suggested category names (`offense`/`neutral`/`baseline`/
  `under_pressure`) have no directly coded equivalent in the frozen S9-B
  rally schema, so the real existing dimension is used instead of a
  fabricated one, per the task's own "if not existing, don't invent"
  instruction. (`intent === 'pressure'` was initially used as a
  `pressure_failure` proxy for "under pressure"; this was removed in the
  Semantic Correction V1 pass below — `intent==='pressure'` means the
  player *intends to pressure the opponent*, not that the player is
  under pressure themselves. It is a different concept.)
- **Points won/lost**: `result` values `winner`, `forced_error_created`,
  `opponent_ue`, `attack_converted` count as points won; `ue`,
  `transition_lost` count as points lost. `continue`/`weak_reply` are
  non-terminal at rally-level granularity (1 trial_event = 1 rally, not
  1 shot) and are excluded from won/lost — `total_points` still counts
  every rally.
- **Rally length** (`rally_length_average`, `short/medium/long_rally_rate`)
  is always `null`. The frozen S9-B rally schema has no shot-count-per-rally
  field at all — a rally is one record, not a list of shots — so this
  cannot be computed without fabricating data. Documented, not silently
  dropped.
- **`third_to_fifth_continuation`** sequence metric is always
  `attempts: null, continuation_rate: null` for the same structural
  reason: it requires knowing whether a rally's 3rd shot was followed by
  a 5th shot *within that same rally*, which needs intra-rally
  shot-sequence data S9-B does not capture.
- **`nvz_arrival`** sequence metric is likewise always
  `attempts: null, arrival_rate: null` as of the Semantic Correction V1
  pass — `phase === 'nvz'` alone does not reliably prove baseline/
  transition → *successful arrival* at the NVZ; that requires
  intra-rally progression data S9-B does not capture.
- Sequences with no reliable computation path at all (NVZ Exchange,
  Speed-up→Counter, Defense→Reset, Reset→Kitchen Recovery) are omitted
  from `sequence_metrics` entirely rather than emitted as fabricated
  placeholders — only the task spec's "优先输出" (priority) six values
  are ever produced.

## Zero / null rule

`pct(numerator, denominator)` returns `null` whenever the denominator is
falsy — never `NaN`, never `Infinity`. Every rate field in every metric
and pattern candidate routes through this one function. Verified with a
recursive NaN/Infinity scanner run over full metric and pattern-candidate
output in the test suite.

## Pattern types and Impact Weight

Reuses no existing pattern/severity system (none existed in the repo —
confirmed by repo-wide search before implementation). `PATTERN_TYPES`
implements exactly the required V1 vocabulary: `low_success_rate`,
`high_error_rate`, `poor_shot_selection`, `repeated_positioning_error`,
`transition_breakdown`, `pressure_failure`, `inconsistency`,
`sequence_breakdown`.

### Semantic Correction V1 (GPT independent QA on commit `f19d73b`)

Three of the eight vocabulary entries have **no active trigger rule** as
of this pass. Their original V1 proxies were reviewed and judged to
over-claim what the underlying S9-B field actually proves, and were
removed rather than left in place. The pattern type stays in
`PATTERN_TYPES` (selectable, valid) and in `IMPACT_WEIGHTS` (ready the
moment a genuine rule exists); `detectPatterns()` simply never emits it
today. Each reason is also captured verbatim in the exported
`UNSUPPORTED_PATTERN_TYPES` map:

| pattern_type | why it was removed |
|---|---|
| `pressure_failure` | Its proxy was `intent === 'pressure'` — but that field means the player *intends to pressure the opponent*, not that the player is under pressure. No direct S9-B field represents "player is in a defensive/disadvantaged state" at this layer. Left unsupported rather than mislabeled. |
| `repeated_positioning_error` | Its proxy was a phase's error rate — but a high UE/error rate in a phase does not by itself prove a *positioning* error (could equally be shot selection, execution, or pressure). Left unsupported until a later frozen rule explicitly maps S9-B movement evidence to positioning. |
| `sequence_breakdown` | Its only V1 trigger was the `nvz_arrival` proxy below, itself removed for the same reason. No other S9-B-backed trigger exists yet. |

The five remaining pattern types (`low_success_rate`, `high_error_rate`,
`poor_shot_selection`, `inconsistency`, `transition_breakdown`) were
**not** flagged by QA and are unchanged — each still has one
deterministic, documented trigger rule in `detectPatterns` (source
comments), operating only on already-computed metrics.

### Pattern trigger thresholds (`PATTERN_THRESHOLDS`)

Previously scattered as inline magic numbers (`< 50`, `> 30`, `< 10`,
…); centralized in this pass into one config object per GPT QA
correction #4:

```js
PATTERN_THRESHOLDS = {
  LOW_SUCCESS_RATE_MAX: 50,
  HIGH_ERROR_RATE_MIN: 30,
  POOR_SHOT_SELECTION_WINNER_RATE_MAX: 10,
  POOR_SHOT_SELECTION_ERROR_RATE_MIN: 20,
  INCONSISTENCY_MIN: 40,
  INCONSISTENCY_MAX: 60,
  TRANSITION_BREAKDOWN_SURVIVAL_MAX: 50
}
```

**These are S9-C V1 provisional pattern-detection thresholds for this
measurement layer only.** They are explicitly **not** 3.0/3.5/4.0/4.5/5.0
player-level benchmarks, **not** Master Control V2 Hard Gate thresholds,
and **not** rating standards of any kind — no player-level benchmark
logic reads or references this config, and the test suite asserts none
of its keys resemble a validated-level identifier.

`IMPACT_WEIGHTS` is the single centralized config the task spec
requires (§19), used by nothing else, unchanged by this pass and kept
complete for all 8 vocabulary entries:

| pattern_type | impact_weight | rationale |
|---|---|---|
| `transition_breakdown` | 0.90 | point-ending / critical structural failure |
| `pressure_failure` | 0.80 | high-leverage situational failure |
| `sequence_breakdown` | 0.75 | rally plan breaks down before reaching the front |
| `high_error_rate` | 0.70 | directly and repeatedly costs points |
| `poor_shot_selection` | 0.65 | |
| `repeated_positioning_error` | 0.60 | |
| `low_success_rate` | 0.50 | ordinary execution miss |
| `inconsistency` | 0.45 | |

## Minimum sample rule, severity, confidence (frozen formulas)

- `sample_size <= 2` → no `PatternCandidate` is ever built (not
  "insufficient" — simply absent).
- `BaseSampleConfidence`: 0–2→0.00, 3–5→0.35, 6–10→0.65, 11+→0.90.
- `DataCompletenessFactor` = present/expected ratio over the fields a
  given computation actually reads (`dataCompleteness`). Under S9-B's
  own validation guarantees (core fields are always non-null), this
  evaluates to `1.0` for every V1 pattern rule, since all of them read
  only core fields — this is documented as the honest consequence of
  S9-B's guarantees, not a hardcoded constant (the function genuinely
  computes a ratio; unit tests exercise it directly with synthetic
  partial rows to prove it, since no real S9-B-validated row is ever
  actually incomplete on a core field).
- `ConfidenceScore = BaseSampleConfidence × DataCompletenessFactor × 100`,
  clamped to `[0, 100]`. Band: 0–39 LOW, 40–69 MEDIUM, 70–100 HIGH.
- `Severity = 100 × (0.50×FailureRate + 0.30×min(sample_size/10,1) +
  0.20×ImpactWeight)`, clamped to `[0, 100]`.
- **Severity and Confidence never share a formula or derive from one
  another.** A 3-sample, 100%-error shot type produces `severity_score`
  = 73 (numerically high, `>= 70`) alongside `confidence_band: 'LOW'` — verified
  directly in the test suite (AC-08).

## Evidence

Every `PatternCandidate.evidence` is an array of `trial_event_id`
strings (the rallies backing that pattern), never a copy of the
observation payload.

## AnalysisSummary / data_status

`analyzeMatch(session_id, player_id)` validates the session (must
canonicalize to `ASMT-10`) and that it belongs to `player_id` (via the
session's `assessment_id` → `assessment.player_id`), then returns:

```js
{
  match_id, player_id, data_status,   // 'complete' | 'partial' | 'insufficient'
  overall, shot_metrics, situation_metrics, sequence_metrics,
  pattern_candidates, analysis_confidence
}
```

`data_status`: `'insufficient'` when zero rallies exist; `'complete'`
when `PBMatchObservation.getObservationCompleteness()` reports
`sample_complete === true`; `'partial'` otherwise (covers both
below-target and unknown-tier cases). `analysis_confidence` reuses the
identical frozen confidence formula at the whole-match level
(`rallies_observed` as the sample size) rather than inventing a second
formula.

## Non-scope (explicitly not implemented here)

Diagnosis, strength/weakness interpretation, coaching summary,
natural-language explanation, training recommendation/prescription, any
Strength Engine, any LLM/ML dependency, any REST route, any change to
`match_validation_state`/`validated_training_level`/CAP/Hard Gate logic,
any modification to `js/match-observation-engine.js`.

## Tests

`tests/performance-analysis-engine.test.js`: pure-function unit tests
for every metric calculator (match/shot/situation/sequence), zero-
denominator/null behavior, partial-data (unknown `shot`) handling,
minimum-sample boundaries (2/3/5/6/10/11), confidence scoring + clamp,
severity scoring + clamp, severity-independent-of-confidence, pattern
classification, evidence references, deterministic repeated execution,
a full NaN/Infinity scan, and three integration flows (Observation →
Metrics, Observation → Pattern Candidate, Match → AnalysisSummary) built
directly on `PBMatchObservation`'s public API.

Semantic Correction V1 adds four dedicated tests: `intent==='pressure'`
(even at 100% error rate) never produces `pressure_failure`; phase-level
error rate alone never produces `repeated_positioning_error` (while
confirming `calculateSituationMetrics` itself still measures it
correctly); `nvz_arrival` is unavailable/null and never triggers
`sequence_breakdown`; and `PATTERN_THRESHOLDS` is proven to be the
actual live config the detector reads (a boundary-value behavioral
test, not just a shape check), with a structural check that no
threshold key resembles a player-level benchmark.

Full existing regression suite (S1 through S9-B) re-verified passing
alongside it.
