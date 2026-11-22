/**
 * Color model of a resource for the Resource-Explorer's color filter (FR-053): 'rgb' or 'cmyk',
 * or null when the data is black and white, grayscale, CIELAB or unknown. Read from headers
 * only, so it is cheap enough for every resource:
 * - IOCA images (IOCA Reference: IDE Structure X'9B' names the color space — RGB, YCrCb and
 *   YCbCr count as RGB; without it IDE Size 32 means CMYK and 24 RGB; Band Image X'98' with 4
 *   bands CMYK, 3 bands RGB);
 * - JPEG (number of components in the frame header: 3 RGB/YCbCr, 4 CMYK/YCCK), PNG (color
 *   types 2, 3 and 6), GIF (always a color palette), TIFF (PhotometricInterpretation 2 RGB,
 *   5 CMYK, 6 YCbCr);
 * - ICC profiles by the data color space in the profile header ('RGB ', 'CMYK').
 */

import { selfDefiningFields } from '../ioca/ioca.js';

/** IDE Structure color space codes (IOCA Reference) → color model. */
const IDE_FORMATS = { 0x01: 'rgb', 0x02: 'rgb', 0x04: 'cmyk', 0x12: 'rgb' };

/**
 * Color model of an IOCA image from its image segment (the first Image Picture Data field is
 * enough: the image content parameters come before the data).
 * @param {Uint8Array} segment Image segment bytes.
 * @returns {'rgb'|'cmyk'|null} Color model.
 */
export function iocaColorModel(segment) {
  let ideSize = null;
  let bands = null;
  for (const { code, body } of selfDefiningFields(segment)) {
    if (code === 0x9b) return IDE_FORMATS[body[1]] ?? null;
    if (code === 0x96) ideSize = body[0];
    if (code === 0x98) bands = body[0];
    if (code === 0xfe92 || code === 0xfe9c) break;
  }
  if (bands === 4 || ideSize === 32) return 'cmyk';
  if (bands === 3 || ideSize === 24) return 'rgb';
  return null;
}

/**
 * Color model of an image file in an object container.
 * @param {Uint8Array} d File bytes.
 * @param {string} format 'jpeg', 'png', 'gif' or 'tiff' (others give null).
 * @returns {'rgb'|'cmyk'|null} Color model.
 */
export function imageColorModel(d, format) {
  if (format === 'gif') return 'rgb';
  if (format === 'png') return d.length > 25 && [2, 3, 6].includes(d[25]) ? 'rgb' : null;
  if (format === 'jpeg') return jpegColorModel(d);
  if (format === 'tiff') return tiffColorModel(d);
  return null;
}

/**
 * Color model of a JPEG file from the component count of its frame header (SOFn).
 * @param {Uint8Array} d JPEG bytes.
 * @returns {'rgb'|'cmyk'|null} Color model.
 */
function jpegColorModel(d) {
  let pos = 2;
  while (pos + 9 < d.length) {
    if (d[pos] !== 0xff) { pos++; continue; }
    const marker = d[pos + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      const components = d[pos + 9];
      return components === 4 ? 'cmyk' : components === 3 ? 'rgb' : null;
    }
    pos += 2 + ((d[pos + 2] << 8) | d[pos + 3]);
  }
  return null;
}

/**
 * Color model of a TIFF file from PhotometricInterpretation (tag 262) in its first directory.
 * @param {Uint8Array} d TIFF bytes.
 * @returns {'rgb'|'cmyk'|null} Color model.
 */
function tiffColorModel(d) {
  if (d.length < 8) return null;
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const little = d[0] === 0x49;
  const ifd = view.getUint32(4, little);
  if (ifd + 2 > d.length) return null;
  const count = view.getUint16(ifd, little);
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12;
    if (at + 12 > d.length) break;
    if (view.getUint16(at, little) !== 262) continue;
    const value = view.getUint16(at + 8, little);
    return value === 2 || value === 6 ? 'rgb' : value === 5 ? 'cmyk' : null;
  }
  return null;
}

/**
 * Color model an ICC profile is made for.
 * @param {string|null|undefined} colorSpace Data color space from the profile header ('RGB', 'CMYK' …).
 * @returns {'rgb'|'cmyk'|null} Color model.
 */
export function iccColorModel(colorSpace) {
  const s = (colorSpace ?? '').trim().toUpperCase();
  return s === 'RGB' ? 'rgb' : s === 'CMYK' ? 'cmyk' : null;
}
