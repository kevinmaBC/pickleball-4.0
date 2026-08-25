/* tests/ebook-embedded-reader.test.js — PB-EBOOK-RC1.1: Embedded Web Reader
 * Correction.
 *
 * Governance-scope note: covers only the reader-integration correction —
 * replacing the direct-PDF "Open" links with a site-hosted PDF.js reader so
 * reading no longer depends on the browser's built-in PDF viewer/download
 * behavior. Adds no assessment/scoring/recommendation/training/match/
 * progress/reassessment/journey logic and asserts DB_VERSION/stores are
 * unchanged and neither frozen PDF's bytes were touched.
 *
 * Run: node tests/ebook-embedded-reader.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var ROOT = path.join(__dirname, '..');
function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); }
function sha256(rel) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex'); }

var EBOOK_HTML = readSrc('ebook/index.html');
var READER_HTML = readSrc('ebook/reader/index.html');
var READER_JS = readSrc('ebook/reader/reader.js');
var SW_SRC = readSrc('sw.js');
var STORAGE_SRC = stripComments(readSrc('js/storage.js'));
var RELEASE_MANIFEST = JSON.parse(readSrc('ebook/release-manifest.json'));
var PDFJS_LICENSE = readSrc('ebook/vendor/pdfjs/LICENSE');

var CN_SHA256 = '04fcc0ccd9a2027463ce63b2995096d32884c68706b25e2ab92db77d5112d64f';
var EN_SHA256 = 'f3c325ad1372f7979f475479bf7fdc92949868bf9c171c5d769ac0e19c96afa7';
var CN_PDF_PATH_FROM_READER = '../releases/PB-EBOOK-RC1/PB_EBOOK_S4R2-R3_CN_Landscape_Release_Candidate_PB-APP-RC1.1_v1.0.pdf';
var EN_PDF_PATH_FROM_READER = '../releases/PB-EBOOK-RC1/PB_EBOOK_S4R2-R3_EN-CA_Landscape_Release_Candidate_PB-APP-RC1.1_v1.0.pdf';

function run() {

  // Extract the exact <a ...> tag for the Open/Download entries on the
  // e-book landing page, so attribute-level assertions (download attr
  // present/absent) are precise rather than page-wide substring checks.
  function findAnchorTag(hrefValue) {
    var re = new RegExp('<a\\s+[^>]*href="' + hrefValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>', 'g');
    var m = re.exec(EBOOK_HTML);
    return m ? m[0] : null;
  }

  // 1. Chinese "Open" button routes to the reader with edition=zh-CN.
  (function () {
    assert.strictEqual(RELEASE_MANIFEST.reader.chinese, 'reader/?edition=zh-CN', '1: manifest records the Chinese reader route');
    var tag = findAnchorTag('reader/?edition=zh-CN');
    assert.ok(tag, '1: e-book page has an <a href="reader/?edition=zh-CN"> entry');
  })();

  // 2. English "Open" button routes to the reader with edition=en-CA.
  (function () {
    assert.strictEqual(RELEASE_MANIFEST.reader.english, 'reader/?edition=en-CA', '2: manifest records the English reader route');
    var tag = findAnchorTag('reader/?edition=en-CA');
    assert.ok(tag, '2: e-book page has an <a href="reader/?edition=en-CA"> entry');
  })();

  // 3. Neither "Open" button carries a download attribute.
  (function () {
    var cnTag = findAnchorTag('reader/?edition=zh-CN');
    var enTag = findAnchorTag('reader/?edition=en-CA');
    assert.ok(cnTag && cnTag.indexOf('download') === -1, '3: Chinese "Open" entry has no download attribute');
    assert.ok(enTag && enTag.indexOf('download') === -1, '3: English "Open" entry has no download attribute');
  })();

  // 4. Both "Download" buttons still link directly to the frozen PDFs.
  (function () {
    var cnHref = RELEASE_MANIFEST.editions['zh-CN'].file;
    var enHref = RELEASE_MANIFEST.editions['en-CA'].file;
    assert.ok(findAnchorTag(cnHref), '4: Chinese download entry links directly to the frozen PDF');
    assert.ok(findAnchorTag(enHref), '4: English download entry links directly to the frozen PDF');
  })();

  // 5. Both "Download" buttons carry the download attribute.
  (function () {
    var cnTag = findAnchorTag(RELEASE_MANIFEST.editions['zh-CN'].file);
    var enTag = findAnchorTag(RELEASE_MANIFEST.editions['en-CA'].file);
    assert.ok(cnTag && /\bdownload\b/.test(cnTag), '5: Chinese download entry has a download attribute');
    assert.ok(enTag && /\bdownload\b/.test(enTag), '5: English download entry has a download attribute');
  })();

  // 6. reader.js's edition map contains exactly the two authorized keys.
  (function () {
    var mapMatch = /EDITION_PDF\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/.exec(READER_JS);
    assert.ok(mapMatch, '6: reader.js declares a frozen EDITION_PDF map');
    var keys = (mapMatch[1].match(/'([^']+)'\s*:/g) || []).map(function (s) { return s.replace(/[':\s]/g, ''); });
    assert.deepStrictEqual(keys.sort(), ['en-CA', 'zh-CN'], '6: EDITION_PDF map has exactly zh-CN and en-CA');
    assert.ok(/Object\.freeze/.test(READER_JS), '6: EDITION_PDF map is frozen (cannot be mutated at runtime)');
  })();

  // 7. Invalid edition is rejected — no PDF is loaded, an invalid-state UI
  // is shown instead, source-scanned for the guard and the no-load path.
  (function () {
    assert.ok(/hasOwnProperty\.call\(EDITION_PDF/.test(READER_JS), '7: edition lookup is guarded by hasOwnProperty against the frozen map');
    assert.ok(/showInvalid/.test(READER_JS), '7: an invalid-edition branch exists');
    // The invalid branch must return before any reader/PDF.js work begins.
    var initFn = /function init\(\)[\s\S]*?\n\}/.exec(READER_JS)[0];
    var ifIdx = initFn.indexOf('if (!edition)');
    var returnIdx = initFn.indexOf('return;', ifIdx);
    var createReaderIdx = initFn.indexOf('createReader(');
    assert.ok(ifIdx !== -1 && returnIdx !== -1 && returnIdx < createReaderIdx,
      '7: invalid-edition path returns before the reader/PDF.js pipeline is ever started');
  })();

  // 8. reader.js never accepts an arbitrary PDF URL — getDocument is only
  // ever called with the one fixed variable sourced from EDITION_PDF, and
  // no other query-string key is ever read from the page location.
  (function () {
    assert.ok(/getDocument\(\s*\{\s*url:\s*pdfUrl\s*\}\s*\)/.test(READER_JS), '8: getDocument is called only with the fixed pdfUrl variable');
    assert.ok(/var pdfUrl\s*=\s*EDITION_PDF\[edition\];/.test(READER_JS), '8: pdfUrl is assigned only from the frozen EDITION_PDF map');
    var paramGets = READER_JS.match(/\.get\('([^']+)'\)/g) || [];
    assert.deepStrictEqual(paramGets, [".get('edition')"], '8: the only query parameter ever read is "edition"');
  })();

  // 9. Chinese file path mapping is exact.
  (function () {
    var m = /'zh-CN':\s*'([^']+)'/.exec(READER_JS);
    assert.ok(m, '9: zh-CN mapping present in reader.js');
    assert.strictEqual(m[1], CN_PDF_PATH_FROM_READER, '9: zh-CN maps to the exact frozen Chinese PDF path');
    assert.ok(fs.existsSync(path.join(ROOT, 'ebook', 'reader', m[1])), '9: the mapped Chinese PDF path resolves to a real file');
  })();

  // 10. English file path mapping is exact.
  (function () {
    var m = /'en-CA':\s*'([^']+)'/.exec(READER_JS);
    assert.ok(m, '10: en-CA mapping present in reader.js');
    assert.strictEqual(m[1], EN_PDF_PATH_FROM_READER, '10: en-CA maps to the exact frozen English PDF path');
    assert.ok(fs.existsSync(path.join(ROOT, 'ebook', 'reader', m[1])), '10: the mapped English PDF path resolves to a real file');
  })();

  // 11. PDF.js worker is the local vendored file, not a CDN URL.
  (function () {
    assert.ok(/GlobalWorkerOptions\.workerSrc\s*=\s*'\.\.\/vendor\/pdfjs\/pdf\.worker\.min\.mjs'/.test(READER_JS),
      '11: workerSrc points at the local vendored pdf.worker.min.mjs');
    assert.ok(fs.existsSync(path.join(ROOT, 'ebook', 'vendor', 'pdfjs', 'pdf.worker.min.mjs')), '11: vendored worker file exists on disk');
    assert.ok(fs.statSync(path.join(ROOT, 'ebook', 'vendor', 'pdfjs', 'pdf.worker.min.mjs')).size > 0, '11: vendored worker file is non-zero');
  })();

  // 12. No runtime dependency on an external CDN — reader.js's only import
  // is the local vendored PDF.js module, and neither reader.js nor
  // reader/index.html references any external script host.
  (function () {
    assert.ok(/import \* as pdfjsLib from '\.\.\/vendor\/pdfjs\/pdf\.min\.mjs'/.test(READER_JS),
      '12: reader.js imports PDF.js from the local vendored file');
    [READER_JS, READER_HTML].forEach(function (src) {
      assert.strictEqual(/https?:\/\/(?:cdn\.|unpkg\.|jsdelivr\.|cdnjs\.|googleapis\.|cloudflare\.)/i.test(src), false,
        '12: no external CDN host referenced');
      assert.strictEqual(/<script[^>]+src="https?:\/\//i.test(src), false, '12: no externally-hosted <script> tag');
    });
    assert.ok(fs.existsSync(path.join(ROOT, 'ebook', 'vendor', 'pdfjs', 'pdf.min.mjs')), '12: vendored pdf.min.mjs exists on disk');
  })();

  // 13. Reader UI exposes Previous / Next / Zoom In / Zoom Out / Fit Width /
  // Download / Back controls.
  (function () {
    assert.ok(/id="rd-prev"/.test(READER_HTML), '13: Previous control exists');
    assert.ok(/id="rd-next"/.test(READER_HTML), '13: Next control exists');
    assert.ok(/id="rd-zoom-in"/.test(READER_HTML), '13: Zoom In control exists');
    assert.ok(/id="rd-zoom-out"/.test(READER_HTML), '13: Zoom Out control exists');
    assert.ok(/id="rd-fit-width"/.test(READER_HTML), '13: Fit Width control exists');
    assert.ok(/id="rd-download"/.test(READER_HTML), '13: Download control exists');
    assert.ok(/id="rd-back"/.test(READER_HTML), '13: Back-to-e-book-home control exists');
    assert.ok(/id="rd-open-app"/.test(READER_HTML), '13: Open-official-APP control exists');
  })();

  // 14. Never renders all pages at once — exactly one <canvas> element on
  // the reader page, and reader.js renders through a single reused canvas
  // reference rather than creating one canvas per page.
  (function () {
    var canvasTags = READER_HTML.match(/<canvas\b/g) || [];
    assert.strictEqual(canvasTags.length, 1, '14: exactly one <canvas> element in the reader page (no per-page canvases)');
    assert.ok(/\bel\('rd-canvas'\)/.test(READER_JS), '14: reader.js renders onto the single #rd-canvas element');
    assert.strictEqual(/createElement\('canvas'\)/.test(READER_JS), false, '14: reader.js never dynamically creates additional canvases');
    assert.strictEqual(/for\s*\(\s*var\s+\w+\s*=\s*1;[^)]*numPages/.test(READER_JS), false, '14: no loop iterating every page for a bulk render');
    assert.ok(/renderTask\.cancel\(\)/.test(READER_JS), '14: an in-flight render is cancelled before starting the next page (bounded memory)');
  })();

  // 15. Manifest records the PB-EBOOK-RC1.1 integration revision.
  (function () {
    assert.strictEqual(RELEASE_MANIFEST.integration_revision, 'PB-EBOOK-RC1.1', '15: manifest integration_revision is PB-EBOOK-RC1.1');
    assert.strictEqual(RELEASE_MANIFEST.reader.type, 'PDF.js', '15: manifest records the reader type as PDF.js');
    assert.strictEqual(RELEASE_MANIFEST.reader.direct_download_retained, true, '15: manifest records that direct download is retained');
  })();

  // 16. Chinese PDF bytes are unchanged (frozen SHA-256).
  (function () {
    var rel = 'ebook/' + RELEASE_MANIFEST.editions['zh-CN'].file;
    assert.strictEqual(sha256(rel), CN_SHA256, '16: Chinese PDF SHA-256 is unchanged');
    assert.strictEqual(RELEASE_MANIFEST.editions['zh-CN'].sha256, CN_SHA256, '16: manifest SHA-256 for zh-CN is unchanged');
    assert.strictEqual(RELEASE_MANIFEST.editions['zh-CN'].pages, 144, '16: manifest page count for zh-CN is unchanged (144)');
  })();

  // 17. English PDF bytes are unchanged (frozen SHA-256).
  (function () {
    var rel = 'ebook/' + RELEASE_MANIFEST.editions['en-CA'].file;
    assert.strictEqual(sha256(rel), EN_SHA256, '17: English PDF SHA-256 is unchanged');
    assert.strictEqual(RELEASE_MANIFEST.editions['en-CA'].sha256, EN_SHA256, '17: manifest SHA-256 for en-CA is unchanged');
    assert.strictEqual(RELEASE_MANIFEST.editions['en-CA'].pages, 102, '17: manifest page count for en-CA is unchanged (102)');
  })();

  // 18. Service Worker still never precaches either large PDF.
  (function () {
    var coreMatch = /const\s+CORE\s*=\s*\[([\s\S]*?)\];/.exec(SW_SRC);
    assert.ok(coreMatch, '18: sw.js declares a CORE precache list');
    assert.strictEqual(/\.pdf/i.test(coreMatch[1]), false, '18: sw.js CORE precache list must not reference any .pdf file');
    // The vendored PDF.js runtime files ARE permitted (and expected) in CORE.
    assert.ok(coreMatch[1].indexOf("'./ebook/vendor/pdfjs/pdf.min.mjs'") !== -1, '18: vendored pdf.min.mjs is precached');
    assert.ok(coreMatch[1].indexOf("'./ebook/vendor/pdfjs/pdf.worker.min.mjs'") !== -1, '18: vendored pdf.worker.min.mjs is precached');
    assert.ok(coreMatch[1].indexOf("'./ebook/reader/reader.js'") !== -1, '18: reader.js is precached');
    assert.ok(coreMatch[1].indexOf("'./ebook/reader/reader.css'") !== -1, '18: reader.css is precached');
  })();

  // 19. DB_VERSION remains 5.
  (function () {
    assert.ok(/var DB_VERSION = 5;/.test(STORAGE_SRC), '19: DB_VERSION remains 5');
  })();

  // 20. Store count remains 18/18.
  (function () {
    var storesBlockMatch = STORAGE_SRC.match(/var STORES = \{([\s\S]*?)\n  \};/);
    assert.ok(storesBlockMatch, '20: STORES config block found');
    var keyPathCount = (storesBlockMatch[1].match(/keyPath:/g) || []).length;
    assert.strictEqual(keyPathCount, 18, '20: exactly 18 stores (found ' + keyPathCount + ')');
  })();

  // Vendored PDF.js is a real, licensed, versioned distribution — not a
  // hand-written stand-in renderer.
  (function () {
    assert.ok(/Apache License/.test(PDFJS_LICENSE), 'PDF.js LICENSE file is present and is the Apache License');
    var pdfLib = readSrc('ebook/vendor/pdfjs/pdf.min.mjs');
    assert.ok(/Mozilla Foundation/.test(pdfLib), 'vendored pdf.min.mjs carries the Mozilla Foundation copyright header');
    assert.ok(/6\.2\.108/.test(pdfLib), 'vendored pdf.min.mjs embeds the expected pinned version string 6.2.108');
    assert.ok(fs.statSync(path.join(ROOT, 'ebook', 'vendor', 'pdfjs', 'pdf.min.mjs')).size > 0, 'vendored pdf.min.mjs is non-zero');
  })();

  // Reader UI text is bilingual-primary per edition (Chinese-first for
  // zh-CN, Canadian English for en-CA) — source-scanned label tables.
  (function () {
    assert.ok(/'zh-CN':\s*\{[\s\S]*?htmlLang:\s*'zh-CN'/.test(READER_JS), 'zh-CN label set declares htmlLang zh-CN');
    assert.ok(/'en-CA':\s*\{[\s\S]*?htmlLang:\s*'en-CA'/.test(READER_JS), 'en-CA label set declares htmlLang en-CA');
  })();

  console.log('ebook-embedded-reader.test.js: all assertions passed');
}

run();
