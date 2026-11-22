/**
 * Postal bar codes (task T072): POSTNET and PLANET (USPS, deprecated in BCOCA), Royal Mail
 * RM4SCC and Dutch KIX, the USPS Intelligent Mail Barcode (USPS-B-3200), the Japan Postal Bar
 * Code and the Australia Post Bar Code; the 4-state Royal Mail Mailmark (task T290).
 *
 * The character tables of the Japan Postal and Australia Post bar codes and the Australia Post
 * Reed–Solomon generator are taken from Barcode Writer in Pure PostScript (BWIPP, barcode.ps,
 * encoders "japanpost" and "auspost", bwip-js 4.5.1):
 *
 *   Copyright (c) 2004-2024 Terry Burton
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this
 *   software and associated documentation files (the "Software"), to deal in the Software
 *   without restriction, including without limitation the rights to use, copy, modify, merge,
 *   publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons
 *   to whom the Software is furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all copies or
 *   substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 *   INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
 *   PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE
 *   FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
 *   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 *   DEALINGS IN THE SOFTWARE.
 *
 * A postal symbol is a sequence of bars at a fixed pitch. Each bar is one of:
 * F full bar, A ascender (tracker + upper part), D descender (tracker + lower part), T tracker
 * (middle part only); POSTNET/PLANET use F and S (short bar on the baseline).
 *
 * Sizes follow BCOCA Table 12 (optimal and small symbols) and Table 13 (bar width and pitch).
 */

import { BarcodeDataError } from './linear.js';
import { rsEncode, MAILMARK_RS } from './reed-solomon.js';

/**
 * @typedef {object} PostalSymbol
 * @property {string} bars Bar states.
 * @property {'postnet'|'planet'|'rm4scc'|'kix'|'imb'|'japan'|'auspost'} kind Symbology (selects
 *   the geometry).
 * @property {string|null} hri Human-readable text, or null if the symbology has none.
 * @property {boolean} [hriAbove] HRI goes above the symbol unless the BSA asks for below.
 */

/**
 * Geometry in inches: pitch, bar width, total height, the top and bottom of each bar state as a
 * fraction of the height (0 = top), and the small-symbol width and height factors (Table 12).
 */
export const POSTAL_GEOMETRY = Object.freeze({
  // POSTNET: full bar 0.125 in, short bar 0.050 in; small symbol 1.307 in instead of 1.429 in.
  postnet: { pitch: 1 / 22, bar: 0.020, height: 0.125, states: { F: [0, 1], S: [0.6, 1] }, small: [1.307 / 1.429, 0.115 / 0.125] },
  planet: { pitch: 1 / 22, bar: 0.020, height: 0.125, states: { F: [0, 1], S: [0.6, 1] }, small: [2.557 / 2.793, 0.115 / 0.125] },
  // RM4SCC/KIX: 198 mils high; tracker 1/4 of the height, ascender and descender 5/8.
  rm4scc: { pitch: 1 / 22, bar: 0.020, height: 0.198, states: { F: [0, 1], A: [0, 0.625], D: [0.375, 1], T: [0.375, 0.625] }, small: [35.31 / 38.61, 4.22 / 5.03] },
  kix: { pitch: 1 / 22, bar: 0.020, height: 0.198, states: { F: [0, 1], A: [0, 0.625], D: [0.375, 1], T: [0.375, 0.625] }, small: [33.19 / 36.30, 4.22 / 5.03] },
  // Intelligent Mail Barcode: 0.145 in high, tracker and ascender/descender thirds.
  imb: { pitch: 1 / 22, bar: 0.020, height: 0.145, states: { F: [0, 1], A: [0, 2 / 3], D: [1 / 3, 1], T: [1 / 3, 2 / 3] }, small: [2.68 / 2.95, 0.125 / 0.145] },
  // Australia Post: 20 mils at 23.5 bars per inch, 197 mils high (Table 13); small 37.0 of 39.60 mm.
  auspost: { pitch: 1 / 23.5, bar: 0.020, height: 0.197, states: { F: [0, 1], A: [0, 0.625], D: [0.375, 1], T: [0.375, 0.625] }, small: [37.0 / 39.60, 4.2 / 5.0] },
  // Royal Mail Mailmark: 0.54 mm bars, 5.10 mm full bar of 1.9 mm ascender, 1.3 mm tracker and
  // 1.9 mm descender (Mailmark definition document Table 11); the pitch makes Barcode C (66 bars)
  // 79.08 mm wide (BCOCA Table 12, Barcode L 93.45 mm); small symbol 69.85 mm × 4.22 mm.
  mailmark: { pitch: (79.08 - 0.54) / 65 / 25.4, bar: 0.54 / 25.4, height: 5.10 / 25.4, states: { F: [0, 1], A: [0, 3.2 / 5.1], D: [1.9 / 5.1, 1], T: [1.9 / 5.1, 3.2 / 5.1] }, small: [69.85 / 79.08, 4.22 / 5.10] },
  // Japan Postal: sized by the module width X (default 24 mils): bars X wide at a pitch of 2X,
  // 6X high (Table 13), timing bar the middle third.
  japan: { moduleBased: true, defaultMils: 24, states: { F: [0, 1], A: [0, 2 / 3], D: [1 / 3, 1], T: [1 / 3, 2 / 3] } },
});

