# S3 Scope
## Objective
Compute deterministic read-only observations from S2 raw training evidence.

## In scope
- Add `js/training-analytics.js` (preferred).
- Aggregate literal S/P/F/I counts.
- Rates: total-denominator S/P/F/I rates; valid denominator uses S+P+F.
- Drill observations: source_drill_id, master_id, primary_kpi, secondary KPI ids, session count, counts/rates, date span.
- Master observations: Drill coverage, session count, counts/rates, date span.
- KPI observations: canonical KPI identifiers only; referenced/evidence-bearing Drill IDs; counts/rates.
- Filters: player, date window, session IDs, Drill, Master.
- Coverage: Masters/Drills with and without evidence.
- Deterministic JSON snapshot/export.
- Runtime/PWA wiring.

## Out of scope
No persisted derived metrics store, S/P/F/I weighting, threshold, pass/fail, level validation, capability/readiness/confidence score, bottleneck ranking, recommendation, prescription, P0–P6, promotion, prediction, UI redesign, legacy migration, npm/framework/server DB/cloud work.
STOP after S3.
