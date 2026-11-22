/**
 * Linear bar code symbologies (task T071): turns bar code data into bar/space widths.
 *
 * Spec references: BCOCA Reference (AFPC-0005-10), "Bar Code Type and Modifier Descriptions"
 * (types, modifiers, data rules), Table 19 "Check Digit Calculation Methods", Table 35 "Valid
 * Characters and Data Lengths"; bar/space patterns from the symbology specifications listed in
 * BCOCA Appendix A (AIM USS-39, USS-93, USS-Codabar, USS-I 2/5, USS-128, GS1 General
 * Specifications for UPC/EAN).
 *
 * Industrial 2-of-5 (X'0A') and Matrix 2-of-5 (X'0B') are not implemented: their start/stop
 * patterns could not be checked against a specification, and Principle I forbids guessing.
 *
 * All widths are in modules (the narrow element = 1). A symbol is a list of parts, each a run of
 * alternating bar and space widths starting with a bar, plus the HRI text and where it goes.
 */

/** Raised when the bar code data is invalid for the symbology (BCOCA EC-2100 / EC-0C00). */
import { gs1Hri } from './gs1-ai.js';

export class BarcodeDataError extends Error {
  /**
   * @param {string} message What is wrong with the data.
   * @param {string} [exception] BCOCA exception condition, e.g. 'EC-2100'.
   */
  constructor(message, exception = 'EC-2100') {
    super(message);
    this.exception = exception;
  }
}

/**
 * @typedef {object} LinearPart
 * @property {number} x Offset of the part in modules from the symbol origin.
 * @property {number[]} elements Widths in modules: bar, space, bar, … (starts with a bar).
 * @property {boolean[]} [guards] Per bar: true if the bar extends into the HRI area (UPC/EAN guards).
 * @property {'main'|'supplement'} role Main symbol or UPC/EAN supplement.
 */

/**
 * @typedef {object} HriText
 * @property {string} text Text.
 * @property {number} x Anchor in modules from the symbol origin.
 * @property {'left'|'center'|'right'} align How the text is aligned to the anchor.
 * @property {'main'|'supplement'} role Under the main symbol or above the supplement.
 * @property {boolean} [small] Smaller digit (UPC-A/UPC-E number system and check digit).
 */

/**
 * @typedef {object} LinearSymbol
 * @property {LinearPart[]} parts Bar/space runs.
 * @property {number} width Total width in modules.
 * @property {HriText[]} hri HRI texts.
 * @property {boolean} retail True for UPC/EAN (HRI layout and heights from GS1).
 */

/**
 * Converts an n/w pattern to widths.
 * @param {string} pattern Letters 'n' (narrow) and 'w' (wide).
 * @param {number} ratio Wide-to-narrow ratio.
 * @returns {number[]} Widths.
 */
const nw = (pattern, ratio) => [...pattern].map((c) => (c === 'w' ? ratio : 1));

/**
 * Converts a digit string like "3211" to widths.
 * @param {string} s Digits.
 * @returns {number[]} Widths.
 */
const digits = (s) => [...s].map(Number);

/**
 * Sums widths.
 * @param {number[]} e Widths.
 * @returns {number} Sum.
 */
const sum = (e) => e.reduce((a, b) => a + b, 0);

/**
 * Builds a one-part symbol with HRI centered below or above.
 * @param {number[]} elements Widths.
 * @param {string|null} hri HRI text.
 * @returns {LinearSymbol} Symbol.
 */
function simple(elements, hri) {
  const width = sum(elements);
  return { parts: [{ x: 0, elements, role: 'main' }], width, hri: hri ? [{ text: hri, x: width / 2, align: 'center', role: 'main' }] : [], retail: false };
}

/**
 * Checks that every character is allowed.
 * @param {string} data Data.
 * @param {string|RegExp} allowed Allowed characters (string of characters or a pattern for one).
 * @param {string} name Symbology name.
 * @returns {void}
 */
function requireChars(data, allowed, name) {
  for (const ch of data) {
    const ok = typeof allowed === 'string' ? allowed.includes(ch) : allowed.test(ch);
    if (!ok) throw new BarcodeDataError(`${name}: invalid character "${ch}"`);
  }
}

/**
 * Checks the data length.
 * @param {string} data Data.
 * @param {number[]|[number, number]} lengths Allowed lengths, or [min, max] when `range` is set.
 * @param {string} name Symbology name.
 * @param {boolean} [range] Treat `lengths` as an inclusive range.
 * @returns {void}
 */
function requireLength(data, lengths, name, range = false) {
  const ok = range ? data.length >= lengths[0] && data.length <= lengths[1] : lengths.includes(data.length);
  if (!ok) throw new BarcodeDataError(`${name}: ${data.length} characters given, ${range ? `${lengths[0]}–${lengths[1]}` : lengths.join(' or ')} expected`, 'EC-0C00');
}

