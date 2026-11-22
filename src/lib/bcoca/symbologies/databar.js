/**
 * GS1 DataBar (task T289; BCOCA type X'24', ISO/IEC 24724:2011): Omnidirectional, Truncated,
 * Stacked, Stacked Omnidirectional, Limited, Expanded and Expanded Stacked.
 *
 * Ported from Zint (backend/rss.c, rss.h and general_field.c, version 2.16.0):
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
 *
 * The symbol is a matrix of modules; each row has a height in module widths (separator rows 1).
 * Rows marked in `stretch` take the extra height when the BSD gives a larger element height.
 */

import { BarcodeDataError } from './linear.js';
import { gs1Hri } from './gs1-ai.js';

/** FNC1 in the reduced Expanded data. */
const GS = '\x1d';

// DataBar Omnidirectional tables (ISO/IEC 24724 Tables 1, 2, 4, 5).
const OMN_G_SUM = [0, 161, 961, 2015, 2715, 0, 336, 1036, 1516];
const OMN_T_EVEN_ODD = [1, 10, 34, 70, 126, 4, 20, 48, 81];
const OMN_MODULES = [12, 10, 8, 6, 4, 5, 7, 9, 11, 4, 6, 8, 10, 12, 10, 8, 6, 4];
const OMN_WIDEST = [8, 6, 4, 3, 1, 2, 4, 6, 8];
const OMN_FINDER = [[3, 8, 2, 1, 1], [3, 5, 5, 1, 1], [3, 3, 7, 1, 1], [3, 1, 9, 1, 1], [2, 7, 4, 1, 1],
  [2, 5, 6, 1, 1], [2, 3, 8, 1, 1], [1, 5, 7, 1, 1], [1, 3, 9, 1, 1]];
const OMN_WEIGHT = [[1, 3, 9, 27, 2, 6, 18, 54], [4, 12, 36, 29, 8, 24, 72, 58],
  [16, 48, 65, 37, 32, 17, 51, 74], [64, 34, 23, 69, 49, 68, 46, 59]];

// DataBar Limited tables (Tables 6, 7, Annex C).
const LTD_G_SUM = [0, 183064, 820064, 1000776, 1491021, 1979845, 1996939];
const LTD_T_EVEN = [28, 728, 6454, 203, 2408, 1, 16632];
const LTD_MODULES = [17, 13, 9, 15, 11, 19, 7];
const LTD_WIDEST = [6, 5, 3, 5, 4, 8, 1];
const LTD_WEIGHT = [[1, 3, 9, 27, 81, 65, 17, 51, 64, 14, 42, 37, 22, 66],
  [20, 60, 2, 6, 18, 54, 73, 41, 34, 13, 39, 28, 84, 74]];
/** Annex C finder patterns as digit strings (14 element widths each). */
const LTD_FINDER = (
  '11111111113311 11111111123211 11111111133111 11111112113211 11111112123111 11111113113111 '
  + '11111211113211 11111211123111 11111212113111 11111311113111 11121111113211 11121111123111 '
  + '11121112113111 11121211113111 11131111113111 12111111113211 12111111123111 12111112113111 '
  + '12111211113111 12121111113111 13111111113111 11111111212311 11111111222211 11111111232111 '
  + '11111112212211 11111112222111 11111113212111 11111211212211 11111211222111 11111212212111 '
  + '11111311212111 11121111212211 11121111222111 11121112212111 11121211212111 11131111212111 '
  + '12111111212211 12111111222111 12111112212111 12111211212111 12121111212111 13111111212111 '
  + '11111111311311 11111111321211 11111112311211 11121111311211 12111111311211 11111121112311 '
  + '11111121122211 11111121132111 11111122112211 11121121112211 11121121122111 11121122112111 '
  + '11121221112111 11131121112111 12111121112211 12111121122111 12121121112111 11112111112311 '
  + '11112111122211 11112111132111 11112112112211 11112112122111 11112211112211 12112111112211 '
  + '12112111122111 12112112112111 12112211112111 12122111112111 13112111112111 11211111112311 '
  + '11211111122211 11211111132111 11211112112211 11211112122111 11211113112111 11211211112211 '
  + '11211211122111 11221111112211 21111111122211 21111111132111 21111112112211 21111112122111 '
  + '21111113112111 21111211122111 21111212112111 21121111122111 21111111221211'
).split(' ').map((s) => [...s].map(Number));

