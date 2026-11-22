/**
 * Helpers for simple tables drawn with the virtual list (code page tables, resource lists): a
 * header row with translated titles and rows of text cells.
 */

import { t } from '../i18n/i18n.js';


/**
 * Builds a header row.
 * @param {string[]} keys Text keys.
 * @param {string} className Row class.
 * @returns {HTMLElement} Header.
 */
export function headerRow(keys, className) {
  const header = document.createElement('div');
  header.className = `${className} table-header`;
  for (const key of keys) {
    const span = document.createElement('span');
    span.dataset.i18n = key;
    span.textContent = t(key);
    header.append(span);
  }
  return header;
}

/**
 * Fills a row element with cells.
 * @param {HTMLElement} el Row.
 * @param {string} className Row class.
 * @param {(string|[string, string])[]} cells Texts, or [text, class].
 * @returns {void}
 */
export function fillRow(el, className, cells) {
  el.classList.add(className);
  el.replaceChildren(...cells.map((c) => {
    const [text, cls] = Array.isArray(c) ? c : [c, ''];
    const span = document.createElement('span');
    span.textContent = text;
    span.title = text;
    if (cls) span.className = cls;
    return span;
  }));
}
