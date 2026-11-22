/**
 * PDF417 (task T075), following ISO/IEC 15438 (AIM USS PDF417): text, byte and numeric
 * compaction, Reed–Solomon error correction over GF(929) for security levels 0–8, row indicators,
 * start and stop patterns, full and truncated symbols (BCOCA modifiers X'00' and X'01').
 *
 * BCOCA (PDF417 Special-Function Parameters, Table 30) passes the data symbol characters per
 * row, the desired number of rows and the security level; escape sequences "\ddd" insert
 * codewords (GLI, reader programming), "\\" stands for one backslash.
 *
 * Compaction follows the usual heuristic: runs of 13 or more digits in numeric compaction, runs
 * of 5 or more text characters in text compaction, everything else in byte compaction. Printers
 * may compact differently, which can change the number of rows; BCOCA leaves this to the device.
 */

import { BarcodeDataError } from './linear.js';
import { PDF417_PATTERNS } from './pdf417-patterns.js';

const TEXT_LATCH = 900;
const BYTE_LATCH = 901;
const NUMERIC_LATCH = 902;
const BYTE_SHIFT = 913;
const BYTE_LATCH_6 = 924;

const MIXED = '0123456789&\r\t,:#-.$/+%*=^';
const PUNCTUATION = ';<>@[\\]_`~!\r\t,:\n-.$/"|*()?{}\'';

/**
 * Tells whether a byte is a digit (numeric compaction).
 * @param {number} c Byte.
 * @returns {boolean} True for 0–9.
 */
const isDigit = (c) => c >= 0x30 && c <= 0x39;
/**
 * Tells whether a byte can be text-compacted (tab, LF, CR, printable ASCII).
 * @param {number} c Byte.
 * @returns {boolean} True if text compaction can encode it.
 */
const isText = (c) => c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126);
/**
 * Tells whether a byte is in the upper-case submode (space, A–Z).
 * @param {number} c Byte.
 * @returns {boolean} True for the upper-case submode.
 */
const isUpper = (c) => c === 32 || (c >= 0x41 && c <= 0x5a);
/**
 * Tells whether a byte is in the lower-case submode (space, a–z).
 * @param {number} c Byte.
 * @returns {boolean} True for the lower-case submode.
 */
const isLower = (c) => c === 32 || (c >= 0x61 && c <= 0x7a);
/**
 * Position of a byte in the mixed submode table.
 * @param {number} c Byte.
 * @returns {number} Index, or −1.
 */
const mixedIndex = (c) => MIXED.indexOf(String.fromCharCode(c));
/**
 * Position of a byte in the punctuation submode table.
 * @param {number} c Byte.
 * @returns {number} Index, or −1.
 */
const punctIndex = (c) => PUNCTUATION.indexOf(String.fromCharCode(c));

/**
 * Splits the data at escape sequences.
 * @param {Uint8Array} bytes Data.
 * @param {boolean} escapes Process escape sequences.
 * @returns {({bytes: number[]}|{cw: number})[]} Byte runs and inserted codewords.
 */
export function pdf417Tokens(bytes, escapes) {
  const out = [];
  const push = (b) => {
    const last = out[out.length - 1];
    if (last?.bytes) last.bytes.push(b); else out.push({ bytes: [b] });
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (!escapes || b !== 0x5c) { push(b); continue; }
    if (bytes[i + 1] === 0x5c) { push(0x5c); i++; continue; }
    const d = [...bytes.subarray(i + 1, i + 4)];
    if (d.length < 3 || d.some((x) => !isDigit(x))) {
      throw new BarcodeDataError("PDF417: escape character X'5C' is not followed by three digits or another X'5C'");
    }
    const cw = Number(String.fromCharCode(...d));
    if (cw > 928 || cw === 922 || cw === 923 || cw === 928) throw new BarcodeDataError(`PDF417: escape sequence \\${String.fromCharCode(...d)} is not allowed in the data`);
    if (cw === 921 && i !== 0) throw new BarcodeDataError('PDF417: reader programming (\\921) is only allowed at the beginning of the data');
    out.push({ cw });
    i += 3;
  }
  return out;
}

/**
 * Number of consecutive digits from a position.
 * @param {number[]} b Bytes.
 * @param {number} p Position.
 * @returns {number} Count.
 */
function digitRun(b, p) {
  let n = 0;
  while (p + n < b.length && isDigit(b[p + n])) n++;
  return n;
}

