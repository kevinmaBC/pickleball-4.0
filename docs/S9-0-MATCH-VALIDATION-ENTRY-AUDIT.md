# S9-0: Match Validation Entry Audit

Entry audit, not a feature stage. Identifies and reconciles all existing
Match-related assets in the accepted S1–S8 codebase before any S9-A
architecture is designed. **Zero production-code changes.**

## 1. Baseline

- Repository: `kevinmaBC/pickleball-4.0`, branch `app-v2-alpha`
- S9-0 started from `8d1fec18117f95e463f2b43032f34badb7a5cd65` (S8-F),
  clean tree, `main` unchanged at
  `f10d73ad6cbed337561a6115889e055a19a68bc7` throughout.

## 2. Executive summary

There are **two entirely separate, never-integrated "match" surfaces**
in this codebase today:

1. **The T10-lite aggregate Match Entry form** (`js/assessment.js`
   `renderMatch()`/`saveMatch()`) — a simplified, self/coach-rated data
   entry screen that writes two flat nested-object fields
   (`assessments.ue`, `assessments.match_transfer`) directly onto the
   `assessments` record. This is the **sole** producer of
   `match_transfer_score` and feeds `ue_per_game_max` (a hard gate at
   every validated level) and `match_validation` (a 4.0-only gate,
   threshold 70). It is explicitly self-labeled in its own UI as
   "simplified... not rally-by-rally coding, not an official rating."
2. **`live_match`**, a `feed_mode` enum value tagging an ordinary
   T01–T09 trial-collection session as having been fed during real match
   play. It has **zero interaction** with `match_transfer_score`, T10,
   or `assessments.match_transfer` — a structurally disjoint concept
   that happens to share the English word "match."

Full T10 (the canonical `"MatchTransfer"` test, category `"match"`, 8 of
9 non-UE/non-score metrics, and the `required_trial_fields` for
rally-by-rally coding) is **entirely unimplemented**: no `trial_events`
of that kind exist anywhere, no capture UI exists, and
`js/config-loader.js` explicitly excludes T10 from `S1_TEST_IDS` with
the comment "T10 视频/实战本轮不做" (T10 video/live-match, not done this
round). T10 is only "present" today as (a) its JSON spec entry, (b) the
T10-lite aggregate proxy above, and (c) an alias target in
`js/namespace.js` (`T10 → ASMT-10`, treated identically to every other
legacy id, never special-cased).

**Master Control V2 integrity: confirmed intact.** CAP is computed by
exactly one function (`computeCAP`, 3 parameters, none match-related);
`match_transfer_score`/`match_validation_state` are always sibling
fields on the review snapshot, never CAP inputs. The 4.0 match threshold
(70) has exactly one authoritative source
(`data/level_gates_v2_3_1.json`). 4.5 and 5.0 have **zero** match
validation rule configured — confirmed absent, not silently guessed.
No win/loss-as-validation logic exists anywhere. No `C0` evidence rank
exists. The Compete tab is 100% static content with no mount point
today.

**One noteworthy naming-adjacency finding** (not a bug, a design note
for S9-A): the existing `review_snapshots.match_validation_state` field
already uses the vocabulary `MET | NOT_MET | INCOMPLETE`. If S9-A
introduces a "Match Validation State" using `VALIDATED | NOT_VALIDATED |
INCOMPLETE` without reconciling it with this existing field, the
codebase would carry two differently-named enums describing overlapping
concepts. See §16 and §19.

## 3. Existing Match Asset Inventory

