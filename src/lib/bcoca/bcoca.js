/**
 * BCOCA bar code objects (FR-011, task T070): reads the Bar Code Symbol Descriptor and the Bar
 * Code Symbol Data, builds each symbol with its symbology module and turns it into page items
 * (filled bar rectangles and HRI text).
 *
 * Spec references (BCOCA Reference, AFPC-0005-10):
 * - Appendix B "MO:DCA Environment": Begin Bar Code Object (X'D3A8EB'), Bar Code Data Descriptor
 *   BDD (X'D3A6EB', the BSD followed by an optional Color Specification X'4E' triplet that
 *   overrides the BSD color), one Bar Code Data BDA (X'D3EEEB', the BSA) per symbol.
 * - Table 8 "Bar Code Symbol Descriptor (BSD)": unit base, XUPUB/YUPUB, presentation space
 *   extents, desired symbol width, type, modifier, HRI font local id, color, module width (mils),
 *   element height (L-units), height multiplier, WE:NE.
 * - Table 20 "Bar Code Symbol Data (BSA)": flags (bit 0 no HRI, bits 1–2 HRI position, bit 3
 *   Code 39 asterisks, bit 5 suppress symbol), X/Y offset of the symbol origin (top-left corner
 *   of the smallest rectangle around the bars), special functions (2D types and Intelligent Mail
 *   Package Barcode), data.
 * - Table 13 "Recommended Default Values"; Table 7 HRI guidelines (centered, one module from the
 *   bars); Table 34 code pages (500 for most linear types, 893 for UPC/EAN, 1303 for Code 128).
 *
 * - Table 23 "Data Matrix Special-Function Parameters" and Table 31 "QR Code Special-Function
 *   Parameters" (BSA bytes 5–14 and 5–13); the data starts in the default encodation (ISO 8859-1
 *   for Data Matrix, ECI 000020 for QR Code), X'5C' starts an ECI escape sequence unless escape
 *   handling is switched off, and the EBCDIC flag converts code page 500 (QR Code: also 290 and
 *   1027) first.
 *
 * Bar code types without a symbology module are shown as a placeholder with a diagnostic.
 */

import { collectFields } from '../modca/access.js';
import { u, triplets, toPageUnits } from '../modca/bytes.js';
import { registerObjectRenderer, readObjectArea, objectRendererFor } from '../render/page-renderer.js';
import { readCommonTriplets } from '../modca/structures.js';
import { placeItems } from '../render/transform.js';
import { extendedColor, NAMED_COLORS } from '../ptoca/ptoca.js';
import { loadCodePage, decode } from '../codepages/index.js';
import {
  BarcodeDataError, code39, msi, retail, interleaved2of5, code2of5, codabar, code93, code128, FNC1, FNC2, FNC3, FNC4,
} from './symbologies/linear.js';
import { qrCode } from './symbologies/qrcode.js';
import { dataMatrix } from './symbologies/datamatrix.js';
import { pdf417, pdf417Tokens, macroControlBlock } from './symbologies/pdf417.js';
import { aztec, AZTEC_FNC1 } from './symbologies/aztec.js';
import { specTable, shortNames } from '../spec-table.js';
import { maxiCode } from './symbologies/maxicode.js';
import { dataBar } from './symbologies/databar.js';
import { hanXin } from './symbologies/hanxin.js';
import { postnet, rm4scc, intelligentMail, japanPost, ausPost, mailmark, POSTAL_GEOMETRY } from './symbologies/postal.js';

const BBC = 0xd3a8eb;
const BDD = 0xd3a6eb;
const BDA = 0xd3eeeb;
const MDR = 0xd3abc3;

/** Bar code types (BCOCA Reference AFPC-0005-11, Table 9 "Bar Code Types"). */
export const BARCODE_TYPE_TABLE = specTable('BCOCA Reference (AFPC-0005-11)', 'Table 9 "Bar Code Types"', [
  [0x01, '', 'Code 39'],
  [0x02, '', 'MSI'],
  [0x03, '', 'UPC-A'],
  [0x05, '', 'UPC-E'],
  [0x06, '', 'UPC two-digit supplemental'],
  [0x07, '', 'UPC five-digit supplemental'],
  [0x08, '', 'EAN-8'],
  [0x09, '', 'EAN-13'],
  [0x0a, '', 'Industrial 2-of-5'],
  [0x0b, '', 'Matrix 2-of-5'],
  [0x0c, '', 'Interleaved 2-of-5'],
  [0x0d, '', 'Codabar'],
  [0x11, '', 'Code 128'],
  [0x16, '', 'EAN two-digit supplemental'],
  [0x17, '', 'EAN five-digit supplemental'],
  [0x18, '', 'POSTNET/PLANET'],
  [0x1a, '', 'RM4SCC/Dutch KIX'],
  [0x1b, '', 'Japan Postal'],
  [0x1c, '', 'Data Matrix'],
  [0x1d, '', 'MaxiCode'],
  [0x1e, '', 'PDF417'],
  [0x1f, '', 'Australia Post'],
  [0x20, '', 'QR Code'],
  [0x21, '', 'Code 93'],
  [0x22, '', 'Intelligent Mail Barcode'],
  [0x23, '', 'Royal Mail RED TAG'],
  [0x24, '', 'GS1 DataBar'],
  [0x25, '', 'Royal Mail Mailmark'],
  [0x26, '', 'Aztec Code'],
  [0x27, '', 'Han Xin Code'],
]);
/** Bar code type → name. */
export const BARCODE_TYPES = shortNames(BARCODE_TYPE_TABLE);

/** Retail types (UPC/EAN): HRI layout and heights from the GS1 specification. */
const RETAIL = new Set([0x03, 0x05, 0x06, 0x07, 0x08, 0x09, 0x16, 0x17]);

/**
 * Code page 1303 (Code 128, BCOCA Figure 18) → ASCII code or FNC marker. Printable characters
 * and controls are placed as in EBCDIC; FNC1–FNC4 are at X'8F', X'EA', X'FA', X'BE'.
 */
const CP1303 = (() => {
  const m = new Map();
  const set = (code, ch) => m.set(code, typeof ch === 'number' ? ch : ch.charCodeAt(0));
  const controls = {
    0x00: 0, 0x01: 1, 0x02: 2, 0x03: 3, 0x37: 4, 0x2d: 5, 0x2e: 6, 0x2f: 7, 0x16: 8, 0x05: 9, 0x25: 10, 0x0b: 11, 0x0c: 12,
    0x0d: 13, 0x0e: 14, 0x0f: 15, 0x10: 16, 0x11: 17, 0x12: 18, 0x13: 19, 0x3c: 20, 0x3d: 21, 0x32: 22, 0x26: 23, 0x18: 24,
    0x19: 25, 0x3f: 26, 0x27: 27, 0x22: 28, 0x1d: 29, 0x1e: 30, 0x1f: 31, 0xff: 127,
  };
  for (const [k, v] of Object.entries(controls)) set(Number(k), v);
  const printable = {
    0x40: ' ', 0x5a: '!', 0x7f: '"', 0x7b: '#', 0x5b: '$', 0x6c: '%', 0x50: '&', 0x7d: "'", 0x4d: '(', 0x5d: ')', 0x5c: '*',
    0x4e: '+', 0x6b: ',', 0x60: '-', 0x4b: '.', 0x61: '/', 0x7a: ':', 0x5e: ';', 0x4c: '<', 0x7e: '=', 0x6e: '>', 0x6f: '?',
    0x7c: '@', 0xba: '[', 0xe0: '\\', 0xbb: ']', 0xb0: '^', 0x6d: '_', 0x79: '`', 0xc0: '{', 0x4f: '|', 0xd0: '}', 0xa1: '~',
  };
  for (const [k, v] of Object.entries(printable)) set(Number(k), v);
  '0123456789'.split('').forEach((c, i) => set(0xf0 + i, c));
  const letters = (start, chars) => chars.split('').forEach((c, i) => set(start + i, c));
  letters(0xc1, 'ABCDEFGHI'); letters(0xd1, 'JKLMNOPQR'); letters(0xe2, 'STUVWXYZ');
  letters(0x81, 'abcdefghi'); letters(0x91, 'jklmnopqr'); letters(0xa2, 'stuvwxyz');
  m.set(0x8f, FNC1); m.set(0xea, FNC2); m.set(0xfa, FNC3); m.set(0xbe, FNC4);
  return m;
})();

