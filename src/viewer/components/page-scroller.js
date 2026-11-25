/**
 * <page-scroller>: the continuous page view of a document (FR-017, FR-018). All rows of the
 * document are stacked in one scroll area: pages (Simplex view) or sheets with front and back
 * side by side (the back turned for tumble duplex). A back side that holds no page of the AFP
 * (simplex sheets, the back of an odd final page) is not shown; its place is kept empty, so the
 * fronts stay in one column. When no sheet of the document has a page on its back
 * (`source.frontOnly`), the sheets are shown in one centred column without back places.
 *
 * Only rows near the visible area exist as elements and are drawn, nearest to the middle of the
 * window first; rows further away are dropped with their canvases (a page canvas takes megabytes).
 * Until a row is loaded it is assumed to be as large as the first row (scroll-layout.js); when
 * its real size differs, the rows below move and the view keeps its place.
 *
 * Set `renderer`, then call `setSource()`. Events: `currentchange` (detail: { index }) when the
 * row in the middle of the window changes through scrolling, `zoomchange` (detail: { zoom, mode }).
 *
 * Inspect mode (`inspecting = true`, FR-034): the item under the pointer is outlined and
 * `inspecthover` reports it (detail: { item, x, y, area, clientX, clientY }; item null over empty
 * paper; x/y in page units of the side, area the page under the pointer); leaving the pages
 * fires `inspectleave`; a click on an item fires `inspectselect` (detail: { item, area }).
 */

import { ScrollLayout } from './scroll-layout.js';
import { hitTest, itemBox, pageAt } from '../../lib/render/hit-test.js';
import { t, onLanguageChange } from '../i18n/i18n.js';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
/** Highest scroll area in pixels; taller layouts are squeezed into it (see #viewTop). */
const MAX_SCROLL = 8_000_000;
/** CSS pixels per page unit at 100 % zoom (96 px per inch / 1440 units per inch). */
export const BASE_SCALE = 96 / 1440;
const PADDING = 16;
const GAP = 16;
const COLUMN_GAP = 24;
/** Height of a sheet caption with its margin (matches .scroll-row figcaption in base.css). */
const CAPTION = 24;
/** Screen pixels of slack around thin items when inspecting. */
const HIT_SLACK = 4;
/** Loaded rows kept for redrawing (zoom, scrolling back). */
const DATA_CACHE = 24;

/**
 * Returns the size of a loaded row.
 * @param {object} data Row data: `{model}` for a page, `{front, back}` for a sheet.
 * @returns {{width: number, height: number}} Size of one side in page units.
 */
function sizeOfData(data) {
  const models = data.model ? [data.model] : [data.front, data.back].filter(Boolean);
  return {
    width: Math.max(...models.map((m) => m.widthUnits)),
    height: Math.max(...models.map((m) => m.heightUnits)),
  };
}

/**
 * Frees the memory of a canvas that is no longer shown.
 * @param {HTMLCanvasElement|null|undefined} canvas Canvas.
 * @returns {void}
 */
function releaseCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

/**
 * Tells whether a sheet row has a page on its back side; a back side without a page is not in
 * the AFP (e.g. after an odd final page of a duplex document) and is not shown.
 * @param {{sheet: {back: {placements: object[]}|null}}} data Sheet row data.
 * @returns {boolean} True if a page is printed on the back.
 */
function hasBackPage(data) {
  return Boolean(data.sheet.back?.placements?.length);
}

export class PageScroller extends HTMLElement {
  /** Creates an empty view; rows appear once `setSource()` is called. */
  constructor() {
    super();
    this.zoomMode = 'fitWidth'; // 'fitPage' | 'fitWidth' | 'percent'
    this.zoom = 1;
    this.effectiveZoom = 1;
    this.layout = null;
    this.source = null;
    this.rows = new Map();
    this.data = new Map();
    this.generation = 0;
    this.sourceToken = 0;
    this.current = 0;
    this.expectedTop = NaN;
    this.pinned = false;
    this.highlight = null;
    this.inspecting = false;
  }