/**
 * Number of consecutive text characters, stopping before a run of 13 digits.
 * @param {number[]} b Bytes.
 * @param {number} p Position.
 * @returns {number} Count.
 */
function textRun(b, p) {
  let i = p;
  while (i < b.length) {
    const digits = digitRun(b, i);
    if (digits >= 13) return i - p;
    if (digits > 0) { i += digits; continue; }
    if (!isText(b[i])) break;
    i++;
  }
  return i - p;
}

/**
 * Number of bytes for byte compaction: up to a run of 13 digits or 5 text characters.
 * @param {number[]} b Bytes.
 * @param {number} p Position.
 * @returns {number} Count (at least 1).
 */
function byteRun(b, p) {
  let i = p;
  while (i < b.length) {
    if (digitRun(b, i) >= 13 || textRun(b, i) >= 5) break;
    i++;
  }
  return Math.max(1, i - p);
}

/**
 * Text compaction of a run; returns the submode at the end.
 * @param {number[]} b Characters.
 * @param {number} submode Submode at the start (0 alpha, 1 lower, 2 mixed, 3 punctuation).
 * @param {number[]} out Codewords.
 * @returns {number} Submode at the end.
 */
function encodeText(b, submode, out) {
  const v = [];
  for (let i = 0; i < b.length;) {
    const c = b[i];
    if (submode === 0) {
      if (isUpper(c)) v.push(c === 32 ? 26 : c - 0x41);
      else if (isLower(c)) { submode = 1; v.push(27); continue; }
      else if (mixedIndex(c) >= 0) { submode = 2; v.push(28); continue; }
      else v.push(29, punctIndex(c)); // punctuation shift
    } else if (submode === 1) {
      if (isLower(c)) v.push(c === 32 ? 26 : c - 0x61);
      else if (isUpper(c)) v.push(27, c - 0x41); // alpha shift
      else if (mixedIndex(c) >= 0) { submode = 2; v.push(28); continue; }
      else v.push(29, punctIndex(c));
    } else if (submode === 2) {
      if (mixedIndex(c) >= 0) v.push(mixedIndex(c));
      else if (isUpper(c)) { submode = 0; v.push(28); continue; }
      else if (isLower(c)) { submode = 1; v.push(27); continue; }
      else if (i + 1 < b.length && punctIndex(b[i + 1]) >= 0) { submode = 3; v.push(25); continue; }
      else v.push(29, punctIndex(c));
    } else if (punctIndex(c) >= 0) {
      v.push(punctIndex(c));
    } else {
      submode = 0;
      v.push(29);
      continue;
    }
    i++;
  }
  if (v.length % 2) v.push(29);
  for (let i = 0; i < v.length; i += 2) out.push(v[i] * 30 + v[i + 1]);
  return submode;
}

/**
 * Byte compaction (groups of 6 bytes as 5 base-900 codewords, the rest one codeword each).
 * @param {number[]} b Bytes.
 * @param {boolean} shift Single byte in text compaction (shift instead of latch).
 * @param {number[]} out Codewords.
 */
function encodeBytes(b, shift, out) {
  if (shift && b.length === 1) { out.push(BYTE_SHIFT, b[0]); return; }
  out.push(b.length % 6 === 0 ? BYTE_LATCH_6 : BYTE_LATCH);
  let i = 0;
  for (; b.length - i >= 6; i += 6) {
    let t = 0n;
    for (let k = 0; k < 6; k++) t = t * 256n + BigInt(b[i + k]);
    const group = [];
    for (let k = 0; k < 5; k++) { group.unshift(Number(t % 900n)); t /= 900n; }
    out.push(...group);
  }
  for (; i < b.length; i++) out.push(b[i]);
}

/**
 * Numeric compaction (groups of up to 44 digits, prefixed with 1, in base 900).
 * @param {number[]} b Digits.
 * @param {number[]} out Codewords.
 */
function encodeNumeric(b, out) {
  for (let i = 0; i < b.length; i += 44) {
    let t = BigInt(`1${String.fromCharCode(...b.slice(i, i + 44))}`);
    const group = [];
    while (t > 0n) { group.unshift(Number(t % 900n)); t /= 900n; }
    out.push(...group);
  }
}

/**
 * Data codewords for the tokens (without the length descriptor).
 * @param {({bytes: number[]}|{cw: number})[]} tokens Tokens.
 * @returns {number[]} Codewords.
 */