/**
 * @typedef {object} BarcodeDescriptor
 * @property {number} unit Page units per L-unit.
 * @property {number} type Bar code type.
 * @property {number} modifier Modifier.
 * @property {string} color Color of bars and HRI.
 * @property {number|null} moduleMils Module width in mils, or null for the default.
 * @property {number|null} height Total bar height in page units, or null for the default.
 * @property {number|null} ratio WE:NE ratio, or null for the default.
 * @property {number} desiredWidth Desired symbol width in page units (0 = not specified).
 */

/**
 * Reads the WE:NE value: a decimal number whose point follows the first significant digit
 * (BSD bytes 21–22; X'00E1' = 2.25, X'0834' = 2.1).
 * @param {number} v Field value.
 * @returns {number|null} Ratio, or null for "default" or "not used".
 */
export function wideToNarrow(v) {
  if (v === 0 || v === 0xffff) return null;
  const s = String(v);
  return Number(`${s[0]}.${s.slice(1) || '0'}`);
}

/**
 * Reads the BDD (BSD and optional Color Specification triplet).
 * @param {Uint8Array} d BDD data.
 * @returns {BarcodeDescriptor} Descriptor.
 */
export function readBsd(d) {
  const unit = toPageUnits(d[0], u(d, 2, 2));
  const colorValue = u(d, 15, 2);
  let color = [0x0000, 0xff00, 0xff07, 0xffff].includes(colorValue) ? '#000000' : (NAMED_COLORS[colorValue] ?? '#000000');
  for (const t of triplets(d, 23)) {
    if (t.id === 0x4e) color = extendedColor(t.body) ?? color;
  }
  const elementHeight = u(d, 18, 2);
  return {
    unit,
    type: d[12],
    modifier: d[13],
    color,
    moduleMils: d[17] === 0xff || d[17] === 0 ? null : d[17],
    // Default element height (X'FFFF') ignores the multiplier (BSD byte 20).
    height: elementHeight === 0xffff ? null : elementHeight * unit * (d[20] || 1),
    ratio: wideToNarrow(u(d, 21, 2)),
    desiredWidth: u(d, 10, 2) * unit,
  };
}

/**
 * Recommended default module width in mils (BCOCA Table 13).
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @returns {number} Mils.
 */
function defaultModuleMils(bsd) {
  if (bsd.type === 0x11 && bsd.modifier === 0x05) return 25;
  if (bsd.type === 0x11 && bsd.modifier === 0x06) return 16;
  return 13;
}

/**
 * Recommended default total bar height in page units (BCOCA Table 13).
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @param {number} symbolWidth Symbol width in page units.
 * @returns {number} Height.
 */
function defaultHeight(bsd, symbolWidth) {
  const mils = (m) => m * 1.44;
  switch (bsd.type) {
    case 0x03: case 0x05: case 0x09: return mils(1020);
    case 0x08: return mils(840);
    case 0x06: case 0x07: return bsd.modifier === 0 ? mils(770) : mils(1020);
    case 0x16: case 0x17: return bsd.modifier === 0 ? mils(840) : mils(1020);
    case 0x02: return Math.max(mils(300), symbolWidth * 0.15);
    case 0x11:
      if (bsd.modifier === 0x05) return mils(925);
      if (bsd.modifier === 0x06) return mils(750);
      return Math.max(mils(250), symbolWidth * 0.15);
    default: return Math.max(mils(250), symbolWidth * 0.15);
  }
}

/**
 * Reads one BSA: flags, offsets, special functions (skipped by type) and data.
 * @param {Uint8Array} d BDA data.
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @returns {{noHri: boolean, position: number, asterisks: boolean, suppress: boolean, x: number,
 *   y: number, data: Uint8Array}} Symbol data (offsets in L-units).
 */
export function readBsa(d, bsd) {
  let dataAt = 5;
  if (bsd.type === 0x11 && bsd.modifier === 0x06) dataAt = 9 + (d[8] ?? 0); // IMpb banner (Table 28)
  if (bsd.type === 0x1c) dataAt = 15; // Data Matrix (Table 23)
  if (bsd.type === 0x20) dataAt = bsd.modifier === 0x12 ? 17 + u(d, 15, 2) : 14; // QR Code (Table 31), with Image (Table 33)
  if (bsd.type === 0x1e) dataAt = 11 + u(d, 9, 2); // PDF417 with Macro PDF417 Control Block (Table 30)
  if (bsd.type === 0x1d) dataAt = 10; // MaxiCode (Table 29)
  if (bsd.type === 0x27) dataAt = 12 + (d[11] ?? 0); // Han Xin Code (Table 26) with additional parameters
  if (bsd.type === 0x26) { // Aztec Code (Table 21): structured append ID and additional parameters
    const idLength = d[13] ?? 0;
    dataAt = 15 + idLength + (d[14 + idLength] ?? 0);
  }
  return {
    noHri: (d[0] & 0x80) !== 0,
    position: (d[0] >> 5) & 0x03,
    asterisks: (d[0] & 0x10) !== 0,
    suppress: (d[0] & 0x04) !== 0,
    x: u(d, 1, 2),
    y: u(d, 3, 2),
    special: d.subarray(5, dataAt),
    data: d.subarray(dataAt),
  };
}

/**
 * Splits bar code data at ECI escape sequences: X'5C' followed by six digits switches the ECI,
 * X'5C' X'5C' stands for one X'5C'.
 * @param {Uint8Array} bytes Data.
 * @param {boolean} escapes Process escape sequences.
 * @returns {{eci: number|null, bytes: Uint8Array}[]} Segments.
 */
export function eciSegments(bytes, escapes) {
  if (!escapes) return [{ eci: null, bytes }];
  const segs = [{ eci: null, bytes: [] }];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== 0x5c) { segs[segs.length - 1].bytes.push(b); continue; }
    if (bytes[i + 1] === 0x5c) { segs[segs.length - 1].bytes.push(0x5c); i++; continue; }
    const digits = [...bytes.subarray(i + 1, i + 7)];
    if (digits.length < 6 || digits.some((x) => x < 0x30 || x > 0x39)) {
      throw new BarcodeDataError("escape character X'5C' is not followed by six digits or another X'5C'");
    }
    segs.push({ eci: Number(String.fromCharCode(...digits)), bytes: [] });
    i += 6;
  }
  if (segs.length > 1 && !segs[0].bytes.length) segs.shift();
  return segs.map((x) => ({ eci: x.eci, bytes: Uint8Array.from(x.bytes) }));
}

