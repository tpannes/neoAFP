/**
 * Page viewer, the middle of the AFP-Viewer (user story 1, FR-015–FR-018, FR-098, FR-099): a
 * toolbar with page navigation, zoom, the simplex switch, the test print switch, the page text
 * search and the export of the current page (PNG, TIFF, text); and the pages in one continuous scroll area (FR-017): page after page (simplex) or
 * sheet after sheet with front and back as the medium maps define (default). The current page is
 * the one in the middle of the window; navigation scrolls to a page instead of replacing it.
 * While no AFP file is open, the welcome panel takes the place of the pages.
 *
 * Inspect (FR-034): a toolbar switch (Escape ends it) outlines the element under the pointer and
 * shows what it is and where (mm from the page's top-left corner and the page's own units); a
 * click on it emits `inspectfield`.
 *
 * Color picker: a toolbar switch next to Inspect (the two end each other; Escape ends it) shows
 * for the element under the pointer its color as given in the file (color space and values,
 * e.g. "CMYK 100 20 0 0 %"; "default color" when none is given), the element, and the color on
 * screen, which is only an approximation (no color management). A click copies the color as
 * given in the file, else as drawn ("#rrggbb").
 *
 * Marked fields (FR-034, from the structure view's "Show on page") end with the Escape key, a
 * click on empty paper (where no element lies) or switching Inspect off; Escape and the click on
 * empty paper end Inspect too. Search hits stay marked: they belong to the page search.
 * Events (bubbling): `pagechange` (detail: { documentId, page }) when the current page changes;
 * `inspectfield` (detail: { item, page }) when an element is clicked while inspecting.
 */

import '../components/page-scroller.js';
import '../components/page-nav.js';
import '../components/view-toggle.js';
import '../components/test-print-toggle.js';
import '../components/page-search.js';
import '../components/menu-button.js';
import '../components/welcome-panel.js';
import { CanvasRenderer } from '../render/canvas-renderer.js';
import '../render/image-renderer.js';
import '../render/pdf-bridge.js';
import { saveBlob, downloadPng } from '../download.js';
import { encodeTiff } from '../../lib/export/tiff.js';
import { t, currentLanguage } from '../i18n/i18n.js';
import { iconButton } from '../icons.js';
import { ColorPicker, describeItem, sourceOf } from '../components/color-picker.js';

/** Resolution of exported page images (dots per inch). */
const EXPORT_DPI = 300;

export class DocumentView extends HTMLElement {
  /**
   * Connects the view to the worker and the application frame.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   * @param {HTMLElement} app Application frame (<neoafp-app>).
   * @returns {void}
   */
  attach(client, app) {
    this.client = client;
    this.app = app;
    this.renderer = new CanvasRenderer(client);
    this.documentId = null;
    this.documentName = '';
    this.page = 1;
    this.pageCount = 0;
    this.viewToken = 0;
    this.#build();
    client.on('pagesInvalidated', ({ documentId }) => {
      if (documentId !== this.documentId) return;
      this.reload();
    });
  }