| Asset | Location | Nature |
|---|---|---|
| `match_transfer_score` (produced) | `js/assessment.js:239–246` `saveMatch()` | mean of 4 self/coach sub-scores |
| `match_transfer_score` (persisted) | `assessments.match_transfer.score` (`js/storage.js`) | via `PBStore.updateAssessment` |
| `match_transfer_score` (re-exposed) | `js/metrics.js` `computeAssessment()` | pass-through read, not a 2nd formula |
| `match_transfer_score` (consumed) | `review-engine.js`, `preview.js`, `retest-engine.js`, `trend-engine.js` | validation, preview, retest response, trend series |
| `match_transfer_score` (training exposure) | `training-plan-engine.js`, `training-readiness-engine.js` | training-exposure metric target only |
| `match_validation` config | `data/level_gates_v2_3_1.json` levels `"4.0"` only | `{required:true, min_match_transfer_score:70}` |
| `match_validation_state` (computed) | `js/review-engine.js` `evalMatchValidation()` | `MET \| NOT_MET \| INCOMPLETE` |
| T10 spec | `data/test_definitions_v2_3_1.json` | full definition, unimplemented capture |
| T10-lite | `js/assessment.js`, comments across `metrics.js`/`preview.js`/`review-engine.js` | UI/product term for the simplified proxy, not a distinct code path |
| `live_match` | `js/config-loader.js` `FEED_MODES`, `js/storage.js` `test_sessions.feed_mode` | ordinary-trial session tag, T01–T09 only |
| Compete tab | `index.html` `<section id="v-compete">` | 100% static MiLP rules content, no mount |
| `T10 → ASMT-10` alias | `js/namespace.js` `LEGACY_TO_CANONICAL` | identical mechanism to T01–T09 |
| `data/prescription_rules_v2_3_1.json` match rule | priority-5 rule | `match_validation_fail:match_transfer_score → MATCH_TRANSFER_BLOCK` |
| `schemas/*` match fields | `assessment_schema_v2_3_1.json`, `database_schema_v2_3_1.sql`, `scoring_engine_reference_v2_3_1.py` | schema/reference definitions, consistent with the above |

## 4. Match Transfer Score Provenance (Q1)

**First produced:** `js/assessment.js:239–246`, `saveMatch(aid)`:
```js
function saveMatch(aid) {
  var d = ui.matchDraft || {};
  var mean = Math.round(((d.decision||0) + (d.transition||0) + (d.pressure||0) + (d.attack||0)) / 4);
  PBStore.updateAssessment(aid, {
    ue: { games: d.games||0, counts: d.counts||{} },
    match_transfer: { decision:d.decision||0, transition:d.transition||0, pressure:d.pressure||0, attack:d.attack||0, score: mean }
  }).then(function () { ui.screen='detail'; render(); });
}
```
**Raw fields:** four 0–100 sub-scores (`decision`, `transition`,
`pressure`, `attack`), entered by hand in the "Match Entry (T10-lite)"
screen (`renderMatch()`, `js/assessment.js:183–237`) — self- or
coach-rated, not derived from any recorded trial data.

**Formula:** `mean = round((decision+transition+pressure+attack)/4)`.
This is the **only** formula in the entire repository. One authoritative
source confirmed — no conflicting second definition exists.

**Owning module:** `js/assessment.js` (write path) /
`js/storage.js` `updateAssessment` (persistence, a generic merge-patch
helper, not match-specific).

**Source data:** manually entered on the S1 assessment detail screen —
not derived from any Assessment/Test session, trial, or T10 rally
coding. `data/test_definitions_v2_3_1.json`'s own T10 metrics list
*also* defines a `match_transfer_score` entry
(`"formula": "validation_index_from_match_metrics", "type": "validation"`)
— this is a **spec placeholder for a future full rally-coded formula**,
explicitly annotated `"Not linearly added into capability score in
V2.3.1"`, and is **not wired to any code today**. It does not conflict
with the simplified formula above; it documents where a future, more
rigorous formula would eventually live, distinct from the current
proxy.

**Persisted:** `assessments.match_transfer.score` (IndexedDB `assessments`
store, no dedicated store).

**Displayed:** assessment detail row (`assessment.js`), Match Entry live
preview (`#mt-score`), Review/Trend UI's Match Transfer section
(`review-ui.js`), Training Progress UI (`training-ui.js`, as *training
exposure toward this metric*, not the score itself).

**Consumed downstream:** `review-engine.js` (`evalMatchValidation`,
primary-bottleneck determination), `preview.js` (non-official readiness
preview), `retest-engine.js` (retest response classification, reads
`match_transfer_score`/`match_validation_state` only, never
`capability_score`), `trend-engine.js` (independent `match_transfer_trend`
series), `training-plan-engine.js`/`training-readiness-engine.js`
(training-exposure assignment target).

**Conclusion:** one authoritative source. No formula change made or
needed in S9-0.

## 5. Match Validation Consumption Map (Q2)

