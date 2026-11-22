/**
 * Data Matrix ECC 200 (task T073), following ISO/IEC 16022 and, for the rectangular DMRE sizes
 * of modifier X'01', ISO/IEC 21471: encodation schemes ASCII, C40, Text, X12, EDIFACT and
 * Base 256, ECI, FNC1, structured append, reader programming and the 05/06 macros, pad
 * codewords, Reed–Solomon blocks with interleaving, the module placement of Annex F and the
 * finder and timing patterns of each data region.
 *
 * BCOCA (Data Matrix Special-Function Parameters, Table 23) passes the desired size, the flags
 * and the encodation scheme; bcoca.js reads them and the escape sequences and calls
 * dataMatrix(). For "device default" and "auto encoding" the whole message is encoded with each
 * scheme that can represent it and the shortest result is used (the minimal mixed-scheme
 * encodation of the ISO annex is device specific in BCOCA).
 */

import { rsEncode, DATA_MATRIX_RS } from './reed-solomon.js';
import { BarcodeDataError } from './linear.js';

/**
 * Symbol sizes: rows, columns, data region rows and columns, data codewords, error correction
 * codewords, interleaved blocks; DMRE marks the ISO/IEC 21471 sizes (BCOCA Tables 24 and 25).
 */
const SIZES = [
  [10, 10, 8, 8, 3, 5, 1], [12, 12, 10, 10, 5, 7, 1], [14, 14, 12, 12, 8, 10, 1], [16, 16, 14, 14, 12, 12, 1],
  [18, 18, 16, 16, 18, 14, 1], [20, 20, 18, 18, 22, 18, 1], [22, 22, 20, 20, 30, 20, 1], [24, 24, 22, 22, 36, 24, 1],
  [26, 26, 24, 24, 44, 28, 1], [32, 32, 14, 14, 62, 36, 1], [36, 36, 16, 16, 86, 42, 1], [40, 40, 18, 18, 114, 48, 1],
  [44, 44, 20, 20, 144, 56, 1], [48, 48, 22, 22, 174, 68, 1], [52, 52, 24, 24, 204, 84, 2], [64, 64, 14, 14, 280, 112, 2],
  [72, 72, 16, 16, 368, 144, 4], [80, 80, 18, 18, 456, 192, 4], [88, 88, 20, 20, 576, 224, 4], [96, 96, 22, 22, 696, 272, 4],
  [104, 104, 24, 24, 816, 336, 6], [120, 120, 18, 18, 1050, 408, 6], [132, 132, 20, 20, 1304, 496, 8],
  [144, 144, 22, 22, 1558, 620, 10],
  [8, 18, 6, 16, 5, 7, 1], [8, 32, 6, 14, 10, 11, 1], [12, 26, 10, 24, 16, 14, 1], [12, 36, 10, 16, 22, 18, 1],
  [16, 36, 14, 16, 32, 24, 1], [16, 48, 14, 22, 49, 28, 1],
].map(([rows, cols, rh, rw, data, ecc, blocks]) => ({ rows, cols, rh, rw, data, ecc, blocks, dmre: false }));

const DMRE = [
  [8, 48, 6, 22, 18, 15, 1], [8, 64, 6, 14, 24, 18, 1], [8, 80, 6, 18, 32, 22, 1], [8, 96, 6, 22, 38, 28, 1],
  [8, 120, 6, 18, 49, 32, 1], [8, 144, 6, 22, 63, 36, 1], [12, 64, 10, 14, 43, 27, 1], [12, 88, 10, 20, 64, 36, 1],
  [16, 64, 14, 14, 62, 36, 1], [20, 36, 18, 16, 44, 28, 1], [20, 44, 18, 20, 56, 34, 1], [20, 64, 18, 14, 84, 42, 1],
  [22, 48, 20, 22, 72, 38, 1], [24, 48, 22, 22, 80, 41, 1], [24, 64, 22, 14, 108, 46, 1], [26, 40, 24, 18, 70, 38, 1],
  [26, 48, 24, 22, 90, 42, 1], [26, 64, 24, 14, 118, 50, 1],
].map(([rows, cols, rh, rw, data, ecc, blocks]) => ({ rows, cols, rh, rw, data, ecc, blocks, dmre: true }));

export const DATA_MATRIX_SIZES = Object.freeze([...SIZES, ...DMRE]);

const ASCII = 'ascii';
const FNC1 = 232;
const GS = 0x1d;

