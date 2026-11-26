/**
 * TLE browser (FR-035): all index values (Tag Logical Elements) of the shown AFP file as a
 * table. One row per page group (or page, or document) that carries TLEs, one column per TLE
 * name, plus the owner's name, level and pages. Columns sort by a click on their title and can be
 * hidden (the hidden TLE names are remembered as the `tleHiddenColumns` preference). The
 * search box keeps the rows whose values match. The rows and columns shown can be exported as
 * JSON or CSV. The code page for TLEs can be chosen here (FR-037).
 *
 * The table stays in the library worker (T230): mass output has hundreds of thousands of rows.
 * The browser asks for the number of rows of the current view (filter and sort) and the table
 * loads the rows it shows in blocks (data-table remote mode); filtering, sorting, finding a
 * page's row and the export run in the worker (queryTleTable, findTleRowOfPage, exportTleTable).
 *
 * Selecting a row marks its first page in the thumbnails (event `pageselect`); a double click or
 * Enter opens that page in the page viewer (event `openpage`); `revealPage(page)` selects the row
 * of a page (thumbnail clicks).
 */

import '../components/data-table.js';
import '../components/menu-button.js';
import '../components/codepage-settings.js';
import { t, onLanguageChange, applyTranslations } from '../i18n/i18n.js';
import { icon, iconButton } from '../icons.js';
import { loadPrefs, savePrefs } from '../prefs.js';
import { saveBlob, tableFileName } from '../download.js';

/** Columns before the TLE names. */
const FIXED = ['owner', 'level', 'pages'];

export class TleBrowser extends HTMLElement {
  /**
   * Connects the browser.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   * @returns {Promise<void>} Resolves when built.
   */
  async attach(client) {
    this.client = client;
    this.hidden_ = new Set(loadPrefs().tleHiddenColumns);
    this.classList.add('table-browser');
    const bar = document.createElement('div');
    bar.className = 'browser-toolbar';
    const box = document.createElement('label');
    box.className = 'search-box';
    this.input = document.createElement('input');
    this.input.type = 'search';
    this.input.dataset.i18nAttr = 'placeholder:tleBrowser.search,aria-label:tleBrowser.search';
    let timer = null;
    this.input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => this.#filter(), 200); });
    box.append(icon('search'), this.input);
    this.count = document.createElement('span');
    this.count.className = 'table-count';
    this.count.setAttribute('role', 'status');
    this.columnsButton = iconButton('columns', 'tleBrowser.columns');
    this.columnsMenu = document.createElement('div');
    this.columnsMenu.className = 'menu-popup columns-menu';
    this.columnsMenu.hidden = true;
    this.columnsButton.setAttribute('aria-expanded', 'false');
    this.columnsButton.addEventListener('click', () => this.#toggleColumnsMenu());
    document.addEventListener('pointerdown', (e) => {
      if (!this.columnsMenu.hidden && !this.columnsWrap.contains(e.target)) this.#toggleColumnsMenu(false);
    });
    this.columnsWrap = document.createElement('span');
    this.columnsWrap.className = 'menu-button';
    this.columnsWrap.append(this.columnsButton, this.columnsMenu);
    this.codePage = document.createElement('codepage-settings');
    await this.codePage.attach(client, ['tle']);
    this.codePage.addEventListener('change', () => {
      this.load();
      this.dispatchEvent(new CustomEvent('tlecodepagechange', { bubbles: true }));
    });
    this.exportMenu = document.createElement('menu-button');
    this.exportMenu.setup('download', 'export.label', [
      { labelKey: 'export.json', icon: 'fileJson', run: () => this.#export('json') },
      { labelKey: 'export.csv', icon: 'fileCsv', run: () => this.#export('csv') },
    ]);
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    bar.append(box, this.count, spacer, this.codePage, this.columnsWrap, this.exportMenu);
    this.table = document.createElement('data-table');
    this.empty = document.createElement('div');
    this.empty.className = 'empty-state';
    this.append(bar, this.table, this.empty);
    this.table.cell = (row, key) => this.#cell(row, key);
    this.table.addEventListener('select', (e) => e.detail.row?.firstPage && this.dispatchEvent(new CustomEvent('pageselect', { detail: { page: e.detail.row.firstPage } })));
    this.table.addEventListener('activate', (e) => e.detail.row?.firstPage && this.dispatchEvent(new CustomEvent('openpage', { detail: { page: e.detail.row.firstPage } })));
    this.table.addEventListener('sortchange', () => this.#filter());
    applyTranslations(this);
    onLanguageChange(() => this.#show());
  }

  /**
   * Shows the TLEs of a document (loaded when the browser is shown).
   * @param {string|null} documentId Document id.
   * @param {string} [name] File name (for export file names).
   * @returns {void}
   */
  setDocument(documentId, name = '') {
    this.documentId = documentId;
    this.documentName = name;
    this.data = null;
    this.loadedFor = null;
  }

  /**
   * Loads the table if the document changed since it was last loaded.
   * @returns {Promise<void>} Resolves when shown.
   */
  async ensureLoaded() {
    if (this.documentId && this.loadedFor !== this.documentId) await this.load();
  }

  /**
   * Loads (or reloads, after a code page change) the table.
   * @returns {Promise<void>} Resolves when shown.
   */
  async load() {
    const id = this.documentId;
    if (!id) return;
    this.loadedFor = id;
    this.count.textContent = t('details.loading');
    const data = await this.client.call('queryTleTable', id, { count: 0 });
    if (id !== this.documentId) return;
    this.data = { columns: data.columns, total: data.total };
    this.#show();
  }

  /**
   * Returns a cell value.
   * @param {object} row Table row.
   * @param {string} key Column key.
   * @returns {string|number|null} Value.
   */
  #cell(row, key) {
    if (key === 'owner') return row.ownerName;
    if (key === 'level') return t(`owner.${row.ownerType}`);
    if (key === 'pages') return row.firstPage === null ? null : row.firstPage === row.lastPage ? row.firstPage : `${row.firstPage}–${row.lastPage}`;
    return row.values[key.slice(4)] ?? null;
  }

  /** Builds the columns and rows. */
  #show() {
    const d = this.data;
    this.empty.hidden = Boolean(d?.total);
    this.table.hidden = !d?.total;
    this.empty.textContent = d ? t('tle.none') : '';
    if (!d) return;
    const widths = { owner: 140, level: 110, pages: 80 };
    const columns = [
      ...FIXED.map((key) => ({ key, label: t(`tleBrowser.col.${key}`), width: widths[key], className: key === 'pages' ? 'num' : '' })),
      ...d.columns.map((name) => ({ key: `tle:${name}`, label: name, width: Math.min(320, Math.max(110, name.length * 9 + 40)) })),
    ].filter((c) => !this.hidden_.has(c.key));
    this.table.setColumns(columns);
    this.#filter();
    this.#fillColumnsMenu();
  }

  /** @returns {{filter: string, sort: object|null}} The current view: search box and sort column. */
  #view() {
    return { filter: this.input.value, sort: this.table.sort ?? null };
  }

  /** Applies the search box and the sort column: counts the rows of the view in the worker. */
  async #filter() {
    if (!this.data) return;
    const id = this.documentId;
    const view = this.#view();
    const token = (this.viewToken ?? 0) + 1;
    this.viewToken = token;
    const { shown, total } = await this.client.call('queryTleTable', id, { ...view, count: 0 });
    if (token !== this.viewToken || id !== this.documentId) return;
    this.table.setRemote({ total: shown, load: async (start, count) => (await this.client.call('queryTleTable', id, { ...view, start, count })).rows });
    this.count.textContent = t('tleBrowser.count', { shown, total });
  }

  /**
   * Opens or closes the column chooser.
   * @param {boolean} [open] True to open; toggles when omitted.
   * @returns {void}
   */
  #toggleColumnsMenu(open = this.columnsMenu.hidden) {
    this.columnsMenu.hidden = !open;
    this.columnsButton.setAttribute('aria-expanded', String(open));
  }

