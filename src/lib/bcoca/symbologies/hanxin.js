/**
 * Han Xin Code (task T291; BCOCA type X'27', ISO/IEC 20830:2021): versions 1–84, error
 * correction levels 1–4, ECI, and the numeric, text, binary, Chinese region 1 and 2, GB 18030
 * double-byte and four-byte modes (chosen per character for the shortest bit stream). The
 * Unicode, URI and GS1 modes are not implemented (as in Zint and BWIPP).
 *
 * Ported from Zint (backend/hanxin.c and hanxin.h, version 2.16.0), whose mode selection is
 * adapted from Project Nayuki's QR Code generator (MIT License):
 *
 *   Copyright (C) 2009-2025 Robin Stuart <rstuart114@gmail.com>
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

import { BarcodeDataError } from './linear.js';
import { rsEncode } from './reed-solomon.js';

/** Reed–Solomon codes: data over GF(256) with x^8 + x^6 + x^5 + x + 1, function information over GF(16). */
const HANXIN_RS = Object.freeze({ poly: 0x163, first: 1 });
const HANXIN_FI_RS = Object.freeze({ poly: 0x13, first: 1 });

/** Total codewords per version (Table B1). */
const TOTAL = [
  25, 37, 50, 54, 69, 84, 100, 117, 136, 155, 161, 181, 203, 225, 249, 273, 299, 325, 353, 381,
  411, 422, 453, 485, 518, 552, 587, 623, 660, 698, 737, 754, 794, 836, 878, 922, 966, 1011, 1058, 1105,
  1126, 1175, 1224, 1275, 1327, 1380, 1434, 1489, 1513, 1569, 1628, 1686, 1745, 1805, 1867, 1929, 1992, 2021, 2086, 2151,
  2218, 2286, 2355, 2425, 2496, 2528, 2600, 2673, 2749, 2824, 2900, 2977, 3056, 3135, 3171, 3252, 3334, 3416, 3500, 3585,
  3671, 3758, 3798, 3886,
];
/** Data codewords per error correction level and version (Table B1). */
const DATA = [
  [21, 31, 42, 46, 57, 70, 84, 99, 114, 131, 135, 153, 171, 189, 209, 229, 251, 273, 297, 321, 345, 354, 381, 407, 436, 464, 493, 523, 554, 586, 619, 634, 666, 702, 738, 774, 812, 849, 888, 929, 946, 987, 1028, 1071, 1115, 1160, 1204, 1251, 1271, 1317, 1368, 1416, 1465, 1517, 1569, 1621, 1674, 1697, 1752, 1807, 1864, 1920, 1979, 2037, 2096, 2124, 2184, 2245, 2309, 2372, 2436, 2501, 2568, 2633, 2663, 2732, 2800, 2870, 2940, 3011, 3083, 3156, 3190, 3264],
  [17, 25, 34, 38, 49, 58, 70, 81, 96, 109, 113, 127, 143, 157, 175, 191, 209, 227, 247, 267, 287, 296, 317, 339, 362, 386, 411, 437, 462, 488, 515, 528, 556, 586, 614, 646, 676, 707, 740, 773, 788, 823, 856, 893, 929, 966, 1004, 1043, 1059, 1099, 1140, 1180, 1221, 1263, 1307, 1351, 1394, 1415, 1460, 1505, 1552, 1600, 1649, 1697, 1748, 1770, 1820, 1871, 1925, 1976, 2030, 2083, 2140, 2195, 2219, 2276, 2334, 2392, 2450, 2509, 2569, 2630, 2658, 2720],
  [13, 19, 26, 30, 37, 46, 54, 63, 74, 83, 87, 97, 109, 121, 135, 147, 161, 175, 191, 205, 221, 228, 245, 261, 280, 298, 317, 337, 358, 376, 397, 408, 428, 452, 474, 498, 522, 545, 572, 597, 608, 635, 660, 689, 717, 746, 774, 805, 817, 847, 880, 910, 943, 975, 1009, 1041, 1076, 1091, 1126, 1161, 1198, 1234, 1271, 1309, 1348, 1366, 1404, 1443, 1485, 1524, 1566, 1607, 1650, 1693, 1713, 1756, 1800, 1844, 1890, 1935, 1983, 2030, 2050, 2098],
  [9, 15, 20, 22, 27, 34, 40, 47, 54, 61, 65, 73, 81, 89, 99, 109, 119, 129, 141, 153, 165, 168, 181, 195, 208, 220, 235, 251, 264, 280, 295, 302, 318, 334, 352, 368, 386, 405, 424, 441, 450, 469, 490, 509, 531, 552, 574, 595, 605, 627, 652, 674, 697, 721, 747, 771, 796, 809, 834, 861, 892, 914, 941, 969, 998, 1012, 1040, 1069, 1099, 1130, 1160, 1191, 1222, 1253, 1269, 1300, 1334, 1366, 1400, 1433, 1469, 1504, 1520, 1554],
];
/** Alignment pattern parameters k, r and m per version (Annex A). */
const MODULE_K = [0, 0, 0, 14, 16, 16, 17, 18, 19, 20, 14, 15, 16, 16, 17, 17, 18, 19, 20, 20, 21, 16, 17, 17, 18, 18, 19, 19, 20, 20, 21, 17, 17, 18, 18, 19, 19, 19, 20, 20, 17, 17, 18, 18, 18, 19, 19, 19, 17, 17, 18, 18, 18, 18, 19, 19, 19, 17, 17, 18, 18, 18, 18, 19, 19, 17, 17, 17, 18, 18, 18, 18, 19, 19, 17, 17, 17, 18, 18, 18, 18, 18, 17, 17];
const MODULE_R = [0, 0, 0, 15, 15, 17, 18, 19, 20, 21, 15, 15, 15, 17, 17, 19, 19, 19, 19, 21, 21, 17, 16, 18, 17, 19, 18, 20, 19, 21, 20, 17, 19, 17, 19, 17, 19, 21, 19, 21, 18, 20, 17, 19, 21, 18, 20, 22, 17, 19, 15, 17, 19, 21, 17, 19, 21, 18, 20, 15, 17, 19, 21, 16, 18, 17, 19, 21, 15, 17, 19, 21, 15, 17, 18, 20, 22, 15, 17, 19, 21, 23, 17, 19];
const MODULE_M = [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 9, 10, 10];
/** Error correction blocks (Table D1): per version and level three groups of block count, data and check codewords. */
const BLOCKS = [
  1, 21, 4, 0, 0, 0, 0, 0, 0, 1, 17, 8, 0, 0, 0, 0, 0, 0, 1, 13, 12, 0, 0, 0, 0, 0, 0, 1, 9, 16, 0, 0, 0, 0, 0, 0,
  1, 31, 6, 0, 0, 0, 0, 0, 0, 1, 25, 12, 0, 0, 0, 0, 0, 0, 1, 19, 18, 0, 0, 0, 0, 0, 0, 1, 15, 22, 0, 0, 0, 0, 0, 0,
  1, 42, 8, 0, 0, 0, 0, 0, 0, 1, 34, 16, 0, 0, 0, 0, 0, 0, 1, 26, 24, 0, 0, 0, 0, 0, 0, 1, 20, 30, 0, 0, 0, 0, 0, 0,
  1, 46, 8, 0, 0, 0, 0, 0, 0, 1, 38, 16, 0, 0, 0, 0, 0, 0, 1, 30, 24, 0, 0, 0, 0, 0, 0, 1, 22, 32, 0, 0, 0, 0, 0, 0,
  1, 57, 12, 0, 0, 0, 0, 0, 0, 1, 49, 20, 0, 0, 0, 0, 0, 0, 1, 37, 32, 0, 0, 0, 0, 0, 0, 1, 14, 20, 1, 13, 22, 0, 0, 0,
  1, 70, 14, 0, 0, 0, 0, 0, 0, 1, 58, 26, 0, 0, 0, 0, 0, 0, 1, 24, 20, 1, 22, 18, 0, 0, 0, 1, 16, 24, 1, 18, 26, 0, 0, 0,
  1, 84, 16, 0, 0, 0, 0, 0, 0, 1, 70, 30, 0, 0, 0, 0, 0, 0, 1, 26, 22, 1, 28, 24, 0, 0, 0, 2, 14, 20, 1, 12, 20, 0, 0, 0,
  1, 99, 18, 0, 0, 0, 0, 0, 0, 1, 40, 18, 1, 41, 18, 0, 0, 0, 1, 31, 26, 1, 32, 28, 0, 0, 0, 2, 16, 24, 1, 15, 22, 0, 0, 0,
  1, 114, 22, 0, 0, 0, 0, 0, 0, 2, 48, 20, 0, 0, 0, 0, 0, 0, 2, 24, 20, 1, 26, 22, 0, 0, 0, 2, 18, 28, 1, 18, 26, 0, 0, 0,
  1, 131, 24, 0, 0, 0, 0, 0, 0, 1, 52, 22, 1, 57, 24, 0, 0, 0, 2, 27, 24, 1, 29, 24, 0, 0, 0, 2, 21, 32, 1, 19, 30, 0, 0, 0,
  1, 135, 26, 0, 0, 0, 0, 0, 0, 1, 56, 24, 1, 57, 24, 0, 0, 0, 2, 28, 24, 1, 31, 26, 0, 0, 0, 2, 22, 32, 1, 21, 32, 0, 0, 0,
  1, 153, 28, 0, 0, 0, 0, 0, 0, 1, 62, 26, 1, 65, 28, 0, 0, 0, 2, 32, 28, 1, 33, 28, 0, 0, 0, 3, 17, 26, 1, 22, 30, 0, 0, 0,
  1, 86, 16, 1, 85, 16, 0, 0, 0, 1, 71, 30, 1, 72, 30, 0, 0, 0, 2, 37, 32, 1, 35, 30, 0, 0, 0, 3, 20, 30, 1, 21, 32, 0, 0, 0,
  1, 94, 18, 1, 95, 18, 0, 0, 0, 2, 51, 22, 1, 55, 24, 0, 0, 0, 3, 30, 26, 1, 31, 26, 0, 0, 0, 4, 18, 28, 1, 17, 24, 0, 0, 0,
  1, 104, 20, 1, 105, 20, 0, 0, 0, 2, 57, 24, 1, 61, 26, 0, 0, 0, 3, 33, 28, 1, 36, 30, 0, 0, 0, 4, 20, 30, 1, 19, 30, 0, 0, 0,
  1, 115, 22, 1, 114, 22, 0, 0, 0, 2, 65, 28, 1, 61, 26, 0, 0, 0, 3, 38, 32, 1, 33, 30, 0, 0, 0, 5, 19, 28, 1, 14, 24, 0, 0, 0,
  1, 126, 24, 1, 125, 24, 0, 0, 0, 2, 70, 30, 1, 69, 30, 0, 0, 0, 4, 33, 28, 1, 29, 26, 0, 0, 0, 5, 20, 30, 1, 19, 30, 0, 0, 0,
  1, 136, 26, 1, 137, 26, 0, 0, 0, 3, 56, 24, 1, 59, 26, 0, 0, 0, 5, 35, 30, 0, 0, 0, 0, 0, 0, 6, 18, 28, 1, 21, 28, 0, 0, 0,
  1, 148, 28, 1, 149, 28, 0, 0, 0, 3, 61, 26, 1, 64, 28, 0, 0, 0, 7, 24, 20, 1, 23, 22, 0, 0, 0, 6, 20, 30, 1, 21, 32, 0, 0, 0,
  3, 107, 20, 0, 0, 0, 0, 0, 0, 3, 65, 28, 1, 72, 30, 0, 0, 0, 7, 26, 22, 1, 23, 22, 0, 0, 0, 7, 19, 28, 1, 20, 32, 0, 0, 0,
  3, 115, 22, 0, 0, 0, 0, 0, 0, 4, 56, 24, 1, 63, 28, 0, 0, 0, 7, 28, 24, 1, 25, 22, 0, 0, 0, 8, 18, 28, 1, 21, 22, 0, 0, 0,
  2, 116, 22, 1, 122, 24, 0, 0, 0, 4, 56, 24, 1, 72, 30, 0, 0, 0, 7, 28, 24, 1, 32, 26, 0, 0, 0, 8, 18, 28, 1, 24, 30, 0, 0, 0,
  3, 127, 24, 0, 0, 0, 0, 0, 0, 5, 51, 22, 1, 62, 26, 0, 0, 0, 7, 30, 26, 1, 35, 26, 0, 0, 0, 8, 20, 30, 1, 21, 32, 0, 0, 0,
  2, 135, 26, 1, 137, 26, 0, 0, 0, 5, 56, 24, 1, 59, 26, 0, 0, 0, 7, 33, 28, 1, 30, 28, 0, 0, 0, 11, 16, 24, 1, 19, 26, 0, 0, 0,
  3, 105, 20, 1, 121, 22, 0, 0, 0, 5, 61, 26, 1, 57, 26, 0, 0, 0, 9, 28, 24, 1, 28, 22, 0, 0, 0, 10, 19, 28, 1, 18, 30, 0, 0, 0,
  2, 157, 30, 1, 150, 28, 0, 0, 0, 5, 65, 28, 1, 61, 26, 0, 0, 0, 8, 33, 28, 1, 34, 30, 0, 0, 0, 10, 19, 28, 2, 15, 26, 0, 0, 0,
  3, 126, 24, 1, 115, 22, 0, 0, 0, 7, 51, 22, 1, 54, 22, 0, 0, 0, 8, 35, 30, 1, 37, 30, 0, 0, 0, 15, 15, 22, 1, 10, 22, 0, 0, 0,
  4, 105, 20, 1, 103, 20, 0, 0, 0, 7, 56, 24, 1, 45, 18, 0, 0, 0, 10, 31, 26, 1, 27, 26, 0, 0, 0, 10, 17, 26, 3, 20, 28, 1, 21, 28,
  3, 139, 26, 1, 137, 28, 0, 0, 0, 6, 66, 28, 1, 66, 30, 0, 0, 0, 9, 36, 30, 1, 34, 32, 0, 0, 0, 13, 19, 28, 1, 17, 32, 0, 0, 0,
  6, 84, 16, 1, 82, 16, 0, 0, 0, 6, 70, 30, 1, 68, 30, 0, 0, 0, 7, 35, 30, 3, 33, 28, 1, 32, 28, 13, 20, 30, 1, 20, 28, 0, 0, 0,
  5, 105, 20, 1, 94, 18, 0, 0, 0, 6, 74, 32, 1, 71, 30, 0, 0, 0, 11, 33, 28, 1, 34, 32, 0, 0, 0, 13, 19, 28, 3, 16, 26, 0, 0, 0,
  4, 127, 24, 1, 126, 24, 0, 0, 0, 7, 66, 28, 1, 66, 30, 0, 0, 0, 12, 30, 24, 1, 24, 28, 1, 24, 30, 15, 19, 28, 1, 17, 32, 0, 0, 0,
  7, 84, 16, 1, 78, 16, 0, 0, 0, 7, 70, 30, 1, 66, 28, 0, 0, 0, 12, 33, 28, 1, 32, 30, 0, 0, 0, 14, 21, 32, 1, 24, 28, 0, 0, 0,
  5, 117, 22, 1, 117, 24, 0, 0, 0, 8, 66, 28, 1, 58, 26, 0, 0, 0, 11, 38, 32, 1, 34, 32, 0, 0, 0, 15, 20, 30, 2, 17, 26, 0, 0, 0,
  4, 148, 28, 1, 146, 28, 0, 0, 0, 8, 68, 30, 1, 70, 24, 0, 0, 0, 10, 36, 32, 3, 38, 28, 0, 0, 0, 16, 19, 28, 3, 16, 26, 0, 0, 0,
  4, 126, 24, 2, 135, 26, 0, 0, 0, 8, 70, 28, 2, 43, 26, 0, 0, 0, 13, 32, 28, 2, 41, 30, 0, 0, 0, 17, 19, 28, 3, 15, 26, 0, 0, 0,
  5, 136, 26, 1, 132, 24, 0, 0, 0, 5, 67, 30, 4, 68, 28, 1, 69, 28, 14, 35, 30, 1, 32, 24, 0, 0, 0, 18, 18, 26, 3, 16, 28, 1, 14, 28,
  3, 142, 26, 3, 141, 28, 0, 0, 0, 8, 70, 30, 1, 73, 32, 1, 74, 32, 12, 34, 30, 3, 34, 26, 1, 35, 28, 18, 21, 32, 1, 27, 30, 0, 0, 0,
  5, 116, 22, 2, 103, 20, 1, 102, 20, 9, 74, 32, 1, 74, 30, 0, 0, 0, 14, 34, 28, 2, 32, 32, 1, 32, 30, 19, 21, 32, 1, 25, 26, 0, 0, 0,
  7, 116, 22, 1, 117, 22, 0, 0, 0, 11, 65, 28, 1, 58, 24, 0, 0, 0, 15, 38, 32, 1, 27, 28, 0, 0, 0, 20, 20, 30, 1, 20, 32, 1, 21, 32,
  6, 136, 26, 1, 130, 24, 0, 0, 0, 11, 66, 28, 1, 62, 30, 0, 0, 0, 14, 34, 28, 3, 34, 32, 1, 30, 30, 18, 20, 30, 3, 20, 28, 2, 15, 26,
  5, 105, 20, 2, 115, 22, 2, 116, 22, 10, 75, 32, 1, 73, 32, 0, 0, 0, 16, 38, 32, 1, 27, 28, 0, 0, 0, 22, 19, 28, 2, 16, 30, 1, 19, 30,
  6, 147, 28, 1, 146, 28, 0, 0, 0, 11, 66, 28, 2, 65, 30, 0, 0, 0, 18, 33, 28, 2, 33, 30, 0, 0, 0, 22, 21, 32, 1, 28, 30, 0, 0, 0,
  6, 116, 22, 3, 125, 24, 0, 0, 0, 11, 75, 32, 1, 68, 30, 0, 0, 0, 13, 35, 28, 6, 34, 32, 1, 30, 30, 23, 21, 32, 1, 26, 30, 0, 0, 0,
  7, 105, 20, 4, 95, 18, 0, 0, 0, 12, 67, 28, 1, 63, 30, 1, 62, 32, 21, 31, 26, 2, 33, 32, 0, 0, 0, 23, 21, 32, 2, 24, 30, 0, 0, 0,
  10, 116, 22, 0, 0, 0, 0, 0, 0, 12, 74, 32, 1, 78, 30, 0, 0, 0, 18, 37, 32, 1, 39, 30, 1, 41, 28, 25, 21, 32, 1, 27, 28, 0, 0, 0,
  5, 126, 24, 4, 115, 22, 1, 114, 22, 12, 67, 28, 2, 66, 32, 1, 68, 30, 21, 35, 30, 1, 39, 30, 0, 0, 0, 26, 21, 32, 1, 28, 28, 0, 0, 0,
  9, 126, 24, 1, 117, 22, 0, 0, 0, 13, 75, 32, 1, 68, 30, 0, 0, 0, 20, 35, 30, 3, 35, 28, 0, 0, 0, 27, 21, 32, 1, 28, 30, 0, 0, 0,
  9, 126, 24, 1, 137, 26, 0, 0, 0, 13, 71, 30, 2, 68, 32, 0, 0, 0, 20, 37, 32, 1, 39, 28, 1, 38, 28, 24, 20, 32, 5, 25, 28, 0, 0, 0,
  8, 147, 28, 1, 141, 28, 0, 0, 0, 10, 73, 32, 4, 74, 30, 1, 73, 30, 16, 36, 32, 6, 39, 30, 1, 37, 30, 27, 21, 32, 3, 20, 26, 0, 0, 0,
  9, 137, 26, 1, 135, 26, 0, 0, 0, 12, 70, 30, 4, 75, 32, 0, 0, 0, 24, 35, 30, 1, 40, 28, 0, 0, 0, 23, 20, 32, 8, 24, 30, 0, 0, 0,
  14, 95, 18, 1, 86, 18, 0, 0, 0, 13, 73, 32, 3, 77, 30, 0, 0, 0, 24, 35, 30, 2, 35, 28, 0, 0, 0, 26, 21, 32, 5, 21, 30, 1, 23, 30,
  9, 147, 28, 1, 142, 28, 0, 0, 0, 10, 73, 30, 6, 70, 32, 1, 71, 32, 25, 35, 30, 2, 34, 26, 0, 0, 0, 29, 21, 32, 4, 22, 30, 0, 0, 0,
  11, 126, 24, 1, 131, 24, 0, 0, 0, 16, 74, 32, 1, 79, 30, 0, 0, 0, 25, 38, 32, 1, 25, 30, 0, 0, 0, 33, 21, 32, 1, 28, 28, 0, 0, 0,
  14, 105, 20, 1, 99, 18, 0, 0, 0, 19, 65, 28, 1, 72, 28, 0, 0, 0, 24, 37, 32, 2, 40, 30, 1, 41, 30, 31, 21, 32, 4, 24, 32, 0, 0, 0,
  10, 147, 28, 1, 151, 28, 0, 0, 0, 15, 71, 30, 3, 71, 32, 1, 73, 32, 24, 37, 32, 3, 38, 30, 1, 39, 30, 36, 19, 30, 3, 29, 26, 0, 0, 0,
  15, 105, 20, 1, 99, 18, 0, 0, 0, 19, 70, 30, 1, 64, 28, 0, 0, 0, 27, 38, 32, 2, 25, 26, 0, 0, 0, 38, 20, 30, 2, 18, 28, 0, 0, 0,
  14, 105, 20, 1, 113, 22, 1, 114, 22, 17, 67, 30, 3, 92, 32, 0, 0, 0, 30, 35, 30, 1, 41, 30, 0, 0, 0, 36, 21, 32, 1, 26, 30, 1, 27, 30,
  11, 146, 28, 1, 146, 26, 0, 0, 0, 20, 70, 30, 1, 60, 26, 0, 0, 0, 29, 38, 32, 1, 24, 32, 0, 0, 0, 40, 20, 30, 2, 17, 26, 0, 0, 0,
  3, 137, 26, 1, 136, 26, 10, 126, 24, 22, 65, 28, 1, 75, 30, 0, 0, 0, 30, 37, 32, 1, 51, 30, 0, 0, 0, 42, 20, 30, 1, 21, 30, 0, 0, 0,
  12, 126, 24, 2, 118, 22, 1, 116, 22, 19, 74, 32, 1, 74, 30, 1, 72, 28, 30, 38, 32, 2, 29, 30, 0, 0, 0, 39, 20, 32, 2, 37, 26, 1, 38, 26,
  12, 126, 24, 3, 136, 26, 0, 0, 0, 21, 70, 30, 2, 65, 28, 0, 0, 0, 34, 35, 30, 1, 44, 32, 0, 0, 0, 42, 20, 30, 2, 19, 28, 2, 18, 28,
  12, 126, 24, 3, 117, 22, 1, 116, 22, 25, 61, 26, 2, 62, 28, 0, 0, 0, 34, 35, 30, 1, 40, 32, 1, 41, 32, 45, 20, 30, 1, 20, 32, 1, 21, 32,
  15, 105, 20, 2, 115, 22, 2, 116, 22, 25, 65, 28, 1, 72, 28, 0, 0, 0, 18, 35, 30, 17, 37, 32, 1, 50, 32, 42, 20, 30, 6, 19, 28, 1, 15, 28,
  19, 105, 20, 1, 101, 20, 0, 0, 0, 33, 51, 22, 1, 65, 22, 0, 0, 0, 40, 33, 28, 1, 28, 28, 0, 0, 0, 49, 20, 30, 1, 18, 28, 0, 0, 0,
  18, 105, 20, 2, 117, 22, 0, 0, 0, 26, 65, 28, 1, 80, 30, 0, 0, 0, 35, 35, 30, 3, 35, 28, 1, 36, 28, 52, 18, 28, 2, 38, 30, 0, 0, 0,
  26, 84, 16, 0, 0, 0, 0, 0, 0, 26, 70, 30, 0, 0, 0, 0, 0, 0, 45, 31, 26, 1, 9, 26, 0, 0, 0, 52, 20, 30, 0, 0, 0, 0, 0, 0,
  16, 126, 24, 1, 114, 22, 1, 115, 22, 23, 70, 30, 3, 65, 28, 1, 66, 28, 40, 35, 30, 1, 43, 30, 0, 0, 0, 46, 20, 30, 7, 19, 28, 1, 16, 28,
  19, 116, 22, 1, 105, 22, 0, 0, 0, 20, 70, 30, 7, 66, 28, 1, 63, 28, 40, 35, 30, 1, 42, 32, 1, 43, 32, 54, 20, 30, 1, 19, 30, 0, 0, 0,
  17, 126, 24, 2, 115, 22, 0, 0, 0, 24, 70, 30, 4, 74, 32, 0, 0, 0, 48, 31, 26, 2, 18, 26, 0, 0, 0, 54, 19, 28, 6, 15, 26, 1, 14, 26,
  29, 84, 16, 0, 0, 0, 0, 0, 0, 29, 70, 30, 0, 0, 0, 0, 0, 0, 6, 34, 30, 3, 36, 30, 38, 33, 28, 58, 20, 30, 0, 0, 0, 0, 0, 0,
  16, 147, 28, 1, 149, 28, 0, 0, 0, 31, 66, 28, 1, 37, 26, 0, 0, 0, 48, 33, 28, 1, 23, 26, 0, 0, 0, 53, 20, 30, 6, 19, 28, 1, 17, 28,
  20, 115, 22, 2, 134, 24, 0, 0, 0, 29, 66, 28, 2, 56, 26, 2, 57, 26, 45, 36, 30, 2, 15, 28, 0, 0, 0, 59, 20, 30, 2, 21, 32, 0, 0, 0,
  17, 147, 28, 1, 134, 26, 0, 0, 0, 26, 70, 30, 5, 75, 32, 0, 0, 0, 47, 35, 30, 1, 48, 32, 0, 0, 0, 64, 18, 28, 2, 33, 30, 1, 35, 30,
  22, 115, 22, 1, 133, 24, 0, 0, 0, 33, 65, 28, 1, 74, 28, 0, 0, 0, 43, 36, 30, 5, 27, 28, 1, 30, 28, 57, 20, 30, 5, 21, 32, 1, 24, 32,
  18, 136, 26, 2, 142, 26, 0, 0, 0, 33, 66, 28, 2, 49, 26, 0, 0, 0, 48, 35, 30, 2, 38, 28, 0, 0, 0, 64, 20, 30, 1, 20, 32, 0, 0, 0,
  19, 126, 24, 2, 135, 26, 1, 136, 26, 32, 66, 28, 2, 55, 26, 2, 56, 26, 49, 36, 30, 2, 18, 32, 0, 0, 0, 65, 18, 28, 5, 27, 30, 1, 29, 30,
  20, 137, 26, 1, 130, 26, 0, 0, 0, 30, 75, 32, 2, 71, 32, 0, 0, 0, 46, 35, 30, 6, 39, 32, 0, 0, 0, 3, 12, 30, 70, 19, 28, 0, 0, 0,
  20, 147, 28, 0, 0, 0, 0, 0, 0, 35, 70, 30, 0, 0, 0, 0, 0, 0, 49, 35, 30, 5, 35, 28, 0, 0, 0, 70, 20, 30, 0, 0, 0, 0, 0, 0,
  21, 136, 26, 1, 155, 28, 0, 0, 0, 34, 70, 30, 1, 64, 28, 1, 65, 28, 54, 35, 30, 1, 45, 30, 0, 0, 0, 68, 20, 30, 3, 18, 28, 1, 19, 28,
  19, 126, 24, 5, 115, 22, 1, 114, 22, 33, 70, 30, 3, 65, 28, 1, 64, 28, 52, 35, 30, 3, 41, 32, 1, 40, 32, 67, 20, 30, 5, 21, 32, 1, 24, 32,
  2, 150, 28, 21, 136, 26, 0, 0, 0, 32, 70, 30, 6, 65, 28, 0, 0, 0, 52, 38, 32, 2, 27, 32, 0, 0, 0, 73, 20, 30, 2, 22, 32, 0, 0, 0,
  21, 126, 24, 4, 136, 26, 0, 0, 0, 30, 74, 32, 6, 73, 30, 0, 0, 0, 54, 35, 30, 4, 40, 32, 0, 0, 0, 75, 20, 30, 1, 20, 28, 0, 0, 0,
  30, 105, 20, 1, 114, 22, 0, 0, 0, 3, 45, 22, 55, 47, 20, 0, 0, 0, 2, 26, 26, 62, 33, 28, 0, 0, 0, 79, 18, 28, 4, 33, 30, 0, 0, 0,
];

