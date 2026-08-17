# Source Authority

## Canonical content

`data/canonical/seed_data.json` is the exact S0 canonical payload.

### Canonical object counts

- Masters: **13**
- Drills: **35**
- Master memberships: **35**
- Each Drill belongs to exactly one Master.

## Immutable fields

All source-owned drill fields are immutable in S0. Runtime tables may reference, snapshot, or index them, but should not silently redefine them.

## No inferred rules

S0 must not add:
- numeric promotion thresholds;
- universal target rankings;
- fixed transition distances;
- fixed partner spacing;
- automatic movement rules;
- new match-scoring rules;
- new progression stages.

These belong to later governed layers only if explicitly authorized.
