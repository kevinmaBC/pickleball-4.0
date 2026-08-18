# S5 Scope — What May / Must Not Be Calculated

## MAY calculate
1. Capability score from explicit technical_score, decision_score, pressure_score using 0.45/0.30/0.25.
2. Level hard-gate results from explicit formal assessment metrics.
3. Evidence minimum check from explicit input evidence_confidence C1–C4.
4. Configured match-validation result.
5. Requested-level classification: INCOMPLETE / LOW_CONFIDENCE / PASS / BORDERLINE / FAIL.
6. Highest PASS level from the discrete set 3.0/3.5/4.0/4.5/5.0.
7. Diagnostic provenance: thresholds, gate results, missing inputs, versions, provisional flag.

## MUST NOT calculate
- evidence_confidence itself;
- formal metrics from S3 S/P/F/I rates or Drill/KPI observations;
- Technical/Decision/Pressure component scores from training analytics;
- bottleneck ranking;
- recommended_block_id or Drill recommendation;
- P0–P6 plan;
- promotion workflow;
- DUPR interpretation/arithmetic;
- automatic persistence to Assessment;
- new IndexedDB store/version;
- UI/dashboard redesign;
- S6 work.

Missing values must remain missing/null, never coerced to 0.
No continuous 3.x/4.x interpolation is allowed.