const NUMERIC = 0;
const TEXT = 1;
const BINARY = 2;
const REGION1 = 3;
const REGION2 = 4;
const DOUBLE = 5;
const FOUR = 6;
const MODES = 7;
/** Bit costs are multiplied by 6 so that per-digit costs stay whole. */
const MULT = 6;
const HEAD_COSTS = [4, 4, 4 + 13, 4, 4, 4, 0].map((c) => c * MULT);
const SWITCH_COSTS = [
  [0, 10 + 4, 10 + 4 + 13, 10 + 4, 10 + 4, 10 + 4, 10],
  [6 + 4, 0, 6 + 4 + 13, 6 + 4, 6 + 4, 6 + 4, 6],
  [4, 4, 0, 4, 4, 4, 0],
  [12 + 4, 12 + 4, 12 + 4 + 13, 0, 12, 12 + 4, 12],
  [12 + 4, 12 + 4, 12 + 4 + 13, 12, 0, 12 + 4, 12],
  [15 + 4, 15 + 4, 15 + 4 + 13, 15 + 4, 15 + 4, 0, 15],
  [4, 4, 4 + 13, 4, 4, 4, 0],
].map((row) => row.map((c) => c * MULT));
const EOD_COSTS = [10, 6, 0, 12, 12, 15, 0].map((c) => c * MULT);

