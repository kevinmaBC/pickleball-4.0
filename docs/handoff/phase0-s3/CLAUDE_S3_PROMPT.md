# Claude Code Prompt — S3
Work on S3 only.
Read every file in `docs/handoff/phase0-s3/`.
Inspect `js/training-evidence.js`, `js/storage.js`, `js/canonical-runtime.js`, `js/masters-repo.js`, `index.html`, `sw.js`, S2 completion report, and all S0/S1/S2 tests.
Verify ancestry from `a4e98a3` and run all upstream tests.

PLAN ONLY. Do not modify/create/delete/stage/commit/push.

Plan must specify:
1 current S2 evidence APIs/stores;
2 proposed PBTrainingAnalytics API;
3 exact snapshot schema;
4 S/P/F/I formulas + zero handling;
5 Drill/Master/KPI grouping;
6 filter semantics;
7 corrupt-ID handling;
8 deterministic sorting;
9 CREATE/MODIFY/UNCHANGED files;
10 confirmation no IndexedDB change;
11 script/SW changes;
12 tests;
13 real-browser aggregation proof;
14 Acceptance mapping;
15 owner decisions/risks;
16 explicit confirmation no score/threshold/bottleneck/recommendation/prescription/promotion/P0–P6/S4.

Strong default: one read-only analytics module, on-demand computation, no persisted analytics store, no UI redesign.

End exactly:
`S3 PLAN RECOMMENDATION: GO`
or `S3 PLAN RECOMMENDATION: GO WITH CONDITIONS`
or `S3 PLAN RECOMMENDATION: NO-GO`
Then STOP.