  /** Builds the layout. */
  #build() {
    this.classList.add('document-view');
    const toolbar = document.createElement('div');
    toolbar.className = 'viewer-toolbar';
    toolbar.setAttribute('role', 'toolbar');
    this.nav = document.createElement('page-nav');
    this.nav.addEventListener('navigate', (e) => this.showPage(e.detail.page));
    this.nav.addEventListener('zoom', (e) => this.scroller.setZoom(e.detail.value));
    this.toggle = document.createElement('view-toggle');
    this.toggle.addEventListener('change', () => this.reload());
    this.testPrint = document.createElement('test-print-toggle');
    this.testPrint.addEventListener('change', (e) => {
      this.renderer.hideTestPrint = e.detail.hide;
      this.scroller.redraw();
      this.dispatchEvent(new CustomEvent('testprintchange', { detail: { hide: e.detail.hide }, bubbles: true }));
    });
    this.inspectButton = iconButton('inspect', 'inspect.toggle', { iconOnly: true, className: 'toggle' });
    this.inspectButton.setAttribute('aria-pressed', 'false');
    // Switching Inspect off also ends a field marking.
    this.inspectButton.addEventListener('click', () => {
      if (this.scroller.inspecting) this.#endMarking();
      else this.setInspecting(true);
    });
    this.pickButton = iconButton('pipette', 'pick.toggle', { iconOnly: true, className: 'toggle' });
    this.pickButton.setAttribute('aria-pressed', 'false');
    this.pickButton.addEventListener('click', () => this.setPicking(!this.scroller.picking));
    const switches = document.createElement('span');
    switches.className = 'tool-group';
    switches.append(this.toggle, this.testPrint, this.inspectButton, this.pickButton);
    this.search = document.createElement('page-search');
    this.search.attach(this.client);
    // Every occurrence on the pages shown is marked (the scroller asks marksOf for each page it
    // draws); the current hit (the one the arrows go to) stronger.
    this.search.addEventListener('hit', (e) => this.#showHit(e.detail));
    // Pages whose occurrences arrive together are drawn again once.
    let redraw = null;
    this.search.addEventListener('marks', () => {
      clearTimeout(redraw);
      redraw = setTimeout(() => this.scroller.redraw(), 50);
    });
    this.search.addEventListener('clear', () => this.scroller.setSearch(null));
    this.exportMenu = document.createElement('menu-button');
    this.exportMenu.setup('download', 'export.label', [
      { labelKey: 'export.png', run: () => this.#export('png') },
      { labelKey: 'export.tiff', run: () => this.#export('tiff') },
      { labelKey: 'export.text', run: () => this.#export('text') },
    ], { iconOnly: true });
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    toolbar.append(this.nav, switches, spacer, this.search, this.exportMenu);

    const stage = document.createElement('div');
    stage.className = 'document-stage';
    this.scroller = document.createElement('page-scroller');
    this.scroller.renderer = this.renderer;
    this.scroller.addEventListener('zoomchange', (e) => this.nav.showZoom(e.detail.zoom, e.detail.mode));
    this.scroller.addEventListener('currentchange', (e) => this.#onScrolled(e.detail.index));
    this.tip = document.createElement('div');
    this.tip.className = 'inspect-tip';
    this.tip.hidden = true;
    this.tip.setAttribute('role', 'status');
    this.scroller.addEventListener('inspecthover', (e) => this.#showTip(e.detail));
    this.scroller.addEventListener('inspectleave', () => {
      if (this.scroller.picking) this.picker.leave();
      else this.tip.hidden = true;
    });
    this.picker = new ColorPicker({
      client: this.client, tip: this.tip,
      locate: (x, y) => this.scroller.pickSpot(x, y),
      outline: (spot, item) => this.scroller.outlineItem(spot, item),
      status: (text) => this.app?.setStatus?.(text),
    });
    // A finger moving over the pages scrolls them; a tap picks (see ColorPicker).
    this.scroller.addEventListener('pickmove', (e) => { if (e.detail.pointerType !== 'touch') this.picker.move(e.detail.clientX, e.detail.clientY, e.detail.pointerType); });
    this.scroller.addEventListener('pickclick', (e) => this.picker.click(e.detail.clientX, e.detail.clientY, e.detail));
    this.scroller.addEventListener('blankclick', () => this.#endMarking());
    this.scroller.addEventListener('inspectselect', (e) => {
      this.dispatchEvent(new CustomEvent('inspectfield', { bubbles: true, detail: { item: e.detail.item, page: e.detail.area?.pageNumber ?? this.page } }));
    });
    this.welcome = document.createElement('welcome-panel');
    stage.append(this.scroller, this.welcome);
    this.append(toolbar, stage, this.tip);
    this.renderer.hideTestPrint = this.testPrint.hide;
    this.#setEmpty(true);
    // Escape ends a field marking and Inspect, also while the focus is elsewhere (e.g. still on
    // the structure view's button), as long as the page view is shown and no dialog or input has it.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.offsetParent || !(this.scroller.inspecting || this.scroller.picking || this.scroller.highlight?.rows)) return;
      if (e.target.closest?.('input, select, textarea, dialog') || document.querySelector('dialog[open]')) return;
      if (this.scroller.picking) this.setPicking(false);
      else this.#endMarking();
      e.preventDefault();
    });
    // While picking colors: arrows move the point, Tab steps through stacked elements, Enter
    // copies (before the scroll area uses the arrows to scroll, hence the capture phase).
    document.addEventListener('keydown', (e) => {
      if (!this.scroller.picking || !this.offsetParent || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest?.('input, select, textarea, dialog') || document.querySelector('dialog[open]')) return;
      if (!this.picker.key(e)) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    this.addEventListener('keydown', (e) => {
      if (e.target.closest('input, select')) return;
      if (e.key === 'PageDown' || (e.key === 'ArrowRight' && e.altKey)) this.showPage(this.page + 1);
      else if (e.key === 'PageDown' || (e.key === 'ArrowRight' && e.altKey)) this.showPage(this.page + 1);
      else if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && e.altKey)) this.showPage(this.page - 1);
      else return;
      e.preventDefault();
    });
    this.tabIndex = -1;
  }

  /**
   * Turns inspecting on or off.
   * @param {boolean} on True to inspect.
   * @returns {void}
   */
  setInspecting(on) {
    if (on && this.scroller.picking) this.picker.stop();
    this.scroller.setInspecting(on);
    this.inspectButton.setAttribute('aria-pressed', String(on));
    this.pickButton.setAttribute('aria-pressed', String(this.scroller.picking));
    if (!on) this.tip.hidden = true;
  }

  /**
   * Turns the color picker on or off (it ends Inspect, and Inspect ends it).
   * @param {boolean} on True to pick colors.
   * @returns {void}
   */
  setPicking(on) {
    if (!on && this.scroller.picking) this.picker.stop();
    this.scroller.setPicking(on);
    this.pickButton.setAttribute('aria-pressed', String(on));
    this.inspectButton.setAttribute('aria-pressed', String(this.scroller.inspecting));
    if (!on) this.tip.hidden = true;
  }

  /**
   * Places the tooltip beside the pointer, inside the window.
   * @param {number} clientX Pointer x.
   * @param {number} clientY Pointer y.
   * @returns {void}
   */
  #placeTip(clientX, clientY) {
    const { innerWidth, innerHeight } = window;
    const box = this.tip.getBoundingClientRect();
    const left = clientX + 16 + box.width > innerWidth ? clientX - 16 - box.width : clientX + 16;
    const top = clientY + 16 + box.height > innerHeight ? clientY - 16 - box.height : clientY + 16;
    this.tip.style.left = `${Math.max(4, left)}px`;
    this.tip.style.top = `${Math.max(4, top)}px`;
  }

  /**
   * Shows the inspect tooltip next to the pointer: the element, its source, the position.
   * @param {{item: object|null, x: number, y: number, area: object|null, clientX: number, clientY: number}} d Hover.
   * @returns {void}
   */
  #showTip(d) {
    const lines = [];
    if (d.item) lines.push(['inspect-kind', describeItem(d.item)]);
    const from = d.item ? sourceOf(d.item) : null;
    if (from) lines.push(['inspect-hint', from]);
    if (d.area) {
      const x = d.x - d.area.x;
      const y = d.y - d.area.y;
      // Millimetres with one decimal in the language's style; page units as plain integers.
      const mmFormat = new Intl.NumberFormat(currentLanguage(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      const mm = (v) => mmFormat.format((v / 1440) * 25.4);
      const plain = (v) => String(Math.round(v));
      const units = d.area.unitsPerInch;
      lines.push(['inspect-pos', t('inspect.position', { page: d.area.pageNumber, x: mm(x), y: mm(y) })]);
      if (units) {
        lines.push(['inspect-pos', t('inspect.units', { x: plain((x * units.x) / 1440), y: plain((y * units.y) / 1440), resolution: plain(units.x) })]);
      }
    }
    if (d.item) lines.push(['inspect-hint', t('inspect.hint')]);
    this.tip.replaceChildren(...lines.map(([className, text]) => Object.assign(document.createElement('div'), { className, textContent: text })));
    this.tip.hidden = !lines.length;
    this.#placeTip(d.clientX, d.clientY);
  }

  /**
   * Shows the welcome panel (no file open) or the pages; the toolbar is disabled while empty.
   * @param {boolean} empty True when no document is open.
   * @returns {void}
   */
  #setEmpty(empty) {
    if (empty) {
      this.setInspecting(false);
      this.setPicking(false);
    }
    this.welcome.hidden = !empty;
    this.scroller.hidden = empty;
    this.exportMenu.disabled = empty;
    for (const b of this.querySelectorAll('.viewer-toolbar button, .viewer-toolbar input, .viewer-toolbar select')) {
      if (!this.exportMenu.contains(b)) b.disabled = empty;
    }
    if (!empty) this.nav.update();
  }

  /**
   * Shows a document from a page.
   * @param {{id: string, name: string, pageCount: number}} doc Document (from listDocuments).
   * @param {number} [page] Page to show first.
   * @returns {Promise<void>} Resolves when the page is shown.
   */
  async openDocument(doc, page = 1) {
    // High priority: the first page must not wait behind the Details panel's work (T230).
    await this.client.request({ method: 'setActiveDocument', args: [doc.id], priority: 'high' });
    this.documentId = doc.id;
    this.documentName = doc.name;
    this.pageCount = doc.pageCount;
    this.#setEmpty(false);
    this.search.setFile(doc.id);
    this.page = page;
    await this.reload();
  }

  /**
   * Fills the scroll area for the current view (FR-018), keeping the current page in view: every
   * page alone (simplex switch on), or the sheets as the medium maps define them (a duplex sheet
   * with front and back, a simplex sheet alone on the left).
   * @returns {Promise<void>} Resolves when the layout is set up.
   */
  reload() {
    this.loading = this.#fill().catch(() => {
      // The document could not be laid out (e.g. replaced meanwhile); the Log Viewer tells why.
    });
    return this.loading;
  }

  /**
   * Builds the rows of the current view and hands them to the scroll area.
   * @returns {Promise<void>} Resolves when the layout is set up.
   */
  async #fill() {
    if (!this.documentId || this.pageCount === 0) return;
    const token = ++this.viewToken;
    const { documentId, pageCount } = this;
    const call = (method, ...args) => this.client.request({ method, args, priority: 'high' });
    this.page = Math.min(pageCount, Math.max(1, this.page));
    let source;
    if (this.toggle.view === 'simplex') {
      this.sheetFirstPage = null;
      source = { kind: 'page', count: pageCount, pageCount, load: async (i) => ({ model: await call('getRenderModel', documentId, i + 1) }) };
    } else {
      // The layout only (typed arrays, T230): a sheet object is fetched when its row is drawn.
      const layout = await call('getSheetLayout', documentId);
      if (token !== this.viewToken) return;
      this.sheetFirstPage = layout.firstPage;
      this.rowOfPage = new Int32Array(pageCount + 1);
      for (let row = 0; row < layout.count; row++) {
        for (let page = layout.firstPage[row]; page < layout.firstPage[row + 1]; page++) this.rowOfPage[page] = row;
      }
      source = {
        kind: 'sheet',
        count: layout.count,
        pageCount,
        // No sheet with a page on its back: one centred column, without empty back places.
        frontOnly: !layout.hasBack.includes(1),
        load: async (i) => {
          const sheet = await call('getSheet', documentId, i + 1);
          const [front, back] = await Promise.all([
            call('getSheetRenderModel', documentId, sheet.number, 'front'),
            // A back side without a page is not in the AFP and is not shown (page-scroller.js).
            sheet.back?.placements.length ? call('getSheetRenderModel', documentId, sheet.number, 'back') : null,
          ]);
          return { sheet, front, back, single: !sheet.back };
        },
      };
    }
    const row = this.#rowOf(this.page);
    await this.scroller.setSource(source, row);
    if (token !== this.viewToken) return;
    // Navigation while the first row loaded: go to the page asked for last.
    if (this.#rowOf(this.page) !== row) this.scroller.scrollToIndex(this.#rowOf(this.page));
    this.#pageChanged();
  }

  /**
   * Returns the row of the scroll area that shows a page.
   * @param {number} page Page number.
   * @returns {number} Row index.
   */
  #rowOf(page) {
    return this.sheetFirstPage ? this.rowOfPage[page] : page - 1;
  }