/* ---------------------------------------------------------------- check digits (Table 19) */

/**
 * UPC/EAN modulo-10 check digit (weights 3,1,3,… from the rightmost digit).
 * @param {string} s Digits.
 * @returns {number} Check digit.
 */
export function mod10Upc(s) {
  let total = 0;
  for (let i = 0; i < s.length; i++) total += Number(s[s.length - 1 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (total % 10)) % 10;
}

/**
 * IBM modulus-10 check digit (MSI): weights 2,1,2,… from the units digit; digits of the
 * products are summed.
 * @param {string} s Digits.
 * @returns {number} Check digit.
 */
export function mod10Ibm(s) {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const p = Number(s[s.length - 1 - i]) * (i % 2 === 0 ? 2 : 1);
    total += Math.floor(p / 10) + (p % 10);
  }
  return (10 - (total % 10)) % 10;
}

/**
 * Modulus-11 weighted sum (MSI): weights 2..maxWeight repeating from the units digit.
 * @param {string} s Digits.
 * @param {number} maxWeight 7 (IBM) or 9 (NCR).
 * @returns {number} Sum modulo 11.
 */
function mod11(s, maxWeight) {
  let total = 0;
  for (let i = 0; i < s.length; i++) total += Number(s[s.length - 1 - i]) * (2 + (i % (maxWeight - 1)));
  return total % 11;
}

/* ---------------------------------------------------------------------------- Code 39 */

const C39_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
/** Code 39 patterns (bar, space, … 9 elements), in the order of C39_CHARS; '*' is start/stop. */
const C39 = [
  'nnnwwnwnn', 'wnnwnnnnw', 'nnwwnnnnw', 'wnwwnnnnn', 'nnnwwnnnw', 'wnnwwnnnn', 'nnwwwnnnn', 'nnnwnnwnw', 'wnnwnnwnn', 'nnwwnnwnn',
  'wnnnnwnnw', 'nnwnnwnnw', 'wnwnnwnnn', 'nnnnwwnnw', 'wnnnwwnnn', 'nnwnwwnnn', 'nnnnnwwnw', 'wnnnnwwnn', 'nnwnnwwnn', 'nnnnwwwnn',
  'wnnnnnnww', 'nnwnnnnww', 'wnwnnnnwn', 'nnnnwnnww', 'wnnnwnnwn', 'nnwnwnnwn', 'nnnnnnwww', 'wnnnnnwwn', 'nnwnnnwwn', 'nnnnwnwwn',
  'wwnnnnnnw', 'nwwnnnnnw', 'wwwnnnnnn', 'nwnnwnnnw', 'wwnnwnnnn', 'nwwnwnnnn', 'nwnnnnwnw', 'wwnnnnwnn', 'nwwnnnwnn', 'nwnwnwnnn',
  'nwnwnnnwn', 'nwnnnwnwn', 'nnnwnwnwn',
];
const C39_START = 'nwnnwnwnn';

/**
 * Code 39 (X'01'): modifier X'01' without, X'02' with modulo-43 check character.
 * @param {string} data Data (43-character set).
 * @param {number} modifier Modifier.
 * @param {{ratio: number, asterisks: boolean}} opts WE:NE ratio; asterisks in the HRI (BSA bit 3).
 * @returns {LinearSymbol} Symbol.
 */
export function code39(data, modifier, opts) {
  requireChars(data, C39_CHARS, 'Code 39');
  requireLength(data, [0, 50], 'Code 39', true);
  let text = data;
  if (modifier === 0x02) text += C39_CHARS[[...data].reduce((a, ch) => a + C39_CHARS.indexOf(ch), 0) % 43];
  const elements = [];
  const add = (p) => {
    if (elements.length) elements.push(1); // narrow intercharacter gap
    elements.push(...nw(p, opts.ratio));
  };
  add(C39_START);
  for (const ch of text) add(C39[C39_CHARS.indexOf(ch)]);
  add(C39_START);
  return simple(elements, opts.asterisks ? `*${text}*` : text);
}

/* -------------------------------------------------------------------------------- MSI */

/**
 * MSI (X'02'), modifiers X'01'–X'09' (check digits per BCOCA "MSI" modifier descriptions).
 * @param {string} data Digits.
 * @param {number} modifier Modifier.
 * @param {{ratio: number}} opts WE:NE ratio (default 2.0 for MSI).
 * @returns {LinearSymbol} Symbol.
 */
