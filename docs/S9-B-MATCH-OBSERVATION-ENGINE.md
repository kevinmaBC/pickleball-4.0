# S9-B: Match Observation Engine

Implements the Match Observation Engine: a **measurement layer** that
converts real-match rally observations into structured ASMT-10 rally
records, sample completeness, and descriptive Full-T10 metrics. **It is
not a Match Validation decision layer** — it never computes or persists
`MET`/`NOT_MET`/`match_validation_state`, `validated_training_level`,
CAP, or Hard Gate pass/fail. Those remain, respectively, a future S9-C
and the existing, unmodified `js/review-engine.js`.

```
REAL MATCH
  -> ASMT-10 Match Observation Session (test_sessions, feed_mode=live_match)
  -> Game grouping (game_number)
  -> Rally observations (trial_events, 1 trial_event = 1 rally)
  -> Descriptive Match Metrics (computeMatchMetrics)
  -> [S9-C, future] evaluates Match Validation
```

## Canonical protocol

`ASMT-10` (full T10) is the sole canonical Match Observation protocol.
`T10` remains a legacy alias resolved through the existing
`js/namespace.js` mechanism (`PBNamespace.toCanonical`/`toLegacy`) — no
second namespace (`MATCH-xx`/`MTV-xx`) was introduced.

## 1 trial_event = 1 rally

Frozen from S9-A, reaffirmed here: one `trial_events` record represents
one observed rally, never one shot. `addRallyObservation(session_id,
raw)` creates exactly one `trial_events` record per call, via the
existing `PBStore.addTrialEvent()` — no second persistence layer, no new
store, no `DB_VERSION` bump.

## Match Context

`PBStore.createMatchObservationSession()` (S9-A) now accepts an optional
`match_context` object, persisted as a plain nested field on the
`test_sessions` record (the same "nested object on an existing record"
convention already used elsewhere in this codebase) — no schema change,
no new store/index:

```js
match_context: {
  match_type,      // REC | LEAGUE | TOURNAMENT | PRACTICE_MATCH (optional)
  format,          // DOUBLES | SINGLES (optional)
  observer_role,   // SELF | COACH | ANALYST (optional; one session = one primary observer)
  opponent_level,  // optional contextual metadata, never a weighting input
  partner_level,   // optional contextual metadata, never a weighting input
  event_name,      // optional
  match_date,      // YYYY-MM-DD (optional)
  match_result     // optional { result: 'WIN'|'LOSS', ... } — contextual only, see below
}
```

`js/match-observation-engine.js`'s `createMatchSession(opts)` validates
this object (`validateMatchContext`) before delegating to the storage
helper; `js/storage.js` itself stays a dumb pass-through, consistent
with how it already delegates all enum/domain validation for match
data to its callers. `getMatchContext(session_id)` reads it back.

**Win/Loss isolation (frozen):** `match_result` may be stored for future
pressure-context analysis, but `computeMatchMetrics()` never reads
`match_context` at all — verified structurally (`tests/match-observation-engine.test.js`
extracts the `computeMatchMetrics` function body and asserts it contains
neither `match_result` nor `match_context`) and behaviorally (two
otherwise-identical sessions tagged `WIN` and `LOSS` produce identical
metrics). `WIN != Match Validation MET`, `LOSS != Match Validation
NOT_MET` — S9-B doesn't implement Match Validation at all, so there is
nothing for a result to shortcut.

## Observer provenance

S9-B v1: one Match Observation Session has one primary
`observer_role` (`SELF | COACH | ANALYST`), recorded on the session's
`match_context`. No multi-observer adjudication. Observer role is
**provenance only** — it is never automatically mapped to an Evidence
Confidence rank (C1–C4); that ranking remains entirely outside S9-B,
owned exclusively by `js/review-engine.js`'s `determineEvidenceConfidence`.

## Rally fields

Core fields (required, enum-validated against the frozen
`schemas/rally_event_schema_v2_3_1.json`, reused verbatim — no renamed
or invented parallel fields): `phase`, `intent`, `shot`, `target`,
`quality`, `movement`, `result`, `control_state`.

