/**
 * AFP-Viewer screen (FR-095): the main screen, shown from the start (empty until an AFP file is
 * open, with the welcome panel in the middle).
 * - Top bar items (shown by the application frame): the views Pages, TLE, NOP and Structure;
 *   then a dropdown of the open AFP files with their number of documents and pages (only when
 *   more than one is open, so last: the other controls keep their places when it appears).
 * - The thumbnails and the Details panel each have a button in their header that hides them
 *   (remembered as the preferences `showThumbnails` and `showDetails`). A hidden panel leaves a
 *   narrow rail at its screen edge with a grip in the middle; a click opens the panel again. The
 *   rail has its own column, so it covers no content, and it is drawn in the panel colors with
 *   an accent grip, so it is seen; after the user hides a panel the grip pulses briefly to show
 *   where it went.
 * - Left: the thumbnails of all pages (FR-016). A click shows the page in the page viewer, selects
 *   its page group in the TLE browser, its first NOP in the NOP browser or the page in the
 *   structure view.
 * - Middle: the page viewer (document-view.js), or the TLE browser, the NOP browser or the
 *   structure view, which take the place of both the page viewer and the Details panel.
 * - Right: the Details panel (details-panel.js), next to the page viewer only.
 * When only resources are opened, the application switches to the Resource-Explorer.
 * Inspecting the page (FR-034): a click on an element opens the structure view on the field that
 * drew it; for an element of a resource in another file, on the Include field of this file that
 * brought it in (the status bar names the resource and its file); medium overlays from the form
 * definition have no field in the file (the status bar says so).
 */

import './document-view.js';
import './tle-browser.js';
import './nop-browser.js';
import './structure-view.js';
import '../components/thumbnail-strip.js';
import '../components/details-panel.js';
import { t, onLanguageChange, applyTranslations } from '../i18n/i18n.js';
import { enableTabKeys, markSelectedTab } from '../components/tablist.js';
import { iconButton } from '../icons.js';
import { loadPrefs, savePrefs } from '../prefs.js';

/** The views of the middle area with their icons. */
const MODES = [['pages', 'pages'], ['tle', 'table'], ['nop', 'comment'], ['structure', 'tree']];

