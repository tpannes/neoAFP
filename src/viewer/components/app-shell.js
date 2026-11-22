/**
 * <neoafp-app>: the viewer's frame (FR-093, FR-095). Two screens share it:
 * - the AFP-Viewer (views/afp-viewer.js), shown from the start, also before any file is open;
 * - the Resource-Explorer (views/resources-view.js).
 * The top bar always shows the neoAFP logo on the left and the language menu on the right; in
 * between the active screen's own controls, the buttons to open files or a folder and the button
 * that switches between the two screens (to the Resource-Explorer, or back to the AFP-Viewer).
 * Below the screens: the Log Viewer (the diagnostics list, opened from the status bar) and the
 * status bar with progress from the parser worker and, at its right end, the version (FR-100).
 * Files can be dropped anywhere.
 *
 * Screens register with `registerScreen(name, element)`; an element may offer `barItems`, an
 * element the frame shows in the top bar while that screen is active.
 */

import './diagnostics-panel.js';
import './language-menu.js';
import './about-dialog.js';
import { t, applyTranslations, availableLanguages, setLanguage, currentLanguage, onLanguageChange } from '../i18n/i18n.js';
import { pickFiles, enableDrop } from '../file-open.js';
import { iconButton, brandLogo } from '../icons.js';
import { VERSION } from '../../version.js';

/**
 * Creates an element with optional class, text key and attributes.
 * @param {string} tag Tag name.
 * @param {{className?: string, i18n?: string, attrs?: Record<string,string>}} [options] Options.
 * @returns {HTMLElement} The element.
 */
function el(tag, { className, i18n, attrs } = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (i18n) {
    node.dataset.i18n = i18n;
    node.textContent = t(i18n);
  }
  for (const [k, v] of Object.entries(attrs ?? {})) node.setAttribute(k, v);
  return node;
}

export class AppShell extends HTMLElement {
  /** Creates the frame; call `attach(client)` to connect it to the parser worker. */
  constructor() {
    super();
    /** @type {Map<string, object>} file id → summary */
    this.files = new Map();
    /** @type {Map<string, HTMLElement>} screen name → element */
    this.screens = new Map();
    this.activeScreen = 'viewer';
  }

  /**
   * Connects the frame to the parser worker and builds the interface.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   * @returns {Promise<void>} Resolves when the interface is ready.
   */
  async attach(client) {
    this.client = client;
    this.#build();
    await this.#fillLanguages();
    client.on('progress', (p) => this.#onProgress(p));
    client.on('diagnostic', ({ diagnostic }) => {
      this.diagnostics.add(diagnostic);
      this.#updateLogButton();
    });
    client.on('fileReady', ({ file }) => this.files.set(file.id, file));
    client.on('error', ({ message }) => this.#setStatusKey('error.workerFailed', { message }));
    onLanguageChange(() => {
      this.#updateLogButton();
      if (this.statusKey) this.#setStatusKey(...this.statusKey);
    });
  }

  /** Builds top bar, screen area, Log Viewer and status bar. */
  #build() {
    const bar = el('header', { className: 'topbar', attrs: { role: 'toolbar' } });
    const brand = el('span', { className: 'brand' });
    brand.append(brandLogo('brand-logo'));
    this.screenItems = el('div', { className: 'topbar-screen' });
    const open = iconButton('open', 'toolbar.open');
    const openFolder = iconButton('folder', 'toolbar.openFolder');
    open.addEventListener('click', async () => this.openFiles(await pickFiles({ folder: false }), 'file'));
    openFolder.addEventListener('click', async () => this.openFiles(await pickFiles({ folder: true }), 'folder'));
    this.toResources = iconButton('resources', 'toolbar.resourceExplorer', { className: 'screen-switch' });
    this.toResources.addEventListener('click', () => this.showScreen('resources'));
    this.toViewer = iconButton('back', 'toolbar.backToViewer', { className: 'screen-switch' });
    this.toViewer.addEventListener('click', () => this.showScreen('viewer'));
    this.languageMenu = el('language-menu');
    this.languageMenu.addEventListener('change', (e) => setLanguage(e.detail.tag));
    // Tooltips and names for widths where only the icons are shown (see base.css).
    open.dataset.i18nAttr = 'title:toolbar.open,aria-label:toolbar.open';
    openFolder.dataset.i18nAttr = 'title:toolbar.openFolder,aria-label:toolbar.openFolder';
    const opens = el('div', { className: 'topbar-group' });
    opens.append(open, openFolder);
    bar.append(brand, this.screenItems, el('span', { className: 'spacer' }), opens, this.toResources, this.toViewer, this.languageMenu);

    const workspace = el('div', { className: 'workspace' });
    this.main = el('main', { className: 'main-area' });
    this.diagnostics = el('diagnostics-panel', { attrs: { id: 'log-viewer' } });
    this.diagnostics.hidden = true;
    this.diagnostics.addEventListener('close', () => this.toggleLog(false));
    workspace.append(this.main, this.diagnostics);
    enableDrop(this, (files, origin) => this.openFiles(files, origin));

    const status = el('footer', { className: 'status-bar', attrs: { role: 'status' } });
    this.statusText = el('span', { i18n: 'status.ready' });
    this.progress = el('progress', { attrs: { max: '1', value: '0' } });
    this.progress.hidden = true;
    this.logButton = iconButton('log', 'panel.diagnostics', { className: 'log-toggle' });
    this.logButton.setAttribute('aria-controls', 'log-viewer');
    this.logButton.setAttribute('aria-expanded', 'false');
    this.logButton.addEventListener('click', () => this.toggleLog());
    const version = el('span', { className: 'app-version' });
    version.textContent = `v${VERSION}`;
    // Info button at the right end: About neoAFP (author, AI development, license).
    this.about = el('about-dialog');
    const aboutButton = iconButton('info', 'about.open', { iconOnly: true, className: 'about-button' });
    aboutButton.addEventListener('click', () => this.about.open());
    status.append(this.statusText, this.progress, el('span', { className: 'spacer' }), this.logButton, version, aboutButton);
    // The dialog sits outside the status bar, whose content screen readers announce.
    this.replaceChildren(bar, workspace, status, this.about);
    applyTranslations(this);
    this.#updateLogButton();
    this.#updateBar();
  }

  /**
   * Opens the Log Viewer, all messages or only those of a scope (one page).
   * @param {{fileId: string, from: number, to: number, label: string}|null} [scope] Scope.
   * @returns {void}
   */
  showLog(scope = null) {
    this.diagnostics.setScope(scope);
    this.toggleLog(true);
  }

  /**
   * Opens or closes the Log Viewer.
   * @param {boolean} [open] True to open; toggles when omitted.
   * @returns {void}
   */
  toggleLog(open = this.diagnostics.hidden) {
    this.diagnostics.hidden = !open;
    this.logButton.setAttribute('aria-expanded', String(open));
    this.logButton.classList.toggle('active', open);
  }

  /** Fills the language menu. */
  async #fillLanguages() {
    this.languageMenu.setLanguages(await availableLanguages(), currentLanguage());
  }