/**
 * Whether a character is a digit.
 * @param {number} c Character.
 * @returns {boolean} Digit.
 */
const isDigit = (c) => c >= 0x30 && c <= 0x39;

/**
 * Whether a character is an upper-case letter.
 * @param {number} c Character.
 * @returns {boolean} Upper-case letter.
 */
const isUpper = (c) => c >= 0x41 && c <= 0x5a;

/**
 * Whether a character is a lower-case letter.
 * @param {number} c Character.
 * @returns {boolean} Lower-case letter.
 */
const isLower = (c) => c >= 0x61 && c <= 0x7a;

/**
 * Text submode of a character.
 * @param {number} c Character.
 * @returns {number} 1 for digits and letters, 2 otherwise.
 */
const submodeOf = (c) => (isDigit(c) || isUpper(c) || isLower(c) ? 1 : 2);

/**
 * Text 1 submode value (Table 3).
 * @param {number} c Character.
 * @returns {number} Value, −1 if none.
 */
function text1(c) {
  if (isDigit(c)) return c - 0x30;
  if (isUpper(c)) return c - 0x41 + 10;
  if (isLower(c)) return c - 0x61 + 36;
  return -1;
}

/**
 * Text 2 submode value (Table 4).
 * @param {number} c Character.
 * @returns {number} Value, −1 if none.
 */
