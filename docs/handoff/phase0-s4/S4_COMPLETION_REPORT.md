# S4 Completion Report — Player Training State Integration Core

Base: S3 frozen commit `cd6c780e795b86f6f198f7e1697236de0008c3b7`, branch `phase0-s4-player-state` (the branch tip *is* `cd6c780`; confirmed via `git merge-base --is-ancestor cd6c780 HEAD` — no drift since S3).

Implemented per the approved S4 plan and the seven Owner-frozen pre-implementation decisions (15.1–15.7): `match_transfer_score` is read from the actually-stored nested `assessment.match_transfer.score` (a flat `match_transfer_score`, if ever present, still wins — literal pass-through only, no computation); `assessment_state` is an explicit whitelist projection that never exposes the raw Assessment object; `versions` is `null` when `assessment_state.availability==="NONE"` (never falls back to `PBCanonical`/`PBConfig` defaults); `integrity.status` is `"OK"|"ISSUES_PRESENT"` and represents data-integrity only, never player performance; training availability reuses S3's existing `overall.trial_count_total > 0` evidence-count semantics unchanged; unknown `player_id` rejects with a stable `err.code === "PLAYER_NOT_FOUND"`; the full S3 filter surface (`date_from`/`date_to`/`training_session_ids`/`source_drill_ids`/`master_ids`) is forwarded unchanged, never reinterpreted or narrowed.

## 1. Files created

- `js/player-training-state.js` — the `PBPlayerTrainingState` read-only module (`getPlayerTrainingState`). Depends on `PBStore` (`get`, `getByIndex` — read-only), `PBCanonical` (dependency-presence check only, no direct canonical reads), and `PBTrainingAnalytics` (`computeSnapshot`, called exactly once per invocation, filters forwarded verbatim). Never calls `pbStore.put`/`del`/`clearAll`; contains no scoring/threshold/weighting/bottleneck-ranking/recommendation/prescription/promotion/P0–P6 logic and never re-tallies raw `drill_evidence_events` outcomes.
- `tests/s4/selection.test.js` — S4-T08–T16, T10 (player_id required, unknown player rejected with `PLAYER_NOT_FOUND`, known-player no-mutation guard, zero/one-assessment cases, full 3-level tie-break chain, store-return-order independence).
- `tests/s4/fields.test.js` — S4-T17–T22 plus explicit 15.1/15.2 coverage (exact field pass-through, missing→null never synthesized, stored `0`≠`null`, no capability/validated-level computation from present component scores, DUPR/bottleneck/recommended_block pass-through only, nested `match_transfer.score` aliasing with flat-key priority, whitelist-only projection proof using an injected unknown field).
- `tests/s4/availability.test.js` — S4-T25–T26, T29–T32 (training availability on/off, full 2×2 assessment/training independence matrix).
- `tests/s4/integrity.test.js` — S4-T27 plus explicit 15.4 coverage (verbatim `analytics.integrity` propagation, `OK`→`ISSUES_PRESENT` flip, and a zero-evidence-but-clean-data case proving `status` is not a performance signal).
- `tests/s4/reuse.test.js` — S4-T23, T24, T28 plus explicit 15.7 coverage (static no-duplicate-aggregation guard, `training_state.analytics` deep-equal against a direct `PBTrainingAnalytics.computeSnapshot` call, date-filter and full filter-surface forwarding proofs).
- `tests/s4/determinism.test.js` — S4-T33/T46 (repeated-call deep-equal across all four availability combinations).
- `tests/s4/architecture_guard.test.js` — S4-T06 (canonical 13/35 regression), T07 (`DB_VERSION`/`STORES` unchanged), T34 (static + behavioral no-write/no-delete guard), T20/T35/T36 (no scoring-engine keywords/formula weights ported), T37 (no recommend/prescribe/promote/P0–P6 logic — verified with field-name-collision-aware checks so the legitimate `recommended_block_id`/`primary_bottleneck`/`secondary_bottleneck` pass-through keys are not false positives), T41 (no npm/framework/bundler files).
- `tests/s4/script_order.test.js` — S4-T39.
- `tests/s4/service_worker.test.js` — S4-T40.
- `tests/s4/helpers/fake_store.js` — S4-local in-memory `PBStore` double; extends the S2 fake-store contract with the `assessments` store (`by_player` index) that S2 never needed. `tests/s2/helpers/fake_store.js` itself is untouched.
- `tests/s4/helpers/build_env.js` — Node test environment builder; reuses (does not duplicate) `tests/s2/helpers/canonical_facade.js`, and seeds evidence/assessments through the real, already-tested `js/training-evidence.js` write path and a storage.js-shape-mirroring `addAssessment` helper (`js/storage.js` itself cannot be constructed standalone in Node — it assumes a real browser `indexedDB` global).
- `docs/handoff/phase0-s4/S4_COMPLETION_REPORT.md` (this file).