  /** Builds the scroll area when added to the page. */
  connectedCallback() {
    if (this.spacer) return;
    this.className = 'page-scroller';
    this.spacer = document.createElement('div');
    this.spacer.className = 'scroll-spacer';
    this.append(this.spacer);
    this.addEventListener('scroll', () => this.#onScroll(), { passive: true });
    this.addEventListener('wheel', (e) => this.#onWheel(e), { passive: false });
    this.addEventListener('keydown', (e) => this.#onKey(e));
    this.spacer.addEventListener('pointermove', (e) => this.#onInspectMove(e));
    this.spacer.addEventListener('pointerleave', () => this.#clearInspect());
    this.spacer.addEventListener('click', (e) => this.#onInspectClick(e));
    new ResizeObserver(() => this.#relayout()).observe(this);
    onLanguageChange(() => {
      for (const row of this.rows.values()) this.#labels(row);
    });
  }

  /**
   * Shows a new set of rows, replacing the old ones.
   * @param {{kind: 'page'|'sheet', count: number, pageCount: number,
   *   load: (index: number) => Promise<object>}} source Rows: pages (data `{model}`) or sheets
   *   (data `{sheet, front, back, single}`), the page count for labels, and the loader of a row;
   *   `frontOnly` for sheets when no back holds a page (one column).
   * @param {number} [index] Row to show at the top.
   * @returns {Promise<void>} Resolves when the layout is set up (rows draw afterwards).
   */
  async setSource(source, index = 0) {
    const token = ++this.sourceToken;
    for (const row of this.rows.values()) this.#release(row);
    this.rows.clear();
    this.data.clear();
    this.highlight = null;
    this.source = source;
    this.layout = null;
    if (!source.count) return;
    const first = await this.#load(0);
    if (token !== this.sourceToken) return;
    const sheet = source.kind === 'sheet';
    const twoSides = sheet && !source.frontOnly;
    this.layout = new ScrollLayout({
      count: source.count,
      estimate: sizeOfData(first),
      columns: twoSides ? 2 : 1,
      columnGap: twoSides ? COLUMN_GAP : 0,
      extraHeight: sheet ? CAPTION : 0,
      gap: GAP,
      padding: PADDING,
    });
    this.#applyZoom();
    this.scrollToIndex(index);
    this.#emitZoom();
  }

  /**
   * Scrolls a row to the top of the window and makes it the current row.
   * @param {number} index Row index.
   * @returns {void}
   */
  scrollToIndex(index) {
    if (!this.layout) return;
    this.current = Math.min(this.layout.count - 1, Math.max(0, index));
    // The row stays current until the user scrolls, even if it cannot reach the top (last rows).
    this.pinned = true;
    this.#setScrollTop(this.layout.top(this.current) - PADDING);
    this.#update();
  }

  /**
   * Sets the zoom: a factor (0.25–4) or 'fitPage' / 'fitWidth' (both measured on the first row).
   * @param {number|'fitPage'|'fitWidth'} value Zoom.
   * @returns {Promise<void>} Resolves when laid out (rows redraw afterwards).
   */
  async setZoom(value) {
    if (value === 'fitPage' || value === 'fitWidth') this.zoomMode = value;
    else {
      this.zoomMode = 'percent';
      this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    }
    if (this.layout) {
      const anchor = this.#anchor();
      this.#applyZoom();
      this.#restore(anchor);
      this.#update();
    }
    this.#emitZoom();
  }

  /**
   * Highlights items on one page (structure view links, search hits); replaces the previous
   * highlight. Works on page rows and on sheets: on a sheet side the page's item indexes are
   * moved by where the page's items start (`firstItem` of the sheet render model).
   * @param {number} page Page number.
   * @param {Set<number>|null} rows Source field rows to highlight.
   * @param {Map<number, [number, number]>|null} [runs] Item index in the page's render model →
   *   character range to highlight.
   * @param {string|null} [fileId] File the rows belong to (the document).
   * @returns {void}
   */
  setHighlight(page, rows, runs = null, fileId = null) {
    this.highlight = rows || runs ? { page, rows, runs, fileId } : null;
    this.redraw();
  }

  /**
   * Removes the search hit and keeps marked fields (structure view links).
   * @returns {void}
   */
  clearSearchHit() {
    if (!this.highlight?.runs) return;
    this.highlight = this.highlight.rows ? { ...this.highlight, runs: null } : null;
    this.redraw();
  }

  /**
   * Removes the marked fields (structure view links) and keeps search hits.
   * @returns {void}
   */
  clearMarkedFields() {
    if (!this.highlight?.rows) return;
    this.highlight = this.highlight.runs ? { ...this.highlight, rows: null } : null;
    this.redraw();
  }

  /**
   * Returns the highlight to draw on one side model, or null.
   * @param {object} model Render model of a page (with `pageNumber` known from the row) or of a
   *   sheet side (with `pages` and `firstItem`).
   * @param {number|null} pageNumber Page of a page row, null for sheet sides.
   * @returns {{rows: Set<number>|null, runs: Map<number, [number, number]>|null}|null} Highlight.
   */
  #highlightFor(model, pageNumber) {
    const h = this.highlight;
    if (!h) return null;
    if (pageNumber !== null) return pageNumber === h.page ? h : null;
    if (!model.pages?.includes(h.page)) return null;
    const shift = model.firstItem?.[h.page] ?? 0;
    const runs = h.runs ? new Map([...h.runs].map(([i, range]) => [i + shift, range])) : null;
    return { rows: h.rows, runs, fileId: h.fileId };
  }

  /**
   * Draws the shown rows again (test print switched, highlight changed); loaded data is kept.
   * @returns {void}
   */
  redraw() {
    this.generation++;
    this.#update();
  }

  /** Sends the effective zoom to the zoom controls. */
  #emitZoom() {
    this.dispatchEvent(new CustomEvent('zoomchange', { detail: { zoom: this.effectiveZoom, mode: this.zoomMode } }));
  }

  /** Computes the zoom for the current mode and sets the layout scale. */
  #applyZoom() {
    const fit = this.layout.fitZoom(this.zoomMode, Math.max(this.clientWidth - 2 * PADDING, 50),
      Math.max(this.clientHeight - 2 * PADDING, 50), BASE_SCALE);
    const zoom = this.zoomMode === 'percent' ? this.zoom : fit;
    this.effectiveZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    this.layout.setScale(BASE_SCALE * this.effectiveZoom);
  }

  /**
   * Describes the spot at the top of the window.
   * @returns {{index: number, fraction: number}} Anchor.
   */
  #anchor() {
    return this.layout.anchor(this.#viewTop() + PADDING);
  }

  /**
   * The position of the window in the layout (pixels from its top). Equal to scrollTop, unless
   * the layout is taller than MAX_SCROLL (mass output, T230): browsers cap the height of an
   * element at about 33 million pixels, so the scroll area is then MAX_SCROLL high and stands for
   * the whole layout; scrollTop is the layout position divided by `squeeze`, and the exact
   * position is kept in `virtualTop`.
   * @returns {number} Pixels.
   */
  #viewTop() {
    return this.squeeze > 1 ? this.virtualTop : this.scrollTop;
  }

  /**
   * Scrolls the squeezed scroll area by pixels of the layout (mouse wheel, keys), as if it were
   * not squeezed; the user's own scrolling (unpins the current row).
   * @param {number} delta Pixels.
   * @returns {void}
   */
  #scrollBy(delta) {
    this.pinned = false;
    this.#setScrollTop(this.virtualTop + delta);
    this.#updateCurrent();
    this.#update();
  }

  /**
   * Mouse wheel in a squeezed scroll area: native scrolling would move `squeeze` times too far.
   * @param {WheelEvent} e Event.
   * @returns {void}
   */
  #onWheel(e) {
    if (!(this.squeeze > 1) || e.ctrlKey || !e.deltaY) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? this.clientHeight : 1;
    this.#scrollBy(e.deltaY * unit);
  }

  /**
   * Scrolling keys in a squeezed scroll area (see #onWheel).
   * @param {KeyboardEvent} e Event.
   * @returns {void}
   */
  #onKey(e) {
    if (!(this.squeeze > 1) || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    // Page Up/Down go to the previous/next page (document-view.js); Home/End are left native.
    const page = this.clientHeight * 0.9;
    const delta = { ArrowDown: 40, ArrowUp: -40, ' ': e.shiftKey ? -page : page }[e.key];
    if (delta === undefined) return;
    e.preventDefault();
    this.#scrollBy(delta);
  }

  /**
   * Scrolls back to an anchored spot after the layout changed.
   * @param {{index: number, fraction: number}} anchor Anchor from `#anchor()`.
   * @returns {void}
   */
  #restore(anchor) {
    this.#setScrollTop(this.layout.positionOf(anchor) - PADDING);
  }