  /**
   * Scrolls to a page (navigation controls, thumbnails, keys). While the viewer is hidden the
   * page is only remembered and scrolled to when it is shown again (see shown()).
   * @param {number} page Page number.
   * @returns {void}
   */
  showPage(page) {
    if (!this.documentId || this.pageCount === 0) return;
    this.page = Math.min(this.pageCount, Math.max(1, page));
    if (this.search) this.search.viewPage = this.page;
    if (this.offsetParent !== null) this.scroller.scrollToIndex(this.#rowOf(this.page));
    else this.pendingScroll = true;
    this.#pageChanged();
  }

  /** Scrolls to the remembered page after the viewer was hidden (called when it is shown). */
  shown() {
    if (!this.pendingScroll) return;
    this.pendingScroll = false;
    this.scroller.scrollToIndex(this.#rowOf(this.page));
  }

  /**
   * Follows the user's scrolling: the row in the middle of the window holds the current page (on a
   * sheet, the current page stays if it is on that sheet, otherwise its first page).
   * @param {number} index Row index.
   * @returns {void}
   */
  #onScrolled(index) {
    if (this.offsetParent === null) return;
    let page = index + 1;
    if (this.sheetFirstPage) {
      const first = this.sheetFirstPage[index];
      const next = this.sheetFirstPage[index + 1];
      if (first !== undefined) page = this.page >= first && this.page < next ? this.page : first;
    }
    if (page === this.page) return;
    this.page = page;
    // The user scrolled: the next search step starts from here.
    this.search.viewPage = page;
    this.#pageChanged();
  }

  /** Updates the page number and announces the current page. */
  #pageChanged() {
    this.nav.page = this.page;
    this.nav.pageCount = this.pageCount;
    this.nav.update();
    this.dispatchEvent(new CustomEvent('pagechange', { detail: { documentId: this.documentId, page: this.page }, bubbles: true }));
  }