export function msi(data, modifier, opts) {
  requireChars(data, /[0-9]/, 'MSI');
  if (modifier < 1 || modifier > 9) throw new BarcodeDataError(`MSI: modifier X'${modifier.toString(16)}' invalid`, 'EC-0B00');
  requireLength(data, modifier === 1 ? [3, 15] : modifier === 2 ? [2, 14] : [1, 13], 'MSI', true);
  let text = data;
  if (modifier === 0x02) {
    text += mod10Ibm(text);
  } else if (modifier >= 0x03) {
    let first;
    if (modifier === 0x03) {
      first = mod10Ibm(text);
    } else {
      const ncr = [0x04, 0x06, 0x08].includes(modifier);
      const rem = mod11(text, ncr ? 9 : 7);
      if (modifier <= 0x05) first = rem; // remainder
      else first = (11 - rem) % 11; // 11 minus the remainder
      if (first === 10) {
        if (modifier === 0x06 || modifier === 0x07) first = 0;
        else throw new BarcodeDataError('MSI: first check digit would be 10', 'EC-0E00');
      }
    }
    text += first;
    text += mod10Ibm(text);
  }
  const r = opts.ratio;
  const elements = [r, 1]; // start: wide bar, narrow space
  for (const ch of text) {
    const v = Number(ch);
    for (let bit = 3; bit >= 0; bit--) elements.push(...((v >> bit) & 1 ? [r, 1] : [1, r]));
  }
  elements.push(1, r, 1); // stop: narrow bar, wide space, narrow bar
  // BCOCA Table 19: MSI check digits are not shown in the HRI.
  return simple(elements, data);
}

/* -------------------------------------------------------------------- UPC / EAN (GS1) */

/** Number set A (left odd) widths space-bar-space-bar for digits 0–9. */
const EAN_A = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'];
/** Number set B (left even): the reversed A widths. */
const EAN_B = EAN_A.map((s) => [...s].reverse().join(''));
/** EAN-13 parity of the left six digits by the first flag digit. */
const EAN13_PARITY = ['AAAAAA', 'AABABB', 'AABBAB', 'AABBBA', 'ABAABB', 'ABBAAB', 'ABBBAA', 'ABABAB', 'ABABBA', 'ABBABA'];
/** UPC-E parity (number system 0) by check digit: E = even (set B), O = odd (set A). */
const UPCE_PARITY = ['EEEOOO', 'EEOEOO', 'EEOOEO', 'EEOOOE', 'EOEEOO', 'EOOEEO', 'EOOOEE', 'EOEOEO', 'EOEOOE', 'EOOEOE'];
/** Five-digit supplement parity by check value. */
const SUPP5_PARITY = ['BBAAA', 'BABAA', 'BAABA', 'BAAAB', 'ABBAA', 'AABBA', 'AAABB', 'ABABA', 'ABAAB', 'AABAB'];
/** Two-digit supplement parity by value modulo 4. */
const SUPP2_PARITY = ['AA', 'AB', 'BA', 'BB'];

/**
 * Collects elements of a retail symbol: guards are marked so they extend into the HRI area.
 */
class RetailBuilder {
  /** Starts with a pending space (retail digits start with a space after the guard). */
  constructor() {
    /** @type {number[]} */
    this.elements = [];
    /** @type {boolean[]} */
    this.guards = [];
    this.bar = true;
  }

  /**
   * Adds widths; the first width is a bar if `startsWithBar`.
   * @param {number[]} widths Widths.
   * @param {boolean} startsWithBar Whether the first width is a bar.
   * @param {boolean} guard Whether bars added here are guard bars.
   * @returns {void}
   */
  add(widths, startsWithBar, guard) {
    let isBar = startsWithBar;
    for (const w of widths) {
      if (isBar !== this.bar) {
        // Merge with the previous element of the same kind (never happens with valid tables).
        this.elements[this.elements.length - 1] += w;
      } else {
        this.elements.push(w);
        if (isBar) this.guards.push(guard);
        this.bar = !this.bar;
      }
      isBar = !isBar;
    }
  }
}

/**
 * Encodes digits with number sets.
 * @param {RetailBuilder} b Builder.
 * @param {string} ds Digits.
 * @param {string} sets Set letters per digit: 'A', 'B' (left, start with space) or 'C' (right,
 *   starts with bar).
 * @returns {void}
 */
function retailDigits(b, ds, sets) {
  [...ds].forEach((d, i) => {
    const set = sets[i];
    if (set === 'C') b.add(digits(EAN_A[d]), true, false);
    else b.add(digits((set === 'B' ? EAN_B : EAN_A)[d]), false, false);
  });
}

/**
 * Builds an EAN-13 (also UPC-A, which is EAN-13 with a leading 0).
 * @param {string} d12 Twelve digits without check digit.
 * @returns {{elements: number[], guards: boolean[], full: string}} Pattern and all 13 digits.
 */
