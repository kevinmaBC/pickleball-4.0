# S4 Scope
## In scope
- required `player_id`
- deterministic current/latest assessment selection
- exact pass-through of stored assessment fields
- invoke S3 analytics for same player and optional date window
- unified read-only snapshot
- explicit availability: assessment AVAILABLE/NONE; training_evidence AVAILABLE/NONE
- integrity propagation
- source/version metadata
- runtime/PWA wiring and tests

## Out of scope
No assessment/training scoring, validated-level inference, evidence-confidence inference,
bottleneck inference/ranking, recommended Drill/block generation, P0–P6, prescription,
promotion, DUPR interpretation, UI redesign, IndexedDB change, snapshot persistence,
server/cloud, or S5.
STOP after S4.
