/**
 * <thumbnail-strip>: small previews of all pages (FR-016). Only visible thumbnails are drawn,
 * at low priority, so the current page always comes first; the current page is highlighted and
 * clicking a thumbnail navigates to it. Before a file is open it shows four sample pages — a
 * letter, an invoice, a report with a chart and a form with a bar code — drawn in the theme's
 * colors and fading in one after the other, as a hint of what will appear here.
 *
 * Its toolbar (as tall as the view toolbar beside it, --view-header-height set by afp-viewer.js,
 * so the columns line up) zooms the thumbnails out and in (− and +, in steps of ZOOM_STEPS, 120 px
 * wide by default) and chooses whether a row
 * shows a page or a sheet — the sheets as printed (formdef/sheets.js, the real duplex and N-up of
 * the form definition), front and back side by side, a back only where it carries a page.
 * Clicking a sheet goes to its first page; the sheet holding the current page is marked. Both
 * choices are kept as preferences (thumbWidth, thumbMode).
 * Emits `navigate` (detail: { page }).
 */

import './virtual-list.js';
import { t, onLanguageChange } from '../i18n/i18n.js';
import { icon } from '../icons.js';
import { loadPrefs, savePrefs } from '../prefs.js';

/** Thumbnail width per size (CSS pixels); pages are drawn at this width. */
const ZOOM_STEPS = [64, 80, 100, 120, 145, 170, 200];
/** Share of the width each side gets in a sheet row (two sides side by side). */
const SIDE_SHARE = 0.62;

/**
 * Draws text lines of a sample page (120 × 160 units).
 * @param {number} x Left edge.
 * @param {number} y Top of the first line.
 * @param {number[]} widths Width of each line.
 * @param {number} [step] Distance between lines.
 * @returns {string} SVG markup.
 */
const lines = (x, y, widths, step = 6) => widths.map((w, i) => `<rect class="sk-ink" x="${x}" y="${y + i * step}" width="${w}" height="2.4" rx="1.2"/>`).join('');

/** Sample pages shown before a file is open (inner SVG, viewBox 0 0 120 160). */
const SAMPLE_PAGES = [
  // Letter: logo, sender line, address, date, body text, signature.
  `<circle class="sk-accent" cx="18" cy="18" r="6"/><rect class="sk-accent" x="27" y="15" width="26" height="3.4" rx="1.7"/>
   <rect class="sk-ink" x="27" y="20.5" width="18" height="2" rx="1"/>
   ${lines(12, 38, [40, 34, 30])}<rect class="sk-ink" x="84" y="38" width="24" height="2.4" rx="1.2"/>
   <rect class="sk-dark" x="12" y="62" width="48" height="3.2" rx="1.6"/>
   ${lines(12, 72, [96, 92, 96, 70])}${lines(12, 100, [96, 88, 60])}
   <path class="sk-stroke" d="M14 134c4-6 7-6 9 0s5 6 8-1 6-5 9 1"/><rect class="sk-ink" x="12" y="140" width="34" height="2" rx="1"/>`,
  // Invoice: header band, address, table with rows, total.
  `<rect class="sk-accent" x="0" y="0" width="120" height="22"/><rect class="sk-paper" x="12" y="8" width="30" height="4" rx="2"/>
   <rect class="sk-paper" x="84" y="9" width="24" height="3" rx="1.5" opacity=".7"/>
   ${lines(12, 32, [36, 30, 26])}
   <rect class="sk-soft" x="12" y="56" width="96" height="8" rx="1.5"/>
   ${[0, 1, 2, 3, 4].map((i) => `<rect class="sk-ink" x="15" y="${70 + i * 9}" width="${[46, 38, 50, 32, 42][i]}" height="2.4" rx="1.2"/><rect class="sk-ink" x="90" y="${70 + i * 9}" width="15" height="2.4" rx="1.2"/>`).join('')}
   <rect class="sk-rule" x="12" y="116" width="96" height="0.8"/>
   <rect class="sk-dark" x="66" y="122" width="16" height="3.2" rx="1.6"/><rect class="sk-accent" x="86" y="121" width="22" height="5" rx="2.5"/>
   ${lines(12, 142, [70, 54], 5)}`,
  // Report: title, text, bar chart, more text.
  `<rect class="sk-dark" x="12" y="14" width="58" height="4.4" rx="2.2"/><rect class="sk-ink" x="12" y="22" width="40" height="2.4" rx="1.2"/>
   ${lines(12, 34, [96, 90, 94])}
   <rect class="sk-soft" x="12" y="54" width="96" height="52" rx="3"/>
   ${[[20, 30], [34, 20], [48, 38], [62, 26], [76, 44], [90, 34]].map(([x, h], i) => `<rect class="${i % 2 ? 'sk-accent2' : 'sk-accent'}" x="${x}" y="${100 - h}" width="9" height="${h}" rx="1.5"/>`).join('')}
   <rect class="sk-rule" x="16" y="100" width="88" height="0.8"/>
   ${lines(12, 116, [96, 92, 96, 66])}`,
  // Form: title, labelled fields, check boxes, bar code.
  `<rect class="sk-dark" x="12" y="14" width="50" height="4.4" rx="2.2"/>
   ${[30, 48, 66].map((y) => `<rect class="sk-ink" x="12" y="${y}" width="22" height="2" rx="1"/><rect class="sk-field" x="12" y="${y + 4}" width="96" height="8" rx="1.5"/>`).join('')}
   ${[0, 1, 2].map((i) => `<rect class="sk-field" x="${12 + i * 34}" y="90" width="6" height="6" rx="1"/><rect class="sk-ink" x="${21 + i * 34}" y="92" width="18" height="2" rx="1"/>`).join('')}
   <path class="sk-check" d="M13.5 93l1.6 1.6 3-3.4"/>
   <g class="sk-bars">${[0, 3, 5, 9, 11, 12, 16, 18, 21, 24, 25, 29, 31, 34, 36, 37, 41, 44].map((x, i) => `<rect x="${12 + x * 1.3}" y="118" width="${i % 3 ? 0.9 : 1.8}" height="22"/>`).join('')}</g>
   ${lines(76, 120, [32, 24, 28], 6)}`,
];

