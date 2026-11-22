/**
 * Resource-Explorer screen (user story 3, FR-050–FR-059): all resources of the open files.
 * Filter bar (settings kept as the preference `resourceFilter`), grid view (default) with a
 * slider for the preview size, or list view with sorting; CSV download of the shown resources;
 * a click on a resource opens the preview dialog. The grid/list choice and the slider value are
 * kept as the preferences `resourceView` and `gridZoom`. The application frame's top bar holds
 * the buttons to add files or folders and to go back to the AFP-Viewer.
 */

import '../components/resource-grid.js';
import '../components/resource-list.js';
import '../components/resource-filters.js';
import '../components/resource-fullscreen.js';
import { CanvasRenderer } from '../render/canvas-renderer.js';
import { ResourceThumbs, typeLabel, sizeClassLabel } from '../render/resource-thumbs.js';
import { downloadCsv } from '../download.js';
import { loadPrefs, savePrefs } from '../prefs.js';
import { t, applyTranslations } from '../i18n/i18n.js';
import { iconButton } from '../icons.js';

const TYPES = ['pageSegment', 'overlay', 'fontCharacterSet', 'codePage', 'codedFont', 'truetypeFont', 'formDefinition',
  'image', 'graphics', 'barcode', 'objectContainer', 'colorManagementResource', 'iccProfile', 'colorAttributeTable'];
const SIZE_CLASSES = ['icon', 'small', 'medium', 'large', 'a4', 'largerThanA4', 'notApplicable'];
const CSV_COLUMNS = ['name', 'internalName', 'type', 'widthMm', 'heightMm', 'sizeClass', 'fileSize', 'resolution', 'colorProfile', 'encoding', 'source'];

