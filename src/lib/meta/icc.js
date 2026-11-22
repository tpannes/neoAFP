/**
 * ICC profiles (FR-039): header fields and description (ICC.1:2010 = ISO 15076-1, section 7.2
 * "Profile header" and the 'desc' tag; ICC.1:2001-04 for the version 2 textDescriptionType), and
 * the places where image formats carry profiles: JPEG APP2 "ICC_PROFILE" segments (ICC.1:2010
 * annex B.4), PNG iCCP chunks (PNG specification, 11.3.3.3) and the TIFF tag 34675
 * InterColorProfile (TIFF/EP, ICC.1:2010 annex B.5).
 */

import { inflate } from './xmp.js';

/** Rendering intents by header value (ICC.1:2010 table 23). */
const INTENTS = ['perceptual', 'relativeColorimetric', 'saturation', 'absoluteColorimetric'];

/**
 * Reads a big-endian 32-bit unsigned number.
 * @param {Uint8Array} d Bytes.
 * @param {number} at Position.
 * @returns {number} Value.
 */
const u32 = (d, at) => ((d[at] << 24) >>> 0) + (d[at + 1] << 16) + (d[at + 2] << 8) + d[at + 3];
/**
 * Reads a four-character signature.
 * @param {Uint8Array} d Bytes.
 * @param {number} at Position.
 * @returns {string} Signature.
 */
const sig = (d, at) => String.fromCharCode(...d.subarray(at, at + 4));

/**
 * Reads the profile description from a 'desc' (v2) or 'mluc' (v4) tag.
 * @param {Uint8Array} d Profile.
 * @returns {string|null} Description.
 */
function description(d) {
  const count = u32(d, 128);
  for (let i = 0; i < count && 132 + i * 12 + 12 <= d.length; i++) {
    const e = 132 + i * 12;
    if (sig(d, e) !== 'desc') continue;
    const at = u32(d, e + 4);
    const size = u32(d, e + 8);
    if (at + size > d.length || size < 12) return null;
    const type = sig(d, at);
    if (type === 'desc') {
      const n = u32(d, at + 8);
      const ascii = d.subarray(at + 12, Math.min(at + 12 + n, at + size));
      return String.fromCharCode(...ascii).replace(/\0.*$/s, '');
    }
    if (type === 'mluc') {
      const records = u32(d, at + 8);
      const recordSize = u32(d, at + 12);
      let chosen = null;
      for (let r = 0; r < records; r++) {
        const rec = at + 16 + r * recordSize;
        if (rec + 12 > at + size) break;
        const lang = String.fromCharCode(d[rec], d[rec + 1]);
        if (chosen === null || lang === 'en') chosen = rec;
        if (lang === 'en') break;
      }
      if (chosen === null) return null;
      const len = u32(d, chosen + 4);
      const off = at + u32(d, chosen + 8);
      let s = '';
      for (let i = off; i + 1 < off + len && i + 1 < d.length; i += 2) s += String.fromCharCode((d[i] << 8) | d[i + 1]);
      return s;
    }
    return null;
  }
  return null;
}

/**
 * Parses an ICC profile header and description.
 * @param {Uint8Array} d Profile bytes.
 * @returns {{size: number, version: string, deviceClass: string, colorSpace: string, pcs: string,
 *   renderingIntent: string, description: string|null}|null} Profile, or null if the data is not
 *   an ICC profile (no 'acsp' signature).
 */
export function parseIccProfile(d) {
  if (!d || d.length < 132 || sig(d, 36) !== 'acsp') return null;
  return {
    size: u32(d, 0),
    version: `${d[8]}.${d[9] >> 4}.${d[9] & 0x0f}`,
    deviceClass: sig(d, 12).trim(),
    colorSpace: sig(d, 16).trim(),
    pcs: sig(d, 20).trim(),
    renderingIntent: INTENTS[u32(d, 64) & 0xffff] ?? `X'${(u32(d, 64) & 0xffff).toString(16).toUpperCase()}'`,
    description: description(d),
  };
}