export function pdf417DataCodewords(tokens) {
  const out = [];
  let mode = 'text';
  let submode = 0;
  for (const t of tokens) {
    if (t.cw !== undefined) {
      out.push(t.cw);
      // A reader continues in text compaction (alpha) after such a codeword.
      mode = 'text';
      submode = 0;
      continue;
    }
    const b = t.bytes;
    for (let p = 0; p < b.length;) {
      const digits = digitRun(b, p);
      if (digits >= 13) {
        out.push(NUMERIC_LATCH);
        encodeNumeric(b.slice(p, p + digits), out);
        mode = 'numeric';
        submode = 0;
        p += digits;
        continue;
      }
      const text = textRun(b, p);
      if (text >= 5 || (text > 0 && text === b.length - p)) {
        if (mode !== 'text') { out.push(TEXT_LATCH); mode = 'text'; submode = 0; }
        submode = encodeText(b.slice(p, p + text), submode, out);
        p += text;
        continue;
      }
      const n = byteRun(b, p);
      encodeBytes(b.slice(p, p + n), mode === 'text', out);
      if (!(mode === 'text' && n === 1)) { mode = 'byte'; submode = 0; }
      p += n;
    }
  }
  return out;
}

/**
 * Builds a Macro PDF417 Control Block (ISO/IEC 15438 Annex H; BCOCA Table 30 bytes 11–n) from
 * its BCOCA form: "\928", the segment index (1–5 digits, 1–99 999; encoded 0-based as two
 * numeric compaction codewords), file ID codewords "\000"–"\899", optional fields ("\923",
 * designator "\000"–"\006", then text for designators 0, 3 and 4 or digits for the others),
 * and "\922" in the last segment. Text fields use text compaction, number fields numeric
 * compaction; the segment count is encoded like the index (not 0-based).
 * @param {Uint8Array|number[]} bytes Control block data (GLI 0).
 * @returns {number[]} Codewords.
 */
export function macroControlBlock(bytes) {
  const b = [...bytes];
  const fail = (why) => { throw new BarcodeDataError(`PDF417: Macro PDF417 Control Block ${why}`, 'EC-0F0D'); };
  let p = 0;
  const escape = () => {
    if (b[p] !== 0x5c) return null;
    const d = b.slice(p + 1, p + 4);
    if (d.length < 3 || !d.every(isDigit)) fail('has an incomplete escape sequence');
    p += 4;
    return Number(String.fromCharCode(...d));
  };
  const run = (accept) => { const start = p; while (p < b.length && b[p] !== 0x5c && accept(b[p])) p++; return b.slice(start, p); };
  const out = [];
  const first = escape();
  if (first === 922 && p === b.length) return [922];
  if (first !== 928) fail('does not start with \\928');
  out.push(928);
  const index = run(isDigit);
  if (!index.length || index.length > 5 || Number(String.fromCharCode(...index)) < 1) fail('has no valid segment index');
  encodeNumeric([...String(Number(String.fromCharCode(...index)) - 1).padStart(5, '0')].map((c) => c.charCodeAt(0)), out);
  while (p < b.length) {
    const cw = escape();
    if (cw === null) fail('has data outside a field');
    if (cw === 922) { if (p !== b.length) fail('continues after \\922'); out.push(922); break; }
    if (cw !== 923) {
      if (cw > 899) fail(`has an invalid file ID codeword ${cw}`);
      out.push(cw);
      continue;
    }
    const designator = escape();
    if (designator === null || designator > 6) fail('has an invalid field designator');
    out.push(923, designator);
    if ([0, 3, 4].includes(designator)) {
      const t = run((c) => c === 9 || c === 10 || c === 13 || (c >= 0x20 && c <= 0x7e));
      if (!t.length) fail('has an empty text field');
      encodeText(t, 0, out);
    } else {
      const d = run(isDigit);
      const max = { 1: 5, 2: 11, 6: 5 }[designator] ?? Infinity;
      if (!d.length || d.length > max) fail(`has an invalid number in field ${designator}`);
      const digits = designator === 1 ? [...String(Number(String.fromCharCode(...d))).padStart(5, '0')].map((c) => c.charCodeAt(0)) : d;
      encodeNumeric(digits, out);
    }
  }
  return out;
}

