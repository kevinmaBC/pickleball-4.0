# PB-APP-RC1.1 — Version & E-Book Access

Stage: `PB-APP-RC1.1` (rework round: `PB-APP-RC1.1-R1`)
Status: `IMPLEMENTED / GPT QA PENDING`
Product Code Baseline (unchanged): `4676e256f534dcef68ac6f0db52eb40ba578fbfd` (`4676e25`)
Governance Closure Commit (unchanged): `5cc91bad8ff2eb5337246193cf7846318d69fab9` (`5cc91ba`)
Original RC1.1 Implementation Commit: `c82833b77ac267a107c3fb1071b6da702a678d13` (`c82833b`)

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
  "release_commit": "c82833b77ac267a107c3fb1071b6da702a678d13",
  "sw_cache": "pb40-v30",
  "schema_version": "2.3.1",
  "benchmark_version": "2.1.1",
  "protocol_version": "2.2.1",
  "published_at": "2026-08-23"
}
```

`release_commit` is `c82833b77ac267a107c3fb1071b6da702a678d13` — the
original PB-APP-RC1.1 implementation commit (the one this document
first shipped against), not this R1 QA-repair commit. It was left as
a documented placeholder (`PENDING_AT_RELEASE_COMMIT`) at first
because that commit could not know its own future SHA before it
existed; it has now been filled in as a follow-up documentation
edit (PB-APP-RC1.1-R1) once that commit was known. It is never
treated as authoritative identity by the update check, which
compares `product_release` / `sw_cache` / `schema_version` /
`benchmark_version` / `protocol_version` only (see
`js/version-update.js`'s `IDENTITY_FIELDS`) — so this field can be
filled in without affecting `LATEST` / `UPDATE_AVAILABLE` comparison
results.

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
(covers all 16 items required by the original RC1.1 spec section 11,
plus 7 R1-02 functional tests for the reworked Update and Restart
flow — see Section 11):

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

**Existing complete regression suite — 54/54 PASS.** All 54 suites
were exercised, both directly (`node tests/<file>.test.js`) and via
`tests/s10-final-acceptance.test.js`'s own `FA23_FULL_REGRESSION`
gate, which by construction `spawnSync`s every other suite in
`tests/` to completion in a single run:

```
node tests/s10-final-acceptance.test.js
s10-final-acceptance.test.js: all gates passed — ... FA23_FULL_REGRESSION
```

Several suites in this repository recursively `spawnSync` other
suites as part of their own "relevant accepted suites still pass
unmodified" checks (a pattern that predates this stage); at
sufficient depth those chains take several minutes per root file
purely from cumulative Node process-startup overhead (e.g.
`r3b3-home-integration.test.js` alone takes ~9m44s standalone, and
the full `FA23_FULL_REGRESSION` run — which serially exercises every
one of those chains once each — takes on the order of tens of
minutes). This is unmodified, pre-existing test architecture; no
RC1.1/R1 change touched any file any of these suites inspects. Every
suite, including the deepest chains (`product-journey-
orchestrator.test.js`, `r3b3-home-integration.test.js`,
`prescription-workflow-engine.test.js`, `workflow-integration-
engine.test.js`, `match-observation-engine.test.js`, `dashboard-
integration-engine.test.js`, `s9-full-system-qa.test.js`,
`assessment-journey-bridge.test.js`, `home-dashboard-adapter.test.js`,
`progress-reassessment-persistence.test.js`, `session-evidence-
engine.test.js`, `s10-f-cross-workflow-qa.test.js`, and the repaired
`r4d-final-release-acceptance.test.js`), passed — both standalone and
as part of the single `FA23_FULL_REGRESSION` run above.

**R1 fix**: `tests/r4d-final-release-acceptance.test.js`'s `GOV-01`
assertion was stale — it still expected R4-D's pre-closure wording
(`IMPLEMENTATION COMPLETE / GPT QA PENDING`) after R4-D had already
been closed by GPT Independent QA (`CLOSED / ACCEPTED`, acceptance
commit `4676e25`). Fixed in PB-APP-RC1.1-R1 (see Section 11) by
updating the assertion to validate the accepted final state instead
of the answer changing; no production file or FRG-01..FRG-08
protection was touched.

## 9. Known Limitations

- QR payload correctness was verified programmatically
  (decode-matched); it has not yet been verified by scanning with a
  physical phone camera against the deployed GitHub Pages URLs.
- The "Update and Restart" flow's fail-safe timeout and
  already-activated/no-waiting-worker reload path (PB-APP-RC1.1-R1,
  Section 11) have been verified against fake `window`/
  `ServiceWorkerContainer` objects in Node, but not yet exercised
  against a real second Service Worker version in a live browser.

## 11. PB-APP-RC1.1-R1 — GPT Independent QA Rework

GPT Independent QA returned a `REWORK` verdict on the original RC1.1
implementation commit (`c82833b`) with exactly three required fixes,
all completed here with no scope expansion:

**R1-01 — Stale R4-D governance test.** Described above (Section 8).
`tests/r4d-final-release-acceptance.test.js`'s `GOV-01` block now
asserts: the `POST-S11-R4-D` block exists; its status is
`CLOSED / ACCEPTED`; its acceptance commit `4676e25` (or the full
SHA) is recorded; its final regression is `54 / 54 PASS`; its GPT
Independent Final Acceptance is `PASS`; and the `PB-APP-RC1` product
baseline (`Product Code Baseline` / `Product Release Baseline:
FROZEN`) is still recorded frozen in `docs/MASTER-CONTROL-V2.md`.
FRG-01 through FRG-08 above it in the same file are untouched.

**R1-02 — Unreliable Update and Restart.** `sw.js`'s install handler
calls `self.skipWaiting()` unconditionally, so a new worker can
finish activating on its own before the user ever clicks "Update and
Restart" — by then `registration.waiting` is already empty even
though a real update was published, and the old code's only recourse
was an alert telling the user to close and reopen the app.
`js/version-update.js`'s `applyUpdateAndRestart()` now:
1. When `registration.waiting` exists: posts `SKIP_WAITING`, listens
   once for `controllerchange`, and reloads exactly once — with a
   3-second fail-safe timer (`FAILSAFE_RELOAD_TIMEOUT_MS`) that also
   reloads once if `controllerchange` never arrives.
2. When nothing is waiting but the caller's last `checkForUpdate()`
   result was `UPDATE_AVAILABLE` (passed in as `opts.updateAvailable`
   by `index.html`'s UI wiring, which now tracks the last check
   state), reloads the page directly instead of only alerting —
   the existing network-first fetch policy (unchanged) is what
   actually serves the newly published HTML/JS/CSS/JSON on that
   reload.
3. Only when neither condition holds does it fall back to telling
   the user to close and reopen the app.
The one-shot `sessionStorage` reload-loop guard (`clearReloadGuard()`
on the next normal page load) is unchanged. No Cache Storage,
IndexedDB, `localStorage`, or user record is ever cleared — verified
both by the existing source-scan test and by seven new functional
tests in `tests/rc1.1-version-ebook-access.test.js` (R1-02a..g):
waiting-worker path, fail-safe-timeout path, both-triggers-fire
exactly-once, already-activated/no-waiting-worker reload, no-update
no-op, reload-loop prevention + guard release, and no
storage-clearing calls in the waiting-worker flow.

**R1-03 — Release placeholder.** `data/app-release.json`'s
`release_commit` is now `c82833b77ac267a107c3fb1071b6da702a678d13`
(the original RC1.1 implementation commit, not this R1 repair
commit) — see Section 4. Product release, product baseline,
governance baseline, schema/benchmark/protocol versions, and the
Service Worker cache identifier are all unchanged
(`PB-APP-RC1.1` / `4676e25` / `5cc91ba` / `2.3.1` / `2.1.1` / `2.2.1`
/ `pb40-v30`).

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
