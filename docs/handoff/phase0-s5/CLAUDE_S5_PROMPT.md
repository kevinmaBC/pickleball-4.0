# Claude S5 Prompt — PLAN ONLY

Base commit: `cb8b67a5b9b28c34f64b4efe93ca61de08e49e23`.
Read the six S5 core files in `docs/handoff/phase0-s5/`.
Inspect player-training-state.js, assessment.js, metrics.js, storage.js,
level_gates_v2_3_1.json, evidence_confidence_v2_3_1.json,
test_definitions_v2_3_1.json, prescription_rules_v2_3_1.json (boundary only),
scoring_engine_reference_v2_3_1.py, assessment_schema_v2_3_1.json, and all S0–S4 tests/reports.
Verify ancestry and run upstream tests.

PLAN ONLY. Do not modify/create/delete/stage/commit/push.

Plan must define:
1 config authority/load strategy;
2 JS↔Python parity strategy;
3 missing gate-metric behavior;
4 null/zero component behavior;
5 explicit evidence-confidence input semantics;
6 match-validation semantics;
7 BORDERLINE semantics;
8 validated-level semantics;
9 provisional 4.5/5.0 handling;
10 PBAssessmentClassifier API;
11 CREATE/MODIFY/UNCHANGED files;
12 browser/SW strategy;
13 exact tests;
14 Acceptance mapping;
15 risks/Owner decisions;
16 proof that S5 does not derive confidence, bottleneck, recommendation, prescription, P0–P6, promotion, DUPR interpretation, or S6;
17 confirmation that S3 training analytics is not converted into formal assessment metrics.

If repository reality conflicts with the frozen scoring reference, STOP for Owner decision.

End exactly:
`S5 PLAN RECOMMENDATION: GO`
or `S5 PLAN RECOMMENDATION: GO WITH CONDITIONS`
or `S5 PLAN RECOMMENDATION: NO-GO`
Then STOP.
