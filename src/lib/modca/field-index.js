/**
 * Structured field index: a compact table of every structured field in one file.
 *
 * Large print files contain millions of structured fields. Instead of keeping one object per
 * field, the index stores each property in a typed array column (research R3), about 30 bytes
 * per field. It also pairs Begin and End fields (e.g. Begin Page … End Page), so that every
 * field knows the group it belongs to, and remembers where pages start.
 *
 * Begin fields have identifiers D3A8xx and their End fields D3A9xx with the same last byte
 * (MO:DCA Reference, AFPC-0004, "Structured Field Identifier": type codes X'A8' Begin and
 * X'A9' End).
 */

import { scanFields, idToHex } from './reader.js';

/** Type byte (middle byte of the identifier) of Begin fields. */
const TYPE_BEGIN = 0xa8;
/** Type byte of End fields. */
const TYPE_END = 0xa9;
/** Begin Page identifier. */
const BEGIN_PAGE = 0xd3a8af;

/**
 * Tells whether an identifier is a Begin field.
 * @param {number} id Field identifier.
 * @returns {boolean} True for D3A8xx.
 */
export function isBegin(id) {
  return (id >> 16) === 0xd3 && ((id >> 8) & 0xff) === TYPE_BEGIN;
}

/**
 * Tells whether an identifier is an End field.
 * @param {number} id Field identifier.
 * @returns {boolean} True for D3A9xx.
 */
export function isEnd(id) {
  return (id >> 16) === 0xd3 && ((id >> 8) & 0xff) === TYPE_END;
}

/**
 * Compact, growable table of structured fields with Begin/End pairing.
 */
export class FieldIndex {
  /**
   * Creates an empty index.
   * @param {number} [capacity] Initial number of rows to reserve.
   */
  constructor(capacity = 1024) {
    this.count = 0;
    this.capacity = 0;
    /** Byte offset of each field's X'5A'. */ this.offset = new Float64Array(0);
    /** Total length including X'5A' (max. 32768). */ this.length = new Uint16Array(0);
    /** 3-byte identifier. */ this.id = new Uint32Array(0);
    /** Row of the enclosing Begin field, −1 at top level. */ this.parent = new Int32Array(0);
    /** Flag byte of the introducer. */ this.flags = new Uint8Array(0);
    /** Bytes from X'5A' to the data (introducer plus extension). */ this.header = new Uint16Array(0);
    /** Number of data bytes. */ this.dataLength = new Uint16Array(0);
    /** For Begin fields: row of the matching End field, −1 if missing. */ this.end = new Int32Array(0);
    /** Rows of all Begin Page fields, in file order. */ this.pages = [];
    /** Offset where reading stopped early, or null. */ this.truncatedAt = null;
    /** Why reading stopped early, or null. */ this.truncatedReason = null;
    /** Separators found between fields. */ this.recordFormat = 'plain';
    /** End fields without a matching Begin, and Begins closed by a mismatching End. */
    this.pairingProblems = [];
    this.#grow(capacity);
  }