Conditional fields: `pattern_id` (string or null), `adaptation_opportunity`
/ `adaptation_success` (boolean or null), `neutralize_opportunity` /
`neutralize_success` (boolean or null). Missing conditional data stays
`null` — never coerced to `false`/`0`.

Conditional validation (`validateObservation`, §8 of the task spec):
`adaptation_success` cannot be `true` unless `adaptation_opportunity`
is exactly `true`; same rule for `neutralize_success` /
`neutralize_opportunity`. Rejected with `INVALID_OBSERVATION`.

## Rally identity / duplicate protection

Each rally requires `game_number` and `rally_number` (positive
integers, ≥1) and optional `player_score_before`/`opponent_score_before`
(non-negative integers, context only — never a pressure-weighting
input). Within one session, `(game_number, rally_number)` must be
logically unique; `addRallyObservation` checks this at the engine level
by scanning the session's existing `trial_events` before insert (no
compound IndexedDB index — consistent with how S8-A's
`cycle_week_key` denormalized-field pattern already avoids needing one)
and rejects a repeat with `DUPLICATE_RALLY`. No silent overwrite.

Observation correction (in-place update of an existing rally) was
evaluated and **deferred**, not implemented: `js/storage.js` has no
generic `updateTrialEvent` helper today, and adding one was judged to
exceed "a small helper" once duplicate-safe semantics were considered
(what happens to `trial_no` ordering, whether the duplicate check must
exclude the record being corrected, etc.). Per §12 of the task spec,
this is documented/deferred rather than used to justify a storage
redesign.

## Sample completeness

`SAMPLE_PLAN` in `js/match-observation-engine.js` mirrors
`data/test_definitions_v2_3_1.json`'s `T10.sample_plan` exactly (lite:
1 game/20 rallies, standard: 3 games/60 rallies, full: 5 games/100
rallies) — no new thresholds invented, guarded by a regression assertion
comparing the two directly. `getObservationCompleteness(session_id)`
returns `games_observed`, `rallies_observed`, `sample_target` (looked up
by the session's `assessment_tier`), and `sample_complete` (boolean —
minimum quantity satisfied — or `null` when the tier itself is unknown,
never guessed). **`sample_complete` means only "enough data was
recorded." It never means Match Validation `MET`.**

## Descriptive Full-T10 metrics

`computeMatchMetrics(session_id)` computes the nine T10 descriptive
metrics from `data/test_definitions_v2_3_1.json`'s `T10.metrics`. It
deliberately does **not** compute `match_transfer_score` — that spec
entry's formula (`validation_index_from_match_metrics`) is an unwired
placeholder explicitly marked "not linearly added into capability score
in V2.3.1," and turning it into a real, frozen formula is out of scope
for S9-B (deferred to S9-C design).

