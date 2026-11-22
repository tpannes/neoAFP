/**
 * Baseline TIFF reader (task T078) for TIFF images in object containers: strips, no compression,
 * PackBits, LZW (with horizontal predictor), CCITT Group 3/4; bilevel, grayscale, RGB and CMYK
 * (TIFF 6.0 Specification, sections 2–8, 9, 10, 11, 13, 14, 16). Reuses the IOCA decoders.
 *
 * The color space comes from PhotometricInterpretation (0/1 grayscale, 2 RGB, 3 palette with
 * its ColorMap, 5 separated = CMYK), not from the number of samples: a fourth sample is black (K) in CMYK but alpha in
 * RGB, and samples beyond the color space's own (ExtraSamples, e.g. alpha) are dropped. CMYK is
 * converted without color management (the embedded ICC profile is not applied).
 */

import { decodeCcitt } from '../ioca/decoders/ccitt.js';
import { decodeLzw } from '../ioca/decoders/lzw.js';
import { decodePackBits } from '../ioca/decoders/packbits.js';
import { toRgba } from '../ioca/color.js';

/**
 * Reads the first image of a TIFF file.
 * @param {Uint8Array} d TIFF bytes.
 * @returns {{width: number, height: number, xRes: number, yRes: number, bilevel?: object,
 *   rgba?: Uint8ClampedArray, error: string|null}} Pixels and resolution (dpi).
 */