/** POSTNET digit patterns (1 = full bar), weights 7-4-2-1-0. */
const POSTNET = ['11000', '00011', '00101', '00110', '01001', '01010', '01100', '10001', '10010', '10100'];

/**
 * Checks that the text consists of digits.
 * @param {string} name Symbology name.
 * @param {string} text Data.
 * @param {number[]|null} lengths Allowed lengths, or null for any.
 */
function digits(name, text, lengths) {
  if (!/^[0-9]+$/.test(text)) throw new BarcodeDataError(`${name}: data must be numeric`);
  if (lengths && !lengths.includes(text.length)) {
    throw new BarcodeDataError(`${name}: ${text.length} digits, expected ${lengths.join(' or ')}`);
  }
}

/**
 * Builds a POSTNET (modifiers X'00'–X'03') or PLANET (X'04') symbol: frame bar, digits, check
 * digit (sum of all digits plus check is a multiple of 10), frame bar. PLANET inverts the bars.
 * @param {string} text Digits.
 * @param {number} modifier Modifier.
 * @returns {PostalSymbol} Symbol.
 */
export function postnet(text, modifier) {
  const lengths = { 0x00: [5], 0x01: [9], 0x02: [11], 0x03: null, 0x04: [11] };
  if (!(modifier in lengths)) throw new BarcodeDataError(`POSTNET: modifier X'${modifier.toString(16)}' invalid`, 'EC-0B00');
  const planet = modifier === 0x04;
  digits(planet ? 'PLANET' : 'POSTNET', text, lengths[modifier]);
  const sum = [...text].reduce((a, c) => a + Number(c), 0);
  const all = text + String((10 - (sum % 10)) % 10);
  const pattern = [...all].map((c) => POSTNET[Number(c)]).join('');
  const body = [...pattern].map((b) => ((b === '1') !== planet ? 'F' : 'S')).join('');
  return { bars: `F${body}F`, kind: planet ? 'planet' : 'postnet', hri: null };
}

const RM4SCC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Upper (row) and lower (column) halves of an RM4SCC character, value 1–6. */
const RM4SCC_HALVES = ['0011', '0101', '0110', '1001', '1010', '1100'];

/**
 * Bars of one RM4SCC character: its row in the 6×6 character grid selects the ascending parts,
 * its column the descending parts.
 * @param {number} index Character index 0–35.
 * @returns {string} Four bars.
 */
function rm4sccChar(index) {
  const top = RM4SCC_HALVES[Math.floor(index / 6)];
  const bottom = RM4SCC_HALVES[index % 6];
  return [0, 1, 2, 3].map((k) => ({ '00': 'T', 10: 'A', '01': 'D', 11: 'F' })[top[k] + bottom[k]]).join('');
}