  /**
   * Shows a page with fields or a search hit highlighted (structure view, page search).
   * @param {number} page Page number.
   * @param {Set<number>|null} [highlight] Source field rows to highlight.
   * @param {Map<number, [number, number, boolean][]>|null} [runs] Character ranges of the page's
   *   glyph runs (by item index in the page's render model) to highlight; true = current hit.
   * @returns {Promise<void>} Resolves when shown.
   */
  async goTo(page, highlight = null, runs = null) {
    await this.loading;
    this.showPage(page);
    this.scroller.setHighlight(page, highlight, runs, this.documentId);
  }

  /**
   * Shows a search hit: marks it and scrolls only as far as needed to bring it into view, so
   * stepping through the hits of one page does not jump back to the top of the page.
   * @param {{pageNumber: number, itemIndex?: number, charStart?: number, charEnd?: number}} hit
   *   Hit; without `itemIndex` while its position is fetched.
   * @returns {Promise<void>} Resolves when shown.
   */
  async #showHit({ pageNumber, itemIndex, charStart, charEnd }) {
    await this.loading;
    const page = Math.min(this.pageCount, Math.max(1, pageNumber));
    const current = itemIndex === undefined || itemIndex === null ? null : { page, itemIndex, charStart, charEnd };
    this.scroller.setHighlight(page, null, null, this.documentId);
    this.scroller.setSearch({ marks: (p) => this.search.marksOf(p), current });
    if (!current || this.offsetParent === null) this.showPage(page);
    else {
      this.page = page;
      await this.scroller.revealItem(this.#rowOf(page), page, itemIndex);
      this.#pageChanged();
    }
    // The view is at the hit: the next step continues from it, not from the page shown.
    this.search.viewPage = null;
  }