// DataBar Expanded tables (Tables 8, 14, 15, 16).
const EXP_G_SUM = [0, 348, 1388, 2948, 3988];
const EXP_T_EVEN = [4, 20, 52, 104, 204];
const EXP_MODULES = [12, 10, 8, 6, 4];
const EXP_WIDEST = [7, 5, 4, 3, 1];
const EXP_WEIGHT = [
  [1, 3, 9, 27, 81, 32, 96, 77], [20, 60, 180, 118, 143, 7, 21, 63], [189, 145, 13, 39, 117, 140, 209, 205],
  [193, 157, 49, 147, 19, 57, 171, 91], [62, 186, 136, 197, 169, 85, 44, 132], [185, 133, 188, 142, 4, 12, 36, 108],
  [113, 128, 173, 97, 80, 29, 87, 50], [150, 28, 84, 41, 123, 158, 52, 156], [46, 138, 203, 187, 139, 206, 196, 166],
  [76, 17, 51, 153, 37, 111, 122, 155], [43, 129, 176, 106, 107, 110, 119, 146], [16, 48, 144, 10, 30, 90, 59, 177],
  [109, 116, 137, 200, 178, 112, 125, 164], [70, 210, 208, 202, 184, 130, 179, 115], [134, 191, 151, 31, 93, 68, 204, 190],
  [148, 22, 66, 198, 172, 94, 71, 2], [6, 18, 54, 162, 64, 192, 154, 40], [120, 149, 25, 75, 14, 42, 126, 167],
  [79, 26, 78, 23, 69, 207, 199, 175], [103, 98, 83, 38, 114, 131, 182, 124], [161, 61, 183, 127, 170, 88, 53, 159],
  [55, 165, 73, 8, 24, 72, 5, 15], [45, 135, 194, 160, 58, 174, 100, 89],
];
const EXP_FINDER = [[1, 8, 4, 1, 1], [1, 1, 4, 8, 1], [3, 6, 4, 1, 1], [1, 1, 4, 6, 3], [3, 4, 6, 1, 1], [1, 1, 6, 4, 3],
  [3, 2, 8, 1, 1], [1, 1, 8, 2, 3], [2, 6, 5, 1, 1], [1, 1, 5, 6, 2], [2, 2, 9, 1, 1], [1, 1, 9, 2, 2]];
const EXP_FINDER_SEQUENCE = [[1, 2], [1, 4, 3], [1, 6, 3, 8], [1, 10, 3, 8, 5], [1, 10, 3, 8, 7, 12],
  [1, 10, 3, 8, 9, 12, 11], [1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 10, 9], [1, 2, 3, 4, 5, 6, 7, 10, 11, 12],
  [1, 2, 3, 4, 5, 8, 7, 10, 9, 12, 11]];
const EXP_WEIGHT_ROWS = [[0, 1, 2], [0, 5, 6, 3, 4], [0, 9, 10, 3, 4, 13, 14], [0, 17, 18, 3, 4, 13, 14, 7, 8],
  [0, 17, 18, 3, 4, 13, 14, 11, 12, 21, 22], [0, 17, 18, 3, 4, 13, 14, 15, 16, 21, 22, 19, 20],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 17, 18, 15, 16],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 17, 18, 19, 20, 21, 22],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 13, 14, 11, 12, 17, 18, 15, 16, 21, 22, 19, 20]];

/**
 * Number of combinations of r out of n.
 * @param {number} n N.
 * @param {number} r R.
 * @returns {number} Combinations.
 */
function combins(n, r) {
  const [minDenom, maxDenom] = n - r > r ? [r, n - r] : [n - r, r];
  let val = 1;
  let j = 1;
  for (let i = n; i > maxDenom; i--) {
    val *= i;
    if (j <= minDenom) { val /= j; j++; }
  }
  for (; j <= minDenom; j++) val /= j;
  return val;
}

/**
 * Element widths for a value (ISO/IEC 24724 Annex B getRSSwidths).
 * @param {number} value Value.
 * @param {number} modules Modules.
 * @param {number} elements Elements.
 * @param {number} maxWidth Widest element.
 * @param {boolean} noNarrow Skip patterns without a one-module element.
 * @returns {number[]} Widths.
 */
function getWidths(value, modules, elements, maxWidth, noNarrow) {
  const widths = [];
  let val = value;
  let n = modules;
  let narrowMask = 0;
  let bar = 0;
  for (; bar < elements - 1; bar++) {
    let elmWidth = 1;
    let subVal;
    narrowMask |= 1 << bar;
    for (;; elmWidth++, narrowMask &= ~(1 << bar)) {
      subVal = combins(n - elmWidth - 1, elements - bar - 2);
      if (noNarrow && !narrowMask && n - elmWidth - (elements - bar - 1) >= elements - bar - 1) {
        subVal -= combins(n - elmWidth - (elements - bar), elements - bar - 2);
      }
      if (elements - bar - 1 > 1) {
        let lessVal = 0;
        for (let mxw = n - elmWidth - (elements - bar - 2); mxw > maxWidth; mxw--) {
          lessVal += combins(n - elmWidth - mxw - 1, elements - bar - 3);
        }
        subVal -= lessVal * (elements - 1 - bar);
      } else if (n - elmWidth > maxWidth) {
        subVal--;
      }
      val -= subVal;
      if (val < 0) break;
    }
    val += subVal;
    n -= elmWidth;
    widths[bar] = elmWidth;
  }
  widths[bar] = n;
  return widths;
}

