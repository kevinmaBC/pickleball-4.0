# PB-EBOOK-RC1 — APP Publication Integration

Stage: `PB-EBOOK-RC1`
Status: `IMPLEMENTED / GPT QA PENDING`
Entry HEAD: `f99632a3e464cfd58697dd59bc456364acacdced` (`f99632a`)
APP Baseline: `PB-APP-RC1.1`
E-Book Design Baseline: `EBOOK-S4R2-R3`

## 1. Purpose

Publish the two formally frozen PB-EBOOK-RC1.1 PDFs (Chinese and
English/Canada editions) as downloadable/readable entries on the
existing permanent E-Book landing page (`ebook/index.html`), replacing
the prior "In Preparation" placeholder state. This is a publication/
distribution-layer integration only — it does not touch APP business
logic, the database schema, or the frozen PDF contents themselves.

## 2. Frozen Publication Inputs

Both PDFs were supplied pre-frozen (external QA/production process,
outside this repository) and were moved into the repository byte-for-
byte unchanged — filenames and contents untouched.

```
Chinese Edition:
  File: ebook/releases/PB-EBOOK-RC1/PB_EBOOK_S4R2-R3_CN_Landscape_Release_Candidate_PB-APP-RC1.1_v1.0.pdf
  SHA-256: 04fcc0ccd9a2027463ce63b2995096d32884c68706b25e2ab92db77d5112d64f
  Pages: 144

English Edition:
  File: ebook/releases/PB-EBOOK-RC1/PB_EBOOK_S4R2-R3_EN-CA_Landscape_Release_Candidate_PB-APP-RC1.1_v1.0.pdf
  SHA-256: f3c325ad1372f7979f475479bf7fdc92949868bf9c171c5d769ac0e19c96afa7
  Pages: 102
```

SHA-256 was verified identical before the move (repository root) and
after the move (final `ebook/releases/PB-EBOOK-RC1/` location) — see
Section 8. Both values match exactly the values authorized before
implementation began; had either changed, implementation would have
stopped immediately (it did not).

## 3. Files Added / Modified

Added:
```
ebook/releases/PB-EBOOK-RC1/PB_EBOOK_S4R2-R3_CN_Landscape_Release_Candidate_PB-APP-RC1.1_v1.0.pdf
ebook/releases/PB-EBOOK-RC1/PB_EBOOK_S4R2-R3_EN-CA_Landscape_Release_Candidate_PB-APP-RC1.1_v1.0.pdf
ebook/release-manifest.json
docs/PB-EBOOK-RC1-APP-PUBLICATION-INTEGRATION.md
```

Modified:
```
ebook/index.html                        — replaced the "正在装配中 /
                                            In Preparation" placeholder
                                            state on both edition cards
                                            with "正式发布 / Released"
                                            status, version/date/page-
                                            count metadata, and four
                                            entry points (Open/Download
                                            x CN/EN) linking to the two
                                            frozen PDFs. Release Notes
                                            updated accordingly.
                                            APP QR, APP URL, Open APP
                                            button, Author & Contact,
                                            and Copyright are unchanged.
tests/rc1.1-version-ebook-access.test.js — test #12 updated from
                                            asserting "In Preparation"
                                            (pre-publication state) to
                                            asserting the published
                                            state; 11 new PB-EBOOK-RC1
                                            assertions (EB-1..EB-11)
                                            added covering release
                                            identity, page counts, the
                                            four entry links, on-disk
                                            file presence/non-zero
                                            size, manifest-vs-disk
                                            SHA-256 verification,
                                            manifest parse/RELEASED
                                            status, sync_control flags,
                                            Word-master non-exposure,
                                            Service-Worker PDF-precache
                                            exclusion, APP QR/URL
                                            preservation, and the
                                            return-to-APP link.
```

`sw.js` was **not modified** — its `CORE` precache list already did
not reference `ebook/` or any PDF, and its generic network-first
navigation handling already serves `ebook/index.html` without needing
a CORE entry. No cache-version bump was required or made.

## 4. Release Manifest

`ebook/release-manifest.json` (see file for exact content):

```json
{
  "schema_version": 1,
  "release": "PB-EBOOK-RC1",
  "status": "RELEASED",
  "release_date": "2026-08-23",
  "app_baseline": "PB-APP-RC1.1",
  "design_baseline": "EBOOK-S4R2-R3",
  "editions": { "zh-CN": { "...": "144 pages, sha256 above" },
                "en-CA": { "...": "102 pages, sha256 above" } },
  "word_masters": { "public_download": false, "...": "sha256 refs only" },
  "sync_control": { "cn_en_paired": true, "app_ebook_paired": true,
                     "future_changes_require_new_version": true }
}
```

Word master files are **not** shipped in this repository and are not
publicly downloadable — the manifest records only their SHA-256 for
future integrity reference; `public_download: false` is enforced.

## 5. Protected Invariants (Unchanged)

```
DB_VERSION = 5                              unchanged — verified by test #14
Stores = 18 / 18                            unchanged — verified by test #15
PDF file contents / filenames               unchanged — verified by SHA-256 (Section 8)
Word master files                           not exposed — verified by EB-8
Assessment/Training/Match/Progress/
Recommendation business logic               untouched — no such file modified
GitHub Pages configuration                  untouched — no workflow/settings file modified
```

## 6. Test Results

Targeted publication integration tests:
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
<result recorded at Section 8 / final report>
```

## 7. Manual Verification Required (Post-Deploy)

- Open deployed APP
- Open `/ebook/`
- Open Chinese PDF
- Download Chinese PDF
- Open English PDF
- Download English PDF
- Scan APP QR
- Test mobile layout
- Test installed PWA
- Test Check for Updates

## 8. Implementation Record

```
Entry HEAD: f99632a3e464cfd58697dd59bc456364acacdced
Implementation Commit: <recorded post-commit — see final report>
SHA-256 before move == SHA-256 after move: CONFIRMED (both editions)
DB_VERSION: 5 (unchanged)
Stores: 18 / 18 (unchanged)
Production Business Logic Changed: NO
Frozen E-book Contents Changed: NO
GitHub Pages Configuration Changed: NO
Status: IMPLEMENTED / GPT QA PENDING
```

This stage does not redefine or supersede the frozen `PB-APP-RC1`
product baseline (`4676e25`), the R4 FINAL governance closure
(`5cc91ba`), or the `PB-APP-RC1.1` acceptance (`0dd71ee`) — see
`docs/MASTER-CONTROL-V2.md`.
