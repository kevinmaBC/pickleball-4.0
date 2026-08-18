# S5 Data Contract

Input example:
```json
{
  "target_level": 4.0,
  "metrics": {
    "serve_in_pct": 96,
    "return_quality_pct": 78,
    "drop_ball_quality_pct": 72,
    "reset_ball_quality_pct": 68,
    "shot_selection_pct": 82,
    "pressure_success_pct": 74,
    "ue_per_game": 4
  },
  "component_scores": {
    "technical_score": 80,
    "decision_score": 78,
    "pressure_score": 75
  },
  "evidence_confidence": "C3",
  "match_transfer_score": 74
}
```

Requested-level result includes:
- classifier_version
- schema_version / benchmark_version
- target_level
- level_status
- provisional_level
- capability_score_0_100
- capability_min
- component_scores
- evidence {input, minimum, ok}
- gate_results {observed, threshold, status}
- match_validation
- missing_inputs

Highest-level result:
```json
{
  "validated_training_level": 4.0,
  "level_results": {
    "3.0": {}, "3.5": {}, "4.0": {}, "4.5": {}, "5.0": {}
  }
}
```

Only PASS counts toward validated_training_level. BORDERLINE does not.
4.5/5.0 provisional metadata must be retained.
No persistence.
