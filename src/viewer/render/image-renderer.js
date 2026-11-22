/**
 * Draws image items (IM images, IOCA images, embedded JPEG/PNG/GIF/TIFF): asks the parser worker
 * once per image for its pixels — 1-bit rows (bilevel), RGBA, or JPEG/PNG/GIF bytes that the
 * browser decodes with createImageBitmap (FR-013) — and caches the result as a drawable image.
 */

import { registerItemRenderer } from './canvas-renderer.js';
import { toRgba } from '../../lib/ioca/color.js';

/** imageRef → Promise of a drawable image (or null if it cannot be shown). */
const cache = new Map();

/**
 * Creates a canvas of a given size (OffscreenCanvas where available).
 * @param {number} width Width.
 * @param {number} height Height.
 * @returns {OffscreenCanvas|HTMLCanvasElement} Canvas.
 */
function makeCanvas(width, height) {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
}

/**
 * Turns pixel data from the worker into a drawable image.
 * @param {object} px Pixels from getImagePixels.
 * @returns {Promise<CanvasImageSource|null>} Image.
 */
async function toDrawable(px) {
  if (px.tiles) return composeTiles(px);
  if (px.encodedBytes || px.jpegBytes) {
    const bytes = px.encodedBytes ?? px.jpegBytes;
    return createImageBitmap(new Blob([bytes], { type: px.mimeType ?? 'image/jpeg' }));
  }
  if (!px.width || !px.height) return null;
  const canvas = makeCanvas(px.width, px.height);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(px.width, px.height);
  if (px.rgba) {
    img.data.set(px.rgba);
  } else if (px.bilevel) {
    const { bits, rowBytes } = px.bilevel;
    const [r, g, b] = px.color ?? [0, 0, 0];
    for (let y = 0; y < px.height; y++) {
      for (let x = 0; x < px.width; x++) {
        if ((bits[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) {
          const p = (y * px.width + x) * 4;
          img.data[p] = r;
          img.data[p + 1] = g;
          img.data[p + 2] = b;
          img.data[p + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Draws a 1-bit bitmap into RGBA image data (1 = color, 0 = transparent).
 * @param {ImageData} img Target.
 * @param {{rowBytes: number, bits: Uint8Array}} bm Bitmap.
 * @param {number} width Width.
 * @param {number} height Height.
 * @param {[number, number, number]} color Color of 1 bits.
 * @returns {void}
 */
function paintBits(img, bm, width, height, color) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((bm.bits[y * bm.rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) {
        const p = (y * width + x) * 4;
        img.data[p] = color[0];
        img.data[p + 1] = color[1];
        img.data[p + 2] = color[2];
        img.data[p + 3] = 255;
      }
    }
  }
}

/**
 * Decodes one encoded image per color band (e.g. CMYK as four grayscale JPEGs) and combines them.
 * @param {{width: number, height: number, encodedPlanes: Uint8Array[], space: string,
 *   mimeType?: string}} t Tile.
 * @returns {Promise<Uint8ClampedArray>} RGBA pixels.
 */
async function combinePlanes(t) {
  const planes = [];
  for (const bytes of t.encodedPlanes) {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: t.mimeType ?? 'image/jpeg' }));
    const canvas = makeCanvas(t.width, t.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, t.width, t.height);
    const rgba = ctx.getImageData(0, 0, t.width, t.height).data;
    const plane = new Uint8Array(t.width * t.height);
    for (let i = 0; i < plane.length; i++) plane[i] = rgba[i * 4];
    planes.push(plane);
  }
  return toRgba({ width: t.width, height: t.height, space: t.space, planes, interleaved: false });
}

/**
 * Builds one image from IOCA tiles (RGBA, bilevel, JPEG or one JPEG per color band), applying
 * transparency masks.
 * @param {{width: number, height: number, tiles: object[]}} px Image from getImagePixels.
 * @returns {Promise<CanvasImageSource|null>} Composed image.
 */
async function composeTiles(px) {
  if (!px.width || !px.height) return null;
  const canvas = makeCanvas(px.width, px.height);
  const ctx = canvas.getContext('2d');
  for (const t of px.tiles) {
    if (!t.width || !t.height) continue;
    const tile = makeCanvas(t.width, t.height);
    const tctx = tile.getContext('2d');
    if (t.encodedPlanes) {
      try {
        const img = tctx.createImageData(t.width, t.height);
        img.data.set(await combinePlanes(t));
        tctx.putImageData(img, 0, 0);
      } catch {
        continue;
      }
    } else if (t.encodedBytes) {
      try {
        tctx.drawImage(await createImageBitmap(new Blob([t.encodedBytes], { type: t.mimeType ?? 'image/jpeg' })), 0, 0, t.width, t.height);
      } catch {
        continue;
      }
    } else {
      const img = tctx.createImageData(t.width, t.height);
      if (t.rgba) img.data.set(t.rgba.subarray(0, img.data.length));
      else if (t.bilevel) paintBits(img, t.bilevel, t.width, t.height, [0, 0, 0]);
      tctx.putImageData(img, 0, 0);
    }
    if (t.mask) {
      const img = tctx.getImageData(0, 0, t.width, t.height);
      for (let y = 0; y < t.height; y++) {
        for (let x = 0; x < t.width; x++) {
          const on = y < t.mask.height && x < t.mask.width && (t.mask.bits[y * t.mask.rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
          if (!on) img.data[(y * t.width + x) * 4 + 3] = 0;
        }
      }
      tctx.putImageData(img, 0, 0);
    }
    ctx.drawImage(tile, t.x, t.y);
  }
  return canvas;
}

/** Images whose pixels come inside the render model (e.g. GOCA images), cached per item. */
const inlineCache = new WeakMap();

registerItemRenderer('image', async (ctx, item, renderer) => {
  if (item.inline) {
    if (!inlineCache.has(item.inline)) {
      const color = item.inline.color ?? '#000000';
      const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
      inlineCache.set(item.inline, toDrawable({ ...item.inline, color: rgb }));
    }
    const image = await inlineCache.get(item.inline);
    if (image) {
      ctx.save();
      // Turned with a rotated overlay or page (render/transform.js): about the rectangle origin.
      ctx.translate(item.rect.x, item.rect.y);
      if (item.rotation) ctx.rotate((item.rotation * Math.PI) / 180);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high'; // downscaled 1-bit scans stay sharp instead of grainy
      ctx.drawImage(image, 0, 0, item.rect.width, item.rect.height);
      ctx.restore();
    }
    return;
  }
  if (!cache.has(item.imageRef)) {
    cache.set(item.imageRef, renderer.client.request({ method: 'getImagePixels', args: [item.imageRef], priority: 'high' })
      .then(toDrawable).catch(() => null));
  }
  const image = await cache.get(item.imageRef);
  if (!image) return;
  const { x, y, width, height } = item.rect;
  ctx.save();
  if (item.clip) {
    ctx.beginPath();
    ctx.rect(item.clip.x, item.clip.y, item.clip.width, item.clip.height);
    ctx.clip();
  }
  ctx.translate(x, y);
  if (item.rotation) ctx.rotate((item.rotation * Math.PI) / 180);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high'; // downscaled 1-bit scans stay sharp instead of grainy
  ctx.drawImage(image, 0, 0, width, height);
  ctx.restore();
});

/**
 * Forgets cached images (after files were closed or resources added).
 * @returns {void}
 */
export function clearImageCache() {
  cache.clear();
}
