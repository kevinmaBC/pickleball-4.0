# S4 Implementation Contract
Preferred:
1. Create `js/player-training-state.js`.
2. Read player from PBStore.
3. Select latest assessment using frozen rules.
4. Project assessment fields unchanged.
5. Call PBTrainingAnalytics for training state.
6. Compose deterministic read-only snapshot.
7. No DB version/store change.
8. Load after training-analytics.js.
9. Update SW cache version/module entry.
10. Add S4 tests and browser proof.

Forbidden:
Do not port `scoring_engine_reference_v2_3_1.py`;
do not calculate capability score, validated level, confidence, bottleneck, recommendation,
DUPR comparison, P0–P6, prescription or promotion.
No PBStore writes/deletes.
No git add/commit/push/merge during implementation.
