# PB-EBOOK-RC1.1 — Embedded Web Reader Correction

Stage: `PB-EBOOK-RC1.1`
Status: `IMPLEMENTED / GPT QA PENDING`
Entry HEAD: `d2c5330644e6f0493b94057d57fa7a411fd9a0c2` (`d2c5330`)
E-Book Content Baseline: `PB-EBOOK-RC1`

## 1. Root Cause

`PB-EBOOK-RC1`'s "阅读中文版 / Open Chinese Edition" and "Open English
Edition" buttons linked directly to the frozen PDF files. Many mobile
and desktop browsers are configured to download PDFs rather than open
them in-page, so the "read" action was indistinguishable from the
"download" action in those browsers — the reading path did not work
as intended.

## 2. Correction Scope

Added a site-hosted PDF.js embedded reader (`ebook/reader/`) so
reading no longer depends on the browser's built-in PDF viewer or its
download-vs-view configuration. The "Open" buttons on
`ebook/index.html` now route to the reader; the "Download" buttons
are unchanged (direct link, `download` attribute, straight to the
frozen PDF). Neither frozen PDF's bytes, filename, or page count were
touched — see Section 6 for hash verification.

## 3. PDF.js Version and Source

```
Library:       PDF.js (Mozilla)
Version:       6.2.108  (pinned, npm dist-tag "latest" at implementation time)
Official source: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.2.108.tgz
License:       Apache-2.0 (ebook/vendor/pdfjs/LICENSE, Mozilla Foundation)
Homepage:      https://mozilla.github.io/pdf.js/
Repository:    https://github.com/mozilla/pdf.js
```

Verification performed before vendoring (build-time only — the
shipped page never contacts this or any other CDN at runtime):
```
Downloaded tarball SHA-1:    1e0ce0f4b3a034f953dbbe2334ab01fbddf0eb30
npm registry published SHA-1: 1e0ce0f4b3a034f953dbbe2334ab01fbddf0eb30   MATCH
Downloaded tarball SHA-512 (base64): YxFb+SQcodN2rnX9Tn3dHYlqfb7NjlzzfONPpJd+AKoKtUjEdevTfbC07d5TcczzOK6261auRkP/M8OBHs9vFQ==
npm registry published integrity:     sha512-YxFb+SQcodN2rnX9Tn3dHYlqfb7NjlzzfONPpJd+AKoKtUjEdevTfbC07d5TcczzOK6261auRkP/M8OBHs9vFQ==   MATCH
```
Both `build/pdf.min.mjs` and `build/pdf.worker.min.mjs` were extracted
from the same verified tarball as-is (unmodified, official minified
builds) and copied to `ebook/vendor/pdfjs/`, along with the package's
`LICENSE` file (Apache License 2.0, Mozilla Foundation). No CDN is
referenced anywhere in the shipped `ebook/reader/` page or script —
`tests/ebook-embedded-reader.test.js` source-scans for this.

## 4. Files Added / Modified

Added:
```
ebook/reader/index.html
ebook/reader/reader.css
ebook/reader/reader.js
ebook/vendor/pdfjs/pdf.min.mjs
ebook/vendor/pdfjs/pdf.worker.min.mjs
ebook/vendor/pdfjs/LICENSE
tests/ebook-embedded-reader.test.js
docs/PB-EBOOK-RC1.1-EMBEDDED-WEB-READER-CORRECTION.md
```

Modified:
```
ebook/index.html          — "Open" buttons now link to
                             reader/?edition=zh-CN / reader/?edition=en-CA
                             instead of the raw PDF. "Download" buttons
                             unchanged (direct PDF link + download attr).
ebook/release-manifest.json — added integration_revision:"PB-EBOOK-RC1.1"
                             and a "reader" block (type, chinese/english
                             routes, direct_download_retained:true).
                             Edition filenames/pages/sha256 unchanged.
sw.js                      — CACHE bumped pb40-v30 -> pb40-v31; CORE gained
                             ebook/reader/reader.js, ebook/reader/reader.css,
                             ebook/vendor/pdfjs/pdf.min.mjs,
                             ebook/vendor/pdfjs/pdf.worker.min.mjs. Neither
                             frozen PDF was added to CORE. No change to the
                             existing fetch caching strategy, message
                             handler, or install/activate logic.
data/app-release.json     — sw_cache: "pb40-v30" -> "pb40-v31" only (kept in
                             sync with sw.js's CACHE so a freshly-deployed
                             app doesn't report UPDATE_AVAILABLE against
                             itself; all other identity fields unchanged).
js/version-update.js      — RUNNING_RELEASE.sw_cache: 'pb40-v30' ->
                             'pb40-v31' only, mirroring the above.
tests/rc1.1-version-ebook-access.test.js — sw_cache literals updated to
                             pb40-v31 (tests #1/#3); EB-3 updated from
                             "2 links to the PDF per edition" to "1 direct
                             download link + 1 reader link", since the
                             Open button no longer points at the PDF.
```

No file under `js/` implementing S9/S10/S11 business logic, no DB
schema/migration file, no `manifest.json`, and no GitHub Pages
workflow/settings file was touched. Neither PDF's bytes or filename
was modified.

## 5. Reader Routing and Input Safety

`ebook/reader/reader.js` looks the `edition` query parameter up in a
single `Object.freeze`d map with exactly two keys:

```js
var EDITION_PDF = Object.freeze({
  'zh-CN': '../releases/PB-EBOOK-RC1/PB_EBOOK_S4R2-R3_CN_Landscape_Release_Candidate_PB-APP-RC1.1_v1.0.pdf',
  'en-CA': '../releases/PB-EBOOK-RC1/PB_EBOOK_S4R2-R3_EN-CA_Landscape_Release_Candidate_PB-APP-RC1.1_v1.0.pdf'
});
```

Lookup is guarded by `hasOwnProperty.call(EDITION_PDF, edition)`; any
other value (missing, empty, or arbitrary) takes the invalid-edition
branch, which returns before any PDF.js call is made — no other query
parameter is ever read from the page location, and `getDocument()` is
called exactly once, always with `{ url: pdfUrl }` where `pdfUrl` was
assigned only from `EDITION_PDF[edition]`. No URL, path, or other
user input can reach PDF.js. `tests/ebook-embedded-reader.test.js`
tests #6-#10 source-scan for exactly this shape.

## 6. Frozen PDF Integrity (Unchanged)

```
Chinese Edition SHA-256: 04fcc0ccd9a2027463ce63b2995096d32884c68706b25e2ab92db77d5112d64f
English Edition SHA-256: f3c325ad1372f7979f475479bf7fdc92949868bf9c171c5d769ac0e19c96afa7
```
Both re-verified byte-identical to the PB-EBOOK-RC1 frozen values
after this stage's changes — neither file's bytes, filename, page
count (144 CN / 102 EN), or location moved.

## 7. Memory-Bounded Rendering

The reader renders exactly one page at a time onto a single reused
`<canvas>` element (`#rd-canvas`) — never all 144/102 pages at once,
and never one canvas per page. Any in-flight `renderTask` is
cancelled (`renderTask.cancel()`) before the next page's render
begins, and at most one further page request is queued (a single
`pendingPage` slot, not an unbounded queue) so rapid Next/Previous
taps cannot stack up render work or memory.

## 8. Protected Invariants (Unchanged)

```
DB_VERSION = 5                              unchanged — verified by test #19 (new suite) / #14 (existing suite)
Stores = 18 / 18                            unchanged — verified by test #20 (new suite) / #15 (existing suite)
PDF file contents / filenames               unchanged — verified by SHA-256 (Section 6)
Word master files                           not exposed — unaffected by this stage
Assessment/Training/Match/Progress/
Recommendation business logic               untouched — no such file modified
GitHub Pages configuration                  untouched — no workflow/settings file modified
```

## 9. Test Results

Embedded Reader targeted tests:
```
node tests/ebook-embedded-reader.test.js
ebook-embedded-reader.test.js: all assertions passed
```

RC1.1 publication tests (updated):
```
node tests/rc1.1-version-ebook-access.test.js
rc1.1-version-ebook-access.test.js: all assertions passed
```

Service Worker tests:
```
node tests/sw-cache.test.js
sw-cache.test.js: all assertions passed
```

Full regression:
```
node tests/s10-final-acceptance.test.js  (FA23_FULL_REGRESSION gate)
<result recorded at final report>
```

## 10. Manual Verification Required (Post-Deploy)

- Open deployed `/ebook/`
- Open Chinese embedded reader
- Confirm Chinese page 1 renders
- Confirm Chinese page count = 144
- Test Previous / Next
- Test Zoom / Fit Width
- Test Chinese direct download
- Open English embedded reader
- Confirm English page 1 renders
- Confirm English page count = 102
- Test English direct download
- Test mobile layout
- Test installed PWA
- Test Check for Updates

Note: automated headless verification during implementation confirmed
`getDocument()`/`getPage()` resolve correctly and that PDF.js can
rasterize real page content from both frozen PDFs (`numPages` reads
144 for the Chinese edition and 102 for the English edition, matching
the manifest exactly); the display-intent `page.render()` call is
internally paced by `requestAnimationFrame`, which browsers suspend
on a non-visible/non-composited tab — exactly the condition of the
headless test harness used here — so live on-screen Next/Previous
paging could not be visually captured in that harness and is called
out explicitly above for manual confirmation in a normal, visible
browser tab (where `requestAnimationFrame` runs normally, as it does
for every other canvas-based PDF.js viewer, including Mozilla's own
reference viewer).

## 11. Implementation Record

```
Entry HEAD: d2c5330644e6f0493b94057d57fa7a411fd9a0c2
Implementation Commit: <recorded post-commit — see final report>
PDF.js Version: 6.2.108 (pinned, official npm registry, SHA-1/SHA-512 verified)
Chinese/English SHA-256 before change == after change: CONFIRMED
DB_VERSION: 5 (unchanged)
Stores: 18 / 18 (unchanged)
Production Business Logic Changed: NO
Frozen E-book Contents Changed: NO
GitHub Pages Configuration Changed: NO
Status: IMPLEMENTED / GPT QA PENDING
```

This stage does not redefine or supersede the frozen `PB-APP-RC1`
product baseline (`4676e25`), the R4 FINAL governance closure
(`5cc91ba`), the `PB-APP-RC1.1` acceptance (`0dd71ee`), or the
`PB-EBOOK-RC1` publication (`d2c5330`) — see
`docs/MASTER-CONTROL-V2.md`.