function ean13Pattern(d12) {
  const full = d12 + mod10Upc(d12);
  const b = new RetailBuilder();
  b.add([1, 1, 1], true, true);
  retailDigits(b, full.slice(1, 7), EAN13_PARITY[full[0]]);
  b.add([1, 1, 1, 1, 1], false, true);
  retailDigits(b, full.slice(7), 'CCCCCC');
  b.add([1, 1, 1], true, true);
  return { elements: b.elements, guards: b.guards, full };
}

/**
 * Builds a supplement (2 or 5 digits).
 * @param {string} ds Digits.
 * @returns {{elements: number[], guards: boolean[]}} Pattern (no guard extension).
 */
function supplementPattern(ds) {
  let parity;
  if (ds.length === 2) {
    parity = SUPP2_PARITY[Number(ds) % 4];
  } else {
    const v = [...ds].map(Number);
    parity = SUPP5_PARITY[(3 * (v[0] + v[2] + v[4]) + 9 * (v[1] + v[3])) % 10];
  }
  const b = new RetailBuilder();
  b.add([1, 1, 2], true, false); // start 1011
  [...ds].forEach((d, i) => {
    if (i > 0) b.add([1, 1], false, false); // separator 01
    b.add(digits((parity[i] === 'B' ? EAN_B : EAN_A)[d]), false, false);
  });
  return { elements: b.elements, guards: b.guards };
}

/**
 * Compresses a UPC-A article number to the six UPC-E digits (number system 0), following the
 * GS1 zero-suppression rules.
 * @param {string} d10 Ten digits: manufacturer (5) and product (5).
 * @returns {string} Six digits.
 */
export function upcEDigits(d10) {
  const m = d10.slice(0, 5);
  const p = d10.slice(5);
  if (['000', '100', '200'].includes(m.slice(2)) && p.startsWith('00')) return m.slice(0, 2) + p.slice(2) + m[2];
  if (m.slice(3) === '00' && p.startsWith('000')) return m.slice(0, 3) + p.slice(3) + '3';
  if (m[4] === '0' && p.startsWith('0000')) return m.slice(0, 4) + p[4] + '4';
  if (m[4] !== '0' && p.startsWith('0000') && p[4] >= '5') return m + p[4];
  throw new BarcodeDataError(`UPC-E: ${d10} cannot be zero-suppressed`);
}

/**
 * Builds a UPC-E symbol.
 * @param {string} d10 Ten digits (number system 0 assumed).
 * @returns {{elements: number[], guards: boolean[], e6: string, check: number}} Pattern.
 */
function upcEPattern(d10) {
  const e6 = upcEDigits(d10);
  const check = mod10Upc(`0${d10}`);
  const b = new RetailBuilder();
  b.add([1, 1, 1], true, true);
  retailDigits(b, e6, [...UPCE_PARITY[check]].map((c) => (c === 'E' ? 'B' : 'A')).join(''));
  b.add([1, 1, 1, 1, 1, 1], false, true); // end guard 010101
  return { elements: b.elements, guards: b.guards, e6, check };
}

/** Gap in modules between a retail symbol and its supplement (GS1: 7–12 modules). */
const SUPPLEMENT_GAP = 9;

/**
 * Adds a supplement part after a main symbol.
 * @param {LinearSymbol} sym Main symbol.
 * @param {string} ds Supplement digits.
 * @returns {LinearSymbol} Symbol with supplement.
 */
function withSupplement(sym, ds) {
  const x = sym.width + SUPPLEMENT_GAP;
  const s = supplementPattern(ds);
  const width = sum(s.elements);
  sym.parts.push({ x, elements: s.elements, guards: s.guards, role: 'supplement' });
  // HRI above the supplement: one digit centered over each digit's 7 modules.
  [...ds].forEach((d, i) => sym.hri.push({ text: d, x: x + 4 + i * 9 + 3.5, align: 'center', role: 'supplement' }));
  sym.width = x + width;
  return sym;
}

/**
 * Supplement-only symbol (modifier X'00' of X'06', X'07', X'16', X'17').
 * @param {string} ds Digits.
 * @returns {LinearSymbol} Symbol.
 */
function supplementOnly(ds) {
  const s = supplementPattern(ds);
  const width = sum(s.elements);
  return {
    parts: [{ x: 0, elements: s.elements, guards: s.guards, role: 'supplement' }],
    width,
    hri: [...ds].map((d, i) => ({ text: d, x: 4 + i * 9 + 3.5, align: 'center', role: 'supplement' })),
    retail: true,
  };
}

/**
 * EAN-13 symbol with GS1 HRI layout.
 * @param {string} d12 Twelve digits.
 * @returns {LinearSymbol} Symbol.
 */
