/**
 * <resource-fullscreen>: the preview dialog of the Resource-Explorer (FR-054), a large modal
 * dialog over the resource grid: one resource enlarged with zoom in, zoom out, fit and actual
 * size; a metadata panel with every resource field; previous and next within the current results
 * (also with the arrow keys); PNG and TIFF download of the preview and extraction of the original
 * bytes (FR-056, FR-057). Above the metadata, a warning box lists the resources the preview
 * misses (placeholders, substitute fonts; FR-054), with a button to add files. Fonts show their character grid, coded fonts a sample and their
 * character map by code point, code pages their code point table (FR-058), form definitions
 * every medium map with diagram and settings. Esc or Close ends the view; the event `close` lets the resource view restore its
 * scroll position.
 */

import './font-grid.js';
import './codepage-table.js';
import './formdef-view.js';
import { t, onLanguageChange, applyTranslations } from '../i18n/i18n.js';
import { typeLabel, sizeClassLabel, sourceText, sourceTexts, dimensionsText, fileSizeText, typeIcon } from '../render/resource-thumbs.js';
import { downloadPng, downloadResource, saveBlob } from '../download.js';
import { encodeTiff } from '../../lib/export/tiff.js';
import { icon, iconButton } from '../icons.js';
import { pickFiles } from '../file-open.js';
import { loadPrefs, savePrefs } from '../prefs.js';

const ACTUAL = 96 / 1440; // CSS pixels per page unit at 100 %

