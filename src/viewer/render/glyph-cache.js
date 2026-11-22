/**
 * Glyph cache for raster AFP fonts: asks the parser worker once per font and glyph for the 1-bit
 * bitmap and keeps a colored, ready-to-draw image per (font, glyph, color).
 */

/**
 * Caches raster glyph images.
 */
export class GlyphCache {
  /**
   * Creates an empty cache.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   */
  constructor(client) {
    this.client = client;
    /** @type {Map<string, Map<string, object>>} font ref → glyph id → bitmap data */
    this.bitmaps = new Map();
    /** @type {Map<string, number>} font ref → resolution (dpi) */
    this.resolution = new Map();
    /** @type {Map<string, CanvasImageSource>} "ref|id|color" → image */
    this.images = new Map();
    /** @type {Map<string, number>} font ref → units per em (outline fonts) */
    this.unitsPerEm = new Map();
    /** @type {Map<string, Path2D>} "ref|id" → outline */
    this.paths = new Map();
  }

  /**
   * Makes sure the bitmaps of the given glyphs are loaded.
   * @param {string} ref Font reference.
   * @param {string[]} ids Glyph ids.
   * @returns {Promise<void>} Resolves when loaded.
   */
  async load(ref, ids) {
    if (!this.bitmaps.has(ref)) this.bitmaps.set(ref, new Map());
    const known = this.bitmaps.get(ref);
    const missing = [...new Set(ids)].filter((id) => !known.has(id));
    if (missing.length === 0) return;
    const { resolution, unitsPerEm, glyphs } = await this.client.request({ method: 'getGlyphs', args: [ref, missing], priority: 'high' });
    this.resolution.set(ref, resolution);
    if (unitsPerEm) this.unitsPerEm.set(ref, unitsPerEm);
    for (const id of missing) known.set(id, null);
    for (const g of glyphs) known.set(g.id, g);
  }

  /**
   * Returns placement data and a colored image of a glyph.
   * @param {string} ref Font reference.
   * @param {string} id Glyph id.
   * @param {string} color CSS color "#rrggbb".
   * @returns {{image: CanvasImageSource, data: object, scale: number}|null} Image, bitmap data
   *   and page units per font unit; null if the glyph has no bitmap.
   */
  get(ref, id, color) {
    const data = this.bitmaps.get(ref)?.get(id);
    if (!data) return null;
    const key = `${ref}|${id}|${color}`;
    let image = this.images.get(key);
    if (!image) {
      image = toImage(data, color);
      this.images.set(key, image);
    }
    return { image, data, scale: 1440 / (this.resolution.get(ref) || 240) };
  }
}

/**
 * Returns the outline of a glyph of a Type 1 / CID-keyed font as a Path2D in font units (y up).
 * @param {GlyphCache} cache Cache.
 * @param {string} ref Font reference.
 * @param {string|number} id Glyph id.
 * @returns {{path: Path2D, unitsPerEm: number}|null} Outline, or null.
 */
export function outlineOf(cache, ref, id) {
  const key = `${ref}|${id}`;
  if (!cache.paths.has(key)) {
    const data = cache.bitmaps.get(ref)?.get(id);
    if (!data?.path) return null;
    const p = new Path2D();
    for (const c of data.path) {
      if (c[0] === 'M') p.moveTo(c[1], c[2]);
      else if (c[0] === 'L') p.lineTo(c[1], c[2]);
      else if (c[0] === 'C') p.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
      else p.closePath();
    }
    cache.paths.set(key, p);
  }
  return { path: cache.paths.get(key), unitsPerEm: cache.unitsPerEm.get(ref) ?? 1000 };
}

/**
 * Turns a 1-bit bitmap into a colored canvas with transparent background.
 * @param {{width: number, height: number, rowBytes: number, bits: Uint8Array}} g Bitmap.
 * @param {string} color CSS color "#rrggbb".
 * @returns {OffscreenCanvas|HTMLCanvasElement} Image.
 */
function toImage(g, color) {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(g.width, g.height) : Object.assign(document.createElement('canvas'), { width: g.width, height: g.height });
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(g.width, g.height);
  const r = parseInt(color.slice(1, 3), 16);
  const gr = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  for (let y = 0; y < g.height; y++) {
    for (let x = 0; x < g.width; x++) {
      if ((g.bits[y * g.rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) {
        const p = (y * g.width + x) * 4;
        img.data[p] = r;
        img.data[p + 1] = gr;
        img.data[p + 2] = b;
        img.data[p + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