/**
 * Interleaved odd and even element widths.
 * @param {number} vOdd Odd value.
 * @param {number} vEven Even value.
 * @param {number} nOdd Odd modules.
 * @param {number} nEven Even modules.
 * @param {number} elements Elements per set.
 * @param {number} maxWidth Widest odd element.
 * @param {boolean} noNarrow No-narrow rule for the odd set (inverted for the even set).
 * @returns {number[]} Widths.
 */
function widths(vOdd, vEven, nOdd, nEven, elements, maxWidth, noNarrow) {
  const odd = getWidths(vOdd, nOdd, elements, maxWidth, noNarrow);
  const even = getWidths(vEven, nEven, elements, 9 - maxWidth, !noNarrow);
  return odd.flatMap((w, i) => [w, even[i]]);
}

/** A module matrix that grows as rows are written. */
class Grid {
  constructor() { this.rows = []; this.width = 0; }
  row(r) { while (this.rows.length <= r) this.rows.push([]); return this.rows[r]; }
  set(r, c) { this.row(r)[c] = 1; this.width = Math.max(this.width, c + 1); }
  unset(r, c) { this.row(r)[c] = 0; this.width = Math.max(this.width, c + 1); }
  is(r, c) { return this.row(r)[c] === 1; }
  /**
   * Writes alternating spaces and bars.
   * @param {number} r Row.
   * @param {number} writer Start column.
   * @param {boolean} latch Start with a bar.
   * @param {number[]} w Widths.
   * @param {number} start First element.
   * @param {number} end Element after the last.
   * @returns {number} Column after the last module.
   */
  expand(r, writer, latch, w, start, end) {
    let x = writer;
    let bar = latch;
    for (let i = start; i < end; i++) {
      for (let j = 0; j < w[i]; j++) (bar ? this.set(r, x++) : this.unset(r, x++));
      bar = !bar;
    }
    return x;
  }
}

/**
 * Turns a grid into a symbol.
 * @param {Grid} g Grid.
 * @param {number[]} heights Row heights in module widths.
 * @param {number[]} stretch Rows that grow with a larger element height.
 * @param {string} hri HRI text.
 * @returns {{rows: number, cols: number, modules: Uint8Array, rowHeights: number[], stretch: number[],
 *   hri: string}} Symbol.
 */
function symbolOf(g, heights, stretch, hri) {
  const modules = new Uint8Array(g.rows.length * g.width);
  g.rows.forEach((row, r) => row.forEach((v, c) => { if (v) modules[r * g.width + c] = 1; }));
  return { rows: g.rows.length, cols: g.width, modules, rowHeights: heights, stretch, hri };
}

/**
 * Reads the 14 input digits of the GTIN-based versions; the 14th (check digit) is only shown.
 * @param {string} text Data.
 * @param {string} name Version name.
 * @returns {string} The 14 digits.
 */
function gtin(text, name) {
  if (!/^[0-9]{14}$/.test(text)) throw new BarcodeDataError(`GS1 DataBar ${name}: data must be 14 digits`, 'EC-0C00');
  return text;
}

/**
 * Adjusts a separator over a DataBar Omnidirectional finder.
 * @param {Grid} g Grid.
 * @param {number} sepRow Separator row.
 * @param {number} aboveBelow Offset of the module row.
 * @param {number} finderStart First finder column.
 */
function omnFinderAdjust(g, sepRow, aboveBelow, finderStart) {
  const moduleRow = sepRow + aboveBelow;
  let latch = true;
  for (let i = finderStart; i < finderStart + 13; i++) {
    if (!g.is(moduleRow, i)) {
      if (latch) { g.set(sepRow, i); latch = false; } else { g.unset(sepRow, i); latch = true; }
    } else {
      g.unset(sepRow, i);
      latch = true;
    }
  }
}

/**
 * Separator row of DataBar Stacked Omnidirectional.
 * @param {Grid} g Grid.
 * @param {number} width Width.
 * @param {number} sepRow Separator row.
 * @param {number} aboveBelow Offset of the module row.
 * @param {number} finderStart Finder column.
 * @param {boolean} bottomFinderValue3 Special case of finder value 3 (ISO/IEC 24724 5.3.2.2).
 */
function omnSeparator(g, width, sepRow, aboveBelow, finderStart, bottomFinderValue3) {
  const moduleRow = sepRow + aboveBelow;
  for (let i = 4; i < width - 4; i++) if (!g.is(moduleRow, i)) g.set(sepRow, i);
  if (bottomFinderValue3) {
    for (let i = finderStart; i < finderStart + 13; i++) (i === finderStart + 10 ? g.set(sepRow, i) : g.unset(sepRow, i));
  } else {
    omnFinderAdjust(g, sepRow, aboveBelow, finderStart);
  }
}

