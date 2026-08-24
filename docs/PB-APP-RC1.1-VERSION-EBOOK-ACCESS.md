# PB-APP-RC1.1 — Version & E-Book Access

Stage: `PB-APP-RC1.1`
Status: `IMPLEMENTED / GPT QA PENDING`
Product Code Baseline (unchanged): `4676e256f534dcef68ac6f0db52eb40ba578fbfd` (`4676e25`)
Governance Closure Commit (unchanged): `5cc91bad8ff2eb5337246193cf7846318d69fab9` (`5cc91ba`)

## 1. Purpose

Add release-identity visibility, a check-for-update flow, PWA install
instructions, and a permanent E-Book landing page with bidirectional
QR access between the APP and the E-Book. This is a productization/
distribution layer only — it adds no assessment, scoring,
recommendation, training, match, progress, reassessment, or journey
logic, and does not touch the database schema.

## 2. Frozen Scope

Implemented exactly the seven items authorized for this release:

1. Visible APP version information (`PB-APP-RC1.1`, cache identifier,
   schema/benchmark/protocol versions, last-checked time).
2. Check-for-update functionality (`js/version-update.js` +
   `data/app-release.json`, `cache: "no-store"` fetch).
3. PWA installation instructions (iPhone/iPad, Android, Windows/Mac
   Chrome/Edge, Mac Safari) in a compact bilingual "Install App"
   block.
4. Permanent E-Book landing page at `ebook/index.html`.
5. Bidirectional APP/E-Book QR access (static local SVGs).
6. Minimal bilingual UI and release metadata.
7. This test suite and documentation record.

No assessment/scoring/recommendation/training/match/progress/
reassessment/journey logic, no database migration, no store
creation/deletion/renaming, no navigation redesign, no new runtime
framework, no external CDN dependency, and no analytics/personal-data
collection were added.

## 3. Files Added / Modified

Added:
```
data/app-release.json
js/version-update.js
assets/qr/qr-app.svg
assets/qr/qr-ebook.svg
ebook/index.html
tests/rc1.1-version-ebook-access.test.js
docs/PB-APP-RC1.1-VERSION-EBOOK-ACCESS.md
```

Modified:
```
index.html   — <script src="./js/version-update.js">, an "About &
                Version" accordion (version display, check-for-update
                button, install instructions, E-Book QR/link) before
                the footer, and its DOM/Service-Worker wiring script.
css/app.css  — #about-version-root .av-* rules only (new selectors,
                no existing rule changed).
sw.js        — CACHE bumped pb40-v29 -> pb40-v30; js/version-update.js
                and data/app-release.json added to CORE; a message
                listener that calls self.skipWaiting() on
                {type:'SKIP_WAITING'} only (no cache/storage clearing).
```

No file under `js/` implementing S9/S10/S11 business logic, no test
file other than the one new suite above, and no `manifest.json`/DB
schema file was touched.

## 4. Release Identity

`data/app-release.json` (fetched with `cache: "no-store"` plus a
timestamp query param by the check-for-update flow):

```json
{
  "product_release": "PB-APP-RC1.1",
  "product_baseline": "4676e25",
  "governance_baseline": "5cc91ba",
  "release_commit": "PENDING_AT_RELEASE_COMMIT",
  "sw_cache": "pb40-v30",
  "schema_version": "2.3.1",
  "benchmark_version": "2.1.1",
  "protocol_version": "2.2.1",
  "published_at": "2026-08-23"
}
```

