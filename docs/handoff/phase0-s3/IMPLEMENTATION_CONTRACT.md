# S3 Implementation Contract
Preferred:
1. Separate read-only `js/training-analytics.js`.
2. Query existing evidence; join metadata through PBCanonical.
3. Compute snapshots in memory.
4. No new IndexedDB version/store.
5. Stable deterministic sorting.
6. Add tests and browser proof.
7. Wire after S2 dependencies and update SW cache if needed.

Allowed math: literal counts and arithmetic proportions only.
Forbidden: numeric S/P/F/I weights, pass/fail, thresholds, improvement claims, scores, bottleneck ranks, recommendations, prescriptions, promotion.
Unknown/corrupt evidence IDs must be surfaced, not silently merged.
No npm/package.json/framework/server DB/ORM/cloud/S4.
No git add/commit/push/merge during implementation.