/**
 * Group of a DataBar Omnidirectional character.
 * @param {number} val Value.
 * @param {boolean} outside Outside character.
 * @returns {number} Group.
 */
function omnGroup(val, outside) {
  const end = outside ? 4 : 8;
  let i = outside ? 0 : 5;
  for (; i < end; i++) if (val < OMN_G_SUM[i + 1]) return i;
  return i;
}

/**
 * GS1 DataBar Omnidirectional, Truncated, Stacked or Stacked Omnidirectional.
 * @param {string} text 14 digits.
 * @param {'omni'|'truncated'|'stacked'|'stackedOmni'} version Version.
 * @returns {object} Symbol.
 */
function omnidirectional(text, version) {
  const digits = gtin(text, version);
  const val = BigInt(digits.slice(0, 13));
  const left = Number(val / 4537077n);
  const right = Number(val % 4537077n);
  const chars = [Math.floor(left / 1597), left % 1597, Math.floor(right / 1597), right % 1597];
  const dataWidths = chars.map((c, i) => {
    const outside = !(i & 1);
    const group = omnGroup(c, outside);
    const v = c - OMN_G_SUM[group];
    const vDiv = Math.floor(v / OMN_T_EVEN_ODD[group]);
    const vMod = v % OMN_T_EVEN_ODD[group];
    return widths(outside ? vDiv : vMod, outside ? vMod : vDiv, OMN_MODULES[group], OMN_MODULES[group + 9], 4,
      OMN_WIDEST[group], (i & 1) === 1);
  });
  let checksum = 0;
  dataWidths.forEach((w, i) => w.forEach((x, j) => { checksum += OMN_WEIGHT[i][j] * x; }));
  checksum %= 79;
  if (checksum >= 8) checksum++;
  if (checksum >= 72) checksum++;
  const cLeft = Math.floor(checksum / 9);
  const cRight = checksum % 9;
  const total = new Array(46).fill(0);
  total[0] = 1; total[1] = 1; total[44] = 1; total[45] = 1;
  for (let i = 0; i < 8; i++) {
    total[i + 2] = dataWidths[0][i];
    total[i + 15] = dataWidths[1][7 - i];
    total[i + 23] = dataWidths[3][i];
    total[i + 36] = dataWidths[2][7 - i];
  }
  for (let i = 0; i < 5; i++) {
    total[i + 10] = OMN_FINDER[cLeft][i];
    total[i + 31] = OMN_FINDER[cRight][4 - i];
  }
  const g = new Grid();
  const hri = `(01)${digits}`;
  if (version === 'omni' || version === 'truncated') {
    g.expand(0, 0, false, total, 0, 46);
    return symbolOf(g, [version === 'omni' ? 33 : 13], [0], hri);
  }
  if (version === 'stacked') {
    const w = g.expand(0, 0, false, total, 0, 23);
    g.set(0, w); g.unset(0, w + 1);
    g.set(2, 0); g.unset(2, 1);
    g.expand(2, 2, true, total, 23, 46);
    g.row(1);
    for (let i = 1; i < 46; i++) {
      if (g.is(0, i) === g.is(2, i)) {
        if (!g.is(0, i)) g.set(1, i);
      } else if (!g.is(1, i - 1)) {
        g.set(1, i);
      }
    }
    g.unset(1, 1); g.unset(1, 2); g.unset(1, 3);
    g.unset(1, 49);
    return symbolOf(g, [5, 1, 7], [], hri);
  }
  const w = g.expand(0, 0, false, total, 0, 23);
  g.set(0, w); g.unset(0, w + 1);
  g.set(4, 0); g.unset(4, 1);
  g.expand(4, 2, true, total, 23, 46);
  for (let i = 5; i < 46; i += 2) g.set(2, i);
  omnSeparator(g, 50, 1, -1, 18, false);
  omnSeparator(g, 50, 3, 1, 19, cRight === 3);
  g.unset(2, 49);
  return symbolOf(g, [33, 1, 1, 1, 33], [0, 4], hri);
}

/**
 * GS1 DataBar Limited.
 * @param {string} text 14 digits, the first 0 or 1.
 * @returns {object} Symbol.
 */
