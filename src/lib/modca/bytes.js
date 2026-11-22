/**
 * Small helpers for reading AFP field data: big-endian numbers, signed numbers, orientations,
 * EBCDIC names and measurement units.
 *
 * AFP stores numbers most significant byte first. Positions are often 3-byte signed numbers
 * (two's complement). Orientations are 2-byte values whose high 9 bits are degrees and low 7 bits
 * minutes: X'0000' = 0°, X'2D00' = 90°, X'5A00' = 180°, X'8700' = 270° (MO:DCA Reference,
 * AFPC-0004, "Orientation" in the Object Area Position field).
 */

import { sbcs as EBCDIC_500 } from '../codepages/tables/ebcdic-500.js';

/**
 * Reads an unsigned big-endian number.
 * @param {Uint8Array} d Bytes.
 * @param {number} at Start position.
 * @param {number} n Number of bytes (1–4).
 * @returns {number} The number; bytes past the end count as 0.
 */
export function u(d, at, n) {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + (d[at + i] ?? 0);
  return v;
}

/**
 * Reads a signed (two's complement) big-endian number.
 * @param {Uint8Array} d Bytes.
 * @param {number} at Start position.
 * @param {number} n Number of bytes (1–4).
 * @returns {number} The number.
 */
export function s(d, at, n) {
  const v = u(d, at, n);
  const half = 2 ** (8 * n - 1);
  return v >= half ? v - 2 * half : v;
}

/**
 * Converts an AFP orientation value to degrees.
 * @param {number} value 2-byte orientation, e.g. 0x2D00.
 * @returns {number} Degrees (0, 90, 180, 270; other angles are kept as computed).
 */
export function orientation(value) {
  return ((value >> 7) + (value & 0x7f) / 60) % 360;
}

/**
 * Decodes an 8-byte resource or object name (EBCDIC code page 500) and removes trailing blanks.
 * Names made only of X'FF' (meaning "no name") give an empty string.
 * @param {Uint8Array} d Bytes.
 * @param {number} [at] Start position.
 * @param {number} [n] Number of bytes (default 8).
 * @returns {string} The name.
 */
export function ebcdicName(d, at = 0, n = 8) {
  let out = '';
  for (let i = at; i < at + n && i < d.length; i++) {
    const b = d[i];
    if (b === 0xff || b === 0x00) {
      if (out === '') continue;
      break;
    }
    const cp = EBCDIC_500[b];
    out += cp === 0xffff ? '?' : String.fromCharCode(cp);
  }
  return out.trimEnd();
}

/**
 * Returns how many page units (1/1440 inch) one measurement unit is.
 * @param {number} base Unit base: 0 = ten inches, 1 = ten centimeters.
 * @param {number} unitsPerBase Units per unit base, e.g. 14400 (= 1440 per inch).
 * @returns {number} Factor to multiply values with; 1 for invalid input.
 */
export function toPageUnits(base, unitsPerBase) {
  if (!unitsPerBase) return 1;
  const baseInPageUnits = base === 1 ? 14400 / 2.54 : 14400; // 10 cm or 10 inches in 1/1440 inch
  return baseInPageUnits / unitsPerBase;
}

/**
 * Formats bytes as upper-case hex text.
 * @param {Uint8Array} d Bytes.
 * @returns {string} Hex text.
 */
export function hexText(d) {
  return Array.from(d, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

/**
 * Splits a byte sequence into triplets: [{ id, body }].
 * @param {Uint8Array} d Bytes containing triplets.
 * @param {number} [at] Start position.
 * @returns {{id: number, body: Uint8Array}[]} Triplets (stops at the first malformed one).
 */
export function triplets(d, at = 0) {
  const out = [];
  let pos = at;
  while (pos + 2 <= d.length) {
    const len = d[pos];
    if (len < 2 || pos + len > d.length) break;
    out.push({ id: d[pos + 1], body: d.subarray(pos + 2, pos + len) });
    pos += len;
  }
  return out;
}