  /**
   * Adds a screen.
   * @param {'viewer'|'resources'} name Screen name.
   * @param {HTMLElement} element Screen element (may have `barItems`).
   * @returns {void}
   */
  registerScreen(name, element) {
    element.classList.add('screen');
    element.dataset.screen = name;
    this.screens.set(name, element);
    this.main.append(element);
    this.showScreen(this.activeScreen);
  }

  /**
   * Shows one screen and its top bar controls.
   * @param {'viewer'|'resources'} name Screen name.
   * @returns {void}
   */
  showScreen(name) {
    this.activeScreen = name;
    for (const [screen, element] of this.screens) element.hidden = screen !== name;
    this.#updateBar();
    this.dispatchEvent(new CustomEvent('screenchange', { detail: { screen: name } }));
  }

  /** Shows the active screen's controls and the matching screen switch in the top bar. */
  #updateBar() {
    const items = this.screens.get(this.activeScreen)?.barItems;
    this.screenItems.replaceChildren(...(items ? [items] : []));
    this.toResources.hidden = this.activeScreen === 'resources';
    this.toViewer.hidden = this.activeScreen !== 'resources';
  }

  /**
   * Shows a message in the status bar.
   * @param {string} text Text.
   * @returns {void}
   */
  setStatus(text) {
    this.#setStatus(text);
  }

  /**
   * Sends files to the parser worker.
   * @param {{blob: Blob, name: string, path: string}[]} files Files to open.
   * @param {'file'|'folder'} origin How they were opened.
   * @returns {Promise<object[]>} Summaries of the added files.
   */
  async openFiles(files, origin) {
    if (!files.length) return [];
    this.#setStatusKey('status.loading', { done: 0, total: files.length });
    this.progress.hidden = false;
    const added = await this.client.call('addBlobs', files, origin);
    this.progress.hidden = true;
    this.#setStatusKey('status.files', { count: this.files.size });
    this.dispatchEvent(new CustomEvent('filesadded', { detail: { files: added, origin } }));
    return added;
  }

  /**
   * Shows progress from the worker.
   * @param {{phase: string, done: number, total: number}} p Progress event.
   * @returns {void}
   */
  #onProgress(p) {
    if (p.phase === 'index') {
      this.progress.hidden = false;
      this.progress.max = p.total || 1;
      this.progress.value = p.done;
      this.#setStatusKey('status.indexing', { done: p.done, total: p.total });
    }
  }

  /**
   * Sets the status bar text.
   * @param {string} text Text.
   * @returns {void}
   */
  #setStatus(text) {
    this.statusKey = null;
    this.statusText.removeAttribute('data-i18n');
    this.statusText.textContent = text;
  }

  /**
   * Sets the status bar to a translated message, translated again after a language change.
   * @param {string} key Locale key.
   * @param {Record<string, string|number>} params Placeholder values.
   * @returns {void}
   */
  #setStatusKey(key, params) {
    this.#setStatus(t(key, params));
    this.statusKey = [key, params];
  }

  /** Shows the number of messages on the Log Viewer button. */
  #updateLogButton() {
    const label = this.logButton.querySelector('span');
    label.removeAttribute('data-i18n');
    label.textContent = t('panel.diagnosticsCount', { count: this.diagnostics.all.length });
    const errors = this.diagnostics.all.some((d) => d.severity === 'error');
    this.logButton.classList.toggle('has-errors', errors);
  }
}

customElements.define('neoafp-app', AppShell);
