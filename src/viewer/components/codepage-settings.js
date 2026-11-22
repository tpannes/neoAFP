/**
 * <codepage-settings>: code page choice for NOPs, TLEs or all other text (FR-037). The TLE
 * browser, the NOP browser and the structure view each show the selector of their category.
 * Each selector offers "From file" and every code page, grouped by EBCDIC, ASCII/ANSI and
 * Unicode, and shows the setting in force (also when another selector changed it).
 * Event: `change` (detail: { category, id }) after the worker applied the setting.
 */

import { t, onLanguageChange } from '../i18n/i18n.js';

const CATEGORIES = ['nop', 'tle', 'text'];
const KINDS = ['ebcdic', 'ascii', 'unicode'];

export class CodepageSettings extends HTMLElement {
  /**
   * Builds the selectors.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   * @param {('nop'|'tle'|'text')[]} [categories] Categories to offer (default all).
   * @returns {Promise<void>} Resolves when filled.
   */
  async attach(client, categories = CATEGORIES) {
    this.client = client;
    this.className = 'codepage-settings';
    this.codePages = await client.call('listCodePages');
    this.selects = new Map();
    const parts = [];
    for (const category of categories) {
      const label = document.createElement('label');
      const caption = document.createElement('span');
      caption.dataset.i18n = `codepage.${category}`;
      caption.textContent = t(`codepage.${category}`);
      const select = document.createElement('select');
      select.addEventListener('change', async () => {
        const id = select.value || null;
        await client.call('setCodePageOverride', category, id);
        this.dispatchEvent(new CustomEvent('change', { detail: { category, id } }));
      });
      this.selects.set(category, select);
      label.append(caption, select);
      parts.push(label);
    }
    this.replaceChildren(...parts);
    this.#fill();
    onLanguageChange(() => this.#fill());
  }

  /** Fills (or refills after a language change) the options, keeping the selection. */
  #fill() {
    for (const select of this.selects.values()) {
      const value = select.value;
      const fromFile = new Option(t('codepage.fromFile'), '');
      const groups = KINDS.map((kind) => {
        const group = document.createElement('optgroup');
        group.label = t(`codepage.kind.${kind}`);
        for (const cp of this.codePages.filter((c) => c.kind === kind)) group.append(new Option(cp.label, cp.id));
        return group;
      });
      select.replaceChildren(fromFile, ...groups);
      select.value = value;
    }
  }
}

customElements.define('codepage-settings', CodepageSettings);