export class ResourcesView extends HTMLElement {
  /**
   * Connects the view.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   * @param {HTMLElement} app Application frame.
   * @returns {void}
   */
  attach(client, app) {
    this.client = client;
    this.app = app;
    this.renderer = new CanvasRenderer(client);
    this.thumbs = new ResourceThumbs(client, this.renderer);
    const prefs = loadPrefs();
    this.mode = prefs.resourceView;
    this.zoom = Math.min(3, Math.max(0.5, prefs.gridZoom));
    this.sort = { by: 'name', direction: 'asc' };
    this.resources = [];
    this.#build();
    app.addEventListener('filesadded', () => this.#onFilesAdded());
    client.on('pagesInvalidated', () => { this.thumbs.clear(); this.refresh(); });
  }

  /** Builds the layout. */
  #build() {
    this.classList.add('resources-view');
    const bar = document.createElement('div');
    bar.className = 'resources-bar';
    this.filters = document.createElement('resource-filters');
    this.filters.addEventListener('change', () => this.refresh());
    this.modeButtons = new Map();
    const modes = document.createElement('div');
    modes.setAttribute('role', 'group');
    modes.className = 'segmented';
    for (const mode of ['grid', 'list']) {
      const b = iconButton(mode, `resources.mode.${mode}`);
      b.addEventListener('click', () => this.#setMode(mode));
      this.modeButtons.set(mode, b);
      modes.append(b);
    }
    const zoomLabel = document.createElement('label');
    zoomLabel.className = 'resource-zoom';
    const zoomText = document.createElement('span');
    zoomText.dataset.i18n = 'resources.zoom';
    zoomText.textContent = t('resources.zoom');
    this.slider = document.createElement('input');
    this.slider.type = 'range';
    Object.assign(this.slider, { min: '0.5', max: '3', step: '0.1', value: String(this.zoom) });
    this.slider.addEventListener('input', () => {
      this.zoom = Number(this.slider.value);
      this.grid.setZoom(this.zoom);
      savePrefs({ gridZoom: this.zoom });
    });
    zoomLabel.append(zoomText, this.slider);
    const csv = iconButton('download', 'resources.csv');
    csv.addEventListener('click', () => this.#downloadCsv());
    bar.append(modes, zoomLabel, csv);

    this.grid = document.createElement('resource-grid');
    this.list = document.createElement('resource-list');
    this.grid.addEventListener('open', (e) => this.#open(e.detail.index));
    this.list.addEventListener('open', (e) => this.#open(e.detail.index));
    this.list.addEventListener('sort', (e) => { this.sort = e.detail; this.refresh(); });
    this.fullscreen = document.createElement('resource-fullscreen');
    this.fullscreen.addEventListener('close', () => {
      this.#restoreScroll();
      // Mark the tile shown last (the dialog may have moved to other resources).
      if (this.fullscreen.resources === this.resources) this.grid.setCurrent(this.fullscreen.index);
    });
    this.body = document.createElement('div');
    this.body.className = 'resources-body';
    this.body.append(this.grid, this.list);
    this.empty = document.createElement('div');
    this.empty.className = 'empty-state';
    this.empty.dataset.i18n = 'resources.none';
    this.empty.textContent = t('resources.none');
    this.append(this.filters, bar, this.body, this.empty, this.fullscreen);
    this.grid.setZoom(this.zoom);
    this.#setMode(this.mode, false);
    applyTranslations(this);
  }

  /**
   * Switches between grid and list.
   * @param {'grid'|'list'} mode Mode.
   * @param {boolean} [save] Store the preference.
   * @returns {void}
   */
  #setMode(mode, save = true) {
    this.mode = mode;
    this.grid.hidden = mode !== 'grid';
    this.list.hidden = mode !== 'list';
    this.slider.disabled = mode !== 'grid';
    for (const [m, b] of this.modeButtons) {
      b.classList.toggle('active', m === mode);
      b.setAttribute('aria-pressed', String(m === mode));
    }
    if (save) savePrefs({ resourceView: mode });
  }

  /**
   * Reloads after files were added.
   * @returns {Promise<void>} Resolves when shown.
   */
  async #onFilesAdded() {
    this.thumbs.clear();
    await this.refresh();
  }

  /**
   * Loads the resources for the current filter and sort.
   * @returns {Promise<void>} Resolves when shown.
   */
  async refresh() {
    const token = (this.token = (this.token ?? 0) + 1);
    const [resources, options, all] = await Promise.all([
      this.client.call('getResources', this.filters.filter, this.sort),
      this.client.call('getFilterOptions'),
      this.client.call('getResources'),
    ]);
    if (token !== this.token) return;
    this.resources = resources;
    this.filters.setOptions(options);
    this.filters.showCount(resources.length, all.length);
    this.empty.hidden = all.length > 0;
    this.body.hidden = all.length === 0;
    this.grid.show(resources, this.thumbs);
    this.list.setSort(this.sort);
    this.list.show(resources);
  }

  /**
   * Opens the fullscreen view.
   * @param {number} index Resource index in the results.
   * @returns {Promise<void>} Resolves when shown.
   */
  async #open(index) {
    this.savedScroll = { grid: this.grid.scrollPosition, list: this.list.scrollPosition };
    await this.fullscreen.open({ client: this.client, app: this.app, renderer: this.renderer, thumbs: this.thumbs, resources: this.resources, index });
  }

  /**
   * Opens a resource in the fullscreen view (from a search result, FR-063); when filters hide it,
   * the fullscreen view steps through all resources instead.
   * @param {string} resourceId Resource id.
   * @returns {Promise<void>} Resolves when shown.
   */
  async openResource(resourceId) {
    let list = this.resources;
    const holds = (r) => r.id === resourceId || r.memberIds?.includes(resourceId);
    let index = list.findIndex(holds);
    if (index < 0) {
      list = await this.client.call('getResources', {}, this.sort);
      index = list.findIndex(holds);
    }
    if (index < 0) return;
    this.savedScroll = { grid: this.grid.scrollPosition, list: this.list.scrollPosition };
    await this.fullscreen.open({ client: this.client, app: this.app, renderer: this.renderer, thumbs: this.thumbs, resources: list, index });
  }

  /** Restores the scroll position after the fullscreen view (FR-054). */
  #restoreScroll() {
    if (!this.savedScroll) return;
    this.grid.scrollPosition = this.savedScroll.grid;
    this.list.scrollPosition = this.savedScroll.list;
  }

  /** Downloads the shown resources as CSV (FR-055). */
  async #downloadCsv() {
    const labels = Object.fromEntries(CSV_COLUMNS.map((c) => [c, t(`csv.${c}`)]));
    for (const type of TYPES) labels[`type.${type}`] = typeLabel(type);
    for (const c of SIZE_CLASSES) labels[`sizeClass.${c}`] = sizeClassLabel(c);
    // The CSV source column keeps the language-independent form "inline: <file>".
    downloadCsv(await this.client.call('exportResourcesCsv', this.resources, labels));
  }
}

customElements.define('resources-view', ResourcesView);