export class ResourceFullscreen extends HTMLElement {
  /** Builds the dialog. */
  connectedCallback() {
    if (this.dialog) return;
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'resource-fullscreen';
    this.dialog.addEventListener('close', () => this.dispatchEvent(new CustomEvent('close')));
    this.dialog.addEventListener('keydown', (e) => {
      if (e.target.closest('input, select')) return;
      if (e.key === 'ArrowRight') this.#step(1);
      else if (e.key === 'ArrowLeft') this.#step(-1);
      else if (e.key === '+') this.#zoomBy(1.25);
      else if (e.key === '-') this.#zoomBy(0.8);
      else return;
      e.preventDefault();
    });
    const bar = document.createElement('div');
    bar.className = 'fullscreen-bar';
    // Navigation and zoom buttons show only their icon (the label is the tooltip).
    const button = (key, action, iconName) => {
      const b = iconButton(iconName, key, { iconOnly: true });
      b.addEventListener('click', action);
      return b;
    };
    const close = iconButton('close', 'fullscreen.close', { iconOnly: true, className: 'dialog-close' });
    close.addEventListener('click', () => this.dialog.close());
    // A click on the backdrop (outside the dialog box) closes the dialog too.
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
    this.heading = document.createElement('h2');
    this.heading.id = `fullscreen-title-${Math.random().toString(36).slice(2)}`;
    this.dialog.setAttribute('aria-labelledby', this.heading.id);
    this.position = document.createElement('span');
    this.position.className = 'meta-facts';
    this.zoomButtons = [
      button('fullscreen.zoomOut', () => this.#zoomBy(0.8), 'zoomOut'), button('fullscreen.zoomIn', () => this.#zoomBy(1.25), 'zoomIn'),
      button('fullscreen.fit', () => this.#chooseZoom('fit'), 'fit'), button('fullscreen.actual', () => this.#chooseZoom('actual'), 'actual'),
    ];
    [, , this.fitButton, this.actualButton] = this.zoomButtons;
    // Save buttons show icon and text.
    const saveButton = (iconName, key, action) => {
      const b = iconButton(iconName, key);
      b.addEventListener('click', action);
      return b;
    };
    this.pngButton = saveButton('fileImage', 'fullscreen.png', () => this.#downloadPng());
    this.tiffButton = saveButton('fileImage', 'fullscreen.tiff', () => this.#downloadTiff());
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    bar.append(
      button('fullscreen.previous', () => this.#step(-1), 'previous'), button('fullscreen.next', () => this.#step(1), 'next'),
      this.heading, this.position, spacer, ...this.zoomButtons, this.pngButton, this.tiffButton,
      saveButton('extract', 'fullscreen.extract', async () => downloadResource(await this.client.call('extractResource', this.resource.id))),
      close,
    );
    this.stage = document.createElement('div');
    this.stage.className = 'fullscreen-stage';
    this.meta = document.createElement('aside');
    this.meta.className = 'fullscreen-meta';
    const body = document.createElement('div');
    body.className = 'fullscreen-body';
    body.append(this.stage, this.meta);
    this.dialog.append(bar, body);
    this.append(this.dialog);
    applyTranslations(this.dialog);
    onLanguageChange(() => {
      if (!this.dialog.open || !this.resource) return;
      this.heading.textContent = `${this.resource.name} – ${typeLabel(this.resource.type)}`;
      this.position.textContent = t('fullscreen.position', { index: this.index + 1, count: this.resources.length });
      this.#renderMeta(this.resource);
    });
  }

  /**
   * Opens the view.
   * @param {object} options Options.
   * @param {import('../worker-client.js').WorkerClient} options.client Worker client.
   * @param {HTMLElement} [options.app] Application frame (opens added files).
   * @param {import('../render/canvas-renderer.js').CanvasRenderer} options.renderer Renderer.
   * @param {import('../render/resource-thumbs.js').ResourceThumbs} options.thumbs Model cache.
   * @param {object[]} options.resources Current results.
   * @param {number} options.index Resource to show.
   * @returns {Promise<void>} Resolves when shown.
   */
  async open({ client, app, renderer, thumbs, resources, index }) {
    Object.assign(this, { client, app, renderer, thumbs, resources });
    if (!this.dialog.open) {
      // Each opening starts with the last of "Fit to screen" and "Actual size" the user chose.
      this.zoom = loadPrefs().previewZoom === 'actual' ? 1 : 'fit';
      this.dialog.showModal();
    }
    await this.#show(index);
  }

  /**
   * Moves to the previous or next resource.
   * @param {number} delta −1 or 1.
   * @returns {Promise<void>} Resolves when shown.
   */
  async #step(delta) {
    const next = this.index + delta;
    if (next >= 0 && next < this.resources.length) await this.#show(next);
  }

  /**
   * Shows one resource.
   * @param {number} index Index in the results.
   * @returns {Promise<void>} Resolves when drawn.
   */
  async #show(index) {
    this.index = index;
    const r = this.resources[index];
    this.resource = r;
    this.heading.textContent = `${r.name} – ${typeLabel(r.type)}`;
    this.position.textContent = t('fullscreen.position', { index: index + 1, count: this.resources.length });
    this.#renderMeta(r);
    this.canvas = null;
    // Form definitions show every medium map in their own view instead of one picture.
    this.model = r.hasPreview && r.type !== 'formDefinition' ? await this.thumbs.model(r.id, 'high') : null;
    if (this.resource !== r) return;
    this.#renderMeta(r);
    const parts = [];
    if (this.model) {
      this.canvas = document.createElement('canvas');
      this.canvas.className = 'fullscreen-canvas';
      parts.push(this.canvas);
    }
    if (r.type === 'formDefinition') {
      const view = document.createElement('formdef-view');
      parts.push(view);
      view.show(this.client, this.renderer, r);
    } else if (r.type === 'fontCharacterSet' || r.type === 'truetypeFont' || r.type === 'codedFont') {
      const grid = document.createElement('font-grid');
      parts.push(grid);
      grid.show(this.client, r);
    } else if (r.type === 'codePage') {
      const table = document.createElement('codepage-table');
      parts.push(table);
      table.show(this.client, r);
    } else if (!this.model) {
      const none = document.createElement('div');
      none.className = 'empty-state';
      none.append(typeIcon(r.type), t('fullscreen.noPreview'));
      parts.push(none);
    }
    this.stage.replaceChildren(...parts);
    for (const b of [...this.zoomButtons, this.pngButton, this.tiffButton]) b.disabled = !this.model;
    if (this.model) await this.#setZoom(this.zoom ?? 'fit');
  }

  /**
   * Saves the preview as TIFF, drawn at the resource's own resolution (300 dpi when unknown).
   * @returns {Promise<void>} Resolves when offered for saving.
   */
  async #downloadTiff() {
    const canvas = await this.#exportCanvas();
    if (!canvas) return;
    const dpi = this.#exportDpi();
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const tiff = await encodeTiff({ width: canvas.width, height: canvas.height, rgba: data, dpi });
    saveBlob(new Blob([tiff], { type: 'image/tiff' }), `${this.resource.name}.tif`);
  }

  /** @returns {number} Export resolution: the resource's own, else 300 dpi. */
  #exportDpi() {
    return this.resource.resolution || 300;
  }

  /**
   * Draws the resource for export at its own resolution, independent of zoom and screen (the
   * on-screen canvas is scaled to the window; saving it lost detail and made bilevel images
   * jagged).
   * @returns {Promise<HTMLCanvasElement|null>} Canvas, or null without a preview.
   */
  async #exportCanvas() {
    if (!this.model) return null;
    const canvas = document.createElement('canvas');
    await this.renderer.draw(canvas, this.model, { scale: this.#exportDpi() / 1440, pixelRatio: 1 });
    return canvas;
  }

  /** Saves the resource as PNG at its own resolution, with that resolution in the file. */
  async #downloadPng() {
    const canvas = await this.#exportCanvas();
    if (canvas) await downloadPng(canvas, this.resource.name, this.#exportDpi());
  }

  /**
   * Sets the zoom.
   * @param {number|'fit'} zoom Factor (1 = actual size) or 'fit'.
   * @returns {Promise<void>} Resolves when drawn.
   */
  async #setZoom(zoom) {
    this.zoom = zoom;
    // The mode in use is highlighted; after zooming in or out neither is (unless back at 100 %).
    this.fitButton.setAttribute('aria-pressed', String(zoom === 'fit'));
    this.actualButton.setAttribute('aria-pressed', String(zoom === 1));
    if (!this.model || !this.canvas) return;
    const fit = Math.min((this.stage.clientWidth - 24) / this.model.widthUnits, (this.stage.clientHeight - 24) / this.model.heightUnits);
    this.scale = zoom === 'fit' ? Math.max(fit, 0.001) : ACTUAL * zoom;
    await this.renderer.draw(this.canvas, this.model, { scale: this.scale, pixelRatio: window.devicePixelRatio || 1 });
  }

  /**
   * Applies "Fit to screen" or "Actual size" and remembers it for the next preview.
   * @param {'fit'|'actual'} mode Mode.
   * @returns {Promise<void>} Resolves when drawn.
   */
  async #chooseZoom(mode) {
    savePrefs({ previewZoom: mode });
    await this.#setZoom(mode === 'fit' ? 'fit' : 1);
  }