export class AfpViewer extends HTMLElement {
  /**
   * Connects the screen.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   * @param {HTMLElement} app Application frame.
   * @returns {Promise<void>} Resolves when built.
   */
  async attach(client, app) {
    this.client = client;
    this.app = app;
    this.mode = 'pages';
    this.documents = [];
    this.doc = null;
    const prefs = loadPrefs();
    // Narrow windows start with the side panels closed (the choice is not stored for this).
    this.showThumbs = prefs.showThumbnails && !matchMedia('(max-width: 600px)').matches;
    this.showDetails = prefs.showDetails && !matchMedia('(max-width: 1000px)').matches;
    this.classList.add('afp-viewer');
    this.#buildBar();

    this.thumbs = document.createElement('thumbnail-strip');
    this.thumbs.addEventListener('navigate', (e) => this.#onThumbnail(e.detail.page));
    this.pages = document.createElement('document-view');
    this.pages.attach(client, app);
    this.thumbs.renderer = this.pages.renderer;
    this.tle = document.createElement('tle-browser');
    this.nop = document.createElement('nop-browser');
    this.structure = document.createElement('structure-view');
    this.details = document.createElement('details-panel');
    this.details.attach(client, app);
    const center = document.createElement('div');
    center.className = 'viewer-center';
    center.append(this.pages, this.tle, this.nop, this.structure);
    this.thumbsRail = this.#rail('left', 'panel.showThumbnails', () => this.#showPanel('thumbs', true));
    this.detailsRail = this.#rail('right', 'panel.showDetails', () => this.#showPanel('details', true));
    this.append(this.thumbs, this.thumbsRail, center, this.details, this.detailsRail);
    this.thumbs.header.append(this.#collapseButton('collapseLeft', 'panel.hideThumbnails', () => this.#showPanel('thumbs', false)));
    this.details.header.append(this.#collapseButton('collapseRight', 'panel.hideDetails', () => this.#showPanel('details', false)));
    applyTranslations(this);
    await Promise.all([this.tle.attach(client), this.nop.attach(client), this.structure.attach(client, app)]);
    this.views = new Map([['pages', this.pages], ['tle', this.tle], ['nop', this.nop], ['structure', this.structure]]);
    this.#alignHeaders(center);

    this.addEventListener('pagechange', (e) => {
      if (e.target !== this.pages) return;
      this.thumbs.setCurrent(e.detail.page);
      this.details.setPage(e.detail.page);
    });
    this.addEventListener('testprintchange', () => this.thumbs.invalidate());
    for (const view of [this.tle, this.nop, this.structure]) view.addEventListener('pageselect', (e) => this.thumbs.setCurrent(e.detail.page));
    for (const browser of [this.tle, this.nop]) {
      browser.addEventListener('openpage', (e) => this.#openPage(e.detail.page));
    }
    this.structure.addEventListener('showonpage', async (e) => {
      this.setMode('pages');
      await this.pages.goTo(e.detail.page, e.detail.highlight);
    });
    this.tle.addEventListener('tlecodepagechange', () => this.structure.rebuild());
    this.nop.addEventListener('nopcodepagechange', () => this.structure.rebuild());
    this.structure.addEventListener('codepagechange', () => {
      this.pages.reload();
      this.thumbs.invalidate();
      this.pages.search.invalidate();
    });
    this.details.addEventListener('formdefchange', () => {
      this.pages.reload();
      this.thumbs.invalidate();
    });
    this.pages.addEventListener('inspectfield', (e) => this.#inspectField(e.detail.item, e.detail.page));
    this.details.addEventListener('openlog', (e) => app.showLog(e.detail?.scope ?? null));
    app.addEventListener('filesadded', (e) => this.#onFilesAdded(e.detail));
    client.on('pagesInvalidated', ({ documentId }) => {
      if (documentId !== this.doc?.id) return;
      this.thumbs.invalidate();
      this.details.refresh();
    });
    onLanguageChange(() => this.#fillFiles());
    this.#update();
  }

  /**
   * Gives the thumbnail header and the Details tabs the height of the active view's toolbar
   * (--view-header-height), so the three columns share one header band. Toolbars change height
   * when they wrap or when another view is shown (a hidden toolbar measures 0 and grows when
   * shown), so all of them are observed.
   * @param {HTMLElement} center The middle column with the views.
   * @returns {void}
   */
  #alignHeaders(center) {
    const sync = () => {
      const bar = [...center.querySelectorAll('.viewer-toolbar, .browser-toolbar')].find((b) => b.offsetHeight > 0);
      if (bar) this.style.setProperty('--view-header-height', `${bar.getBoundingClientRect().height}px`);
    };
    const observer = new ResizeObserver(sync);
    for (const bar of center.querySelectorAll('.viewer-toolbar, .browser-toolbar')) observer.observe(bar);
    sync();
  }

  /** Builds the controls the frame shows in the top bar. */
  #buildBar() {
    this.barItems = document.createElement('div');
    this.barItems.className = 'viewer-bar';
    this.fileSelect = document.createElement('select');
    this.fileSelect.className = 'file-select';
    this.fileSelect.dataset.i18nAttr = 'aria-label:docs.label,title:docs.label';
    this.fileSelect.addEventListener('change', () => this.openDocument(this.fileSelect.value));
    const modes = document.createElement('div');
    modes.className = 'segmented';
    modes.setAttribute('role', 'tablist');
    modes.dataset.i18nAttr = 'aria-label:toolbar.views';
    enableTabKeys(modes);
    this.modeButtons = new Map(MODES.map(([mode, iconName]) => {
      const b = iconButton(iconName, `mode.${mode}`);
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => this.setMode(mode));
      modes.append(b);
      return [mode, b];
    }));
    // The file dropdown comes last: it appears only with two or more files, and placed first it
    // pushed the views aside when it did.
    this.barItems.append(modes, this.fileSelect);
    applyTranslations(this.barItems);
  }

  /**
   * Builds the button in a panel header that hides the panel.
   * @param {string} iconName Icon.
   * @param {string} key Label key.
   * @param {() => void} onClick Action.
   * @returns {HTMLButtonElement} Button.
   */
  #collapseButton(iconName, key, onClick) {
    const b = iconButton(iconName, key, { iconOnly: true, className: 'panel-collapse' });
    b.addEventListener('click', onClick);
    return b;
  }

  /**
   * Builds the rail left at a screen edge by a hidden panel: the whole rail is the button.
   * @param {'left'|'right'} side Screen edge.
   * @param {string} key Label key.
   * @param {() => void} onClick Action.
   * @returns {HTMLButtonElement} Rail.
   */
  #rail(side, key, onClick) {
    const b = iconButton(side === 'left' ? 'next' : 'previous', key, { iconOnly: true, className: `panel-rail ${side}` });
    b.querySelector('.ico')?.classList.add('panel-grip');
    b.addEventListener('click', onClick);
    // The grip pulses once after hiding the panel; the animation is not repeated afterwards.
    b.addEventListener('animationend', () => b.classList.remove('pulse'));
    return b;
  }

  /**
   * Shows or hides the thumbnails or the Details panel and remembers the choice.
   * @param {'thumbs'|'details'} panel Panel.
   * @param {boolean} show True to show it.
   * @returns {void}
   */
  #showPanel(panel, show) {
    const rail = panel === 'thumbs' ? this.thumbsRail : this.detailsRail;
    if (panel === 'thumbs') {
      this.showThumbs = show;
      savePrefs({ showThumbnails: show });
    } else {
      this.showDetails = show;
      savePrefs({ showDetails: show });
    }
    this.#update();
    if (show) (panel === 'thumbs' ? this.thumbs : this.details).querySelector('.panel-collapse')?.focus();
    else {
      rail.classList.add('pulse');
      rail.focus();
    }
  }

  /** Shows or hides the parts for the current mode and toggles. */
  #update() {
    const open = Boolean(this.doc);
    for (const [mode, view] of this.views ?? []) view.hidden = mode !== this.mode;
    markSelectedTab(this.modeButtons, this.mode);
    for (const [mode, b] of this.modeButtons) b.disabled = !open && mode !== 'pages';
    this.thumbs.hidden = !this.showThumbs;
    this.details.hidden = !this.showDetails || this.mode !== 'pages';
    this.thumbsRail.hidden = this.showThumbs;
    this.detailsRail.hidden = this.showDetails || this.mode !== 'pages';
    this.fileSelect.hidden = this.documents.length < 2;
  }

