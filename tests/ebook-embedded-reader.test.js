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

// PB-EBOOK-RC1.1-R1: computeOutputScale() in reader.js is a pure function
// (no DOM/PDF.js dependency) — extract its real source text (constants +
// function body) straight out of reader.js and reconstruct it here with
// `new Function`, so its boundary conditions are verified against the
// actual shipped code, not a re-implementation that could drift from it.
function extractBalancedBlock(src, markerIndex) {
  var braceStart = src.indexOf('{', markerIndex);
  var depth = 0;
  for (var i = braceStart; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (depth === 0) { return src.slice(markerIndex, i + 1); } }
  }
  throw new Error('unbalanced braces starting at index ' + markerIndex);
}
var DPI_CONSTANTS_START = READER_JS.indexOf('var MIN_OUTPUT_SCALE');
var DPI_FUNC_START = READER_JS.indexOf('function computeOutputScale');
assert.ok(DPI_CONSTANTS_START !== -1 && DPI_FUNC_START !== -1, 'reader.js must declare the High-DPI constants and computeOutputScale()');
var DPI_CONSTANTS_SRC = READER_JS.slice(DPI_CONSTANTS_START, READER_JS.indexOf(';', READER_JS.lastIndexOf('var MAX_CANVAS_PIXELS', DPI_FUNC_START)) + 1);
var DPI_FUNC_SRC = extractBalancedBlock(READER_JS, DPI_FUNC_START);
var computeOutputScale = new Function(DPI_CONSTANTS_SRC + '\n' + DPI_FUNC_SRC + '\nreturn computeOutputScale;')();

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

  // ================================================================
  // PB-EBOOK-RC1.1-R1 — High-DPI Canvas Rendering Correction.
  // computeOutputScale() reconstructed from reader.js's own source above.
  // ================================================================

  // DPI-1. DPR=1: physical size equals the CSS viewport size (no boost).
  (function () {
    var r = computeOutputScale(860, 664, 1);
    assert.strictEqual(r.requestedScale, 1, 'DPI-1: requestedScale is 1 at DPR=1');
    assert.strictEqual(r.effectiveScale, 1, 'DPI-1: effectiveScale is 1 at DPR=1');
    assert.strictEqual(r.physicalWidth, 860, 'DPI-1: physical width equals viewport width at DPR=1');
    assert.strictEqual(r.physicalHeight, 664, 'DPI-1: physical height equals viewport height at DPR=1');
  })();

  // DPI-2. DPR=1.25: internal resolution increases; source confirms CSS
  // width is set independently of devicePixelRatio (checked in DPI-11/12).
  (function () {
    var r = computeOutputScale(860, 664, 1.25);
    assert.strictEqual(r.effectiveScale, 1.25, 'DPI-2: effectiveScale is 1.25 at DPR=1.25');
    assert.ok(r.physicalWidth > 860, 'DPI-2: internal resolution increases above the CSS viewport width');
    assert.strictEqual(r.physicalWidth, Math.floor(860 * 1.25), 'DPI-2: physical width is floor(viewport * 1.25)');
  })();

  // DPI-3. DPR=1.5: internal resolution increases further.
  (function () {
    var r = computeOutputScale(860, 664, 1.5);
    assert.strictEqual(r.effectiveScale, 1.5, 'DPI-3: effectiveScale is 1.5 at DPR=1.5');
    assert.strictEqual(r.physicalWidth, Math.floor(860 * 1.5), 'DPI-3: physical width is floor(viewport * 1.5)');
  })();

  // DPI-4. DPR=2: internal width is exactly 2x the CSS width.
  (function () {
    var r = computeOutputScale(860, 664, 2);
    assert.strictEqual(r.effectiveScale, 2, 'DPI-4: effectiveScale is 2 at DPR=2');
    assert.strictEqual(r.physicalWidth, 1720, 'DPI-4: physical width is exactly 2x the 860px CSS width');
    assert.strictEqual(r.physicalHeight, 1328, 'DPI-4: physical height is exactly 2x the 664px CSS height');
  })();

  // DPI-5. DPR>2 is capped at 2 (e.g. 3, and an unusually high 4).
  (function () {
    assert.strictEqual(computeOutputScale(860, 664, 3).requestedScale, 2, 'DPI-5: DPR=3 capped at requestedScale 2');
    assert.strictEqual(computeOutputScale(860, 664, 4).requestedScale, 2, 'DPI-5: DPR=4 capped at requestedScale 2');
  })();

  // DPI-6. Untrusted/invalid devicePixelRatio values fall back safely to 1.
  (function () {
    [0, NaN, Infinity, -Infinity, -2, 'not-a-number', undefined, null].forEach(function (bad) {
      var r = computeOutputScale(860, 664, bad);
      assert.strictEqual(r.requestedScale, 1, 'DPI-6: DPR=' + bad + ' falls back to requestedScale 1');
      assert.ok(isFinite(r.effectiveScale) && r.effectiveScale > 0, 'DPI-6: DPR=' + bad + ' still yields a finite positive effectiveScale');
    });
  })();

  // DPI-7. Physical dimension never exceeds 4096 on either edge, even for
  // a very large viewport at max DPR.
  (function () {
    var r = computeOutputScale(3000, 2000, 2);
    assert.ok(r.physicalWidth <= 4096, 'DPI-7: physicalWidth <= 4096');
    assert.ok(r.physicalHeight <= 4096, 'DPI-7: physicalHeight <= 4096');
  })();

  // DPI-8. Total pixel budget never exceeds 12,000,000, even when neither
  // edge alone would trip the 4096 cap.
  (function () {
    var r = computeOutputScale(2000, 2000, 2);
    assert.ok(r.physicalWidth * r.physicalHeight <= 12000000, 'DPI-8: total physical pixels <= 12,000,000');
  })();

  // DPI-9. When a cap is hit, effectiveScale is reduced proportionally
  // (never left at the uncapped requestedScale).
  (function () {
    var r = computeOutputScale(3000, 2000, 2);
    assert.ok(r.effectiveScale < r.requestedScale, 'DPI-9: effectiveScale is reduced below requestedScale when a cap is hit');
    assert.ok(r.effectiveScale > 0, 'DPI-9: effectiveScale stays positive');
  })();

  // DPI-10. No cropping — width and height are always scaled by the exact
  // same effectiveScale, so aspect ratio is preserved even when capped.
  (function () {
    var vw = 3000, vh = 2000;
    var r = computeOutputScale(vw, vh, 2);
    var expectedH = Math.floor(vh * r.effectiveScale);
    assert.strictEqual(r.physicalHeight, expectedH, 'DPI-10: height uses the same effectiveScale as width (no independent crop)');
    var originalRatio = vw / vh, physicalRatio = r.physicalWidth / r.physicalHeight;
    assert.ok(Math.abs(originalRatio - physicalRatio) < 0.01, 'DPI-10: aspect ratio is preserved (uniform scale, not a crop)');
  })();

  // DPI-11/12. CSS width/height are never multiplied by DPR/outputScale —
  // sourced only from the (unchanged) zoom/Fit Width viewport size.
  (function () {
    assert.ok(/canvas\.style\.width\s*=\s*Math\.floor\(viewport\.width\)\s*\+\s*'px'/.test(READER_JS),
      'DPI-11: canvas.style.width is set from viewport.width only, never multiplied by DPR/outputScale');
    assert.ok(/canvas\.style\.height\s*=\s*Math\.floor\(viewport\.height\)\s*\+\s*'px'/.test(READER_JS),
      'DPI-12: canvas.style.height is set from viewport.height only, never multiplied by DPR/outputScale');
    assert.strictEqual(/canvas\.style\.(width|height)\s*=[^;]*(devicePixelRatio|dpr|outputScale|output\.effectiveScale)/.test(READER_JS), false,
      'DPI-11/12: CSS size expressions never reference devicePixelRatio/outputScale');
  })();

  // DPI-13. The render transform is built from output.effectiveScale.
  (function () {
    assert.ok(/var transform = output\.effectiveScale !== 1[\s\S]{0,80}\[output\.effectiveScale, 0, 0, output\.effectiveScale, 0, 0\]/.test(READER_JS),
      'DPI-13: render transform matrix uses output.effectiveScale');
    assert.ok(/page\.render\(\{\s*canvasContext:\s*ctx,\s*viewport:\s*viewport,\s*transform:\s*transform\s*\}\)/.test(READER_JS),
      'DPI-13: page.render() is called with the computed transform');
  })();

  // DPI-14. Still only ever renders the current page onto the single
  // reused canvas (reaffirms embedded-reader test 14 under the new code path).
  (function () {
    var canvasTags = READER_HTML.match(/<canvas\b/g) || [];
    assert.strictEqual(canvasTags.length, 1, 'DPI-14: still exactly one <canvas> element (no per-page canvases)');
    assert.strictEqual(/for\s*\(\s*var\s+\w+\s*=\s*1;[^)]*numPages/.test(READER_JS), false, 'DPI-14: still no loop rendering every page at once');
  })();

  // DPI-15. The prior in-flight renderTask is always cancelled before a
  // new one starts — avoids "Cannot use the same canvas during multiple
  // render() operations".
  (function () {
    assert.ok(/if \(renderTask\) \{ renderTask\.cancel\(\); \}/.test(READER_JS),
      'DPI-15: an in-flight renderTask is cancelled before the next page.render() call');
    var renderCurrentPageBlock = extractBalancedBlock(READER_JS, READER_JS.indexOf('function renderCurrentPage'));
    var cancelIdx = renderCurrentPageBlock.indexOf('renderTask.cancel()');
    var newRenderIdx = renderCurrentPageBlock.indexOf('renderTask = page.render(');
    assert.ok(cancelIdx !== -1 && newRenderIdx !== -1 && cancelIdx < newRenderIdx,
      'DPI-15: cancellation happens before the new renderTask is assigned');
  })();

  // DPI-16. Fit Width's visual scale computation is unchanged — it derives
  // only from container/page width, never from devicePixelRatio.
  (function () {
    var fitWidthBlock = extractBalancedBlock(READER_JS, READER_JS.indexOf('function fitWidth'));
    assert.strictEqual(/devicePixelRatio|outputScale|effectiveScale/.test(fitWidthBlock), false,
      'DPI-16: fitWidth()\'s scale computation does not reference DPR/outputScale (visual width unchanged)');
    assert.ok(/containerWidth \/ base\.width/.test(fitWidthBlock), 'DPI-16: fitWidth() still computes scale from containerWidth/base.width only');
  })();

  // DPI-17. Both frozen PDF path mappings are unchanged by this revision.
  (function () {
    assert.ok(READER_JS.indexOf("'zh-CN': '" + CN_PDF_PATH_FROM_READER + "'") !== -1, 'DPI-17: zh-CN PDF path unchanged');
    assert.ok(READER_JS.indexOf("'en-CA': '" + EN_PDF_PATH_FROM_READER + "'") !== -1, 'DPI-17: en-CA PDF path unchanged');
  })();

  // DPI-18. Vendored PDF.js is still pinned at 6.2.108 (untouched by this revision).
  (function () {
    var pdfLib = readSrc('ebook/vendor/pdfjs/pdf.min.mjs');
    assert.ok(/6\.2\.108/.test(pdfLib), 'DPI-18: vendored PDF.js is still version 6.2.108');
  })();

  // DPI-19/20. Frozen PDF byte hashes are unchanged.
  (function () {
    assert.strictEqual(sha256('ebook/' + RELEASE_MANIFEST.editions['zh-CN'].file), CN_SHA256, 'DPI-19: Chinese PDF SHA-256 unchanged');
    assert.strictEqual(sha256('ebook/' + RELEASE_MANIFEST.editions['en-CA'].file), EN_SHA256, 'DPI-20: English PDF SHA-256 unchanged');
  })();

  console.log('ebook-embedded-reader.test.js: all assertions passed');
}

run();