/**
 * Builds a Royal Mail RM4SCC (modifier X'00': start bar, check character, stop bar) or Dutch KIX
 * (X'01': data only) symbol.
 * @param {string} text Characters 0–9 and A–Z.
 * @param {number} modifier Modifier.
 * @returns {PostalSymbol} Symbol.
 */
export function rm4scc(text, modifier) {
  if (modifier !== 0x00 && modifier !== 0x01) throw new BarcodeDataError(`RM4SCC: modifier X'${modifier.toString(16)}' invalid`, 'EC-0B00');
  const up = text.toUpperCase();
  if (!up.length || [...up].some((c) => !RM4SCC_CHARS.includes(c))) {
    throw new BarcodeDataError('RM4SCC: data must consist of 0–9 and A–Z');
  }
  const idx = [...up].map((c) => RM4SCC_CHARS.indexOf(c));
  if (modifier === 0x01) return { bars: idx.map(rm4sccChar).join(''), kind: 'kix', hri: null };
  // Check character: row and column sums modulo 6 (a remainder of 0 selects the sixth).
  const row = idx.reduce((a, i) => a + Math.floor(i / 6) + 1, 0) % 6 || 6;
  const col = idx.reduce((a, i) => a + (i % 6) + 1, 0) % 6 || 6;
  const check = (row - 1) * 6 + (col - 1);
  return { bars: `A${[...idx, check].map(rm4sccChar).join('')}F`, kind: 'rm4scc', hri: null };
}

/**
 * Builds the n-of-13 character table of USPS-B-3200 (Appendix: table initialization).
 * @param {number} n Number of 1 bits (5 or 2).
 * @param {number} length Table length (1287 or 78).
 * @returns {number[]} Table.
 */
function nOf13(n, length) {
  const table = new Array(length);
  let lower = 0;
  let upper = length - 1;
  for (let count = 0; count < 8192; count++) {
    let bits = 0;
    for (let v = count; v; v >>= 1) bits += v & 1;
    if (bits !== n) continue;
    let reverse = 0;
    for (let k = 0; k < 13; k++) if (count & (1 << k)) reverse |= 1 << (12 - k);
    if (reverse < count) continue;
    if (reverse === count) table[upper--] = count;
    else { table[lower++] = count; table[lower++] = reverse; }
  }
  return table;
}

let tables = null;

/**
 * Bar-to-character mapping (USPS-B-3200): for each of the 65 bars the character and bit of its
 * descender, then the character and bit of its ascender (characters A–J = 0–9).
 */
const IMB_BARS = [
  [7, 2, 4, 3], [1, 10, 0, 0], [9, 12, 2, 8], [5, 5, 6, 11], [8, 9, 3, 1], [0, 1, 5, 12], [2, 5, 1, 8], [4, 4, 9, 11],
  [6, 3, 8, 10], [3, 9, 7, 6], [5, 11, 1, 4], [8, 5, 2, 12], [9, 10, 0, 2], [7, 1, 6, 7], [3, 6, 4, 9], [0, 3, 8, 6],
  [6, 4, 2, 7], [1, 1, 9, 9], [7, 10, 5, 2], [4, 0, 3, 8], [6, 2, 0, 4], [8, 11, 1, 0], [9, 8, 3, 12], [2, 6, 7, 7],
  [5, 1, 4, 10], [1, 12, 6, 9], [7, 3, 8, 0], [5, 8, 9, 7], [4, 6, 2, 10], [3, 4, 0, 5], [8, 4, 5, 7], [7, 11, 1, 9],
  [6, 0, 9, 6], [0, 6, 4, 8], [2, 1, 3, 2], [5, 9, 8, 12], [4, 11, 6, 1], [9, 5, 7, 4], [3, 3, 1, 2], [0, 7, 2, 0],
  [1, 3, 4, 1], [6, 10, 3, 5], [8, 7, 9, 4], [2, 11, 5, 6], [0, 8, 7, 12], [4, 2, 8, 1], [5, 10, 3, 0], [9, 3, 0, 9],
  [6, 5, 2, 4], [7, 8, 1, 7], [5, 0, 4, 5], [2, 3, 0, 10], [6, 12, 9, 2], [3, 11, 1, 6], [8, 8, 7, 9], [5, 4, 0, 11],
  [1, 5, 2, 2], [9, 1, 4, 12], [8, 3, 6, 6], [7, 0, 3, 7], [4, 7, 7, 5], [0, 12, 1, 11], [2, 9, 9, 0], [6, 8, 5, 3],
  [3, 10, 8, 2],
];