function text2(c) {
  if (c <= 27) return c;
  if (c >= 0x20 && c <= 0x2f) return c - 0x20 + 28;
  if (c >= 0x3a && c <= 0x40) return c - 0x3a + 44;
  if (c >= 0x5b && c <= 0x60) return c - 0x5b + 51;
  if (c >= 0x7b && c <= 0x7f) return c - 0x7b + 57;
  return -1;
}

/**
 * Whether a GB 2312 character is in Chinese region 1 (rows B0–D7, symbols A1–A3, A8A1–A8C0).
 * @param {number} g Two-byte value.
 * @returns {boolean} Region 1.
 */
function isRegion1(g) {
  const hi = g >> 8;
  const lo = g & 0xff;
  if (hi >= 0xb0 && hi <= 0xd7) return lo >= 0xa1 && lo <= 0xfe;
  if (hi >= 0xa1 && hi <= 0xa3) return lo >= 0xa1 && lo <= 0xfe;
  return g >= 0xa8a1 && g <= 0xa8c0;
}

/**
 * Whether a GB 2312 character is in Chinese region 2 (rows D8–F7).
 * @param {number} g Two-byte value.
 * @returns {boolean} Region 2.
 */
function isRegion2(g) {
  return (g >> 8) >= 0xd8 && (g >> 8) <= 0xf7 && (g & 0xff) >= 0xa1 && (g & 0xff) <= 0xfe;
}