function ean13Symbol(d12) {
  const { elements, guards, full } = ean13Pattern(d12);
  return {
    parts: [{ x: 0, elements, guards, role: 'main' }],
    width: 95,
    hri: [
      { text: full[0], x: -1, align: 'right', role: 'main' },
      { text: full.slice(1, 7), x: 3 + 21, align: 'center', role: 'main' },
      { text: full.slice(7), x: 50 + 21, align: 'center', role: 'main' },
    ],
    retail: true,
  };
}

/**
 * UPC-A symbol with GS1 HRI layout (number system and check digit outside, smaller).
 * @param {string} d11 Eleven digits.
 * @returns {LinearSymbol} Symbol.
 */
function upcASymbol(d11) {
  const { elements, guards, full } = ean13Pattern(`0${d11}`);
  const upc = full.slice(1);
  // GS1: the bars of the number system digit and the check digit are as long as the guards.
  let x = 0;
  let bar = 0;
  elements.forEach((w, i) => {
    if (i % 2 === 0) {
      if ((x >= 3 && x < 10) || (x >= 85 && x < 92)) guards[bar] = true;
      bar++;
    }
    x += w;
  });
  return {
    parts: [{ x: 0, elements, guards, role: 'main' }],
    width: 95,
    hri: [
      { text: upc[0], x: -1, align: 'right', role: 'main', small: true },
      { text: upc.slice(1, 6), x: 10 + 17.5, align: 'center', role: 'main' },
      { text: upc.slice(6, 11), x: 50 + 17.5, align: 'center', role: 'main' },
      { text: upc[11], x: 96, align: 'left', role: 'main', small: true },
    ],
    retail: true,
  };
}

/**
 * UPC-E symbol with GS1 HRI layout.
 * @param {string} d10 Ten digits.
 * @returns {LinearSymbol} Symbol.
 */
function upcESymbol(d10) {
  const { elements, guards, e6, check } = upcEPattern(d10);
  return {
    parts: [{ x: 0, elements, guards, role: 'main' }],
    width: 51,
    hri: [
      { text: '0', x: -1, align: 'right', role: 'main', small: true },
      { text: e6, x: 3 + 21, align: 'center', role: 'main' },
      { text: String(check), x: 52, align: 'left', role: 'main', small: true },
    ],
    retail: true,
  };
}

/**
 * UPC/EAN family: types X'03', X'05', X'06', X'07', X'08', X'09', X'16', X'17'.
 * @param {number} type Bar code type.
 * @param {string} data Digits.
 * @param {number} modifier Modifier.
 * @returns {LinearSymbol} Symbol.
 */
export function retail(type, data, modifier) {
  requireChars(data, /[0-9]/, 'UPC/EAN');
  const len = (n) => requireLength(data, [n], 'UPC/EAN');
  switch (type) {
    case 0x03: len(11); return upcASymbol(data);
    case 0x05: len(10); return upcESymbol(data);
    case 0x08: {
      len(7);
      const full = data + mod10Upc(data);
      const b = new RetailBuilder();
      b.add([1, 1, 1], true, true);
      retailDigits(b, full.slice(0, 4), 'AAAA');
      b.add([1, 1, 1, 1, 1], false, true);
      retailDigits(b, full.slice(4), 'CCCC');
      b.add([1, 1, 1], true, true);
      return {
        parts: [{ x: 0, elements: b.elements, guards: b.guards, role: 'main' }],
        width: 67,
        hri: [{ text: full.slice(0, 4), x: 3 + 14, align: 'center', role: 'main' }, { text: full.slice(4), x: 36 + 14, align: 'center', role: 'main' }],
        retail: true,
      };
    }
    case 0x09: len(12); return ean13Symbol(data);
    case 0x06: case 0x07: { // UPC supplements
      const n = type === 0x06 ? 2 : 5;
      if (modifier === 0x00) { len(n); return supplementOnly(data); }
      if (modifier === 0x01) {
        len(11 + n);
        if (data[0] !== '0') throw new BarcodeDataError('UPC-A with supplement: number system must be 0');
        return withSupplement(upcASymbol(data.slice(0, 11)), data.slice(11));
      }
      if (modifier === 0x02) { len(10 + n); return withSupplement(upcESymbol(data.slice(0, 10)), data.slice(10)); }
      break;
    }
    case 0x16: case 0x17: { // EAN supplements
      const n = type === 0x16 ? 2 : 5;
      if (modifier === 0x00) { len(n); return supplementOnly(data); }
      if (modifier === 0x01) { len(12 + n); return withSupplement(ean13Symbol(data.slice(0, 12)), data.slice(12)); }
      break;
    }
    default:
  }
  throw new BarcodeDataError(`UPC/EAN: modifier X'${modifier.toString(16)}' invalid for type X'${type.toString(16)}'`, 'EC-0B00');
}