**Definition site:** `data/level_gates_v2_3_1.json`, `levels["4.0"].match_validation`
— the **only** level carrying this key (verified directly against the
live file: `3.0`/`3.5` have no `match_validation` key at all; `4.5`/`5.0`
likewise, see §9).

**Evaluation function:** `js/review-engine.js:173–177`,
`evalMatchValidation(required, minScore, matchTransferScore)`:
```js
function evalMatchValidation(required, minScore, matchTransferScore) {
  if (!required) return { required: false, state: 'INCOMPLETE', score: (matchTransferScore == null ? null : matchTransferScore) };
  if (matchTransferScore == null) return { required: true, state: 'INCOMPLETE', score: null };
  return { required: true, state: (matchTransferScore >= minScore) ? 'MET' : 'NOT_MET', score: matchTransferScore };
}
```
Called from `generate()` at lines 365–368, reading
`levelCfg.match_validation.required`/`.min_match_transfer_score` off the
**target level's** config (not hardcoded).

**Consumers that actually gate on it:**
- `evalValidationEligibility()` (`review-engine.js`) — a match-validation
  `NOT_MET` independently forces `NOT_ELIGIBLE` for the overall
  validated-level eligibility determination (confirmed:
  `matchFail = !!o.matchValidationRequired && o.matchValidationState === 'NOT_MET'`
  is one of the four fail conditions checked before eligibility can be
  granted). **Confirmed: current validated-level logic genuinely blocks
  eligibility when Match Validation is required and not met — this is
  not cosmetic.**
- `determinePrimaryBottleneck()` — a `NOT_MET` match validation can set
  `primary_bottleneck: 'match_validation'`, feeding S8-B's training
  planner.
- `preview.js` — non-official readiness preview only.
- `retest-engine.js` — reads the *persisted* `match_validation_state`
  off historical snapshots for retest-response classification; does not
  itself evaluate or recompute.

**Is 4.0 the only formalized level?** Yes, confirmed directly against
`data/level_gates_v2_3_1.json`. **4.5/5.0 have no match-validation rule
of any kind** — no `required` flag, no threshold, nothing. They carry
only `"status": "provisional"` and an informational `"source_tests"`
array (`["T09","T10"]` / `["T10"]`) that is **never read by any JS
file** (confirmed by repo-wide grep — `source_tests` is documentation
only). No formal 4.5/5.0 match rule is "hidden elsewhere" — this audit
found none.

## 6. T10 / T10-lite Audit (Q3)

**Canonical definition** — `data/test_definitions_v2_3_1.json`:
`"name": "MatchTransfer"`, `"category": "match"`,
`"tier_support": ["lite","standard","full"]`,
`"sample_plan"`: lite `{min_games:1, min_rallies:20}`, standard
`{min_games:3, min_rallies:60}`, full `{min_games:5, min_rallies:100}`.

**Metrics (9 total):** `match_decision_pct`, `match_transition_pct`,
`ue_per_game`, `attack_conversion_pct`, `pattern_success_pct`,
`wrong_attack_pct`, `rally_control_pct`, `pattern_adaptation_pct`,
`neutralize_under_pressure_pct` (all `"type":"match"`), plus
`match_transfer_score` (`"type":"validation"`, unwired spec placeholder
per §4).

**`required_trial_fields`:** `phase, intent, shot, target, quality,
movement, result, pattern_id, review_flag, adaptation_opportunity,
adaptation_success, neutralize_opportunity, neutralize_success,
control_state` — **none of these are ever written anywhere in this
codebase.** No `trial_events` of this shape exist.

**Is T10-lite a formal test, UI shortcut, partial protocol, or legacy
label?** It is a **UI/product term for a simplified proxy screen**, not
a distinct code path or formal test-tier. It appears only in comments
and UI labels ("Match Entry (T10-lite)", "T10-lite：从评估记录读 UE 与转化验证分",
"SIMPLIFIED, not rally-by-rally T10 coding"). `js/config-loader.js`
explicitly excludes T10 from `S1_TEST_IDS`
(`可评测试：T01–T09（T10 视频/实战本轮不做）`) — confirming T10 itself is not
implemented as a collectible test at all; "T10-lite" is the interim
substitute product built instead.