## 2. Files modified

- `index.html` — one line: `<script src="./js/player-training-state.js"></script>` added after `training-analytics.js`, before the SW-registration inline script. No other line changed.
- `sw.js` — `CACHE` bumped `pb40-v18` → `pb40-v19`; `./js/player-training-state.js` added to `CORE`; comment header updated with the S4 entry. Fetch/cache strategy logic (network-first nav, stale-while-revalidate otherwise) untouched.

## 3. Files unchanged

`js/storage.js`, `js/canonical-runtime.js`, `js/masters-repo.js`, `js/training-evidence.js`, `js/training-analytics.js`, `js/app.js`, `js/assessment.js`, `js/metrics.js`, `js/preview.js`, `js/i18n.js`, `js/config-loader.js`, all of `data/`, all of `schemas/`, `tests/canonical/`, `tests/s1/`, `tests/s2/`, `tests/s3/`, `css/app.css`, `manifest.json`, `README.md`.

## 4. IndexedDB / schema confirmation

`js/storage.js` `DB_VERSION` remains `2`; `STORES` keys are exactly the S3 baseline (`players`, `assessments`, `test_sessions`, `trial_events`, `training_sessions`, `drill_evidence_events`) — no new object store, no new index, no schema bump. Enforced by `S4-T07` (static source check) and confirmed live in the real-browser proof (§6): `PBStore.getAll('assessments')`/`getAll('training_sessions')`/`getAll('drill_evidence_events')` before and after calling `PBPlayerTrainingState.getPlayerTrainingState` (across three players, both domains exercised) are byte-identical.

`PBPlayerTrainingState` never calls `pbStore.put`/`del`/`clearAll` — enforced both statically (source-text guard, S4-T34) and behaviorally (a wrapped store whose `put`/`del` throw is passed to `getPlayerTrainingState`, which still succeeds using only `get`/`getByIndex`).

## 5. Module design (as implemented)

- **Entry point**: `PBPlayerTrainingState.getPlayerTrainingState({ player_id, date_from, date_to, training_session_ids, source_drill_ids, master_ids })` → `Promise<snapshot>`. `player_id` is required and must resolve to an existing player (`PBStore.get('players', player_id)`), otherwise the call rejects with `err.code === 'PLAYER_NOT_FOUND'` (Owner-frozen 15.6) — never a normal empty-state resolve.
- **Schema**: `state_version: "PB30-50-S4-STATE-v1"`, `player_id`, `player.display_name`, `assessment_state` (explicit whitelist projection, Owner-frozen 15.2), `training_state` (`availability`, echoed `filter`, verbatim S3 `analytics`), top-level `availability` (mirrors both domains), `integrity` (`status` + verbatim `analytics_integrity`).
- **Assessment selection**: all of the player's assessments are fetched via `PBStore.getByIndex('assessments','by_player', player_id)` and sorted in-memory (store return order is never trusted) by `assessment_date` descending, then `created_at` descending, then `assessment_id` descending (lexicographic) as the final tie-break. Missing `assessment_date`/`created_at` are treated as `''` and never throw.
- **Field projection**: each of the 14 frozen fields (`assessment_date`, `assessment_tier`, `target_training_level`, `validated_training_level`, `capability_score_0_100`, `technical_score`, `decision_score`, `pressure_score`, `evidence_confidence`, `primary_bottleneck`, `secondary_bottleneck`, `recommended_block_id`, `dupr`, `external_validation_note`) plus `versions` (`schema_version`/`benchmark_version`/`protocol_version`) is read independently via `hasOwnProperty` (never `||`, so a stored `0` is never collapsed to `null`); absent fields surface as `null`, never fabricated. `match_transfer_score` reads a literal flat key first, then falls back to the actually-stored nested `assessment.match_transfer.score` (Owner-frozen 15.1) — still a pure pass-through, no arithmetic.
- **No full-object exposure**: `assessment_state` is built field-by-field into a fresh object (Owner-frozen 15.2); an assessment carrying unlisted fields (e.g. the `ue` object `assessment.js` also writes, or any hypothetical future field) never leaks into the snapshot — proved with an injected unknown field in `tests/s4/fields.test.js`.
- **Training composition**: `PBTrainingAnalytics.computeSnapshot` is called exactly once per invocation with all five filter parameters forwarded unchanged (Owner-frozen 15.7); the returned object is embedded verbatim as `training_state.analytics` — no re-aggregation, no re-tallying of `drill_evidence_events` (statically enforced, S4-T23).
- **Availability**: `assessment_state.availability` is `AVAILABLE` iff at least one assessment row exists for the player; `training_state.availability` reuses S3's own evidence-count semantics unchanged — `AVAILABLE` iff `analytics.overall.trial_count_total > 0` (Owner-frozen 15.5). The two are computed independently; neither gates, overwrites, or infers from the other (S4-T29–T32).
- **Integrity**: `integrity.analytics_integrity` is S3's `integrity` object copied verbatim (all four arrays). `integrity.status` is `"ISSUES_PRESENT"` iff any of those four arrays is non-empty, else `"OK"` — a pure presence/absence fold carrying no severity ranking and never derived from trial outcomes or scores (Owner-frozen 15.4).
- **No scoring/inference**: no capability-score formula, gate/threshold logic, evidence-confidence ranking, bottleneck inference, recommendation/prescription generation, promotion logic, P0–P6 planning, or DUPR interpretation exists anywhere in the module. `schemas/scoring_engine_reference_v2_3_1.py` was read only as a guardrail reference (to derive the forbidden-keyword list for `tests/s4/architecture_guard.test.js`) — no line of it was ported or reimplemented.
- **Determinism**: no sort ever depends on a computed value; repeated calls with identical input are deep-equal across all four availability combinations (empty/assessment-only/training-only/both), verified both in Node tests and in the real-browser proof.

