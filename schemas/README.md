# Pickleball 3.0–5.0 V2.3.1 Clean Data Schema Package

This patch resolves the methodology and logic issues identified in review before APP Alpha development.

Key changes
- Removes continuous 3.x/4.x "training readiness" conversion.
- Keeps three separate outputs: validated_training_level, capability_score_0_100, evidence_confidence.
- DUPR is external context only; no arithmetic internal-external gap.
- Evidence model unified: C1 Diagnostic; C2 allows up to 3.5; C3 up to 4.5; C4 up to 5.0.
- T02/T03 Partial scoring inconsistency fixed.
- 4.5/5.0 metrics now have explicit source tests and denominators.
- Feed mode / feeder calibration fields added; ball-quality separated from opponent-response.
- Assessment tiers added: Lite / Standard / Full.
- Prescription engine adds prerequisite, persistence, minimum block duration.
- Capability score now uses Technical + Decision + Pressure only; Match Transfer is a validation layer.
- Thresholds remain E4 coaching benchmarks pending calibration.

Versions
- schema_version: 2.3.1
- benchmark_version: 2.1.1
- protocol_version: 2.2.1