  /**
   * Scrolls without treating it as the user's scrolling (a pinned row stays current).
   * @param {number} top Scroll position in pixels.
   * @returns {void}
   */
  #setScrollTop(top) {
    this.#sizeSpacer();
    if (this.squeeze > 1) {
      this.virtualTop = Math.max(0, Math.min(top, this.layout.extent().height - this.clientHeight));
      this.scrollTop = this.virtualTop / this.squeeze;
    } else {
      this.scrollTop = Math.max(0, top);
    }
    this.expectedTop = this.scrollTop;
  }

  /** Sizes the scroll area to all rows (at most MAX_SCROLL high, see #viewTop). */
  #sizeSpacer() {
    const { width, height } = this.layout.extent();
    const view = this.clientHeight || 600;
    const squeezed = height > MAX_SCROLL;
    const before = this.#viewTop();
    this.squeeze = squeezed ? Math.max(1, (height - view) / (MAX_SCROLL - view)) : 1;
    if (squeezed && this.virtualTop === undefined) this.virtualTop = before;
    if (!squeezed) this.virtualTop = undefined;
    this.spacer.style.height = `${squeezed ? MAX_SCROLL : height}px`;
    this.spacer.style.width = `${Math.max(width, this.clientWidth)}px`;
  }

  /** Lays out again after the window size changed (fit modes follow the size). */
  #relayout() {
    if (!this.layout) return;
    const anchor = this.#anchor();
    if (this.zoomMode !== 'percent') this.#applyZoom();
    this.#restore(anchor);
    this.#update();
    if (this.zoomMode !== 'percent') this.#emitZoom();
  }

  /** Follows the user's scrolling: current row and the rows to show. */
  #onScroll() {
    if (!this.layout) return;
    if (Math.abs(this.scrollTop - this.expectedTop) > 0.5) {
      this.expectedTop = NaN;
      this.pinned = false;
      // Scroll bar or touch in a squeezed area: the bar's position stands for the layout position.
      if (this.squeeze > 1) this.virtualTop = this.scrollTop * this.squeeze;
    }
    if (!this.pinned) this.#updateCurrent();
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.#update();
      });
    }
  }

  /**
   * Makes the row in the middle of the window current (the first row at the top of the scroll
   * area, the last row at its bottom).
   * @returns {void}
   */
  #updateCurrent() {
    const { layout } = this;
    const max = layout.extent().height - this.clientHeight;
    const top = this.#viewTop();
    let index;
    if (top <= 0) index = 0;
    else if (max > 0 && top >= max - 1) index = layout.count - 1;
    else index = layout.indexAt(top + this.clientHeight / 2);
    if (index === this.current) return;
    this.current = index;
    this.dispatchEvent(new CustomEvent('currentchange', { detail: { index } }));
  }

  /** Creates and places the rows near the window, drops the others, and starts drawing. */
  #update() {
    if (!this.layout) return;
    this.#sizeSpacer();
    const top = this.#viewTop();
    const height = this.clientHeight || 600;
    const keep = this.layout.range(top - height, top + 2 * height);
    for (const [index, row] of this.rows) {
      if (index < keep.first || index > keep.last) {
        this.#release(row);
        this.rows.delete(index);
      }
    }
    for (let index = keep.first; index <= keep.last; index++) {
      let row = this.rows.get(index);
      if (!row) {
        row = this.#createRow(index);
        this.rows.set(index, row);
      }
      this.#place(row);
    }
    this.#pump();
  }

  /**
   * Turns inspect mode on or off (the outline and hover are cleared when off).
   * @param {boolean} on True to inspect.
   * @returns {void}
   */
  setInspecting(on) {
    this.inspecting = on;
    this.classList.toggle('inspecting', on);
    if (!on) this.#clearInspect();
  }

  /**
   * Finds what lies under the pointer: the side's model, the point in its page units, the item
   * and the page there.
   * @param {PointerEvent|MouseEvent} e Pointer event.
   * @returns {{frame: HTMLElement, model: object, x: number, y: number, scale: number, tumble: boolean,
   *   index: number, item: object|null, area: object|null}|null} Hit, or null outside the pages
   *   (scale: screen pixels per page unit).
   */
  #inspectAt(e) {
    const frame = e.target.closest?.('.page-frame');
    const rowEl = frame?.closest('.scroll-row');
    if (!frame || !rowEl || !this.layout) return null;
    const row = this.rows.get(Number(rowEl.dataset.row));
    if (!row?.data) return null;
    const side = this.#sideModels(row.data)[Number(frame.dataset.side)];
    if (!side || side.absent) return null;
    const { model } = side;
    const box = frame.getBoundingClientRect();
    const scale = box.width / model.widthUnits;
    let x = (e.clientX - box.left) / scale;
    let y = (e.clientY - box.top) / scale;
    // A tumbled back side is drawn turned by 180°.
    if (side.tumble) {
      x = model.widthUnits - x;
      y = model.heightUnits - y;
    }
    const index = hitTest(model, x, y, { tolerance: HIT_SLACK / scale, hideTestPrint: this.renderer?.hideTestPrint });
    return { frame, model, x, y, scale, tumble: Boolean(side.tumble), index, item: index >= 0 ? model.items[index] : null, area: pageAt(model, x, y) };
  }

  /**
   * Outlines the item under the pointer and reports it.
   * @param {PointerEvent} e Pointer event.
   * @returns {void}
   */
  #onInspectMove(e) {
    if (!this.inspecting) return;
    const hit = this.#inspectAt(e);
    if (!hit) {
      this.#clearInspect();
      return;
    }
    this.#outline(hit);
    this.dispatchEvent(new CustomEvent('inspecthover', {
      detail: { item: hit.item, x: hit.x, y: hit.y, area: hit.area, clientX: e.clientX, clientY: e.clientY },
    }));
  }

  /**
   * Reports a click on an item while inspecting, or on empty paper (`blankclick`).
   * @param {MouseEvent} e Click event.
   * @returns {void}
   */
  #onInspectClick(e) {
    const hit = this.#inspectAt(e);
    if (!hit?.item) {
      // A click on empty paper (or beside the pages) ends a field marking and Inspect.
      if (this.inspecting || this.highlight?.rows) this.dispatchEvent(new CustomEvent('blankclick'));
      return;
    }
    if (!this.inspecting) return;
    e.preventDefault();
    this.dispatchEvent(new CustomEvent('inspectselect', { detail: { item: hit.item, area: hit.area } }));
  }

  /**
   * Draws the outline of the hit item over its page (or removes it over empty paper).
   * @param {{frame: HTMLElement, model: object, scale: number, tumble: boolean, item: object|null}} hit Hit.
   * @returns {void}
   */
  #outline(hit) {
    const box = hit.item ? itemBox(hit.item) : null;
    if (!box) {
      this.outlineEl?.remove();
      return;
    }
    if (!this.outlineEl) {
      this.outlineEl = document.createElement('div');
      this.outlineEl.className = 'inspect-outline';
      this.outlineEl.setAttribute('aria-hidden', 'true');
    }
    if (this.outlineEl.parentElement !== hit.frame) hit.frame.append(this.outlineEl);
    const { scale, model } = hit;
    const x = hit.tumble ? model.widthUnits - box.x - box.width : box.x;
    const y = hit.tumble ? model.heightUnits - box.y - box.height : box.y;
    Object.assign(this.outlineEl.style, {
      left: `${x * scale}px`, top: `${y * scale}px`, width: `${Math.max(box.width * scale, 2)}px`, height: `${Math.max(box.height * scale, 2)}px`,
    });
  }

  /** Removes the outline and reports that the pointer left the pages. */
  #clearInspect() {
    this.outlineEl?.remove();
    this.dispatchEvent(new CustomEvent('inspectleave'));
  }

  /**
   * Creates the element of a row: one page, or the two sides of a sheet with captions.
   * @param {number} index Row index.
   * @returns {object} Row.
   */
  #createRow(index) {
    const el = document.createElement('div');
    el.className = 'scroll-row';
    const sheet = this.source.kind === 'sheet';
    const names = this.source.frontOnly ? ['front'] : ['front', 'back'];
    const sides = (sheet ? names : ['page']).map((side) => {
      const figure = document.createElement(sheet ? 'figure' : 'div');
      figure.className = sheet ? `sheet-side sheet-${side}` : 'page-side';
      const frame = document.createElement('div');
      frame.className = 'page-frame';
      frame.setAttribute('role', 'img');
      frame.dataset.side = String(sheet ? names.indexOf(side) : 0);
      figure.append(frame);
      let caption = null;
      if (sheet) {
        caption = document.createElement('figcaption');
        figure.append(caption);
      }
      el.append(figure);
      return { side, figure, frame, caption, canvas: null };
    });
    this.spacer.append(el);
    const row = { index, el, sides, drawn: null, data: null }; // data is set once loaded (#drawRow)
    el.dataset.row = String(index);
    this.#labels(row);
    return row;
  }

  /**
   * Positions a row and sizes its page frames at the current scale.
   * @param {object} row Row.
   * @returns {void}
   */
  #place(row) {
    const { layout } = this;
    // In a squeezed area rows sit relative to the window (see #viewTop).
    row.el.style.top = `${layout.top(row.index) - this.#viewTop() + this.scrollTop}px`;
    row.el.style.height = `${layout.rowHeight(row.index)}px`;
    const size = layout.sizeOf(row.index);
    const models = row.data ? this.#sideModels(row.data) : null;
    for (const [i, s] of row.sides.entries()) {
      const model = models?.[i].model;
      s.frame.style.width = `${(model?.widthUnits ?? size.width) * layout.scale}px`;
      s.frame.style.height = `${(model?.heightUnits ?? size.height) * layout.scale}px`;
    }
  }

  /**
   * Removes a row and frees its canvases.
   * @param {object} row Row.
   * @returns {void}
   */
  #release(row) {
    for (const s of row.sides) releaseCanvas(s.canvas);
    row.el.remove();
  }

  /**
   * Writes the accessible labels and captions of a row (also after a language change).
   * @param {object} row Row.
   * @returns {void}
   */
  #labels(row) {
    const { data } = row;
    const count = this.source.pageCount;
    if (this.source.kind === 'page') {
      row.sides[0].frame.setAttribute('aria-label', t('nav.pageLabel', { page: row.index + 1, count }));
      return;
    }
    if (!data) return;
    const { sheet, front, back, single } = data;
    for (const s of row.sides) {
      const model = s.side === 'front' ? front : back;
      const pages = (model?.pages ?? []).join(', ') || '–';
      const text = s.side === 'front'
        ? t(single ? 'sheet.simplex' : 'sheet.front', { pages })
        : (sheet.back ? t('sheet.back', { pages }) : t('sheet.noBack'));
      s.caption.textContent = text;
      s.frame.setAttribute('aria-label', text);
    }
  }

  /**
   * Returns what each side of a row shows.
   * @param {object} data Row data.
   * @returns {{model: object, blank?: boolean, absent?: boolean, tumble?: boolean}[]} Sides.
   */
  #sideModels(data) {
    if (data.model) return [{ model: data.model }];
    const { sheet, front, back, single } = data;
    const ref = front ?? back;
    const empty = { widthUnits: ref.widthUnits, heightUnits: ref.heightUnits, items: [] };
    if (this.source.frontOnly) return [{ model: front ?? empty }];
    return [
      { model: front ?? empty },
      { model: back ?? empty, blank: !back || back.items.length === 0, absent: single || !hasBackPage(data), tumble: sheet.back?.orientation === 180 },
    ];
  }

  /**
   * Loads a row (shared while loading; the most recent rows are kept).
   * @param {number} index Row index.
   * @returns {Promise<object>} Row data.
   */
  #load(index) {
    let entry = this.data.get(index);
    if (entry) {
      this.data.delete(index);
    } else {
      const { source } = this;
      entry = source.load(index);
      entry.catch(() => {
        if (this.source === source && this.data.get(index) === entry) this.data.delete(index);
      });
    }
    this.data.set(index, entry);
    while (this.data.size > DATA_CACHE) this.data.delete(this.data.keys().next().value);
    return entry;
  }

  /**
   * Returns the drawing state the rows must match (scale and redraw generation).
   * @returns {string} Key.
   */
  #key() {
    return `${this.layout.scale}|${this.generation}`;
  }

  /**
   * Picks the next row to draw: rows in the window before the others, nearest to its middle first.
   * @returns {object|null} Row, or null when all are drawn.
   */
  #nextRow() {
    const key = this.#key();
    const top = this.#viewTop();
    const visible = this.layout.range(top, top + this.clientHeight);
    const middle = this.layout.indexAt(top + this.clientHeight / 2);
    let best = null;
    let bestRank = Infinity;
    for (const row of this.rows.values()) {
      if (row.drawn === key) continue;
      const inside = row.index >= visible.first && row.index <= visible.last;
      const rank = (inside ? 0 : 1e9) + Math.abs(row.index - middle);
      if (rank < bestRank) {
        best = row;
        bestRank = rank;
      }
    }
    return best;
  }

  /** Draws rows one after the other until all rows near the window are up to date. */
  async #pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      for (let row = this.#nextRow(); row; row = this.layout ? this.#nextRow() : null) await this.#drawRow(row);
    } finally {
      this.pumping = false;
    }
  }

  /**
   * Loads and draws one row; the old canvases stay (stretched) until the new ones are ready.
   * @param {object} row Row.
   * @returns {Promise<void>} Resolves when drawn.
   */
  async #drawRow(row) {
    const key = this.#key();
    const token = this.sourceToken;
    let data;
    try {
      data = await this.#load(row.index);
    } catch {
      row.drawn = key; // a failing row stays empty; the diagnostics report the problem
      return;
    }
    if (token !== this.sourceToken) return;
    const anchor = this.#anchor();
    if (this.layout.setSize(row.index, sizeOfData(data))) {
      this.#restore(anchor);
      this.#update();
    }
    row.data = data;
    this.#labels(row);
    this.#place(row);
    const { scale } = this.layout;
    const pageNumber = this.source.kind === 'page' ? row.index + 1 : null;
    const canvases = [];
    for (const s of this.#sideModels(data)) {
      const highlight = this.#highlightFor(s.model, pageNumber);
      const canvas = document.createElement('canvas');
      canvas.className = 'page-canvas';
      canvases.push(canvas);
      try {
        await this.renderer.draw(canvas, s.model, {
          scale, pixelRatio: window.devicePixelRatio || 1, highlight: highlight?.rows, highlightFile: highlight?.fileId ?? null, highlightRuns: highlight?.runs,
        });
      } catch {
        // An item that cannot be drawn leaves the rest of the page; a failing page stays white.
      }
    }
    if (token !== this.sourceToken || this.rows.get(row.index) !== row) {
      canvases.forEach(releaseCanvas);
      return;
    }
    for (const [i, s] of this.#sideModels(data).entries()) {
      const side = row.sides[i];
      const canvas = canvases[i];
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.classList.toggle('tumble', Boolean(s.tumble));
      releaseCanvas(side.canvas);
      side.frame.replaceChildren(canvas);
      side.canvas = canvas;
      side.figure.classList.toggle('blank', Boolean(s.blank));
      side.figure.classList.toggle('absent', Boolean(s.absent));
    }
    row.drawn = key;
  }
}

customElements.define('page-scroller', PageScroller);