export class ThumbnailStrip extends HTMLElement {
  /** Creates an empty strip; call `setDocument()`. */
  constructor() {
    super();
    this.page = 1;
    /** @type {Map<number, HTMLCanvasElement>} page → drawn thumbnail */
    this.cache = new Map();
    this.pending = new Set();
  }

  /** Builds the list. */
  connectedCallback() {
    if (this.list) return;
    this.className = 'thumbnail-strip';
    const prefs = loadPrefs();
    this.width = prefs.thumbWidth;
    this.mode = prefs.thumbMode;
    this.header = document.createElement('div');
    this.header.className = 'thumb-header';
    this.zoomOut = this.#zoomButton('zoomOut', 'thumbs.zoomOut', -1);
    this.zoomIn = this.#zoomButton('zoomIn', 'thumbs.zoomIn', 1);
    const zoom = document.createElement('div');
    zoom.className = 'thumb-tools thumb-zoom';
    zoom.append(this.zoomOut, this.zoomIn);
    this.modeButtons = this.#group([['pages', 'page'], ['sheets', 'sheetSides']], 'thumbs.mode', (v) => this.#setMode(v));
    this.header.append(zoom, this.modeButtons.box);
    onLanguageChange(() => this.#labelButtons());
    this.list = document.createElement('virtual-list');
    this.list.setAttribute('data-i18n-attr', 'aria-label:thumbs.label');
    this.list.setAttribute('aria-label', t('thumbs.label'));
    this.list.renderRow = (page, el) => this.#renderRow(page, el);
    this.list.addEventListener('select', (e) => {
      // A sheet row goes to the sheet's first page.
      const page = this.mode === 'sheets' && this.layout ? this.layout.firstPage[e.detail.item - 1] : e.detail.item;
      this.dispatchEvent(new CustomEvent('navigate', { detail: { page } }));
    });
    // Before a file is open: sample pages that hint at what will appear here.
    this.hint = document.createElement('div');
    this.hint.className = 'thumb-skeleton';
    this.hint.setAttribute('aria-hidden', 'true');
    SAMPLE_PAGES.forEach((svg, i) => {
      const page = document.createElement('div');
      page.className = 'thumb-placeholder thumb-sample';
      page.style.setProperty('--i', String(i));
      page.innerHTML = `<svg viewBox="0 0 120 160">${svg}</svg>`;
      this.hint.append(page);
    });
    this.append(this.header, this.list, this.hint);
    this.#applySize();
    this.#labelButtons();
  }

  /**
   * Builds a group of icon buttons of which one is pressed.
   * @param {[string, string][]} options Value and icon of each button.
   * @param {string} keyPrefix Locale key prefix of the labels ("<prefix>.<value>").
   * @param {(value: string) => void} choose Called with the chosen value.
   * @returns {{box: HTMLElement, buttons: Map<string, HTMLButtonElement>, keyPrefix: string}} Group.
   */
  #group(options, keyPrefix, choose) {
    const box = document.createElement('div');
    box.className = 'segmented thumb-tools';
    box.setAttribute('role', 'group');
    const buttons = new Map(options.map(([value, iconName]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon-only';
      b.append(icon(iconName));
      b.addEventListener('click', () => choose(value));
      box.append(b);
      return [value, b];
    }));
    return { box, buttons, keyPrefix };
  }

