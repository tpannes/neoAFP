/**
 * <view-toggle>: how the page viewer lays out pages (FR-018), two icon buttons of which one is
 * pressed — the same icons, in the same order, as the thumbnail strip's pages/sheets choice:
 * - Simplex (one page, left): every page alone, one below the other, whatever the medium map says.
 * - Duplex (two sides, right; the default): pages follow the medium maps — duplex sheets with front
 *   and back side by side, simplex pages one below the other.
 * The choice is remembered as the `pageView` preference ('auto' or 'simplex'); without one the
 * viewer shows duplex. Emits `change` (detail: { view: 'auto' | 'simplex' }).
 */

import { loadPrefs, savePrefs } from '../prefs.js';
import { icon } from '../icons.js';
import { t, onLanguageChange } from '../i18n/i18n.js';

/** Views with their icon and label key: simplex left, duplex right, as in the thumbnail strip. */
const VIEWS = [['simplex', 'page', 'view.simplex'], ['auto', 'sheetSides', 'view.duplex']];

export class ViewToggle extends HTMLElement {
  /** Builds the buttons. */
  connectedCallback() {
    if (this.buttons) return;
    this.view = loadPrefs().pageView;
    this.className = 'segmented view-toggle';
    this.setAttribute('role', 'group');
    this.buttons = new Map(VIEWS.map(([view, iconName]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'icon-only';
      b.append(icon(iconName));
      b.addEventListener('click', () => { if (view !== this.view) this.set(view); });
      this.append(b);
      return [view, b];
    }));
    onLanguageChange(() => this.#update());
    this.#update();
  }

  /**
   * Switches the view.
   * @param {'auto'|'simplex'} view View.
   * @returns {void}
   */
  set(view) {
    this.view = view;
    savePrefs({ pageView: view });
    this.#update();
    this.dispatchEvent(new CustomEvent('change', { detail: { view } }));
  }

  /** Shows the pressed button and writes the labels. */
  #update() {
    if (!this.buttons) return;
    this.setAttribute('aria-label', t('view.layout'));
    for (const [view, , key] of VIEWS) {
      const b = this.buttons.get(view);
      b.title = t(key);
      b.setAttribute('aria-label', t(key));
      b.setAttribute('aria-pressed', String(view === this.view));
    }
  }
}

customElements.define('view-toggle', ViewToggle);
