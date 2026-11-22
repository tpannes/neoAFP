/**
 * <data-table>: a table for the TLE and NOP browsers (FR-035, FR-036): a header row whose
 * column titles sort the table (ascending, then descending), and rows drawn with the virtual list
 * so tables with hundreds of thousands of rows stay fast (FR-082). Wide tables scroll sideways;
 * the header moves with them.
 *
 * Set `columns` ({ key, label, width, className? }) and `rows`; `cell(row, key)` returns a cell's
 * text. Sorting compares numbers numerically and text naturally ("A2" before "A10"), ignoring
 * case; empty values come last.
 * Events: `select` (detail: { row }) and `activate` (detail: { row }, double click or Enter).
 *
 * Remote rows (T230): with `setRemote({ total, load })` the table holds only the rows it has
 * shown; `load(start, count)` fetches a block of rows (from the library worker) when the user
 * scrolls to rows not yet loaded, which show empty meanwhile. Sorting is then done by the owner:
 * a click on a column title fires `sortchange` (detail: { sort }) and the owner calls
 * `setRemote` again with the sorted rows.
 */

/** Rows fetched at once in remote mode. */
const BLOCK = 200;

import './virtual-list.js';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export class DataTable extends HTMLElement {
  /** Builds header and body. */
  connectedCallback() {
    if (this.list) return;
    this.className = 'data-table';
    this.columns = [];
    this.allRows = [];
    this.sort = null;
    this.cell = (row, key) => row[key];
    this.scroller = document.createElement('div');
    this.scroller.className = 'data-table-scroll';
    this.header = document.createElement('div');
    this.header.className = 'data-table-header';
    this.header.setAttribute('role', 'row');
    this.list = document.createElement('virtual-list');
    this.remote = null;
    this.list.renderRow = (row, el) => this.#renderRow(this.remote ? this.#remoteRow(row) : row, el);
    const rowOf = (item) => (this.remote ? this.remote.rows.get(item) ?? null : item);
    this.list.addEventListener('select', (e) => this.dispatchEvent(new CustomEvent('select', { detail: { row: rowOf(e.detail.item) } })));
    this.list.addEventListener('activate', (e) => this.dispatchEvent(new CustomEvent('activate', { detail: { row: rowOf(e.detail.item) } })));
    this.scroller.append(this.header, this.list);
    this.append(this.scroller);
  }

  /**
   * Sets the columns.
   * @param {{key: string, label: string, width: number, className?: string}[]} columns Columns.
   * @returns {void}
   */
  setColumns(columns) {
    this.columns = columns;
    if (this.sort && !columns.some((c) => c.key === this.sort.key)) this.sort = null;
    const width = columns.reduce((n, c) => n + c.width, 0);
    this.style.setProperty('--table-width', `${width}px`);
    this.style.setProperty('--table-columns', columns.map((c) => `${c.width}px`).join(' '));
    this.header.replaceChildren(...columns.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `data-table-head ${c.className ?? ''}`.trim();
      b.setAttribute('role', 'columnheader');
      b.textContent = c.label;
      b.title = c.label;
      const state = this.sort?.key === c.key ? this.sort.direction : 'none';
      b.setAttribute('aria-sort', state === 'asc' ? 'ascending' : state === 'desc' ? 'descending' : 'none');
      b.addEventListener('click', () => this.sortBy(c.key));
      return b;
    }));
    this.#apply();
  }

  /**
   * Sets the rows (in their natural order; the current sort applies).
   * @param {object[]} rows Rows.
   * @returns {void}
   */
  setRows(rows) {
    this.remote = null;
    this.allRows = rows;
    this.#apply();
  }

  /**
   * Shows rows that are loaded on demand (see above).
   * @param {{total: number, load: (start: number, count: number) => Promise<object[]>}} source
   *   Number of rows and the loader of a block.
   * @returns {void}
   */
  setRemote({ total, load }) {
    const token = (this.remote?.token ?? 0) + 1;
    this.remote = { token, total, load, rows: new Map(), pending: new Set() };
    this.list.selectedIndex = -1;
    const positions = new Array(total);
    for (let i = 0; i < total; i++) positions[i] = i;
    this.list.items = positions;
  }

  /**
   * The row at a position in remote mode, starting to load its block when missing.
   * @param {number} position Position.
   * @returns {object|null} Row, or null while loading.
   */
  #remoteRow(position) {
    const remote = this.remote;
    const row = remote.rows.get(position);
    if (row) return row;
    const block = Math.floor(position / BLOCK) * BLOCK;
    if (!remote.pending.has(block)) {
      remote.pending.add(block);
      remote.load(block, BLOCK).then((rows) => {
        if (this.remote !== remote) return;
        rows.forEach((r, i) => remote.rows.set(block + i, r));
        this.list.refresh();
      }).catch(() => remote.pending.delete(block));
    }
    return null;
  }

  /** @returns {object[]} The rows as shown (sorted). */
  get shownRows() {
    return this.list.items;
  }

  /**
   * Sorts by a column: ascending, then descending, then back to the natural order.
   * @param {string} key Column key.
   * @returns {void}
   */
  sortBy(key) {
    const next = this.sort?.key !== key ? 'asc' : this.sort.direction === 'asc' ? 'desc' : null;
    this.sort = next ? { key, direction: next } : null;
    this.setColumns(this.columns);
    if (this.remote) this.dispatchEvent(new CustomEvent('sortchange', { detail: { sort: this.sort } }));
  }

  /** Sorts the rows and shows them, keeping the selected row selected. */
  #apply() {
    if (!this.list || this.remote) return;
    const selected = this.list.items[this.list.selectedIndex];
    let rows = this.allRows;
    if (this.sort) {
      const { key, direction } = this.sort;
      const sign = direction === 'desc' ? -1 : 1;
      const value = (r) => this.cell(r, key);
      rows = rows.map((r, i) => ({ r, i, v: value(r) })).sort((a, b) => {
        const am = a.v === null || a.v === undefined || a.v === '';
        const bm = b.v === null || b.v === undefined || b.v === '';
        if (am || bm) return am === bm ? a.i - b.i : am ? 1 : -1;
        const c = typeof a.v === 'number' && typeof b.v === 'number' ? a.v - b.v : collator.compare(String(a.v), String(b.v));
        return c * sign || a.i - b.i;
      }).map((x) => x.r);
    }
    this.list.selectedIndex = selected ? rows.indexOf(selected) : -1;
    this.list.items = rows;
  }

  /**
   * Selects a row and scrolls it into view without firing `select`.
   * @param {object|number} row Row (its position in remote mode).
   * @returns {boolean} True if the row is shown.
   */
  mark(row) {
    const i = this.remote ? row : this.list.items.indexOf(row);
    if (i >= 0) this.list.mark(i);
    return i >= 0;
  }

  /**
   * Draws one row.
   * @param {object} row Row.
   * @param {HTMLElement} el Row element.
   * @returns {void}
   */
  #renderRow(row, el) {
    el.classList.add('data-table-row');
    if (!row) {
      el.replaceChildren(...this.columns.map(() => document.createElement('span')));
      return;
    }
    el.replaceChildren(...this.columns.map((c) => {
      const span = document.createElement('span');
      const v = this.cell(row, c.key);
      span.textContent = v === null || v === undefined ? '' : String(v);
      span.title = span.textContent;
      if (c.className) span.className = c.className;
      return span;
    }));
  }
}

customElements.define('data-table', DataTable);