/**
 * Extracts an ICC profile embedded in JPEG, PNG or TIFF data.
 * @param {Uint8Array} d Image bytes.
 * @param {string} format 'jpeg', 'png' or 'tiff'.
 * @returns {Promise<Uint8Array|null>} Profile bytes, or null if there is none.
 */
export async function embeddedProfile(d, format) {
  if (format === 'jpeg') return jpegProfile(d);
  if (format === 'png') return pngProfile(d);
  if (format === 'tiff') return tiffTag(d, 34675);
  return null;
}

/**
 * Joins the APP2 "ICC_PROFILE" chunks of a JPEG in sequence order.
 * @param {Uint8Array} d JPEG.
 * @returns {Uint8Array|null} Profile.
 */
function jpegProfile(d) {
  const chunks = [];
  for (const seg of jpegSegments(d)) {
    if (seg.marker === 0xe2 && String.fromCharCode(...seg.data.subarray(0, 12)) === 'ICC_PROFILE\0') {
      chunks.push({ seq: seg.data[12], bytes: seg.data.subarray(14) });
    }
  }
  if (!chunks.length) return null;
  chunks.sort((a, b) => a.seq - b.seq);
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.bytes.length, 0));
  let pos = 0;
  for (const c of chunks) { out.set(c.bytes, pos); pos += c.bytes.length; }
  return out;
}

/**
 * Lists the marker segments of a JPEG before the image data.
 * @param {Uint8Array} d JPEG.
 * @returns {{marker: number, data: Uint8Array}[]} Segments (data without the length).
 */
export function jpegSegments(d) {
  const out = [];
  if (d[0] !== 0xff || d[1] !== 0xd8) return out;
  let pos = 2;
  while (pos + 4 <= d.length && d[pos] === 0xff) {
    const marker = d[pos + 1];
    if (marker === 0xda || marker === 0xd9) break; // start of scan, end of image
    const len = (d[pos + 2] << 8) | d[pos + 3];
    out.push({ marker, data: d.subarray(pos + 4, pos + 2 + len) });
    pos += 2 + len;
  }
  return out;
}

/**
 * Lists the chunks of a PNG.
 * @param {Uint8Array} d PNG.
 * @returns {{type: string, data: Uint8Array}[]} Chunks.
 */
export function pngChunks(d) {
  const out = [];
  let pos = 8;
  while (pos + 12 <= d.length) {
    const len = u32(d, pos);
    const type = sig(d, pos + 4);
    out.push({ type, data: d.subarray(pos + 8, pos + 8 + len) });
    if (type === 'IEND') break;
    pos += 12 + len;
  }
  return out;
}

/**
 * Inflates the profile of a PNG iCCP chunk (profile name, NUL, compression method 0, zlib data).
 * @param {Uint8Array} d PNG.
 * @returns {Promise<Uint8Array|null>} Profile.
 */
async function pngProfile(d) {
  const chunk = pngChunks(d).find((c) => c.type === 'iCCP');
  if (!chunk) return null;
  const nul = chunk.data.indexOf(0);
  if (nul < 0 || chunk.data[nul + 1] !== 0) return null;
  try {
    return await inflate(chunk.data.subarray(nul + 2), 'deflate');
  } catch {
    return null;
  }
}

/**
 * Reads the bytes of a tag in the first image file directory of a TIFF (UNDEFINED or BYTE data).
 * @param {Uint8Array} d TIFF.
 * @param {number} tag Tag number.
 * @returns {Uint8Array|null} Tag data.
 */
export function tiffTag(d, tag) {
  const le = d[0] === 0x49;
  const u16 = (at) => (le ? d[at] | (d[at + 1] << 8) : (d[at] << 8) | d[at + 1]);
  const u32t = (at) => (le ? (d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | (d[at + 3] << 24)) >>> 0 : u32(d, at));
  const ifd = u32t(4);
  if (ifd + 2 > d.length) return null;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > d.length) break;
    if (u16(e) !== tag) continue;
    const count = u32t(e + 4);
    const at = count <= 4 ? e + 8 : u32t(e + 8);
    return at + count <= d.length ? d.subarray(at, at + count) : null;
  }
  return null;
}