/**
 * CRC-11 frame check sequence over the 102-bit binary data (13 bytes, the two most significant
 * bits of the first byte unused); generator X'F35', initial value X'7FF'.
 * @param {number[]} bytes 13 bytes.
 * @returns {number} FCS.
 */
function crc11(bytes) {
  let fcs = 0x7ff;
  const step = (data, from) => {
    for (let bit = from; bit < 8; bit++) {
      fcs = ((fcs ^ (data << 3)) & 0x400 ? (fcs << 1) ^ 0xf35 : fcs << 1) & 0x7ff;
      data = (data << 1) & 0xff;
    }
  };
  step((bytes[0] << 2) & 0xff, 2);
  for (let i = 1; i < 13; i++) step(bytes[i], 0);
  return fcs;
}

/**
 * Builds an Intelligent Mail Barcode (modifiers X'00'–X'03' for a routing ZIP code of 0, 5, 9 or
 * 11 digits): binary conversion, CRC-11, codewords, characters and the bar mapping of USPS-B-3200.
 * @param {string} text 20, 25, 29 or 31 digits.
 * @param {number} modifier Modifier.
 * @returns {PostalSymbol} Symbol.
 */
export function intelligentMail(text, modifier) {
  const zipLength = [0, 5, 9, 11][modifier];
  if (zipLength === undefined) throw new BarcodeDataError(`Intelligent Mail Barcode: modifier X'${modifier.toString(16)}' invalid`, 'EC-0B00');
  digits('Intelligent Mail Barcode', text, [20 + zipLength]);
  if (Number(text[1]) > 4) throw new BarcodeDataError('Intelligent Mail Barcode: the second digit of the Barcode ID must be 0–4');
  const tracking = text.slice(0, 20);
  const zip = text.slice(20);
  let value = 0n;
  if (zip.length === 5) value = BigInt(zip) + 1n;
  else if (zip.length === 9) value = BigInt(zip) + 100000n + 1n;
  else if (zip.length === 11) value = BigInt(zip) + 1000000000n + 100000n + 1n;
  value = value * 10n + BigInt(tracking[0]);
  value = value * 5n + BigInt(tracking[1]);
  for (const c of tracking.slice(2)) value = value * 10n + BigInt(c);
  const bytes = [];
  for (let i = 12, v = value; i >= 0; i--, v >>= 8n) bytes[i] = Number(v & 0xffn);
  const fcs = crc11(bytes);
  const cw = new Array(10);
  cw[9] = Number(value % 636n);
  value /= 636n;
  for (let i = 8; i >= 1; i--) { cw[i] = Number(value % 1365n); value /= 1365n; }
  cw[0] = Number(value);
  cw[9] *= 2;
  if (fcs & 0x400) cw[0] += 659;
  tables ??= { five: nOf13(5, 1287), two: nOf13(2, 78) };
  const chars = cw.map((c, i) => {
    const ch = c < 1287 ? tables.five[c] : tables.two[c - 1287];
    return fcs & (1 << i) ? ~ch & 0x1fff : ch;
  });
  const bars = IMB_BARS.map(([dc, db, ac, ab]) => {
    const d = (chars[dc] >> db) & 1;
    const a = (chars[ac] >> ab) & 1;
    return d && a ? 'F' : a ? 'A' : d ? 'D' : 'T';
  }).join('');
  // HRI grouped as in the BCOCA example: Barcode ID, Service Type ID, Mailer ID (9 digits if it
  // starts with 9, else 6), serial number, routing ZIP code.
  const mid = tracking[5] === '9' ? 9 : 6;
  const hri = [tracking.slice(0, 2), tracking.slice(2, 5), tracking.slice(5, 5 + mid), tracking.slice(5 + mid), zip].filter(Boolean).join(' ');
  return { bars, kind: 'imb', hri };
}