/**
 * Converts Unicode text to the single-byte part of ECI 000020 (JIS X 0201, code page 897);
 * characters outside it become the substitute X'7F'.
 * @param {string} text Text.
 * @returns {Uint8Array} Bytes.
 */
function toJisRoman(text) {
  return Uint8Array.from([...text], (ch) => {
    const c = ch.codePointAt(0);
    if (ch === '¥') return 0x5c;
    if (ch === '‾') return 0x7e;
    if (c >= 0xff61 && c <= 0xff9f) return c - 0xff61 + 0xa1;
    if (c < 0x80 && c !== 0x5c && c !== 0x7e) return c;
    return 0x7f;
  });
}

/**
 * Code page 437 (PDF417 GLI 0) from X'80' on; X'00'–X'7F' are ASCII.
 */
const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0';

/**
 * Converts code page 500 data to GLI 0 (code page 437); the 75 EBCDIC code points without an
 * equivalent become X'7F' (BCOCA Table 30, byte 5 bit 0).
 * @param {Uint8Array} data EBCDIC data.
 * @returns {Uint8Array} GLI 0 data.
 */
function ebcdicToGli0(data) {
  return Uint8Array.from(decode('ebcdic-500', data), (ch) => {
    const c = ch.codePointAt(0);
    if (c < 0x80) return c;
    const i = CP437_HIGH.indexOf(ch);
    return i >= 0 ? 0x80 + i : 0x7f;
  });
}

/**
 * Converts code page 500 data to ISO 8859-1 (code page 819).
 * @param {Uint8Array} data EBCDIC data.
 * @returns {Uint8Array} Latin-1 data.
 */
const ebcdicToLatin1 = (data) => Uint8Array.from(decode('ebcdic-500', data), (ch) => ch.charCodeAt(0) & 0xff);

/**
 * Turns ECI segments into a token list (bytes and ECI markers).
 * @param {{eci: number|null, bytes: Uint8Array}[]} segments Segments.
 * @returns {(number|{eci: number})[]} Tokens.
 */
const eciTokens = (segments) => segments.flatMap((sg) => [...(sg.eci != null ? [{ eci: sg.eci }] : []), ...sg.bytes]);

/**
 * Builds an Aztec Code symbol from the BSA (Table 21).
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @param {{special: Uint8Array, data: Uint8Array}} bsa Symbol data.
 * @returns {import('./symbologies/qrcode.js').MatrixSymbol} Symbol.
 */
function buildAztec(bsd, bsa) {
  const format = ['full', 'compact', 'rune', 'any'][bsd.modifier];
  if (!format) throw new BarcodeDataError(`Aztec Code: modifier X'${bsd.modifier.toString(16)}' invalid`, 'EC-0B00');
  const sp = bsa.special;
  const flags = sp[0] ?? 0;
  const sf = sp[4] ?? 0;
  const ebcdic = (flags & 0x80) !== 0;
  const data = ebcdic ? ebcdicToLatin1(bsa.data) : bsa.data;
  if (format === 'rune') return aztec([...data], { format });
  const layers = sp[2] ?? 0xff;
  const ec = sp[3] ?? 0xff;
  if (ec !== 0xff && (ec < 5 || ec > 95)) throw new BarcodeDataError(`Aztec Code: invalid error correction level ${ec}`, 'EC-0F19');
  if (layers !== 0xff && (layers > 32 || format === 'any')) throw new BarcodeDataError(`Aztec Code: invalid number of layers ${layers}`, 'EC-0F18');
  if ((sf & 0xc0) === 0xc0) throw new BarcodeDataError('Aztec Code: both FNC1 flags are set', 'EC-0F1A');
  let tokens = eciTokens(eciSegments(data, !(flags & 0x40)));
  if (sf & 0x80) tokens = [AZTEC_FNC1, ...tokens.map((t) => (t === 0x1d ? AZTEC_FNC1 : t))];
  if (sf & 0x40) {
    // Industry FNC1: the application indicator (letter + 100 or two digits) followed by FNC1.
    const ai = sp[5] ?? 0;
    const head = ai >= 100 ? [ai - 100] : [...String(ai).padStart(2, '0')].map((c) => c.charCodeAt(0));
    tokens = [...head, AZTEC_FNC1, ...tokens];
  }
  const sa = structuredAppend(sp[6] ?? 0, sp[7] ?? 0);
  if (sa && sa.total > 26) throw new BarcodeDataError(`invalid number of structured append symbols ${sa.total}`, 'EC-0F04');
  const idLength = sp[8] ?? 0;
  const id = [...(ebcdic ? ebcdicToLatin1(sp.subarray(9, 9 + idLength)) : sp.subarray(9, 9 + idLength))];
  return aztec(tokens, {
    format,
    layers: layers === 0xff ? 0 : layers,
    ecPercent: ec === 0xff ? 23 : ec,
    strict: (flags & 0x20) !== 0,
    readerInit: (sf & 0x20) !== 0,
    structured: sa && { ...sa, id },
  });
}

/**
 * Builds a Han Xin Code symbol from the BSA (Table 26).
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @param {{special: Uint8Array, data: Uint8Array}} bsa Symbol data.
 * @returns {import('./symbologies/qrcode.js').MatrixSymbol|null} Symbol, or null for the GS1 and
 *   industry FNC1 data types, which are not supported.
 */
function buildHanXin(bsd, bsa) {
  if (bsd.modifier !== 0x00) throw new BarcodeDataError(`Han Xin Code: modifier X'${bsd.modifier.toString(16)}' invalid`, 'EC-0B00');
  const sp = bsa.special;
  const flags = sp[0] ?? 0;
  const sf = sp[4] ?? 0;
  if ((sf & 0xc0) === 0xc0) throw new BarcodeDataError('Han Xin Code: both FNC1 flags are set', 'EC-0F24');
  if (sf & 0xc0) return null;
  const data = flags & 0x80 ? ebcdicToLatin1(bsa.data) : bsa.data;
  return hanXin(eciSegments(data, !(flags & 0x40)), { version: sp[2] ?? 0, level: sp[3] ?? 1, strict: (flags & 0x20) !== 0 });
}

/**
 * Builds a MaxiCode symbol from the BSA (Table 29).
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @param {{special: Uint8Array, data: Uint8Array}} bsa Symbol data.
 * @returns {object} Symbol (hexagonal matrix).
 */
function buildMaxiCode(bsd, bsa) {
  if (bsd.modifier !== 0x00) throw new BarcodeDataError(`MaxiCode: modifier X'${bsd.modifier.toString(16)}' invalid`, 'EC-0B00');
  const sp = bsa.special;
  const flags = sp[0] ?? 0;
  const data = flags & 0x80 ? ebcdicToLatin1(bsa.data) : bsa.data;
  const sa = structuredAppend(sp[2] ?? 0, sp[3] ?? 0);
  if (sa && sa.total > 8) throw new BarcodeDataError(`invalid number of structured append symbols ${sa.total}`, 'EC-0F04');
  return maxiCode(eciTokens(eciSegments(data, !(flags & 0x40))), { mode: sp[1] ?? 4, structured: sa });
}

