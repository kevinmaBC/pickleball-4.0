# S9-D: Diagnosis / Skill Gap Engine

Implements the **Diagnosis Source of Truth**: consumes S9-C's
`AnalysisSummary` / `PatternCandidate[]` exclusively and answers *"what
Skill Gap does this evidence-supported Performance Pattern represent?"*
**It does not answer what to practice, how long, or what's next in a
lesson** — that remains out of scope for a later stage.

```
S9-C AnalysisSummary (pattern_candidates[])
  -> Evidence Gate (confidence_score >= 40)
  -> Pattern -> Skill Gap mapping (PATTERN_TO_DIAGNOSIS)
  -> Deduplication (player+match+diagnosis_code+skill+context)
  -> Severity/Confidence aggregation (max, never sum)
  -> Priority Signal (0.60*severity + 0.40*confidence)
  -> DiagnosisResult
```

## Hard boundary (unchanged from the design freeze)

- S9-B: Observation Source of Truth. S9-C: Metric/Pattern Source of
  Truth. S9-D: Diagnosis Source of Truth. This file never re-reads raw
  `trial_events`, never recomputes shot/situation/sequence metrics,
  never recomputes pattern thresholds, and never bypasses S9-C. Every
  numeric input (`severity_score`, `confidence_score`, `shot_type`,
  `situation`, `pattern_id`) is read directly off the
  `PatternCandidate` S9-C already produced.
- `js/match-observation-engine.js` and `js/performance-analysis-engine.js`
  are both **untouched** by this stage.

## Pattern → Diagnosis mapping (`PATTERN_TO_DIAGNOSIS`)

Frozen, shot-agnostic diagnosis codes — `skill` (from the pattern's
`shot_type`) carries the specific shot separately, avoiding a
`DROP_EXECUTION_GAP`/`RESET_EXECUTION_GAP`/… enum explosion:

| pattern_type | diagnosis_code | gap_domain | gap_type |
|---|---|---|---|
| `low_success_rate` | `SHOT_EXECUTION_GAP` | `shot_execution` | `execution` |
| `high_error_rate` | `SHOT_CONTROL_GAP` | `shot_execution` | `control` |
| `poor_shot_selection` | `SHOT_SELECTION_GAP` | `shot_selection` | `selection` |
| `inconsistency` | `SHOT_CONSISTENCY_GAP` | `consistency` | `consistency` |
| `transition_breakdown` | `TRANSITION_EXECUTION_GAP` | `transition` | `execution` |

`gap_domain`/`gap_type` design: the code's `_EXECUTION_`/`_CONTROL_`/
`_SELECTION_`/`_CONSISTENCY_` suffix always determines `gap_type`; the
`SHOT_`/`TRANSITION_` prefix determines `gap_domain`, mapped onto the
frozen taxonomy (`shot_execution`, `consistency`, `shot_selection`,
`transition`, `rally_management`, `pressure_recovery`). There is no
separate `shot_control` domain in the taxonomy, so `SHOT_CONTROL_GAP`
lives under `shot_execution` (control is treated as an execution
subtype). `TRANSITION_CONTROL_GAP` remains a valid, documented, but
currently unmapped code for a future stage — no pattern triggers it yet.

**Deliberately excluded from this map:** `repeated_positioning_error`,
`pressure_failure`, `sequence_breakdown` — S9-C's own
`UNSUPPORTED_PATTERN_TYPES` (Semantic Correction V1). Their absence from
`PATTERN_TO_DIAGNOSIS` *is* the "no supported diagnosis" guard, not a
separate check that could be bypassed. Any `PatternCandidate` of one of
these three types is routed straight to `insufficient_evidence` with
`reason: 'UNSUPPORTED_PATTERN'`, regardless of its confidence score
(verified with a confidence=90 fixture in the test suite).

## Evidence Gate (frozen)

`pattern.confidence_score < 40` → never a supported `SkillGap`, routed
to `insufficient_evidence` with `reason: 'LOW_CONFIDENCE'`,
`required_status: 'MEDIUM_OR_HIGH'`. The gate is `< 40`, not `<= 40` —
confidence exactly `40` is eligible (boundary-tested).

`insufficient_evidence[]` entries never silently disappear: every
rejected pattern (unsupported type or low confidence) produces one
entry, `{ pattern_id, reason, confidence_score, required_status }`.

## Severity / Confidence / Priority Signal (frozen formulas)

- Single supporting pattern: `GapSeverity = pattern.severity_score`,
  `GapConfidence = pattern.confidence_score` (both passed through
  unchanged, 0–100 range, never re-derived).