/**
 * Whether a value is a GB 18030 two-byte character.
 * @param {number} g Two-byte value.
 * @returns {boolean} Double-byte character.
 */
function isDoubleByte(g) {
  const hi = g >> 8;
  const lo = g & 0xff;
  return hi >= 0x81 && hi <= 0xfe && ((lo >= 0x40 && lo <= 0x7e) || (lo >= 0x80 && lo <= 0xfe));
}

/**
 * Whether two values form a GB 18030 four-byte character.
 * @param {number} g First two bytes.
 * @param {number} g2 Last two bytes.
 * @returns {boolean} Four-byte character.
 */
function isFourByte(g, g2) {
  return (g >> 8) >= 0x81 && (g >> 8) <= 0xfe && (g & 0xff) >= 0x30 && (g & 0xff) <= 0x39
    && (g2 >> 8) >= 0x81 && (g2 >> 8) <= 0xfe && (g2 & 0xff) >= 0x30 && (g2 & 0xff) <= 0x39;
}

/**
 * Splits GB 18030 bytes into code values: two-byte characters become one value, four-byte
 * characters two values.
 * @param {Uint8Array|number[]} b Bytes.
 * @returns {number[]} Values.
 */
function gb18030Values(b) {
  const out = [];
  for (let i = 0; i < b.length; i++) {
    const c1 = b[i];
    if (b.length - i >= 2 && c1 >= 0x81 && c1 <= 0xfe) {
      const c2 = b[i + 1];
      if ((c2 >= 0x40 && c2 <= 0x7e) || (c2 >= 0x80 && c2 <= 0xfe)) {
        out.push((c1 << 8) | c2);
        i++;
        continue;
      }
      if (b.length - i >= 4 && c2 >= 0x30 && c2 <= 0x39 && b[i + 2] >= 0x81 && b[i + 2] <= 0xfe && b[i + 3] >= 0x30 && b[i + 3] <= 0x39) {
        out.push((c1 << 8) | c2, (b[i + 2] << 8) | b[i + 3]);
        i += 3;
        continue;
      }
    }
    out.push(c1);
  }
  return out;
}

