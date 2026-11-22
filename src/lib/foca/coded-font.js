/**
 * AFP coded fonts: a coded font names the pair (font character set, code page) that together
 * turn text bytes into glyphs. Documents usually refer to coded fonts (names starting "X0",
 * "X1" …), which point to a character set ("C0…") and a code page ("T1…").
 *
 * Fields (FOCA Reference, "Begin Coded Font", "Coded Font Control", "Coded Font Index"):
 * - CFC: repeating group length (1, normally X'19' = 25), retired byte.
 * - CFI: repeating groups of font character set name (8), code page name (8), specified
 *   vertical size (2), specified horizontal scale (2), reserved (4), section number (1).
 */

import { collectFields, fieldData } from '../modca/access.js';
import { u, ebcdicName } from '../modca/bytes.js';

const CFC = 0xd3a78a;
const CFI = 0xd38c8a;

/**
 * @typedef {object} CodedFont
 * @property {string} name Coded font name.
 * @property {{fcsName: string, cpName: string, verticalSize: number, horizontalScale: number,
 *   section: number}[]} parts Character set and code page per section (one for single-byte fonts).
 */

/**
 * Reads a coded font resource.
 * @param {import('../modca/access.js').FileRecord} file File containing the coded font.
 * @param {number} beginRow Row of its Begin Coded Font field.
 * @returns {Promise<CodedFont>} The coded font.
 */
export async function readCodedFont(file, beginRow) {
  const name = ebcdicName(await fieldData(file, beginRow));
  let rgLen = 25;
  const parts = [];
  for (const { id, data } of await collectFields(file, beginRow, new Set([CFC, CFI]))) {
    if (id === CFC) rgLen = data[0] || 25;
    else {
      for (let pos = 0; pos + 17 <= data.length; pos += rgLen) {
        parts.push({
          fcsName: ebcdicName(data, pos, 8),
          cpName: ebcdicName(data, pos + 8, 8),
          verticalSize: u(data, pos + 16, 2),
          horizontalScale: u(data, pos + 18, 2),
          section: data[pos + 24] ?? 0,
        });
      }
    }
  }
  return { name, parts };
}
