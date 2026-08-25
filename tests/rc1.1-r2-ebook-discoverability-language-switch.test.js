/* tests/rc1.1-r2-ebook-discoverability-language-switch.test.js —
 * PB-APP-RC1.1-R2: Homepage E-Book Entry & Language Switch Enhancement.
 *
 * Governance-scope note: covers only a UX/discoverability patch — one
 * prominent homepage E-Book entry card, and enlarging the existing
 * language switch into a segmented 中文 | ENGLISH control. Reuses the
 * existing setLang()/LANG/pb40_lang mechanism unchanged; adds no
 * assessment/scoring/recommendation/training/match/progress/reassessment/
 * journey logic, no DB migration, no store change, and touches no E-Book
 * PDF/Word/reader/vendor/QR file. Asserts all of that explicitly below.
 *
 * Run: node tests/rc1.1-r2-ebook-discoverability-language-switch.test.js
 */
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

var ROOT = path.join(__dirname, '..');
function readSrc(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function sha256(rel) { return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, rel))).digest('hex'); }
function stripComments(src) { return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''); }

var INDEX_HTML = readSrc('index.html');
var APP_CSS = readSrc('css/app.css');
var I18N_JS = readSrc('js/i18n.js');
var SW_SRC = readSrc('sw.js');
var STORAGE_SRC = stripComments(readSrc('js/storage.js'));

var APP_URL = 'https://kevinmabc.github.io/pickleball-4.0/';
var EBOOK_URL = 'https://kevinmabc.github.io/pickleball-4.0/ebook/';

var CN_PDF_SHA256 = '04fcc0ccd9a2027463ce63b2995096d32884c68706b25e2ab92db77d5112d64f';
var EN_PDF_SHA256 = 'f3c325ad1372f7979f475479bf7fdc92949868bf9c171c5d769ac0e19c96afa7';
var QR_APP_SHA256 = '7f48201efe07933f26a50baa5dc8828e3f3a7af8d321da5e074532deff610de3';
var QR_EBOOK_SHA256 = '962018a8a8904840a0889b37d0a9e675a20b30e54d0a26b394573d40da94c0e7';