/* ------------------------------------------------------------------ Interleaved 2-of-5 */

/** 2-of-5 digit patterns (n = narrow, w = wide), shared by the 2-of-5 family. */
const TWO_OF_FIVE = ['nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw', 'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn'];

/**
 * Interleaved 2-of-5 (X'0C'): X'01' no check digit, X'02' check digit, X'03' check digit and
 * surrounding Bearer Bars, X'04' check digit and Bearer Bars at top and bottom. A leading zero is
 * added for an odd number of digits.
 * @param {string} data Digits.
 * @param {number} modifier Modifier.
 * @param {{ratio: number}} opts WE:NE ratio.
 * @returns {LinearSymbol & {bearer?: 'box'|'topBottom'}} Symbol.
 */
export function interleaved2of5(data, modifier, opts) {
  requireChars(data, /[0-9]/, 'Interleaved 2-of-5');
  requireLength(data, [0, 50], 'Interleaved 2-of-5', true);
  if (modifier < 1 || modifier > 4) throw new BarcodeDataError(`Interleaved 2-of-5: modifier X'${modifier.toString(16)}' invalid`, 'EC-0B00');
  let text = data;
  if (modifier >= 0x02) text += mod10Upc(data);
  if (text.length % 2) text = `0${text}`;
  const r = opts.ratio;
  const elements = [1, 1, 1, 1]; // start: narrow bar, space, bar, space
  for (let i = 0; i < text.length; i += 2) {
    const bars = TWO_OF_FIVE[text[i]];
    const spaces = TWO_OF_FIVE[text[i + 1]];
    for (let k = 0; k < 5; k++) elements.push(bars[k] === 'w' ? r : 1, spaces[k] === 'w' ? r : 1);
  }
  elements.push(r, 1, 1); // stop: wide bar, narrow space, narrow bar
  const sym = simple(elements, text);
  if (modifier === 0x03) sym.bearer = 'box';
  if (modifier === 0x04) sym.bearer = 'topBottom';
  return sym;
}

/**
 * Industrial 2-of-5 (X'0A') and Matrix 2-of-5 (X'0B'); modifier X'02' adds a modulo-10 check
 * digit (weights 3 and 1 from the right). Industrial: each digit is five bars (two wide) with
 * narrow spaces, start wide-wide-narrow bars, stop wide-narrow-wide bars. Matrix: each digit is
 * bar, space, bar, space, bar (two wide) and a narrow space, start wide bar + 2 narrow bars, stop
 * wide bar + 2 narrow bars. Start and stop patterns as in BWIPP ("code2of5", MIT license).
 * @param {string} data Digits.
 * @param {number} modifier Modifier.
 * @param {{ratio: number, matrix: boolean}} opts WE:NE ratio and variant.
 * @returns {LinearSymbol} Symbol.
 */
export function code2of5(data, modifier, opts) {
  const name = opts.matrix ? 'Matrix 2-of-5' : 'Industrial 2-of-5';
  requireChars(data, /[0-9]/, name);
  if (modifier !== 0x01 && modifier !== 0x02) throw new BarcodeDataError(`${name}: modifier X'${modifier.toString(16)}' invalid`, 'EC-0B00');
  const text = modifier === 0x02 ? data + mod10Upc(data) : data;
  const r = opts.ratio;
  const w = (c) => (c === 'w' ? r : 1);
  const elements = opts.matrix ? [r, 1, 1, 1, 1, 1] : [r, 1, r, 1, 1, 1];
  for (const d of text) {
    const p = TWO_OF_FIVE[d];
    if (opts.matrix) elements.push(...[...p].map(w), 1);
    else for (const c of p) elements.push(w(c), 1);
  }
  elements.push(...(opts.matrix ? [r, 1, 1, 1, 1] : [r, 1, 1, 1, r]));
  return simple(elements, text);
}

/* ---------------------------------------------------------------------------- Codabar */

const CODABAR_CHARS = '0123456789-$:/.+ABCD';
/** Codabar patterns (7 elements, bar first), in the order of CODABAR_CHARS. */
const CODABAR = [
  'nnnnnww', 'nnnnwwn', 'nnnwnnw', 'wwnnnnn', 'nnwnnwn', 'wnnnnwn', 'nwnnnnw', 'nwnnwnn', 'nwwnnnn', 'wnnwnnn',
  'nnnwwnn', 'nnwwnnn', 'wnnnwnw', 'wnwnnnw', 'wnwnwnn', 'nnwnwnw', 'nnwwnwn', 'nwnwnnw', 'nnnwnww', 'nnnwwwn',
];

