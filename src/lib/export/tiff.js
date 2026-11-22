/**
 * TIFF writer for the page and resource exports (FR-099, FR-056): one RGB image, 8 bits per
 * sample, a single strip compressed with Deflate (TIFF 6.0 with the Adobe Deflate extension,
 * compression 8: a zlib stream), with the resolution in dots per inch. Transparent pixels are
 * put on white, as on paper. Little-endian byte order ("II").
 */

/** TIFF field types. */
const SHORT = 3;
const LONG = 4;
const RATIONAL = 5;

/**
 * Compresses bytes as a zlib stream.
 * @param {Uint8Array} bytes Data.
 * @returns {Promise<Uint8Array>} zlib data.
 */
async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Turns RGBA pixels into RGB on white.
 * @param {Uint8Array|Uint8ClampedArray} rgba Pixels, 4 bytes each.
 * @returns {Uint8Array} Pixels, 3 bytes each.
 */
export function rgbOnWhite(rgba) {
  const n = rgba.length / 4;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3];
    for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round((rgba[i * 4 + c] * a + 255 * (255 - a)) / 255);
  }
  return out;
}

/**
 * Writes a TIFF file.
 * @param {{width: number, height: number, rgba: Uint8Array|Uint8ClampedArray, dpi?: number}} image
 *   Pixels (RGBA, row by row) and resolution (default 96).
 * @returns {Promise<Uint8Array>} TIFF file.
 */
export async function encodeTiff({ width, height, rgba, dpi = 96 }) {
  const strip = await deflate(rgbOnWhite(rgba));
  const tags = [
    [256, LONG, 1, width], [257, LONG, 1, height], [258, SHORT, 3, null], [259, SHORT, 1, 8], [262, SHORT, 1, 2],
    [273, LONG, 1, null], [277, SHORT, 1, 3], [278, LONG, 1, height], [279, LONG, 1, strip.length],
    [282, RATIONAL, 1, null], [283, RATIONAL, 1, null], [284, SHORT, 1, 1], [296, SHORT, 1, 2],
  ];
  const ifdOffset = 8;
  const ifdSize = 2 + tags.length * 12 + 4;
  const extra = ifdOffset + ifdSize; // bits per sample (6 bytes), then two rationals (8 bytes each)
  const bitsAt = extra;
  const xResAt = extra + 6;
  const yResAt = xResAt + 8;
  const stripAt = yResAt + 8;
  const out = new Uint8Array(stripAt + strip.length);
  const view = new DataView(out.buffer);
  out.set([0x49, 0x49]);
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, tags.length, true);
  const values = { 258: bitsAt, 273: stripAt, 282: xResAt, 283: yResAt };
  tags.forEach(([tag, type, count, value], i) => {
    const at = ifdOffset + 2 + i * 12;
    view.setUint16(at, tag, true);
    view.setUint16(at + 2, type, true);
    view.setUint32(at + 4, count, true);
    const v = value ?? values[tag];
    if (type === SHORT && count === 1) view.setUint16(at + 8, v, true);
    else view.setUint32(at + 8, v, true);
  });
  view.setUint32(ifdOffset + 2 + tags.length * 12, 0, true); // no further image
  for (let c = 0; c < 3; c++) view.setUint16(bitsAt + c * 2, 8, true);
  const res = Math.round(dpi * 100);
  for (const at of [xResAt, yResAt]) {
    view.setUint32(at, res, true);
    view.setUint32(at + 4, 100, true);
  }
  out.set(strip, stripAt);
  return out;
}
