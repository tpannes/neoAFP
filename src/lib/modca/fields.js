/**
 * Structured field queries for the structure view (FR-031–FR-033, FR-040): field lists of a row
 * range with filtering by name or identifier, the field at a byte offset, and one decoded field
 * with parameters, triplets and raw bytes (data-model "StructuredField").
 */

import { fieldData } from './access.js';
import { lookupField } from './registry/index.js';
import { parseTriplets } from './registry/triplets.js';

/**
 * @typedef {object} FieldSummary
 * @property {number} index Row.
 * @property {number} offset Byte offset of the X'5A'.
 * @property {number} length Length including the X'5A'.
 * @property {number} id Identifier.
 * @property {string} idHex Identifier as 6 hex digits.
 * @property {string|null} shortName Registry short name (null for unknown fields).
 * @property {string|null} fullName Registry full name.
 * @property {number} depth Number of enclosing Begin fields.
 * @property {boolean} known Whether the identifier is registered.
 * @property {boolean} decoded Whether getField shows decoded parameters (FR-040).
 */

/**
 * Number of enclosing Begin fields of a row.
 * @param {object} index Field index.
 * @param {number} row Row.
 * @returns {number} Depth.
 */
function depthOf(index, row) {
  let d = 0;
  for (let r = index.parent[row]; r >= 0; r = index.parent[r]) d++;
  return d;
}

/**
 * Lists fields of a row range, optionally filtered.
 * @param {object} file File record.
 * @param {[number, number]} range First and last row (inclusive).
 * @param {{text?: string, ids?: string[]}} [filter] Text matching short name, full name or
 *   identifier (case-insensitive, substring; "X'D3A8AF'" is accepted), and/or identifiers.
 * @returns {FieldSummary[]} Matching fields in file order.
 */
export function getFields(file, range, filter = {}) {
  const { index } = file;
  const first = Math.max(0, range?.[0] ?? 0);
  const last = Math.min(index.count - 1, range?.[1] ?? index.count - 1);
  const text = (filter.text ?? '').trim().toUpperCase().replace(/^X'([0-9A-F]*)'?$/, '$1');
  const ids = filter.ids?.length ? new Set(filter.ids.map((i) => String(i).toUpperCase())) : null;
  const out = [];
  const parentDepth = new Map(); // Begin row → depth of its children
  const depthAt = (row) => {
    const p = index.parent[row];
    if (p < 0) return 0;
    if (!parentDepth.has(p)) parentDepth.set(p, depthOf(index, p) + 1);
    return parentDepth.get(p);
  };
  for (let row = first; row <= last; row++) {
    const entry = lookupField(index.id[row]);
    const { idHex } = index.get(row);
    if (ids && !ids.has(idHex)) continue;
    if (text && !(idHex.includes(text) || entry?.shortName?.toUpperCase().includes(text) || entry?.fullName?.toUpperCase().includes(text))) continue;
    out.push({
      index: row, offset: index.offset[row], length: index.length[row], id: index.id[row], idHex,
      shortName: entry?.shortName ?? null, fullName: entry?.fullName ?? null, depth: depthAt(row),
      known: Boolean(entry), decoded: Boolean(entry?.decode && !entry.rawOnly),
    });
  }
  return out;
}

/**
 * Finds the structured field that contains a byte offset.
 * @param {object} file File record.
 * @param {number} offset Byte offset in the file.
 * @returns {number|null} Row, or null if no field covers the offset.
 */
export function findFieldAtOffset(file, offset) {
  return file.index?.findAtOffset(offset) ?? null;
}

/**
 * Decodes one structured field: position, registry names, specification reference, parameters
 * and triplets. `decoded` is false for unknown fields and for fields whose decoder no committed
 * expectation covers yet (`rawOnly`, Principle I); the viewer then shows the raw bytes.
 * @param {object} file File record.
 * @param {number} fieldIndex Row.
 * @returns {Promise<{index: number, offset: number, length: number, id: number, idHex: string,
 *   shortName: string|null, fullName: string|null, specRef: string|null,
 *   parameters: {name: string, value: (string|number)}[],
 *   triplets: {id: number, name: string|null, decoded: object|null, rawOnly: boolean, raw: Uint8Array,
 *   start: number}[], decoded: boolean, rawBytes: Uint8Array, dataOffset: number}>} The field;
 *   `start` is a triplet's position in the field data, `dataOffset` the data's byte offset in the file.
 */
export async function getField(file, fieldIndex) {
  const row = file.index.get(fieldIndex);
  const entry = lookupField(row.id);
  const data = await fieldData(file, fieldIndex);
  let parameters = [];
  let triplets = [];
  let ok = false;
  if (entry?.decode) {
    try {
      const out = entry.decode(data);
      parameters = out.parameters;
      triplets = out.tripletRanges.flatMap(([from, to]) => parseTriplets(data.subarray(from, to)))
        .map(({ id, name, decoded, raw, rawOnly }) => ({ id, name, decoded, rawOnly, raw, start: raw.byteOffset - data.byteOffset }));
      ok = !entry.rawOnly;
    } catch {
      parameters = [];
    }
  }
  return {
    index: fieldIndex,
    offset: row.offset,
    length: row.length,
    id: row.id,
    idHex: row.idHex,
    shortName: entry?.shortName ?? null,
    fullName: entry?.fullName ?? null,
    specRef: entry?.specRef ?? null,
    parameters,
    triplets,
    decoded: ok,
    rawBytes: data,
    dataOffset: row.dataOffset,
  };
}
