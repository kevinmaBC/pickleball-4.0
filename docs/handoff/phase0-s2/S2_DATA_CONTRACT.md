# S2 Training Evidence Data Contract

Training session example:
```json
{
  "training_session_id": "trn_...",
  "player_id": "plr_...",
  "session_date": "2026-08-17",
  "started_at": "ISO-8601",
  "ended_at": null,
  "notes": null,
  "canonical_schema_version": "PB30-50-S0-SEED-v1",
  "created_at": "ISO-8601"
}
```

Drill evidence example:
```json
{
  "drill_evidence_id": "dev_...",
  "training_session_id": "trn_...",
  "source_drill_id": "DRILL-SERVE-DEPTH",
  "master_id": "FM-02",
  "trial_no": 1,
  "outcome": "S",
  "scenario_id": null,
  "target": "deep-back-third",
  "quality": "high",
  "notes": null,
  "video_timestamp_ms": null,
  "raw_json": {},
  "created_at": "ISO-8601"
}
```

Rules:
- session must exist;
- Drill must exist in PBCanonical;
- Master is derived, not trusted from caller;
- trial_no positive integer;
- video timestamp non-negative integer if present;
- raw_json is raw evidence, not a derived score.

Export should return session + evidence deterministically, optionally player reference, but not full copied Drill definitions.
