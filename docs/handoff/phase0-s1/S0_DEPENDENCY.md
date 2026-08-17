# S0 Dependency Contract

S1 is downstream of S0 and may not reinterpret S0.

Before S1 implementation verify:
- current branch descends from `be46174`;
- S0 authority and runtime seed exist;
- `js/masters-repo.js` exists;
- S0 test suite passes;
- counts remain 13 Masters / 35 Drills.

Reuse the S0 API:
- `PBMasters.load(url)`
- `buildIndex(seedData)`
- `getMaster`
- `getDrill`
- `getDrillsByMaster`
- `listMasters`
- `listDrills`

If Claude believes S0 API changes are required, stop at PLAN and identify the exact deficiency.
Do not silently rewrite S0 architecture.