## 6. Real-browser combined-state proof (real IndexedDB, real Chrome)

Performed via a plain Node `http` server (Node built-ins only, no npm) serving the actual repo, driving a **fresh, isolated headless-Chrome profile** (`--headless`, dedicated `--user-data-dir`, dedicated `--remote-debugging-port=9222`) through the DevTools Protocol (Node built-in `fetch`/`WebSocket`), against the real, unmodified, shipped `index.html`/`sw.js`/`js/*`:

1. Created 3 players through the real app: **Player A** (both domains) — 1 assessment (`standard` tier, target `4.0`) with a `match_transfer` patch (`score: 65`, via the real `saveMatch`-shaped `PBStore.updateAssessment` path) plus training evidence across 2 Drills/2 Masters (`DRILL-BALANCE`: 1×S + 1×F, `DRILL-SERVE-DEPTH`: 1×P); **Player B** (training-only) — 1 evidence trial, no assessment; **Player C** (assessment-only) — 1 assessment (`lite` tier, target `3.5`), zero training evidence. All writes via the real `PBStore.createAssessment`/`updateAssessment` and `PBTrainingEvidence.createSession`/`addEvidence` paths.
2. Independently read the raw `assessments`/`training_sessions`/`drill_evidence_events` rows via `PBStore.getAll` **before** any `PBPlayerTrainingState` call.
3. Called `PBPlayerTrainingState.getPlayerTrainingState({player_id})` for Player A **twice**, plus once each for Players B and C, plus once for a nonexistent player.
4. Re-read the raw rows **after**.
5. All assertions performed in the Node harness against raw dumps and independent direct-S3 calls — never trusting the module's own output in isolation:

```
S4 REAL-BROWSER COMBINED-STATE PROOF: PASS

smoke: title="Drills Path from 3.0 to 5.0", readyState=complete,
       PBStore/PBCanonical/PBTrainingEvidence/PBTrainingAnalytics/PBPlayerTrainingState all typeof "object"

before/after raw dump (assessments + training_sessions + drill_evidence_events): deep-equal
  → PBPlayerTrainingState performed no mutation                                             (T47)
snap1/snap2 for Player A: deep-equal                                                        (T46)

T43 (both domains, Player A):
  assessment_state.availability=AVAILABLE, selected_assessment_id matches created asm,
  assessment_tier="standard", target_training_level=4.0
  match_transfer_score=65   (15.1: nested assessment.match_transfer.score aliased correctly)
  training_state.availability=AVAILABLE, overall.trial_count_total=3
  training_state.analytics === direct PBTrainingAnalytics.computeSnapshot() call            (T28)
  integrity.status=OK

T44 (training-only, Player B):
  assessment_state.availability=NONE, selected_assessment_id=null, versions=null            (15.3)
  training_state.availability=AVAILABLE

T45 (assessment-only, Player C):
  assessment_state.availability=AVAILABLE, selected_assessment_id matches created asm
  training_state.availability=NONE, analytics object present and zero-filled

Unknown player_id: rejected=true, code="PLAYER_NOT_FOUND"                                    (15.6)
```