/**
 * Japan Postal characters (BWIPP): 0–9, hyphen, CC1–CC8, start, stop; 0 = timing bar,
 * 1 = lower half, 2 = upper half, 3 = full bar.
 */
const JAPAN = ['300', '330', '312', '132', '321', '303', '123', '231', '213', '033', '030',
  '120', '102', '210', '012', '201', '021', '003', '333', '31', '13'];
const JAPAN_STATES = { 0: 'T', 1: 'D', 2: 'A', 3: 'F' };
/** Direct input code points (BCOCA Table 15) → character index. */
const JAPAN_DIRECT = new Map([[0x4c, 19], [0x6e, 20], [0x60, 10], [0x5a, 11], [0x7f, 12], [0x7b, 13], [0xe0, 14],
  [0x6c, 15], [0x50, 16], [0x7d, 17], [0x4d, 18], ...Array.from({ length: 10 }, (_, d) => [0xf0 + d, d])]);

/**
 * Builds a Japan Postal Bar Code. Modifier X'00': start, 7-digit postal code (nnn-nnnn or
 * nnnnnnn), 13 address indication digits (letters A–Z take a control code CC1–CC3 plus a digit,
 * the rest is filled with CC4, more than 13 are cut off), check character (sum of all values plus
 * check is a multiple of 19), stop. Modifier X'01': the EBCDIC code points of Table 15 as given.
 * @param {string} text Data as text (modifier X'00').
 * @param {Uint8Array} raw Data bytes (modifier X'01').
 * @param {number} modifier Modifier.
 * @returns {PostalSymbol} Symbol.
 */
export function japanPost(text, raw, modifier) {
  const bars = (values) => values.map((v) => [...JAPAN[v]].map((c) => JAPAN_STATES[c]).join('')).join('');
  if (modifier === 0x01) {
    const values = Array.from(raw, (b) => {
      const v = JAPAN_DIRECT.get(b);
      if (v === undefined) throw new BarcodeDataError(`Japan Postal: code point X'${b.toString(16).toUpperCase()}' is not valid for direct input`);
      return v;
    });
    return { bars: bars(values), kind: 'japan', hri: null };
  }
  if (modifier !== 0x00) throw new BarcodeDataError(`Japan Postal: modifier X'${modifier.toString(16)}' invalid`, 'EC-0B00');
  const m = /^(\d{3})-?(\d{4})-?/.exec(text);
  if (!m) throw new BarcodeDataError('Japan Postal: the data must start with a 7-digit postal code');
  const address = [];
  for (const ch of text.slice(m[0].length)) {
    if (ch >= '0' && ch <= '9') address.push(Number(ch));
    else if (ch === '-') address.push(10);
    else if (ch >= 'A' && ch <= 'Z') {
      const i = ch.charCodeAt(0) - 0x41;
      address.push(11 + Math.floor(i / 10), i % 10);
    } else throw new BarcodeDataError(`Japan Postal: invalid character "${ch}" in the address indication number`);
  }
  const values = [...(m[1] + m[2])].map(Number).concat(address.slice(0, 13));
  while (values.length < 20) values.push(14); // CC4
  const sum = values.reduce((a, v) => a + v, 0);
  values.push((19 - (sum % 19)) % 19);
  return { bars: bars([19, ...values, 20]), kind: 'japan', hri: null };
}

/**
 * Australia Post encodings (BWIPP): table C for A–Z, 0–9, a–z, space, # (index 0–63), then
 * table N for the digits 0–9, start/stop and filler. 0 = full bar, 1 = ascender, 2 = descender,
 * 3 = tracker (the same digits as the proprietary encoding of BCOCA Table 16).
 */