**Namespace mapping — confirmed unremarkable:** `js/namespace.js`:
```js
var LEGACY_TO_CANONICAL = { T01:'ASMT-01', ..., T09:'ASMT-09', T10:'ASMT-10' };
```
T10 sits in the exact same flat object as every other legacy id, run
through identical `toCanonical`/`toLegacy`/`isLegacy`/`isCanonical` pure
functions — no branch, no special case. Independently reverified in
this audit:
```
PBNamespace.toCanonical('T10') === 'ASMT-10'
PBNamespace.toLegacy('ASMT-10') === 'T10'
```
`tests/namespace.test.js` already asserts the full round-trip.
**No code anywhere treats T10 as authoritative independent of this alias
table** (verified: no `=== 'T10'` conditional branch exists in
`namespace.js`; this is now also a permanent regression assertion in
`tests/s9-entry-audit.test.js`).

## 7. `live_match` / Match Entry Relationship (Q4)

`live_match` is one of four **`feed_mode`** enum values for ordinary
T01–T09 test sessions: `['machine', 'calibrated_human', 'partner',
'live_match']` (`js/config-loader.js`). It only tags a `test_sessions`
record (`js/storage.js` `createTestSession()`,
`feed_mode: opts.feed_mode`) as having been fed during real match play —
it never touches `assessments.match_transfer`, never produces
`match_transfer_score`, and has no relationship to T10 or
`trial_events` beyond that generic tag.

**Relationship classification: these are two parallel, non-overlapping
paths**, not the same data path and not a historical duplication of one
another:

| | `live_match` (feed_mode) | Match Entry (T10-lite) |
|---|---|---|
| Attaches to | `test_sessions` (T01–T09) | `assessments` directly |
| Data shape | tag on ordinary trial-collection | `{ue, match_transfer}` nested objects |
| Produces `match_transfer_score`? | No | Yes |
| Uses `trial_events`? | Yes (normal trial flow) | No |
| Feeds `match_validation`/`ue_per_game_max`? | No | Yes |

No duplication or ambiguity between them beyond sharing the English word
"match" — they are structurally disjoint today. A future S9-A must
decide deliberately whether/how to unify them; this audit does not
recommend a specific design, only documents that no unification exists
yet.

## 8. 4.0 Threshold Authority (Q5)

**Defined:** `data/level_gates_v2_3_1.json`, `levels["4.0"].match_validation.min_match_transfer_score = 70`
— confirmed the **only** location defining this value. Repo-wide grep
for `min_match_transfer_score` found exactly three hits: the JSON
definition, `js/review-engine.js` (`levelCfg.match_validation.min_match_transfer_score`,
a property *read*, not a redefinition), and `js/preview.js` (same
pattern). `schemas/scoring_engine_reference_v2_3_1.py` takes it as a
function *parameter* (`match_cfg["min_match_transfer_score"]`), never
hardcodes it either.

**No duplicate hardcoded `70` exists anywhere** for this purpose
(independently reverified via `grep -rn "\b70\b"` across `js/*.json`
filtered to match-related lines — zero hits outside the config file and
the two legitimate reads).

**Threshold source:** config (JSON), never redefined in JS/UI.

**Boundary test coverage:** no existing test currently exercises the
`>= 70` boundary of `evalMatchValidation` directly (this audit did not
find a dedicated boundary test for this specific comparison in
`tests/review-engine.test.js`). This is a coverage gap worth noting for
a future stage, **not** something S9-0 is authorized to add (S9-0 is
audit-only; adding review-engine.js test coverage is outside its scope
and belongs to whichever stage next touches that engine).

**Per the S9-0 rule: 70 is preserved exactly, not recalibrated, not
debated.** Verified and now permanently guarded by
`tests/s9-entry-audit.test.js`.

## 9. 4.5 / 5.0 Provisional Status (Q6)

Directly reverified against the live `data/level_gates_v2_3_1.json`:

```json
"4.5": { "capability_min": 82, "evidence_min": "C3", "status": "provisional",
  "hard_gates": { "pattern_success_pct": {...}, "attack_conversion_pct": {...},
    "transition_nvz_gain_pct": {...}, "wrong_attack_pct_max": {...}, "ue_per_game_max": {...} },
  "source_tests": ["T09","T10"] }
"5.0": { "capability_min": 87, "evidence_min": "C4", "status": "provisional",
  "hard_gates": { "rally_control_pct": {...}, "pattern_adaptation_pct": {...},
    "neutralize_under_pressure_pct": {...}, "attack_conversion_pct": {...}, "ue_per_game_max": {...} },
  "source_tests": ["T10"] }
```

