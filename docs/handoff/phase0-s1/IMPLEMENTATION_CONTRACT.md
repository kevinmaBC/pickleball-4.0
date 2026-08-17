# S1 Implementation Contract

## Mission
Integrate the frozen S0 canonical repository into the real browser/PWA runtime using the smallest
compatible change set.

## Architecture guard
Preserve the static HTML/CSS/JS architecture. Do not add npm/package.json, external libraries,
framework/bundler, database/ORM, or migration framework.

## Preferred minimal design
Claude must PLAN before coding. Preferred shape:
1. Keep `js/masters-repo.js` unchanged unless a proven defect requires owner approval.
2. Add one small runtime bootstrap/facade, e.g. `js/canonical-runtime.js`.
3. Load via `PBMasters.load('./data/canonical/seed_data.json')`.
4. Expose one stable read-only ready/access namespace.
5. Load `js/masters-repo.js` and the facade from `index.html` in safe order.
6. Update `sw.js` cache version and precache canonical runtime JS + runtime seed.
7. Add focused S1 tests/smoke validation.
8. Add a Legacy Data Dependency Map.

## Async/failure behavior
Define readiness and one explicit load error state. Do not expose a partial repository.
Do not make existing legacy UI dependent on canonical readiness unless separately approved.

## Existing behavior preservation
Do not intentionally change navigation, i18n, assessment, KPI dashboard, tracker, localStorage,
Supabase/team behavior, visible handbook content, or CSS/layout.

## Git discipline
Do not commit, push, merge, or start S2 during implementation. Stop for owner/GPT acceptance.