/**
 * Encodes bytes in ASCII encodation (digit pairs, upper shift for bytes ≥ 128).
 * @param {number[]} b Bytes; -1 stands for FNC1.
 * @returns {number[]} Codewords.
 */
function asciiCodewords(b) {
  const out = [];
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    const n = b[i + 1];
    if (c === -1) out.push(FNC1);
    else if (c >= 0x30 && c <= 0x39 && n >= 0x30 && n <= 0x39) { out.push(130 + (c - 0x30) * 10 + (n - 0x30)); i++; }
    else if (c >= 128) out.push(235, c - 127);
    else out.push(c + 1);
  }
  return out;
}

/**
 * C40, Text and X12 values of one byte.
 * @param {'c40'|'text'|'x12'} scheme Scheme.
 * @param {number} c Byte, or -1 for FNC1.
 * @returns {number[]|null} Values, or null if the scheme cannot represent the byte.
 */
function tripletValues(scheme, c) {
  if (scheme === 'x12') {
    if (c === 13) return [0];
    if (c === 0x2a) return [1];
    if (c === 0x3e) return [2];
    if (c === 0x20) return [3];
    if (c >= 0x30 && c <= 0x39) return [c - 0x30 + 4];
    if (c >= 0x41 && c <= 0x5a) return [c - 0x41 + 14];
    return null;
  }
  if (c === -1) return [1, 27];
  if (c >= 128) {
    const rest = tripletValues(scheme, c - 128);
    return [1, 30, ...rest];
  }
  if (c === 0x20) return [3];
  if (c >= 0x30 && c <= 0x39) return [c - 0x30 + 4];
  const upper = c >= 0x41 && c <= 0x5a;
  const lower = c >= 0x61 && c <= 0x7a;
  if ((scheme === 'c40' && upper) || (scheme === 'text' && lower)) return [(c & 0x1f) - 1 + 14];
  if (c < 32) return [0, c];
  if (c >= 33 && c <= 47) return [1, c - 33];
  if (c >= 58 && c <= 64) return [1, c - 58 + 15];
  if (c >= 91 && c <= 95) return [1, c - 91 + 22];
  if (c === 96) return [2, 0];
  if (upper || lower) return [2, (c & 0x1f)];
  return [2, c - 123 + 27]; // { | } ~ DEL
}

/**
 * Encodes bytes in one scheme, starting and ending in ASCII encodation.
 * @param {string} scheme Scheme.
 * @param {number[]} b Bytes (-1 = FNC1).
 * @returns {{cw: number[], open: boolean}|null} Codewords, and whether the scheme is still
 *   latched at the end (an unlatch is then needed unless the symbol is exactly full); null if
 *   the scheme cannot represent the data.
 */
function encodeScheme(scheme, b) {
  if (scheme === ASCII) return { cw: asciiCodewords(b), open: false };
  if (scheme === 'base256') {
    if (b.includes(-1)) return null;
    const len = b.length;
    const head = len <= 249 ? [len] : [Math.floor(len / 250) + 249, len % 250];
    return { cw: [231], base256: [...head, ...b], open: false };
  }
  if (scheme === 'edifact') {
    if (b.some((c) => c < 32 || c > 94)) return null;
    const full = b.length - (b.length % 4);
    // The tail (0–3 characters) depends on the symbol size: with at most 2 codewords left the
    // unlatch is implied and the tail is ASCII, otherwise it ends with the unlatch value 31.
    return {
      cw: [240, ...edifactBytes(b.slice(0, full))],
      open: false,
      tail: { chars: b.slice(full), explicit: edifactBytes([...b.slice(full), 31]) },
    };
  }
  const latch = { c40: 230, text: 239, x12: 238 }[scheme];
  const cw = [latch];
  const values = [];
  const counts = [];
  for (const c of b) {
    const v = tripletValues(scheme, c);
    if (!v) return null;
    values.push(...v);
    counts.push(v.length);
  }
  // Whole characters up to the last triplet boundary; the rest follows in ASCII after an unlatch.
  let boundary = 0;
  for (let i = 0, acc = 0; i < counts.length; i++) {
    acc += counts[i];
    if (acc % 3 === 0) boundary = i + 1;
  }
  const take = values.slice(0, counts.slice(0, boundary).reduce((x, y) => x + y, 0));
  for (let i = 0; i < take.length; i += 3) {
    const v = take[i] * 1600 + take[i + 1] * 40 + take[i + 2] + 1;
    cw.push(v >> 8, v & 0xff);
  }
  const rest = b.slice(boundary);
  if (!rest.length) return { cw, open: true };
  cw.push(254);
  return { cw: cw.concat(asciiCodewords(rest)), open: false };
}

