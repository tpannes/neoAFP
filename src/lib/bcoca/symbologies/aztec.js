/**
 * Aztec Code (task T076), following ISO/IEC 24778: compact (1–4 layers), full-range (1–32
 * layers) and rune symbols; upper, lower, mixed, punctuation, digit and binary modes; FNC1, ECI,
 * structured append and reader initialization; bit stuffing, Reed–Solomon error correction with
 * a minimum percentage plus 3 codewords (BCOCA Table 21), mode message, bull's eye finder, orientation
 * marks and the reference grid of full-range symbols.
 *
 * BCOCA leaves the choice of modes to the device. This encoder latches or shifts greedily from
 * character to character (no global optimisation), so a printer may need fewer layers for the
 * same data.
 */

import { BarcodeDataError } from './linear.js';

const U = 0;
const L = 1;
const M = 2;
const P = 3;
const D = 4;

/** Character values per mode (ISO/IEC 24778 Table 2); -1 marks shifts and latches. */
const TABLES = (() => {
  const t = [new Map(), new Map(), new Map(), new Map(), new Map()];
  t[U].set(32, 1); t[L].set(32, 1); t[M].set(32, 1); t[D].set(32, 1);
  for (let i = 0; i < 26; i++) { t[U].set(0x41 + i, 2 + i); t[L].set(0x61 + i, 2 + i); }
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 27, 28, 29, 30, 31, 64, 92, 94, 95, 96, 124, 126, 127]
    .forEach((c, i) => t[M].set(c, 2 + i));
  // Punctuation 1–5 are CR and the pairs CR LF, ". ", ", ", ": " (pairs are not used here).
  t[P].set(13, 1);
  '!"#$%&\'()*+,-./:;<=>?[]{}'.split('').forEach((c, i) => t[P].set(c.charCodeAt(0), 6 + i));
  for (let i = 0; i < 10; i++) t[D].set(0x30 + i, 2 + i);
  t[D].set(44, 12); t[D].set(46, 13);
  return t;
})();

/** Bits per code in each mode. */
const BITS = [5, 5, 5, 5, 4];

/** Latch sequences [code, mode the code is read in] from one mode to another. */
const LATCH = {
  [U]: { [L]: [[28, U]], [M]: [[29, U]], [P]: [[29, U], [30, M]], [D]: [[30, U]] },
  [L]: { [U]: [[30, L], [14, D]], [M]: [[29, L]], [P]: [[29, L], [30, M]], [D]: [[30, L]] },
  [M]: { [U]: [[29, M]], [L]: [[28, M]], [P]: [[30, M]], [D]: [[29, M], [30, U]] },
  [P]: { [U]: [[31, P]], [L]: [[31, P], [28, U]], [M]: [[31, P], [29, U]], [D]: [[31, P], [30, U]] },
  [D]: { [U]: [[14, D]], [L]: [[14, D], [28, U]], [M]: [[14, D], [29, U]], [P]: [[14, D], [29, U], [30, M]] },
};

/** Token for FNC1 in the input. */
export const AZTEC_FNC1 = -1;

/** Bit writer. */
class Bits {
  constructor() { this.bits = []; }
  /**
   * @param {number} value Value.
   * @param {number} n Bits.
   */
  put(value, n) { for (let i = n - 1; i >= 0; i--) this.bits.push((value >> i) & 1); }
}

/**
 * Encodes the message into the Aztec bit stream.
 * @param {(number|{eci: number})[]} input Bytes, AZTEC_FNC1 or ECI markers.
 * @param {{index: number, total: number, id: number[]}|null} structured Structured append.
 * @returns {number[]} Bits.
 */
