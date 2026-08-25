# PB-APP-RC1.1-R2 — Homepage E-Book Entry & Language Switch Enhancement

Stage: `PB-APP-RC1.1-R2`
Status: `CLOSED / ACCEPTED / RELEASE FROZEN`
Entry Branch: `app-v2-alpha`
Entry HEAD: `5bd538bc0df1d0d6129b17386806641082c81d86` (`5bd538b`)
Current APP Baseline: `PB-APP-RC1.1`
Current E-Book Content Edition: `PB-EBOOK-RC1`
Current E-Book Reader Release: `PB-EBOOK-RC1.1-R1`

## 1. Purpose and Frozen Scope

UX/discoverability patch only, exactly the two items authorized:

1. One prominent official E-Book entry card on the APP homepage
   (`#home-ebook-entry`), positioned after the hero/intro section and
   before `S11-B · Priority Dashboard`.
2. Enlarging the existing small "中 / EN" header control into a
   prominent segmented `中文 | ENGLISH` control (`#lang-switch-group`),
   reusing the existing `setLang()` / `LANG` / `pb40_lang` mechanism
   unchanged.

No other feature was implemented. No assessment/scoring/
recommendation/training/match/progress/reassessment/journey logic was
touched, no database migration, no store change, no E-Book PDF/Word/
reader/vendor/QR file was modified, and no GitHub Pages configuration
was changed.

## 2. Files Modified

```
index.html — header: replaced the single <button class="lang-switch"
              id="lang-btn" onclick="toggleLang()"> with a two-button
              segmented control (#lang-switch-group > #lang-btn-zh /
              #lang-btn-en, each calling the existing setLang('zh'/'en')).
              Homepage: added #home-ebook-entry card (title, bilingual-
              editions subtitle, "LATEST RELEASE" badge, and the
              #home-ebook-open-btn primary button linking to ./ebook/)
              immediately after the hero section and before the S11-B
              Priority Dashboard block. The existing About & Version
              panel's E-Book entry (QR, URL, "打开电子书 / Open E-Book"
              button with its original target="_blank") is untouched.
css/app.css — replaced the old .lang-switch rule with
              .lang-switch-group/.lang-opt (segmented control, active/
              hover/focus-visible states). Added .home-ebook-btn/
              .home-ebook-badge (new rules only; no existing selector's
              declaration was changed).
js/i18n.js  — applyI18n()'s DOM-sync step: replaced the old single-
              button innerHTML swap with aria-pressed + active-class
              sync across the two new buttons. LANG/t()/I18N data/
              setLang()/toggleLang()/storage-key logic is byte-for-byte
              unchanged — presentation-only change.
```

Added:
```
tests/rc1.1-r2-ebook-discoverability-language-switch.test.js
docs/PB-APP-RC1.1-R2-EBOOK-DISCOVERABILITY-LANGUAGE-SWITCH.md
```

`sw.js`, `data/app-release.json`, and `js/version-update.js` were
**not modified** — see Section 6.

## 3. Permanent URLs (Unchanged)

```
APP:    https://kevinmabc.github.io/pickleball-4.0/
E-Book: https://kevinmabc.github.io/pickleball-4.0/ebook/
```

The new homepage button's `href="./ebook/"` resolves to the exact
permanent E-Book URL above; it opens in the current APP/PWA window
(no `target`, no `download`), never a PDF, never a versioned path,
and never auto-selects an edition.

## 4. QR Payloads (Unchanged)

`assets/qr/qr-app.svg` and `assets/qr/qr-ebook.svg` were not touched.
Confirmed byte-identical before and after this stage:
```
qr-app.svg   SHA-256: 7f48201efe07933f26a50baa5dc8828e3f3a7af8d321da5e074532deff610de3
qr-ebook.svg SHA-256: 962018a8a8904840a0889b37d0a9e675a20b30e54d0a26b394573d40da94c0e7
```

## 5. E-Book Content / Business Logic (Unchanged)

Neither frozen PDF, the Word masters, `ebook/reader/**`, nor
`ebook/vendor/**` was modified this stage:
```
Chinese PDF SHA-256: 04fcc0ccd9a2027463ce63b2995096d32884c68706b25e2ab92db77d5112d64f
English PDF SHA-256: f3c325ad1372f7979f475479bf7fdc92949868bf9c171c5d769ac0e19c96afa7
```
No file implementing Assessment/Training/Match/Progress/
Recommendation logic, KPI calculation, Validated Level rules, CAP
weights, or TRAINING/MATCH Transfer separation was touched.

```
DB_VERSION: 5 (unchanged)
Stores: 18 / 18 (unchanged)
```

## 6. Service Worker — No Cache Revision Made (By Design)

