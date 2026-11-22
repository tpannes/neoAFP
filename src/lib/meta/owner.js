/**
 * Where a structured field belongs: its owning page, page group, document or object, page
 * numbers, names of Begin fields, and the code page inherited from the Coded Graphic Character
 * Set Global Identifier triplets X'01' of enclosing Begin fields (MO:DCA Reference, triplet
 * X'01': the code page applies to CHAR parameters of the field and, for TLEs, "if not present,
 * the including object specifies the code page").
 */

import { fieldData } from '../modca/access.js';
import { ebcdicName } from '../modca/bytes.js';
import { lookupField } from '../modca/registry/index.js';
import { parseTriplets } from '../modca/registry/triplets.js';
import { codePageIdFromCcsid } from '../codepages/index.js';

export const BPF = 0xd3a8a5;
export const BDT = 0xd3a8a8;
export const BNG = 0xd3a8ad;
export const BPG = 0xd3a8af;
export const BDI = 0xd3a8a7;
export const BRS = 0xd3a8ce;
export const BMO = 0xd3a8df;

/** Owner types of fields directly inside these Begin fields. */
const OWNER_TYPES = new Map([[BPG, 'page'], [BNG, 'pageGroup'], [BDT, 'document'], [BPF, 'printFile'], [BMO, 'overlay'], [BRS, 'resource']]);

/**
 * Returns the page number of a Begin Page row (1-based).
 * @param {object} file File record.
 * @param {number} row Begin Page row.
 * @returns {number|null} Page number, or null if the row is not a Begin Page.
 */
export function pageNumberOfBegin(file, row) {
  // Binary search in the Begin Page rows (file order), so no map of every page is kept.
  const { pages } = file.index;
  let lo = 0;
  let hi = pages.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid] === row) return mid + 1;
    if (pages[mid] < row) lo = mid + 1; else hi = mid - 1;
  }
  return null;
}

/**
 * Finds the page a field is in.
 * @param {object} file File record.
 * @param {number} row Field row.
 * @returns {{pageRow: number, pageNumber: number}|null} Enclosing page (or the page itself).
 */
export function enclosingPage(file, row) {
  const { index } = file;
  for (let r = row; r >= 0; r = index.parent[r]) {
    if (index.id[r] === BPG) return { pageRow: r, pageNumber: pageNumberOfBegin(file, r) };
  }
  return null;
}

/**
 * Reads the name (first 8 bytes, EBCDIC) of a Begin field.
 * @param {object} file File record.
 * @param {number} row Row.
 * @returns {Promise<string>} Name without trailing blanks.
 */
export async function beginName(file, row) {
  return ebcdicName(await fieldData(file, row), 0, 8);
}

/**
 * Parses the triplets of a field using the registry's layout of the field (where the triplets
 * start); fields without a decoder are assumed to have an 8-byte name followed by triplets.
 * @param {number} id Field identifier.
 * @param {Uint8Array} data Field data.
 * @returns {object[]} Triplets (see parseTriplets).
 */
export function fieldTriplets(id, data) {
  const entry = lookupField(id);
  let ranges = [[8, data.length]];
  if (entry?.decode) {
    try {
      ranges = entry.decode(data).tripletRanges;
    } catch {
      ranges = [];
    }
  }
  return ranges.flatMap(([from, to]) => parseTriplets(data.subarray(from, to)));
}

/**
 * Turns a decoded CGCSGID triplet into a code page id.
 * @param {{ccsid?: number, cpgid?: number}|null} decoded Decoded X'01' triplet.
 * @returns {{id: string|null, number: number|null}} Code page id (null if not supported) and number.
 */
export function codePageOf(decoded) {
  const number = decoded?.ccsid ?? decoded?.cpgid ?? null;
  return { id: number === null ? null : codePageIdFromCcsid(number), number };
}

/**
 * Returns the code page given by the X'01' triplet of the nearest enclosing Begin field that has
 * one, cached per row.
 * @param {object} file File record.
 * @param {number} row Field row (its own triplets are not considered).
 * @param {(row: number) => Promise<Uint8Array>} [read] Field reader (a sequentialReader in scans).
 * @returns {Promise<{id: string|null, number: number|null}|null>} Code page, or null if none.
 */
export async function inheritedCodePage(file, row, read = (r) => fieldData(file, r)) {
  const { index } = file;
  if (!file.inheritedCodePages) file.inheritedCodePages = new Map();
  const cache = file.inheritedCodePages;
  const chain = [];
  let found = null;
  for (let r = index.parent[row]; r >= 0; r = index.parent[r]) {
    if (cache.has(r)) {
      found = cache.get(r);
      break;
    }
    chain.push(r);
    const own = fieldTriplets(index.id[r], await read(r)).find((t) => t.id === 0x01 && t.decoded);
    if (own) {
      found = codePageOf(own.decoded);
      break;
    }
  }
  for (const r of chain) cache.set(r, found);
  return found;
}

/**
 * Describes what a field belongs to: the Begin field that directly encloses it.
 * @param {object} file File record.
 * @param {number} row Field row.
 * @param {(row: number) => Promise<Uint8Array>} [read] Field reader (a sequentialReader in scans).
 * @returns {Promise<{ownerType: string, ownerRef: number|null, ownerName: string|null, pageNumber: number|null}>}
 *   Owner type ('page', 'pageGroup', 'document', 'printFile', 'overlay', 'resource', 'object' for
 *   other Begin fields, 'file' at top level), its row and name, and the page the field is on.
 */
export async function ownerOf(file, row, read = (r) => fieldData(file, r)) {
  const { index } = file;
  const parent = index.parent[row];
  const page = enclosingPage(file, row);
  if (parent < 0) return { ownerType: 'file', ownerRef: null, ownerName: null, pageNumber: null };
  return {
    ownerType: OWNER_TYPES.get(index.id[parent]) ?? 'object',
    ownerRef: parent,
    ownerName: ebcdicName(await read(parent), 0, 8),
    pageNumber: page?.pageNumber ?? null,
  };
}
