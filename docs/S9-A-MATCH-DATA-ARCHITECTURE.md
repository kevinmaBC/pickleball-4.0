# S9-A: Match Data Architecture

Implements the S9-A design-freeze decision: full T10 Match Observation
capture reuses the existing `test_sessions` + `trial_events` stores
rather than introducing new storage. **No capture UI, no aggregation/
scoring formula, and no engine changes are implemented here** — those
belong to later S9 stages (S9-B Match Observation Engine, S9-C Match
Validation Engine onward).

## No new store, no DB_VERSION bump

`js/storage.js`: `DB_NAME='pb_v2'`, `DB_VERSION` stays `3`. S9-A adds a
new **function**, not new storage. Full T10 Match Observation sessions
are ordinary `test_sessions` records (`test_id: 'ASMT-10'`,
`feed_mode: 'live_match'`), and their rally-by-rally observations are
ordinary `trial_events` records (the 14 `required_trial_fields` from
`data/test_definitions_v2_3_1.json`'s T10 entry live inside the existing
free-form `raw_json` field, unchanged shape). This is a direct
consequence of the S9-0 audit's storage-gap finding
(`docs/S9-0-MATCH-VALIDATION-ENTRY-AUDIT.md` §11): `trial_events.raw_json`
was already identified as a reusable path, and no new store was found
justified.

## New function

`PBStore.createMatchObservationSession(opts)` — a restricted wrapper
around the existing `createTestSession()`:

- `test_id` is always forced to `'ASMT-10'` (the canonical full-T10 id;
  `T10` remains a `js/namespace.js` legacy alias, never a second
  namespace).
- `feed_mode` is always forced to `'live_match'`; passing any other
  `feed_mode` is rejected (`opts.feed_mode != null &&
  opts.feed_mode !== 'live_match'` → error), preventing a caller from
  silently creating a mislabeled match session.
- `assessment_id` is required, exactly like `createTestSession`, keeping
  Match Observation sessions anchored to an existing assessment — no
  standalone "match" entity untethered from the Assessment Namespace.
- Everything else (`assessment_tier`, `feeder_id`,
  `feeder_calibration_id`) passes straight through to
  `createTestSession`, which continues to own the actual `put`.

Rally-by-rally observations under an `ASMT-10` session are written with
the **existing, unmodified** `addTrialEvent()` — no new function, no new
field. `sessionsByAssessment()` / `trialsBySession()` (existing indexes
`by_assessment` / `by_session`) already return them like any other test
session.

## Namespace: identifying match-capture without a second namespace

`js/namespace.js` adds `MATCH_CAPTURE_IDS = ['ASMT-10']` and
`isMatchCapture(id)`, which normalizes its input through the existing
`toCanonical()` before checking membership — so `isMatchCapture('T10')`
and `isMatchCapture('ASMT-10')` both resolve correctly through the one
alias table that already exists. No new `=== 'T10'` branch was added
anywhere (this is independently guarded by
`tests/s9-entry-audit.test.js`'s existing regression assertion, which
still passes unmodified).

## Backward compatibility

- T10-lite (`assessments.match_transfer`, `js/assessment.js`
  `renderMatch()`/`saveMatch()`) is completely untouched. An assessment
  with no `ASMT-10` test_sessions behaves identically to today.
- `js/config-loader.js`'s `S1_TEST_IDS` (`T01`–`T09`) is untouched —
  `ASMT-10`/`T10` is still not loaded into the S1 collection flow.
- `data/level_gates_v2_3_1.json` is untouched: the 4.0 match threshold
  (`70`) and the 4.5/5.0 provisional (no `match_validation` key) status
  are both preserved exactly.
- `js/review-engine.js`, `js/preview.js`, `js/retest-engine.js`,
  `js/trend-engine.js`, `js/training-*-engine.js`, `index.html` — no
  changes. `match_transfer_score` computation, `evalMatchValidation`,
  and `determineEvidenceConfidence` are unmodified; consuming real
  `ASMT-10` trial data into those computations is S9-B/S9-C work.

## What S9-A deliberately does not do

- No aggregation of `trial_events` into a `match_transfer_score` (S9-B/S9-C).
- No new `match_transfer_mode` value (`'full_t10'` remains a documented
  future extension point on `review_snapshots`, not implemented yet).
- No Compete UI mount point (S9-E).
- No descriptive match context fields (opponent/score/venue) — not
  required by any consumer today; would risk becoming an unused,
  win/loss-adjacent field before there's a proven need.

See `docs/S9-0-MATCH-VALIDATION-ENTRY-AUDIT.md` for the full audit this
design freeze was built against, and the S9-A design-freeze conversation
record for the complete answers to all 18 design questions.