**Chrome process hygiene** (per the S2/S3 incident this instruction was written in response to): the harness tracked the exact spawned Chrome PID (`8936`) and killed only that PID (`taskkill /F /T /PID 8936`) in a `finally` block. Verified before and after the run: `tasklist` showed **16** pre-existing, unrelated `chrome.exe` processes (the user's live browser session) both before and after — unchanged — while the harness's own PID was confirmed absent post-run (`tasklist /FI "PID eq 8936"` → no matching tasks). No blanket `/IM chrome.exe` kill was used anywhere.

## 7. Browser smoke

Performed in the same real-browser session as the combined-state proof (post-navigation to the real, unmodified app): `document.title === "Drills Path from 3.0 to 5.0"`, `document.readyState === "complete"`, and `typeof PBStore / PBCanonical / PBTrainingEvidence / PBTrainingAnalytics / PBPlayerTrainingState === "object"` for all five — confirming `js/player-training-state.js` loads and initializes correctly in the real script-tag chain alongside every existing global, with no console/script errors.

## 8. All test results

```
node --test tests/canonical/*.test.js tests/s1/*.test.js tests/s2/*.test.js tests/s3/*.test.js tests/s4/*.test.js

tests 180
pass  180
fail  0
```

- S0 regression (`tests/canonical/`): 27/27 PASS (unchanged).
- S1 regression (`tests/s1/`): 18/18 PASS (unchanged).
- S2 regression (`tests/s2/`): 43/43 PASS (unchanged).
- S3 regression (`tests/s3/`): 44/44 PASS (unchanged).
- S4 suite: 48/48 PASS, covering S4-T06–T09, T10–T28, T29–T37, T39–T41, T46 (T01 verified separately below; T38 via scope discipline in this report and the plan; T42–T45, T47 via §6).

## 9. S4 Test Matrix disposition

| Item(s) | Disposition |
|---|---|
| T01 S3 ancestry | Verified: branch tip **is** `cd6c780`, confirmed via `git merge-base --is-ancestor`. |
| T02–T05 S0/S1/S2/S3 tests pass | §8 (132/132 upstream unchanged). |
| T06 canonical 13/35 unchanged | `tests/s4/architecture_guard.test.js` + §8. |
| T07 pb_v2 v2 | `tests/s4/architecture_guard.test.js` + §4. |
| T08–T16 selection | `tests/s4/selection.test.js`, §8. |
| T17–T22 field pass-through/DUPR/bottleneck | `tests/s4/fields.test.js`, §8. |
| T20 no score/level/confidence computation | `tests/s4/fields.test.js` (behavioral) + `tests/s4/architecture_guard.test.js` (static), §8. |
| T23 uses S3 rather than duplicate aggregation | `tests/s4/reuse.test.js` (static), §8. |
| T24 date semantics identical to S3 | `tests/s4/reuse.test.js`, §8. |
| T25–T26, T29–T32 availability | `tests/s4/availability.test.js`, §8. |
| T27 S3 integrity propagated | `tests/s4/integrity.test.js`, §8. |
| T28 training analytics equals direct S3 call | `tests/s4/reuse.test.js`, §8 + §6 (T43 in-browser). |
| T33, T46 determinism | `tests/s4/determinism.test.js`, §8 + §6 (in-browser repeat). |
| T34 no PBStore writes/deletes | `tests/s4/architecture_guard.test.js`, §4. |
| T35 no IndexedDB schema change | `tests/s4/architecture_guard.test.js`, §4. |
| T36 no scoring engine implementation | `tests/s4/architecture_guard.test.js`, §8. |
| T37 no recommendation/prescription/P0–P6/promotion | `tests/s4/architecture_guard.test.js`, §8. |
| T38 no S5 | Confirmed by scope discipline — no S5 file/branch/logic introduced anywhere in this change set. |
| T39 script order | `tests/s4/script_order.test.js`. |
| T40 SW cache | `tests/s4/service_worker.test.js`. |
| T41 no npm/framework/server DB | `tests/s4/architecture_guard.test.js`. |
| T42 diff limited to S4 | §10 below. |
| T43 browser both-domains combined state exact | §6. |
| T44 browser training-only state exact | §6. |
| T45 browser assessment-only state exact | §6. |
| T46 repeated call deep-equal | §8 + §6. |
| T47 raw assessment/training records unchanged before/after | §6. |

## 10. Git status

```
On branch phase0-s4-player-state
Changes not staged for commit:
	modified:   index.html
	modified:   sw.js

Untracked files:
	docs/handoff/phase0-s4/   (includes this report + the pre-existing owner/GPT handoff package)
	js/player-training-state.js
	tests/s4/
```

`git diff --stat`: 2 files changed, 6 insertions(+), 3 deletions(-) — `index.html` (+1 line) and `sw.js` (version bump + one CORE entry + comment). Every changed line matches §1/§2 above; no unexpected file shows a diff. **Nothing staged, committed, merged, or pushed.**

## 11. Owner-frozen decisions (15.1–15.7) — implementation trace

| # | Decision | Where enforced |
|---|---|---|
| 15.1 | `match_transfer_score` reads the actually-stored nested `match_transfer.score` (flat key wins if ever present); literal pass-through only | `js/player-training-state.js` `matchTransferScore()`; `tests/s4/fields.test.js`; §6 (T43, `score=65`) |
| 15.2 | Explicit whitelist projection — full Assessment object never exposed | `js/player-training-state.js` `projectAssessment()`; `tests/s4/fields.test.js` (injected unknown-field proof) |
| 15.3 | `versions` is `null` when assessment `NONE` — no PBCanonical/PBConfig fallback | `js/player-training-state.js` `emptyAssessmentState()`; §6 (T44) |
| 15.4 | `integrity.status` is data-integrity only, never a performance signal | `js/player-training-state.js` presence/absence fold; `tests/s4/integrity.test.js` (zero-evidence-but-clean = OK case) |
| 15.5 | Training availability reuses S3's `overall.trial_count_total > 0` semantics unchanged | `js/player-training-state.js`; `tests/s4/availability.test.js` |
| 15.6 | Unknown `player_id` rejects with stable `err.code === 'PLAYER_NOT_FOUND'` | `js/player-training-state.js` `playerNotFoundError()`; `tests/s4/selection.test.js`; §6 (in-browser rejection check) |
| 15.7 | Full S3 filter surface forwarded unchanged, no reinterpretation | `js/player-training-state.js` `getPlayerTrainingState()`; `tests/s4/reuse.test.js` |

## 12. Deviations / risks / notes

- **`tests/s4/helpers/fake_store.js` duplicates a small amount of `tests/s2/helpers/fake_store.js`** (same put/get/getAll/del/getByIndex shape) rather than extending it in place, specifically to avoid modifying anything under `tests/s2/` (frozen per S3's own acceptance gate). The duplication is confined to test fixtures, not production logic — `js/player-training-state.js` itself introduces zero duplicate aggregation logic (S4-T23).
- **`js/storage.js` cannot be `require()`d standalone in Node** (its `open()` immediately references the browser-only `indexedDB` global), so `tests/s4/helpers/build_env.js#addAssessment` mirrors — rather than calls — `PBStore.createAssessment`'s object shape when seeding Node-test fixtures. This is the same constraint S1–S3's own Node test suites already work under; the real-browser proof (§6) exercises the actual `PBStore.createAssessment`/`updateAssessment` code paths directly, closing this gap end-to-end.
- **The `ue` object** that `assessment.js`'s Match Entry screen also writes via `PBStore.updateAssessment` is deliberately **not** exposed anywhere in `assessment_state` (not on the frozen field list) — confirmed absent by `tests/s4/fields.test.js`'s whitelist-projection test.
- No UI was added or changed (out of scope, confirmed by inspection and by the S1–S3-baseline UI script-order/SW checks in `tests/s4/script_order.test.js`/`service_worker.test.js` passing unchanged).
- S5 was not started; no S5-named files, branches, or logic were introduced.

---

**S4 COMPLETION RECOMMENDATION: PASS**