function encodeBits(input, structured) {
  const out = new Bits();
  let mode = U;
  const code = (v, m) => out.put(v, BITS[m]);
  const latch = (to) => {
    for (const [v, m] of LATCH[mode][to]) code(v, m);
    mode = to;
  };
  // FLG(n) in punctuation mode, reached by a shift (or directly in punctuation mode).
  const flag = (n, digits) => {
    if (mode !== P) code(0, mode);
    out.put(0, 5);
    out.put(n, 3);
    for (const d of digits) out.put(d + 2, 4);
  };
  const tokens = [...input];
  if (structured) {
    // ML UL, then the optional ID between spaces and the sequence letters (ISO/IEC 24778 8).
    code(29, U);
    code(29, M);
    const head = structured.id.length ? [32, ...structured.id, 32] : [];
    tokens.unshift(...head, 0x40 + structured.index, 0x40 + structured.total);
  }
  for (let i = 0; i < tokens.length; i++) {
    const c = tokens[i];
    if (c === AZTEC_FNC1) { flag(0, []); continue; }
    if (typeof c === 'object') {
      const digits = [...String(c.eci)].map(Number);
      flag(digits.length, digits);
      continue;
    }
    if (TABLES[mode].has(c)) { code(TABLES[mode].get(c), mode); continue; }
    const next = tokens[i + 1];
    const isUpper = (x) => x >= 0x41 && x <= 0x5a;
    if ((mode === L || mode === D) && isUpper(c) && !isUpper(next)) {
      code(mode === L ? 28 : 15, mode); // upper shift
      code(TABLES[U].get(c), U);
      continue;
    }
    const target = [U, L, M, D, P].find((m) => TABLES[m].has(c));
    if (target === P && mode !== P && !TABLES[P].has(next)) {
      code(0, mode); // punctuation shift
      code(TABLES[P].get(c), P);
      continue;
    }
    if (target !== undefined) {
      latch(target);
      code(TABLES[mode].get(c), mode);
      continue;
    }
    // Binary shift for bytes no mode can represent (from U, L or M).
    let n = 1;
    while (i + n < tokens.length && typeof tokens[i + n] === 'number' && tokens[i + n] >= 0
      && ![U, L, M, D, P].some((m) => TABLES[m].has(tokens[i + n])) && n < 2078) n++;
    if (mode === P || mode === D) latch(U);
    code(31, mode);
    if (n <= 31) out.put(n, 5); else { out.put(0, 5); out.put(n - 31, 11); }
    for (let k = 0; k < n; k++) out.put(tokens[i + k], 8);
    i += n - 1;
  }
  return out.bits;
}

/**
 * Splits bits into codewords, avoiding all-zero and all-one words (ISO/IEC 24778 7.3.1.2).
 * @param {number[]} bits Message bits.
 * @param {number} size Bits per codeword.
 * @returns {number[]} Codewords.
 */
function stuff(bits, size) {
  const words = [];
  const mask = (1 << size) - 2;
  for (let i = 0; i < bits.length; i += size) {
    let w = 0;
    for (let j = 0; j < size; j++) if (i + j >= bits.length || bits[i + j]) w |= 1 << (size - 1 - j);
    if ((w & mask) === mask) { words.push(w & mask); i--; } else if ((w & mask) === 0) { words.push(w | 1); i--; } else words.push(w);
  }
  return words;
}

/** Field polynomials by codeword size. */
const POLY = { 4: 0x13, 6: 0x43, 8: 0x12d, 10: 0x409, 12: 0x1069 };

/**
 * Reed–Solomon check words (generator roots α^1 … α^n) over GF(2^size).
 * @param {number[]} data Data words.
 * @param {number} n Number of check words.
 * @param {number} size Bits per word.
 * @returns {number[]} Check words.
 */
function rs(data, n, size) {
  const q = 1 << size;
  const exp = new Array(2 * q);
  const log = new Array(q);
  for (let i = 0, x = 1; i < q - 1; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & q) x ^= POLY[size];
  }
  for (let i = q - 1; i < 2 * q; i++) exp[i] = exp[i - (q - 1)];
  const mul = (a, b) => (a && b ? exp[log[a] + log[b]] : 0);
  let gen = [1];
  for (let i = 1; i <= n; i++) {
    const next = new Array(gen.length + 1).fill(0);
    gen.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, exp[i]); });
    gen = next;
  }
  const rem = new Array(n).fill(0);
  for (const d of data) {
    const f = d ^ rem.shift();
    rem.push(0);
    for (let j = 0; j < n; j++) rem[j] ^= mul(gen[j + 1], f);
  }
  return rem;
}

/**
 * Word size of a symbol.
 * @param {number} layers Layers.
 * @returns {number} Bits per codeword.
 */
const wordSize = (layers) => (layers <= 2 ? 6 : layers <= 8 ? 8 : layers <= 22 ? 10 : 12);