/**
 * Codabar (X'0D'): data is start character, digits, stop character; X'02' adds a modulo-16
 * check character before the stop character.
 * @param {string} data Data.
 * @param {number} modifier Modifier.
 * @param {{ratio: number}} opts WE:NE ratio.
 * @returns {LinearSymbol} Symbol.
 */
export function codabar(data, modifier, opts) {
  requireChars(data, CODABAR_CHARS, 'Codabar');
  requireLength(data, [2, 50], 'Codabar', true);
  const isStartStop = (c) => 'ABCD'.includes(c);
  if (!isStartStop(data[0]) || !isStartStop(data[data.length - 1]) || [...data.slice(1, -1)].some(isStartStop)) {
    throw new BarcodeDataError('Codabar: data must start and end with A, B, C or D (and contain them nowhere else)');
  }
  let text = data;
  if (modifier === 0x02) {
    const total = [...data].reduce((a, ch) => a + CODABAR_CHARS.indexOf(ch), 0);
    const check = CODABAR_CHARS[(16 - (total % 16)) % 16];
    text = data.slice(0, -1) + check + data.slice(-1);
  }
  const elements = [];
  for (const ch of text) {
    if (elements.length) elements.push(1);
    elements.push(...nw(CODABAR[CODABAR_CHARS.indexOf(ch)], opts.ratio));
  }
  // HRI without start/stop characters, as in the BCOCA example (A34698735B → 34698735).
  return simple(elements, data.slice(1, -1));
}

/* --------------------------------------------------------------------------- Code 93 */

const C93_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
/** Code 93 patterns (bar, space, … 6 elements, 9 modules) for values 0–46. */
const C93 = [
  '131112', '111213', '111312', '111411', '121113', '121212', '121311', '111114', '131211', '141111',
  '211113', '211212', '211311', '221112', '221211', '231111', '112113', '112212', '112311', '122112',
  '132111', '111123', '111222', '111321', '121122', '131121', '212112', '212211', '211122', '211221',
  '221121', '222111', '112122', '112221', '122121', '123111', '121131', '311112', '311211', '321111',
  '112131', '113121', '211131', '121221', '312111', '311121', '122211',
];
const C93_START_STOP = '111141';

/**
 * Code 93 (X'21'): input characters a–d stand for the shift characters 1–4; two check characters
 * (C and K, modulo 47) are added and not shown in the HRI.
 * @param {string} data Data.
 * @returns {LinearSymbol} Symbol.
 */
export function code93(data) {
  requireChars(data, `${C93_CHARS}abcd`, 'Code 93');
  requireLength(data, [0, 50], 'Code 93', true);
  const values = [...data].map((ch) => ('abcd'.includes(ch) ? 43 + 'abcd'.indexOf(ch) : C93_CHARS.indexOf(ch)));
  const check = (vals, maxWeight) => vals.reduceRight((acc, v, i) => acc + v * (((vals.length - 1 - i) % maxWeight) + 1), 0) % 47;
  values.push(check(values, 20));
  values.push(check(values, 15));
  const elements = [...digits(C93_START_STOP)];
  for (const v of values) elements.push(...digits(C93[v]));
  elements.push(...digits(C93_START_STOP), 1); // stop and termination bar
  return simple(elements, data);
}

/* -------------------------------------------------------------------------- Code 128 */

/** Code 128 patterns (bar, space, … 6 elements, 11 modules) for values 0–106 (106 = stop, 7 elements). */
const C128 = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

/** Function characters in decoded Code 128 data. */
export const FNC1 = -1;
export const FNC2 = -2;
export const FNC3 = -3;
export const FNC4 = -4;

const START_A = 103;
const START_B = 104;
const START_C = 105;
const STOP = 106;

/**
 * Value of a character in code set A or B, or -1 if it is not in the set.
 * @param {number} c ASCII code or FNC marker.
 * @param {'A'|'B'} set Code set.
 * @returns {number} Value.
 */
function valueIn(c, set) {
  if (c === FNC1) return 102;
  if (c === FNC2) return 97;
  if (c === FNC3) return 96;
  if (c === FNC4) return set === 'A' ? 101 : 100;
  if (set === 'A') {
    if (c >= 32 && c <= 95) return c - 32;
    if (c >= 0 && c < 32) return c + 64;
    return -1;
  }
  if (c >= 32 && c <= 127) return c - 32;
  return -1;
}

/**
 * Number of digits starting at a position.
 * @param {number[]} cs Characters.
 * @param {number} i Start.
 * @returns {number} Count.
 */
function digitRun(cs, i) {
  let n = 0;
  while (i + n < cs.length && cs[i + n] >= 48 && cs[i + n] <= 57) n++;
  return n;
}