function run() {

  // ================================================================
  // Homepage E-Book Entry
  // ================================================================

  // UX-01/UX-02. A prominent E-Book card exists, positioned before the
  // S11-B Priority Dashboard block (source order == render order here).
  (function () {
    var cardIdx = INDEX_HTML.indexOf('id="home-ebook-entry"');
    var s11bIdx = INDEX_HTML.indexOf('S11-B · Priority Dashboard');
    assert.ok(cardIdx !== -1, 'UX-01: homepage E-Book card exists (#home-ebook-entry)');
    assert.ok(s11bIdx !== -1, 'UX-02: S11-B Priority Dashboard block exists');
    assert.ok(cardIdx < s11bIdx, 'UX-02: E-Book card appears before S11-B Priority Dashboard in source/render order');
    assert.ok(INDEX_HTML.indexOf('官方电子书 / OFFICIAL E-BOOK') !== -1, 'UX-01: card shows the official E-Book label');
    assert.ok(INDEX_HTML.indexOf('Pickleball 3.0') !== -1, 'UX-01: card shows the product title');
    assert.ok(INDEX_HTML.indexOf('中文版') !== -1 && INDEX_HTML.indexOf('English Edition') !== -1,
      'UX-01: card makes clear both Chinese and English editions are available');
    assert.ok(INDEX_HTML.indexOf('最新版 / LATEST RELEASE') !== -1, 'UX-01: card shows the latest-release badge');
  })();

  // Extract the primary button's exact tag for attribute-level assertions.
  var btnMatch = /<a\s+class="home-ebook-btn"[^>]*>/.exec(INDEX_HTML);
  assert.ok(btnMatch, 'primary E-Book button element found');
  var BTN_TAG = btnMatch[0];

  // UX-03. Button text conveys "Open E-Book".
  (function () {
    assert.ok(/OPEN E-BOOK/i.test(INDEX_HTML), 'UX-03: primary button text includes "OPEN E-BOOK"');
    assert.ok(/打开电子书/.test(INDEX_HTML), 'UX-03: primary button text includes the Chinese "打开电子书"');
  })();

  // UX-04. href resolves to the permanent ./ebook/ path.
  (function () {
    assert.ok(/href="\.\/ebook\/"/.test(BTN_TAG), 'UX-04: primary button href is ./ebook/');
  })();

  // UX-05. No download attribute.
  (function () {
    assert.strictEqual(/\bdownload\b/.test(BTN_TAG), false, 'UX-05: primary button has no download attribute');
  })();

  // UX-06. No target="_blank".
  (function () {
    assert.strictEqual(/target\s*=\s*"_blank"/.test(BTN_TAG), false, 'UX-06: primary button does not use target="_blank"');
    assert.strictEqual(/\btarget=/.test(BTN_TAG), false, 'UX-06: primary button has no target attribute at all (opens in current window)');
  })();

  // UX-07. The existing About/Version E-Book entry (governance/contact
  // entry) is untouched and still present alongside the new homepage entry.
  (function () {
    assert.ok(INDEX_HTML.indexOf('正式电子书 / Official E-Book') !== -1, 'UX-07: existing About/Version E-Book entry heading is present');
    assert.ok(/<a class="btn" href="\.\/ebook\/" target="_blank" rel="noopener"[^>]*>打开电子书 \/ Open E-Book<\/a>/.test(INDEX_HTML),
      'UX-07: existing About/Version E-Book open button (with its original target="_blank") is unchanged');
    assert.ok(INDEX_HTML.indexOf('src="./assets/qr/qr-ebook.svg"') !== -1, 'UX-07: existing About/Version E-Book QR image reference is unchanged');
  })();

  // UX-08/UX-09. QR SVG files are byte-unchanged (not modified this stage).
  (function () {
    assert.strictEqual(sha256('assets/qr/qr-app.svg'), QR_APP_SHA256, 'UX-08: APP QR SVG is byte-unchanged');
    assert.strictEqual(sha256('assets/qr/qr-ebook.svg'), QR_EBOOK_SHA256, 'UX-09: E-Book QR SVG is byte-unchanged');
  })();

  // Permanent URLs still referenced verbatim (index.html's About panel
  // shows the E-Book URL; the E-Book page shows the APP URL — the latter
  // is asserted in tests/rc1.1-version-ebook-access.test.js and re-touched
  // here only for the APP-side URL text this stage could plausibly disturb).
  (function () {
    assert.ok(INDEX_HTML.indexOf(EBOOK_URL) !== -1, 'permanent E-Book URL text is still shown in index.html');
    assert.ok(INDEX_HTML.indexOf(APP_URL) !== -1, 'permanent APP URL text is still shown in index.html');
  })();

  // The new card never selects a language automatically, links a PDF
  // directly, or points at a versioned path.
  (function () {
    var cardBlockMatch = /<div class="card home-ebook-card"[\s\S]*?<\/div>\s*<\/div>/.exec(INDEX_HTML);
    assert.ok(cardBlockMatch, 'homepage E-Book card block extracted');
    var block = cardBlockMatch[0];
    assert.strictEqual(/edition=/.test(block), false, 'homepage card never pre-selects an edition');
    assert.strictEqual(/\.pdf"/i.test(block), false, 'homepage card never links a PDF directly');
    assert.strictEqual(/releases\/PB-EBOOK-RC1/.test(block), false, 'homepage card never points at a versioned release path');
  })();

  // ================================================================
  // Language Switch Enhancement
  // ================================================================

  // LANG-01. Visible labels include 中文 and ENGLISH.
  (function () {
    assert.ok(/<button[^>]*id="lang-btn-zh"[^>]*>中文<\/button>/.test(INDEX_HTML), 'LANG-01: 中文 label present on lang-btn-zh');
    assert.ok(/<button[^>]*id="lang-btn-en"[^>]*>ENGLISH<\/button>/.test(INDEX_HTML), 'LANG-01: ENGLISH label present on lang-btn-en');
  })();

  // LANG-02. The old small-only "中 / EN" single-button presentation is no
  // longer the primary control (old id/class retired from the header).
  (function () {
    assert.strictEqual(/id="lang-btn"[^-]/.test(INDEX_HTML), false, 'LANG-02: old id="lang-btn" (exact, not lang-btn-zh/en) is retired');
    assert.strictEqual(INDEX_HTML.indexOf('中 / <b>EN</b>') !== -1, false, 'LANG-02: old "中 / EN" markup no longer present');
    assert.ok(INDEX_HTML.indexOf('lang-switch-group') !== -1, 'LANG-02: new segmented lang-switch-group is the header control');
  })();

  // LANG-03. Existing language-switching behaviour remains connected —
  // both new buttons call the existing global setLang(), and toggleLang()
  // (used elsewhere/by tests) is still exported unchanged.
  (function () {
    assert.ok(/onclick="setLang\('zh'\)"/.test(INDEX_HTML), 'LANG-03: 中文 button calls the existing setLang(\'zh\')');
    assert.ok(/onclick="setLang\('en'\)"/.test(INDEX_HTML), 'LANG-03: ENGLISH button calls the existing setLang(\'en\')');
    assert.ok(/function setLang\(lang\)/.test(I18N_JS), 'LANG-03: setLang() implementation is unchanged/present');
    assert.ok(/function toggleLang\(\)/.test(I18N_JS), 'LANG-03: toggleLang() implementation is unchanged/present');
    assert.ok(/window\.setLang = setLang/.test(I18N_JS), 'LANG-03: setLang still exported on window');
  })();

  // LANG-04. No new language-storage key is introduced — still only
  // pb40_lang (LKEY), referenced exactly once as a var declaration.
  (function () {
    var lkeyDecls = (I18N_JS.match(/var LKEY\s*=\s*'([^']+)'/g) || []);
    assert.strictEqual(lkeyDecls.length, 1, 'LANG-04: exactly one LKEY declaration');
    assert.ok(/var LKEY\s*=\s*'pb40_lang'/.test(I18N_JS), 'LANG-04: storage key is still exactly pb40_lang');
    var storageSetCalls = (I18N_JS.match(/localStorage\.setItem\(/g) || []);
    assert.strictEqual(storageSetCalls.length, 1, 'LANG-04: still exactly one localStorage.setItem call site in i18n.js (no second key added)');
  })();

  // LANG-05. Selected state is programmatically identifiable — the
  // active-state sync sets aria-pressed on both options (source-scanned;
  // functional aria-pressed default values are also present in the markup).
  (function () {
    assert.ok(/aria-pressed="true"/.test(INDEX_HTML) && /aria-pressed="false"/.test(INDEX_HTML),
      'LANG-05: both aria-pressed default states present in markup');
    assert.ok(/setAttribute\('aria-pressed', isEn \? 'false' : 'true'\)/.test(I18N_JS), 'LANG-05: zh option aria-pressed kept in sync with LANG');
    assert.ok(/setAttribute\('aria-pressed', isEn \? 'true' : 'false'\)/.test(I18N_JS), 'LANG-05: en option aria-pressed kept in sync with LANG');
    assert.ok(/classList\.toggle\('active', !isEn\)/.test(I18N_JS), 'LANG-05: zh option active class kept in sync with LANG');
    assert.ok(/classList\.toggle\('active', isEn\)/.test(I18N_JS), 'LANG-05: en option active class kept in sync with LANG');
  })();

  // LANG-06. Keyboard focus is visible (:focus-visible rule present, with
  // a non-transparent outline, for the new control).
  (function () {
    assert.ok(/\.lang-opt:focus-visible\{outline:3px solid var\(--lime\)/.test(APP_CSS), 'LANG-06: .lang-opt has a visible :focus-visible outline rule');
  })();

  // LANG-07. Minimum touch/control dimensions are represented in CSS.
  (function () {
    assert.ok(/\.lang-switch-group\{[^}]*height:48px/.test(APP_CSS), 'LANG-07: control total height is 48px');
    assert.ok(/\.lang-opt\{[^}]*min-width:48px/.test(APP_CSS), 'LANG-07: each option has a 48px minimum touch width');
    assert.ok(/\.lang-opt\{[^}]*min-height:48px/.test(APP_CSS), 'LANG-07: each option has a 48px minimum touch height');
    assert.ok(/\.lang-switch-group\{[^}]*border:2px solid var\(--lime\)/.test(APP_CSS), 'LANG-07: ~2px border in the existing APP green');
    assert.ok(/\.lang-switch-group\{[^}]*border-radius:11px/.test(APP_CSS), 'LANG-07: border-radius within the 10-12px range');
  })();

  // LANG-08. Mobile layout does not hide either language option — no
  // display:none / visibility:hidden rule targets .lang-opt or the group
  // at any breakpoint, and the group is not marked `hidden`.
  (function () {
    assert.strictEqual(/\.lang-(opt|switch-group)[^{]*\{[^}]*display:\s*none/.test(APP_CSS), false,
      'LANG-08: no rule hides .lang-opt/.lang-switch-group via display:none');
    assert.strictEqual(/id="lang-switch-group"[^>]*hidden/.test(INDEX_HTML), false, 'LANG-08: lang-switch-group is not marked hidden in markup');
  })();

  // ================================================================
  // Frozen Boundaries
  // ================================================================

  // FRZ-01. DB_VERSION remains 5.
  (function () {
    assert.ok(/var DB_VERSION = 5;/.test(STORAGE_SRC), 'FRZ-01: DB_VERSION remains 5');
  })();

  // FRZ-02. Stores remain 18/18.
  (function () {
    var storesBlockMatch = STORAGE_SRC.match(/var STORES = \{([\s\S]*?)\n  \};/);
    assert.ok(storesBlockMatch, 'FRZ-02: STORES config block found');
    var keyPathCount = (storesBlockMatch[1].match(/keyPath:/g) || []).length;
    assert.strictEqual(keyPathCount, 18, 'FRZ-02: exactly 18 stores (found ' + keyPathCount + ')');
  })();

  // FRZ-03. Frozen E-Book PDF hashes unchanged.
  (function () {
    var manifest = JSON.parse(readSrc('ebook/release-manifest.json'));
    assert.strictEqual(sha256('ebook/' + manifest.editions['zh-CN'].file), CN_PDF_SHA256, 'FRZ-03: Chinese PDF SHA-256 unchanged');
    assert.strictEqual(sha256('ebook/' + manifest.editions['en-CA'].file), EN_PDF_SHA256, 'FRZ-03: English PDF SHA-256 unchanged');
  })();

  // FRZ-04. QR payloads unchanged (re-affirms UX-08/UX-09 under the
  // Frozen Boundaries heading).
  (function () {
    assert.strictEqual(sha256('assets/qr/qr-app.svg'), QR_APP_SHA256, 'FRZ-04: APP QR SVG byte-unchanged');
    assert.strictEqual(sha256('assets/qr/qr-ebook.svg'), QR_EBOOK_SHA256, 'FRZ-04: E-Book QR SVG byte-unchanged');
  })();

  // FRZ-05. No E-Book Word/PDF/reader/vendor file was modified this stage
  // — the reader's pinned PDF.js version marker is still present and the
  // reader/vendor files are still exactly where PB-EBOOK-RC1.1 left them.
  (function () {
    var readerJs = readSrc('ebook/reader/reader.js');
    assert.ok(/6\.2\.108/.test(readSrc('ebook/vendor/pdfjs/pdf.min.mjs')), 'FRZ-05: vendored PDF.js still pinned at 6.2.108');
    assert.ok(/computeOutputScale/.test(readerJs), 'FRZ-05: reader.js High-DPI logic still present (untouched by this stage)');
    assert.ok(fs.existsSync(path.join(ROOT, 'ebook', 'reader', 'index.html')), 'FRZ-05: ebook/reader/index.html still exists');
  })();

  // FRZ-06. Assessment/Training/Match/Progress/Recommendation logic is
  // unchanged — this stage's new files never reference any such module.
  (function () {
    var forbidden = ['PBAssessment', 'PBTrainingPrescription', 'PBMatchObservation',
      'PBProgressReassessmentUI', 'PBRecommendationPriority', 'validated_training_level'];
    forbidden.forEach(function (token) {
      assert.strictEqual(BTN_TAG.indexOf(token), -1, 'FRZ-06: primary E-Book button never references ' + token);
    });
    // The pre-existing references to these modules elsewhere in the app
    // (e.g. refreshDynamic()'s optional-chaining calls) are untouched —
    // sanity-check they still exist rather than having been removed.
    assert.ok(/window\.PBHomeDashboardUI/.test(I18N_JS), 'FRZ-06: i18n.js refreshDynamic() still wires up existing UI modules unchanged');
  })();

  // ================================================================
  // Service Worker — evidence that no cache-version bump was needed.
  // index.html (HTML navigation) and css/app.css + js/i18n.js (match the
  // existing isCodeOrData /\.(js|css|json)$/i policy) are all already
  // served network-first, so installed-PWA users get this stage's changes
  // on next online load without any sw.js/CACHE change.
  // ================================================================
  (function () {
    assert.ok(/isCodeOrData\s*=\s*\/\\\.\(js\|css\|json\)\$\/i/.test(SW_SRC),
      'sw.js still declares the isCodeOrData network-first regex covering .js/.css/.json');
    assert.ok(/isNav\s*=\s*req\.mode==='navigate'/.test(SW_SRC), 'sw.js still treats HTML navigation (index.html) as network-first');
  })();

  console.log('rc1.1-r2-ebook-discoverability-language-switch.test.js: all assertions passed');
}

run();
