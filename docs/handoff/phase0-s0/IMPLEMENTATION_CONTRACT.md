# APP-V2 Phase 0 / S0 — Implementation Contract

## Objective

Create the **data foundation only** for the Pickleball 3.0–5.0 app. S0 is not a UI sprint and not a recommendation-engine sprint.

The repository must end S0 with a canonical, testable, immutable training-content foundation containing exactly:

- **13 frozen Masters**
- **35 frozen GREEN35 source drills**
- stable source identifiers
- master-to-drill mapping
- repository-native persistence/migration support
- automated source-integrity tests

## Authority hierarchy

1. `seed_data.json` in this handoff package is the S0 canonical seed.
2. `PB30-50_W4B005_Runtime_Spec_v1.0.json` is the runtime contract.
3. `PB30-50_W4B006_MVP_Developer_Handoff_v1.0.json` is the MVP product contract.
4. Existing repository/framework conventions govern implementation mechanics only.

If implementation convenience conflicts with canonical source content, **canonical source content wins**.

## Hard constraints

The following drill fields are source-owned and must not be rewritten by runtime code:

- `source_drill_id`
- `level_range`
- `progression`
- `purpose`
- `setup`
- `feed`
- `dose`
- `success_criterion`
- `primary_kpi`
- `secondary_kpis`
- `evidence`
- `match_transfer`

Master identity and master→drill membership are also frozen in S0.

## Stack rule

Do **not** replace or re-platform the existing application stack.

Claude/Codex must first inspect the repository and then:

- use its current package manager;
- use its current database layer/ORM if present;
- use its current migration mechanism if present;
- use its current test runner;
- follow current naming and directory conventions.

If no persistence layer exists, add the smallest repository-compatible solution and document the decision. Do not introduce a large framework merely for S0.

## Required S0 implementation

1. Add canonical seed data to the repository.
2. Add persistence/schema objects for `Master` and `Drill` (or repository-equivalent names).
3. Enforce unique stable IDs.
4. Store the complete source-owned payload.
5. Seed exactly 13 Masters and exactly 35 Drills.
6. Enforce that every drill belongs to exactly one frozen Master.
7. Add automated tests for counts, unique IDs, mapping coverage, and source immutability.
8. Add a small repository-level accessor/query that can retrieve:
   - a Master by `master_id`;
   - a Drill by `source_drill_id`;
   - all drills under a Master.
9. Document how to run migration, seed, and tests.

## Explicitly out of scope for S0

Do not implement:

- Player profile UI
- Today plan
- Priority P0–P6 runtime
- Session Runner
- evidence capture
- Match Transfer UI
- trends
- promotion
- AI coaching
- video analysis
- social features
- DUPR/rating prediction

## Definition of Done

S0 is complete only when the S0 acceptance gate passes and the repository contains no silent mutations of canonical source content.