/**
 * Builds a PDF417 symbol from the BSA (Table 30).
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @param {{special: Uint8Array, data: Uint8Array}} bsa Symbol data.
 * @returns {import('./symbologies/qrcode.js').MatrixSymbol} Symbol.
 */
function buildPdf417(bsd, bsa) {
  if (bsd.modifier > 0x01) throw new BarcodeDataError(`PDF417: modifier X'${bsd.modifier.toString(16)}' invalid`, 'EC-0B00');
  const sp = bsa.special;
  const flags = sp[0] ?? 0;
  const convert = (bytes) => (flags & 0x80 ? ebcdicToGli0(bytes) : bytes);
  const macroLength = u(sp, 4, 2);
  if (macroLength > 0x7fed) throw new BarcodeDataError(`PDF417: invalid Macro PDF417 Control Block length ${macroLength}`, 'EC-0F0C');
  const macro = macroLength ? macroControlBlock(convert(sp.subarray(6, 6 + macroLength))) : [];
  return pdf417(pdf417Tokens(convert(bsa.data), !(flags & 0x40)), {
    cols: sp[1] ?? 0, rows: sp[2] ?? 0xff, level: sp[3] ?? 0, truncated: bsd.modifier === 0x01, macro,
  });
}

/** EBCDIC code pages for the QR Code conversion byte (single-byte parts of 1390 and 1399). */
const QR_CONVERSION = { 0x01: 'ebcdic-500', 0x02: 'ebcdic-1390', 0x03: 'ebcdic-1399' };

/**
 * Reads the structured append values shared by Data Matrix and QR Code.
 * @param {number} index Sequence indicator.
 * @param {number} total Total symbols.
 * @returns {{index: number, total: number}|null} Values, or null if not structured append.
 */
function structuredAppend(index, total) {
  if (!index && !total) return null;
  if (!index || !total) throw new BarcodeDataError('structured append needs both sequence indicator and total', 'EC-0F03');
  if (total < 2 || total > 16) throw new BarcodeDataError(`invalid number of structured append symbols ${total}`, 'EC-0F04');
  if (index > total) throw new BarcodeDataError(`sequence indicator ${index} is larger than the total ${total}`, 'EC-0F02');
  return { index, total };
}

/**
 * Builds a Data Matrix symbol from the BSA (Table 23).
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @param {{special: Uint8Array, data: Uint8Array}} bsa Symbol data.
 * @returns {import('./symbologies/qrcode.js').MatrixSymbol} Symbol.
 */
function buildDataMatrix(bsd, bsa) {
  if (bsd.modifier > 0x01) throw new BarcodeDataError(`Data Matrix: modifier X'${bsd.modifier.toString(16)}' invalid`, 'EC-0B00');
  const sp = bsa.special;
  const flags = sp[0] ?? 0;
  const sf = sp[9] ?? 0;
  const data = flags & 0x80 ? Uint8Array.from(decode('ebcdic-500', bsa.data), (ch) => ch.charCodeAt(0) & 0xff) : bsa.data;
  const sa = structuredAppend(sp[5] ?? 0, sp[6] ?? 0);
  const macro = (sf >> 3) & 0x03;
  return dataMatrix(eciSegments(data, !(flags & 0x40)), {
    cols: u(sp, 1, 2),
    rows: u(sp, 3, 2),
    dmre: bsd.modifier === 0x01,
    strict: (flags & 0x20) !== 0,
    structured: sa && { ...sa, fileId: u(sp, 7, 2) },
    fnc1: sf & 0x80 ? 'gs1' : sf & 0x40 ? 'industry' : null,
    readerProgramming: (sf & 0x20) !== 0,
    macro: macro === 1 ? 5 : macro === 2 ? 6 : null,
    scheme: sf & 0x07,
  });
}

/**
 * Builds a QR Code symbol from the BSA (Table 31).
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @param {{special: Uint8Array, data: Uint8Array}} bsa Symbol data.
 * @returns {import('./symbologies/qrcode.js').MatrixSymbol} Symbol; for QR Code with Image
 *   (modifier X'12') with `images` (Image Information Blocks), `imagesFirst` and `onlyImages`.
 */
function buildQrCode(bsd, bsa) {
  if (bsd.modifier !== 0x02 && bsd.modifier !== 0x12) throw new BarcodeDataError(`QR Code: modifier X'${bsd.modifier.toString(16)}' invalid`, 'EC-0B00');
  const sp = bsa.special;
  const flags = sp[0] ?? 0;
  const sf = sp[7] ?? 0;
  let data = bsa.data;
  if (flags & 0x80 && sp[1]) {
    const cp = QR_CONVERSION[sp[1]];
    if (!cp) throw new BarcodeDataError(`QR Code: conversion X'${sp[1].toString(16)}' is not valid in a BCOCA object`, 'EC-0F0E');
    data = toJisRoman(decode(cp, data));
  }
  if ((sf & 0xc0) === 0xc0) throw new BarcodeDataError('QR Code: both FNC1 flags are set', 'EC-0F11');
  const sa = structuredAppend(sp[4] ?? 0, sp[5] ?? 0);
  const sym = qrCode(eciSegments(data, !(flags & 0x40)), {
    version: sp[2] ?? 0,
    level: sp[3] ?? 0,
    strict: (flags & 0x20) !== 0,
    structured: sa && { ...sa, parity: sp[6] ?? 0 },
    fnc1: sf & 0x80 ? 'gs1' : sf & 0x40 ? 'industry' : null,
    appIndicator: sp[8] ?? 0,
  });
  if (bsd.modifier !== 0x12) return sym;
  const qf = sp[9] ?? 0;
  return { ...sym, images: readImageBlocks(sp.subarray(12, 12 + u(sp, 10, 2))), imagesFirst: (qf & 0x80) !== 0, onlyImages: (qf & 0x40) !== 0 };
}

/**
 * @typedef {object} QrImageBlock
 * @property {number} localId Image local ID (mapped by an MDR in the bar code object's OEG).
 * @property {{base: number, upub: number, x: number, y: number}} offset Image object area origin in
 *   the Xqr,Yqr system (unit base X'00' ten inches, X'01' ten centimeters, X'64' one percent of LRqr).
 * @property {number} orientation Clockwise turn of the image object area in degrees.
 * @property {{base: number, upub: number, x: number, y: number}} extent Image object area size.
 * @property {number} mapping BCOCA mapping option (X'10', X'20', X'30', X'60').
 */

/**
 * Reads the Image Information Blocks of a QR Code with Image (Table 33, bytes 15–n).
 * @param {Uint8Array} d Repeating groups.
 * @returns {QrImageBlock[]} Blocks.
 */
