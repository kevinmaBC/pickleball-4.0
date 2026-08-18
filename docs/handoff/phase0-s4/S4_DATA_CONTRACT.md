# S4 Data Contract
Suggested:
```json
{
 "state_version":"PB30-50-S4-STATE-v1",
 "player_id":"plr_...",
 "player":{"display_name":"..."},
 "assessment_state":{
   "availability":"AVAILABLE",
   "selected_assessment_id":"asm_...",
   "assessment_date":"2026-08-17",
   "assessment_tier":"standard",
   "target_training_level":4.0,
   "validated_training_level":null,
   "capability_score_0_100":null,
   "technical_score":null,
   "decision_score":null,
   "pressure_score":null,
   "match_transfer_score":null,
   "evidence_confidence":null,
   "primary_bottleneck":null,
   "secondary_bottleneck":null,
   "recommended_block_id":null,
   "versions":{"schema_version":"2.3.1","benchmark_version":"2.1.1","protocol_version":"2.2.1"},
   "dupr":null,
   "external_validation_note":null
 },
 "training_state":{"availability":"AVAILABLE","filter":{},"analytics":{}},
 "availability":{"assessment":"AVAILABLE","training_evidence":"AVAILABLE"},
 "integrity":{"status":"OK","analytics_integrity":{}}
}
```
Rules: no raw evidence copy, no full canonical Drill copy, no IndexedDB persistence,
missing != zero, and 0 must remain 0.