**No `match_validation` key exists for either level.** Per the S9-0
rule, this is documented exactly as:

> **PROVISIONAL / RULE NOT FORMALIZED**

No threshold (75, 80, 85, or any other value) is inferred, guessed, or
recorded anywhere for 4.5/5.0 match validation. This absence is now a
permanent regression assertion in `tests/s9-entry-audit.test.js`.

## 10. Compete UI Reuse Audit (Q7)

`<section class="view" id="v-compete">` (`index.html`) contains **100%
static content**: MiLP league format (G1–G4 doubles + DreamBreaker),
rally-scoring rules, positioning rules, DUPR division tables, coin-toss
rules — all literal HTML or `data-i18n`/`data-i18n-html` static-string
keys. `js/app.js` has **zero** "compete" references (case-insensitive
grep, no logic, no data, no rendering code for this tab). **No mount
div exists inside it** — unlike every other feature area (`#a1-app`,
`#review-app`, `#training-cycle-app`, `#training-today-app`,
`#training-progress-app`), which each mount a JS engine into a
dedicated `id="...-app"` div directly in `index.html`. This absence is
now independently reverified and permanently asserted in
`tests/s9-entry-audit.test.js`.

**Reuse recommendation:** a future S9-E Match Review UI *can* reasonably
be mounted into Compete without a new top-level nav tab, following the
exact same pattern already established for S1/S7/S8-E (`<div class="card"
id="match-review-root"><div id="match-review-app"></div></div>` inside
`v-compete`, plus one `<script src="./js/match-review-ui.js">` tag and
one `sw.js` CORE-list entry — the same minimal-footprint mechanism used
three times already). This is a recommendation only; S9-0 does not
implement it.

## 11. Storage Gap Analysis (Q8)

Current `pb_v2` stores (`js/storage.js`, `DB_VERSION=3`): `players`,
`assessments`, `test_sessions`, `trial_events`, `review_snapshots`,
`prescriptions`, `retests`, `training_cycles`, `weekly_plans`,
`session_plans`, `session_logs`, `cycle_summaries`. **S9-0 creates none
of these and proposes none be created.**

