/* ebook/reader/reader.js — PB-EBOOK-RC1.1 Embedded Web Reader.
 *
 * The `edition` query parameter is looked up in EDITION_PDF below — a
 * frozen, hardcoded map of exactly two keys. No URL, path, or other user
 * input is ever passed to PDF.js; only one of these two fixed literal
 * strings can ever reach pdfjsLib.getDocument().
 *
 * Renders one page at a time onto a single reused <canvas> (any in-flight
 * render task is cancelled before starting the next one) so paging through
 * a 144-page document never holds more than one rendered page in memory.
 */
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '../vendor/pdfjs/pdf.worker.min.mjs';

var EDITION_PDF = Object.freeze({
  'zh-CN': '../releases/PB-EBOOK-RC1/PB_EBOOK_S4R2-R3_CN_Landscape_Release_Candidate_PB-APP-RC1.1_v1.0.pdf',
  'en-CA': '../releases/PB-EBOOK-RC1/PB_EBOOK_S4R2-R3_EN-CA_Landscape_Release_Candidate_PB-APP-RC1.1_v1.0.pdf'
});

var APP_URL = 'https://kevinmabc.github.io/pickleball-4.0/';

var LABELS = {
  'zh-CN': {
    htmlLang: 'zh-CN',
    title: '中文版 · 站内阅读器',
    loading: '正在加载 PDF…',
    errorLoad: '加载失败，请重试或直接下载 PDF。',
    retry: '重试',
    prev: '上一页 / Previous',
    next: '下一页 / Next',
    zoomIn: '放大 / Zoom In',
    zoomOut: '缩小 / Zoom Out',
    fitWidth: '适合宽度 / Fit Width',
    download: '下载 PDF / Download PDF',
    back: '返回电子书主页 / Back to E-Book Home',
    openApp: '打开官方 APP / Open Official App',
    pageOf: function (n, total) { return '第 ' + n + ' 页 / 共 ' + total + ' 页'; },
    invalidTitle: '无效版本 / Invalid Edition',
    invalidMsg: '未指定有效的电子书版本。 / No valid e-book edition was specified.'
  },
  'en-CA': {
    htmlLang: 'en-CA',
    title: 'English Edition — Embedded Reader',
    loading: 'Loading PDF…',
    errorLoad: 'Failed to load. Please retry or download the PDF directly.',
    retry: 'Retry',
    prev: 'Previous',
    next: 'Next',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    fitWidth: 'Fit Width',
    download: 'Download PDF',
    back: 'Back to E-Book Home',
    openApp: 'Open Official App',
    pageOf: function (n, total) { return 'Page ' + n + ' of ' + total; },
    invalidTitle: 'Invalid Edition',
    invalidMsg: 'No valid e-book edition was specified.'
  }
};

var MIN_SCALE = 0.4;
var MAX_SCALE = 3.0;
var SCALE_STEP = 0.2;

// PB-EBOOK-RC1.1-R1 — High-DPI Canvas Rendering Correction.
// Decouples the Canvas's CSS display size (still driven only by the
// existing zoom/Fit Width `scale`, unchanged) from its *internal* pixel
// buffer, which is boosted by devicePixelRatio (capped) so text stays
// crisp on Retina/high-DPI/Windows-125-150% displays — while enforcing
// hard dimension/pixel-budget ceilings so no single page can allocate an
// unbounded canvas. Pure function (no DOM/PDF.js dependency) so its
// boundary conditions can be unit-tested directly.
var MIN_OUTPUT_SCALE = 1;
var MAX_OUTPUT_SCALE = 2;
var MAX_CANVAS_DIMENSION = 4096;
var MAX_CANVAS_PIXELS = 12000000;

function computeOutputScale(viewportWidth, viewportHeight, devicePixelRatio) {
  var raw = Number(devicePixelRatio);
  if (!isFinite(raw) || raw <= 0) { raw = 1; }
  var requestedScale = Math.min(Math.max(raw, MIN_OUTPUT_SCALE), MAX_OUTPUT_SCALE);

  var vw = Number(viewportWidth);
  if (!isFinite(vw) || vw <= 0) { vw = 0; }
  var vh = Number(viewportHeight);
  if (!isFinite(vh) || vh <= 0) { vh = 0; }

  var effectiveScale = requestedScale;
  if (vw > 0 && vh > 0) {
    // Never crop — only ever scale the whole page down uniformly to fit
    // both the per-edge pixel cap and the total-pixel-budget cap.
    var dimFactor = Math.min(1, MAX_CANVAS_DIMENSION / (vw * requestedScale), MAX_CANVAS_DIMENSION / (vh * requestedScale));
    var pxFactor = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (vw * requestedScale * vh * requestedScale)));
    var limitFactor = Math.min(dimFactor, pxFactor);
    effectiveScale = requestedScale * limitFactor;
  }

  return {
    requestedScale: requestedScale,
    effectiveScale: effectiveScale,
    physicalWidth: Math.floor(vw * effectiveScale),
    physicalHeight: Math.floor(vh * effectiveScale)
  };
}

function getRequestedEdition() {
  var params = new URLSearchParams(window.location.search);
  var raw = params.get('edition');
  return Object.prototype.hasOwnProperty.call(EDITION_PDF, raw) ? raw : null;
}

function el(id) { return document.getElementById(id); }

function showInvalid(labels) {
  el('rd-toolbar').hidden = true;
  el('rd-viewer').hidden = true;
  el('rd-loading').hidden = true;
  el('rd-error').hidden = true;
  var box = el('rd-invalid');
  box.hidden = false;
  el('rd-invalid-title').textContent = labels.invalidTitle;
  el('rd-invalid-msg').textContent = labels.invalidMsg;
}

