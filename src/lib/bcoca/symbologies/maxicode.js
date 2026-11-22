/**
 * MaxiCode (task T076), following ISO/IEC 16023: modes 2 and 3 (structured carrier message with
 * numeric or alphanumeric postal code), 4 (standard), 5 (full EEC) and 6 (reader programming);
 * code sets A–E with shifts, latches and locks, numeric shift for 9 digits, ECI, structured
 * append, Reed–Solomon over GF(64) for the primary message and the interleaved secondary message.
 *
 * The code set tables and the codeword-bit → module map (ISO/IEC 16023 Figure 5) are taken from
 * Barcode Writer in Pure PostScript (BWIPP, barcode.ps, encoder "maxicode", bwip-js 4.5.1):
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
 */

import { BarcodeDataError } from './linear.js';

/**
 * Code sets A–E: value 0–63 → byte, or a function name (ECI, PAD, NS, latches LA/LB, shifts
 * SA/SB/SC/SD/SE, SA2/SA3 = shift A for 2/3 characters, locks LKC/LKD/LKE, PD2/PD3 unused here).
 */
const SETS = [
  [
    13, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86,
    87, 88, 89, 90, 'ECI', 28, 29, 30, 'NS', 32, 'PAD', 34, 35, 36, 37, 38, 39, 40, 41, 42, 43,
    44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 'SB', 'SC', 'SD', 'SE', 'LB'
  ],
  [
    96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114,
    115, 116, 117, 118, 119, 120, 121, 122, 'ECI', 28, 29, 30, 'NS', 123, 'PAD', 125, 126, 127,
    59, 60, 61, 62, 63, 91, 92, 93, 94, 95, 32, 44, 46, 47, 58, 64, 33, 124, 'PD2', 'SA2', 'SA3',
    'PD3', 'SA', 'SC', 'SD', 'SE', 'LA'
  ],
  [
    192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209,
    210, 211, 212, 213, 214, 215, 216, 217, 218, 'ECI', 28, 29, 30, 'NS', 219, 220, 221, 222,
    223, 170, 172, 177, 178, 179, 181, 185, 186, 188, 189, 190, 128, 129, 130, 131, 132, 133,
    134, 135, 136, 137, 'LA', 32, 'LKC', 'SD', 'SE', 'LB'
  ],
  [
    224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241,
    242, 243, 244, 245, 246, 247, 248, 249, 250, 'ECI', 28, 29, 30, 'NS', 251, 252, 253, 254,
    255, 161, 168, 171, 175, 176, 180, 183, 184, 187, 191, 138, 139, 140, 141, 142, 143, 144,
    145, 146, 147, 148, 'LA', 32, 'SC', 'LKD', 'SE', 'LB'
  ],
  [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
    26, 'ECI', 'PAD', 'PAD', 27, 'NS', 28, 29, 30, 31, 159, 160, 162, 163, 164, 165, 166, 167,
    169, 173, 174, 182, 149, 150, 151, 152, 153, 154, 155, 156, 157, 158, 'LA', 32, 'SC', 'SD',
    'LKE', 'LB'
  ],
];

/** Value of each byte or function in each code set. */
const VALUES = SETS.map((set) => new Map(set.map((v, i) => [v, i])));
const [A, B] = [0, 1];

