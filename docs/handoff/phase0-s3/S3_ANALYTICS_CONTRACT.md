# S3 Analytics Contract
Suggested snapshot:
```json
{
 "snapshot_version":"PB30-50-S3-OBS-v1",
 "player_id":"plr_...",
 "filter":{"date_from":null,"date_to":null,"training_session_ids":null},
 "coverage":{},
 "overall":{},
 "by_master":[],
 "by_drill":[],
 "by_kpi":[],
 "integrity":{"unknown_drill_ids":[],"unknown_master_ids":[]}
}
```

Drill rows reference canonical identifiers; do not copy full Drill definitions.
Master rows may include frozen name/class as display metadata.
KPI rows are structural only: kpi_id, role, referenced Drill IDs, evidence-bearing Drill IDs, descriptive counts/rates. No KPI score.
Unknown/corrupt IDs must appear in integrity output and follow a documented exclusion rule.
