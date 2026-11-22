/**
 * <test-print-toggle>: the icon button that hides the test print — the word "TEST" drawn from strokes
 * on the page (detected by the library, src/lib/render/test-print.js). `aria-pressed` shows whether
 * it is hidden; the choice is remembered as the `hideTestPrint` preference.
 * Emits `change` (detail: { hide: boolean }).
 */

import { applyTranslations } from '../i18n/i18n.js';
import { loadPrefs, savePrefs } from '../prefs.js';
import { iconButton } from '../icons.js';

export class TestPrintToggle extends HTMLElement {
  /** Reads the stored choice. */
  constructor() {
    super();
    this.hide = loadPrefs().hideTestPrint;
  }

  /** Builds the button. */
  connectedCallback() {
    if (this.button) return;
    this.button = iconButton('testPrint', 'view.hideTestPrintTitle', { iconOnly: true, className: 'toggle' });
    this.button.addEventListener('click', () => this.set(!this.hide));
    this.append(this.button);
    applyTranslations(this);
    this.#update();
  }

  /**
   * Hides or shows the test print.
   * @param {boolean} hide True to hide it.
   * @returns {void}
   */
  set(hide) {
    this.hide = hide;
    savePrefs({ hideTestPrint: hide });
    this.#update();
    this.dispatchEvent(new CustomEvent('change', { detail: { hide } }));
  }

  /** Updates the pressed state. */
  #update() {
    if (this.button) this.button.setAttribute('aria-pressed', String(this.hide));
  }
}

customElements.define('test-print-toggle', TestPrintToggle);