function applyLabels(labels) {
  document.documentElement.lang = labels.htmlLang;
  document.title = labels.title;
  el('rd-brand-title').textContent = labels.title;
  el('rd-prev').textContent = labels.prev;
  el('rd-next').textContent = labels.next;
  el('rd-zoom-in').textContent = labels.zoomIn;
  el('rd-zoom-out').textContent = labels.zoomOut;
  el('rd-fit-width').textContent = labels.fitWidth;
  el('rd-back').textContent = labels.back;
  el('rd-open-app').textContent = labels.openApp;
  el('rd-loading').textContent = labels.loading;
  el('rd-error-msg').textContent = labels.errorLoad;
  el('rd-retry').textContent = labels.retry;
  el('rd-invalid-back').textContent = labels.back;
}

function init() {
  var edition = getRequestedEdition();
  var labels = LABELS[edition || 'en-CA'];

  el('rd-back').setAttribute('href', '../');
  el('rd-invalid-back').setAttribute('href', '../');
  el('rd-open-app').setAttribute('href', APP_URL);

  if (!edition) {
    applyLabels(labels);
    showInvalid(labels);
    return;
  }

  applyLabels(labels);
  el('rd-download').setAttribute('href', EDITION_PDF[edition]);
  el('rd-download').textContent = labels.download;

  var reader = createReader(edition, labels);
  reader.load();
}

function createReader(edition, labels) {
  var pdfUrl = EDITION_PDF[edition]; // fixed literal only — never user input
  var canvas = el('rd-canvas');
  var ctx = canvas.getContext('2d');
  var pdfDoc = null;
  var pageNum = 1;
  var scale = 1.0;
  var renderTask = null;
  var rendering = false;
  var pendingPage = null;

  function setStatus(mode) {
    el('rd-loading').hidden = mode !== 'loading';
    el('rd-error').hidden = mode !== 'error';
    el('rd-viewer').hidden = mode !== 'ready';
    el('rd-toolbar').hidden = mode !== 'ready';
  }

  function updatePageIndicator() {
    el('rd-page-indicator').textContent = labels.pageOf(pageNum, pdfDoc.numPages);
    el('rd-prev').disabled = pageNum <= 1;
    el('rd-next').disabled = pageNum >= pdfDoc.numPages;
  }

  function renderCurrentPage() {
    if (rendering) { pendingPage = pageNum; return; }
    rendering = true;
    pdfDoc.getPage(pageNum).then(function (page) {
      var viewport = page.getViewport({ scale: scale });
      var dpr = window.devicePixelRatio || 1;
      var output = computeOutputScale(viewport.width, viewport.height, dpr);
      // CSS display size stays exactly at the existing zoom/Fit Width
      // viewport size — only the internal pixel buffer grows.
      canvas.style.width = Math.floor(viewport.width) + 'px';
      canvas.style.height = Math.floor(viewport.height) + 'px';
      canvas.width = output.physicalWidth;
      canvas.height = output.physicalHeight;
      var transform = output.effectiveScale !== 1
        ? [output.effectiveScale, 0, 0, output.effectiveScale, 0, 0]
        : null;
      if (renderTask) { renderTask.cancel(); }
      renderTask = page.render({ canvasContext: ctx, viewport: viewport, transform: transform });
      return renderTask.promise;
    }).then(function () {
      rendering = false;
      renderTask = null;
      if (pendingPage !== null) {
        var next = pendingPage;
        pendingPage = null;
        pageNum = next;
        renderCurrentPage();
      }
    }).catch(function (err) {
      rendering = false;
      renderTask = null;
      if (err && err.name === 'RenderingCancelledException') { return; }
      setStatus('error');
    });
    updatePageIndicator();
  }

  function goTo(n) {
    if (!pdfDoc) { return; }
    var clamped = Math.max(1, Math.min(pdfDoc.numPages, n));
    if (clamped === pageNum && canvas.width > 0) { return; }
    pageNum = clamped;
    renderCurrentPage();
  }

  function zoom(delta) {
    scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale + delta));
    renderCurrentPage();
  }

  function fitWidth() {
    if (!pdfDoc) { return; }
    pdfDoc.getPage(pageNum).then(function (page) {
      var base = page.getViewport({ scale: 1 });
      var containerWidth = el('rd-canvas-wrap').clientWidth - 16;
      scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, containerWidth / base.width));
      renderCurrentPage();
    });
  }

  el('rd-prev').addEventListener('click', function () { goTo(pageNum - 1); });
  el('rd-next').addEventListener('click', function () { goTo(pageNum + 1); });
  el('rd-zoom-in').addEventListener('click', function () { zoom(SCALE_STEP); });
  el('rd-zoom-out').addEventListener('click', function () { zoom(-SCALE_STEP); });
  el('rd-fit-width').addEventListener('click', fitWidth);
  el('rd-retry').addEventListener('click', function () { load(); });

  // Basic touch-swipe paging (left/right) on the canvas area.
  var touchStartX = null;
  el('rd-canvas-wrap').addEventListener('touchstart', function (e) {
    if (e.touches.length === 1) { touchStartX = e.touches[0].clientX; }
  }, { passive: true });
  el('rd-canvas-wrap').addEventListener('touchend', function (e) {
    if (touchStartX === null) { return; }
    var dx = (e.changedTouches[0].clientX - touchStartX);
    if (Math.abs(dx) > 60) { goTo(dx < 0 ? pageNum + 1 : pageNum - 1); }
    touchStartX = null;
  }, { passive: true });

  function load() {
    setStatus('loading');
    pdfjsLib.getDocument({ url: pdfUrl }).promise.then(function (doc) {
      pdfDoc = doc;
      pageNum = 1;
      setStatus('ready');
      fitWidth();
    }).catch(function () {
      setStatus('error');
    });
  }

  return { load: load };
}

init();