/**
 * Packs EDIFACT values (6 bits each) into bytes, padding the last byte with zero bits.
 * @param {number[]} chars Characters (32–94) or 31 for the unlatch.
 * @returns {number[]} Bytes.
 */
function edifactBytes(chars) {
  const bits = [];
  chars.forEach((c) => { for (let i = 5; i >= 0; i--) bits.push(((c & 0x3f) >> i) & 1); });
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, x) => (a << 1) | x, 0));
  return out;
}

/**
 * Randomizes Base 256 codewords (255-state algorithm).
 * @param {number[]} values Length field and data bytes.
 * @param {number} start 1-based position of the first of them in the codeword stream.
 * @returns {number[]} Codewords.
 */
function randomize255(values, start) {
  return values.map((v, i) => (v + ((149 * (start + i)) % 255) + 1) % 256);
}

/**
 * Encodes an ECI number.
 * @param {number} n ECI number.
 * @returns {number[]} Codewords.
 */
function eciCodewords(n) {
  if (n <= 126) return [241, n + 1];
  if (n <= 16382) return [241, Math.floor((n - 127) / 254) + 128, ((n - 127) % 254) + 1];
  const m = n - 16383;
  return [241, Math.floor(m / 64516) + 192, (Math.floor(m / 254) % 254) + 1, (m % 254) + 1];
}

const SCHEMES = [null, ASCII, 'c40', 'text', 'x12', 'edifact', 'base256', null];

/**
 * Builds the data codeword stream (without pad codewords).
 * @param {{eci: number|null, bytes: Uint8Array}[]} segments Data segments.
 * @param {object} o Options (see dataMatrix).
 * @returns {{cw: number[], open: boolean, tail: object|null}} Codewords, whether an unlatch is
 *   pending, and the EDIFACT tail of the last segment.
 */
function dataCodewords(segments, o) {
  const cw = [];
  if (o.structured) {
    const { index, total, fileId } = o.structured;
    cw.push(233, ((index - 1) << 4) | (17 - total), fileId >> 8, fileId & 0xff);
  }
  if (o.readerProgramming) cw.push(234);
  if (o.macro === 5) cw.push(236);
  if (o.macro === 6) cw.push(237);
  if (o.fnc1 === 'gs1') cw.push(FNC1);
  let open = false;
  let tail = null;
  segments.forEach((s, si) => {
    if (open) { cw.push(254); open = false; }
    if (s.eci != null) cw.push(...eciCodewords(s.eci));
    let b = [...s.bytes];
    if (o.fnc1 === 'gs1') b = b.map((c) => (c === GS ? -1 : c));
    if (o.fnc1 === 'industry' && si === 0 && b.length) {
      // FNC1 in the second data position: after the first character (or digit pair).
      const head = asciiCodewords(b.slice(0, 2)).length === 1 ? 2 : 1;
      cw.push(...asciiCodewords(b.slice(0, head)), FNC1);
      b = b.slice(head);
    }
    if (!b.length) return;
    const fixed = SCHEMES[o.scheme ?? 0];
    const candidates = (fixed ? [fixed] : [ASCII, 'c40', 'text', 'x12', 'edifact', 'base256'])
      .map((scheme) => ({ scheme, r: encodeScheme(scheme, b) })).filter((x) => x.r);
    if (!candidates.length) {
      throw new BarcodeDataError(`the ${fixed.toUpperCase()} encodation scheme cannot encode the data`, 'EC-1201');
    }
    const size = (r) => r.cw.length + (r.base256?.length ?? 0) + (r.open ? 1 : 0) + (r.tail?.explicit.length ?? 0);
    const best = candidates.reduce((a, x) => (size(x.r) < size(a.r) ? x : a));
    cw.push(...best.r.cw);
    if (best.r.base256) cw.push(...randomize255(best.r.base256, cw.length + 1));
    open = best.r.open;
    if (best.r.tail) {
      if (si === segments.length - 1) tail = best.r.tail; else cw.push(...best.r.tail.explicit);
    }
  });
  return { cw, open, tail };
}

/**
 * Places codewords into the mapping matrix (ISO/IEC 16022 Annex F).
 * @param {number} nrow Rows of the mapping matrix.
 * @param {number} ncol Columns of the mapping matrix.
 * @returns {Int32Array} Per module: 8 × codeword index + bit (bit 0 = most significant), or
 *   -1 = light and -2 = dark for the fixed corner pattern.
 */
