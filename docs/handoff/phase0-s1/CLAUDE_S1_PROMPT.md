# Claude Code Prompt — Phase 0 / S1 Canonical Runtime Integration

You are working on S1 only.

## Inspection and PLAN first
Before modifying any file, inspect the repository and read completely:
1. `docs/handoff/phase0-s1/GPT_REPOSITORY_REVIEW.md`
2. `docs/handoff/phase0-s1/S0_DEPENDENCY.md`
3. `docs/handoff/phase0-s1/SOURCE_AUTHORITY.md`
4. `docs/handoff/phase0-s1/S1_SCOPE.md`
5. `docs/handoff/phase0-s1/IMPLEMENTATION_CONTRACT.md`
6. `docs/handoff/phase0-s1/S1_TEST_MATRIX.md`
7. `docs/handoff/phase0-s1/S1_ACCEPTANCE_GATE.md`
8. `docs/handoff/phase0-s1/phase1_manifest.json`

Also inspect:
`js/masters-repo.js`, `data/canonical/seed_data.json`,
`docs/handoff/phase0-s0/seed_data.json`, `index.html`, `sw.js`,
`js/app.js`, `js/assessment.js`, `js/config-loader.js`, `js/i18n.js`,
`js/metrics.js`, `js/storage.js`.

Verify the branch descends from `be46174`.
Run the S0 regression suite before planning.

## Produce an S1 Implementation Plan
Do NOT modify/create/delete/stage/commit/push anything yet.

Plan must include:
1. baseline verification;
2. exact current runtime script order;
3. proposed facade/bootstrap API + async lifecycle;
4. files to CREATE;
5. files to MODIFY;
6. files explicitly UNCHANGED;
7. SW/cache changes;
8. Legacy Data Dependency Map plan;
9. tests to add;
10. browser smoke procedure;
11. exact commands;
12. acceptance mapping;
13. risks/open decisions;
14. confirmation S0 source data will not change;
15. confirmation no package manager/framework/database will be added.

Strong default: minimal runtime bridge only. Do not bulk-migrate legacy app data in S1.

If you recommend migrating any legacy read path in S1, prove 1:1 semantic compatibility and mark it
as an OWNER DECISION. Do not implement it before approval.

End with exactly:
`S1 PLAN RECOMMENDATION: GO`
or `S1 PLAN RECOMMENDATION: GO WITH CONDITIONS`
or `S1 PLAN RECOMMENDATION: NO-GO`

Then STOP and wait for owner approval.

After owner approval only, implement the approved S1 plan, run all S0 + S1 tests and acceptance
audit, then stop before commit/push.
