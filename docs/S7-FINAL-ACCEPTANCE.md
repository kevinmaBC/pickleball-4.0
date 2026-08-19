# S7 Final Acceptance (S7-F)

Baseline SHA tested: `f652e1fc5a44ec34ab3f675601c4602fccca9929` (branch `app-v2-alpha`, clean tree, `main` unchanged at `f10d73ad6cbed337561a6115889e055a19a68bc7`).

## Test matrix

| Layer | Suite | Result |
|---|---|---|
| S7-A | `tests/namespace.test.js` | PASS |
| S7-A | `tests/storage.test.js` (fake-IDB migration) | PASS |
| S7-B | `tests/review-engine.test.js` | PASS |
| S7-C | `tests/trend-engine.test.js` (+ integration) | PASS |
| S7-D | `tests/retest-engine.test.js` (+ integration) | PASS |
| S7-E | `tests/review-ui.test.js` | PASS |
| S1–S6 | `node --check` on all 12 `js/*.js` files | PASS (no dedicated unit suite exists for these UI modules; verified live in browser instead) |

## Methodology audit (Master Control V2)

All PASS. No active violation found in shipped code; forbidden terms (DUPR, decimal levels, C0, 35/25/20/20, Drop Apex, Training Dose) appear only in compliance-negation comments.

- Validated level: only 3.0/3.5/4.0/4.5/5.0 ever displayed (`fmtLevel`); no S7 code path writes `validated_training_level`; `PROMOTION_REVIEW_ELIGIBLE` wording explicitly reads "review eligible, not promoted."
- CAP: `{technical:0.45, decision:0.30, pressure:0.25}`; `computeCAP` takes no Match Transfer input; missing domain → `null`/`INCOMPLETE`, never 0.
- Match Transfer: separate `match_transfer_score`/`match_transfer_trend`, never merged into CAP; UI renders it in its own section; `match_transfer_mode==='simplified'` shown with an explicit "Simplified / Provisional Evidence" label.
- Evidence: `EVIDENCE_RANK={C1,C2,C3,C4}`, no C0; sample insufficiency downgrades formal gate status to `INCOMPLETE`, never silently to `MET`.
- Namespace: `ASMT-01..10` canonical, `T01..T10` legacy alias only (`namespace.js`), unknown IDs map to `null`.
- Hard-gate transitions: `EVIDENCE_COMPLETED` is a distinct branch from `PROGRESSED` in both `trend-engine.js` (`classifyGateTransition`) and `retest-engine.js` (never mapped to `POSITIVE_RESPONSE`/`EFFECTIVE`).
- Bottleneck movement: `null → null` yields `NONE`, not `PERSISTENT`.

## Acceptance scenarios (A–L)

All 12 verified against live production code (browser console, real `PBStore`/`PBReview`/`PBTrend`/`PBRetest`/`PBReviewUI`, not test doubles):

A (no history) · B (BASELINE_ONLY) · C (DIRECTIONAL) · D (TREND_ELIGIBLE) · E (72/null/78 — calc `[72,78]`, display `[72,null,78]`, 2 dots/0 connecting paths) · F (Performance MET / Sample INSUFFICIENT / Formal INCOMPLETE) · G (EVIDENCE_COMPLETED → response `INCOMPLETE`, effectiveness `INCOMPLETE`) · H (true progression → `POSITIVE_RESPONSE`/`EFFECTIVE`) · I (Match Transfer missing, CAP unaffected) · J (`PROMOTION_REVIEW_ELIGIBLE`, wording confirms not promoted) · K (3.87 → `INCOMPLETE`) · L (bottleneck `null→null` → `NONE`).

All PASS. No console errors during any scenario.

## Known non-blocking limitations

- **Service worker cache staleness for pre-existing installs only:** the three post-S7-E fix commits did not bump `sw.js`'s `CACHE` constant (consistent with every other S7 fix-only commit). A device that already had the original S7-E service worker (`pb40-v20`) installed before those fixes may serve one stale reload of `review-ui.js`/`trend-engine.js` under stale-while-revalidate before self-healing on the next reload. A genuinely fresh install/reload is unaffected — confirmed via a clean-origin browser test (fresh IndexedDB + no prior SW) loading the current code correctly on the first load, with no console errors.
- No dedicated automated regression suite exists for the pre-S7 UI modules (`app.js`, `assessment.js`, `metrics.js`, `preview.js`); verified via `node --check` (syntax) and live navigation across all tabs (Home/Learn/Drill/Measure/Review/Compete/Team) instead.

## Final status

**S7 ACCEPTED WITH NON-BLOCKING LIMITATIONS**