/** Module index (row × 30 + column) of each of the 864 codeword bits. */
const MODULE_MAP = [
  469, 529, 286, 316, 347, 346, 673, 672, 703, 702, 647, 676, 283, 282, 313, 312, 370, 610,
  618, 379, 378, 409, 408, 439, 705, 704, 559, 589, 588, 619, 458, 518, 640, 701, 675, 674,
  285, 284, 315, 314, 310, 340, 531, 289, 288, 319, 349, 348, 456, 486, 517, 516, 471, 470,
  369, 368, 399, 398, 429, 428, 549, 548, 579, 578, 609, 608, 649, 648, 679, 678, 709, 708,
  639, 638, 669, 668, 699, 698, 279, 278, 309, 308, 339, 338, 381, 380, 411, 410, 441, 440,
  561, 560, 591, 590, 621, 620, 547, 546, 577, 576, 607, 606, 367, 366, 397, 396, 427, 426,
  291, 290, 321, 320, 351, 350, 651, 650, 681, 680, 711, 710, 1, 0, 31, 30, 61, 60, 3, 2, 33,
  32, 63, 62, 5, 4, 35, 34, 65, 64, 7, 6, 37, 36, 67, 66, 9, 8, 39, 38, 69, 68, 11, 10, 41, 40,
  71, 70, 13, 12, 43, 42, 73, 72, 15, 14, 45, 44, 75, 74, 17, 16, 47, 46, 77, 76, 19, 18, 49,
  48, 79, 78, 21, 20, 51, 50, 81, 80, 23, 22, 53, 52, 83, 82, 25, 24, 55, 54, 85, 84, 27, 26,
  57, 56, 87, 86, 117, 116, 147, 146, 177, 176, 115, 114, 145, 144, 175, 174, 113, 112, 143,
  142, 173, 172, 111, 110, 141, 140, 171, 170, 109, 108, 139, 138, 169, 168, 107, 106, 137,
  136, 167, 166, 105, 104, 135, 134, 165, 164, 103, 102, 133, 132, 163, 162, 101, 100, 131,
  130, 161, 160, 99, 98, 129, 128, 159, 158, 97, 96, 127, 126, 157, 156, 95, 94, 125, 124, 155,
  154, 93, 92, 123, 122, 153, 152, 91, 90, 121, 120, 151, 150, 181, 180, 211, 210, 241, 240,
  183, 182, 213, 212, 243, 242, 185, 184, 215, 214, 245, 244, 187, 186, 217, 216, 247, 246,
  189, 188, 219, 218, 249, 248, 191, 190, 221, 220, 251, 250, 193, 192, 223, 222, 253, 252,
  195, 194, 225, 224, 255, 254, 197, 196, 227, 226, 257, 256, 199, 198, 229, 228, 259, 258,
  201, 200, 231, 230, 261, 260, 203, 202, 233, 232, 263, 262, 205, 204, 235, 234, 265, 264,
  207, 206, 237, 236, 267, 266, 297, 296, 327, 326, 357, 356, 295, 294, 325, 324, 355, 354,
  293, 292, 323, 322, 353, 352, 277, 276, 307, 306, 337, 336, 275, 274, 305, 304, 335, 334,
  273, 272, 303, 302, 333, 332, 271, 270, 301, 300, 331, 330, 361, 360, 391, 390, 421, 420,
  363, 362, 393, 392, 423, 422, 365, 364, 395, 394, 425, 424, 383, 382, 413, 412, 443, 442,
  385, 384, 415, 414, 445, 444, 387, 386, 417, 416, 447, 446, 477, 476, 507, 506, 537, 536,
  475, 474, 505, 504, 535, 534, 473, 472, 503, 502, 533, 532, 455, 454, 485, 484, 515, 514,
  453, 452, 483, 482, 513, 512, 451, 450, 481, 480, 511, 510, 541, 540, 571, 570, 601, 600,
  543, 542, 573, 572, 603, 602, 545, 544, 575, 574, 605, 604, 563, 562, 593, 592, 623, 622,
  565, 564, 595, 594, 625, 624, 567, 566, 597, 596, 627, 626, 657, 656, 687, 686, 717, 716,
  655, 654, 685, 684, 715, 714, 653, 652, 683, 682, 713, 712, 637, 636, 667, 666, 697, 696,
  635, 634, 665, 664, 695, 694, 633, 632, 663, 662, 693, 692, 631, 630, 661, 660, 691, 690,
  721, 720, 751, 750, 781, 780, 723, 722, 753, 752, 783, 782, 725, 724, 755, 754, 785, 784,
  727, 726, 757, 756, 787, 786, 729, 728, 759, 758, 789, 788, 731, 730, 761, 760, 791, 790,
  733, 732, 763, 762, 793, 792, 735, 734, 765, 764, 795, 794, 737, 736, 767, 766, 797, 796,
  739, 738, 769, 768, 799, 798, 741, 740, 771, 770, 801, 800, 743, 742, 773, 772, 803, 802,
  745, 744, 775, 774, 805, 804, 747, 746, 777, 776, 807, 806, 837, 836, 867, 866, 897, 896,
  835, 834, 865, 864, 895, 894, 833, 832, 863, 862, 893, 892, 831, 830, 861, 860, 891, 890,
  829, 828, 859, 858, 889, 888, 827, 826, 857, 856, 887, 886, 825, 824, 855, 854, 885, 884,
  823, 822, 853, 852, 883, 882, 821, 820, 851, 850, 881, 880, 819, 818, 849, 848, 879, 878,
  817, 816, 847, 846, 877, 876, 815, 814, 845, 844, 875, 874, 813, 812, 843, 842, 873, 872,
  811, 810, 841, 840, 871, 870, 901, 900, 931, 930, 961, 960, 903, 902, 933, 932, 963, 962,
  905, 904, 935, 934, 965, 964, 907, 906, 937, 936, 967, 966, 909, 908, 939, 938, 969, 968,
  911, 910, 941, 940, 971, 970, 913, 912, 943, 942, 973, 972, 915, 914, 945, 944, 975, 974,
  917, 916, 947, 946, 977, 976, 919, 918, 949, 948, 979, 978, 921, 920, 951, 950, 981, 980,
  923, 922, 953, 952, 983, 982, 925, 924, 955, 954, 985, 984, 927, 926, 957, 956, 987, 986, 58,
  89, 88, 118, 149, 148, 178, 209, 208, 238, 269, 268, 298, 329, 328, 358, 389, 388, 418, 449,
  448, 478, 509, 508, 538, 569, 568, 598, 629, 628, 658, 689, 688, 718, 749, 748, 778, 809,
  808, 838, 869, 868, 898, 929, 928, 958, 989, 988
];

