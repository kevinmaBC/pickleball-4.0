# GPT Repository Architecture Review — S1 Basis

## Verified baseline
- Repository: `kevinmaBC/pickleball-4.0`
- Frozen S0 commit: `be4617448d77af4080f1101a33f64304d23f9c10`
- S0 branch: `phase0-s0-data-foundation`
- S0 canonical data: **13 Masters + 35 Drills**
- S0 regression suite at freeze: **32/32 PASS**

## Verified architecture
The application is a **static HTML/CSS/JavaScript PWA** with no package manager, database, ORM,
migration framework, bundler, or external test framework.

Key files:
- `index.html`
- `js/app.js`
- `js/assessment.js`
- `js/config-loader.js`
- `js/i18n.js`
- `js/metrics.js`
- `js/preview.js`
- `js/storage.js`
- `js/masters-repo.js`
- `sw.js`

`index.html` currently does **not** load `js/masters-repo.js`.

`js/masters-repo.js` already provides `PBMasters.load(url)`, `buildIndex(seedData)`,
`getMaster`, `getDrill`, `getDrillsByMaster`, `listMasters`, and `listDrills`, with deep-freeze
protection.

`sw.js` currently precaches the legacy runtime but not the S0 canonical runtime module or
`data/canonical/seed_data.json`.

## Legacy runtime data observed
`js/app.js` still contains hard-coded application-owned structures including:
- `WEEKS`
- `GLOSSARY`
- `TOC`
- `MODULES`
- `GATES`

These are not automatically 1:1 equivalents of the 35 canonical Drill records.

## S1 conclusion
S1 should be a **minimal canonical runtime bridge**, not a legacy-data migration sprint:
1. load the S0 canonical repository in the real browser runtime;
2. expose a stable read-only ready/access contract;
3. update PWA caching for canonical runtime/offline use;
4. produce a machine-readable Legacy Data Dependency Map;
5. preserve existing UI/assessment/storage/metrics/i18n behavior;
6. keep all S0 tests green.

Bulk legacy replacement is deferred unless a specific read path is proven 1:1 compatible and
explicitly approved during S1 plan review.