| Future S9 concept | Classification | Rationale |
|---|---|---|
| Match Session / Context | **EXTEND_EXISTING** | `test_sessions.feed_mode='live_match'` already tags a session as match-context; if S9-A needs a genuine "this was one specific real match" record (not just a feed-mode tag), the closest existing shape is `test_sessions`, but it currently has no match-identity fields (opponent, score, date-of-match distinct from `started_at`). Extending it is plausible; not yet proven necessary. |
| Match Observations (rally-by-rally, T10's `required_trial_fields`) | **LIKELY_NEW_STORE** or **EXTEND_EXISTING (`trial_events`)** | `trial_events` is structurally the closest fit (keyed per-trial, indexed by session) but its current schema (`outcome S/P/F/I`, `score_weight`, `raw_json`, `review_flag`, `video_timestamp_ms`) doesn't carry T10's 14 required fields. Extending `trial_events.raw_json` (already a free-form JSON field) could hold them without a schema change — genuinely reusable today, not just "likely." A dedicated store is not yet justified until real capture UI exists. |
| Match Evidence (linking a match observation to Evidence Confidence) | **NOT_YET_JUSTIFIED** | Evidence Confidence today attaches only to a whole `review_snapshot` (via `testDatesCount`/`gamesCount`, §12) — there is no per-datum evidence-linking concept anywhere in the accepted architecture (S8-C's `SessionLog.evidence_links[]` is the closest analog, but it belongs to training execution, not assessment evidence, and explicitly never assigns a C-rank). Inventing a match-specific evidence-linking mechanism ahead of a concrete S9-A requirement would be premature. |
| Match Validation Snapshot (a persisted record of a Match Validation determination, analogous to `review_snapshots`) | **REUSE_EXISTING** | `review_snapshots.match_validation_state`/`match_transfer_score`/`match_transfer_mode` already persist exactly this determination today, generated fresh each `review-engine.js` run. If S9-A wants a *standalone*, independently timestamped Match Validation record decoupled from a full review snapshot, that would tip toward LIKELY_NEW_STORE — but nothing in the current accepted architecture requires that decoupling yet. |

**No new IndexedDB store is justified by this audit alone.** The
strongest case for eventual new storage is rally-by-rally match
observations if/when real T10 capture UI is built — and even then,
`trial_events.raw_json` is a plausible reuse path worth evaluating
first in S9-A, before committing to a new store.

## 12. Hard-Gate Crosswalk Audit

`ue_per_game_max` draws from T10-lite match data **at every validated
level** (3.0 threshold 9, 3.5→7, 4.0→5, 4.5→4, 5.0→3, all `min_games`
scaling 2→2→3→4→5) — confirmed in `js/review-engine.js`:
```js
if (gateKey === 'ue_per_game_max') {
  var cur = (match && match.ue_per_game != null) ? match.ue_per_game : null;
  var ctx = { games: (match && match.games != null) ? match.games : null };
  hardGates.push(evalHardGate(gateKey, gateCfg, cur, ctx, borderBand, 'match'));
}
```
and identically in `js/preview.js`. This is the **only** hard-gate
metric with a live, working match-data path today.

The 4.5/5.0 hard gates for `pattern_success_pct`, `attack_conversion_pct`,
`transition_nvz_gain_pct`, `wrong_attack_pct_max`, `rally_control_pct`,
`pattern_adaptation_pct`, `neutralize_under_pressure_pct` are all
**structurally uncapturable today**: `evalGate()`/`buildMetricToTest`
only map T01–T09 metric keys, so any metric with no `metricToTest[key]`
entry (every T10 metric except `ue_per_game`) resolves to
`row.status='not_captured'` (`preview.js`) or `INCOMPLETE`
(`review-engine.js`) — never a fabricated pass.

**Confirmed relationship, per the S9-0 framing:** these are cases of
"an existing target-level Hard Gate whose transfer *could in principle*
be observed in a match context, once real T10 capture exists" — **not**
a request for a second, parallel "Match Hard Gate" system. The Hard Gate
system itself (definitions, thresholds, evaluation) is single and
already frozen; match data is simply one of several possible evidence
sources a gate metric could eventually draw from, exactly as
`ue_per_game_max` already does. No duplication exists; the gap is
missing *data capture*, not a missing *rule system*.

## 13. Evidence Compatibility Audit

**Attachment point:** `determineEvidenceConfidence(testDatesCount,
gamesCount)` (`js/review-engine.js`) — attaches to the whole
`review_snapshot` (one C-rank per snapshot, not per-metric, not
per-match). `gamesCount` is `assessment.ue.games`, i.e., the T10-lite
Match Entry form's game count — **match data already legitimately
affects Evidence Confidence today** (a snapshot can reach C2 only if
`testDatesCount>=2 AND gamesCount>=2`).

**Distinctness of training vs. assessment evidence:** confirmed
distinct. S8-C's `SessionLog.evidence_links[]` is a training-execution
concept (`evidence_class` always forced `null`, per S8-C's own
invariant — training execution never auto-becomes validated assessment
evidence). Assessment Evidence Confidence (C1–C4) is computed
exclusively in `review-engine.js` from assessment-level session/game
counts. These two "evidence" concepts do not currently overlap or
share any code path — confirmed clean separation.

**Can match observations be represented without violating the Evidence
architecture?** Yes, at the current C1/C2 ceiling: `gamesCount` already
flows in cleanly as one contributing factor. C3 (≥3 coded video matches
or ≥60 coded rallies) and C4 (4–6 week trend) are structurally
unverifiable today and deliberately never produced — the engine's own
comment states this explicitly ("绝不臆造 C3/C4"). A future S9-A that adds
real rally-by-rally T10 capture would be the natural (and currently
missing) prerequisite for ever reaching C3, but S9-0 does not propose
how; it only confirms no architectural violation exists in the current
C1/C2 path and that reaching C3/C4 needs new capture, not a new evidence
class. **No new evidence class is needed or proposed; C0 remains absent
and must stay absent.**

## 14. Win/Loss Semantic Audit

Repo-wide, case-insensitive grep for win/loss/score-result-as-validation
across every `js/*.js` and `data/*.json` file found **zero code
treating a match win or loss as a validation input or outcome**.
Independently reverified directly (not just via the research pass):
`grep -in "\bwin\b\|\bloss\b" js/*.js data/*.json` (excluding `window`)
returned no output. All "result"-named identifiers found are unrelated
(free-text UI fields, generic engine return-value naming like
`gateResult(gate, result, ...)`, promise-callback parameter names).
Match evaluation is entirely score-based
(`match_transfer_score`/`ue_per_game`, both self/coach-rated), never
derived from a game's win/loss outcome.

**Frozen rule confirmed intact, no violation found:** `WIN != VALIDATED`,
`LOSS != NOT_VALIDATED` — there is no code to violate this rule with,
because no win/loss-driven validation path exists at all. No fix
needed.

## 15. Authoritative Source Map

| Concept | Source | Classification |
|---|---|---|
| Validated Levels (3.0–5.0) | `data/level_gates_v2_3_1.json` `level_model.validated_levels` | AUTHORITATIVE |
| CAP weights (45/30/25) | `js/review-engine.js` `CAP_WEIGHTS` (mirrors `level_gates_v2_3_1.json` `capability_weights`) | AUTHORITATIVE |
| Hard Gates (all levels) | `data/level_gates_v2_3_1.json` `levels[*].hard_gates` | AUTHORITATIVE |
| Evidence Confidence (C1–C4) | `js/review-engine.js` `determineEvidenceConfidence` (caps at C2 by design) | DERIVED |
| Assessment Namespace (ASMT-01–10) | `js/namespace.js` | AUTHORITATIVE |
| T01–T10 | `js/namespace.js` `LEGACY_TO_CANONICAL` | LEGACY_ALIAS |
| `match_transfer_score` formula | `js/assessment.js` `saveMatch()` | AUTHORITATIVE (simplified proxy) |
| `match_transfer_score` (T10 full formula) | `data/test_definitions_v2_3_1.json` T10 metric entry | PROVISIONAL (unwired spec placeholder) |
| `match_validation` requirement (4.0) | `data/level_gates_v2_3_1.json` `levels["4.0"].match_validation` | AUTHORITATIVE |
| `match_validation` (4.5/5.0) | — (absent) | PROVISIONAL / NOT FORMALIZED |
| 4.0 match threshold (70) | `data/level_gates_v2_3_1.json` | AUTHORITATIVE |
| Match Entry UI (T10-lite) | `js/assessment.js` `renderMatch`/`saveMatch` | AUTHORITATIVE (only entry path) |
| Compete UI | `index.html` `v-compete` | UI-ONLY (static, no logic) |
| Match-related persisted data | `assessments.ue`, `assessments.match_transfer` | AUTHORITATIVE |
| Training Match Transfer Exposure | `js/training-readiness-engine.js` `calculateTrainingExposure` | DERIVED (from S8-C SessionLog credit, independent of the above) |
| `match_validation_state` vocabulary | `js/review-engine.js` `evalMatchValidation` (`MET\|NOT_MET\|INCOMPLETE`) | AUTHORITATIVE |

No entry above is marked DUPLICATE/CONFLICT — see §16 for the one
adjacency worth flagging (not a duplicate, a naming-reconciliation note).

## 16. Conflicts / Duplications

| Finding | Classification |
|---|---|
| Two disjoint "match" concepts (`live_match` feed_mode vs. T10-lite Match Entry) sharing the English word "match" but no data path | NON_BLOCKING — documented in §7; not a bug, but S9-A must not assume they're the same thing |
| `match_transfer_score`'s simplified formula (assessment.js) vs. T10's spec-placeholder formula (`validation_index_from_match_metrics`) | NON_BLOCKING — the JSON entry is explicitly an unwired future placeholder, not a live second formula; no conflict today, but S9-A should be aware two "formulas" exist on paper |
| Existing `match_validation_state` vocabulary (`MET\|NOT_MET\|INCOMPLETE`) vs. this audit's requested S9 semantic-state check (`VALIDATED\|NOT_VALIDATED\|INCOMPLETE`) | **BLOCKING_FOR_S9_A** if S9-A introduces the new vocabulary without reconciling it with the existing field — would create two enums for overlapping concepts. Not yet a real conflict (S9-0 adds no code), but must be resolved *during* S9-A design, not discovered mid-implementation. See §19. |
| No boundary test for the 70-threshold comparison in `evalMatchValidation` | NON_BLOCKING — a coverage gap, not a defect; out of S9-0's audit-only scope to add |
| 4.5/5.0 hard gates referencing T10 metrics with no capture path | NON_BLOCKING — already correctly resolves to `INCOMPLETE`/`not_captured`, never a fabricated result; this is expected behavior for a provisional, not-yet-capturable level, not a bug |
| UI overclaim risk | NONE — `review-ui.js` already labels match data "Simplified / Provisional Evidence (not full rally-coded ASMT-10 data)" wherever displayed; no UI found implying stronger validation than the engine provides |
| Unused match fields | NONE found — every persisted match field (`ue`, `match_transfer`) has an active read path |
| Ambiguous ownership | NONE — every match-related function/field has exactly one clear owning module (see §15) |

## 17. S9-A Entry Recommendation

1. **Is S9-A authorized to proceed?** Yes, from an architectural-cleanliness
   standpoint — no BLOCKING conflict was found in the existing code (the
   one BLOCKING_FOR_S9_A item is a design-time reconciliation
   requirement, not a pre-existing defect). This audit does not itself
   authorize starting S9-A; that remains the owner/GPT's decision.
2. **Assets S9-A MUST reuse:** `js/namespace.js` for all T10/ASMT-10
   normalization; `data/level_gates_v2_3_1.json` as the sole source for
   the 4.0 threshold and any future 4.5/5.0 rule; `js/review-engine.js`'s
   `evalMatchValidation`/`match_validation_state` vocabulary (reconcile,
   don't duplicate); the existing `assessments.match_transfer`/`.ue`
   fields and `PBStore.updateAssessment` merge-patch pattern;
   `trial_events.raw_json` as the first-choice reuse path if/when
   rally-level match observations are captured, before proposing a new
   store.
3. **Legacy assets that must remain compatibility-only:** `T01–T10` as
   `js/namespace.js` aliases (never re-introduced as a second namespace);
   the T10-lite simplified proxy formula must keep being labeled
   "simplified/provisional" everywhere it's displayed, exactly as today,
   even after any richer T10 capture is added — it should not be quietly
   upgraded to look authoritative without a corresponding architecture
   decision.
4. **Data gaps S9-A must solve (if it chooses to pursue real T10):**
   rally-by-rally capture for T10's `required_trial_fields` (currently
   100% missing); a decision on whether `live_match`/T10-lite/full-T10
   converge into one coherent match-data model or remain deliberately
   separate.
5. **New IndexedDB store justified?** Not by this audit. `trial_events.raw_json`
   is a plausible reuse path for match observations; a dedicated store
   should only be proposed in S9-A if that reuse path proves
   insufficient once concrete requirements exist.
6. **Fields/thresholds that must remain frozen:** CAP weights
   (45/30/25); Validated Levels (3.0/3.5/4.0/4.5/5.0 only); the 4.0
   match threshold (70); Evidence ranks C1–C4 (no C0); the Hard Gate
   system (no parallel Match Hard Gate system); the
   `Training Match Transfer Exposure != Match Transfer Score != Match
   Validation` three-way distinction.
7. **4.5/5.0 rules remaining provisional:** both, in full — no
   threshold of any kind exists for either level; S9-A must not invent
   one without an explicit owner/GPT decision to formalize it.
8. **What S9-A must NOT redesign:** CAP computation; the Hard Gate
   system; the Assessment Namespace/alias mechanism; the Evidence
   Confidence C1–C4 ladder; S8's Training Match Transfer Exposure
   semantics (training-execution credit, not a validation score); the
   existing `review_snapshots`/`assessments` storage architecture
   (extend, don't replace).

## 18. Final S9-0 Gate Result

All Section 24 acceptance criteria satisfied: correct baseline, clean
entry, zero production-code changes, all eight required questions
(Q1–Q8) answered with file:line evidence, no threshold invented for
4.5/5.0, Compete reuse path defined, storage gap classified per-concept,
Hard Gate and Evidence compatibility audited, Win/Loss semantics
audited (no violation), authoritative source map completed, conflicts
classified, S9-A entry recommendation completed, all 15 existing
automated suites re-verified passing, Master Control unchanged, no new
Match store created, no S9 feature implemented.

**S9-0 GATE: PASS.**