/**
 * Chooses set A or B for the next characters: A if a control character comes before a
 * lowercase character.
 * @param {number[]} cs Characters.
 * @param {number} i Position.
 * @returns {'A'|'B'} Set.
 */
function preferAorB(cs, i) {
  for (let k = i; k < cs.length; k++) {
    if (cs[k] >= 0 && cs[k] < 32) return 'A';
    if (cs[k] >= 96) return 'B';
  }
  return 'B';
}

/**
 * Encodes characters to Code 128 values (start, data, no check, no stop), choosing code sets for
 * a short symbol (AIM USS-128 / GS1 set selection rules).
 * @param {number[]} cs ASCII codes and FNC markers.
 * @param {boolean} gs1 Start in set C when the data begins with FNC1 (UCC/EAN 128, 1993 rule).
 * @returns {number[]} Values.
 */
export function code128Values(cs, gs1) {
  const out = [];
  let set;
  const leadDigits = digitRun(cs, gs1 && cs[0] === FNC1 ? 1 : 0);
  if ((gs1 && cs[0] === FNC1) || leadDigits >= 4 || (leadDigits === cs.length && leadDigits === 2)) {
    set = 'C';
    out.push(START_C);
  } else {
    set = preferAorB(cs, 0);
    out.push(set === 'A' ? START_A : START_B);
  }
  let i = 0;
  while (i < cs.length) {
    const c = cs[i];
    if (set === 'C') {
      if (c === FNC1) { out.push(102); i++; continue; }
      if (digitRun(cs, i) >= 2) {
        out.push((cs[i] - 48) * 10 + (cs[i + 1] - 48));
        i += 2;
        continue;
      }
      set = preferAorB(cs, i);
      out.push(set === 'A' ? 101 : 100);
      continue;
    }
    const run = digitRun(cs, i);
    const atEnd = i + run === cs.length;
    if (run >= 6 || (atEnd && run >= 4)) {
      if (run % 2) { // odd: encode one digit in the current set first
        out.push(valueIn(c, set));
        i++;
      }
      set = 'C';
      out.push(99);
      continue;
    }
    const v = valueIn(c, set);
    if (v >= 0) {
      out.push(v);
      i++;
      continue;
    }
    const other = set === 'A' ? 'B' : 'A';
    const vo = valueIn(c, other);
    if (vo < 0) throw new BarcodeDataError(`Code 128: character X'${c.toString(16)}' cannot be encoded`);
    const next = cs[i + 1];
    if (next !== undefined && valueIn(next, set) < 0 && valueIn(next, other) >= 0) {
      set = other; // several characters from the other set: switch
      out.push(set === 'A' ? 101 : 100);
    } else {
      out.push(98, vo); // one character: shift
      i++;
    }
  }
  return out;
}

/**
 * Code 128 (X'11'), modifiers X'02'–X'06'. Modifiers X'05' and X'06' are drawn as their GS1-128
 * symbol only (the USPS banner and identification bars are not drawn).
 * @param {number[]} cs ASCII codes and FNC markers (from code page 1303).
 * @param {number} modifier Modifier.
 * @returns {LinearSymbol} Symbol.
 */
export function code128(cs, modifier) {
  if (modifier < 0x02 || modifier > 0x06) throw new BarcodeDataError(`Code 128: modifier X'${modifier.toString(16)}' invalid`, 'EC-0B00');
  if (cs.length > 50) throw new BarcodeDataError('Code 128: more than 50 characters', 'EC-0C00');
  const gs1 = modifier >= 0x03;
  if (gs1 && cs[0] !== FNC1) throw new BarcodeDataError('GS1-128: data must begin with FNC1 (X\'8F\')', 'EC-1200');
  const values = code128Values(cs, gs1);
  values.push(values.reduce((a, v, i) => a + v * Math.max(i, 1), 0) % 103);
  values.push(STOP);
  const elements = values.flatMap((v) => digits(C128[v]));
  // HRI: FNC characters are not shown; modifier X'04' puts the application identifiers in
  // parentheses (data that is not a valid AI sequence is shown without them).
  let text = cs.filter((c) => c >= 32).map((c) => String.fromCharCode(c)).join('');
  if (modifier === 0x04) {
    const fields = [];
    for (const c of cs) {
      if (c === FNC1) fields.push('');
      else if (c >= 32) fields[fields.length - 1] += String.fromCharCode(c);
    }
    text = gs1Hri(fields.filter(Boolean)) ?? text;
  }
  return simple(elements, text);
}

/** Exposed for tests: pattern tables. */
export const TABLES = Object.freeze({ C39, C39_CHARS, C93, CODABAR, C128, EAN_A, TWO_OF_FIVE });