const AUS = ['000', '001', '002', '010', '011', '012', '020', '021', '022', '100', '101', '102', '110', '111', '112', '120',
  '121', '122', '200', '201', '202', '210', '211', '212', '220', '221', '222', '300', '301', '302', '310', '311',
  '312', '320', '321', '322', '023', '030', '031', '032', '033', '103', '113', '123', '130', '131', '132', '133',
  '203', '213', '223', '230', '231', '232', '233', '303', '313', '323', '330', '331', '332', '333', '003', '013'];
const AUS_N = ['00', '01', '02', '10', '11', '12', '20', '21', '22', '30'];
const AUS_C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyz #';
const AUS_STATES = { 0: 'F', 1: 'A', 2: 'D', 3: 'T' };

/** Australia Post modifiers (BCOCA Table 16): format code, bars, customer information encoding and capacity. */
const AUS_FORMATS = {
  0x01: ['11', 37, null, 0], 0x02: ['59', 52, 'N', 8], 0x03: ['59', 52, 'C', 5], 0x04: ['59', 52, 'P', 16],
  0x05: ['62', 67, 'N', 15], 0x06: ['62', 67, 'C', 10], 0x07: ['62', 67, 'P', 31], 0x08: ['45', 37, null, 0],
};

/**
 * Multiplies in GF(64) with the polynomial x^6 + x + 1.
 * @param {number} a Factor.
 * @param {number} b Factor.
 * @returns {number} Product.
 */
function gf64(a, b) {
  let r = 0;
  for (; b; b >>= 1) {
    if (b & 1) r ^= a;
    a <<= 1;
    if (a & 64) a ^= 67;
  }
  return r;
}

/**
 * Builds an Australia Post Bar Code: start bars, format control code and the 8-digit sorting
 * code (DPID) in table N, customer information (table N, table C or bar digits 0–3), filler
 * bars, 4 Reed–Solomon symbols over GF(64) (3 bars each), stop bars.
 * @param {string} text Sorting code followed by the customer information.
 * @param {number} modifier Modifier X'01'–X'08'.
 * @returns {PostalSymbol} Symbol.
 */
export function ausPost(text, modifier) {
  const format = AUS_FORMATS[modifier];
  if (!format) throw new BarcodeDataError(`Australia Post: modifier X'${modifier.toString(16)}' invalid`, 'EC-0B00');
  const [fcc, length, enc, capacity] = format;
  const dpid = text.slice(0, 8);
  const info = text.slice(8);
  if (!/^[0-9]{8}$/.test(dpid)) throw new BarcodeDataError('Australia Post: the data must start with an 8-digit sorting code');
  if (info.length > capacity) throw new BarcodeDataError(`Australia Post: at most ${capacity} customer information characters`);
  let bars = [...fcc + dpid].map((d) => AUS_N[Number(d)]).join('');
  for (const ch of info) {
    if (enc === 'N' && /[0-9]/.test(ch)) bars += AUS_N[Number(ch)];
    else if (enc === 'C' && AUS_C.includes(ch)) bars += AUS[AUS_C.indexOf(ch)];
    else if (enc === 'P' && /[0-3]/.test(ch)) bars += ch;
    else throw new BarcodeDataError(`Australia Post: invalid customer information character "${ch}"`);
  }
  bars = bars.padEnd(length - 16, '3'); // filler bars
  // Reed–Solomon: data symbols are triples of bars (base 4), generator x^4 + 30x^3 + 29x^2 + 17x + 48.
  const symbols = [];
  for (let i = 0; i < bars.length; i += 3) symbols.push(Number.parseInt(bars.slice(i, i + 3), 4));
  const rs = [0, 0, 0, 0, ...symbols.reverse()];
  for (let i = rs.length - 5; i >= 0; i--) {
    const f = rs[i + 4];
    [48, 17, 29, 30, 1].forEach((g, j) => { rs[i + j] ^= gf64(g, f); });
  }
  const check = [3, 2, 1, 0].map((i) => rs[i].toString(4).padStart(3, '0')).join('');
  const all = `13${bars}${check}13`;
  return {
    bars: [...all].map((c) => AUS_STATES[c]).join(''),
    kind: 'auspost',
    hri: [fcc, dpid, info].filter(Boolean).join(' '),
    hriAbove: true,
  };
}