  /** Fills the column chooser with one checkbox per column. */
  #fillColumnsMenu() {
    const all = [...FIXED.map((key) => [key, t(`tleBrowser.col.${key}`)]), ...(this.data?.columns ?? []).map((n) => [`tle:${n}`, n])];
    this.columnsMenu.replaceChildren(...all.map(([key, label]) => {
      const l = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !this.hidden_.has(key);
      cb.addEventListener('change', () => {
        if (cb.checked) this.hidden_.delete(key); else this.hidden_.add(key);
        savePrefs({ tleHiddenColumns: [...this.hidden_] });
        this.#show();
      });
      l.append(cb, ` ${label}`);
      return l;
    }));
  }

  /**
   * Selects the row of a page: its page group (or the page itself) (thumbnail clicks).
   * @param {number} page Page number.
   * @returns {void}
   */
  async revealPage(page) {
    if (!this.data) return;
    const token = this.viewToken;
    // Rows are mainly page groups: the innermost group around the page, else the page's own row.
    const position = await this.client.call('findTleRowOfPage', this.documentId, this.#view(), page);
    if (position >= 0 && token === this.viewToken) this.table.mark(position);
  }

  /**
   * Exports the rows and columns shown.
   * @param {'json'|'csv'} format Format.
   * @returns {void}
   */
  async #export(format) {
    if (!this.data) return;
    const columns = this.table.columns.map((c) => ({ key: c.key, label: c.label }));
    const levelLabels = Object.fromEntries(['page', 'pageGroup', 'document'].map((type) => [type, t(`owner.${type}`)]));
    const text = await this.client.call('exportTleTable', this.documentId, this.#view(), format, columns, levelLabels);
    const type = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json';
    saveBlob(new Blob([text], { type }), tableFileName(this.documentName, '_TLE', format));
  }
}

customElements.define('tle-browser', TleBrowser);
