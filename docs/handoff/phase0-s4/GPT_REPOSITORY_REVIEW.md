# S4 Basis
Frozen S3: `cd6c780e795b86f6f198f7e1697236de0008c3b7` on `phase0-s3-evidence-analytics`.
S3 PASS/FROZEN; canonical 13 Masters / 35 Drills unchanged; IndexedDB remains `pb_v2` v2.
Current layers:
S0 canonical → S1 runtime → S2 raw training evidence → S3 descriptive analytics.
Existing assessment domain already stores player/assessment/test-session/trial-event data.

The assessment schema contains target/validated level, capability/component scores, confidence,
bottleneck, recommended_block_id and DUPR fields, but S4 must not fabricate missing values or port
the scoring reference into the training domain.

S4 = **Player Training State Integration Core**:
compose current assessment context + S3 training analytics into one deterministic, read-only player state.
No scoring, diagnosis, recommendation, prescription, P0–P6, promotion or UI redesign.