/**
 * Error correction codewords: the negated remainder of d(x)·x^k divided by
 * g(x) = (x − 3)(x − 3²)…(x − 3^k) over GF(929).
 * @param {number[]} data Data codewords (with length descriptor and padding).
 * @param {number} level Security level 0–8.
 * @returns {number[]} 2^(level+1) codewords.
 */
export function pdf417Ecc(data, level) {
  const k = 2 ** (level + 1);
  let g = [1];
  for (let i = 1, root = 3; i <= k; i++, root = (root * 3) % 929) {
    const next = new Array(g.length + 1).fill(0);
    g.forEach((c, j) => {
      next[j] = (next[j] + c) % 929;
      next[j + 1] = (next[j + 1] + 929 - ((c * root) % 929)) % 929;
    });
    g = next;
  }
  const rem = new Array(k).fill(0);
  for (const d of data) {
    const factor = (d + rem[0]) % 929;
    rem.shift();
    rem.push(0);
    for (let j = 0; j < k; j++) rem[j] = (rem[j] + 929 - ((factor * g[j + 1]) % 929)) % 929;
  }
  return rem.map((r) => (929 - r) % 929);
}

/**
 * Builds a PDF417 symbol.
 * @param {({bytes: number[]}|{cw: number})[]} tokens Data tokens (see pdf417Tokens).
 * @param {object} o Options.
 * @param {number} o.cols Data symbol characters per row (1–30).
 * @param {number} [o.rows] Desired rows (3–90), or 0xFF / 0 for the minimum.
 * @param {number} [o.level] Security level 0–8.
 * @param {boolean} [o.truncated] Truncated symbol (no right row indicator, one-module stop bar).
 * @param {number[]} [o.macro] Macro PDF417 Control Block codewords, placed after the padding.
 * @returns {{rows: number, cols: number, modules: Uint8Array, rowHeightModules: number}} Matrix
 *   of modules; each symbol row is one matrix row.
 */
export function pdf417(tokens, o) {
  const { cols, level = 0, truncated = false } = o;
  if (!(cols >= 1 && cols <= 30)) throw new BarcodeDataError(`PDF417: invalid number of data symbol characters per row ${cols}`, 'EC-0F06');
  if (!(level >= 0 && level <= 8)) throw new BarcodeDataError(`PDF417: invalid security level ${level}`, 'EC-0F09');
  const wanted = o.rows === 0xff || !o.rows ? 0 : o.rows;
  if (wanted && (wanted < 3 || wanted > 90)) throw new BarcodeDataError(`PDF417: invalid number of rows ${wanted}`, 'EC-0F07');
  const data = pdf417DataCodewords(tokens);
  const macro = o.macro ?? [];
  const k = 2 ** (level + 1);
  const rows = Math.max(3, wanted, Math.ceil((data.length + macro.length + 1 + k) / cols));
  if (rows > 90 || rows * cols > 928) throw new BarcodeDataError('PDF417: too much data for the symbol', 'EC-0F08');
  const n = rows * cols - k;
  const cw = [n, ...data];
  while (cw.length < n - macro.length) cw.push(TEXT_LATCH); // pad codewords before the control block
  cw.push(...macro);
  cw.push(...pdf417Ecc(cw, level));
  const width = truncated ? 17 + 17 + cols * 17 + 1 : 17 + 17 + cols * 17 + 17 + 18;
  const modules = new Uint8Array(rows * width);
  for (let r = 0; r < rows; r++) {
    const cluster = r % 3;
    const base = Math.floor(r / 3) * 30;
    const ind = [
      base + Math.floor((rows - 1) / 3),
      base + level * 3 + ((rows - 1) % 3),
      base + cols - 1,
    ];
    const left = ind[cluster];
    const right = ind[(cluster + 2) % 3];
    let x = r * width;
    const bits = (value, count) => { for (let i = count - 1; i >= 0; i--) modules[x++] = (value >> i) & 1; };
    bits(0b11111111010101000, 17);
    bits(PDF417_PATTERNS[cluster][left], 17);
    for (let c = 0; c < cols; c++) bits(PDF417_PATTERNS[cluster][cw[r * cols + c]], 17);
    if (truncated) bits(1, 1);
    else { bits(PDF417_PATTERNS[cluster][right], 17); bits(0b111111101000101001, 18); }
  }
  return { rows, cols: width, modules, rowHeightModules: 4 };
}
