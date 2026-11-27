/**
 * One pixel of a decoded image for the color picker: read from the pixel data neoAFP decoded
 * itself (IOCA images, IM images), so it is exact — unlike reading the page canvas, which browsers
 * with fingerprinting protection change slightly — and it gives the value in the image's own color
 * space (e.g. CMYK), not only the RGB drawn.
 *
 * Images the browser decodes (JPEG, also JPEG in IOCA) give null: their values in the file are not
 * available, the picker reads the canvas then.
 */

/**
 * Writes RGB as a hex color.
 * @param {number[]} rgb Red, green, blue 0–255.
 * @returns {string} "#rrggbb".
 */
const hex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Components per pel and the name of the color space as the picker shows it. */
const SPACES = {
  gray: [1, 'Gray'], rgb: [3, 'RGB'], ycbcr: [3, 'YCbCr'], ycrcb: [3, 'YCrCb'], cmyk: [4, 'CMYK'], lab: [3, 'CIELab'],
};

/**
 * Reads one pel of a bilevel bit map (1 bits are drawn in the image color, 0 bits are transparent).
 * @param {{rowBytes: number, bits: Uint8Array}} map Bits.
 * @param {number} x Column.
 * @param {number} y Row.
 * @returns {boolean} True for a 1 bit.
 */
const bit = (map, x, y) => ((map.bits[y * map.rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) === 1;

/**
 * Describes the values of a pel in its color space.
 * @param {{space: string, planes: Uint8Array[], interleaved: boolean}} samples Pixel values.
 * @param {number} i Pel index in the part.
 * @returns {{space: string, value: string}|null} Specification, e.g. {space: 'CMYK', value: '60 40 40 100 %'}.
 */
function sampleSpec(samples, i) {
  const [n, name] = SPACES[samples.space] ?? [];
  if (!n) return null;
  const v = Array.from({ length: n }, (_, c) => (samples.interleaved ? samples.planes[0][i * n + c] : samples.planes[c]?.[i]) ?? 0);
  if (samples.space === 'cmyk') return { space: name, value: `${v.map((x) => Math.round((x * 100) / 255)).join(' ')} %` };
  if (samples.space === 'lab') return { space: name, value: `${Math.round((v[0] * 1000) / 255) / 10} ${v[1] - 128} ${v[2] - 128}` };
  return { space: name, value: v.join(' ') };
}

/**
 * Reads the pel at a point of an image.
 * @param {{width: number, height: number, parts?: object[], bilevel?: object}} image Decoded image:
 *   IOCA (parts placed at x/y with rgba, samples or bilevel) or IM (one bilevel map).
 * @param {number} fx Horizontal position, 0–1 of the image width.
 * @param {number} fy Vertical position, 0–1 of the image height.
 * @returns {{ink: boolean}|{rgb: string, spec: {space: string, value: string}|null}|null} For a
 *   bilevel pel whether it is set (drawn in the image color) or not (transparent, as are pels
 *   outside a transparency mask); for a color pel
 *   its RGB as drawn and its value in the file; null where the pixel data is not neoAFP's own.
 */
export function pixelOf(image, fx, fy) {
  const x = Math.min(image.width - 1, Math.max(0, Math.floor(fx * image.width)));
  const y = Math.min(image.height - 1, Math.max(0, Math.floor(fy * image.height)));
  if (image.bilevel) return { ink: bit(image.bilevel, x, y) };
  const part = (image.parts ?? []).find((p) => x >= (p.x ?? 0) && y >= (p.y ?? 0) && x < (p.x ?? 0) + p.width && y < (p.y ?? 0) + p.height);
  if (!part) return null;
  const px = x - (part.x ?? 0);
  const py = y - (part.y ?? 0);
  // Pels outside the transparency mask are not drawn: the image leaves the paper there.
  if (part.mask && (px >= part.mask.width || py >= part.mask.height || !bit(part.mask, px, py))) return { ink: false };
  if (part.bilevel) return { ink: bit(part.bilevel, px, py) };
  if (!part.rgba) return null;
  const i = py * part.width + px;
  return { rgb: hex([part.rgba[i * 4], part.rgba[i * 4 + 1], part.rgba[i * 4 + 2]]), spec: part.samples ? sampleSpec(part.samples, i) : null };
}