export function readTiff(d) {
  const le = d[0] === 0x49;
  const n16 = (at) => (le ? d[at] | (d[at + 1] << 8) : (d[at] << 8) | d[at + 1]);
  const n32 = (at) => (le ? (d[at] | (d[at + 1] << 8) | (d[at + 2] << 16) | (d[at + 3] << 24)) >>> 0
    : ((d[at] << 24) | (d[at + 1] << 16) | (d[at + 2] << 8) | d[at + 3]) >>> 0);
  const fail = (error) => ({ width: 0, height: 0, xRes: 72, yRes: 72, error });
  if (!((d[0] === 0x49 && d[1] === 0x49) || (d[0] === 0x4d && d[1] === 0x4d)) || n16(2) !== 42) return fail('not a TIFF file');
  const ifd = n32(4);
  const tags = new Map();
  const count = n16(ifd);
  const SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 };
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    const tag = n16(e);
    const type = n16(e + 2);
    const n = n32(e + 4);
    const size = (SIZES[type] ?? 1) * n;
    const at = size <= 4 ? e + 8 : n32(e + 8);
    const values = [];
    for (let k = 0; k < Math.min(n, 100000); k++) {
      if (type === 3) values.push(n16(at + 2 * k));
      else if (type === 4) values.push(n32(at + 4 * k));
      else if (type === 5) values.push(n32(at + 8 * k) / (n32(at + 8 * k + 4) || 1));
      else values.push(d[at + k]);
    }
    tags.set(tag, values);
  }
  const one = (tag, dflt) => tags.get(tag)?.[0] ?? dflt;
  const width = one(256, 0);
  const height = one(257, 0);
  const bits = one(258, 1);
  const compression = one(259, 1);
  const photometric = one(262, 0);
  const spp = one(277, 1);
  const rowsPerStrip = one(278, height);
  const offsets = tags.get(273) ?? [];
  const counts = tags.get(279) ?? [];
  const lsbFirst = one(266, 1) === 2;
  const unit = one(296, 2);
  const factor = unit === 3 ? 2.54 : 1;
  const xRes = one(282, 72) * factor;
  const yRes = one(283, 72) * factor;
  const predictor = one(317, 1);
  const t4Options = one(292, 0);
  if (!width || !height) return fail('TIFF without image size');
  if (bits === 1 && spp === 1) {
    const rowBytes = Math.ceil(width / 8);
    const out = new Uint8Array(rowBytes * height);
    let row = 0;
    let error = null;
    for (let i = 0; i < offsets.length && row < height; i++) {
      const strip = d.subarray(offsets[i], offsets[i] + (counts[i] ?? 0));
      const rows = Math.min(rowsPerStrip, height - row);
      let data;
      if (compression === 1) data = strip;
      else if (compression === 32773) data = decodePackBits(strip, rowBytes * rows);
      else if (compression === 5) data = decodeLzw(strip, rowBytes * rows);
      else if (compression === 3 || compression === 4) {
        const r = decodeCcitt(strip, width, rows, compression === 4 ? 'G4' : (t4Options & 1 ? 'G3-2D' : 'G3-1D'),
          { lsbFirst, byteAlignRows: (t4Options & 4) !== 0 });
        // The CCITT decoder returns the stored bit values (black codes = 1, as written by libtiff);
        // like uncompressed data they are interpreted by the PhotometricInterpretation below.
        data = r.bits;
        error ||= r.error;
      } else return fail(`TIFF compression ${compression} not supported`);
      out.set(data.subarray(0, rowBytes * rows), row * rowBytes);
      row += rows;
    }
    if (photometric === 1) for (let k = 0; k < out.length; k++) out[k] = ~out[k]; // 0 = black → 1 = black
    return { width, height, xRes, yRes, bilevel: { rowBytes, bits: out }, error };
  }
  if (bits !== 8) return fail(`TIFF with ${bits} bits per sample not supported`);
  const chunks = [];
  for (let i = 0; i < offsets.length; i++) {
    const strip = d.subarray(offsets[i], offsets[i] + (counts[i] ?? 0));
    const rows = Math.min(rowsPerStrip, height - i * rowsPerStrip);
    const size = rows * width * spp;
    if (compression === 1) chunks.push(strip.subarray(0, size));
    else if (compression === 5) chunks.push(decodeLzw(strip, size));
    else if (compression === 32773) chunks.push(decodePackBits(strip, size));
    else return fail(`TIFF compression ${compression} not supported`);
  }
  const data = new Uint8Array(width * height * spp);
  let pos = 0;
  for (const c of chunks) {
    data.set(c.subarray(0, data.length - pos), pos);
    pos += c.length;
  }
  if (predictor === 2) {
    for (let y = 0; y < height; y++) {
      for (let x = 1; x < width; x++) {
        for (let c = 0; c < spp; c++) {
          const at = (y * width + x) * spp + c;
          data[at] = (data[at] + data[at - spp]) & 0xff;
        }
      }
    }
  }
  if (photometric === 0) for (let k = 0; k < data.length; k++) data[k] = 255 - data[k];
  if (photometric === 3) {
    // Palette: ColorMap holds all red, then all green, then all blue values (16 bits each).
    const map = tags.get(320) ?? [];
    if (map.length < 3 * 256) return fail('TIFF palette without ColorMap');
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      const v = data[i * spp];
      rgb[i * 3] = map[v] >> 8;
      rgb[i * 3 + 1] = map[256 + v] >> 8;
      rgb[i * 3 + 2] = map[512 + v] >> 8;
    }
    return { width, height, xRes, yRes, rgba: toRgba({ width, height, space: 'rgb', planes: [rgb], interleaved: true }), error: null };
  }
  const space = photometric === 5 ? 'cmyk' : photometric === 2 ? 'rgb' : photometric <= 1 ? 'gray' : null;
  if (!space) return fail(`TIFF PhotometricInterpretation ${photometric} not supported`);
  const keep = { gray: 1, rgb: 3, cmyk: 4 }[space];
  if (spp < keep) return fail(`TIFF with ${spp} samples per pel for ${space.toUpperCase()}`);
  const rgba = toRgba({ width, height, space, planes: [spp > keep ? firstSamples(data, width * height, spp, keep) : data], interleaved: true });
  return { width, height, xRes, yRes, rgba, error: null };
}

/**
 * Keeps the first samples of each pel (drops extra samples such as alpha).
 * @param {Uint8Array} data Interleaved samples.
 * @param {number} n Number of pels.
 * @param {number} spp Samples per pel in `data`.
 * @param {number} keep Samples per pel to keep.
 * @returns {Uint8Array} Interleaved samples, `keep` per pel.
 */
function firstSamples(data, n, spp, keep) {
  const out = new Uint8Array(n * keep);
  for (let i = 0; i < n; i++) out.set(data.subarray(i * spp, i * spp + keep), i * keep);
  return out;
}