function limited(text) {
  const digits = gtin(text, 'Limited');
  if (digits[0] !== '0' && digits[0] !== '1') throw new BarcodeDataError('GS1 DataBar Limited: the first digit must be 0 or 1', 'EC-0C00');
  const val = BigInt(digits.slice(0, 13));
  const pairWidths = [Number(val / 2013571n), Number(val % 2013571n)].map((v) => {
    let group = 0;
    let rest = v;
    for (let i = 6; i > 0; i--) if (rest >= LTD_G_SUM[i]) { rest -= LTD_G_SUM[i]; group = i; break; }
    return widths(Math.floor(rest / LTD_T_EVEN[group]), rest % LTD_T_EVEN[group], LTD_MODULES[group],
      26 - LTD_MODULES[group], 7, LTD_WIDEST[group], false);
  });
  let checksum = 0;
  for (let i = 0; i < 14; i++) checksum += LTD_WEIGHT[0][i] * pairWidths[0][i] + LTD_WEIGHT[1][i] * pairWidths[1][i];
  const finder = LTD_FINDER[checksum % 89];
  const total = [1, 1, ...pairWidths[0], ...finder, ...pairWidths[1], 1, 1, 5];
  const g = new Grid();
  g.expand(0, 0, false, total, 0, 47);
  return symbolOf(g, [10], [0], `(01)${digits}`);
}

/**
 * Appends a value as bits.
 * @param {number[]} bits Bits.
 * @param {number} value Value.
 * @param {number} count Bits to append.
 */
const append = (bits, value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1); };

/** General field character classes (ISO/IEC 24724 7.2.5.5). */
const ALNUM_PUNCT = '*,-./';
const ISO_PUNCT = '!"%&\'()*+,-./:;<=>?_ ';
const NUMERIC = 1;
const ALPHANUMERIC = 2;
const ISOIEC = 3;

/**
 * Character class in the general field (FNC1 counts as numeric).
 * @param {string} c Character.
 * @returns {number} Class, 0 if not encodable.
 */
function gfType(c) {
  if (c === GS || (c >= '0' && c <= '9')) return NUMERIC;
  if ((c >= 'A' && c <= 'Z') || ALNUM_PUNCT.includes(c)) return ALPHANUMERIC;
  if ((c >= 'a' && c <= 'z') || ISO_PUNCT.includes(c)) return ISOIEC;
  return 0;
}

/**
 * Encodes the general-purpose data field (ISO/IEC 24724 7.2.5.5.1–7.2.5.5.3).
 * @param {string} f Data.
 * @param {number[]} bits Bits.
 * @returns {{mode: number, lastDigit: string|null}} Final mode and an odd last digit.
 */
function generalField(f, bits) {
  const next = (i, num, type, type2 = 0) => {
    if (i + num > f.length) return false;
    for (let k = i; k < i + num; k++) {
      const t = gfType(f[k]);
      if (t !== type && (!type2 || t !== type2)) return false;
    }
    return true;
  };
  const nextTerminate = (i, num, maxNum, type) => {
    if (i + maxNum < f.length) return false;
    let k = i;
    let n = num;
    for (; k < f.length; k++, n--) if (gfType(f[k]) !== type) return false;
    return n <= 0;
  };
  const nextNone = (i, num, type) => {
    let k = i;
    let n = num;
    for (; k < f.length && n; k++, n--) if (gfType(f[k]) === type) return false;
    return n === 0 || k === f.length;
  };
  let mode = NUMERIC;
  let lastDigit = null;
  for (let i = 0; i < f.length;) {
    const c = f[i];
    const type = gfType(c);
    if (!type) throw new BarcodeDataError(`GS1 DataBar Expanded: character "${c}" cannot be encoded`, 'EC-1200');
    if (mode === NUMERIC) {
      if (i < f.length - 1) {
        if (type !== NUMERIC || gfType(f[i + 1]) !== NUMERIC) {
          append(bits, 0, 4);
          mode = ALPHANUMERIC;
        } else {
          const d1 = c === GS ? 10 : Number(c);
          const d2 = f[i + 1] === GS ? 10 : Number(f[i + 1]);
          append(bits, 11 * d1 + d2 + 8, 7);
          i += 2;
        }
      } else if (type !== NUMERIC) {
        append(bits, 0, 4);
        mode = ALPHANUMERIC;
      } else {
        lastDigit = c;
        i++;
      }
    } else if (mode === ALPHANUMERIC) {
      if (c === GS) { append(bits, 15, 5); mode = NUMERIC; i++; }
      else if (type === ISOIEC) { append(bits, 4, 5); mode = ISOIEC; }
      else if (next(i, 6, NUMERIC) || nextTerminate(i, 4, 5, NUMERIC)) { append(bits, 0, 3); mode = NUMERIC; }
      else if (c >= '0' && c <= '9') { append(bits, c.charCodeAt(0) - 43, 5); i++; }
      else if (c >= 'A' && c <= 'Z') { append(bits, c.charCodeAt(0) - 33, 6); i++; }
      else { append(bits, ALNUM_PUNCT.indexOf(c) + 58, 6); i++; }
    } else if (c === GS) {
      append(bits, 15, 5);
      mode = NUMERIC;
      i++;
    } else {
      const none = nextNone(i, 10, ISOIEC);
      if (none && next(i, 4, NUMERIC)) { append(bits, 0, 3); mode = NUMERIC; }
      else if (none && next(i, 5, ALPHANUMERIC, NUMERIC)) { append(bits, 4, 5); mode = ALPHANUMERIC; }
      else if (c >= '0' && c <= '9') { append(bits, c.charCodeAt(0) - 43, 5); i++; }
      else if (c >= 'A' && c <= 'Z') { append(bits, c.charCodeAt(0) - 1, 7); i++; }
      else if (c >= 'a' && c <= 'z') { append(bits, c.charCodeAt(0) - 7, 7); i++; }
      else { append(bits, ISO_PUNCT.indexOf(c) + 232, 8); i++; }
    }
  }
  return { mode, lastDigit };
}