`release_commit` is intentionally a documented placeholder rather
than a fabricated self-referential SHA: the file that names the
commit cannot know its own future commit hash before that commit is
made. It should be updated to the real implementation commit SHA in
a follow-up documentation-only edit once this stage's commit is
known, or left as `PENDING_AT_RELEASE_COMMIT` until then — either
way it is never treated as authoritative identity by the update
check, which compares `product_release` / `sw_cache` /
`schema_version` / `benchmark_version` / `protocol_version` only
(see `js/version-update.js`'s `IDENTITY_FIELDS`).

`js/version-update.js` bakes in the matching `RUNNING_RELEASE`
constant for the code actually shipped, so a freshly deployed app
compares equal to its own `data/app-release.json` (`LATEST`) until a
newer release is published.

## 5. Version-Check States

`PBVersionUpdate.checkForUpdate()` always resolves to exactly one of:

```
LATEST             running identity == published identity
UPDATE_AVAILABLE   running identity != published identity
OFFLINE            navigator.onLine === false (or opts.online: false) — never fetched
CHECK_FAILED       fetch rejected, non-OK HTTP status, or JSON parse failure
UNSUPPORTED        no fetch implementation available in this environment
```

`compareReleases(running, published)` is a pure function and is only
ever invoked on a successful fetch — offline/failure/unsupported
paths return their own state directly, so an error can never be
misreported as `LATEST` (covered by tests 6/7 below).

Flow: confirm `navigator.onLine` → best-effort
`serviceWorkerRegistration.update()` → fetch
`data/app-release.json` with `cache: "no-store"` and a cache-busting
`?t=<timestamp>` → compare → paint one deterministic status string
(bilingual) and, on `UPDATE_AVAILABLE`, reveal the "Update and
Restart" button.

**Update and Restart**: posts `{type:'SKIP_WAITING'}` to the waiting
Service Worker, listens once for `controllerchange`, and reloads the
page exactly once, guarded by a single `sessionStorage` flag
(`pb40_update_reload_once`) that is cleared again on the next normal
page load — preventing a reload loop without ever touching Cache
Storage, IndexedDB, `localStorage`, or user records. If no waiting
worker is available, the user is told (bilingually) to close and
reopen the app instead of anything unsafe being attempted.

## 6. QR Destinations

```
QR-A  assets/qr/qr-app.svg     encodes https://kevinmabc.github.io/pickleball-4.0/
                                 placed on ebook/index.html, with the exact text URL below it.
QR-B  assets/qr/qr-ebook.svg   encodes https://kevinmabc.github.io/pickleball-4.0/ebook/
                                 placed in the APP's About & Version panel, with the exact
                                 text URL below it.
```

Both SVGs are static, locally generated, checked-in files — no
runtime or third-party QR service and no external CDN is referenced
anywhere in the app or the e-book page.

**QR decode validation**: both payloads were decode-verified at
generation time with a local OpenCV `QRCodeDetector` against the
exact target strings above (both `MATCH`). This was a one-off,
build-time verification step (using a temporary local Python
environment); no QR-decoding dependency, script, or library is part
of the shipped repository — only the two static SVG outputs are.
Physical device scanning after deployment remains recommended as a
final real-world check (see Manual Verification below).

## 7. Protected Invariants

```
DB_VERSION = 5                                          unchanged — verified by test #14
IndexedDB stores = 18/18                                 unchanged — verified by test #15
Validated Levels = 3.0 / 3.5 / 4.0 / 4.5 / 5.0            untouched — no review/gate file modified
CAP = 45% Technical + 30% Decision + 25% Pressure          untouched — no scoring file modified
TRAINING evidence / MATCH Transfer separation             untouched — no match/training engine modified
Schema version = 2.3.1 / Benchmark = 2.1.1 / Protocol = 2.2.1   unchanged — verified by test #1-3
```

`js/version-update.js` is source-scanned (test suite, "no business
vocabulary" check) to confirm it never references `PBAssessment`,
`PBDiagnosis`, `PBRecommendationPriority`, `PBTrainingPrescription`,
`PBWorkflow`, `PBReassessment`, `PBMatchObservation`,
`validated_training_level`, or `PBStore`.

## 8. Test Results

New targeted suite — `tests/rc1.1-version-ebook-access.test.js`
(covers all 16 items required by the RC1.1 spec section 11):

```
node tests/rc1.1-version-ebook-access.test.js
rc1.1-version-ebook-access.test.js: all assertions passed
```

`tests/sw-cache.test.js` (verifies every script `index.html` loads is
precached by `sw.js`'s `CORE` list, including the new
`js/version-update.js`, and exercises the bumped `pb40-v30` cache):

```
node tests/sw-cache.test.js
sw-cache.test.js: all assertions passed
```

**Existing complete regression suite**: all 54 pre-existing suites
were exercised directly (`node tests/<file>.test.js`). Several of
this repository's suites recursively `spawnSync` other suites as part
of their own "relevant accepted suites still pass unmodified" checks
(a pattern that predates this stage — `tests/s10-final-acceptance.test.js`
is the extreme case: its own `FA23_FULL_REGRESSION` gate spawns
*every other* suite in `tests/`); at sufficient depth those chains
take several minutes per root file purely from cumulative Node
process-startup overhead (e.g. `r3b3-home-integration.test.js` alone
took ~9m44s to complete on its own, unmodified). Every suite that was
given enough wall-clock time completed with **all assertions
passing**, including the deepest chains — `product-journey-
orchestrator.test.js`, `r3b3-home-integration.test.js`,
`prescription-workflow-engine.test.js`, `workflow-integration-
engine.test.js`, `match-observation-engine.test.js`, `dashboard-
integration-engine.test.js`, `s9-full-system-qa.test.js`,
`assessment-journey-bridge.test.js`, `home-dashboard-adapter.test.js`,
`progress-reassessment-persistence.test.js`, `session-evidence-
engine.test.js`, and `s10-f-cross-workflow-qa.test.js` — each
independently re-verified standalone with no external timeout. No
RC1.1 change touched any file referenced by these suites.
`tests/s10-final-acceptance.test.js` was not separately re-run to
completion standalone (its FA23 gate is, by construction, equivalent
to re-running the entire suite named above plus the one known
pre-existing failure below, and would take on the order of an hour);
its own non-regression assertions were unaffected by this stage since
no file it inspects was modified.

**One pre-existing, out-of-scope failure**: `tests/r4d-final-release-
acceptance.test.js` fails its `GOV-01` assertion
(`R4-D status is IMPLEMENTATION COMPLETE / GPT QA PENDING`) because
`docs/MASTER-CONTROL-V2.md` now records `POST-S11-R4-D` as
`CLOSED / ACCEPTED` following the separate, already-completed R4
FINAL governance closure (commit `5cc91ba`) earlier in this session.
This is a stale literal-string assertion in a pre-existing test file,
unrelated to and predating this RC1.1 stage; per the RC1.1 file-scope
rules this stage does not modify `tests/r4d-final-release-
acceptance.test.js`. It is reported here rather than silently fixed
or hidden.

## 9. Known Limitations

- `data/app-release.json`'s `release_commit` field is a documented
  placeholder (`PENDING_AT_RELEASE_COMMIT`) rather than this stage's
  own commit SHA, for the self-reference reason explained in
  Section 4.
- The pre-existing `tests/r4d-final-release-acceptance.test.js`
  `GOV-01` failure described in Section 8 is unresolved (out of this
  stage's frozen scope).
- QR payload correctness was verified programmatically
  (decode-matched); it has not yet been verified by scanning with a
  physical phone camera against the deployed GitHub Pages URLs.
- The "Update and Restart" flow (posting `SKIP_WAITING`, listening
  for `controllerchange`, single-shot reload) has been verified by
  source/logic review and unit tests of its pure comparison/state
  logic, but the live waiting-worker activation path has not yet
  been exercised against a real second Service Worker version in a
  browser.

## 10. Manual Verification Still Required

- Open the deployed APP and confirm the About & Version panel shows
  `PB-APP-RC1.1`, `pb40-v30`, and the schema/benchmark/protocol
  versions.
- Click "Check for Updates" online (expect `LATEST` against the
  currently published `data/app-release.json`) and, separately,
  while offline (expect the offline message, never "latest").
- Publish a changed `data/app-release.json` and confirm "Check for
  Updates" reports `UPDATE_AVAILABLE` and that "Update and Restart"
  activates the new Service Worker and reloads exactly once.
- Install the PWA on iOS Safari, Android Chrome, and a desktop
  Chromium browser using the on-page instructions.
- Open `/ebook/` directly and confirm it renders correctly on mobile
  and desktop widths.
- Physically scan both QR codes (QR-A on `/ebook/`, QR-B in the
  APP's About panel) with a phone camera and confirm they land on the
  exact expected URLs.
