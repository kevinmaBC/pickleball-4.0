# S1 Scope — Canonical Runtime Integration

## Objective
Make the frozen S0 canonical training repository available to the actual browser/PWA runtime
without changing existing user-facing training/assessment behavior.

## In scope
- Wire `js/masters-repo.js` into the browser runtime.
- Add a small read-only runtime facade/bootstrap.
- Load only `data/canonical/seed_data.json` at runtime.
- Update service worker/cache version and cached canonical assets.
- Preserve existing visible UI and behavior.
- Create a machine-readable Legacy Data Dependency Map covering at minimum:
  `WEEKS`, `MODULES`, `GATES`, `GLOSSARY`, `TOC`, assessment/config data reads.

Suggested facade shape, subject to Claude plan review:
- `PBCanonical.ready`
- `PBCanonical.getMaster(master_id)`
- `PBCanonical.getDrill(source_drill_id)`
- `PBCanonical.getDrillsByMaster(master_id)`
- `PBCanonical.listMasters()`
- `PBCanonical.listDrills()`

## Out of scope
No UI redesign, player profile, Today plan, P0–P6 recommendation engine, session evidence,
promotion engine, bulk legacy replacement, database/ORM, package.json/npm dependency,
framework/bundler migration, source Drill/Master edits, AI/video/social features, or rating logic.

## Stop rule
When S1 acceptance passes, stop. Do not start S2.