/**
 * Number of data bits of the layers.
 * @param {number} layers Layers.
 * @param {boolean} compact Compact symbol.
 * @returns {number} Bits.
 */
const layerBits = (layers, compact) => ((compact ? 88 : 112) + 16 * layers) * layers;

/** Candidate formats in size order (compact before the full-range symbol of equal size). */
const ORDER = (() => {
  const list = [];
  for (let l = 1; l <= 32; l++) {
    if (l <= 4) list.push({ compact: true, layers: l });
    list.push({ compact: false, layers: l });
  }
  return list;
})();

/**
 * Lays out a symbol: data layers spiralling outwards, reference grid, bull's eye, orientation
 * marks and mode message.
 * @param {boolean} compact Compact symbol.
 * @param {number} layers Layers (0 for a rune).
 * @param {number[]} bits Data and check bits, padded to the layer capacity.
 * @param {number[]} mode Mode message bits (28 or 40).
 * @returns {{rows: number, cols: number, modules: Uint8Array}} Matrix.
 */
function layout(compact, layers, bits, mode) {
  const base = (compact ? 11 : 14) + layers * 4;
  const map = new Array(base);
  let size = base;
  if (compact) {
    for (let i = 0; i < base; i++) map[i] = i;
  } else {
    size = base + 1 + 2 * Math.floor((Math.floor(base / 2) - 1) / 15);
    const origCenter = Math.floor(base / 2);
    const center = Math.floor(size / 2);
    for (let i = 0; i < origCenter; i++) {
      const offset = i + Math.floor(i / 15);
      map[origCenter - i - 1] = center - offset - 1;
      map[origCenter + i] = center + offset + 1;
    }
  }
  const modules = new Uint8Array(size * size);
  const set = (x, y) => { modules[y * size + x] = 1; };
  for (let i = 0, rowOffset = 0; i < layers; i++) {
    const rowSize = (layers - i) * 4 + (compact ? 9 : 12);
    for (let j = 0; j < rowSize; j++) {
      const col = j * 2;
      for (let k = 0; k < 2; k++) {
        if (bits[rowOffset + col + k]) set(map[i * 2 + k], map[i * 2 + j]);
        if (bits[rowOffset + rowSize * 2 + col + k]) set(map[i * 2 + j], map[base - 1 - i * 2 - k]);
        if (bits[rowOffset + rowSize * 4 + col + k]) set(map[base - 1 - i * 2 - k], map[base - 1 - i * 2 - j]);
        if (bits[rowOffset + rowSize * 6 + col + k]) set(map[base - 1 - i * 2 - j], map[i * 2 + k]);
      }
    }
    rowOffset += rowSize * 8;
  }
  const c = Math.floor(size / 2);
  if (compact) {
    for (let i = 0; i < 7; i++) {
      const o = c - 3 + i;
      if (mode[i]) set(o, c - 5);
      if (mode[i + 7]) set(c + 5, o);
      if (mode[20 - i]) set(o, c + 5);
      if (mode[27 - i]) set(c - 5, o);
    }
  } else {
    for (let i = 0; i < 10; i++) {
      const o = c - 5 + i + Math.floor(i / 5);
      if (mode[i]) set(o, c - 7);
      if (mode[i + 10]) set(c + 7, o);
      if (mode[29 - i]) set(o, c + 7);
      if (mode[39 - i]) set(c - 7, o);
    }
  }
  const eye = compact ? 5 : 7;
  for (let i = 0; i < eye; i += 2) {
    for (let j = c - i; j <= c + i; j++) { set(j, c - i); set(j, c + i); set(c - i, j); set(c + i, j); }
  }
  // Orientation marks.
  set(c - eye, c - eye); set(c - eye + 1, c - eye); set(c - eye, c - eye + 1);
  set(c + eye, c - eye); set(c + eye, c - eye + 1);
  set(c + eye, c + eye - 1);
  if (!compact) {
    // Reference grid: every 16th row and column through the center, alternating modules.
    for (let i = 0, j = 0; i < Math.floor(base / 2) - 1; i += 15, j += 16) {
      for (let k = c & 1; k < size; k += 2) { set(c - j, k); set(c + j, k); set(k, c - j); set(k, c + j); }
    }
  }
  return { rows: size, cols: size, modules };
}