  /**
   * Enlarges all columns.
   * @param {number} min Minimum capacity needed.
   * @returns {void}
   */
  #grow(min) {
    const next = Math.max(min, this.capacity * 2, 1024);
    const copy = (Type, old) => {
      const arr = new Type(next);
      arr.set(old.subarray(0, this.count));
      return arr;
    };
    this.offset = copy(Float64Array, this.offset);
    this.length = copy(Uint16Array, this.length);
    this.id = copy(Uint32Array, this.id);
    this.parent = copy(Int32Array, this.parent);
    this.flags = copy(Uint8Array, this.flags);
    this.header = copy(Uint16Array, this.header);
    this.dataLength = copy(Uint16Array, this.dataLength);
    this.end = copy(Int32Array, this.end);
    this.capacity = next;
  }

  /**
   * Appends one field (in file order).
   * @param {import('./reader.js').FieldRecord} field Field from the reader.
   * @param {number} parent Row of the enclosing Begin field, or −1.
   * @returns {number} The new row number.
   */
  add(field, parent) {
    if (this.count === this.capacity) this.#grow(this.count + 1);
    const row = this.count++;
    this.offset[row] = field.offset;
    this.length[row] = field.length;
    this.id[row] = field.id;
    this.parent[row] = parent;
    this.flags[row] = field.flags;
    this.header[row] = field.dataOffset - field.offset;
    this.dataLength[row] = field.dataLength;
    this.end[row] = -1;
    // Pages of documents kept in a resource group (for Include Page, T280) are no pages of the
    // file's own page sequence.
    if (field.id === BEGIN_PAGE && !this.#inResourceGroup(parent)) this.pages.push(row);
    return row;
  }

  /**
   * Tells whether a row lies inside a Begin Resource Group.
   * @param {number} row Row (−1 for the top level).
   * @returns {boolean} True when a resource group encloses it.
   */
  #inResourceGroup(row) {
    for (let r = row; r >= 0; r = this.parent[r]) if (this.id[r] === 0xd3a8c6) return true;
    return false;
  }

  /**
   * Returns one row as a plain object.
   * @param {number} row Row number.
   * @returns {{index: number, offset: number, length: number, id: number, idHex: string,
   *   parent: number, flags: number, dataOffset: number, dataLength: number, end: number}}
   *   The field's position and identifier.
   */
  get(row) {
    if (!Number.isInteger(row) || row < 0 || row >= this.count) throw new RangeError(`no field ${row}`);
    return {
      index: row,
      offset: this.offset[row],
      length: this.length[row],
      id: this.id[row],
      idHex: idToHex(this.id[row]),
      parent: this.parent[row],
      flags: this.flags[row],
      dataOffset: this.offset[row] + this.header[row],
      dataLength: this.dataLength[row],
      end: this.end[row],
    };
  }

  /**
   * Finds the field that contains a byte offset.
   * @param {number} offset Byte offset in the file.
   * @returns {number|null} Row number, or null if no field covers the offset.
   */
  findAtOffset(offset) {
    let lo = 0;
    let hi = this.count - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.offset[mid] <= offset) lo = mid + 1;
      else hi = mid - 1;
    }
    if (hi < 0) return null;
    return offset < this.offset[hi] + this.length[hi] ? hi : null;
  }

  /**
   * Lists the rows whose parent is the given row (direct children).
   * @param {number} parentRow Parent row, or −1 for the top level.
   * @returns {number[]} Child rows in file order.
   */
  children(parentRow) {
    const out = [];
    const start = parentRow < 0 ? 0 : parentRow + 1;
    const stop = parentRow < 0 ? this.count : (this.end[parentRow] >= 0 ? this.end[parentRow] + 1 : this.count);
    for (let r = start; r < stop; r++) if (this.parent[r] === parentRow) out.push(r);
    return out;
  }
}

/**
 * Reads a whole file and builds its structured field index.
 * @param {import('../io/byte-source.js').ByteSource} source File to index.
 * @param {{windowSize?: number, onProgress?: (done: number, total: number) => void}} [options]
 *   Reader options.
 * @returns {Promise<FieldIndex>} The index, including truncation and pairing information.
 */
export async function buildFieldIndex(source, options = {}) {
  const index = new FieldIndex();
  const stack = [];
  const summary = await scanFields(source, (field) => {
    const top = stack.length ? stack[stack.length - 1] : -1;
    if (isEnd(field.id)) {
      const category = field.id & 0xff;
      let depth = stack.length - 1;
      while (depth >= 0 && (index.id[stack[depth]] & 0xff) !== category) depth--;
      if (depth < 0) {
        index.add(field, top);
        index.pairingProblems.push({ row: index.count - 1, problem: 'endWithoutBegin' });
        return;
      }
      for (let d = stack.length - 1; d > depth; d--) {
        index.pairingProblems.push({ row: stack[d], problem: 'notClosed' });
      }
      const begin = stack[depth];
      stack.length = depth;
      const row = index.add(field, index.parent[begin]);
      index.end[begin] = row;
      return;
    }
    const row = index.add(field, top);
    if (isBegin(field.id)) stack.push(row);
  }, options);
  for (const row of stack) index.pairingProblems.push({ row, problem: 'notClosed' });
  index.truncatedAt = summary.truncatedAt;
  index.truncatedReason = summary.truncatedReason;
  index.recordFormat = summary.recordFormat;
  return index;
}
