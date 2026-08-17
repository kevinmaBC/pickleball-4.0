# S2 Scope — Canonical Training Session Evidence Core

## Objective
Persist raw, auditable training evidence against frozen canonical Drills.

## In scope
1. Upgrade IndexedDB `pb_v2` v1→v2 additively.
2. Add `training_sessions`.
3. Add `drill_evidence_events`.
4. Validate `source_drill_id` against `PBCanonical`.
5. Derive `master_id` from frozen Master membership.
6. Provide create/read/export/delete training-evidence API.
7. Preserve existing assessment data and behavior.
8. Load the new runtime module and update PWA cache.
9. Correct the stale root README statement about canonical runtime wiring.

### training_sessions required fields
`training_session_id`, `player_id`, `session_date`, `started_at`, `ended_at`, `notes`,
`canonical_schema_version`, `created_at`.

Recommended indexes: `by_player`, `by_session_date`.

### drill_evidence_events required fields
`drill_evidence_id`, `training_session_id`, `source_drill_id`, `master_id`, `trial_no`,
`outcome`, `scenario_id`, `target`, `quality`, `notes`, `video_timestamp_ms`, `raw_json`, `created_at`.

Recommended indexes: `by_training_session`, `by_source_drill`, `by_master`.

Outcome must be one of `S | P | F | I`.

## Out of scope
No Today screen, P0–P6 planning, recommendation, prescription, promotion, scoring, legacy WEEKS/MODULES/GATES migration,
cloud/Supabase schema change, UI redesign, npm/package.json/framework, or canonical source edits.

STOP after S2. Do not start S3.