function readImageBlocks(d) {
  if (d.length && d.length < 0x17) throw new BarcodeDataError(`QR Code with Image: invalid repeating group length ${d.length}`, 'EC-0F3B');
  const blocks = [];
  for (let p = 0; p < d.length;) {
    const len = d[p];
    if (len < 0x16 || p + 1 + len > d.length) throw new BarcodeDataError(`QR Code with Image: invalid image information length ${len}`, 'EC-0F30');
    const b = d.subarray(p + 1, p + 1 + len);
    const s16 = (o) => { const v = u(b, o, 2); return v & 0x8000 ? v - 0x10000 : v; };
    const turn = u(b, 11, 2);
    const degrees = turn >> 7;
    const minutes = (turn >> 1) & 0x3f;
    if (degrees > 359 || minutes > 59) throw new BarcodeDataError('QR Code with Image: invalid image object area orientation', 'EC-0F35');
    if (b[13] !== 0xf0) throw new BarcodeDataError('QR Code with Image: invalid reference coordinate system', 'EC-0F36');
    for (const [base, code] of [[b[4], 'EC-0F32'], [b[14], 'EC-0F37']]) {
      if (![0x00, 0x01, 0x64].includes(base)) throw new BarcodeDataError(`QR Code with Image: invalid unit base X'${base.toString(16)}'`, code);
    }
    if (![0x10, 0x20, 0x30, 0x60].includes(b[21])) throw new BarcodeDataError(`QR Code with Image: invalid mapping option X'${b[21].toString(16)}'`, 'EC-0F3A');
    blocks.push({
      localId: u(b, 2, 2),
      offset: { base: b[4], upub: u(b, 5, 2), x: s16(7), y: s16(9) },
      orientation: degrees + minutes / 60,
      extent: { base: b[14], upub: u(b, 15, 2), x: u(b, 17, 2), y: u(b, 19, 2) },
      mapping: b[21],
    });
    p += 1 + len;
  }
  return blocks;
}

/** BCOCA mapping options of QR Code with Image → MO:DCA mapping options (Table 33, byte +22). */
const QR_IMAGE_MAPPING = { 0x10: 0x20, 0x20: 0x30, 0x30: 0x10, 0x60: 0x60 };

/**
 * Reads the image mappings of a QR Code with Image: MDR repeating groups in the bar code
 * object's OEG pair an internal ID (FQN type X'BE') with an IOCA resource (X'84') or an object
 * container (X'CE').
 * @param {{id: number, data: Uint8Array}[]} fields Fields of the bar code object.
 * @returns {Map<number, {type: string, name: string}>} Local ID → resource.
 */
function qrImageResources(fields) {
  const map = new Map();
  for (const f of fields.filter((x) => x.id === MDR)) {
    for (let p = 0; p + 2 <= f.data.length;) {
      const len = u(f.data, p, 2);
      if (len < 2) break;
      const t = readCommonTriplets(f.data.subarray(p + 2, p + len));
      const id = t.names[0xbe];
      if (id !== undefined && (t.names[0x84] || t.names[0xce])) {
        map.set(id, t.names[0x84] ? { type: 'image', name: t.names[0x84] } : { type: 'objectContainer', name: t.names[0xce] });
      }
      p += len;
    }
  }
  return map;
}

/**
 * Turns items about the origin by any angle and moves them. Right angles use placeItems; for
 * other angles only the origins of images, PDF pages and placeholders move exactly (images and
 * PDF pages turn about their origin when drawn), and their clip rectangles are dropped.
 * @param {object[]} items Items.
 * @param {number} angle Clockwise angle in degrees.
 * @param {number} dx X offset.
 * @param {number} dy Y offset.
 * @returns {object[]} Placed items.
 */
function turnItems(items, angle, dx, dy) {
  if (angle % 90 === 0) return placeItems(items, { dx, dy, rotation: angle });
  const a = (angle * Math.PI) / 180;
  const [c, s] = [Math.cos(a), Math.sin(a)];
  return items.map((item) => {
    if (!item.rect) return item;
    const { x, y } = item.rect;
    const rect = { ...item.rect, x: dx + x * c - y * s, y: dy + x * s + y * c };
    return { ...item, rect, clip: null, rotation: ((item.rotation ?? 0) + angle) % 360 };
  });
}

/**
 * Draws the images of a QR Code with Image (Table 33): each image object area lies in the Xqr,Yqr
 * system of the presented symbol (origin at its top-left corner, LRqr its bottom-right corner),
 * turned by its orientation, and the image is mapped into it like an included image object.
 * @param {object} r Render context.
 * @param {object} file File record.
 * @param {object} env Environment.
 * @param {object} sym QR Code symbol with `images`.
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @param {ReturnType<typeof readBsa>} bsa Symbol data.
 * @param {Map<number, {type: string, name: string}>} resources Local ID → resource.
 * @param {{x: number, y: number}} at Bar code object area origin on the page.
 * @param {number} rotation Bar code object area rotation.
 * @param {(reason: string, code?: string) => void} report Reports a problem with this bar code.
 * @returns {Promise<object[]>} Render items.
 */
async function renderQrImages(r, file, env, sym, bsd, bsa, resources, at, rotation, report) {
  const X = (bsd.moduleMils ?? 12) * 1.44;
  const lr = { x: sym.cols * X, y: sym.rows * X };
  const measure = ({ base, upub }, v, axis) => (base === 0x64 ? (v / (upub || 1) / 100) * lr[axis] : v * toPageUnits(base, upub));
  const items = [];
  for (const block of sym.images) {
    const res = resources.get(block.localId);
    const width = measure(block.extent, block.extent.x, 'x');
    const height = measure(block.extent, block.extent.y, 'y');
    const ox = bsa.x * bsd.unit + measure(block.offset, block.offset.x, 'x');
    const oy = bsa.y * bsd.unit + measure(block.offset, block.offset.y, 'y');
    let drawn;
    const entry = res && await r.catalog.lookup(res.type, res.name, r.lookupContext);
    if (!res) {
      report(`QR Code with Image: image local ID ${block.localId} is not mapped by a Map Data Resource`, 'decodeFailed');
      drawn = [{ type: 'placeholder', rect: { x: 0, y: 0, width, height }, reason: 'decodeFailed' }];
    } else if (!entry) {
      r.missing(res.type, res.name, file);
      drawn = [{ type: 'placeholder', rect: { x: 0, y: 0, width, height }, reason: 'missingResource', resourceName: res.name, resourceType: res.type }];
    } else {
      const target = r.getFile(entry.fileId);
      const renderer = objectRendererFor(target.index.id[entry.beginRow]);
      const area = { x: 0, y: 0, width, height, contentX: 0, contentY: 0, rotation: 0, mappingOption: QR_IMAGE_MAPPING[block.mapping] };
      drawn = renderer ? await renderer(r, target, entry.beginRow, env, { x: 0, y: 0 }, area) : [];
    }
    const src = { sourceField: bsa.row, fileId: file.id };
    items.push(...placeItems(turnItems(drawn.map((i) => ({ ...src, ...i })), block.orientation, ox, oy), { dx: at.x, dy: at.y, rotation }));
  }
  return items;
}

/**
 * Converts code page 1303 data (Code 128 and GS1 DataBar) to ASCII codes and FNC markers.
 * @param {Uint8Array} data Data.
 * @param {string} name Symbology name for messages.
 * @returns {(number|symbol)[]} Characters.
 */
function cp1303(data, name) {
  return Array.from(data, (b) => {
    const c = CP1303.get(b);
    if (c === undefined) throw new BarcodeDataError(`${name}: code point X'${b.toString(16).toUpperCase()}' is undefined in code page 1303`);
    return c;
  });
}

