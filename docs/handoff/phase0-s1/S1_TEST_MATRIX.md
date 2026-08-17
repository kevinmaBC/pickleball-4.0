# S1 Test Matrix

| ID | Requirement | Proof |
|---|---|---|
| S1-T01 | baseline descends from S0 frozen commit | git check |
| S1-T02 | all S0 canonical tests remain green | `node --test tests/canonical/*.test.js` |
| S1-T03 | runtime loads 13 Masters | runtime test |
| S1-T04 | runtime loads 35 Drills | runtime test |
| S1-T05 | getMaster through runtime facade | test |
| S1-T06 | getDrill through runtime facade | test |
| S1-T07 | getDrillsByMaster through runtime facade | test |
| S1-T08 | unknown IDs deterministic | test |
| S1-T09 | mutation cannot corrupt future reads | regression |
| S1-T10 | authority seed == runtime seed | equivalence test |
| S1-T11 | index loads canonical scripts in correct order | static test |
| S1-T12 | existing legacy script order otherwise preserved | static test |
| S1-T13 | PWA cache includes canonical JS + runtime seed | SW test |
| S1-T14 | SW cache version bumped | SW test |
| S1-T15 | no package.json/external dependency | repo assertion |
| S1-T16 | no database/ORM/framework | diff audit |
| S1-T17 | no bulk visible-content rewrite | diff audit |
| S1-T18 | Legacy Data Dependency Map exists/covers required symbols | shape test |
| S1-T19 | no extra canonical dataset | repo scan |
| S1-T20 | no canonical source field changed | S0 regression + diff |

Browser smoke check must use HTTP, not `file://`, and verify page load, no new startup error,
canonical ready resolves, 13/35 counts are observable, and existing navigation still works.
