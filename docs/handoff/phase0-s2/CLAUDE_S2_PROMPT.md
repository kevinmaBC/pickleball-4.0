# Claude Code Prompt — Phase 0 / S2 Canonical Training Session Evidence Core

Work on S2 only.

Before modifying anything, read all files in `docs/handoff/phase0-s2/`.

Also inspect:
`js/storage.js`, `js/canonical-runtime.js`, `js/masters-repo.js`, `index.html`, `sw.js`,
`js/assessment.js`, `docs/architecture/legacy_data_dependency_map.json`,
S0/S1 tests and completion reports, and `schemas/database_schema_v2_3_1.sql` as reference only.

Verify the current branch descends from S1 frozen commit `2c26387`.
Run all S0 + S1 tests before planning.

PLAN ONLY. Do not modify/create/delete/stage/commit/push.

Your S2 plan must include:
1. exact current IndexedDB schema/version;
2. safe v1→v2 migration;
3. storage.js vs separate training-evidence.js responsibility split;
4. exact new store schemas/indexes;
5. canonical Drill validation;
6. deterministic Master derivation;
7. input validation;
8. API signatures;
9. export/cascade behavior;
10. files CREATE/MODIFY/UNCHANGED;
11. script/PWA changes;
12. exact tests;
13. real-browser migration procedure;
14. browser smoke procedure;
15. Acceptance Gate mapping;
16. risks/open owner decisions;
17. confirmation no scoring/recommendation/promotion/P0–P6 logic.

Strong default: additive DB migration + separate thin training-evidence domain module using PBStore + PBCanonical.

End with exactly:
`S2 PLAN RECOMMENDATION: GO`
or `S2 PLAN RECOMMENDATION: GO WITH CONDITIONS`
or `S2 PLAN RECOMMENDATION: NO-GO`

Then STOP.
