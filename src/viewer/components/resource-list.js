/**
 * <resource-list>: resources as a table (FR-051): name, type, dimensions (width × height in mm),
 * size class, file size, resolution, color profile, encoding and source file; every column
 * header sorts (again: reverse). Events: `sort` (detail: { by, direction }) and `open`
 * (detail: { index }).
 */

import './virtual-list.js';
import { t, onLanguageChange } from '../i18n/i18n.js';
import { typeLabel, sizeClassLabel, sourceText, dimensionsText, fileSizeText } from '../render/resource-thumbs.js';

/** Columns: key (sort field) and text key of the header. */
const COLUMNS = [
  ['name', 'resources.col.name'], ['type', 'resources.col.type'], ['widthMm', 'resources.col.dimensions'],
  ['sizeClass', 'resources.col.sizeClass'], ['fileSize', 'resources.col.fileSize'], ['resolution', 'resources.col.resolution'],
  ['colorProfile', 'resources.col.colorProfile'], ['encoding', 'resources.col.encoding'], ['source', 'resources.col.source'],
];

export class ResourceList extends HTMLElement {
  /** Builds header and list. */
  connectedCallback() {
    if (this.list) return;
    this.className = 'resource-list';
    this.sort = { by: 'name', direction: 'asc' };
    this.header = document.createElement('div');
    this.header.className = 'resource-list-row table-header';
    this.header.setAttribute('role', 'row');
    this.buttons = COLUMNS.map(([by, key]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sort-button';
      b.dataset.i18n = key;
      b.textContent = t(key);
      b.addEventListener('click', () => {
        const direction = this.sort.by === by && this.sort.direction === 'asc' ? 'desc' : 'asc';
        this.setSort({ by, direction });
        this.dispatchEvent(new CustomEvent('sort', { detail: { ...this.sort } }));
      });
      const cell = document.createElement('span');
      cell.setAttribute('role', 'columnheader');
      cell.append(b);
      this.header.append(cell);
      return [by, cell];
    });
    this.list = document.createElement('virtual-list');
    this.list.setAttribute('data-i18n-attr', 'aria-label:resources.list');
    this.list.setAttribute('aria-label', t('resources.list'));
    this.list.renderRow = (r, el) => this.#renderRow(r, el);
    this.list.addEventListener('activate', (e) => this.dispatchEvent(new CustomEvent('open', { detail: { index: e.detail.index } })));
    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('.vl-row');
      if (row) this.dispatchEvent(new CustomEvent('open', { detail: { index: Number(row.dataset.index) } }));
    });
    this.append(this.header, this.list);
    this.#markSort();
    onLanguageChange(() => this.list.refresh());
  }

  /**
   * Shows resources.
   * @param {object[]} resources Resources in display order.
   * @returns {void}
   */
  show(resources) {
    this.list.items = resources;
  }

  /**
   * Marks the sort column.
   * @param {{by: string, direction: 'asc'|'desc'}} sort Sort.
   * @returns {void}
   */
  setSort(sort) {
    this.sort = sort;
    this.#markSort();
  }

  /** Sets aria-sort on the headers. */
  #markSort() {
    for (const [by, cell] of this.buttons ?? []) {
      cell.setAttribute('aria-sort', this.sort.by === by ? (this.sort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
    }
  }

  /**
   * Fills one row.
   * @param {object} r Resource.
   * @param {HTMLElement} el Row element.
   * @returns {void}
   */
  #renderRow(r, el) {
    el.classList.add('resource-list-row');
    const cells = [
      r.name, typeLabel(r.type), dimensionsText(r), sizeClassLabel(r.sizeClass), fileSizeText(r.fileSize),
      r.resolution ? t('resource.dpi', { value: r.resolution }) : '', r.colorProfile ?? '', r.encoding ?? '', (r.sources?.length ?? 1) > 1 ? `${sourceText(r)} (+${r.sources.length - 1})` : sourceText(r),
    ];
    el.replaceChildren(...cells.map((text) => {
      const span = document.createElement('span');
      span.textContent = text;
      span.title = text;
      return span;
    }));
  }

  /** @returns {number} Scroll position. */
  get scrollPosition() {
    return this.list.scrollTop;
  }

  /** @param {number} value Scroll position. */
  set scrollPosition(value) {
    this.list.scrollTop = value;
  }
}

customElements.define('resource-list', ResourceList);
