# S9-FINAL: Full-System QA / Final Acceptance

QA Execution Contractor role — this stage verifies the accepted S9-B →
S9-F pipeline as a system. It adds no business logic, no redesign, no
new feature; it adds only a QA test file and this document.

## Baseline

- Branch: `app-v2-alpha`
- Accepted S9-F HEAD (verified at QA start): `66aa6870c5f3a6e26032bea767eebe83cc866f99`
- Working tree at QA start: clean
- QA date: 2026-08-20

## Files added by QA

- `tests/s9-full-system-qa.test.js`
- `docs/S9-FINAL-ACCEPTANCE.md` (this file)

## Production files modified

**NONE.** `git status`/`git diff` at the end of this stage show only the
two files above as new; every tracked file is byte-identical to the
accepted `66aa687` baseline.

## Final Acceptance Gates

| Gate | Description | Verdict | Evidence |
|---|---|---|---|
| FA-01 | Accepted HEAD correct | **PASS** | `git rev-parse HEAD` at QA start returned `66aa6870c5f3a6e26032bea767eebe83cc866f99` exactly. (Verified once via git at QA start, not re-asserted inside the test file — a hardcoded HEAD-SHA assertion would go stale the instant this stage's own commit lands.) |
| FA-02 | Repository clean at start | **PASS** | `git status --porcelain` at QA start returned empty. |
| FA-03 | Accepted S9 modules intact | **PASS** | `tests/s9-full-system-qa.test.js` FA-03 block: all 5 production modules and all 5 accepted test files exist; each module's expected export surface (including `DIAGNOSIS_VERSION`/`RECOMMENDATION_VERSION`/`PRESCRIPTION_VERSION`) is present and unrenamed. |
| FA-04 | Dependency direction correct | **PASS** | FA-04 block: comment-stripped source inspection of all 4 downstream engines confirms each references exactly its one legitimate upstream dependency (`PBMatchObservation`/`PBStore`/`PBNamespace` for S9-C; `PBPerformanceAnalysis` for S9-D; `PBDiagnosis` for S9-E; `PBRecommendationPriority` for S9-F) and never any forbidden module. |
| FA-05 | Source-of-truth boundaries intact | **PASS** | FA-05 block: stronger than a static grep — `PBStore`, `PBMatchObservation`, `PBPerformanceAnalysis`, and (for S9-E/S9-F) `PBDiagnosis` are deleted from `global` at runtime, and `PBDiagnosis.diagnoseAnalysis`, `PBRecommendationPriority.prioritizeDiagnosis`, and `PBTrainingPrescription.prescribeRecommendations` are proven to still function correctly using only their argument object. |
| FA-06 | Full happy-path E2E PASS | **PASS** | FA-06 block: a real 8-rally `drop`/`error` fixture (no upstream threshold altered) produces, using the system's actual rules, a `low_success_rate` PatternCandidate → `SHOT_EXECUTION_GAP` SkillGap → `IMPROVE_SHOT_EXECUTION` Recommendation → a Prescription with `training_objective_code=SHOT_EXECUTION`, `training_mode=TECHNICAL_REPETITION`, `kpi_profile_code=EXECUTION_SUCCESS_RATE`, and `source_recommendation_id` resolving correctly. |
| FA-07 | Low-evidence E2E PASS | **PASS** | FA-07 block: a real 3-rally fixture (LOW confidence band, 35 < 40 gate) produces no supported SkillGap, no active Recommendation, and no Prescription for that skill — confirming "no evidence" is never conflated with "bad performance." |
| FA-08 | Unsupported semantics PASS | **PASS** | FA-08 block: an unsupported pattern type (`repeated_positioning_error`) yields no supported diagnosis; an unmapped `diagnosis_code` yields a deferred `UNSUPPORTED_DIAGNOSIS` recommendation; an unmapped `recommendation_code` yields a deferred `UNSUPPORTED_RECOMMENDATION` prescription. No generic fallback observed at any stage. |
| FA-09 | Null != zero semantics PASS | **PASS** | FA-09 block: a null `priority_signal` defers with `MISSING_PRIORITY_SIGNAL` (never becomes an active recommendation with score 0); an unresolved KPI target stays `null`/`BENCHMARK_NOT_RESOLVED`; an unresolved drill stays `[]`/`UNRESOLVED` — none is coerced to `0`/`false`/`'failed'`. |
| FA-10 | Traceability PASS | **PASS** | FA-10 block: the full ID chain for the happy-path fixture is asserted end to end — `Prescription.source_recommendation_id` → real `Recommendation` → `source_skill_gap_ids` → real `SkillGap` → `evidence_pattern_ids` → real `PatternCandidate` → `evidence` → real persisted `trial_event_id`s (cross-checked directly against `PBStore.trialsBySession`). |
| FA-11 | Determinism PASS | **PASS** | FA-11 block: the downstream pipeline (Analysis → Diagnosis → Recommendation → Prescription) is run twice against the same already-persisted match session; `JSON.stringify` output is identical at every stage across both runs. |
| FA-12 | Priority inheritance PASS | **PASS** | FA-12 block: `SkillGap.priority_signal === Recommendation.priority_score === Prescription.priority_score` on the real happy-path chain, exact equality, not recomputed. |
| FA-13 | Rank inheritance PASS | **PASS** | FA-13 block: `Recommendation.rank === Prescription.priority_rank` and `Recommendation.priority_tier === Prescription.priority_tier` on the real happy-path chain. |
| FA-14 | No score inflation | **PASS** | FA-14 block: two SkillGaps of identical recommendation identity with `priority_signal` 68 and 74 merge to a single Recommendation with `priority_score = 74` (max), explicitly never `142` (sum). |
| FA-15 | No arbitrary KPI benchmark | **PASS** | FA-15/16/17 block: structural scan of all four downstream engines' comment-stripped source for `reps`/`balls`/`minutes`/etc. finds none; the real happy-path Prescription's `kpi_target_value` is `null`. |
| FA-16 | No arbitrary training dosage | **PASS** | Same block: the real happy-path Prescription's `dosage_profile_code` is one of exactly `PRIMARY_FOCUS`/`STANDARD_FOCUS`/`LIGHT_FOCUS`, never a number. |
| FA-17 | No fabricated drill | **PASS** | Same block: the real happy-path Prescription's `resolved_drill_ids` is `[]`. |
| FA-18 | No rating leakage | **PASS** | FA-18 block: structural scan of all five S9-B–F production files' comment-stripped source for `rating_upgrade`/`rating_downgrade`/`validated_training_level`/`dupr_prediction` finds none. |
| FA-19 | Drill unresolved semantics valid | **PASS** | FA-19/20 block: on the real happy-path Prescription, `resolved_drill_ids=[]` and `drill_resolution_status='UNRESOLVED'` coexist with `status='prescribed'` — unresolved is not treated as failure. |
| FA-20 | KPI unresolved semantics valid | **PASS** | Same block: `kpi_target_value=null` and `kpi_target_status='BENCHMARK_NOT_RESOLVED'` coexist with `status='prescribed'`. |
| FA-21 | Reassessment loop valid | **PASS** | FA-21 block: every Prescription in the happy-path result carries `reassessment_profile_code='MATCH_RECHECK'`; structural scan finds no `auto_progression`/`auto_promote`/`auto_success` anywhere in S9-D/E/F source. |
| FA-22 | Partial-data resilience PASS | **PASS** | FA-22 block: empty arrays at every stage boundary, plus a mixed batch of `null`/`{}`/wrong-status/valid-with-null-skill recommendations fed to S9-F, all resolve without a crash — malformed entries defer explicitly, the one valid entry (with `skill=null`) is still correctly prescribed, and no NaN/Infinity appears anywhere in the output. |
| FA-23 | Full regression PASS | **PASS** | `node tests/*.test.js` — all 22 suites (21 previously accepted S1–S9-F suites + the new `s9-full-system-qa.test.js`) pass with zero failures. No existing test file was modified. |
| FA-24 | Production code unchanged | **PASS** | `git status --porcelain` / `git diff` after QA show only `tests/s9-full-system-qa.test.js` and `docs/S9-FINAL-ACCEPTANCE.md` as new files; zero tracked files modified. |

**FA-01 through FA-24: 24/24 PASS.**

## Regression result

```
node tests/s9-full-system-qa.test.js  -> PASS
node tests/*.test.js                  -> 22/22 suites PASS
```

## Known accepted limitations

These are carried-forward, previously-documented design boundaries —
not defects, and not deleted or hidden by this QA pass:

1. No direct under-pressure evidence in S9-B — `pressure_failure`
   remains an unsupported diagnosis in V1 (S9-C Semantic Correction V1
   / S9-D §13).
2. Positioning error is not automatically diagnosed without a frozen
   evidence mapping — `repeated_positioning_error` remains unsupported
   (S9-C Semantic Correction V1 / S9-D §13).
3. Intra-rally sequences are limited by S9-B's rally-level granularity
   (1 `trial_event` = 1 rally, not 1 shot) — `third_to_fifth_continuation`
   and `nvz_arrival` remain structurally unavailable in S9-C, and
   `sequence_breakdown` remains unsupported in S9-D as a consequence.
4. Specific drill IDs may remain unresolved — no repo-registered drill
   registry has an exact semantic match to S9-F's `drill_family_code`
   taxonomy (S9-F §12, `data/prescription_rules_v2_3_1.json`'s
   T01–T09-keyed `BLOCK` registry was evaluated and correctly not
   reused).
5. KPI numeric targets may remain `BENCHMARK_NOT_RESOLVED` — no
   repo-registered numerical benchmark registry exists for S9-F's KPI
   profile taxonomy.
6. S9-F uses relative dosage profiles only (`PRIMARY_FOCUS`/
   `STANDARD_FOCUS`/`LIGHT_FOCUS`), never reps/minutes/frequency.
7. S9 (B through F) performs no player-level certification or rating
   promotion/demotion at any stage — it is a Performance Improvement
   System, not a Rating Certification System.

## Final QA verdict

```
S9 FINAL QA — ACCEPT
```
