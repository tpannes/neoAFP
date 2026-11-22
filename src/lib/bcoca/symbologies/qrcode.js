/**
 * QR Code model 2 (task T074), following ISO/IEC 18004: numeric, alphanumeric and byte mode
 * segments, ECI designators, FNC1 in first/second position, structured append, versions 1–40,
 * error correction levels L/M/Q/H, Reed–Solomon blocks, module placement and the 8 data masks
 * with the penalty rules N1–N4.
 *
 * BCOCA (QR Code Special-Function Parameters, Table 31) passes the version (0 = smallest that
 * fits), the error correction level (0 = L … 3 = H), the "too much data" flag, structured append
 * values and the FNC1 flags; bcoca.js reads them and the escape sequences and calls qrCode().
 *
 * Each data segment is encoded in one mode: numeric if it has only digits, alphanumeric if it
 * has only characters of that set, otherwise byte mode (the bytes as given; the default
 * encodation is ECI 000020, Shift JIS). The size chosen by a printer can differ when it splits
 * segments into several modes; BCOCA leaves that to the device.
 */

import { rsEncode, QR_RS } from './reed-solomon.js';
import { BarcodeDataError } from './linear.js';

/** Error correction codewords per block, by level (L, M, Q, H) and version (index 0 unused). */
const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

/** Number of error correction blocks, by level and version. */
const BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

/** Format information bits of the levels L, M, Q, H. */
const LEVEL_BITS = [1, 0, 3, 2];

const ALPHANUMERIC = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
const GS = 0x1d;

/**
 * Number of modules available for data and error correction codewords (including remainder bits).
 * @param {number} ver Version.
 * @returns {number} Modules.
 */
function rawModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

/**
 * Number of data codewords of a version and level.
 * @param {number} ver Version.
 * @param {number} level Level 0–3 (L, M, Q, H).
 * @returns {number} Codewords.
 */
export function dataCapacity(ver, level) {
  return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[level][ver] * BLOCKS[level][ver];
}

/** Bit buffer. */
class Bits {
  constructor() { this.bits = []; }
  /**
   * Appends a value.
   * @param {number} value Value.
   * @param {number} length Number of bits.
   */
  put(value, length) {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }
}

/**
 * Chooses the mode and the content of one segment.
 * @param {Uint8Array} bytes Segment bytes.
 * @param {boolean} gs1 GS1 symbol: GS separators become FNC1 ('%' in alphanumeric mode).
 * @returns {{mode: 'numeric'|'alphanumeric'|'byte', chars: number[]}} Segment.
 */
function classify(bytes, gs1) {
  const list = [...bytes];
  if (list.length && list.every((b) => b >= 0x30 && b <= 0x39)) return { mode: 'numeric', chars: list };
  const alnum = gs1 ? list.flatMap((b) => (b === GS ? [0x25] : b === 0x25 ? [0x25, 0x25] : [b])) : list;
  if (alnum.every((b) => ALPHANUMERIC.includes(String.fromCharCode(b)))) return { mode: 'alphanumeric', chars: alnum };
  return { mode: 'byte', chars: list };
}

/**
 * Length of the character count indicator.
 * @param {string} mode Mode.
 * @param {number} ver Version.
 * @returns {number} Bits.
 */
function countBits(mode, ver) {
  const range = ver <= 9 ? 0 : ver <= 26 ? 1 : 2;
  return { numeric: [10, 12, 14], alphanumeric: [9, 11, 13], byte: [8, 16, 16] }[mode][range];
}

/**
 * Writes the bit stream for a version.
 * @param {{eci: number|null, bytes: Uint8Array}[]} segments Data segments.
 * @param {object} o Options (see qrCode).
 * @param {number} ver Version.
 * @returns {number[]} Bits.
 */
