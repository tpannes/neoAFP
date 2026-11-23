/**
 * pdf.js bridge (task T087, research R7): draws PDF documents embedded in AFP object containers.
 *
 * pdf.js (vendored in vendor/pdfjs/, the only third-party code) is loaded only when a page with a
 * PDF is shown. PDFs are opened from bytes only; character maps, standard fonts, WebAssembly
 * decoders and ICC profiles come from the vendored folders, so no request leaves the site
 * (FR-004). JavaScript inside PDFs is not evaluated (`isEvalSupported: false`).
 */

import { registerItemRenderer } from './canvas-renderer.js';

const VENDOR = new URL('../../../vendor/pdfjs/', import.meta.url);

/** @type {Promise<object>|null} The pdf.js module once loaded. */
let pdfjs = null;
/** objectRef → Promise of a PDF document. */
const documents = new Map();
/** "objectRef|page|width" → Promise of a rendered canvas. */
const pages = new Map();

/**
 * Loads pdf.js on first use.
 * @returns {Promise<object>} The pdf.js module.
 */
function loadPdfJs() {
  if (!pdfjs) {
    pdfjs = import(new URL('pdf.mjs', VENDOR).href).then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.mjs', VENDOR).href;
      return mod;
    });
  }
  return pdfjs;
}

/**
 * Opens an embedded PDF once.
 * @param {import('../worker-client.js').WorkerClient} client Worker client.
 * @param {string} objectRef Object container reference.
 * @returns {Promise<object>} pdf.js document.
 */
function openDocument(client, objectRef) {
  if (!documents.has(objectRef)) {
    documents.set(objectRef, (async () => {
      const lib = await loadPdfJs();
      const { bytes } = await client.request({ method: 'getEmbeddedObjectBytes', args: [objectRef], priority: 'high' });
      return lib.getDocument({
        data: bytes,
        isEvalSupported: false,
        enableScripting: false,
        cMapUrl: new URL('cmaps/', VENDOR).href,
        cMapPacked: true,
        standardFontDataUrl: new URL('standard_fonts/', VENDOR).href,
        wasmUrl: new URL('wasm/', VENDOR).href,
        iccUrl: new URL('iccs/', VENDOR).href,
      }).promise;
    })());
  }
  return documents.get(objectRef);
}

/**
 * Renders a PDF page into a canvas of about the given pixel width.
 * @param {import('../worker-client.js').WorkerClient} client Worker client.
 * @param {string} objectRef Object container reference.
 * @param {number} pageNumber Page (1-based).
 * @param {number} pixelWidth Target width in device pixels.
 * @param {boolean} [transparent] Leave the page background transparent (image masks: JBIG2, T311).
 * @returns {Promise<HTMLCanvasElement>} Rendered page.
 */
function renderPage(client, objectRef, pageNumber, pixelWidth, transparent = false) {
  const bucket = Math.max(64, Math.ceil(pixelWidth / 128) * 128); // reuse renders of similar size
  const key = `${objectRef}|${pageNumber}|${bucket}|${transparent}`;
  if (!pages.has(key)) {
    pages.set(key, (async () => {
      const doc = await openDocument(client, objectRef);
      const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: bucket / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport, ...(transparent ? { background: 'rgba(0,0,0,0)' } : {}) }).promise;
      return canvas;
    })());
  }
  return pages.get(key);
}

registerItemRenderer('pdf', async (ctx, item, renderer) => {
  const { x, y, width, height } = item.rect;
  const scale = ctx.getTransform().a; // device pixels per page unit
  let canvas;
  try {
    canvas = await renderPage(renderer.client, item.objectRef, item.pageNumber ?? 1, width * scale, item.transparent);
  } catch {
    ctx.save();
    ctx.strokeStyle = '#b91c1c';
    ctx.lineWidth = 10;
    ctx.strokeRect(x, y, width, height);
    ctx.restore();
    return;
  }
  ctx.save();
  if (item.clip) {
    ctx.beginPath();
    ctx.rect(item.clip.x, item.clip.y, item.clip.width, item.clip.height);
    ctx.clip();
  }
  ctx.translate(x, y);
  if (item.rotation) ctx.rotate((item.rotation * Math.PI) / 180);
  ctx.drawImage(canvas, 0, 0, width, height);
  ctx.restore();
});
