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
  instruction. `pressure_failure` pattern detection separately uses the
  existing `intent === 'pressure'` subset, since that is the closest
  existing field to "under pressure."
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
implements exactly the required V1 set: `low_success_rate`,
`high_error_rate`, `poor_shot_selection`, `repeated_positioning_error`,
`transition_breakdown`, `pressure_failure`, `inconsistency`,
`sequence_breakdown`. Each has one deterministic, documented trigger
rule in `detectPatterns` (source comments), operating only on already-
computed metrics — never a second parallel enum.

`IMPACT_WEIGHTS` is the single centralized config the task spec
requires (§19), used by nothing else:

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
  ≈ 94 (numerically high) alongside `confidence_band: 'LOW'` — verified
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
directly on `PBMatchObservation`'s public API. Full existing regression
suite (S1 through S9-B) re-verified passing alongside it.
