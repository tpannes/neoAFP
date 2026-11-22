/**
 * <codepage-table>: the code points of a code page resource (FR-058): code point (hex), GCGID,
 * and the character when neoAFP knows it, with its Unicode code point (U+XXXX) in muted text.
 * Spaces show "space", control characters "control character", unknown GCGIDs "unknown" — all
 * as quiet muted text, not as boxed marks (a long run of boxes looked like an error list).
 */

import './virtual-list.js';
import { t, onLanguageChange } from '../i18n/i18n.js';
import { headerRow, fillRow } from './table-rows.js';

export class CodepageTable extends HTMLElement {
  /**
   * Shows a code page.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   * @param {object} resource Code page resource.
   * @returns {Promise<void>} Resolves when shown.
   */
  async show(client, resource) {
    this.className = 'meta-table codepage-table';
    const entries = (await client.call('getCodePageTable', resource.id)) ?? [];
    const summary = document.createElement('p');
    summary.className = 'table-summary';
    summary.textContent = t('codepageTable.count', { count: entries.length });
    this.offLanguage?.();
    this.offLanguage = onLanguageChange(() => { summary.textContent = t('codepageTable.count', { count: entries.length }); list.refresh(); });
    const list = document.createElement('virtual-list');
    list.renderRow = (e, el) => {
      fillRow(el, 'codepage-row', [
        [`X'${e.codePoint.toString(16).toUpperCase().padStart(e.codePoint > 0xff ? 4 : 2, '0')}'`, 'mono'],
        [e.gcgid, 'mono'],
        [''],
      ]);
      const cell = el.lastElementChild;
      cell.className = 'codepage-cell';
      const u = e.unicodeCodePoint === null ? '' : `U+${e.unicodeCodePoint.toString(16).toUpperCase().padStart(4, '0')}`;
      const kind = e.kind ?? (e.glyphAvailable ? 'char' : 'unknown');
      const main = document.createElement('span');
      if (kind === 'char') {
        main.className = 'codepage-char';
        main.textContent = e.unicode;
      } else {
        main.className = 'codepage-note';
        main.textContent = t(`codepageTable.${kind}`);
      }
      const code = document.createElement('span');
      code.className = 'codepage-unicode mono';
      code.textContent = u;
      cell.replaceChildren(main, code);
      cell.title = [kind === 'char' ? e.unicode : t(`codepageTable.${kind}`), u].filter(Boolean).join(' · ');
    };
    this.replaceChildren(summary, headerRow(['codepageTable.col.codePoint', 'codepageTable.col.gcgid', 'codepageTable.col.character'], 'codepage-row'), list);
    list.items = entries;
  }
}

customElements.define('codepage-table', CodepageTable);
