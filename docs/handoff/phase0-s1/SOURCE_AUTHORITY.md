# S1 Source Authority

## Frozen upstream baseline
- Repository: `kevinmaBC/pickleball-4.0`
- S0 frozen commit: `be4617448d77af4080f1101a33f64304d23f9c10`

## Canonical authority hierarchy
1. SSOT: `docs/handoff/phase0-s0/seed_data.json`
2. Deterministic runtime artifact: `data/canonical/seed_data.json`
3. Runtime query implementation: `js/masters-repo.js`

S1 must not create another canonical Drill/Master dataset.

Do not alter Master membership or Drill source fields:
`source_drill_id`, `level_range`, `progression`, `purpose`, `setup`, `feed`, `dose`,
`success_criterion`, `primary_kpi`, `secondary_kpis`, `evidence`, `match_transfer`.

All S0 tests must remain green.
