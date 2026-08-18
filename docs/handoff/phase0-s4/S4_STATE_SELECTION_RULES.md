# S4 State Selection Rules
Player: `player_id` required; unknown player rejected.

Latest assessment:
1. highest `assessment_date`
2. then highest `created_at`
3. then lexicographically highest `assessment_id`
Never rely on IndexedDB return order.

Assessment fields may be exposed only if stored:
assessment_id, assessment_date, assessment_tier, target_training_level,
validated_training_level, capability_score_0_100, technical_score, decision_score,
pressure_score, match_transfer_score, evidence_confidence, primary_bottleneck,
secondary_bottleneck, recommended_block_id, benchmark_version, protocol_version,
schema_version, dupr, external_validation_note.

Missing remains null/absent. Never synthesize.
Training `date_from`/`date_to` must use S3 semantics unchanged.
