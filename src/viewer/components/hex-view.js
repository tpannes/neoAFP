/**
 * <hex-view>: raw bytes of a structured field (FR-032): offset, 16 bytes in hexadecimal and a
 * text column in the code page chosen for other text (or EBCDIC 273). Rows are drawn with the
 * virtual list, so large fields stay fast.
 */

import './virtual-list.js';
import { t } from '../i18n/i18n.js';

export class HexView extends HTMLElement {
  /** Builds the list. */
  connectedCallback() {
    if (this.list) return;
    this.className = 'hex-view';
    this.list = document.createElement('virtual-list');
    this.list.setAttribute('data-i18n-attr', 'aria-label:hex.label');
    this.list.setAttribute('aria-label', t('hex.label'));
    this.list.renderRow = (row, el) => {
      el.classList.add('hex-row', 'mono');
      const cells = [row.offset.toString(16).toUpperCase().padStart(8, '0'), row.hex.padEnd(47, ' '), row.text];
      el.replaceChildren(...cells.map((text) => Object.assign(document.createElement('span'), { textContent: text })));
    };
    this.append(this.list);
  }

  /**
   * Shows bytes of a file.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   * @param {string} fileId File id.
   * @param {number} offset First byte.
   * @param {number} length Number of bytes.
   * @returns {Promise<void>} Resolves when shown.
   */
  async show(client, fileId, offset, length) {
    this.args = [client, fileId, offset, length];
    const token = (this.token = (this.token ?? 0) + 1);
    const { rows } = await client.call('getHex', fileId, offset, length);
    if (token !== this.token) return;
    this.list.items = rows;
    this.list.scrollTop = 0;
  }

  /**
   * The shown bytes as one hex string: two uppercase digits per byte, no spaces.
   * @returns {string} Hex string (empty when nothing is shown).
   */
  hexString() {
    return this.list.items.map((row) => row.hex.replace(/ /g, '')).join('');
  }

  /** Clears the view. */
  clear() {
    this.args = null;
    this.list.items = [];
  }

  /**
   * Reloads the bytes (after the code page for other text changed).
   * @returns {Promise<void>} Resolves when shown.
   */
  async refresh() {
    if (this.args) await this.show(...this.args);
  }
}

customElements.define('hex-view', HexView);