/**
 * Date value for the compressed weight-and-date methods.
 * @param {string} s Data.
 * @param {number} p Position of YYMMDD.
 * @returns {number} Value, or −1 if invalid.
 */
function expDate(s, p) {
  if (p + 6 > s.length || !/^[0-9]{6}$/.test(s.slice(p, p + 6))) return -1;
  const yy = Number(s.slice(p, p + 2));
  const mm = Number(s.slice(p + 2, p + 4));
  const dd = Number(s.slice(p + 4, p + 6));
  if (mm <= 0 || mm > 12 || dd > 31) return -1;
  return yy * 384 + (mm - 1) * 32 + dd;
}

/**
 * Binary string of a DataBar Expanded symbol (ISO/IEC 24724 7.2.5).
 * @param {string} s Reduced data (AIs and values, FNC1 as GS).
 * @param {number} charsPerRow Symbol characters per row (0 for one row).
 * @returns {{bits: number[], symbolChars: number}} Bits (a multiple of 12) and symbol characters.
 */
function expBinary(s, charsPerRow) {
  const toInt = (p, n) => (/^[0-9]+$/.test(s.slice(p, p + n)) && s.length >= p + n ? Number(s.slice(p, p + n)) : -1);
  const bits = [0]; // linkage flag: no composite
  let method = s.length >= 16 && s[0] === '0' && s[1] === '1' ? 1 : 2;
  if (s.length >= 20 && method === 1 && s[2] === '9' && s[16] === '3') {
    if (s.length >= 26 && s[17] === '1' && s[18] === '0') {
      const weight = toInt(20, 6);
      if (weight >= 0 && weight <= 99999) {
        if (s.length === 26) method = s[19] === '3' && weight <= 32767 ? 3 : 7;
        else if (s.length === 34 && s[26] === '1' && '1357'.includes(s[27]) && expDate(s, 28) >= 0) method = 6 + Number(s[27]);
      }
    } else if (s.length >= 26 && s[17] === '2' && s[18] === '0') {
      const weight = toInt(20, 6);
      if (weight >= 0 && weight <= 99999) {
        if (s.length === 26) method = (s[19] === '2' && weight <= 9999) || (s[19] === '3' && weight <= 22767) ? 4 : 8;
        else if (s.length === 34 && s[26] === '1' && '1357'.includes(s[27]) && expDate(s, 28) >= 0) method = 7 + Number(s[27]);
      }
    } else if (s[17] === '9' && s[19] >= '0' && s[19] <= '3') {
      if (s[18] === '2') method = 5;
      else if (s[18] === '3' && toInt(20, 3) >= 0) method = 6;
    }
  }
  let readPos;
  switch (method) {
    case 1: append(bits, 4, 3); readPos = 16; break;
    case 2: append(bits, 0, 4); readPos = 0; break;
    case 3: case 4: append(bits, 4 + (method - 3), 4); readPos = 26; break;
    case 5: append(bits, 0x30, 7); readPos = 20; break;
    case 6: append(bits, 0x34, 7); readPos = 23; break;
    default: append(bits, 56 + (method - 7), 7); readPos = s.length; break;
  }
  for (let i = 0; i < readPos; i++) {
    if (!(s[i] >= '0' && s[i] <= '9') && s[i] !== GS) throw new BarcodeDataError('GS1 DataBar Expanded: invalid data in the compressed field', 'EC-1200');
  }
  const gtin12 = () => { for (let i = 3; i < 15; i += 3) append(bits, toInt(i, 3), 10); };
  if (method === 1) {
    append(bits, Number(s[2]), 4);
    gtin12();
  } else if (method === 3 || method === 4) {
    gtin12();
    append(bits, toInt(20, 6) + (method === 4 && s[19] === '3' ? 10000 : 0), 15);
  } else if (method === 5 || method === 6) {
    gtin12();
    append(bits, Number(s[19]), 2);
    if (method === 6) append(bits, toInt(20, 3), 10);
  } else if (method >= 7) {
    gtin12();
    append(bits, Number(s[19] + s.slice(21, 26)), 20);
    append(bits, s.length === 34 ? expDate(s, 28) : 38400, 16);
  }
  const { mode, lastDigit } = generalField(s.slice(readPos), bits);
  const count = () => {
    let n = Math.ceil(bits.length / 12) + 1;
    if (charsPerRow && n % charsPerRow === 1) n++;
    return Math.max(n, 4);
  };
  let symbolChars = count();
  let remainder = 12 * (symbolChars - 1) - bits.length;
  if (lastDigit !== null) {
    if (remainder >= 4 && remainder <= 6) append(bits, Number(lastDigit) + 1, 4);
    else append(bits, Number(lastDigit) * 11 + 10 + 8, 7);
    symbolChars = count();
    remainder = 12 * (symbolChars - 1) - bits.length;
  }
  if (bits.length > 252) throw new BarcodeDataError('GS1 DataBar Expanded: too much data (more than 21 symbol characters)', 'EC-1200');
  let pad = remainder;
  if (mode === NUMERIC) { append(bits, 0, 4); pad -= 4; }
  for (; pad > 0; pad -= 5) append(bits, 4, 5);
  bits.length = 12 * (symbolChars - 1);
  if (method === 1 || method === 2 || method === 5 || method === 6) {
    const at = method === 1 ? 2 : method === 2 ? 3 : 6;
    bits[at] = symbolChars & 1;
    bits[at + 1] = symbolChars > 14 ? 1 : 0;
  }
  return { bits, symbolChars };
}