  /**
   * Changes the zoom by a factor.
   * @param {number} factor Factor.
   * @returns {Promise<void>} Resolves when drawn.
   */
  async #zoomBy(factor) {
    if (!this.model) return;
    const current = (this.scale ?? ACTUAL) / ACTUAL;
    await this.#setZoom(Math.min(16, Math.max(0.05, current * factor)));
  }

  /**
   * Fills the metadata panel.
   * @param {object} r Resource.
   * @returns {void}
   */
  #renderMeta(r) {
    const rows = [
      ['resources.col.name', r.name], ['fullscreen.internalName', r.internalName ?? ''], ['resources.col.type', typeLabel(r.type)], ['resources.col.dimensions', dimensionsText(r)],
      ['resources.col.sizeClass', sizeClassLabel(r.sizeClass)], ['resources.col.fileSize', `${fileSizeText(r.fileSize)} (${r.fileSize})`],
      ['resources.col.resolution', r.resolution ? t('resource.dpi', { value: r.resolution }) : ''],
      ['resources.col.colorProfile', r.colorProfile ?? ''],
      ['resources.col.colorModel', (r.colorModels ?? []).map((m) => m.toUpperCase()).join(', ')], ['resources.col.encoding', r.encoding ?? ''],
      ['resources.filter.content', (r.contents ?? []).map((c) => t(`resources.content.${c}`)).join(', ')],
      ['resources.filter.font', (r.fonts ?? []).join(', ')],
      sourceTexts(r).length > 1 ? [t('fullscreen.sources', { count: sourceTexts(r).length }), this.#sourceList(r), true] : ['resources.col.source', sourceText(r)],
      ['fullscreen.duplicates', r.duplicates.join(', ') || t('fullscreen.noDuplicates')],
    ];
    const table = document.createElement('table');
    table.className = 'param-table';
    for (const [key, value, literal] of rows) {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.textContent = literal ? key : t(key);
      const td = document.createElement('td');
      if (value instanceof Node) {
        // A list (the sources of combined copies) gets the full width below its name.
        th.colSpan = 2;
        td.colSpan = 2;
        td.append(value);
        tr.append(th);
        table.append(tr);
        const below = document.createElement('tr');
        below.append(td);
        table.append(below);
        continue;
      }
      td.textContent = value || '–';
      tr.append(th, td);
      table.append(tr);
    }
    const missing = this.model?.missingResources ?? [];
    this.meta.replaceChildren(...(missing.length ? [this.#missingBox(missing)] : []), table);
  }

  /**
   * Lists all sources of a combined resource (identical copies), scrollable when long.
   * @param {object} r Resource.
   * @returns {HTMLElement} List.
   */
  #sourceList(r) {
    const ul = document.createElement('ul');
    ul.className = 'source-list';
    for (const text of sourceTexts(r)) {
      const li = document.createElement('li');
      li.textContent = text;
      ul.append(li);
    }
    return ul;
  }

  /**
   * Builds the warning box of missing resources.
   * @param {{type: string, name: string}[]} missing Missing resources.
   * @returns {HTMLElement} Box.
   */
  #missingBox(missing) {
    const box = document.createElement('section');
    box.className = 'fullscreen-missing';
    box.setAttribute('role', 'alert');
    const title = document.createElement('h3');
    title.append(icon('warning'), ` ${t('details.missing')} (${missing.length})`);
    const list = document.createElement('ul');
    for (const m of missing) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'mono';
      name.textContent = m.name;
      li.append(name, ` – ${typeLabel(m.type)}`);
      list.append(li);
    }
    const hint = document.createElement('p');
    hint.textContent = t('fullscreen.missingHint');
    const add = iconButton('open', 'missing.add');
    applyTranslations(add);
    add.addEventListener('click', async () => {
      const files = await pickFiles({ folder: false });
      if (files.length) {
        this.dialog.close();
        this.app?.openFiles(files, 'file');
      }
    });
    box.append(title, list, hint, add);
    return box;
  }
}

customElements.define('resource-fullscreen', ResourceFullscreen);
