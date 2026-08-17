# S2 Implementation Contract

Mission: add durable raw training evidence linked to canonical Drill IDs, with zero scoring/recommendation logic.

Preferred architecture:
1. Upgrade `js/storage.js` DB_VERSION 1→2 additively.
2. Extend STORES with `training_sessions` and `drill_evidence_events`.
3. Preserve existing four stores and records.
4. Add separate `js/training-evidence.js` domain API using PBStore + PBCanonical.
5. Load it after PBStore and PBCanonical.
6. Update service-worker cache version/assets.
7. Add migration/API/validation/export/cascade tests.
8. Correct stale README wording.

Integrity rules:
- reject unknown Drill IDs;
- derive Master mapping from canonical data;
- do not trust conflicting caller master_id;
- enforce outcome S/P/F/I;
- reject writes before canonical readiness;
- store no copied canonical definitions;
- do not compute scores, recommendations, promotion, readiness, trend verdicts.

IndexedDB migration must be additive: do not delete/recreate existing stores.

No npm, third-party dependency, framework, server DB, ORM, bundler, or cloud migration.

Do not git add/commit/push/merge during implementation. Stop for owner/GPT acceptance.