/** Orientation modules that are always dark. */
const ORIENTATION = [28, 29, 280, 281, 311, 457, 488, 500, 530, 670, 700, 677, 707];

/**
 * Token for an ECI (Extended Channel Interpretation) in the input.
 * @param {number} n ECI number.
 * @returns {{{eci: number}}} Token.
 */
export const maxiEci = (n) => ({ eci: n });

/**
 * Encodes the message into codewords (code set switching after ISO/IEC 16023 and BWIPP).
 * @param {(number|{eci: number})[]} msg Bytes or ECI markers.
 * @returns {number[]} Codewords.
 */
function encodeMessage(msg) {
  const out = [];
  let cset = A;
  const enc = (v, set = cset) => {
    const value = VALUES[set].get(v);
    if (value === undefined) throw new Error(`MaxiCode: ${v} not in set ${set}`);
    out.push(value);
  };
  const digits = (i) => { let n = 0; while (i + n < msg.length && msg[i + n] >= 0x30 && msg[i + n] <= 0x39) n++; return n; };
  const prefix = (set, i) => { let n = 0; while (n < 4 && i + n < msg.length && VALUES[set].has(msg[i + n])) n++; return n; };
  for (let i = 0; i < msg.length;) {
    const c = msg[i];
    if (typeof c === 'object') {
      enc('ECI');
      const n = c.eci;
      if (n <= 31) out.push(n & 63);
      else if (n <= 1023) out.push(((n >> 6) & 31) | 32, n & 63);
      else if (n <= 32767) out.push(((n >> 12) & 47) | 48, (n >> 6) & 63, n & 63);
      else out.push(((n >> 18) & 55) | 56, (n >> 12) & 63, (n >> 6) & 63, n & 63);
      i++;
      continue;
    }
    if (digits(i) >= 9) {
      // Numeric shift: nine digits as a 30-bit number in five codewords.
      const v = Number(String.fromCharCode(...msg.slice(i, i + 9)));
      enc('NS');
      for (let k = 4; k >= 0; k--) out.push(Math.floor(v / 2 ** (6 * k)) & 63);
      i += 9;
      continue;
    }
    if (VALUES[cset].has(c) && typeof SETS[cset][VALUES[cset].get(c)] === 'number') { enc(c); i++; continue; }
    if (cset === A && VALUES[B].has(c)) {
      if (VALUES[B].has(msg[i + 1])) { enc('LB'); cset = B; } else { enc('SB'); enc(c, B); i++; }
      continue;
    }
    if (cset === B && VALUES[A].has(c)) {
      const p = prefix(A, i);
      if (p >= 4) { enc('LA'); cset = A; continue; }
      enc(['SA', 'SA2', 'SA3'][p - 1]);
      for (let k = 0; k < p; k++) enc(msg[i + k], A);
      i += p;
      continue;
    }
    if (VALUES[A].has(c)) { enc('LA'); cset = A; continue; }
    if (VALUES[B].has(c)) { enc('LB'); cset = B; continue; }
    const x = [2, 3, 4].find((s) => VALUES[s].has(c));
    if (x === undefined) throw new BarcodeDataError(`MaxiCode: byte X'${c.toString(16)}' cannot be encoded`);
    const shift = ['SC', 'SD', 'SE'][x - 2];
    const p = prefix(x, i);
    if (p >= 4) { enc(shift); enc(['LKC', 'LKD', 'LKE'][x - 2], x); cset = x; continue; }
    for (let k = 0; k < p; k++) { enc(shift); enc(msg[i + k], x); }
    i += p;
  }
  if (cset !== A && cset !== B) enc('LA');
  return out;
}

