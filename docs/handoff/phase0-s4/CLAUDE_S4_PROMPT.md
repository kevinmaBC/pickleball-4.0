# Claude Code Prompt — S4
Work on S4 only.
Read all `docs/handoff/phase0-s4/*`.
Inspect training-analytics.js, training-evidence.js, storage.js, canonical-runtime.js, index.html, sw.js,
assessment schema, scoring_engine_reference_v2_3_1.py as guardrail/reference only,
S3 completion report, and all S0-S3 tests.
Verify ancestry from `cd6c780` and run upstream tests.

PLAN ONLY. Do not modify/create/delete/stage/commit/push.

Plan must specify:
1 assessment persistence/query behavior;
2 exact assessment selection algorithm;
3 PBPlayerTrainingState API;
4 exact snapshot schema;
5 null/missing/zero semantics;
6 assessment/training availability;
7 S3 reuse without aggregation duplication;
8 integrity propagation;
9 CREATE/MODIFY/UNCHANGED files;
10 confirmation no DB change;
11 script/SW changes;
12 tests;
13 real-browser combined-state proof;
14 Acceptance mapping;
15 risks/Owner decisions;
16 confirmation no scoring/bottleneck/recommendation/prescription/P0–P6/promotion/S5.

Do not port the scoring reference or use it to fill missing values.

End exactly:
`S4 PLAN RECOMMENDATION: GO`
or `S4 PLAN RECOMMENDATION: GO WITH CONDITIONS`
or `S4 PLAN RECOMMENDATION: NO-GO`
Then STOP.