  /**
   * Switches the middle area.
   * @param {'pages'|'tle'|'nop'|'structure'} mode View.
   * @returns {Promise<void>} Resolves when the view's content is loaded.
   */
  async setMode(mode) {
    if (!this.doc && mode !== 'pages') return;
    this.mode = mode;
    this.#update();
    const page = this.pages.page;
    if (mode === 'pages') this.pages.shown();
    else if (mode === 'structure') await this.structure.ensureLoaded();
    else {
      await this[mode].ensureLoaded();
      this[mode].revealPage(page);
    }
  }

  /**
   * Shows a page in the page viewer.
   * @param {number} page Page number.
   * @returns {Promise<void>} Resolves when shown.
   */
  async #openPage(page) {
    await this.setMode('pages');
    this.pages.showPage(page);
  }

  /**
   * Opens the structure view on the field that drew a page element.
   * @param {object} item Render item (with sourceField, fileId and maybe via or mediumOverlay).
   * @param {number} page Page the element is on.
   * @returns {Promise<void>} Resolves when the field is selected.
   */
  async #inspectField(item, page) {
    const docId = this.doc?.id;
    if (!docId) return;
    let row = null;
    // Text: its Presentation Text Data field; other elements: the object that drew them.
    if (item.fileId === docId) row = item.textField ?? item.dataField ?? item.sourceField;
    else if (item.via?.[0]?.fileId === docId) {
      row = item.via[0].row;
      // The Include field of this file (outermost) and the resource that holds the element (innermost).
      const include = item.via[0].name ?? '';
      const name = item.via.findLast((v) => v.name)?.name ?? include;
      const file = this.app.files.get(item.fileId)?.path ?? '';
      this.app.setStatus(t('inspect.inResource', { include, name, file }));
    }
    if (row === null || row === undefined) {
      this.app.setStatus(t('inspect.notInFile', { name: item.mediumOverlay ?? '' }));
      return;
    }
    this.thumbs.setCurrent(page);
    await this.setMode('structure');
    await this.structure.selectField(row);
  }

  /**
   * Follows a thumbnail click in the active view.
   * @param {number} page Page number.
   * @returns {void}
   */
  #onThumbnail(page) {
    this.thumbs.setCurrent(page);
    this.pages.showPage(page);
    if (this.mode === 'tle' || this.mode === 'nop') this[this.mode].revealPage(page);
    else if (this.mode === 'structure') this.structure.inspectPage(page);
  }

  /**
   * Updates the file list after files were added; opens the first AFP file if none is shown;
   * switches to the Resource-Explorer when only resources are open.
   * @param {{files: object[]}} detail Added files.
   * @returns {Promise<void>} Resolves when updated.
   */
  async #onFilesAdded(detail) {
    this.documents = await this.client.call('listDocuments');
    this.#fillFiles();
    if (!this.doc && this.documents.length) await this.openDocument(this.documents[0].id);
    else if (this.doc) {
      this.details.refresh();
      this.pages.search.invalidate();
    }
    if (!this.documents.length && detail.files.length) this.app.showScreen('resources');
    this.#update();
  }

  /** Fills the file dropdown: name, number of documents and pages. */
  #fillFiles() {
    this.fileSelect.replaceChildren(...this.documents.map((d) => new Option(
      t('docs.option', { name: d.path, documents: d.documentCount, pages: d.pageCount }), d.id, false, d.id === this.doc?.id,
    )));
    this.#update();
  }

  /**
   * Shows an AFP file in every view.
   * @param {string} documentId Document id.
   * @returns {Promise<void>} Resolves when its first page is shown.
   */
  async openDocument(documentId) {
    const doc = this.documents.find((d) => d.id === documentId);
    if (!doc) return;
    this.doc = doc;
    this.fileSelect.value = doc.id;
    this.thumbs.setDocument(this.client, this.pages.renderer, doc.id, doc.pageCount);
    this.tle.setDocument(doc.id, doc.name);
    this.nop.setDocument(doc.id, doc.name);
    this.structure.setDocument(doc.id);
    this.details.setDocument(doc.id);
    this.#update();
    await this.pages.openDocument(doc);
    if (this.mode !== 'pages') await this.setMode(this.mode);
  }
}

customElements.define('afp-viewer', AfpViewer);
