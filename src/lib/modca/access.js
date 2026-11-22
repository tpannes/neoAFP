/**
 * Access to the structured fields inside an object (between a Begin field and its End field)
 * of an indexed file. Used by the format modules (fonts, images, text, form definitions).
 */

/**
 * @typedef {object} FileRecord
 * @property {string} id File id.
 * @property {import('../io/byte-source.js').ByteSource} byteSource File content.
 * @property {import('./field-index.js').FieldIndex} index Structured field index.
 */

/**
 * Returns the rows strictly between a Begin field and its End field.
 * @param {import('./field-index.js').FieldIndex} index Field index.
 * @param {number} beginRow Row of the Begin field.
 * @returns {[number, number]} First row and the row after the last one.
 */
export function innerRange(index, beginRow) {
  const end = index.end[beginRow];
  return [beginRow + 1, end >= 0 ? end : index.count];
}

/**
 * Lists the direct children of a Begin field (fields whose enclosing group it is).
 * @param {import('./field-index.js').FieldIndex} index Field index.
 * @param {number} beginRow Row of the Begin field (−1 for the top level).
 * @returns {number[]} Rows in file order.
 */
export function childRows(index, beginRow) {
  return index.children(beginRow);
}

/**
 * Reads the data bytes of one field.
 * @param {FileRecord} file Indexed file.
 * @param {number} row Field row.
 * @returns {Promise<Uint8Array>} Field data.
 */
export async function fieldData(file, row) {
  const { index } = file;
  return file.byteSource.read(index.offset[row] + index.header[row], index.dataLength[row]);
}

/** Bytes a sequential reader loads at once. */
export const SCAN_WINDOW = 1 << 20;

/**
 * Creates a field reader for scans in file order (TLEs, NOPs, counts over a whole file): it loads
 * the file in windows of SCAN_WINDOW bytes and serves the fields inside the current window from
 * it, so a scan over hundreds of thousands of fields costs one read per window instead of one
 * per field (Blob reads in the browser cost far more per call than file reads in Node.js).
 * The returned data are views on the window: copy them (`slice()`) before keeping them, or each
 * kept field keeps its whole window alive.
 * @param {FileRecord} file Indexed file.
 * @param {number} [windowSize] Window size in bytes.
 * @returns {(row: number) => Promise<Uint8Array>} Reads a field's data.
 */
export function sequentialReader(file, windowSize = SCAN_WINDOW) {
  const { index, byteSource } = file;
  let start = 0;
  let buffer = null;
  return async (row) => {
    const at = index.offset[row] + index.header[row];
    const length = index.dataLength[row];
    if (!buffer || at < start || at + length > start + buffer.length) {
      start = at;
      buffer = await byteSource.read(at, Math.max(length, Math.min(windowSize, byteSource.size - at)));
    }
    return buffer.subarray(at - start, at - start + length);
  };
}

/**
 * Reads all fields with given identifiers inside an object, in file order.
 * @param {FileRecord} file Indexed file.
 * @param {number} beginRow Row of the object's Begin field.
 * @param {Set<number>|null} ids Identifiers to read, or null for all.
 * @returns {Promise<{row: number, id: number, data: Uint8Array}[]>} Fields with data.
 */
export async function collectFields(file, beginRow, ids) {
  const { index } = file;
  const [from, to] = innerRange(index, beginRow);
  const out = [];
  for (let row = from; row < to; row++) {
    const id = index.id[row];
    if (ids && !ids.has(id)) continue;
    out.push({ row, id, data: await fieldData(file, row) });
  }
  return out;
}

/**
 * Joins the data of consecutive fields with the same identifier where a field marks itself as
 * continued (segmentation flag X'20'), so that large tables split over several fields can be
 * read as one.
 * @param {{row: number, data: Uint8Array}[]} fields Fields of one identifier, in order.
 * @param {import('./field-index.js').FieldIndex} index Field index (for the flags).
 * @returns {Uint8Array[]} One byte array per logical field.
 */
export function joinSegments(fields, index) {
  const out = [];
  let parts = [];
  for (const f of fields) {
    parts.push(f.data);
    if ((index.flags[f.row] & 0x20) === 0) {
      out.push(concat(parts));
      parts = [];
    }
  }
  if (parts.length) out.push(concat(parts));
  return out;
}

/**
 * Concatenates byte arrays.
 * @param {Uint8Array[]} parts Arrays.
 * @returns {Uint8Array} One array.
 */
export function concat(parts) {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}