/**
 * Builds the mode message bits.
 * @param {number[]} words 4-bit data words.
 * @param {number} total Total words (7 compact, 10 full-range).
 * @returns {number[]} Bits.
 */
function modeMessage(words, total) {
  const all = [...words, ...rs(words, total - words.length, 4)];
  return all.flatMap((w) => [3, 2, 1, 0].map((b) => (w >> b) & 1));
}

/**
 * Builds an Aztec Code symbol.
 * @param {(number|{eci: number})[]} input Bytes, AZTEC_FNC1 or ECI markers.
 * @param {object} [o] Options.
 * @param {'full'|'compact'|'any'|'rune'} [o.format] Symbol format (BCOCA modifier X'00', X'01', X'03', X'02').
 * @param {number} [o.layers] Desired layers (0 = smallest).
 * @param {number} [o.ecPercent] Minimum error correction percentage (default 23).
 * @param {boolean} [o.strict] Report too much data instead of choosing more layers.
 * @param {boolean} [o.readerInit] Reader initialization symbol.
 * @param {{index: number, total: number, id: number[]}|null} [o.structured] Structured append.
 * @returns {{rows: number, cols: number, modules: Uint8Array, compact: boolean, layers: number}} Symbol.
 */
export function aztec(input, o = {}) {
  const format = o.format ?? 'any';
  if (format === 'rune') {
    const value = input.find((x) => typeof x === 'number' && x >= 0);
    if (value === undefined) throw new BarcodeDataError('Aztec rune: one data byte is required');
    const mode = modeMessage([value >> 4, value & 0xf], 7).map((b, i) => b ^ (i % 2 === 0 ? 1 : 0));
    return { ...layout(true, 0, [], mode), compact: true, layers: 0 };
  }
  const pct = o.ecPercent ?? 23;
  const bits = encodeBits(input, o.structured ?? null);
  const wanted = o.layers ?? 0;
  const fits = ({ compact, layers }) => {
    const size = wordSize(layers);
    const total = Math.floor(layerBits(layers, compact) / size);
    const words = stuff(bits, size);
    const ecc = Math.ceil((total * pct) / 100 + 3);
    if (words.length + ecc > total) return null;
    if (compact && words.length > 64) return null;
    if (o.readerInit && ((compact && layers > 1) || (!compact && (layers > 22 || words.length > 1024)))) return null;
    return { compact, layers, size, total, words };
  };
  const formatOk = (c) => format === 'any' || (format === 'compact') === c.compact;
  let choice = null;
  if (wanted) {
    const exact = ORDER.find((c) => c.layers === wanted && formatOk(c) && (format !== 'any' || !c.compact));
    if (!exact) throw new BarcodeDataError(`Aztec Code: ${wanted} layers are not valid for this format`, 'EC-0F18');
    choice = fits(exact);
    if (!choice && o.strict) throw new BarcodeDataError(`Aztec Code: the data does not fit into ${wanted} layers`, 'EC-0F17');
  }
  if (!choice) {
    for (const c of ORDER) {
      if (!formatOk(c) || c.layers < wanted) continue;
      choice = fits(c);
      if (choice) break;
    }
  }
  if (!choice) throw new BarcodeDataError('Aztec Code: too much data for the symbol format', 'EC-0C00');
  const { compact, layers, size, total, words } = choice;
  const all = [...words, ...rs(words, total - words.length, size)];
  const capacity = layerBits(layers, compact);
  const stream = new Array(capacity % size).fill(0);
  for (const w of all) for (let b = size - 1; b >= 0; b--) stream.push((w >> b) & 1);
  let mode;
  if (compact) {
    let m = ((layers - 1) << 6) | (words.length - 1);
    if (o.readerInit) m |= 0x20;
    mode = modeMessage([m >> 4, m & 0xf], 7);
  } else {
    let m = ((layers - 1) << 11) | (words.length - 1);
    if (o.readerInit) m |= 0x400;
    mode = modeMessage([m >> 12, (m >> 8) & 0xf, (m >> 4) & 0xf, m & 0xf], 10);
  }
  return { ...layout(compact, layers, stream, mode), compact, layers };
}