function bitStream(segments, o, ver) {
  const b = new Bits();
  if (o.structured) {
    b.put(0b0011, 4);
    b.put(o.structured.index - 1, 4);
    b.put(o.structured.total - 1, 4);
    b.put(o.structured.parity, 8);
  }
  const eci = (value) => {
    b.put(0b0111, 4);
    if (value < 128) b.put(value, 8);
    else if (value < 16384) b.put(0b10 << 14 | value, 16);
    else b.put(0b110 << 21 | value, 24);
  };
  // An ECI at the very start precedes the FNC1 indicator.
  let first = 0;
  if (segments[0]?.eci != null) { eci(segments[0].eci); first = 1; }
  if (o.fnc1 === 'gs1') b.put(0b0101, 4);
  if (o.fnc1 === 'industry') { b.put(0b1001, 4); b.put(o.appIndicator & 0xff, 8); }
  segments.forEach((s, i) => {
    if (s.eci != null && i >= first) eci(s.eci);
    if (!s.bytes.length) return;
    const { mode, chars } = classify(s.bytes, o.fnc1 === 'gs1');
    b.put({ numeric: 0b0001, alphanumeric: 0b0010, byte: 0b0100 }[mode], 4);
    b.put(chars.length, countBits(mode, ver));
    if (mode === 'numeric') {
      for (let k = 0; k < chars.length; k += 3) {
        const group = chars.slice(k, k + 3);
        b.put(Number(String.fromCharCode(...group)), group.length * 3 + 1);
      }
    } else if (mode === 'alphanumeric') {
      const v = chars.map((c) => ALPHANUMERIC.indexOf(String.fromCharCode(c)));
      for (let k = 0; k < v.length; k += 2) {
        if (k + 1 < v.length) b.put(v[k] * 45 + v[k + 1], 11); else b.put(v[k], 6);
      }
    } else {
      for (const c of chars) b.put(c, 8);
    }
  });
  return b.bits;
}

/**
 * Turns the bit stream into the data codewords of a version (terminator and pad codewords).
 * @param {number[]} bits Bits.
 * @param {number} capacity Data codewords.
 * @returns {number[]} Codewords.
 */
function codewords(bits, capacity) {
  const all = [...bits];
  const max = capacity * 8;
  for (let i = 0; i < 4 && all.length < max; i++) all.push(0);
  while (all.length % 8) all.push(0);
  const out = [];
  for (let i = 0; i < all.length; i += 8) out.push(all.slice(i, i + 8).reduce((a, x) => (a << 1) | x, 0));
  for (let pad = 0xec; out.length < capacity; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

/**
 * Data codewords of a version and level before error correction (for tests and diagnostics).
 * @param {{eci: number|null, bytes: Uint8Array}[]} segments Data segments.
 * @param {object} o Options (see qrCode).
 * @param {number} ver Version.
 * @param {number} level Level.
 * @returns {number[]} Codewords.
 */
export function qrDataCodewords(segments, o, ver, level) {
  return codewords(bitStream(segments, o, ver), dataCapacity(ver, level));
}

/**
 * Splits data codewords into blocks, adds the error correction and interleaves them.
 * @param {number[]} data Data codewords.
 * @param {number} ver Version.
 * @param {number} level Level.
 * @returns {number[]} Final codewords.
 */
export function interleave(data, ver, level) {
  const blocks = BLOCKS[level][ver];
  const eccLen = ECC_PER_BLOCK[level][ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const list = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const ecc = rsEncode(dat, eccLen, QR_RS);
    if (i < shortBlocks) dat.push(null);
    list.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < list[0].length; i++) {
    for (const block of list) if (block[i] !== null) out.push(block[i]);
  }
  return out;
}

/**
 * Alignment pattern center coordinates of a version.
 * @param {number} ver Version.
 * @returns {number[]} Coordinates.
 */
function alignmentPositions(ver) {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

/**
 * Builds the module matrix with function patterns, data and a given mask.
 * @param {number} ver Version.
 * @param {number} level Level.
 * @param {number[]} cw Final codewords.
 * @returns {{size: number, modules: Uint8Array, fn: Uint8Array}} Matrix before masking.
 */
function baseMatrix(ver, level, cw) {
  const size = ver * 4 + 17;
  const modules = new Uint8Array(size * size);
  const fn = new Uint8Array(size * size);
  const set = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y * size + x] = dark ? 1 : 0;
    fn[y * size + x] = 1;
  };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }
  }
  const pos = alignmentPositions(ver);
  pos.forEach((cy, i) => pos.forEach((cx, j) => {
    const last = pos.length - 1;
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }));
  formatBits(set, size, level, 0); // reserve the format areas
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, dark);
      set(b, a, dark);
    }
  }
  // Codewords in two-module columns from the bottom right, alternating up and down.
  let i = 0;
  const total = cw.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fn[y * size + x] && i < total) {
          modules[y * size + x] = (cw[i >>> 3] >>> (7 - (i & 7))) & 1;
          i++;
        }
      }
    }
  }
  return { size, modules, fn };
}

