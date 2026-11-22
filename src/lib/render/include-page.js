/**
 * Include Page (IPG, MO:DCA "Include Page", T280): PgName (8), reserved (8), IPgFlgs (1), then
 * triplets — Fully Qualified Name type X'83' (the document that holds the page; mandatory), type
 * X'01' (replaces PgName), Object Offset X'5A' with ObjTpe X'AF' (number of pages before the page
 * in that document; PgName is then ignored). The page is carried in a document in the print
 * file's resource group. An IPG in page state makes the included page part of the containing
 * page (drawn into it); an IPG in document or page-group state adds a page to the page sequence,
 * which neoAFP does not do — workspace reports such IPGs instead of ignoring them.
 */

import { childRows, fieldData } from '../modca/access.js';
import { u, ebcdicName } from '../modca/bytes.js';
import { readCommonTriplets } from '../modca/structures.js';

const BRG = 0xd3a8c6;
const BDT = 0xd3a8a8;
const BPG = 0xd3a8af;

/**
 * Reads an Include Page field.
 * @param {Uint8Array} d IPG data.
 * @returns {{name: string, document: string|null, offset: number|null}} Page name, document name
 *   and page offset (null when not given).
 */
export function decodeIncludePage(d) {
  const triplets = d.subarray(17);
  const t = readCommonTriplets(triplets);
  let offset = null;
  for (let i = 0; i + 1 < triplets.length;) {
    const tl = triplets[i];
    if (tl < 2) break;
    if (triplets[i + 1] === 0x5a && tl >= 8 && triplets[i + 2] === 0xaf) offset = u(triplets, i + 4, 4);
    i += tl;
  }
  return { name: t.names[0x01] ?? ebcdicName(d, 0, 8), document: t.names[0x83] ?? null, offset };
}

/**
 * Lists the Begin Page rows of a document in order (inside its page groups too).
 * @param {object} index Field index.
 * @param {number} bdt Begin Document row.
 * @returns {number[]} Begin Page rows.
 */
function pagesOf(index, bdt) {
  const out = [];
  const walk = (row) => {
    for (const c of childRows(index, row)) {
      if (index.id[c] === BPG) out.push(c);
      else if (index.end[c] >= 0) walk(c);
    }
  };
  walk(bdt);
  return out;
}

/**
 * Finds the page an IPG refers to: a document in a resource group of the file, by name (any
 * document when the IPG names none), then the page by offset or by name.
 * @param {object} file File record.
 * @param {{name: string, document: string|null, offset: number|null}} ipg Include Page values.
 * @returns {Promise<number|null>} Begin Page row, or null.
 */
export async function findIncludedPage(file, ipg) {
  const { index } = file;
  for (let row = 0; row < index.count; row++) {
    if (index.id[row] !== BDT) continue;
    let inGroup = false;
    for (let p = index.parent[row]; p >= 0; p = index.parent[p]) if (index.id[p] === BRG) inGroup = true;
    if (!inGroup) continue;
    if (ipg.document && ebcdicName(await fieldData(file, row), 0, 8) !== ipg.document) continue;
    const pages = pagesOf(index, row);
    if (ipg.offset !== null) return pages[ipg.offset] ?? null;
    for (const p of pages) if (ebcdicName(await fieldData(file, p), 0, 8) === ipg.name) return p;
  }
  return null;
}