  /**
   * Builds a zoom button.
   * @param {string} iconName Icon.
   * @param {string} key Locale key of its label.
   * @param {number} step −1 to zoom out, 1 to zoom in.
   * @returns {HTMLButtonElement} Button.
   */
  #zoomButton(iconName, key, step) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'icon-only';
    b.dataset.key = key;
    b.append(icon(iconName));
    b.addEventListener('click', () => this.#zoom(step));
    return b;
  }

  /** Writes labels and pressed states of the toolbar buttons. */
  #labelButtons() {
    for (const b of [this.zoomOut, this.zoomIn]) {
      b.title = t(b.dataset.key);
      b.setAttribute('aria-label', t(b.dataset.key));
    }
    const at = ZOOM_STEPS.indexOf(this.width);
    this.zoomOut.disabled = at <= 0;
    this.zoomIn.disabled = at >= ZOOM_STEPS.length - 1;
    for (const [group, current] of [[this.modeButtons, this.mode]]) {
      group.box.setAttribute('aria-label', t(group.keyPrefix));
      for (const [value, b] of group.buttons) {
        const label = t(`${group.keyPrefix}.${value}`);
        b.title = label;
        b.setAttribute('aria-label', label);
        b.setAttribute('aria-pressed', String(value === current));
      }
    }
  }

  /**
   * Zooms the thumbnails one step out or in.
   * @param {number} step −1 or 1.
   * @returns {void}
   */
  #zoom(step) {
    const at = Math.max(0, ZOOM_STEPS.indexOf(this.width));
    const width = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, at + step))];
    if (width === this.width) return;
    this.width = width;
    savePrefs({ thumbWidth: width });
    this.cache.clear();
    this.#applySize();
    this.#labelButtons();
    this.#fill();
  }

  /**
   * Switches between one row per page and one per sheet.
   * @param {'pages'|'sheets'} mode Mode.
   * @returns {void}
   */
  #setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    savePrefs({ thumbMode: mode });
    this.#applySize();
    this.#labelButtons();
    this.#fill();
  }

  /** Sets row height and strip width for the size and mode. */
  #applySize() {
    const w = this.width;
    const side = this.#sideWidth();
    const two = this.mode === 'sheets' && this.layout?.hasBack.includes(1);
    // A portrait page (4:3) plus its label and 8px padding above and below.
    const rowHeight = Math.round((this.mode === 'sheets' ? side : w) * 4 / 3) + 44;
    this.list.rowHeight = rowHeight;
    this.list.style.setProperty('--row-height', `${rowHeight}px`);
    // (At least 168px, set in CSS, so the toolbar fits in one row.)
    this.style.setProperty('--thumb-strip-width', `${(this.mode === 'sheets' ? (two ? 2 * side + 8 : side) : w) + 48}px`);
  }

  /**
   * Width of one side in a sheet row: shared with the back side when any sheet has one, else the
   * full thumbnail width.
   * @returns {number} CSS pixels.
   */
  #sideWidth() {
    const w = this.width;
    return this.layout?.hasBack.includes(1) ? Math.round(w * SIDE_SHARE) : w;
  }

  /**
   * Fills the list for the current mode (pages, or sheets once their layout is known).
   * @returns {Promise<void>} Resolves when filled.
   */
  async #fill() {
    if (!this.documentId) return;
    if (this.mode === 'sheets') {
      const { documentId } = this;
      this.layout ??= await this.client.request({ method: 'getSheetLayout', args: [documentId], priority: 'normal' }).catch(() => null);
      if (documentId !== this.documentId) return;
      if (!this.layout) { this.mode = 'pages'; return this.#fill(); }
      this.#applySize();
      this.list.items = Array.from({ length: this.layout.count }, (_, i) => i + 1);
    } else {
      this.list.items = Array.from({ length: this.pageCount }, (_, i) => i + 1);
    }
    if (this.page) this.setCurrent(this.page);
    else this.list.scrollToStart();
  }

  /**
   * Finds the sheet that holds a page (binary search in the layout).
   * @param {number} page Page number.
   * @returns {number} Sheet number.
   */
  #sheetOf(page) {
    const first = this.layout.firstPage;
    let lo = 0;
    let hi = this.layout.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (first[mid] <= page) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }

  /**
   * Shows the pages of a document.
   * @param {object} client Worker client.
   * @param {import('../render/canvas-renderer.js').CanvasRenderer} renderer Renderer.
   * @param {string} documentId Document id.
   * @param {number} pageCount Number of pages.
   * @returns {void}
   */
  setDocument(client, renderer, documentId, pageCount) {
    this.client = client;
    this.renderer = renderer;
    this.documentId = documentId;
    this.pageCount = pageCount;
    this.layout = null;
    this.page = null;
    this.cache.clear();
    this.pending = new Set();
    this.hint.hidden = true;
    this.#fill();
  }

  /**
   * Marks the current page.
   * @param {number} page Page number.
   * @returns {void}
   */
  setCurrent(page) {
    this.page = page;
    const index = this.mode === 'sheets' && this.layout ? this.#sheetOf(page) - 1 : page - 1;
    this.list.selectedIndex = index;
    this.list.items = this.list.items; // redraw rows
    this.list.showIndex(index);
  }

  /** Forgets drawn thumbnails (after resources were added or the form definition changed). */
  invalidate() {
    this.cache.clear();
    if (this.layout) {
      // Sheets depend on the form definition: read the layout again.
      this.layout = null;
      this.#fill();
    } else this.list.items = this.list.items;
  }

  /**
   * Fills one row: a page (or a sheet's sides) and its label; thumbnails are drawn on demand.
   * @param {number} item Page or sheet number.
   * @param {HTMLElement} el Row element.
   * @returns {void}
   */
  #renderRow(item, el) {
    el.replaceChildren();
    el.classList.add('thumb-row');
    const label = document.createElement('div');
    label.className = 'thumb-label';
    const pics = document.createElement('div');
    pics.className = 'thumb-sides';
    if (this.mode === 'sheets' && this.layout) {
      const first = this.layout.firstPage[item - 1];
      const last = this.layout.firstPage[item] - 1;
      el.classList.toggle('current', this.page >= first && this.page <= last);
      label.textContent = t('thumbs.sheetLabel', { sheet: item, pages: first === last ? first : `${first}–${last}` });
      const sides = this.layout.hasBack[item - 1] ? ['front', 'back'] : ['front'];
      for (const side of sides) pics.append(this.#picture(`s${item}${side}`, () => this.#drawSheet(item, side)));
    } else {
      el.classList.toggle('current', item === this.page);
      label.textContent = String(item);
      pics.append(this.#picture(`p${item}`, () => this.#drawPage(item)));
    }
    el.append(pics, label);
  }

  /**
   * Returns the drawn thumbnail for a key, or a placeholder while it is being drawn.
   * @param {string} key Cache key.
   * @param {() => Promise<object>} load Loads the render model.
   * @returns {HTMLElement} Canvas or placeholder.
   */
  #picture(key, load) {
    const canvas = this.cache.get(key);
    if (canvas) return canvas;
    const box = document.createElement('div');
    box.className = 'thumb-placeholder';
    this.#draw(key, load);
    return box;
  }

  /**
   * Loads the render model of a page.
   * @param {number} page Page number.
   * @returns {Promise<object>} Render model.
   */
  #drawPage(page) {
    return this.client.request({ method: 'getRenderModel', args: [this.documentId, page], priority: 'low' });
  }

  /**
   * Loads the render model of one side of a sheet (its pages at their positions, medium overlays).
   * @param {number} sheet Sheet number.
   * @param {'front'|'back'} side Side.
   * @returns {Promise<object>} Render model.
   */
  #drawSheet(sheet, side) {
    return this.client.request({ method: 'getSheetRenderModel', args: [this.documentId, sheet, side], priority: 'low' });
  }

  /**
   * Draws a thumbnail in the background, fitted into the thumbnail box of the current size.
   * @param {string} key Cache key.
   * @param {() => Promise<object>} load Loads the render model.
   * @returns {Promise<void>} Resolves when drawn.
   */
  async #draw(key, load) {
    const { pending, documentId } = this;
    if (pending.has(key) || !this.client) return;
    pending.add(key);
    try {
      const model = await load();
      if (documentId !== this.documentId) return;
      const w = this.width;
      const boxW = key.startsWith('s') ? this.#sideWidth() : w;
      const scale = Math.min(boxW / model.widthUnits, (boxW * 4 / 3) / model.heightUnits);
      const canvas = document.createElement('canvas');
      canvas.className = 'thumb-canvas';
      await this.renderer.draw(canvas, model, { scale, pixelRatio: window.devicePixelRatio || 1 });
      this.cache.set(key, canvas);
      this.list.items = this.list.items;
    } catch {
      // A failing thumbnail stays empty; the page itself shows the problem.
    } finally {
      pending.delete(key);
    }
  }
}

customElements.define('thumbnail-strip', ThumbnailStrip);
