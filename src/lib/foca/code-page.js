/**
 * AFP code page resources: tables that say which character each byte value (code point) of the
 * text stands for. Characters are named by an 8-character Graphic Character Global Identifier
 * (GCGID), e.g. "LA010000" for small a; fonts look up glyphs by these names.
 *
 * Fields (FOCA Reference, "Begin Code Page", "Code Page Descriptor", "Code Page Control",
 * "Code Page Index"):
 * - CPD: description (32 bytes EBCDIC), GCGID length (2), number of code points (4),
 *   GCSGID (2), CPGID (2) — CPGID 0 means "not specified" (common in practice).
 * - CPC: default character GCGID (8), flags (1), CPI repeating group length (1: 10 for
 *   single-byte, 11 for double-byte code points), variable-space section (1) and code point (1),
 *   flags (1).
 * - CPI: repeating groups of GCGID (8), flags (1), code point (1 or 2 bytes).
 */

import { collectFields, fieldData } from '../modca/access.js';
import { u, ebcdicName } from '../modca/bytes.js';

const BCP = 0xd3a887;
const CPD = 0xd3a687;
const CPC = 0xd3a787;
const CPI = 0xd38c87;

/**
 * @typedef {object} CodePage
 * @property {string} name Resource name, e.g. "T1V10500".
 * @property {string} description Description from the descriptor.
 * @property {number} cpgid Code page global identifier (0 = not specified).
 * @property {number} gcsgid Graphic character set identifier.
 * @property {boolean} doubleByte True if code points are two bytes.
 * @property {string} defaultGcgid Character used for undefined code points.
 * @property {number|null} variableSpace Code point of the variable space character.
 * @property {Map<number, {gcgid: string, flags: number}>} map Code point → character.
 */

/**
 * Reads a code page resource.
 * @param {import('../modca/access.js').FileRecord} file File containing the code page.
 * @param {number} beginRow Row of its Begin Code Page field.
 * @returns {Promise<CodePage>} The code page.
 */
export async function readCodePage(file, beginRow) {
  const name = ebcdicName(await fieldData(file, beginRow));
  const fields = await collectFields(file, beginRow, new Set([CPD, CPC, CPI]));
  const cp = {
    name,
    description: '',
    cpgid: 0,
    gcsgid: 0,
    doubleByte: false,
    defaultGcgid: null,
    variableSpace: null,
    map: new Map(),
  };
  let rgLen = 10;
  for (const { id, data } of fields) {
    if (id === CPD) {
      cp.description = ebcdicName(data, 0, 32);
      cp.gcsgid = u(data, 38, 2);
      cp.cpgid = u(data, 40, 2);
    } else if (id === CPC) {
      cp.defaultGcgid = ebcdicName(data, 0, 8) || null;
      rgLen = data[9] || 10;
      cp.doubleByte = rgLen === 11 || rgLen === 0x0f;
      // Variable space character: section number (byte 10) and code point (byte 11).
      cp.variableSpace = data.length > 11 ? (cp.doubleByte ? u(data, 10, 2) : data[11]) : null;
    } else if (id === CPI) {
      for (let pos = 0; pos + rgLen <= data.length; pos += rgLen) {
        const gcgid = ebcdicName(data, pos, 8);
        const flags = data[pos + 8];
        const codePoint = cp.doubleByte ? u(data, pos + 9, 2) : data[pos + 9];
        cp.map.set(codePoint, { gcgid, flags });
      }
    }
  }
  return cp;
}

/**
 * Tells whether a file starts with a code page (used when a resource is looked up by name).
 * @param {number} id Begin field identifier.
 * @returns {boolean} True for Begin Code Page.
 */
export function isCodePageBegin(id) {
  return id === BCP;
}