/**
 * Draws both copies of the format information and the dark module.
 * @param {(x: number, y: number, dark: boolean) => void} set Setter.
 * @param {number} size Symbol size.
 * @param {number} level Level.
 * @param {number} mask Mask.
 */
function formatBits(set, size, level, mask) {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
}

/** Data mask conditions (ISO/IEC 18004 Table 10), x = column, y = row. */
const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/**
 * Penalty score of a masked matrix (rules N1–N4).
 * @param {Uint8Array} m Modules.
 * @param {number} size Size.
 * @returns {number} Score.
 */
export function penalty(m, size) {
  let score = 0;
  const at = (x, y) => m[y * size + x];
  const lines = (get) => {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b <= size; b++) {
        if (b < size && get(a, b) === get(a, b - 1)) { run++; continue; }
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
      // 1:1:3:1:1 finder-like pattern preceded or followed by 4 light modules: 40 per pattern
      // (outside the symbol counts as light).
      for (let b = 0; b + 7 <= size; b++) {
        const v = (k) => (k < 0 || k >= size ? 0 : get(a, k));
        if (![1, 0, 1, 1, 1, 0, 1].every((p, k) => v(b + k) === p)) continue;
        const before = [1, 2, 3, 4].every((k) => v(b - k) === 0);
        const after = [7, 8, 9, 10].every((k) => v(b + k) === 0);
        if (before || after) { score += 40; b += 6; }
      }
    }
  };
  lines((a, b) => at(b, a));
  lines((a, b) => at(a, b));
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = at(x, y);
      if (c === at(x + 1, y) && c === at(x, y + 1) && c === at(x + 1, y + 1)) score += 3;
    }
  }
  const dark = m.reduce((a, b) => a + b, 0);
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

/**
 * @typedef {object} MatrixSymbol
 * @property {number} rows Rows of modules.
 * @property {number} cols Columns of modules.
 * @property {Uint8Array} modules 1 = dark, row by row.
 */

/**
 * Builds a QR Code symbol.
 * @param {{eci: number|null, bytes: Uint8Array}[]} segments Data segments (an ECI switches the
 *   encodation for the bytes that follow it).
 * @param {object} [o] Options.
 * @param {number} [o.version] Version 1–40, or 0 for the smallest that fits.
 * @param {number} [o.level] Error correction level 0–3 (L, M, Q, H).
 * @param {boolean} [o.strict] Report too much data instead of choosing a bigger version.
 * @param {'gs1'|'industry'|null} [o.fnc1] FNC1 in first or second position.
 * @param {number} [o.appIndicator] Application indicator for the industry FNC1.
 * @param {{index: number, total: number, parity: number}|null} [o.structured] Structured append.
 * @param {number|null} [o.mask] Fixed mask (for tests); otherwise the lowest penalty wins.
 * @returns {MatrixSymbol & {version: number, level: number, mask: number}} Symbol.
 */
export function qrCode(segments, o = {}) {
  const level = o.level ?? 0;
  if (!(level >= 0 && level <= 3)) throw new BarcodeDataError(`invalid error correction level X'${level.toString(16)}'`, 'EC-0F10');
  const wanted = o.version ?? 0;
  if (!(wanted >= 0 && wanted <= 40)) throw new BarcodeDataError(`invalid version ${wanted}`, 'EC-0F0F');
  let ver = Math.max(1, wanted);
  let bits = bitStream(segments, o, ver);
  while (bits.length > dataCapacity(ver, level) * 8) {
    if (o.strict && wanted > 0) throw new BarcodeDataError(`data does not fit into version ${wanted}`, 'EC-0F16');
    if (++ver > 40) throw new BarcodeDataError('data does not fit into version 40', 'EC-0F16');
    bits = bitStream(segments, o, ver);
  }
  const cw = interleave(codewords(bits, dataCapacity(ver, level)), ver, level);
  const base = baseMatrix(ver, level, cw);
  const { size, fn } = base;
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    if (o.mask != null && mask !== o.mask) continue;
    const m = base.modules.slice();
    const cond = MASKS[mask];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (!fn[y * size + x] && cond(x, y)) m[y * size + x] ^= 1;
    }
    formatBits((x, y, dark) => { m[y * size + x] = dark ? 1 : 0; }, size, level, mask);
    const score = o.mask != null ? 0 : penalty(m, size);
    if (!best || score < best.score) best = { score, m, mask };
  }
  return { rows: size, cols: size, modules: best.m, version: ver, level, mask: best.mask };
}