function placement(nrow, ncol) {
  const a = new Int32Array(nrow * ncol).fill(-3);
  const mod = (row, col, chr, bit) => {
    if (row < 0) { row += nrow; col += 4 - ((nrow + 4) % 8); }
    if (col < 0) { col += ncol; row += 4 - ((ncol + 4) % 8); }
    a[row * ncol + col] = chr * 8 + bit;
  };
  const utah = (row, col, chr) => {
    mod(row - 2, col - 2, chr, 0); mod(row - 2, col - 1, chr, 1); mod(row - 1, col - 2, chr, 2); mod(row - 1, col - 1, chr, 3);
    mod(row - 1, col, chr, 4); mod(row, col - 2, chr, 5); mod(row, col - 1, chr, 6); mod(row, col, chr, 7);
  };
  const corner = (cells, chr) => cells.forEach(([r, c], bit) => mod(r, c, chr, bit));
  const n = nrow;
  const m = ncol;
  let chr = 0;
  let row = 4;
  let col = 0;
  const free = (r, c) => a[r * ncol + c] === -3;
  do {
    if (row === n && col === 0) corner([[n - 1, 0], [n - 1, 1], [n - 1, 2], [0, m - 2], [0, m - 1], [1, m - 1], [2, m - 1], [3, m - 1]], chr++);
    if (row === n - 2 && col === 0 && m % 4) corner([[n - 3, 0], [n - 2, 0], [n - 1, 0], [0, m - 4], [0, m - 3], [0, m - 2], [0, m - 1], [1, m - 1]], chr++);
    if (row === n - 2 && col === 0 && m % 8 === 4) corner([[n - 3, 0], [n - 2, 0], [n - 1, 0], [0, m - 2], [0, m - 1], [1, m - 1], [2, m - 1], [3, m - 1]], chr++);
    if (row === n + 4 && col === 2 && !(m % 8)) corner([[n - 1, 0], [n - 1, m - 1], [0, m - 3], [0, m - 2], [0, m - 1], [1, m - 3], [1, m - 2], [1, m - 1]], chr++);
    do {
      if (row < n && col >= 0 && free(row, col)) utah(row, col, chr++);
      row -= 2; col += 2;
    } while (row >= 0 && col < m);
    row += 1; col += 3;
    do {
      if (row >= 0 && col < m && free(row, col)) utah(row, col, chr++);
      row += 2; col -= 2;
    } while (row < n && col >= 0);
    row += 3; col += 1;
  } while (row < n || col < m);
  if (free(n - 1, m - 1)) {
    a[(n - 1) * m + m - 1] = -2;
    a[(n - 2) * m + m - 2] = -2;
    a[(n - 1) * m + m - 2] = -1;
    a[(n - 2) * m + m - 1] = -1;
  }
  return a;
}

/**
 * Chooses the symbol size.
 * @param {(size: object) => boolean} fits Whether the data fits into a size.
 * @param {object} o Options (see dataMatrix).
 * @returns {object} Size entry.
 */
function chooseSize(fits, o) {
  const all = o.dmre ? DATA_MATRIX_SIZES : SIZES;
  const { rows = 0, cols = 0 } = o;
  if (rows || cols) {
    const requested = all.filter((s) => (!rows || s.rows === rows) && (!cols || s.cols === cols));
    if (!requested.length) throw new BarcodeDataError(`unsupported symbol size ${rows || '*'}x${cols || '*'}`, 'EC-0F00');
    const ok = requested.filter(fits).sort((p, q) => p.data - q.data)[0];
    if (ok) return ok;
    if (o.strict) throw new BarcodeDataError(`data does not fit into a ${rows || '*'}x${cols || '*'} symbol`, 'EC-0F20');
    // Bigger symbol, keeping the aspect ratio as close as possible.
    const ratio = requested[0].cols / requested[0].rows;
    const bigger = all.filter(fits).sort((p, q) => Math.abs(Math.log(p.cols / p.rows / ratio)) - Math.abs(Math.log(q.cols / q.rows / ratio)) || p.data - q.data)[0];
    if (bigger) return bigger;
  } else {
    // No size given: the smallest square symbol (BCOCA recommends leaning toward squares).
    const s = all.filter((x) => x.rows === x.cols && fits(x))[0];
    if (s) return s;
  }
  throw new BarcodeDataError('data does not fit into the largest Data Matrix symbol', 'EC-0F20');
}

