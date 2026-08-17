# pickleball-4.0

## S0 · Canonical Training Data

The canonical data foundation (13 Masters + 35 GREEN35 Drills) lives at:

- **Authority / SSOT**: `docs/handoff/phase0-s0/seed_data.json` (never edited by tooling; source of truth).
- **Runtime copy**: `data/canonical/seed_data.json` (generated — do not hand-edit).

To regenerate the runtime copy deterministically from the authority source:

```
node scripts/build-canonical-data.js
```

To run the S0 canonical data test suite (no install required — uses Node's built-in test runner):

```
node --test tests/canonical/*.test.js
```

Read-only query access for application code is provided by `js/masters-repo.js`
(`getMaster(master_id)`, `getDrill(source_drill_id)`, `getDrillsByMaster(master_id)`).
As of S1, `js/masters-repo.js` and the read-only `PBCanonical` facade in
`js/canonical-runtime.js` are wired into `index.html`, loaded after the legacy
scripts. `js/training-evidence.js` (S2) builds on this to persist raw training
evidence against canonical Drill IDs.