/**
 * Chooses the mode of every character with the least number of bits (dynamic programming).
 * @param {number[]} d Values.
 * @returns {number[]} Mode per value.
 */
function defineModes(d) {
  const n = d.length;
  const charModes = Array.from({ length: n }, () => new Array(MODES).fill(-1));
  let prev = [...HEAD_COSTS];
  let numericEnd = 0;
  let numericCost = 0;
  let textSubmode = 1;
  let fourEnd = 0;
  for (let i = 0; i < n; i++) {
    const cur = new Array(MODES).fill(0);
    let t1;
    let t2;
    let inNumeric = i < numericEnd;
    if (!inNumeric) {
      let k = i;
      while (k < n && k < i + 3 && isDigit(d[k])) k++;
      const count = k - i;
      if (count) {
        numericEnd = k;
        numericCost = count === 1 ? 60 : count === 2 ? 30 : 20;
        inNumeric = true;
      } else {
        numericEnd = 0;
      }
    }
    if (inNumeric) {
      cur[NUMERIC] = prev[NUMERIC] + numericCost;
      charModes[i][NUMERIC] = NUMERIC;
      t1 = true;
      t2 = false;
    } else {
      t1 = text1(d[i]) !== -1;
      t2 = text2(d[i]) !== -1;
    }
    if (t1 || t2) {
      if ((textSubmode === 1 && t2) || (textSubmode === 2 && t1)) {
        cur[TEXT] = prev[TEXT] + 72;
        textSubmode = t2 ? 2 : 1;
      } else {
        cur[TEXT] = prev[TEXT] + 36;
      }
      charModes[i][TEXT] = TEXT;
    } else {
      textSubmode = 1;
    }
    cur[BINARY] = prev[BINARY] + (d[i] > 0xff ? 96 : 48);
    charModes[i][BINARY] = BINARY;
    let inFour = i < fourEnd;
    if (!inFour) {
      if (i < n - 1 && isFourByte(d[i], d[i + 1])) { fourEnd = i + 2; inFour = true; } else fourEnd = 0;
    }
    if (inFour) {
      cur[FOUR] = prev[FOUR] + 75;
      charModes[i][FOUR] = FOUR;
    } else if (isDoubleByte(d[i])) {
      cur[DOUBLE] = prev[DOUBLE] + 90;
      charModes[i][DOUBLE] = DOUBLE;
      if (isRegion1(d[i])) {
        cur[REGION1] = prev[REGION1] + 72;
        charModes[i][REGION1] = REGION1;
      } else if (isRegion2(d[i])) {
        cur[REGION2] = prev[REGION2] + 72;
        charModes[i][REGION2] = REGION2;
      }
    }
    if (i === n - 1) {
      for (let j = 0; j < MODES; j++) if (charModes[i][j] !== -1) cur[j] += EOD_COSTS[j];
    }
    for (let j = 0; j < MODES; j++) {
      for (let k = 0; k < MODES; k++) {
        if (j !== k && charModes[i][k] !== -1) {
          const cost = cur[k] + SWITCH_COSTS[k][j];
          if (charModes[i][j] === -1 || cost < cur[j]) {
            cur[j] = cost;
            charModes[i][j] = k;
          }
        }
      }
    }
    prev = cur;
  }
  let mode = 0;
  for (let j = 1; j < MODES; j++) if (prev[j] < prev[mode]) mode = j;
  const modes = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    mode = charModes[i][mode];
    modes[i] = mode;
  }
  return modes;
}

/**
 * Appends a value as bits.
 * @param {number[]} bits Bits.
 * @param {number} value Value.
 * @param {number} count Bits.
 */
function append(bits, value, count) {
  for (let i = count - 1; i >= 0; i--) bits.push(Math.floor(value / 2 ** i) & 1);
}

/**
 * Encodes one segment (with its ECI) into the bit stream.
 * @param {number[]} bits Bits.
 * @param {number[]} d Values.
 * @param {number[]} modes Modes.
 * @param {number} eci ECI number, 0 for none.
 */
function encodeSegment(bits, d, modes, eci) {
  if (eci) {
    append(bits, 8, 4);
    if (eci <= 127) append(bits, eci, 8);
    else if (eci <= 16383) { append(bits, 2, 2); append(bits, eci, 14); } else { append(bits, 6, 3); append(bits, eci, 21); }
  }
  const n = d.length;
  for (let pos = 0; pos < n;) {
    const mode = modes[pos];
    let len = 0;
    let doubles = 0;
    do {
      if (mode === BINARY && d[pos + len] > 0xff) doubles++;
      len++;
    } while (pos + len < n && modes[pos + len] === mode);
    const next = pos + len < n ? modes[pos + len] : -1;
    switch (mode) {
      case NUMERIC: {
        append(bits, 1, 4);
        let count = 0;
        for (let i = 0; i < len; i += count) {
          count = Math.min(3, len - i);
          append(bits, Number(String.fromCharCode(...d.slice(pos + i, pos + i + count))), 10);
        }
        append(bits, 1020 + count, 10);
        break;
      }
      case TEXT: {
        append(bits, 2, 4);
        let sub = 1;
        for (let i = 0; i < len; i++) {
          const c = d[pos + i];
          if (submodeOf(c) !== sub) { append(bits, 62, 6); sub = submodeOf(c); }
          append(bits, sub === 1 ? text1(c) : text2(c), 6);
        }
        append(bits, 63, 6);
        break;
      }
      case BINARY:
        append(bits, 3, 4);
        append(bits, len + doubles, 13);
        for (let i = 0; i < len; i++) append(bits, d[pos + i], d[pos + i] > 0xff ? 16 : 8);
        break;
      case REGION1:
      case REGION2: {
        const other = mode === REGION1 ? REGION2 : REGION1;
        if (pos === 0 || modes[pos - 1] !== other) append(bits, mode === REGION1 ? 4 : 5, 4);
        for (let i = 0; i < len; i++) {
          const g = d[pos + i];
          const hi = g >> 8;
          const lo = g & 0xff;
          let v;
          if (mode === REGION2) v = 0x5e * (hi - 0xd8) + (lo - 0xa1);
          else if (g >= 0xa8a1 && g <= 0xa8c0) v = lo - 0xa1 + 0xfca;
          else if (hi >= 0xa1 && hi <= 0xa3) v = 0x5e * (hi - 0xa1) + (lo - 0xa1) + 0xeb0;
          else v = 0x5e * (hi - 0xb0) + (lo - 0xa1);
          append(bits, v, 12);
        }
        append(bits, next === other ? 4094 : 4095, 12);
        break;
      }
      case DOUBLE:
        append(bits, 6, 4);
        for (let i = 0; i < len; i++) {
          const g = d[pos + i];
          const lo = g & 0xff;
          append(bits, 0xbe * ((g >> 8) - 0x81) + (lo - (lo <= 0x7e ? 0x40 : 0x41)), 15);
        }
        append(bits, 32767, 15);
        break;
      default: // four-byte: a mode indicator per character, no terminator
        for (let i = 0; i < len; i += 2) {
          const a = d[pos + i];
          const b = d[pos + i + 1];
          append(bits, 7, 4);
          append(bits, 0x3138 * ((a >> 8) - 0x81) + 0x04ec * ((a & 0xff) - 0x30) + 0x0a * ((b >> 8) - 0x81) + ((b & 0xff) - 0x30), 21);
        }
        break;
    }
    pos += len;
  }
}

