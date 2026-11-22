/**
 * <resource-grid>: resources as tiles with a preview (or a type symbol when there is none), name
 * and type (FR-051), virtualized by rows; the tile size follows the zoom slider (FR-052).
 * Event: `open` (detail: { index }) when a tile is clicked or Enter is pressed.
 *
 * The rows are virtual-list rows, but a row is never shown as selected: the grid marks one tile
 * instead (`current`, an accent outline) — the tile last opened, or the one reached with the
 * keys: arrows move by tile and by row, Page Up/Down by a window of rows, Home/End to the first
 * and last tile, Enter opens it. (Inheriting the list's row selection painted a whole row of
 * tiles blue after a click, which meant nothing to the user.)
 */

import './virtual-list.js';
import { t, onLanguageChange } from '../i18n/i18n.js';
import { typeLabel, typeIcon } from '../render/resource-thumbs.js';

const BASE_TILE = 140;
const LABEL_HEIGHT = 44;
const GAP = 12;
/** Space around a preview inside its tile, as a share of the tile size (at least 8 px). */
const INSET = 0.07;

export class ResourceGrid extends HTMLElement {
  /** Builds the list. */
  connectedCallback() {
    if (this.list) return;
    this.className = 'resource-grid';
    this.zoom = 1;
    this.resources = [];
    this.list = document.createElement('virtual-list');
    this.list.setAttribute('data-i18n-attr', 'aria-label:resources.grid');
    this.list.setAttribute('aria-label', t('resources.grid'));
    // Rows hold tile buttons, so they are list items rather than selectable options.
    this.list.setAttribute('role', 'list');
    this.list.dataset.rowRole = 'listitem';
    this.list.renderRow = (row, el) => this.#renderRow(row, el);
    this.current = -1;
    // The grid's own keys, before the list's row navigation (capture phase).
    this.list.addEventListener('keydown', (e) => this.#onKey(e), { capture: true });
    this.list.addEventListener('dblclick', (e) => e.stopPropagation(), { capture: true });
    this.append(this.list);
    new ResizeObserver(() => this.#layout()).observe(this);
    onLanguageChange(() => this.list.refresh());
  }

  /**
   * Shows resources.
   * @param {object[]} resources Resources in display order.
   * @param {import('../render/resource-thumbs.js').ResourceThumbs} thumbs Preview cache.
   * @returns {void}
   */
  show(resources, thumbs) {
    if (resources !== this.resources) this.current = -1;
    this.resources = resources;
    this.thumbs = thumbs;
    this.#layout();
  }

  /**
   * Sets the tile size.
   * @param {number} zoom Factor (0.5–3).
   * @returns {void}
   */
  setZoom(zoom) {
    this.zoom = zoom;
    this.#layout();
  }

  /** Splits the resources into rows that fit the width. */
  #layout() {
    if (!this.list) return;
    const tile = Math.round(BASE_TILE * this.zoom);
    this.tile = tile;
    const width = this.clientWidth || 800;
    const perRow = Math.max(1, Math.floor((width - GAP) / (tile + GAP)));
    this.perRow = perRow;
    const rows = [];
    for (let i = 0; i < this.resources.length; i += perRow) rows.push(this.resources.slice(i, i + perRow).map((_, k) => i + k));
    this.list.rowHeight = tile + LABEL_HEIGHT + GAP;
    this.list.style.setProperty('--row-height', `${this.list.rowHeight}px`);
    this.list.style.setProperty('--tile', `${tile}px`);
    this.list.items = rows;
  }

  /**
   * Fills one row of tiles.
   * @param {number[]} row Resource indexes.
   * @param {HTMLElement} el Row element.
   * @returns {void}
   */
  #renderRow(row, el) {
    el.classList.add('resource-row');
    el.replaceChildren(...row.map((index) => {
      const r = this.resources[index];
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'resource-tile';
      tile.title = `${r.name} – ${typeLabel(r.type)}`;
      const preview = document.createElement('div');
      preview.className = 'resource-preview';
      preview.append(typeIcon(r.type));
      if (r.hasPreview) {
        // Drawn smaller than the tile, so the page keeps a margin on every side.
        this.thumbs.get(r, this.tile - 2 * Math.max(8, Math.round(this.tile * INSET))).then((canvas) => {
          if (canvas && preview.isConnected && tile.dataset.id === r.id) preview.replaceChildren(cloneCanvas(canvas));
        });
      }
      const name = document.createElement('span');
      name.className = 'resource-name';
      name.textContent = r.name;
      const type = document.createElement('span');
      type.className = 'resource-type';
      type.textContent = typeLabel(r.type);
      tile.dataset.id = r.id;
      tile.classList.toggle('current', index === this.current);
      tile.append(preview, name, type);
      // Identical copies (e.g. a form definition inline in many documents) are one tile.
      const count = r.sources?.length ?? 1;
      if (count > 1) {
        const badge = document.createElement('span');
        badge.className = 'resource-sources';
        badge.textContent = `×${count}`;
        badge.title = t('resource.sourceCount', { count });
        tile.append(badge);
        tile.title += ` – ${badge.title}`;
      }
      tile.addEventListener('click', () => this.#open(index));
      return tile;
    }));
  }

  /**
   * Opens a resource.
   * @param {number} index Resource index.
   * @returns {void}
   */
  #open(index) {
    this.setCurrent(index);
    this.dispatchEvent(new CustomEvent('open', { detail: { index } }));
  }

  /**
   * Marks a tile as the current one and scrolls its row into view.
   * @param {number} index Resource index (−1 for none).
   * @returns {void}
   */
  setCurrent(index) {
    this.current = Math.min(this.resources.length - 1, Math.max(-1, index));
    if (this.current >= 0) this.list.showIndex(Math.floor(this.current / this.perRow));
    this.list.refresh();
  }

  /**
   * Keyboard navigation over tiles (see above).
   * @param {KeyboardEvent} e Key event.
   * @returns {void}
   */
  #onKey(e) {
    if (!this.resources.length || e.altKey || e.ctrlKey || e.metaKey) return;
    // A tile focused with Tab opens itself (button click).
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('.resource-tile')) return;
    const per = this.perRow || 1;
    const page = per * Math.max(1, Math.floor(this.list.clientHeight / this.list.rowHeight) - 1);
    const from = Math.max(0, this.current);
    const target = {
      ArrowRight: from + 1, ArrowLeft: from - 1, ArrowDown: from + per, ArrowUp: from - per,
      PageDown: from + page, PageUp: from - page, Home: 0, End: this.resources.length - 1,
    }[e.key];
    if (e.key === 'Enter' && this.current >= 0) this.#open(this.current);
    else if (target !== undefined) this.setCurrent(this.current < 0 ? 0 : Math.min(this.resources.length - 1, Math.max(0, target)));
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  /** @returns {number} Scroll position (to restore after the fullscreen view). */
  get scrollPosition() {
    return this.list.scrollTop;
  }

  /** @param {number} value Scroll position. */
  set scrollPosition(value) {
    this.list.scrollTop = value;
  }
}

/**
 * Copies a drawn canvas (one cached preview can appear in several rows over time).
 * @param {HTMLCanvasElement} source Canvas.
 * @returns {HTMLCanvasElement} Copy.
 */
function cloneCanvas(source) {
  const copy = document.createElement('canvas');
  copy.width = source.width;
  copy.height = source.height;
  copy.style.width = source.style.width;
  copy.style.height = source.style.height;
  copy.className = source.className;
  copy.getContext('2d').drawImage(source, 0, 0);
  return copy;
}

customElements.define('resource-grid', ResourceGrid);
