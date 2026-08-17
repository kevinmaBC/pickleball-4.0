# Claude / Codex Prompt — APP-V2 Phase 0, S0 Data Foundation

You are implementing **S0 only** in the existing `app-v2-alpha` repository.

## Read first

Before changing code, inspect the repository and determine:

- current application framework;
- package manager;
- database / ORM, if any;
- migration approach;
- test runner;
- directory and naming conventions.

Do not replace the existing stack.

Then read these handoff files in order:

1. `IMPLEMENTATION_CONTRACT.md`
2. `SOURCE_AUTHORITY.md`
3. `S0_ACCEPTANCE_GATE.md`
4. `seed_data.schema.json`
5. `seed_data.json`

## Your single objective

Implement the repository's **canonical data foundation** for the Pickleball 3.0–5.0 Training Engine.

You must persist exactly:

- **13 Masters**
- **35 canonical GREEN35 Drills**

and preserve their frozen source content.

## Required work

1. Put canonical seed files in an appropriate repository data location.
2. Add/reuse database schema for Master and Drill.
3. Add/reuse migrations.
4. Seed all canonical data.
5. Enforce stable unique IDs.
6. Enforce each Drill belongs to exactly one frozen Master.
7. Add tests:
   - count = 13 Masters;
   - count = 35 Drills;
   - IDs unique;
   - 35/35 mapping coverage;
   - no extra/missing canonical Drill;
   - source-owned field fidelity;
   - immutability guards for source-owned content.
8. Add minimal repository query/access layer:
   - Master by ID;
   - Drill by ID;
   - Drills by Master.
9. Document exact commands for migrate, seed, and test.

## Immutable source-owned Drill fields

Do not alter:

`source_drill_id`, `level_range`, `progression`, `purpose`, `setup`, `feed`, `dose`,
`success_criterion`, `primary_kpi`, `secondary_kpis`, `evidence`, `match_transfer`.

Do not reinterpret Master membership.

## Strictly out of scope

Do not build S1 or any UI. Do not implement player profiles, Today plan, P0–P6 selection,
session evidence, match transfer UI, trends, promotion, AI coaching, video analysis,
social features, or rating prediction.

## Completion discipline

Run the complete S0 acceptance gate.

If any acceptance item fails, fix S0 only.

When S0 passes, **STOP** and report:

- changed files;
- schema/migration created;
- canonical seed counts;
- tests executed and results;
- exceptions, if any;
- branch/commit hash if available.

Do not start S1.