/**
 * Builds a Data Matrix ECC 200 symbol.
 * @param {{eci: number|null, bytes: Uint8Array}[]} segments Data segments.
 * @param {object} [o] Options.
 * @param {number} [o.rows] Desired number of rows (0 = any).
 * @param {number} [o.cols] Desired row size (0 = any).
 * @param {boolean} [o.dmre] Allow the DMRE sizes (modifier X'01').
 * @param {boolean} [o.strict] Report too much data instead of choosing a bigger symbol.
 * @param {number} [o.scheme] Encodation scheme as in byte 14 bits 5–7 (0 and 7 = automatic).
 * @param {'gs1'|'industry'|null} [o.fnc1] FNC1 in the first or second position.
 * @param {boolean} [o.readerProgramming] Reader programming symbol.
 * @param {5|6|null} [o.macro] 05 or 06 macro.
 * @param {{index: number, total: number, fileId: number}|null} [o.structured] Structured append.
 * @returns {import('./qrcode.js').MatrixSymbol} Symbol.
 */
export function dataMatrix(segments, o = {}) {
  const { cw, open, tail } = dataCodewords(segments, o);
  /** Final data codewords (before padding) for a size, or null if they do not fit. */
  const finish = (s) => {
    if (tail) {
      const rem = s.data - cw.length;
      if (rem >= 0 && rem <= 2) {
        const ascii = asciiCodewords(tail.chars);
        return ascii.length <= rem ? cw.concat(ascii) : null;
      }
      return cw.length + tail.explicit.length <= s.data ? cw.concat(tail.explicit) : null;
    }
    if (cw.length === s.data) return cw.slice();
    if (open) return cw.length < s.data ? [...cw, 254] : null;
    return cw.length <= s.data ? cw.slice() : null;
  };
  const size = chooseSize((s) => finish(s) !== null, o);
  const data = finish(size);
  // Pad codewords: 129 first, then the 253-state randomized value of its position.
  const start = data.length;
  while (data.length < size.data) {
    const pos = data.length + 1;
    const r = 129 + ((149 * pos) % 253) + 1;
    data.push(data.length === start ? 129 : r > 254 ? r - 254 : r);
  }
  // Interleave: data codeword i belongs to block i mod B; each block gets its own EC codewords.
  const B = size.blocks;
  const eccPerBlock = size.ecc / B;
  const all = data.concat(new Array(size.ecc).fill(0));
  for (let blk = 0; blk < B; blk++) {
    const part = data.filter((_, i) => i % B === blk);
    rsEncode(part, eccPerBlock, DATA_MATRIX_RS).forEach((e, k) => { all[size.data + blk + k * B] = e; });
  }
  const vr = Math.round(size.rows / (size.rh + 2));
  const hr = Math.round(size.cols / (size.rw + 2));
  const nrow = vr * size.rh;
  const ncol = hr * size.rw;
  const map = placement(nrow, ncol);
  const modules = new Uint8Array(size.rows * size.cols);
  const set = (r, c, v) => { modules[r * size.cols + c] = v; };
  // Finder (solid left and bottom edges) and timing (alternating top and right edges) per region.
  for (let ry = 0; ry < vr; ry++) {
    for (let rx = 0; rx < hr; rx++) {
      const top = ry * (size.rh + 2);
      const left = rx * (size.rw + 2);
      for (let k = 0; k < size.rw + 2; k++) {
        set(top + size.rh + 1, left + k, 1);
        set(top, left + k, k % 2 === 0 ? 1 : 0);
      }
      for (let k = 0; k < size.rh + 2; k++) {
        set(top + k, left, 1);
        set(top + k, left + size.rw + 1, k % 2 === 1 ? 1 : 0);
      }
    }
  }
  for (let r = 0; r < nrow; r++) {
    for (let c = 0; c < ncol; c++) {
      const v = map[r * ncol + c];
      const dark = v === -2 ? 1 : v < 0 ? 0 : (all[v >> 3] >> (7 - (v & 7))) & 1;
      const sr = Math.floor(r / size.rh) * (size.rh + 2) + 1 + (r % size.rh);
      const sc = Math.floor(c / size.rw) * (size.rw + 2) + 1 + (c % size.rw);
      set(sr, sc, dark);
    }
  }
  return { rows: size.rows, cols: size.cols, modules };
}
