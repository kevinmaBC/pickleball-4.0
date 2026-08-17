# S1 Dependency Contract

S2 must descend from frozen S1 `2c263873ba8350d07c2f8bbefda6832c7911ddc7`.

Before implementation verify:
- branch descends from `2c26387`;
- `PBCanonical.ready` resolves;
- 13 Masters / 35 Drills available;
- S0 + S1 tests all pass;
- existing PBStore four stores work.

Reuse S1 runtime bridge. If it appears insufficient, stop at PLAN and identify the deficiency.