/**
 * Separator row of DataBar Expanded Stacked.
 * @param {Grid} g Grid.
 * @param {number} width Row width.
 * @param {number} cols Segment pairs in the row.
 * @param {number} sepRow Separator row.
 * @param {number} aboveBelow Offset of the module row.
 * @param {number} specialCase Special case bottom row (0 or 1).
 * @param {boolean} leftToRight Direction.
 * @param {boolean} oddLastRow Last row ends with a finder.
 * @param {{v2: boolean}} state Finder alternation (kept across rows).
 */
function expSeparator(g, width, cols, sepRow, aboveBelow, specialCase, leftToRight, oddLastRow, state) {
  const moduleRow = sepRow + aboveBelow;
  let v2 = state.v2;
  let space = false;
  for (let j = 4 + specialCase; j < width - 4; j++) (g.is(moduleRow, j) ? g.unset(sepRow, j) : g.set(sepRow, j));
  const step = (c) => {
    if (g.is(moduleRow, c)) { g.unset(sepRow, c); space = false; } else {
      if (space) g.unset(sepRow, c); else g.set(sepRow, c);
      space = !space;
    }
  };
  for (let j = 0; j < cols; j++) {
    let k = 49 * j + 19 + specialCase;
    if (leftToRight) {
      for (let i = v2 ? 2 : 0; i < (v2 ? 15 : 13); i++) step(i + k);
    } else {
      if (oddLastRow) k -= 17;
      for (let i = v2 ? 14 : 12; i >= (v2 ? 2 : 0); i--) step(i + k);
    }
    v2 = !v2;
  }
  if (aboveBelow === -1) state.v2 = v2;
}

/**
 * GS1 DataBar Expanded or Expanded Stacked.
 * @param {string} reduced Data with FNC1 as GS.
 * @param {number} pairsPerRow Segment pairs per row, or 0 for Expanded (one row).
 * @param {string} hri HRI text.
 * @returns {object} Symbol.
 */