/**
 * Builds the symbol for one BSA with the matching symbology module.
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @param {{asterisks: boolean, data: Uint8Array}} bsa Symbol data.
 * @returns {import('./symbologies/linear.js').LinearSymbol|null} Symbol, or null if the type is
 *   not supported.
 */
export function buildSymbol(bsd, bsa) {
  const text = () => decode('ebcdic-500', bsa.data);
  const ratio = bsd.ratio ?? (bsd.type === 0x02 ? 2.0 : 2.5);
  switch (bsd.type) {
    case 0x01: return code39(text(), bsd.modifier, { ratio, asterisks: bsa.asterisks });
    case 0x02: return msi(text(), bsd.modifier, { ratio });
    case 0x03: case 0x05: case 0x06: case 0x07: case 0x08: case 0x09: case 0x16: case 0x17:
      return retail(bsd.type, text(), bsd.modifier);
    case 0x0c: return interleaved2of5(text(), bsd.modifier, { ratio });
    case 0x0a: return code2of5(text(), bsd.modifier, { ratio, matrix: false });
    case 0x0b: return code2of5(text(), bsd.modifier, { ratio, matrix: true });
    case 0x0d: return codabar(text(), bsd.modifier, { ratio });
    case 0x11: return code128(cp1303(bsa.data, 'Code 128'), bsd.modifier);
    case 0x24: return dataBar(cp1303(bsa.data, 'GS1 DataBar'), bsd.modifier, FNC1);
    case 0x18: return postnet(text(), bsd.modifier);
    case 0x1a: return rm4scc(text(), bsd.modifier);
    case 0x22: return intelligentMail(text(), bsd.modifier);
    case 0x1b: return japanPost(bsd.modifier === 0x00 ? text() : '', bsa.data, bsd.modifier);
    case 0x1f: return ausPost(text(), bsd.modifier);
    case 0x25: return mailmark(text(), bsd.modifier);
    case 0x1c: return buildDataMatrix(bsd, bsa);
    case 0x20: return buildQrCode(bsd, bsa);
    case 0x1e: return buildPdf417(bsd, bsa);
    case 0x26: return buildAztec(bsd, bsa);
    case 0x1d: return buildMaxiCode(bsd, bsa);
    case 0x27: return buildHanXin(bsd, bsa);
    case 0x21:
      if (bsd.modifier !== 0x00) throw new BarcodeDataError(`Code 93: modifier X'${bsd.modifier.toString(16)}' invalid`, 'EC-0B00');
      return code93(text());
    default: return null;
  }
}

/**
 * Maps a point of the bar code presentation space to the page, applying the object area
 * rotation (clockwise, as in the Object Area Position field).
 * @param {{x: number, y: number}} at Object area origin on the page.
 * @param {number} rotation Rotation in degrees (0, 90, 180, 270).
 * @returns {(x: number, y: number) => [number, number]} Mapping.
 */
function placer(at, rotation) {
  switch (((rotation % 360) + 360) % 360) {
    case 90: return (x, y) => [at.x - y, at.y + x];
    case 180: return (x, y) => [at.x - x, at.y - y];
    case 270: return (x, y) => [at.x + y, at.y - x];
    default: return (x, y) => [at.x + x, at.y + y];
  }
}

/**
 * Lays out a linear symbol as page items.
 * @param {import('./symbologies/linear.js').LinearSymbol & {bearer?: string}} sym Symbol.
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @param {ReturnType<typeof readBsa>} bsa Symbol data.
 * @param {(x: number, y: number) => [number, number]} place Presentation space → page.
 * @param {number} rotation Rotation for text.
 * @param {{sourceField: number, fileId: string}} src Source of the items.
 * @returns {object[]} Items.
 */
export function layoutLinear(sym, bsd, bsa, place, rotation, src) {
  let X = (bsd.moduleMils ?? defaultModuleMils(bsd)) * 1.44;
  // Desired symbol width (BSD bytes 10–11) replaces the module width when given.
  if (bsd.desiredWidth > 0 && sym.width > 0) X = bsd.desiredWidth / sym.width;
  const ox = bsa.x * bsd.unit;
  const oy = bsa.y * bsd.unit;
  const H = bsd.height ?? defaultHeight(bsd, sym.width * X);
  const items = [];
  const hriSize = sym.retail ? 9 * X : Math.min(240, Math.max(120, 10 * X));
  const charWidth = 0.6 * hriSize; // monospace substitute font
  // Retail symbols: the total height includes the HRI (BSD element height description); guard
  // bars reach 5 modules below the other bars (GS1).
  const mainBarH = sym.retail && sym.parts.some((p) => p.role === 'main') ? Math.max(H - hriSize, H * 0.5) : H;
  const guardH = Math.min(H, mainBarH + 5 * X);
  const commands = [];
  const rect = (x, y, w, h) => {
    const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([px, py]) => place(ox + px, oy + py));
    commands.push(['M', ...corners[0]], ['L', ...corners[1]], ['L', ...corners[2]], ['L', ...corners[3]], ['Z']);
  };
  if (!bsa.suppress) {
    for (const part of sym.parts) {
      let x = part.x * X;
      let bar = 0;
      const supplement = part.role === 'supplement';
      const hasMain = sym.parts.some((p) => p.role === 'main');
      const top = supplement && hasMain ? hriSize + X : 0;
      part.elements.forEach((w, i) => {
        const width = w * X;
        if (i % 2 === 0) {
          const bottom = supplement ? (hasMain ? guardH : H) : (part.guards?.[bar] ? guardH : mainBarH);
          rect(x, top, width, bottom - top);
          bar++;
        }
        x += width;
      });
    }
    if (sym.bearer) {
      const t = 2 * X;
      const w = sym.width * X;
      if (sym.bearer === 'box') {
        const q = 10 * X;
        rect(-q - t, -t, w + 2 * q + 2 * t, t);
        rect(-q - t, H, w + 2 * q + 2 * t, t);
        rect(-q - t, 0, t, H);
        rect(w + q, 0, t, H);
      } else {
        rect(0, -t, w, t);
        rect(0, H, w, t);
      }
    }
    if (commands.length) items.push({ type: 'path', commands, fill: bsd.color, stroke: null, lineWidth: 0, ...src });
  }
  if (!bsa.noHri) {
    for (const h of sym.hri) {
      const size = h.small ? hriSize * 0.75 : hriSize;
      const textWidth = h.text.length * 0.6 * size;
      let x = h.x * X - (h.align === 'center' ? textWidth / 2 : h.align === 'right' ? textWidth : 0);
      let y;
      if (bsa.suppress) {
        // Symbol suppressed: the offsets give the reference point of the first HRI character.
        x = 0;
        y = 0;
      } else if (h.role === 'supplement') {
        y = sym.parts.some((p) => p.role === 'main') ? hriSize : -X; // above the supplement bars
      } else if (sym.retail) {
        y = H; // retail HRI sits at the bottom of the total height
      } else if (bsa.position === 2) {
        y = -X - 0.2 * size; // above
      } else {
        y = H + X + 0.8 * size; // below (default)
      }
      const chars = [...h.text];
      const [px, py] = place(ox + x, oy + y);
      items.push({
        type: 'glyphRun', x: px, y: py, rotation, color: bsd.color,
        font: { kind: 'substitute', family: 'monospace', size, name: 'HRI' },
        ids: chars, chars, dx: chars.map((_, i) => i * (h.small ? 0.6 * size : charWidth)), text: h.text, ...src,
      });
    }
  }
  return items;
}

