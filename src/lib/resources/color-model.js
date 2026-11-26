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
  const components = jpegComponents(d);
  return components === 4 ? 'cmyk' : components === 3 ? 'rgb' : null;
}

/**
 * Number of color components of a JPEG file, from its frame header (SOFn).
 * @param {Uint8Array} d JPEG bytes.
 * @returns {number|null} 1 (gray), 3 (RGB/YCbCr), 4 (CMYK/YCCK), or null when not found.
 */
function jpegComponents(d) {
  let pos = 2;
  while (pos + 9 < d.length) {
    if (d[pos] !== 0xff) { pos++; continue; }
    const marker = d[pos + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return d[pos + 9];
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
  const value = tiffPhotometric(d);
  return value === 2 || value === 6 ? 'rgb' : value === 5 ? 'cmyk' : null;
}

/**
 * PhotometricInterpretation (tag 262) of the first directory of a TIFF file.
 * @param {Uint8Array} d TIFF bytes.
 * @returns {number|null} 0/1 gray or black and white, 2 RGB, 3 palette, 5 CMYK, 6 YCbCr, 8 CIELab …
 */
function tiffPhotometric(d) {
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
    return view.getUint16(at + 8, little);
  }
  return null;
}

/**
 * Color space of the pixel values of an image file in an object container, for the color picker:
 * 'rgb' (also YCbCr and palettes: decoded to RGB without color management), 'cmyk', 'lab' or
 * 'gray', or null when unknown.
 * @param {Uint8Array} d File bytes.
 * @param {string} format 'jpeg', 'png', 'gif' or 'tiff'.
 * @returns {'rgb'|'cmyk'|'lab'|'gray'|null} Color space.
 */
export function imagePixelSpace(d, format) {
  if (format === 'gif') return 'rgb';
  if (format === 'png') return d.length <= 25 ? null : [2, 3, 6].includes(d[25]) ? 'rgb' : [0, 4].includes(d[25]) ? 'gray' : null;
  if (format === 'jpeg') return { 1: 'gray', 3: 'rgb', 4: 'cmyk' }[jpegComponents(d)] ?? null;
  if (format === 'tiff') return { 0: 'gray', 1: 'gray', 2: 'rgb', 3: 'rgb', 5: 'cmyk', 6: 'rgb', 8: 'lab' }[tiffPhotometric(d)] ?? null;
  return null;
}

/**
 * Color space of the pixel values of an IOCA image, from its first image part (as the decoder
 * reads it): IDE Structure, else bands, else IDE size. YCbCr and YCrCb count as RGB.
 * @param {{space?: string|null, bands?: number[]|null, ideSize?: number}|undefined} part Image part.
 * @returns {'rgb'|'cmyk'|'lab'|'gray'|'bilevel'|null} Color space.
 */
export function iocaPixelSpace(part) {
  if (!part) return null;
  if (part.space) return { rgb: 'rgb', ycrcb: 'rgb', ycbcr: 'rgb', cmyk: 'cmyk', lab: 'lab', gray: 'gray' }[part.space] ?? null;
  if (part.bands?.length) return part.bands.length === 4 ? 'cmyk' : part.bands.length === 1 ? 'gray' : 'rgb';
  return { 1: 'bilevel', 8: 'gray', 24: 'rgb', 32: 'cmyk' }[part.ideSize] ?? null;
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