function expanded(reduced, pairsPerRow, hri) {
  if (reduced.length > 77) throw new BarcodeDataError('GS1 DataBar Expanded: too much data', 'EC-1200');
  const { bits, symbolChars } = expBinary(reduced, pairsPerRow * 2);
  const dataChars = bits.length / 12;
  const charWidths = [];
  const group = (v) => { let i = 0; while (i < 4 && v >= EXP_G_SUM[i + 1]) i++; return i; };
  const widthsOf = (v) => {
    const gp = group(v);
    return widths(Math.floor((v - EXP_G_SUM[gp]) / EXP_T_EVEN[gp]), (v - EXP_G_SUM[gp]) % EXP_T_EVEN[gp], EXP_MODULES[gp],
      17 - EXP_MODULES[gp], 4, EXP_WIDEST[gp], true);
  };
  for (let i = 0; i < dataChars; i++) {
    let v = 0;
    for (let j = 0; j < 12; j++) v = v * 2 + bits[i * 12 + j];
    charWidths.push(widthsOf(v));
  }
  let checksum = 0;
  for (let i = 0; i < dataChars; i++) {
    const row = EXP_WEIGHT_ROWS[Math.floor((dataChars - 2) / 2)][i];
    for (let j = 0; j < 8; j++) checksum += charWidths[i][j] * EXP_WEIGHT[row][j];
  }
  const checkWidths = widthsOf(211 * (symbolChars - 4) + (checksum % 211));
  const codeblocks = Math.ceil(symbolChars / 2);
  const patternWidth = codeblocks * 5 + symbolChars * 8 + 4;
  const elements = new Array(patternWidth).fill(0);
  const sequence = EXP_FINDER_SEQUENCE[Math.floor((symbolChars - 1) / 2) - 1];
  for (let i = 0; i < codeblocks; i++) {
    for (let j = 0; j < 5; j++) elements[21 * i + j + 10] = EXP_FINDER[sequence[i] - 1][j];
  }
  for (let i = 0; i < 8; i++) elements[i + 2] = checkWidths[i];
  for (let i = 1; i < dataChars; i += 2) for (let j = 0; j < 8; j++) elements[((i - 1) / 2) * 21 + 23 + j] = charWidths[i][j];
  for (let i = 0; i < dataChars; i += 2) for (let j = 0; j < 8; j++) elements[(i / 2) * 21 + 15 + j] = charWidths[i][7 - j];
  const g = new Grid();
  if (!pairsPerRow) {
    elements[0] = 1; elements[1] = 1;
    elements[patternWidth - 2] = 1; elements[patternWidth - 1] = 1;
    g.expand(0, 0, false, elements, 0, patternWidth);
    return symbolOf(g, [34], [0], hri);
  }
  const stackRows = Math.ceil(codeblocks / pairsPerRow);
  const heights = [];
  const stretch = [];
  const state = { v2: false };
  let block = 0;
  let r = 0;
  for (let row = 1; row <= stackRows; row++) {
    const columns = row * pairsPerRow > codeblocks ? codeblocks - block : pairsPerRow;
    const sub = [1, 1];
    let special = 0;
    if (row === stackRows && columns !== pairsPerRow && !(row & 1) && !(pairsPerRow & 1) && (columns & 1)) {
      special = 1;
      sub[0] = 2;
    }
    const leftToRight = (pairsPerRow & 1) === 1 || (row & 1) === 1 || special === 1;
    let count = 2;
    let reader = 0;
    do {
      const start = 2 + block * 21;
      for (let j = 0; j < 21; j++) {
        if (start + j < patternWidth) {
          const at = leftToRight ? j + reader * 21 + 2 : 20 - j + (columns - 1 - reader) * 21 + 2;
          sub[at] = elements[start + j];
        }
        count++;
      }
      reader++;
      block++;
    } while (reader < pairsPerRow && block < codeblocks);
    for (let k = 0; k < count; k++) sub[k] ??= 0;
    sub[count++] = 1;
    sub[count++] = 1;
    const latch = !((row & 1) || special);
    const writer = g.expand(r, 0, latch, sub, 0, count);
    if (row !== 1) {
      const oddLastRow = row === stackRows && dataChars % 2 === 0;
      for (let j = 5; j < 49 * pairsPerRow; j += 2) g.set(r - 2, j);
      expSeparator(g, writer, reader, r - 1, 1, special, leftToRight, oddLastRow, state);
    }
    if (row !== stackRows) expSeparator(g, writer, reader, r + 1, -1, 0, leftToRight, false, state);
    stretch.push(heights.length);
    heights.push(34);
    if (row !== stackRows) heights.push(1, 1, 1);
    r += 4;
  }
  return symbolOf(g, heights, stretch, hri);
}

/**
 * Builds a GS1 DataBar symbol.
 * @param {(number|symbol)[]} chars Data as character codes, FNC1 as the FNC1 marker.
 * @param {number} modifier BSD modifier.
 * @param {symbol} fnc1 FNC1 marker.
 * @returns {object} Symbol (module matrix with row heights and HRI).
 */
export function dataBar(chars, modifier, fnc1) {
  if (modifier <= 0x04) {
    const text = chars.map((c) => (c === fnc1 ? '' : String.fromCharCode(c))).join('');
    if (modifier === 0x04) return limited(text);
    return omnidirectional(text, ['omni', 'truncated', 'stacked', 'stackedOmni'][modifier]);
  }
  if (modifier < 0x11 || modifier > 0x1b) throw new BarcodeDataError(`GS1 DataBar: modifier X'${modifier.toString(16)}' invalid`, 'EC-0B00');
  // FNC1 before the first AI is ignored; the others separate variable-length fields.
  let i = 0;
  while (chars[i] === fnc1) i++;
  const reduced = chars.slice(i).map((c) => (c === fnc1 ? GS : String.fromCharCode(c))).join('');
  if (!/^[0-9]/.test(reduced)) throw new BarcodeDataError('GS1 DataBar Expanded: data must start with an application identifier', 'EC-1200');
  const hri = gs1Hri(reduced.split(GS).filter(Boolean));
  if (hri === null) throw new BarcodeDataError('GS1 DataBar Expanded: invalid application identifier data', 'EC-1200');
  return expanded(reduced, modifier === 0x11 ? 0 : modifier - 0x11, hri);
}