/*
 * Royal Mail Mailmark 4-state bar codes C and L (task T290). Royal Mail publishes the encoding
 * only in its separate encoder documents; this follows Zint's backend/mailmark.c ("Royal Mail
 * Mailmark barcode C/L encoding and decoding instructions", Sept 2015):
 *
 *   Copyright (C) 2008-2025 Robin Stuart <rstuart114@gmail.com>
 *
 *   Redistribution and use in source and binary forms, with or without modification, are
 *   permitted provided that the following conditions are met:
 *   1. Redistributions of source code must retain the above copyright notice, this list of
 *      conditions and the following disclaimer.
 *   2. Redistributions in binary form must reproduce the above copyright notice, this list of
 *      conditions and the following disclaimer in the documentation and/or other materials
 *      provided with the distribution.
 *   3. Neither the name of the project nor the names of its contributors may be used to endorse
 *      or promote products derived from this software without specific prior written
 *      permission.
 *
 *   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS
 *   OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
 *   MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
 *   COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 *   EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 *   SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 *   HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
 *   TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 *   SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

/** Postcode formats (A letter, L limited letter, N digit, S space). */
const MAILMARK_POSTCODES = ['ANANLLNLS', 'AANNLLNLS', 'AANNNLLNL', 'AANANLLNL', 'ANNLLNLSS', 'ANNNLLNLS'];
const MAILMARK_SETS = { A: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', L: 'ABDEFGHJLNPQRSTUWXYZ', N: '0123456789', S: ' ' };
/** Data and check symbols (odd and even 6-bit patterns). */
const MAILMARK_ODD = [0x01, 0x02, 0x04, 0x07, 0x08, 0x0b, 0x0d, 0x0e, 0x10, 0x13, 0x15, 0x16, 0x19, 0x1a, 0x1c, 0x1f,
  0x20, 0x23, 0x25, 0x26, 0x29, 0x2a, 0x2c, 0x2f, 0x31, 0x32, 0x34, 0x37, 0x38, 0x3b, 0x3d, 0x3e];
const MAILMARK_EVEN = [0x03, 0x05, 0x06, 0x09, 0x0a, 0x0c, 0x0f, 0x11, 0x12, 0x14, 0x17, 0x18, 0x1b, 0x1d, 0x1e, 0x21,
  0x22, 0x24, 0x27, 0x28, 0x2b, 0x2d, 0x2e, 0x30, 0x33, 0x35, 0x36, 0x39, 0x3a, 0x3c];
/** Extender group order for barcode C (22 symbols) and L (26 symbols). */
const MAILMARK_EXTENDER = {
  22: [3, 5, 7, 11, 13, 14, 16, 17, 19, 0, 1, 2, 4, 6, 8, 9, 10, 12, 15, 18, 20, 21],
  26: [2, 5, 7, 8, 13, 14, 15, 16, 21, 22, 23, 0, 1, 3, 4, 6, 9, 10, 11, 12, 17, 18, 19, 20, 24, 25],
};

/**
 * Value of the destination postcode plus DPS field (9 characters).
 * @param {string} pc Postcode.
 * @returns {bigint} Value (0 for the international designation "XY11").
 */
function mailmarkPostcode(pc) {
  if (pc.startsWith('XY11') && pc.slice(4).trim() === '') return 0n;
  let type;
  if (pc[7] === ' ') type = 5;
  else if (pc[8] === ' ') type = /[0-9]/.test(pc[1]) ? (/[0-9]/.test(pc[2]) ? 6 : 1) : 2;
  else type = /[0-9]/.test(pc[3]) ? 3 : 4;
  const pattern = MAILMARK_POSTCODES[type - 1];
  let v = 0n;
  for (let i = 0; i < 9; i++) {
    const set = MAILMARK_SETS[pattern[i]];
    const k = set.indexOf(pc[i]);
    if (k < 0) throw new BarcodeDataError(`Royal Mail Mailmark: invalid postcode "${pc}"`, 'EC-1204');
    if (pattern[i] !== 'S') v = v * BigInt(set.length) + BigInt(k);
  }
  // Offsets of the postcode types 1–6.
  const base = [1n, 5408000001n, 10816000001n, 64896000001n, 205504000001n, 205712000001n];
  return v + base[type - 1];
}

/**
 * Builds a 4-state Royal Mail Mailmark symbol: Barcode C (modifier X'00', 22 characters, 66
 * bars) or Barcode L (X'01', 26 characters, 78 bars). The data is format (0–4), version ID
 * (1–4), class (0–9, A–E), supply chain ID (2 or 6 digits), item ID (8 digits) and destination
 * postcode plus DPS (9 characters); shorter data is padded with spaces.
 * @param {string} text Data.
 * @param {number} modifier Modifier.
 * @returns {PostalSymbol} Symbol.
 */
export function mailmark(text, modifier) {
  if (modifier !== 0x00 && modifier !== 0x01) throw new BarcodeDataError(`Royal Mail Mailmark: modifier X'${modifier.toString(16)}' invalid`, 'EC-0B00');
  const length = modifier === 0x00 ? 22 : 26;
  if (text.length > length || text.length < length - 8) {
    throw new BarcodeDataError(`Royal Mail Mailmark: ${text.length} characters, expected ${length}`, 'EC-1204');
  }
  const s = text.toUpperCase().padEnd(length, ' ');
  if (!/^[0-9A-Z ]+$/.test(s)) throw new BarcodeDataError('Royal Mail Mailmark: data must consist of 0–9, A–Z and space', 'EC-1204');
  const num = (str, what) => {
    if (!/^[0-9]+$/.test(str)) throw new BarcodeDataError(`Royal Mail Mailmark: invalid ${what} "${str}"`, 'EC-1204');
    return BigInt(str);
  };
  const format = '01234'.indexOf(s[0]);
  const version = '1234'.indexOf(s[1]);
  const mailClass = '0123456789ABCDE'.indexOf(s[2]);
  if (format < 0 || version < 0 || mailClass < 0) throw new BarcodeDataError('Royal Mail Mailmark: invalid format, version ID or class', 'EC-1204');
  const supplyChain = num(s.slice(3, length - 17), 'supply chain ID');
  const item = num(s.slice(length - 17, length - 9), 'item ID');
  let cdv = mailmarkPostcode(s.slice(length - 9));
  cdv = cdv * 100000000n + item;
  cdv = cdv * (length === 22 ? 100n : 1000000n) + supplyChain;
  cdv = ((cdv * 15n + BigInt(mailClass)) * 5n + BigInt(format)) * 4n + BigInt(version);
  const [top, step, checks] = length === 22 ? [15, 8, 6] : [18, 10, 7];
  const data = new Array(top + 1);
  for (let j = top; j > step; j--) { data[j] = Number(cdv % 32n); cdv /= 32n; }
  for (let j = step; j >= 0; j--) { data[j] = Number(cdv % 30n); cdv /= 30n; }
  if (cdv > 0n) throw new BarcodeDataError('Royal Mail Mailmark: data out of range', 'EC-1204');
  const symbols = [...data, ...rsEncode(data, checks, MAILMARK_RS)]
    .map((v, i) => (i <= step ? MAILMARK_EVEN[v] : MAILMARK_ODD[v]));
  const extender = new Array(length);
  symbols.forEach((v, i) => { extender[MAILMARK_EXTENDER[length][i]] = v; });
  let bars = '';
  extender.forEach((e, i) => {
    for (let j = 0; j < 3; j++) {
      const v = (e << j) & 0x24;
      bars += v === 0x24 ? 'F' : v === 0x20 ? (i % 2 ? 'D' : 'A') : v === 0x04 ? (i % 2 ? 'A' : 'D') : 'T';
    }
  });
  return { bars, kind: 'mailmark', hri: null };
}
