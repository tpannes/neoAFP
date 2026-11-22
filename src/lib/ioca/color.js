/**
 * Color conversion for images (task T066): turns image pixel data in its color space into RGBA
 * for display. Supported: bilevel, grayscale, RGB, YCbCr/YCrCb (ITU-R BT.601, full range), CMYK
 * (simple subtractive conversion, no ICC color management — spec Assumptions) and CIELab (D65).
 */

/**
 * Converts pixel planes or interleaved samples to RGBA.
 * @param {object} input Pixel data.
 * @param {number} input.width Width in pels.
 * @param {number} input.height Height in pels.
 * @param {'gray'|'rgb'|'ycbcr'|'ycrcb'|'cmyk'|'lab'} input.space Color space.
 * @param {Uint8Array[]} input.planes One array per component (planar), or one interleaved array.
 * @param {boolean} input.interleaved True if `planes[0]` holds all components per pel.
 * @returns {Uint8ClampedArray} RGBA pixels.
 */
export function toRgba({ width, height, space, planes, interleaved }) {
  const n = width * height;
  const out = new Uint8ClampedArray(n * 4);
  const comps = { gray: 1, rgb: 3, ycbcr: 3, ycrcb: 3, lab: 3, cmyk: 4 }[space] ?? 3;
  const get = interleaved
    ? (i, c) => planes[0][i * comps + c] ?? 0
    : (i, c) => planes[c]?.[i] ?? 0;
  for (let i = 0; i < n; i++) {
    let r;
    let g;
    let b;
    if (space === 'gray') {
      r = g = b = get(i, 0);
    } else if (space === 'rgb') {
      r = get(i, 0); g = get(i, 1); b = get(i, 2);
    } else if (space === 'ycbcr' || space === 'ycrcb') {
      const y = get(i, 0);
      const cb = (space === 'ycbcr' ? get(i, 1) : get(i, 2)) - 128;
      const cr = (space === 'ycbcr' ? get(i, 2) : get(i, 1)) - 128;
      r = y + 1.402 * cr;
      g = y - 0.344136 * cb - 0.714136 * cr;
      b = y + 1.772 * cb;
    } else if (space === 'cmyk') {
      const k = 255 - get(i, 3);
      r = ((255 - get(i, 0)) * k) / 255;
      g = ((255 - get(i, 1)) * k) / 255;
      b = ((255 - get(i, 2)) * k) / 255;
    } else {
      [r, g, b] = labPixel(get(i, 0) * 100 / 255, get(i, 1) - 128, get(i, 2) - 128);
    }
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * Converts one CIELab (D65) value to RGB.
 * @param {number} l Lightness 0–100.
 * @param {number} a a* value.
 * @param {number} bb b* value.
 * @returns {[number, number, number]} RGB 0–255.
 */
export function labPixel(l, a, bb) {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;
  const f = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const [x, y, z] = [0.95047 * f(fx), f(fy), 1.08883 * f(fz)];
  const lin = [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z];
  return lin.map((c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
}

/**
 * Turns 1-bit rows into RGBA with the given color for 1 bits and transparency for 0 bits.
 * @param {{width: number, height: number, rowBytes: number, bits: Uint8Array}} bm Bitmap.
 * @param {[number, number, number]} [color] Color of 1 bits (default black).
 * @returns {Uint8ClampedArray} RGBA pixels.
 */
export function bilevelToRgba(bm, color = [0, 0, 0]) {
  const out = new Uint8ClampedArray(bm.width * bm.height * 4);
  for (let y = 0; y < bm.height; y++) {
    for (let x = 0; x < bm.width; x++) {
      if ((bm.bits[y * bm.rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) {
        const p = (y * bm.width + x) * 4;
        out[p] = color[0];
        out[p + 1] = color[1];
        out[p + 2] = color[2];
        out[p + 3] = 255;
      }
    }
  }
  return out;
}