/**
 * Row tops of a matrix symbol in page units. Square modules by default; PDF417 rows are as high
 * as the element height × multiplier (default 4 module widths); GS1 DataBar rows have their own
 * heights in module widths, and the rows in `stretch` grow when the element height asks for a
 * taller symbol (BSD bytes 18–20).
 * @param {object} sym Symbol.
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @param {number} X Module width.
 * @returns {number[]} Row tops, one more than rows (the last is the symbol height).
 */
function rowTops(sym, bsd, X) {
  let heights;
  if (sym.rowHeights) {
    heights = sym.rowHeights.map((h) => h * X);
    const natural = heights.reduce((a, b) => a + b, 0);
    if (bsd.height && sym.stretch.length && bsd.height > natural) {
      const grow = (bsd.height - natural) / sym.stretch.length;
      for (const r of sym.stretch) heights[r] += grow;
    }
  } else {
    const Y = sym.rowHeightModules ? (bsd.height ?? sym.rowHeightModules * X) : X;
    heights = new Array(sym.rows).fill(Y);
  }
  const tops = [0];
  for (const h of heights) tops.push(tops[tops.length - 1] + h);
  return tops;
}

/**
 * Lays out a 2D matrix symbol (and the stacked GS1 DataBar): one rectangle per run of dark
 * modules in a row, origin at the top-left corner of the symbol; the quiet zone stays light.
 * Module width defaults per Table 13 (Data Matrix 21 mils, QR Code 12 mils, PDF417 and Aztec
 * 14 mils, GS1 DataBar 10 mils). 2D symbols have no HRI; GS1 DataBar has HRI below the symbol
 * (or above, BSA byte 0 bits 1–2).
 * @param {import('./symbologies/qrcode.js').MatrixSymbol} sym Symbol.
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @param {ReturnType<typeof readBsa>} bsa Symbol data.
 * @param {(x: number, y: number) => [number, number]} place Presentation space → page.
 * @param {{sourceField: number, fileId: string}} src Source of the items.
 * @param {number} [rotation] Rotation for HRI text.
 * @returns {object[]} Items.
 */
export function layoutMatrix(sym, bsd, bsa, place, src, rotation = 0) {
  const X = (bsd.moduleMils ?? ({ 0x1c: 21, 0x1e: 14, 0x26: 14, 0x24: 10 }[bsd.type] ?? 12)) * 1.44;
  const tops = rowTops(sym, bsd, X);
  const ox = bsa.x * bsd.unit;
  const oy = bsa.y * bsd.unit;
  const commands = [];
  for (let r = 0; r < sym.rows && !bsa.suppress; r++) {
    for (let c = 0; c < sym.cols; c++) {
      if (!sym.modules[r * sym.cols + c]) continue;
      let end = c;
      while (end + 1 < sym.cols && sym.modules[r * sym.cols + end + 1]) end++;
      const corners = [[c * X, tops[r]], [(end + 1) * X, tops[r]], [(end + 1) * X, tops[r + 1]], [c * X, tops[r + 1]]]
        .map(([x, y]) => place(ox + x, oy + y));
      commands.push(['M', ...corners[0]], ['L', ...corners[1]], ['L', ...corners[2]], ['L', ...corners[3]], ['Z']);
      c = end;
    }
  }
  const items = commands.length ? [{ type: 'path', commands, fill: bsd.color, stroke: null, lineWidth: 0, ...src }] : [];
  if (sym.hri && !bsa.noHri) {
    const size = Math.min(240, Math.max(120, 10 * X));
    const chars = [...sym.hri];
    const H = tops[tops.length - 1];
    const x = bsa.suppress ? 0 : (sym.cols * X) / 2 - (chars.length * 0.6 * size) / 2;
    const y = bsa.suppress ? 0 : bsa.position === 2 ? -X - 0.2 * size : H + X + 0.8 * size;
    const [px, py] = place(ox + x, oy + y);
    items.push({
      type: 'glyphRun', x: px, y: py, rotation, color: bsd.color,
      font: { kind: 'substitute', family: 'monospace', size, name: 'HRI' },
      ids: chars, chars, dx: chars.map((_, i) => i * 0.6 * size), text: sym.hri, ...src,
    });
  }
  return items;
}

/**
 * Lays out a postal symbol: bars at the fixed pitch of the symbology, each covering the part of
 * the height given by its state. A module width of X'01'–X'FE' selects the small symbol (BSD
 * byte 17, "small-symbol support"); the Japan Postal Bar Code is sized by the module width
 * instead. The Intelligent Mail Barcode and the Australia Post Bar Code (above by default) have HRI.
 * @param {import('./symbologies/postal.js').PostalSymbol} sym Symbol.
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @param {ReturnType<typeof readBsa>} bsa Symbol data.
 * @param {(x: number, y: number) => [number, number]} place Presentation space → page.
 * @param {number} rotation Rotation for text.
 * @param {{sourceField: number, fileId: string}} src Source of the items.
 * @returns {object[]} Items.
 */
export function layoutPostal(sym, bsd, bsa, place, rotation, src) {
  const g = POSTAL_GEOMETRY[sym.kind];
  let pitch;
  let barWidth;
  let H;
  if (g.moduleBased) {
    barWidth = (bsd.moduleMils ?? g.defaultMils) * 1.44;
    pitch = 2 * barWidth;
    H = 6 * barWidth;
  } else {
    const [sx, sy] = bsd.moduleMils ? g.small : [1, 1];
    pitch = g.pitch * 1440 * sx;
    barWidth = g.bar * 1440 * sx;
    H = g.height * 1440 * sy;
  }
  const ox = bsa.x * bsd.unit;
  const oy = bsa.y * bsd.unit;
  const commands = [];
  [...sym.bars].forEach((state, i) => {
    const [t, b] = g.states[state];
    const x = i * pitch;
    const corners = [[x, t * H], [x + barWidth, t * H], [x + barWidth, b * H], [x, b * H]].map(([px, py]) => place(ox + px, oy + py));
    commands.push(['M', ...corners[0]], ['L', ...corners[1]], ['L', ...corners[2]], ['L', ...corners[3]], ['Z']);
  });
  const items = [{ type: 'path', commands, fill: bsd.color, stroke: null, lineWidth: 0, ...src }];
  if (sym.hri && !bsa.noHri) {
    const size = 160;
    const width = (sym.bars.length - 1) * pitch + barWidth;
    const chars = [...sym.hri];
    const x = width / 2 - (chars.length * 0.6 * size) / 2;
    const above = bsa.position === 2 || (sym.hriAbove && bsa.position !== 1);
    const y = above ? -0.05 * 1440 - 0.2 * size : H + 0.05 * 1440 + 0.8 * size;
    const [px, py] = place(ox + x, oy + y);
    items.push({
      type: 'glyphRun', x: px, y: py, rotation, color: bsd.color,
      font: { kind: 'substitute', family: 'monospace', size, name: 'HRI' },
      ids: chars, chars, dx: chars.map((_, i) => i * 0.6 * size), text: sym.hri, ...src,
    });
  }
  return items;
}