/**
 * Places a 7×7 finder pattern.
 * @param {Uint8Array} grid Grid.
 * @param {number} size Size.
 * @param {number} x Left.
 * @param {number} y Top.
 * @param {number[]} rows Row bit patterns (bit 6 = left).
 */
function finder(grid, size, x, y, rows) {
  for (let xp = 0; xp < 7; xp++) {
    for (let yp = 0; yp < 7; yp++) grid[(yp + y) * size + xp + x] = rows[yp] & (0x40 >> xp) ? 0x11 : 0x10;
  }
}

/**
 * Sets a function module unless it is outside or already set.
 * @param {Uint8Array} grid Grid.
 * @param {number} size Size.
 * @param {number} x X.
 * @param {number} y Y.
 * @param {number} value Value.
 */
function safePlot(grid, size, x, y, value) {
  if (x >= 0 && x < size && y >= 0 && y < size && grid[y * size + x] === 0) grid[y * size + x] = value;
}

/**
 * Places finders, separators, the function information region and alignment patterns.
 * @param {number} size Size.
 * @param {number} version Version.
 * @returns {Uint8Array} Grid (bit 4 marks function modules, bit 0 dark).
 */
function setupGrid(size, version) {
  const grid = new Uint8Array(size * size);
  finder(grid, size, 0, 0, [0x7f, 0x40, 0x5f, 0x50, 0x57, 0x57, 0x57]);
  finder(grid, size, 0, size - 7, [0x7f, 0x01, 0x7d, 0x05, 0x75, 0x75, 0x75]);
  finder(grid, size, size - 7, 0, [0x7f, 0x01, 0x7d, 0x05, 0x75, 0x75, 0x75]);
  finder(grid, size, size - 7, size - 7, [0x75, 0x75, 0x75, 0x05, 0x7d, 0x01, 0x7f]);
  for (let i = 0; i < 8; i++) {
    for (const k of [7 * size + i, i * size + 7, 7 * size + size - i - 1, (size - i - 1) * size + 7,
      i * size + size - 8, (size - 8) * size + i, (size - 8) * size + size - i - 1, (size - i - 1) * size + size - 8]) grid[k] = 0x10;
  }
  for (let i = 0; i < 9; i++) {
    for (const k of [8 * size + i, i * size + 8, 8 * size + size - i - 1, (size - i - 1) * size + 8,
      i * size + size - 9, (size - 9) * size + i, (size - 9) * size + size - i - 1, (size - i - 1) * size + size - 9]) grid[k] = 0x10;
  }
  if (version <= 3) return grid;
  const k = MODULE_K[version - 1];
  const r = MODULE_R[version - 1];
  const m = MODULE_M[version - 1];
  const assistant = (x, y) => {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) safePlot(grid, size, x + dx, y + dy, dx || dy ? 0x10 : 0x11);
  };
  for (let y = 0, my = 0; y < size; my++) {
    if ((my & 1) === 0) { if (m & 1) assistant(0, y); } else {
      if (!(m & 1)) assistant(0, y);
      assistant(size - 1, y);
    }
    y += my < m ? k : r - 1;
  }
  for (let x = size - 1, mx = 0; x >= 0; mx++) {
    if ((mx & 1) === 0) { if (m & 1) assistant(x, size - 1); } else {
      if (!(m & 1)) assistant(x, size - 1);
      assistant(x, 0);
    }
    x -= mx < m ? k : r - 1;
  }
  let columnSwitch = true;
  for (let y = 0, my = 0; y < size; my++) {
    const h = my < m ? k : r - 1;
    let rowSwitch = columnSwitch;
    columnSwitch = !columnSwitch;
    for (let x = size - 1, mx = 0; x >= 0; mx++) {
      const w = mx < m ? k : r - 1;
      if (rowSwitch) {
        if (!(y === 0 && x === size - 1)) {
          safePlot(grid, size, x, y, 0x11);
          safePlot(grid, size, x - 1, y + 1, 0x10);
          for (let i = 1; i <= w; i++) { safePlot(grid, size, x - i, y, 0x11); safePlot(grid, size, x - i - 1, y + 1, 0x10); }
          for (let i = 1; i < h; i++) { safePlot(grid, size, x, y + i, 0x11); safePlot(grid, size, x - 1, y + i + 1, 0x10); }
        }
        rowSwitch = false;
      } else {
        rowSwitch = true;
      }
      x -= w;
    }
    y += h;
  }
  return grid;
}

/**
 * Data and error correction codewords in block order (Table D1).
 * @param {Uint8Array} data Data codewords.
 * @param {number} version Version.
 * @param {number} level Error correction level 1–4.
 * @returns {number[]} Codewords.
 */
function addEcc(data, version, level) {
  const out = [];
  let input = 0;
  const at = (version - 1) * 36 + (level - 1) * 9;
  for (let g = 0; g < 3; g++) {
    const [blocks, dataLength, eccLength] = BLOCKS.slice(at + 3 * g, at + 3 * g + 3);
    for (let b = 0; b < blocks; b++) {
      const block = [];
      for (let j = 0; j < dataLength; j++, input++) block.push(input < data.length ? data[input] : 0);
      out.push(...block, ...rsEncode(block, eccLength, HANXIN_RS));
    }
  }
  return out;
}

/**
 * Writes the function information (version, level, mask and their check codewords).
 * @param {Uint8Array} grid Grid.
 * @param {number} size Size.
 * @param {number} version Version.
 * @param {number} level Level.
 * @param {number} mask Mask.
 */