`index.html` is served as an HTML navigation request (`isNav` branch)
and `css/app.css` / `js/i18n.js` both match the existing
`isCodeOrData` regex (`/\.(js|css|json)$/i`) in `sw.js`'s fetch
handler — both branches are **network-first**: online, the browser
always fetches the latest bytes and refreshes the cache entry
transparently; the cache is only an offline fallback. An installed
PWA user therefore receives this stage's updated homepage/header on
the next online load with no `CACHE` version bump required. Per
Section 9's explicit instruction ("if the existing Service Worker
already updates these files correctly without a cache revision,
document the evidence and do not make an unnecessary change"),
`sw.js`, `data/app-release.json`, and `js/version-update.js` were
left untouched — no new/removed/renamed precache entry, Check for
Updates/Update and Restart/reload-loop prevention are all unaffected
(byte-identical), and no user data was cleared.

## 7. Test Commands and Results

```
node tests/rc1.1-r2-ebook-discoverability-language-switch.test.js
rc1.1-r2-ebook-discoverability-language-switch.test.js: all assertions passed

node tests/rc1.1-version-ebook-access.test.js
rc1.1-version-ebook-access.test.js: all assertions passed

node tests/ebook-embedded-reader.test.js
ebook-embedded-reader.test.js: all assertions passed

node tests/sw-cache.test.js
sw-cache.test.js: all assertions passed

node tests/pre-s7-ui-regression.test.js
pre-s7-ui-regression.test.js: all assertions passed

node tests/s10-final-acceptance.test.js   (FA23_FULL_REGRESSION gate)
s10-final-acceptance.test.js: all gates passed — FA02, FA15, FA20_AND_INVARIANTS,
FA03_FA05_SOURCE_OF_TRUTH, FA04, FA09_JOURNEY_STEP1_S9, FA09_JOURNEY_STEP2_WORKFLOW_SESSION,
FA09_JOURNEY_STEP3_NON_EVIDENCE_STATES, FA09_JOURNEY_STEP4_CYCLE_EVIDENCE,
FA07_FA13_FA14_PROGRESS_BASELINE, FA12_FA19_TRAINING_MATCH_SEPARATION,
FA09_JOURNEY_STEP5_REASSESSMENT_READY, FA08_FA18_REAL_MATCH_REASSESSMENT, FA17_IDEMPOTENCY,
FA21_FA22_METHODOLOGY, FA24_NO_S11_WORK, FA23_FULL_REGRESSION
Full Regression Result: 57 / 57 test suites PASS (56 suites spawned by the
FA23_FULL_REGRESSION gate, all passed, plus s10-final-acceptance.test.js itself)
0 failures
```

Manual responsive verification (headless browser, real
`getBoundingClientRect()`/computed-style checks, not a visual
screenshot — the pane does not composite frames in this environment):
at 1366 / 768 / 390 / 320 CSS px, no horizontal overflow at any width;
`.home-ebook-btn` measured 56px min-height, capped at 420px on wide
viewports and 100%-of-card width on narrow ones; `.lang-switch-group`
measured 48px height and ~150px total width with both "中文"/"ENGLISH"
labels fully rendered (no clipping); real keyboard `Tab`/`Enter`
events (not scripted `.focus()`) confirmed `:focus-visible` outlines
render on both language options and the new E-Book button, and Enter
on the ENGLISH option correctly called the existing `setLang('en')`
(verified `LANG`/`localStorage.pb40_lang` updated, translations
re-applied, no new storage key created).

## 8. Implementation Record

```
Entry Branch: app-v2-alpha
Entry HEAD: 5bd538bc0df1d0d6129b17386806641082c81d86
Implementation Commit: a634bd687270b254d3c44793650111a2ea7e86fa
Production Business Logic Changed: NO
E-Book Word/PDF/Reader/Vendor Content Changed: NO
QR Payloads Changed: NO
GitHub Pages Configuration Changed: NO
DB_VERSION: 5 (unchanged)
Stores: 18 / 18 (unchanged)
GPT Independent QA: PASS
Kevin Manual UAT: PASS
Status: CLOSED / ACCEPTED / RELEASE FROZEN
```

## 9. Known Limitations

- Visual confirmation was performed via precise DOM/CSS measurement
  (`getBoundingClientRect`, `getComputedStyle`, real keyboard events)
  rather than a rendered screenshot, because this headless testing
  environment's Browser pane does not composite frames outside an
  active viewing session. A human visual check on a real device/
  browser (see Manual Verification in the final report) remains
  recommended before acceptance.
- This stage does not redefine or supersede the frozen `PB-APP-RC1`
  product baseline (`4676e25`), the R4 FINAL governance closure
  (`5cc91ba`), the `PB-APP-RC1.1` acceptance (`0dd71ee`), the
  `PB-EBOOK-RC1` publication (`d2c5330`), or the `PB-EBOOK-RC1.1`/
  `PB-EBOOK-RC1.1-R1` reader corrections (`c39c092` / `5bd538b`) —
  see `docs/MASTER-CONTROL-V2.md`.

This stage is marked `CLOSED / ACCEPTED / RELEASE FROZEN`. GPT
Independent QA and Kevin's manual UAT both returned PASS against
Implementation Commit `a634bd687270b254d3c44793650111a2ea7e86fa`. See
Governance Closure record in `docs/MASTER-CONTROL-V2.md`.