- Multiple patterns merged into one identity: `GapSeverity =
  max(supporting severities)`, `GapConfidence = max(supporting
  confidences)` — **never summed** (a merge of two 65-confidence
  patterns stays 65, not 130 clamped to 100 — proven directly, since a
  naive-sum bug would be indistinguishable from a correct max at the
  clamp boundary).
- `PrioritySignal = 0.60 × Severity + 0.40 × Confidence`, clamped
  `[0, 100]`, recomputed after every merge (never carried over from a
  pre-merge value). This is a signal only — S9-D produces no
  recommendation ranking, no drill selection, no training plan.

## Deduplication

Identity key: `player_id + match_id + diagnosis_code + skill + context`.
Same identity → merge: `evidence_pattern_ids` and `evidence_metric_refs`
are unioned (deduplicated, not concatenated — a repeated `pattern_id`
contributes once), severity/confidence aggregate per above, and
`priority_signal` is recomputed from the merged values. Different
`skill` (e.g. `drop` vs `dink`) or different `context` never merges,
even under the same `diagnosis_code`.

## Context / Skill mapping

`skill ← pattern.shot_type` (null when the pattern has no shot_type,
e.g. `transition_breakdown`). `context ← pattern.situation` (null for
shot-level patterns, which S9-C never sets `situation` on). Neither is
ever invented — no `third_shot`/`under_pressure`/`positioning` label is
fabricated when the upstream field is absent.

## Traceability

`evidence_pattern_ids`: the contributing `PatternCandidate.pattern_id`
values only — never a copy of the candidate payload.
`evidence_metric_refs`: a lightweight string reference derived from the
pattern's own `category`/`shot_type`/`situation` (e.g.
`'shot_metrics:drop'`, `'sequence_metrics:transition'`), pointing at
which S9-C metric bucket backs the diagnosis — never a copy of the
metric object.

## DiagnosisSummary / diagnosis_confidence

`diagnoseAnalysis(analysisSummary)` returns:

```js
{
  match_id, player_id,
  data_status,           // inherited verbatim from analysisSummary.data_status — never redefined
  skill_gaps: [],
  insufficient_evidence: [],
  diagnosis_confidence,  // null if skill_gaps.length === 0 (never 0); else average(skill_gap.confidence_score), 0-100
  diagnosis_version: 'S9-D-V1'
}
```

## Input validation / partial data

Throws `DiagnosisError('INVALID_INPUT', …)` for a missing
`analysisSummary`, a missing `match_id`, or a non-array
`pattern_candidates`. A missing/empty `pattern_candidates` array, any
`data_status` value, and individual malformed candidate entries
(`null`, or an object with no `pattern_type`) all degrade safely — they
are skipped or produce an empty result, never a crash from an
undefined-property access.

## Public API

`diagnoseAnalysis(analysisSummary)` — pure function, independently
testable, no storage access. `diagnoseMatch(matchId, playerId)` —
storage-backed convenience wrapper: `PBPerformanceAnalysis.analyzeMatch(matchId,
playerId)` → `diagnoseAnalysis(...)`. No new REST route.

## Non-scope (explicitly not implemented here)

Root-cause fabrication (paddle angle, grip, swing path, late contact,
mental, footwork, positioning) beyond execution/control/selection/
consistency/transition; any recommendation, drill mapping, or training
plan; any player-level rating promotion/demotion; any 3.0–5.0 benchmark
creation or reinterpretation of S9-C's `PATTERN_THRESHOLDS` as a rating
standard; any LLM/ML dependency; any change to
`js/match-observation-engine.js` or `js/performance-analysis-engine.js`.

## Tests

`tests/diagnosis-engine.test.js`: input validation, all five active
pattern→diagnosis mappings, the three S9-C-unsupported pattern types
(confirmed to produce no supported diagnosis even at confidence=90),
the evidence-gate boundary (39 vs 40), deduplication (merge + evidence
ID dedup + max aggregation, and confirmation that a different
skill/context does *not* merge), the exact Priority Signal formula plus
its clamp, `diagnosis_confidence` null-vs-average, `data_status`
inheritance, partial/malformed-input safety, deterministic repeated
execution, and three integration flows (A: a real S9-B→S9-C→S9-D
supported-gap fixture, exercising both `diagnoseAnalysis` and
`diagnoseMatch`; B: a real 3-rally low-confidence fixture proving the
evidence gate end-to-end; C: an unsupported-pattern-type fixture).
Structural checks confirm the source contains no recommendation/drill/
prescription/rating-change/LLM reference and no root-cause-fabrication
phrase or player-level benchmark literal in actual code. Full existing
regression suite (S1 through S9-C) re-verified passing alongside it.
