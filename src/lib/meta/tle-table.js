/**
 * TLE table for the TLE browser (FR-035): the Tag Logical Elements of a file arranged as a
 * table with one row per owner and one column per attribute name. In print files the index
 * values usually sit on named page groups (MO:DCA Begin Named Page Group, one mail piece each),
 * so a row is normally a page group; TLEs placed directly on a page or on the document level
 * form rows of their own. Attribute names become columns in the order they first occur; an
 * owner with the same attribute more than once shows its values joined with "; ".
 */

import { tableCsv } from '../export/csv.js';
import { words, wordFilter } from '../search/text-filter.js';
import { TLE_OWNER_TYPES as OWNER_TYPES } from './tle.js';

/**
 * @typedef {object} TleRow
 * @property {string} key Owner key: "<ownerType>:<ownerRef>".
 * @property {'pageGroup'|'page'|'document'} ownerType Owner kind.
 * @property {string|null} ownerName Name of the page group, page or document.
 * @property {number|null} firstPage First page of the owner (1-based), null if it has none.
 * @property {number|null} lastPage Last page of the owner.
 * @property {number} fieldIndex Field row of the owner's first TLE.
 * @property {Record<string, string>} values Attribute name → value.
 */

/**
 * Arranges decoded TLEs as rows and columns.
 * @param {{index: number, name: string, value: string, ownerType: string, ownerRef: number|null,
 *   ownerName: string|null, pageNumber: number|null}[]} tles Decoded TLEs in file order.
 * @param {(ownerRef: number) => [number, number]|null} pagesOf Returns the first and last page of
 *   an owner's Begin field row, or null if it contains no page.
 * @returns {{columns: string[], rows: TleRow[]}} Columns in first-seen order, rows in file order.
 */
export function tleTable(tles, pagesOf) {
  const columns = [];
  const seen = new Set();
  const rows = new Map();
  for (const t of tles) {
    if (!seen.has(t.name)) {
      seen.add(t.name);
      columns.push(t.name);
    }
    const key = `${t.ownerType}:${t.ownerRef ?? ''}`;
    let row = rows.get(key);
    if (!row) {
      const pages = t.ownerRef === null || t.ownerRef === undefined ? null : pagesOf(t.ownerRef);
      row = {
        key, ownerType: t.ownerType, ownerName: t.ownerName ?? null,
        firstPage: pages?.[0] ?? t.pageNumber ?? null, lastPage: pages?.[1] ?? t.pageNumber ?? null,
        fieldIndex: t.index, values: {},
      };
      rows.set(key, row);
    }
    row.values[t.name] = t.name in row.values ? `${row.values[t.name]}; ${t.value}` : t.value;
  }
  return { columns, rows: [...rows.values()] };
}

/**
 * Finds the pages inside a Begin field.
 * @param {{pages: number[], end: Int32Array|number[]}} index Field index (pages: Begin Page rows
 *   in file order; end: matching End row per Begin row, or −1).
 * @param {number} row Begin field row.
 * @returns {[number, number]|null} First and last page number (1-based), or null if none.
 */
export function pagesWithin(index, row) {
  const end = index.end[row] >= 0 ? index.end[row] : row;
  const { pages } = index;
  let lo = 0;
  let hi = pages.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid] < row) lo = mid + 1; else hi = mid;
  }
  if (lo >= pages.length || pages[lo] > end) return null;
  let last = lo;
  let top = pages.length - 1;
  while (last < top) {
    const mid = (last + top + 1) >> 1;
    if (pages[mid] <= end) last = mid; else top = mid - 1;
  }
  return [lo + 1, last + 1];
}

/** Natural, case-insensitive comparison ("A2" before "A10"), as the viewer's tables sort. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * The TLE table of a file kept in the library (worker) rather than sent to the viewer whole
 * (T230): mass output has hundreds of thousands of rows (440,000 for 2 GB in the measurement).
 * Rows are stored in columns; the viewer asks for a window of rows of a view (filter and sort)
 * with `query`, finds a page's row with `positionOfPage` and exports a view with `export`.
 * Values per attribute name are kept column by column; an owner with the same name more than
 * once gets its values joined with "; " (as tleTable).
 */