/** MaxiCode rings of the finder pattern: inner and outer radius in module widths (ISO/IEC 16023). */
const MAXI_RINGS = [[0.5774, 1.3359], [2.1058, 2.8644], [3.6229, 4.3814]];

/**
 * Lays out a MaxiCode symbol: hexagonal modules (33 rows of 30, odd rows offset by half a
 * module, row pitch √3/2 module widths) and three concentric rings. The module width follows
 * from the fixed symbol width of Table 12: 25.5 mm (small symbol 24.03 mm) for 30.5 modules.
 * The zipper pattern (byte 9 bit 0) is not drawn.
 * @param {{modules: Uint8Array}} sym Symbol.
 * @param {BarcodeDescriptor} bsd Descriptor.
 * @param {ReturnType<typeof readBsa>} bsa Symbol data.
 * @param {(x: number, y: number) => [number, number]} place Presentation space → page.
 * @param {{sourceField: number, fileId: string}} src Source of the items.
 * @returns {object[]} Items.
 */
export function layoutMaxiCode(sym, bsd, bsa, place, src) {
  const W = ((bsd.moduleMils ? 24.03 : 25.5) / 25.4) * 1440 / 30.5;
  const ox = bsa.x * bsd.unit;
  const oy = bsa.y * bsd.unit;
  const commands = [];
  const poly = (pts) => {
    const p = pts.map(([x, y]) => place(ox + x * W, oy + y * W));
    commands.push(['M', ...p[0]], ...p.slice(1).map((q) => ['L', ...q]), ['Z']);
  };
  const g = 0.06;
  for (let r = 0; r < 33; r++) {
    for (let c = 0; c < 30; c++) {
      if (!sym.modules[r * 30 + c]) continue;
      const cx = c + 0.5 + (r % 2) * 0.5;
      const cy = r * 0.8661 + 0.5774;
      poly([[0, -0.5774 + g], [0.5 - g, -0.2887 + g / 2], [0.5 - g, 0.2887 - g / 2],
        [0, 0.5774 - g], [-0.5 + g, 0.2887 - g / 2], [-0.5 + g, -0.2887 + g / 2]].map(([x, y]) => [cx + x, cy + y]));
    }
  }
  const cx = 14.5;
  const cy = 32 * 0.8661 + 2 * 0.5774 - (13.8576 + 0.5774);
  const circle = (radius, reverse) => {
    const pts = Array.from({ length: 72 }, (_, k) => {
      const a = ((reverse ? -k : k) * Math.PI * 2) / 72;
      return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
    });
    poly(pts);
  };
  // Each ring: outer and inner circle, drawn in opposite directions so that both even-odd and
  // non-zero filling leave the inside light.
  for (const [inner, outer] of MAXI_RINGS) { circle(outer, false); circle(inner, true); }
  return [{ type: 'path', commands, fill: bsd.color, stroke: null, lineWidth: 0, ...src }];
}

/** 2D symbologies (Data Matrix, MaxiCode, PDF417, Aztec, QR Code, Han Xin): no HRI (Table 7). */
const TWO_D = new Set([0x1c, 0x1d, 0x1e, 0x20, 0x26, 0x27]);

/**
 * Renders a bar code object.
 * @param {object} r Render context.
 * @param {object} file File record.
 * @param {number} row Row of Begin Bar Code Object.
 * @param {object} env Environment of the including page.
 * @param {{x: number, y: number}} origin Origin in page units.
 * @returns {Promise<object[]>} Render items.
 */
async function renderBarcode(r, file, row, env, origin) {
  await loadCodePage('ebcdic-500');
  const fields = await collectFields(file, row, new Set([BDD, BDA, MDR]));
  const bdd = fields.find((f) => f.id === BDD);
  const area = (await readObjectArea(file, row, env)) ?? { x: 0, y: 0, width: null, height: null, rotation: 0 };
  const at = { x: origin.x + area.x, y: origin.y + area.y };
  const report = (reason, code = 'unsupportedObject', fieldRow = row) => r.report({
    severity: 'warning', code, fileId: file.id, offset: file.index.offset[fieldRow], params: { file: file.path, reason },
  });
  const placeholder = (reason) => ({
    type: 'placeholder', rect: { x: at.x, y: at.y, width: area.width ?? 1440, height: area.height ?? 720 }, reason, sourceField: row, fileId: file.id, objectId: BBC,
  });
  if (!bdd) {
    report('bar code object without Bar Code Data Descriptor', 'decodeFailed');
    return [placeholder('decodeFailed')];
  }
  const bsd = readBsd(bdd.data);
  // Only the text is needed (search index): 2D symbols have no human-readable text.
  if (env.textOnly && TWO_D.has(bsd.type)) return [];
  if (bsd.type === 0x20) {
    // QR Code conversion from code page 290 or 1027 (BSA byte 6): load the table first.
    for (const f of fields) {
      const cp = f.id === BDA && f.data[5] & 0x80 ? QR_CONVERSION[f.data[6]] : null;
      if (cp) await loadCodePage(cp);
    }
  }
  const name = BARCODE_TYPES[bsd.type] ?? `type X'${bsd.type.toString(16).toUpperCase().padStart(2, '0')}'`;
  const place = placer(at, area.rotation ?? 0);
  const items = [];
  for (const f of fields.filter((x) => x.id === BDA)) {
    const bsa = readBsa(f.data, bsd);
    let sym;
    try {
      sym = buildSymbol(bsd, bsa);
    } catch (error) {
      if (!(error instanceof BarcodeDataError)) throw error;
      report(`${name}: ${error.message} (${error.exception})`, 'decodeFailed', f.row);
      items.push(placeholder('decodeFailed'));
      continue;
    }
    if (!sym) {
      const what = bsd.type === 0x27 ? 'Han Xin Code with a GS1 or industry FNC1 data type' : name;
      report(`bar code ${what} (type X'${bsd.type.toString(16).toUpperCase().padStart(2, '0')}') is not supported yet`);
      return [placeholder('notYetSupported')];
    }
    const src = { sourceField: f.row, fileId: file.id };
    const rotation = area.rotation ?? 0;
    if (sym.images) {
      // QR Code with Image: the images before or after the symbol; the symbol may be left out.
      if (bsa.suppress) continue;
      const images = await renderQrImages(r, file, env, sym, bsd, { ...bsa, row: f.row }, qrImageResources(fields), at, rotation,
        (reason, code) => report(reason, code, f.row));
      const symbol = sym.onlyImages ? [] : layoutMatrix(sym, bsd, bsa, place, src, rotation);
      items.push(...(sym.imagesFirst ? [...images, ...symbol] : [...symbol, ...images]));
    } else if (sym.hexagonal) items.push(...layoutMaxiCode(sym, bsd, bsa, place, src));
    else if (sym.modules) items.push(...layoutMatrix(sym, bsd, bsa, place, src, rotation));
    else if (sym.bars) items.push(...layoutPostal(sym, bsd, bsa, place, rotation, src));
    else items.push(...layoutLinear(sym, bsd, bsa, place, rotation, src));
  }
  return items;
}

registerObjectRenderer(BBC, renderBarcode);

export { BBC as BEGIN_BARCODE_OBJECT };