function setFunctionInfo(grid, size, version, level, mask) {
  const bits = [];
  append(bits, version + 20, 8);
  append(bits, level - 1, 2);
  append(bits, mask, 2);
  const cw = [0, 1, 2].map((i) => bits[i * 4] * 8 + bits[i * 4 + 1] * 4 + bits[i * 4 + 2] * 2 + bits[i * 4 + 3]);
  for (const e of rsEncode(cw, 4, HANXIN_FI_RS)) append(bits, e, 4);
  while (bits.length < 34) bits.push(0);
  for (let i = 0; i < 9; i++) {
    if (bits[i]) { grid[8 * size + i] = 0x01; grid[(size - 9) * size + size - i - 1] = 0x01; }
    if (bits[i + 8]) { grid[(8 - i) * size + 8] = 0x01; grid[(size - 9 + i) * size + size - 9] = 0x01; }
    if (bits[i + 17]) { grid[i * size + size - 9] = 0x01; grid[(size - 1 - i) * size + 8] = 0x01; }
    if (bits[i + 25]) { grid[8 * size + size - 9 + i] = 0x01; grid[(size - 9) * size + 8 - i] = 0x01; }
  }
}

/**
 * Penalty of a masked symbol (Table 9): finder-like 1:1:1:1:3 patterns and runs of 3 or more.
 * @param {Uint8Array} g Modules (0 or 1).
 * @param {number} size Size.
 * @returns {number} Penalty.
 */
function evaluate(g, size) {
  let result = 0;
  const at = (x, y) => g[y * size + x];
  const scan = (get) => {
    for (let a = 0; a < size; a++) {
      for (let b = 0; b <= size - 7; b++) {
        const p = (k) => get(a, b + k);
        if (p(0) && p(1) !== p(5) && p(2) && !p(3) && p(4) && p(6)) {
          let before = 0;
          for (let k = b - 1; k >= b - 3; k--) {
            if (k < 0) { before = 3; break; }
            if (get(a, k)) break;
            before++;
          }
          if (before === 3) result += 50;
          else {
            let after = 0;
            for (let k = b + 7; k <= b + 9; k++) {
              if (k >= size) { after = 3; break; }
              if (get(a, k)) break;
              after++;
            }
            if (after === 3) result += 50;
          }
          b++;
        }
      }
    }
  };
  scan((x, y) => at(x, y));
  scan((y, x) => at(x, y));
  const runs = (get) => {
    for (let a = 0; a < size; a++) {
      let block = 0;
      let state = 0;
      for (let b = 0; b < size; b++) {
        if (get(a, b) === state) block++;
        else {
          if (block >= 3) result += block * 4;
          block = 1;
          state = get(a, b);
        }
      }
      if (block >= 3) result += block * 4;
    }
  };
  runs((x, y) => at(x, y));
  runs((y, x) => at(x, y));
  return result;
}

/**
 * Builds a Han Xin Code symbol.
 * @param {{eci: number|null, bytes: Uint8Array, gb18030?: boolean}[]} segments ECI segments (default
 *   ECI 000003).
 * @param {object} [o] Options.
 * @param {number} [o.version] Version 1–84, 0 for the smallest.
 * @param {number} [o.level] Error correction level 1–4.
 * @param {boolean} [o.strict] Too much data for the version is an error (EC-0F21).
 * @param {number} [o.mask] Mask pattern 0–3 instead of the one with the lowest penalty (tests).
 * @returns {import('./qrcode.js').MatrixSymbol} Symbol.
 */
export function hanXin(segments, { version: wanted = 0, level = 1, strict = false, mask: forced } = {}) {
  if (!(level >= 1 && level <= 4)) throw new BarcodeDataError(`Han Xin Code: invalid error correction level ${level}`, 'EC-0F23');
  if (!(wanted >= 0 && wanted <= 84)) throw new BarcodeDataError(`Han Xin Code: invalid version ${wanted}`, 'EC-0F22');
  const bits = [];
  let previous = 0;
  for (const seg of segments) {
    let eci = seg.eci ?? 0;
    // A segment without an ECI after a non-default one returns to ECI 000003.
    if (!eci && previous && previous !== 3) eci = 3;
    // GB 2312 and GB 18030 data (ECI 000029, 000032, or a segment marked as GB 18030) use the
    // Chinese character modes.
    const d = seg.gb18030 || eci === 29 || eci === 32 ? gb18030Values(seg.bytes) : [...seg.bytes];
    if (d.length) encodeSegment(bits, d, defineModes(d), eci);
    else if (eci) encodeSegment(bits, [], [], eci);
    previous = eci;
  }
  const codewords = Math.ceil(bits.length / 8);
  let version = DATA[level - 1].findIndex((n) => n >= codewords) + 1;
  if (!version) throw new BarcodeDataError(`Han Xin Code: too much data (${codewords} codewords)`, 'EC-0F21');
  if (wanted && wanted < version && strict) {
    throw new BarcodeDataError(`Han Xin Code: data does not fit version ${wanted}`, 'EC-0F21');
  }
  version = Math.max(version, wanted);
  const dataCodewords = DATA[level - 1][version - 1];
  const size = version * 2 + 21;
  const data = new Uint8Array(dataCodewords);
  bits.forEach((b, i) => { if (b) data[i >> 3] |= 0x80 >> (i & 7); });
  const grid = setupGrid(size, version);
  const full = addEcc(data, version, level);
  // Picket fence: codewords in 13 interleaved groups (5.8.2).
  const fence = [];
  for (let start = 0; start < 13; start++) for (let i = start; i < full.length; i += 13) fence.push(full[i]);
  let j = 0;
  for (let i = 0; i < grid.length && j < fence.length * 8; i++) {
    if (grid[i] === 0) {
      if (fence[j >> 3] & (0x80 >> (j & 7))) grid[i] = 0x01;
      j++;
    }
  }
  const mask = new Uint8Array(grid.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = y * size + x;
      if (grid[k] & 0xf0) continue;
      const i = y + 1;
      const jj = x + 1;
      if (((i + jj) & 1) === 0) mask[k] |= 0x02;
      if (((((i + jj) % 3) + (jj % 3)) & 1) === 0) mask[k] |= 0x04;
      if ((((i % jj) + (jj % i) + (i % 3) + (jj % 3)) & 1) === 0) mask[k] |= 0x08;
    }
  }
  const masked = (pattern) => {
    const local = grid.map((v, k) => (pattern && mask[k] & (1 << pattern) ? v ^ 0x01 : v & 0x0f) & 0x0f);
    setFunctionInfo(local, size, version, level, pattern);
    return local;
  };
  let best = 0;
  let bestPenalty = Infinity;
  let bestGrid = null;
  for (let pattern = 0; pattern < 4; pattern++) {
    if (forced !== undefined && pattern !== forced) continue;
    const local = masked(pattern);
    const penalty = evaluate(local.map((v) => v & 1), size);
    if (penalty < bestPenalty) { best = pattern; bestPenalty = penalty; bestGrid = local; }
  }
  const modules = bestGrid.map((v) => v & 1);
  return { rows: size, cols: size, modules, version, level, mask: best };
}