export class TleTable {
  /**
   * Builds the table from collected TLEs.
   * @param {import('./tle.js').TleStore} store TLEs in file order.
   * @param {(store: import('./tle.js').TleStore, i: number) => {name: string, value: string}} decodeAt
   *   Decodes TLE i (with the current code page choice).
   * @param {(ownerRef: number) => [number, number]|null} pagesOf First and last page of an owner row.
   */
  constructor(store, decodeAt, pagesOf) {
    /** @type {string[]} */
    this.columns = [];
    const columnOf = new Map();
    const rowOf = new Map();
    const ownerType = [];
    const ownerRef = [];
    const firstPage = [];
    const lastPage = [];
    const fieldIndex = [];
    this.ownerNames = [];
    /** @type {string[][]} column → row → value */
    this.values = [];
    for (let i = 0; i < store.count; i++) {
      const { name, value } = decodeAt(store, i);
      let c = columnOf.get(name);
      if (c === undefined) {
        c = this.columns.length;
        columnOf.set(name, c);
        this.columns.push(name);
        this.values.push([]);
      }
      const type = store.ownerType[i];
      const ref = store.ownerRef[i];
      // Owners with a row are keyed by it; owners without one (document level) share one row per type.
      const key = ref >= 0 ? ref * 4 + type : -1 - type;
      let r = rowOf.get(key);
      if (r === undefined) {
        r = ownerType.length;
        rowOf.set(key, r);
        const pages = ref >= 0 ? pagesOf(ref) : null;
        const page = store.pageNumber[i] || 0;
        ownerType.push(type);
        ownerRef.push(ref);
        firstPage.push(pages?.[0] ?? page);
        lastPage.push(pages?.[1] ?? page);
        fieldIndex.push(store.row[i]);
        this.ownerNames.push(store.ownerName(i));
      }
      const column = this.values[c];
      column[r] = column[r] === undefined ? value : `${column[r]}; ${value}`;
    }
    this.count = ownerType.length;
    this.ownerType = Uint8Array.from(ownerType);
    this.ownerRef = Int32Array.from(ownerRef);
    this.firstPage = Int32Array.from(firstPage);
    this.lastPage = Int32Array.from(lastPage);
    this.fieldIndex = Int32Array.from(fieldIndex);
    /** @type {string[]|null} per row: its normalized value words joined by blanks (built on first filter) */
    this.words = null;
    this.view = null;
  }

  /**
   * One row as a TleRow object.
   * @param {number} r Row number.
   * @returns {TleRow & {row: number}} Row.
   */
  row(r) {
    const type = OWNER_TYPES[this.ownerType[r]];
    const values = {};
    this.columns.forEach((name, c) => {
      const v = this.values[c][r];
      if (v !== undefined) values[name] = v;
    });
    return {
      row: r, key: `${type}:${this.ownerRef[r] >= 0 ? this.ownerRef[r] : ''}`, ownerType: type, ownerName: this.ownerNames[r],
      firstPage: this.firstPage[r] || null, lastPage: this.lastPage[r] || null, fieldIndex: this.fieldIndex[r], values,
    };
  }

  /**
   * A cell's value for sorting, as the TLE browser shows it.
   * @param {number} r Row number.
   * @param {string} key Column key: 'owner', 'level', 'pages' or 'tle:<name>'.
   * @returns {string|number|null} Value.
   */
  cell(r, key) {
    if (key === 'owner') return this.ownerNames[r];
    if (key === 'level') return OWNER_TYPES[this.ownerType[r]];
    if (key === 'pages') return this.firstPage[r] || null;
    const c = this.columns.indexOf(key.slice(4));
    return c < 0 ? null : this.values[c][r] ?? null;
  }

