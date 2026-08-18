# S5 Architecture — Formal Assessment Capability Classification Core

S0 Canonical → S1 Runtime → S2 Training Evidence → S3 Analytics → S4 Player Training State → **S5 Formal Assessment Capability Classification** → S6 Evidence Confidence / Repeatability → S7 Bottleneck Diagnosis → S8 Prescription / Block Selection → S9 P0–P6 Plan Assembly → S10 Product/UI Orchestration.

S5 is the first formal evaluation layer, but only for the already-defined V2.3.1 assessment methodology.

Authoritative sources:
- `data/level_gates_v2_3_1.json`
- `schemas/scoring_engine_reference_v2_3_1.py`
- `schemas/assessment_schema_v2_3_1.json`
- `data/evidence_confidence_v2_3_1.json` as input-domain reference only

S5 may implement:
- capability score = Technical 45% + Decision 30% + Pressure 25%;
- hard-gate evaluation for discrete levels;
- evidence-minimum comparison using explicit C1–C4 input;
- match validation where configured;
- status INCOMPLETE / LOW_CONFIDENCE / PASS / BORDERLINE / FAIL;
- highest validated discrete level among 3.0 / 3.5 / 4.0 / 4.5 / 5.0.

S5 must not derive formal Assessment metrics or component scores from S2/S3 training evidence.

Thresholds are E4 coaching benchmarks pending calibration; 4.5 and 5.0 remain provisional and must be surfaced as such.
