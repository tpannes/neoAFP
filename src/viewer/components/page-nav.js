/**
 * <page-nav>: page navigation and zoom controls (FR-015, FR-017): first, previous, next, last,
 * page number input with "of N", and zoom: buttons for fit page, fit width and 100 %, zoom out
 * and in, and a selector of percent levels that always shows the zoom in effect (25–400 %).
 * Emits `navigate` (detail: { page }) and `zoom` (detail: { value }).
 */

import { t, onLanguageChange } from '../i18n/i18n.js';
import { iconButton } from '../icons.js';

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

export class PageNav extends HTMLElement {
  /** Creates the controls; set `pageCount` and `page` to update them. */
  constructor() {
    super();
    this.page = 1;
    this.pageCount = 0;
  }

  /** Builds the controls. */
  connectedCallback() {
    if (this.input) return;
    this.className = 'page-nav';
    const button = (key, iconName, onClick) => {
      const b = iconButton(iconName, key, { iconOnly: true });
      b.addEventListener('click', onClick);
      return b;
    };
    this.first = button('nav.first', 'first', () => this.#go(1));
    this.prev = button('nav.previous', 'previous', () => this.#go(this.page - 1));
    this.next = button('nav.next', 'next', () => this.#go(this.page + 1));
    this.last = button('nav.last', 'last', () => this.#go(this.pageCount));
    this.input = document.createElement('input');
    this.input.type = 'number';
    this.input.min = '1';
    this.input.className = 'page-input';
    this.input.dataset.i18nAttr = 'aria-label:nav.pageNumber';
    this.input.addEventListener('change', () => this.#go(Number(this.input.value)));
    this.ofText = document.createElement('span');
    this.zoomSelect = document.createElement('select');
    this.zoomSelect.dataset.i18nAttr = 'aria-label:zoom.label';
    this.zoomSelect.addEventListener('change', () => this.#zoom(Number(this.zoomSelect.value)));
    this.fitPage = button('zoom.fitPage', 'fitPage', () => this.#zoom('fitPage'));
    this.fitWidth = button('zoom.fitWidth', 'fitWidth', () => this.#zoom('fitWidth'));
    this.actualSize = button('zoom.actualSize', 'actualSize', () => this.#zoom(1));
    this.zoomOut = button('zoom.out', 'zoomOut', () => this.#step(-1));
    this.zoomIn = button('zoom.in', 'zoomIn', () => this.#step(1));
    const pages = document.createElement('span');
    pages.className = 'tool-group';
    pages.append(this.first, this.prev, this.input, this.ofText, this.next, this.last);
    const zoom = document.createElement('span');
    zoom.className = 'tool-group';
    zoom.append(this.fitPage, this.fitWidth, this.actualSize, this.zoomOut, this.zoomSelect, this.zoomIn);
    this.append(pages, zoom);
    this.showZoom(1, 'fitWidth');
    onLanguageChange(() => this.update());
    this.update();
  }

  /**
   * Shows the zoom in effect: the selector lists the percent levels and, when the zoom is none of
   * them (fit modes), the zoom itself in its place; the button of the mode in effect is pressed.
   * @param {number} zoom Factor.
   * @param {string} mode 'fitPage', 'fitWidth' or 'percent'.
   * @returns {void}
   */
  showZoom(zoom, mode) {
    this.currentZoom = zoom;
    if (!this.zoomSelect) return; // not built yet
    const option = (z) => {
      const o = document.createElement('option');
      o.value = String(z);
      o.textContent = `${Math.round(z * 100)} %`;
      return o;
    };
    const steps = ZOOM_STEPS.map(option);
    const at = ZOOM_STEPS.findIndex((z) => Math.abs(z - zoom) < 1e-6);
    if (at >= 0) steps[at].selected = true;
    else {
      const own = option(zoom);
      own.selected = true;
      const before = ZOOM_STEPS.findIndex((z) => z > zoom);
      steps.splice(before < 0 ? steps.length : before, 0, own);
    }
    this.zoomSelect.replaceChildren(...steps);
    this.fitPage.setAttribute('aria-pressed', String(mode === 'fitPage'));
    this.fitWidth.setAttribute('aria-pressed', String(mode === 'fitWidth'));
    this.actualSize.setAttribute('aria-pressed', String(mode === 'percent' && at === ZOOM_STEPS.indexOf(1)));
  }

  /**
   * Requests a zoom.
   * @param {number|'fitPage'|'fitWidth'} value Factor or fit mode.
   * @returns {void}
   */
  #zoom(value) {
    this.dispatchEvent(new CustomEvent('zoom', { detail: { value } }));
  }

  /**
   * Zooms one step in or out from the current zoom.
   * @param {number} direction +1 or −1.
   * @returns {void}
   */
  #step(direction) {
    const z = this.currentZoom ?? 1;
    const next = direction > 0 ? ZOOM_STEPS.find((s) => s > z + 1e-6) ?? 4 : [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) ?? 0.25;
    this.#zoom(next);
  }

  /**
   * Requests navigation to a page (within range).
   * @param {number} page Page number.
   * @returns {void}
   */
  #go(page) {
    if (!this.pageCount) return;
    const target = Math.min(this.pageCount, Math.max(1, Math.round(page) || 1));
    this.dispatchEvent(new CustomEvent('navigate', { detail: { page: target } }));
  }

  /** Updates the controls for the current page and page count. */
  update() {
    if (!this.input) return;
    this.input.max = String(this.pageCount);
    this.input.value = this.pageCount ? String(this.page) : '';
    this.ofText.textContent = t('nav.of', { count: this.pageCount });
    this.first.disabled = this.prev.disabled = this.page <= 1;
    this.next.disabled = this.last.disabled = this.page >= this.pageCount;
    const none = this.pageCount === 0;
    this.input.disabled = none;
    for (const c of [this.zoomSelect, this.zoomIn, this.zoomOut, this.fitPage, this.fitWidth, this.actualSize]) c.disabled = none;
    for (const el of this.querySelectorAll('[data-i18n-attr]')) {
      for (const pair of el.dataset.i18nAttr.split(',')) {
        const [attr, key] = pair.split(':');
        el.setAttribute(attr, t(key));
      }
    }
  }
}

customElements.define('page-nav', PageNav);