None of the nine formulas has a machine-unambiguous mapping onto the
frozen rally enum set without a documented interpretation layer (the
task spec explicitly anticipates this: "implement the narrowest
repository-consistent mapping and document it"). The mapping used,
metric by metric:

| Metric | Denominator | Numerator |
|---|---|---|
| `match_decision_pct` | every observed rally (`quality` is always coded) | `quality` in `{good, neutral}` |
| `match_transition_pct` | `phase === 'transition'` | `result` not in `{transition_lost, ue}` |
| `ue_per_game` | `games_observed` (distinct `game_number`) | count of `result === 'ue'` |
| `attack_conversion_pct` | `intent === 'attack'` | `result === 'attack_converted'` |
| `pattern_success_pct` | `pattern_id != null` | `quality === 'good'` |
| `wrong_attack_pct` | `intent === 'attack'` (same population as attack_conversion) | `quality` in `{error, pop_up}` |
| `rally_control_pct` | `phase` in `{third, transition, nvz, defense, finish}` (reaches ≥ third-shot) | `control_state` in `{pressure, attack}` |
| `pattern_adaptation_pct` | `adaptation_opportunity === true` | `adaptation_success === true` |
| `neutralize_under_pressure_pct` | `neutralize_opportunity === true` | `neutralize_success === true` |

`rally_control_pct` is the one metric whose frozen definition
("achieves and maintains state for ≥2 consecutive opponent contacts")
cannot be proven at rally-level granularity — S9-B's unit is 1 rally,
not 1 shot, so within-rally contact counts don't exist. Per the task
spec's explicit instruction, this does **not** fabricate that count; it
uses only the observer's own explicit `control_state` coding for the
rally as the deterministic proxy, and is documented here as exactly
that — a proxy, not the literal contact-count definition.

**No-opportunity rule (frozen):** whenever a metric's denominator is
zero, the result is `null`, never `0`. Verified for every metric with a
dedicated test case (0 attack opportunities, 0 pattern attempts, 0
adaptation/neutralize opportunities, 0 transition-phase rallies, 0
eligible-for-control rallies).

Win/loss/legacy T10-lite aggregate scores are never inputs to any of
these formulas — every numerator/denominator above reads only explicit
rally-level fields.

## Legacy T10-lite backward compatibility

`js/assessment.js` (`renderMatch()`/`saveMatch()`) and
`assessments.match_transfer`/`assessments.ue` are completely untouched.
S9-B never reads or writes them. A regression test creates a legacy
T10-lite `match_transfer` record on an assessment, then independently
creates a real ASMT-10 Match Observation session with 20 rallies on the
**same** assessment, and asserts the legacy record's fields are
byte-identical afterward. `js/metrics.js`'s existing `computeAssessment()`
(which loops over every `test_sessions` record grouped by `test_id`,
including any `ASMT-10` sessions that now exist) is left unmodified;
because S9-B always persists `outcome: null` and `score_weight: null`
on match `trial_events` (S/P/F/I ball-quality scoring does not apply to
Full-T10 rally coding, which uses the `result` enum instead), any
incidental per-test entry that generic loop produces for `ASMT-10`
carries `quality_pct: null` and `sample_complete: null` — inert, never a
fabricated number.

## Master Control safety (frozen, verified)

- No `match_validation_state`/`MET`/`NOT_MET` assignment anywhere in
  the engine (regression-guarded).
- No `validated_training_level` write.
- No CAP read or mutation (`CAP_WEIGHTS` never referenced).
- No Hard Gate pass/fail output (`ue_per_game` is produced as a
  descriptive number only; comparing it against a level's threshold
  remains exclusively `js/review-engine.js`'s job).
- No automatic Evidence Confidence (C1–C4, no C0) assignment.
- `data/level_gates_v2_3_1.json`'s 4.0 threshold (`70`) and 4.5/5.0
  provisional status are untouched and re-verified by this stage's
  tests.
- Deterministic: `computeMatchMetrics()` is a pure function of
  persisted `trial_events`; no LLM, randomness, or external calls.

## Non-scope (explicitly not implemented here)

S9-C Match Validation Engine; `MET`/`NOT_MET` decision; a Full-T10
`match_transfer_score` formula; 4.5/5.0 Match Validation thresholds;
Hard Gate evaluation; Validated Level calculation/promotion; Compete UI;
Match Review UI; video capture/tagging/AI vision; multi-observer
adjudication; a new CAP methodology; a new evidence class; a new
IndexedDB store; a `DB_VERSION` bump.

## Tests

`tests/match-observation-engine.test.js` — session acceptance/rejection
(ASMT-10 required, `live_match` required), rally persistence (1
trial_event = 1 rally), duplicate rejection, conditional-field
validation, observer provenance, no C1–C4/no Match Validation/no CAP/no
Hard Gate output, sample-boundary tests at lite/standard/full plus
below-boundary and unknown-tier cases, deterministic metric formulas
with a hand-computed fixture, no-denominator-returns-null for every
applicable metric, Win/Loss isolation (structural + behavioral), and
legacy T10-lite non-interference. Full existing regression suite
(`tests/*.test.js`, S1 through S9-A) re-verified passing alongside it.
