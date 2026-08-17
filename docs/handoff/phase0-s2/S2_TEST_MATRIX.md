# S2 Test Matrix

- S2-T01 branch descends from frozen S1
- S2-T02 S0 tests remain green
- S2-T03 S1 tests remain green
- S2-T04 DB_VERSION becomes 2
- S2-T05 real browser v1→v2 upgrade is additive
- S2-T06 representative pre-existing assessment records survive upgrade
- S2-T07 training_sessions store/indexes exist
- S2-T08 drill_evidence_events store/indexes exist
- S2-T09 createTrainingSession persists valid record
- S2-T10 unknown player behavior deterministic
- S2-T11 valid canonical Drill evidence persists
- S2-T12 unknown source_drill_id rejected
- S2-T13 conflicting caller master_id cannot corrupt mapping
- S2-T14 all 35 Drill IDs derive correct Master
- S2-T15 S/P/F/I accepted
- S2-T16 invalid outcome rejected
- S2-T17 query by session works
- S2-T18 query by Drill works
- S2-T19 export deterministic
- S2-T20 delete session cascades evidence
- S2-T21 no canonical definitions copied into records
- S2-T22 no scoring/recommendation/promotion logic
- S2-T23 correct script load order
- S2-T24 service worker caches new module and bumps version
- S2-T25 no npm/framework/server DB introduced
- S2-T26 existing UI/assessment startup smoke PASS
- S2-T27 canonical 13/35 unchanged
- S2-T28 stale README statement corrected accurately

Required migration proof:
Create a real v1 `pb_v2` database with representative records in all four existing stores, then load S2 and verify DB v2,
old records unchanged, and new stores usable. Do not replace this with source-code-only assertion.