  /** Ends a field marking and Inspect; search hits stay. */
  #endMarking() {
    this.scroller.clearMarkedFields();
    if (this.scroller.inspecting) this.setInspecting(false);
  }

  /**
   * Exports the current page as PNG or TIFF image (300 dpi) or as plain text (FR-099).
   * @param {'png'|'tiff'|'text'} format Format.
   * @returns {Promise<void>} Resolves when the file is offered for saving.
   */
  async #export(format) {
    const { documentId, page } = this;
    if (!documentId) return;
    const base = `${this.documentName.replace(/\.[^.]*$/, '')}-p${page}`;
    if (format === 'text') {
      const text = await this.client.call('getPageText', documentId, page);
      saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), `${base}.txt`);
      return;
    }
    const model = await this.client.call('getRenderModel', documentId, page);
    const canvas = document.createElement('canvas');
    await this.renderer.draw(canvas, model, { scale: EXPORT_DPI / 1440, pixelRatio: 1 });
    if (format === 'png') {
      await downloadPng(canvas, base, EXPORT_DPI);
      return;
    }
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const tiff = await encodeTiff({ width: canvas.width, height: canvas.height, rgba: data, dpi: EXPORT_DPI });
    saveBlob(new Blob([tiff], { type: 'image/tiff' }), `${base}.tif`);
  }
}

customElements.define('document-view', DocumentView);
