# S10-E-R1: Baseline Resolution + Progress/Reassessment Architecture Unblock

Follow-up to the S10-E BLOCKED audit (`08de42a`). GPT reviewed that
audit and made a controlled architecture decision to unblock the
stage: an immutable Cycle KPI Baseline Snapshot captured only from
accepted **pre-cycle** evidence with exact KPI compatibility, an
additive `DB_VERSION` 4 → 5 migration with two new stores, and a
reassessment loop that only ever runs against a real S9-compatible
Match Observation session. This document records exactly what was
built and why, per the frozen R1 architecture decision.

## Baseline

- Branch: `app-v2-alpha`
- Starting HEAD (verified at start): `08de42a` /
  `08de42a9819e205a2650b4b6267341aeafb5ebf3` (S10-E blocked audit)
- Working tree at start: clean

## Why the original S10-E blocked

`docs/S10-E-PROGRESS-REASSESSMENT.md` found no existing accepted data
path resolving `development_cycle.baseline_ref` into a
`kpi_profile_code`-keyed numeric baseline, and explicitly named the two
obvious fallbacks ("first training evidence", "latest training
evidence") as forbidden silent substitutions. GPT's R1 decision doesn't
overturn that finding — it resolves it architecturally: baseline is no
longer derived from `baseline_ref` at all. It is captured directly from
whatever compatible evidence already exists **before** cycle training
began, for the exact `kpi_profile_code`(s) the cycle cares about, and
persisted once, immutably. `baseline_ref` remains on the
`development_cycle` as the cycle's own reference to its originating
assessment (S10-A's existing contract, untouched); it is simply no
longer the source the numeric KPI baseline is resolved through.

## DB_VERSION 4 → 5 (additive only)

Two new stores, following the exact same additive mechanism every
prior version bump has used (`js/storage.js`'s `open()` only ever
creates a store when `!db.objectStoreNames.contains(name)`):

| Store | keyPath | Indexes |
|---|---|---|
| `cycle_kpi_baselines` | `baseline_id` | `by_cycle`, `by_player` |
| `reassessments` | `reassessment_id` | `by_cycle`, `by_player`, `by_status` |

No existing store's `keyPath`, indexes, or records are touched.
`tests/storage.test.js` (extended, not rewritten) and
`tests/progress-reassessment-persistence.test.js` both independently
prove a v3-seeded and a v4-seeded database upgrade to v5 with their
existing records byte-identical. `tests/s9-a-match-architecture.test.js`
had its two hardcoded baseline-version assertions updated (4→5,
16→18 stores) exactly as it was updated for every prior bump — S9-A
itself still adds zero stores.

## Cycle KPI Baseline Snapshot (`js/cycle-baseline-engine.js`, `PBCycleBaseline`)

`captureBaselineSnapshot({ cycle_id, player_id, kpi_profile_codes,
captured_at, evidence })` is pure — it never queries storage, never
depends on any other engine. For each requested `kpi_profile_code`, and
independently for the `TRAINING` and `MATCH` tracks (Rule 4: tracks
never share one baseline), it filters the supplied `evidence` array to
records that are: the correct `source`, an **exact** `kpi` match (never
`technical_score`/`capability_score`/hard-gate `*_pct` or any other
S7/S8 vocabulary — §12), the correct `player_id`, and **strictly before**
`captured_at` (Rule 2 — evidence at or after the cutoff never
contributes). Among the qualifying records, the baseline value is the
**latest** one (by timestamp, `evidence_id` as a deterministic
tie-breaker) — the same "latest valid value" methodology
`js/trend-engine.js` (S7-C, accepted) already uses for its own
`current` selection, applied here to the pre-cutoff window instead of
the in-cycle window; never mean/median/weighted-mean/EMA. No compatible
evidence → `status: 'UNRESOLVED'`, `value: null`, `evidence_refs: []` —
never fabricated.

One baseline record per cycle (`baseline_id: 'cb:' + cycle_id`),
covering every `kpi_profile_code` requested at capture time, matching
the frozen §6 shape.

## Progress Snapshot (`js/progress-tracking-engine.js`, `PBProgressTracking`)

`computeProgressSnapshot({ cycle_id, player_id, kpi_profile_code,
source, baseline_entry, in_cycle_evidence, window_start, target })` is
pure, called once per `(cycle, kpi, source)` pair — `TRAINING` and
`MATCH` are always computed independently and never combined into one
number (Rule 4).

- **Current value**: the latest valid evidence at or after
  `window_start` (baseline's own `captured_at`) — again "latest value",
  never an average.
- **Minimum trend rule**: a resolved baseline **and** at least one
  qualifying in-cycle evidence point (two points total) — anything less
  is `trend: 'INSUFFICIENT_DATA'`, never a guessed direction.
- **Delta math**: `absolute_delta = current - baseline`,
  `percentage_point_delta = absolute_delta * 100`,
  `relative_change = absolute_delta / baseline` — `null` (never a
  divide-by-zero shortcut) when `baseline_value === 0`. Verified against
  the frozen `0.58 → 0.71` example exactly: `absolute_delta: 0.13`,
  `percentage_point_delta: 13`, `relative_change: 0.2241`.
- **Trend**: `absolute_delta > 0 → IMPROVING`, `< 0 → DECLINING`,
  `=== 0 → STABLE` — no band/tolerance, since KPI values are 0-1 ratios,
  not `js/trend-engine.js`'s 0-100 CAP-score scale (that file's own
  `TREND_BAND = 5` is documented as applying only to "0-100 metrics";
  its own fallback for other scales is `band = 0`, which is what's
  reused here).
- **Target status**: `UNRESOLVED` whenever no accepted numeric target
  is supplied or upstream reports `BENCHMARK_NOT_RESOLVED` — never an
  invented benchmark. `BELOW_TARGET`/`AT_TARGET`/`ABOVE_TARGET` only
  when a real target value is given.

`matchTransferStatus(trainingSnapshot, matchSnapshot)` derives a
presentation-safe label (e.g. `TRAINING_IMPROVING_MATCH_UNCONFIRMED`)
purely from the two independent snapshots' `trend` fields — it never
resolves a recommendation, promotes a level, or alters priority.

## Reassessment (`js/reassessment-engine.js`, `PBReassessment` — pure; `js/progress-reassessment-persistence.js` — orchestrator)

`checkReassessmentEligibility(development_cycle, opts)` reads
`development_cycle.state === 'REASSESSMENT_READY'` as the strongest
source of truth (§24) plus the presence of `opts.real_match_session_id`
— it never recomputes or second-guesses S10-A's own state.
`reassessmentIdentity(cycle_id, match_session_id)` is deterministic
(`'re:' + cycle_id + ':' + match_session_id`, never random).
`compareRecommendations(previous, next)` identifies recommendation
lineage by `recommendation_code + skill + context` (the `match_id`
necessarily differs between the old and new match, so raw
`recommendation_id`s can never line up across a reassessment) and
classifies each as `UNCHANGED`/`NEW`/`RESOLVED`/`REPRIORITIZED` —
`REPRIORITIZED` only when the same identity's `rank`/`priority_score`/
`priority_tier` differ, never a recomputed priority. All three
functions have zero dependency on any other engine (test suites prove
this structurally).

`js/progress-reassessment-persistence.js`'s `runReassessmentDurable`
is the only file in this R1 with a legitimate dependency on the real S9
public pipeline — `PBDiagnosis.diagnoseMatch(real_match_session_id,
player_id) → PBRecommendationPriority.prioritizeDiagnosis(...) →
PBTrainingPrescription.prescribeRecommendations(...)`, exactly the same
three calls `js/review-ui.js`'s S10-B-R1 orchestration already uses. It
never transforms TRAINING evidence into a Match Observation input and
never constructs a `trial_events` record — it only ever reads a real,
pre-existing `test_sessions` record via `PBStore.get('test_sessions',
...)` (proven structurally: the file contains that exact read call and
never `createMatchSession`/`createMatchObservationSession`), and
verifies that session's owning assessment actually belongs to the
caller-asserted `player_id` before proceeding (`PLAYER_MISMATCH`
otherwise — never trusting the caller over the real data).

Idempotency: before calling S9 at all, the orchestrator checks
`PBStore.getReassessment(identity)` — an existing completed record is
reused verbatim (same `reassessment_id`, same `created_at`), so a
second identical call, including after a genuine reload, never invokes
S9 again and never creates a second recommendation/prescription chain.

## Supersession & cycle completion (§28-29)

`supersedePrescriptionWorkflowDurable(oldWorkflow, newPrescriptionOpts)`
is a thin wrapper: it calls S10-C's own already-accepted
`PBPrescriptionWorkflow.supersede()` verbatim and persists both the
`SUPERSEDED` old workflow and the fresh `DRAFTED` new one — no new
supersession logic is implemented, and the old workflow's history
(`prescription_ref`, `activated_at`, etc.) is never touched, only its
`state`/`superseded_by`.

`completeCycleDurable(development_cycle)` calls S10-A's own
`PBWorkflow.transition(cycle, 'COMPLETE_CYCLE', {})` verbatim. Per
§29's own escape hatch, this documents rather than works around a real
boundary: S10-A's contract only allows `COMPLETE_CYCLE` from
`PROGRESS_RECORDED`, not from the `RECOMMENDATION_READY` state a cycle
is typically in immediately after a reassessment loop — reaching
`PROGRESS_RECORDED` requires the cycle to run back through
`PRESCRIPTION_READY → TRAINING_ACTIVE → SESSION_COMPLETED →
PROGRESS_RECORDED` with the new prescription first. This R1 does not
invent a shortcut around that; the test suite proves the existing
transition is invoked correctly and rejects exactly when S10-A's own
contract says it should.

## No durable MATCH evidence source (documented gap, not glossed over)

`js/storage.js`'s `training_evidence` store only ever holds `source:
'TRAINING'` records — that is S10-D's own hard invariant. No store in
this repository durably persists a generic `MATCH`-source Evidence
record tied to `kpi_profile_code`. Every function here that needs
MATCH-track evidence (`captureBaselineDurable`,
`getCurrentProgressDurable`) accepts an optional caller-supplied
`match_evidence` array rather than querying a store that doesn't exist.
In practice today, the MATCH track will resolve `UNRESOLVED` unless a
future stage adds a durable MATCH evidence source — this is exactly the
honest, non-fabricated outcome §9's "no compatible evidence → UNRESOLVED"
rule requires, not a shortcut.

## Tests

- `tests/cycle-baseline-engine.test.js` — pure baseline engine (§39
  items 8-14, 17, plus determinism and architecture protection).
- `tests/progress-tracking-engine.test.js` — pure progress engine
  (items 18-32, plus determinism and architecture protection).
- `tests/reassessment-engine.test.js` — pure gate/identity/comparison
  (items 33 (gate slice), 40, 44-47, plus determinism and architecture
  protection).
- `tests/progress-reassessment-persistence.test.js` — schema/migration
  (1-7), durable baseline capture/immutability/reload (15-17), durable
  progress computation, the full real-Match reassessment flow including
  a real S9 pipeline call via the exact fixture
  `tests/s9-full-system-qa.test.js`'s own FA-06 happy path uses (items
  33-38), cross-reload idempotency (40-43), supersession (48-49), the
  cycle-completion boundary (29), and architecture-protection structural
  scans (35, 39, 50-54) — plus spawns the seven most directly-relevant
  accepted suites as child processes to prove they still pass
  unmodified.

Full regression: `node tests/*.test.js` — see commit report for the
exact suite count. No existing test's assertions were weakened; only
version-baseline numbers were updated where the codebase's own
established convention already requires it at every DB version bump.

## Acceptance criteria self-check (not final acceptance — GPT owns that)

| # | Criterion | Status |
|---|---|---|
| 1 | Original 08de42a blocking audit preserved | `docs/MASTER-CONTROL-V2.md`, `docs/S10-E-PROGRESS-REASSESSMENT.md` untouched |
| 2 | DB_VERSION 4→5 | `js/storage.js` |
| 3 | Only cycle_kpi_baselines + reassessments added | Confirmed, no other store touched |
| 4 | Migration additive only | Tests #6/7 (persistence suite), storage.test.js |
| 5 | Baseline snapshot durable | Test: reload survival |
| 6 | Baseline immutable | Test: recapture reuses/rejects |
| 7 | No post-cycle evidence backfills baseline | Test: at/after-cutoff exclusion |
| 8 | Exact KPI compatibility only | Test: case-mismatch/S7-S8-vocab rejection |
| 9 | TRAINING/MATCH tracks separate | Tests across all three engine files |
| 10 | Latest-value aggregation used | Tests + doc evidence |
| 11 | Minimum 2-point rule used | Tests #25/26 |
| 12 | Delta math correct | Tests #21-24 |
| 13 | Unresolved target preserved | Tests #31/32 |
| 14 | Real Match-only reassessment | Orchestrator structural scan + integration test |
| 15 | Accepted S9 APIs reused | Real diagnoseMatch/prioritizeDiagnosis/prescribeRecommendations call, verified |
| 16 | No fabricated Match inputs | Structural scan (no createMatchSession in orchestrator) |
| 17 | Duplicate reassessment protected | Tests #40/41 |
| 18 | Reassessment durable across reload | Tests #42/43 |
| 19 | Recommendation comparison uses accepted outputs | Real S9 recommendationResult compared |
| 20 | Reprioritization only mirrors S9 | reassessment-engine.js pure comparison |
| 21 | Supersession only after valid new prescription | supersedePrescriptionWorkflowDurable requires it |
| 22 | No automatic level promotion | Structural scan (no validated_training_level anywhere) |
| 23 | No S9/S10-A/S10-C/S10-D business logic rewrite | No production file of theirs modified |
| 24 | Targeted tests PASS | 4 new suites |
| 25 | Relevant/full regression PASS | See commit report |
| 26 | Claude STOPPED before S10-F | This report is the stop point |

## Implementation Verdict

```
READY FOR GPT INDEPENDENT ACCEPTANCE
```
