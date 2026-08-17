# S2 Source Authority

Frozen upstream chain:
- S1 `2c263873ba8350d07c2f8bbefda6832c7911ddc7`
- S0 `be4617448d77af4080f1101a33f64304d23f9c10`

Canonical SSOT:
`docs/handoff/phase0-s0/seed_data.json`

Runtime canonical artifact:
`data/canonical/seed_data.json`

Runtime facade:
`PBCanonical`

Evidence records store canonical identifiers + raw observations only.
Do not copy full canonical Drill definitions into evidence.

Existing assessment stores (`assessments`, `test_sessions`, `trial_events`) remain a separate data domain.