  /**
   * The rows of a view: those matching the filter, in the given order (cached for the last view).
   * @param {{filter?: string, sort?: {key: string, direction: 'asc'|'desc'}|null}} [options] View.
   * @returns {Int32Array} Row numbers.
   */
  rowsOf({ filter = '', sort = null } = {}) {
    const id = JSON.stringify([filter.trim(), sort?.key ?? null, sort?.direction ?? null]);
    if (this.view?.id === id) return this.view.rows;
    let rows;
    const test = wordFilter(filter);
    if (test) {
      if (!this.words) {
        this.words = new Array(this.count);
        for (let r = 0; r < this.count; r++) this.words[r] = words(this.values.map((col) => col[r] ?? '').join(' ')).join(' ');
      }
      const list = [];
      for (let r = 0; r < this.count; r++) if (test(this.words[r].split(' '))) list.push(r);
      rows = Int32Array.from(list);
    } else {
      rows = new Int32Array(this.count);
      for (let r = 0; r < this.count; r++) rows[r] = r;
    }
    if (sort) {
      const sign = sort.direction === 'desc' ? -1 : 1;
      const keys = new Array(this.count);
      for (const r of rows) keys[r] = this.cell(r, sort.key);
      const empty = (v) => v === null || v === undefined || v === '';
      rows = Int32Array.from([...rows].sort((a, b) => {
        const av = keys[a];
        const bv = keys[b];
        if (empty(av) || empty(bv)) return empty(av) === empty(bv) ? a - b : empty(av) ? 1 : -1;
        const c = typeof av === 'number' && typeof bv === 'number' ? av - bv : collator.compare(String(av), String(bv));
        return c * sign || a - b;
      }));
    }
    this.view = { id, rows };
    return rows;
  }

  /**
   * A window of rows of a view.
   * @param {{filter?: string, sort?: object|null, start?: number, count?: number}} [options] View and window.
   * @returns {{columns: string[], total: number, shown: number, start: number, rows: (TleRow & {row: number})[]}}
   *   Columns, number of all rows and of rows in the view, and the rows from `start`.
   */
  query({ filter = '', sort = null, start = 0, count = 200 } = {}) {
    const rows = this.rowsOf({ filter, sort });
    const from = Math.max(0, Math.min(start, rows.length));
    return { columns: this.columns, total: this.count, shown: rows.length, start: from, rows: [...rows.subarray(from, from + count)].map((r) => this.row(r)) };
  }

  /**
   * Position in a view of the row a page belongs to: the innermost page group around it, else the
   * page's own row.
   * @param {{filter?: string, sort?: object|null}} options View.
   * @param {number} page Page number.
   * @returns {number} Position, or −1.
   */
  positionOfPage(options, page) {
    const rows = this.rowsOf(options);
    let best = -1;
    let bestSpan = Infinity;
    let fallback = -1;
    for (let p = 0; p < rows.length; p++) {
      const r = rows[p];
      if (!this.firstPage[r] || this.firstPage[r] > page || this.lastPage[r] < page) continue;
      if (OWNER_TYPES[this.ownerType[r]] === 'pageGroup') {
        const span = this.lastPage[r] - this.firstPage[r];
        if (span < bestSpan) { best = p; bestSpan = span; }
      } else if (fallback < 0) {
        fallback = p;
      }
    }
    return best >= 0 ? best : fallback;
  }

  /**
   * Exports a view as CSV or JSON (the TLE browser's export, FR-035).
   * @param {{filter?: string, sort?: object|null}} options View.
   * @param {'csv'|'json'} format Format.
   * @param {{key: string, label: string}[]} columns Columns shown, in order.
   * @param {Record<string, string>} levelLabels Owner type → label (CSV level column).
   * @returns {string} File content.
   */
  export(options, format, columns, levelLabels = {}) {
    const rows = this.rowsOf(options);
    if (format === 'csv') {
      const cell = (r, key) => {
        if (key === 'level') return levelLabels[OWNER_TYPES[this.ownerType[r]]] ?? OWNER_TYPES[this.ownerType[r]];
        if (key === 'pages') return !this.firstPage[r] ? null : this.firstPage[r] === this.lastPage[r] ? this.firstPage[r] : `${this.firstPage[r]}–${this.lastPage[r]}`;
        return this.cell(r, key);
      };
      return tableCsv(columns.map((c) => c.label), [...rows].map((r) => columns.map((c) => cell(r, c.key))));
    }
    const names = columns.filter((c) => c.key.startsWith('tle:')).map((c) => c.key.slice(4));
    const out = [...rows].map((r) => {
      const values = {};
      for (const name of names) values[name] = this.cell(r, `tle:${name}`);
      return { owner: this.ownerNames[r], level: OWNER_TYPES[this.ownerType[r]], firstPage: this.firstPage[r] || null, lastPage: this.lastPage[r] || null, values };
    });
    return JSON.stringify(out, null, 2);
  }
}