/**
 * Reed–Solomon check codewords over GF(64) (polynomial x^6 + x + 1, roots α^1 … α^n).
 * @param {number[]} data Data codewords.
 * @param {number} n Number of check codewords.
 * @returns {number[]} Check codewords.
 */
function rs64(data, n) {
  const exp = [];
  const log = [];
  for (let i = 0, x = 1; i < 63; i++) { exp[i] = x; log[x] = i; x <<= 1; if (x & 64) x ^= 67; }
  const mul = (a, b) => (a && b ? exp[(log[a] + log[b]) % 63] : 0);
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
 * Reads the structured carrier message of modes 2 and 3: optional "[)>RS01GSyy", then postal
 * code, country code and service class separated by GS.
 * @param {number[]} msg Bytes.
 * @param {number} mode 2 or 3.
 * @returns {{primary: number[], rest: number[]}} Primary codewords (10) and remaining data.
 */
function carrierMessage(msg, mode) {
  let head = [];
  let data = msg;
  const fid = [0x5b, 0x29, 0x3e, 0x1e, 0x30, 0x31, 0x1d];
  if (fid.every((b, i) => data[i] === b)) { head = data.slice(0, 9); data = data.slice(9); }
  const fields = [];
  for (let k = 0; k < 3; k++) {
    const gs = data.indexOf(0x1d);
    if (gs < 0) throw new BarcodeDataError(`MaxiCode mode ${mode}: postal code, country code and service class must each end with GS`);
    fields.push(String.fromCharCode(...data.slice(0, gs)));
    data = data.slice(gs + 1);
  }
  const [postal, country, service] = fields;
  if (!/^[0-9]{1,3}$/.test(country) || !/^[0-9]{1,3}$/.test(service)) {
    throw new BarcodeDataError(`MaxiCode mode ${mode}: country code and service class must be 1–3 digits`);
  }
  let pc = 0n;
  if (mode === 2) {
    if (!/^[0-9]{1,9}$/.test(postal)) throw new BarcodeDataError('MaxiCode mode 2: the postal code must be 1–9 digits');
    pc = (BigInt(postal.length) << 30n) | BigInt(postal);
  } else {
    for (const ch of postal.padEnd(6, ' ').slice(0, 6)) {
      const v = VALUES[A].get(ch.charCodeAt(0));
      if (v === undefined || v > 58 || (v >= 27 && v <= 31)) throw new BarcodeDataError('MaxiCode mode 3: invalid character in the postal code');
      pc = (pc << 6n) | BigInt(v);
    }
  }
  // Bit placement of the structured carrier message (60 bits, ISO/IEC 16023 B.2).
  const bits = new Array(60).fill(0);
  const put = (at, value, len) => { for (let i = 0; i < len; i++) bits[at + i] = Number((BigInt(value) >> BigInt(len - 1 - i)) & 1n); };
  const pcb = (from, len) => (pc >> BigInt(36 - from - len)) & ((1n << BigInt(len)) - 1n);
  put(2, mode, 4);
  put(38, pcb(0, 4), 4); put(30, pcb(4, 6), 6); put(24, pcb(10, 6), 6); put(18, pcb(16, 6), 6);
  put(12, pcb(22, 6), 6); put(6, pcb(28, 6), 6); put(0, pcb(34, 2), 2);
  const cc = Number(country);
  const sc = Number(service);
  put(52, cc >> 8, 2); put(42, (cc >> 2) & 63, 6); put(36, cc & 3, 2);
  put(54, sc >> 4, 6); put(48, sc & 15, 4);
  const primary = [];
  for (let i = 0; i < 10; i++) primary.push(bits.slice(i * 6, i * 6 + 6).reduce((a, x) => (a << 1) | x, 0));
  return { primary, rest: [...head, ...data] };
}

/**
 * Builds a MaxiCode symbol.
 * @param {(number|{eci: number})[]} msg Bytes or ECI markers.
 * @param {object} o Options.
 * @param {number} o.mode Mode 2–6.
 * @param {{index: number, total: number}|null} [o.structured] Structured append.
 * @returns {{rows: number, cols: number, modules: Uint8Array, hexagonal: true}} 33 rows of 30
 *   modules; odd rows are offset by half a module.
 */
export function maxiCode(msg, o) {
  const { mode } = o;
  if (!(mode >= 2 && mode <= 6)) throw new BarcodeDataError(`MaxiCode: invalid symbol mode ${mode}`, 'EC-0F05');
  const sa = o.structured ? [33, (o.structured.index - 1) * 8 + (o.structured.total - 1)] : [];
  let primary;
  let secondary;
  if (mode === 2 || mode === 3) {
    const bytes = msg.map((x) => (typeof x === 'object' ? -1 : x));
    if (bytes.includes(-1)) throw new BarcodeDataError(`MaxiCode mode ${mode}: no ECI in the structured carrier message`);
    const scm = carrierMessage(bytes, mode);
    primary = scm.primary;
    secondary = [...sa, ...encodeMessage(scm.rest)];
    if (secondary.length > 84) throw new BarcodeDataError('MaxiCode: the secondary message is too long');
    while (secondary.length < 84) secondary.push(33);
  } else {
    const size = mode === 5 ? 78 : 94;
    const enc = [mode, ...sa, ...encodeMessage(msg)];
    if (enc.length > size) throw new BarcodeDataError('MaxiCode: the message is too long');
    while (enc.length < size) enc.push(33);
    primary = enc.slice(0, 10);
    secondary = enc.slice(10);
  }
  const checks = secondary.length === 84 ? 20 : 28;
  const odd = rs64(secondary.filter((_, i) => i % 2 === 0), checks);
  const even = rs64(secondary.filter((_, i) => i % 2 === 1), checks);
  const codewords = [...primary, ...rs64(primary, 10), ...secondary, ...odd.flatMap((v, i) => [v, even[i]])];
  const modules = new Uint8Array(33 * 30);
  codewords.forEach((cw, i) => {
    for (let b = 0; b < 6; b++) if ((cw >> (5 - b)) & 1) modules[MODULE_MAP[i * 6 + b]] = 1;
  });
  for (const m of ORIENTATION) modules[m] = 1;
  return { rows: 33, cols: 30, modules, hexagonal: true };
}
