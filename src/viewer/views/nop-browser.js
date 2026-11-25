/**
 * NOP browser (FR-036): all No Operation records of the shown AFP file as a table with offset,
 * page, encoding (the code page chosen for NOPs, else the one detected per record: EBCDIC 273 by
 * default, Windows-1252 when that reads better) and text. A toolbar switch hides the $ISIS_TAG
 * records ISIS Papyrus writes to carry PDF/UA tagging (there can be very many; remembered as the
 * `hideIsisTags` preference); it is shown only when the file has at least one such record. A search box keeps the rows whose text matches; columns sort
 * by a click on their title; the rows shown can be exported as JSON or CSV; the code page for NOPs
 * can be chosen here (FR-037).
 *
 * Selecting a row marks its page in the thumbnails (event `pageselect`); a double click or Enter
 * opens the page (event `openpage`); `revealPage(page)` selects the first NOP of a page.
 */

import '../components/data-table.js';
import '../components/menu-button.js';
import '../components/codepage-settings.js';
import { t, onLanguageChange, applyTranslations } from '../i18n/i18n.js';
import { icon, iconButton } from '../icons.js';
import { loadPrefs, savePrefs } from '../prefs.js';
import { saveBlob, tableFileName } from '../download.js';
import { tableCsv } from '../../lib/export/csv.js';
import { words, wordFilter } from '../../lib/search/text-filter.js';

const COLUMNS = [['offset', 110, 'num mono'], ['page', 70, 'num'], ['codePage', 130, 'mono'], ['text', 900, 'mono']];

export class NopBrowser extends HTMLElement {
  /**
   * Connects the browser.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   * @returns {Promise<void>} Resolves when built.
   */
  async attach(client) {
    this.client = client;
    this.hideIsis = loadPrefs().hideIsisTags;
    this.classList.add('table-browser');
    const bar = document.createElement('div');
    bar.className = 'browser-toolbar';
    const box = document.createElement('label');
    box.className = 'search-box';
    this.input = document.createElement('input');
    this.input.type = 'search';
    this.input.dataset.i18nAttr = 'placeholder:nopBrowser.search,aria-label:nopBrowser.search';
    let timer = null;
    this.input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => this.#filter(), 200); });
    box.append(icon('search'), this.input);
    this.count = document.createElement('span');
    this.count.className = 'table-count';
    this.count.setAttribute('role', 'status');
    this.isisButton = iconButton('filter', 'nopBrowser.hideIsis', { className: 'toggle' });
    this.isisButton.dataset.i18nAttr = 'title:nopBrowser.hideIsisTitle';
    this.isisButton.addEventListener('click', () => {
      this.hideIsis = !this.hideIsis;
      savePrefs({ hideIsisTags: this.hideIsis });
      this.#filter();
    });
    this.codePage = document.createElement('codepage-settings');
    await this.codePage.attach(client, ['nop']);
    this.codePage.addEventListener('change', () => this.load());
    this.exportMenu = document.createElement('menu-button');
    this.exportMenu.setup('download', 'export.label', [
      { labelKey: 'export.json', icon: 'fileJson', run: () => this.#export('json') },
      { labelKey: 'export.csv', icon: 'fileCsv', run: () => this.#export('csv') },
    ]);
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    bar.append(box, this.count, spacer, this.isisButton, this.codePage, this.exportMenu);
    this.table = document.createElement('data-table');
    this.empty = document.createElement('div');
    this.empty.className = 'empty-state';
    this.append(bar, this.table, this.empty);
    this.table.cell = (row, key) => (key === 'page' ? row.pageNumber : row[key]);
    this.table.addEventListener('select', (e) => e.detail.row.pageNumber && this.dispatchEvent(new CustomEvent('pageselect', { detail: { page: e.detail.row.pageNumber } })));
    this.table.addEventListener('activate', (e) => e.detail.row.pageNumber && this.dispatchEvent(new CustomEvent('openpage', { detail: { page: e.detail.row.pageNumber } })));
    applyTranslations(this);
    onLanguageChange(() => this.#show());
  }

  /**
   * Shows the NOPs of a document (loaded when the browser is shown).
   * @param {string|null} documentId Document id.
   * @param {string} [name] File name (for export file names).
   * @returns {void}
   */
  setDocument(documentId, name = '') {
    this.documentId = documentId;
    this.documentName = name;
    this.rows = null;
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
   * Loads (or reloads, after a code page change) the NOPs.
   * @returns {Promise<void>} Resolves when shown.
   */
  async load() {
    const id = this.documentId;
    if (!id) return;
    this.loadedFor = id;
    const nops = await this.client.call('getNops', id);
    if (id !== this.documentId) return;
    this.rows = nops.map((n) => ({
      index: n.index, offset: n.offset, pageNumber: n.pageNumber, codePage: n.codePage, text: n.text, isisTag: n.isisTag, words: words(n.text),
    }));
    this.#show();
  }

  /** Builds the columns and rows. */
  #show() {
    this.isisButton.setAttribute('aria-pressed', String(this.hideIsis));
    const has = Boolean(this.rows?.length);
    this.empty.hidden = has;
    this.table.hidden = !has;
    this.empty.textContent = this.rows ? t('nop.none') : '';
    // Only offered when the file has at least one $ISIS_TAG record.
    this.isisButton.hidden = !this.rows?.some((r) => r.isisTag);
    if (!this.rows) return;
    this.table.setColumns(COLUMNS.map(([key, width, className]) => ({ key, width, className, label: t(`nopBrowser.col.${key}`) })));
    this.#filter();
  }

  /** Applies the ISIS switch and the search box. */
  #filter() {
    this.isisButton.setAttribute('aria-pressed', String(this.hideIsis));
    if (!this.rows) return;
    const test = wordFilter(this.input.value);
    const rows = this.rows.filter((r) => !(this.hideIsis && r.isisTag) && (!test || test(r.words)));
    this.table.setRows(rows);
    const isis = this.rows.filter((r) => r.isisTag).length;
    this.count.textContent = t(isis ? 'nopBrowser.countIsis' : 'nopBrowser.count', { shown: rows.length, total: this.rows.length, isis });
  }

  /**
   * Selects the first NOP on a page (thumbnail clicks).
   * @param {number} page Page number.
   * @returns {void}
   */
  revealPage(page) {
    const row = this.table.shownRows.find((r) => r.pageNumber === page);
    if (row) this.table.mark(row);
  }

  /**
   * Exports the rows shown.
   * @param {'json'|'csv'} format Format.
   * @returns {void}
   */
  #export(format) {
    if (!this.rows) return;
    const rows = this.table.shownRows;
    if (format === 'csv') {
      const csv = tableCsv(COLUMNS.map(([key]) => t(`nopBrowser.col.${key}`)), rows.map((r) => [r.offset, r.pageNumber, r.codePage, r.text]));
      saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), tableFileName(this.documentName, '_NOP', 'csv'));
      return;
    }
    const json = rows.map((r) => ({ offset: r.offset, page: r.pageNumber, encoding: r.codePage, isisTag: r.isisTag, text: r.text }));
    saveBlob(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), tableFileName(this.documentName, '_NOP', 'json'));
  }
}

customElements.define('nop-browser', NopBrowser);
