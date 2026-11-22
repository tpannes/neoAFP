/**
 * <field-detail>: the Details panel of the structure view (FR-032, FR-040) for the selected tree
 * item. For a structured field:
 * - a header with the item's icon, short and full name, the name the field carries and a "not
 *   decoded" mark for fields shown only as bytes;
 * - facts: identifier, offset, length (and data length), page, where it lies in the file (the
 *   names of the enclosing Begin fields) and the specification reference;
 * - "Show on page" for fields on a page (FR-034);
 * - the decoded parameters as a table and the triplets with their decoded values.
 * For a triplet: its identifier and name, the field it belongs to, offset, length and decoded
 * values. The raw bytes of either are in the hex view below (structure-view.js).
 * Event: `showonpage` (detail: { fieldIndex }).
 */

import { t, onLanguageChange } from '../i18n/i18n.js';
import { kindIcon } from '../icons.js';

/**
 * Writes bytes as spaced hex pairs.
 * @param {Uint8Array} bytes Bytes.
 * @returns {string} E.g. "5A 00 18".
 */
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

/**
 * Writes an offset in decimal and hexadecimal.
 * @param {number} n Offset.
 * @returns {string} E.g. "1277 (X'4FD')".
 */
const offsetText = (n) => `${n} (X'${n.toString(16).toUpperCase()}')`;

/**
 * Creates an element with text.
 * @param {string} tag Tag name.
 * @param {string} [text] Text.
 * @param {string} [className] Class.
 * @returns {HTMLElement} Element.
 */
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/**
 * Builds a list of facts.
 * @param {[string, string|null][]} rows Locale key → value (rows without value are left out).
 * @returns {HTMLElement} Definition list.
 */
function facts(rows) {
  const dl = el('dl', undefined, 'detail-facts');
  for (const [key, value] of rows) {
    if (value === null || value === undefined || value === '') continue;
    dl.append(el('dt', t(key)), el('dd', String(value), 'mono'));
  }
  return dl;
}

/**
 * Builds the decoded values of a triplet.
 * @param {{decoded: object|null, rawOnly: boolean, raw: Uint8Array}} tr Triplet.
 * @returns {HTMLElement} Values, or the raw bytes with a "raw" mark.
 */
function tripletValues(tr) {
  if (tr.decoded && !tr.rawOnly) {
    const dl = el('dl', undefined, 'triplet-values');
    for (const [k, v] of Object.entries(tr.decoded)) dl.append(el('dt', k), el('dd', Array.isArray(v) ? v.join(', ') : String(v), 'mono'));
    return dl;
  }
  const box = el('div');
  box.append(el('span', t('fields.raw'), 'raw-mark'), el('div', hex(tr.raw), 'mono raw-bytes'));
  return box;
}

export class FieldDetail extends HTMLElement {
  /** Prepares the element. */
  connectedCallback() {
    this.className = 'field-detail';
    onLanguageChange(() => this.#render());
    this.#render();
  }

  /**
   * Shows a tree item.
   * @param {object|null} node Tree node (src/lib/modca/tree.js), or null to clear.
   * @param {object|null} field The node's field (getField), or null.
   * @param {{pageNumber: number|null}|null} location The field's page (locate).
   * @param {string[]} path Names of the enclosing items, outermost first.
   * @returns {void}
   */
  show(node, field, location, path = []) {
    Object.assign(this, { node, field, location, path });
    this.#render();
  }

  /** Draws the item. */
  #render() {
    const { node, field: f } = this;
    if (!node || !f) {
      this.replaceChildren(el('div', t('detail.none'), 'empty-state'));
      return;
    }
    if (node.type === 'triplet') {
      this.#renderTriplet(node, f);
      return;
    }
    const head = el('div', undefined, 'detail-head');
    const title = el('h3');
    title.append(kindIcon(node.kind), el('span', `${f.shortName ?? t('fields.unknown')} – ${f.fullName ?? t('detail.unknownField')}`));
    head.append(title);
    if (node.label) head.append(el('span', node.label, 'detail-label mono'));
    if (!f.decoded) head.append(el('span', t('fields.raw'), 'raw-mark'));
    const parts = [head, facts([
      ['detail.id', `X'${f.idHex}'`], ['detail.offset', offsetText(f.offset)],
      ['detail.length', t('detail.lengthWithData', { length: f.length, data: f.rawBytes.length })],
      ['detail.page', this.location?.pageNumber ? String(this.location.pageNumber) : null],
      ['detail.path', this.path.join(' › ')], ['detail.spec', f.specRef],
    ])];
    if (this.location?.pageNumber) {
      const button = el('button', t('detail.showOnPage', { page: this.location.pageNumber }));
      button.type = 'button';
      button.addEventListener('click', () => this.dispatchEvent(new CustomEvent('showonpage', { detail: { fieldIndex: f.index } })));
      parts.push(button);
    }
    if (!f.decoded) {
      parts.push(el('p', t(f.shortName ? 'detail.notDecoded' : 'detail.unknown'), 'raw-note'));
    } else if (f.parameters.length) {
      parts.push(el('h4', t('detail.parameters')));
      const table = el('table', undefined, 'param-table');
      for (const p of f.parameters) {
        const tr = el('tr');
        tr.append(el('th', p.name), el('td', String(p.value), 'mono'));
        table.append(tr);
      }
      parts.push(table);
    }
    if (f.triplets.length) {
      parts.push(el('h4', t('detail.triplets', { count: f.triplets.length })));
      const list = el('ul', undefined, 'triplet-list');
      for (const tr of f.triplets) {
        const li = el('li');
        li.append(el('b', `X'${tr.id.toString(16).toUpperCase().padStart(2, '0')}' ${tr.name ?? t('detail.unknownTriplet')}`), tripletValues(tr));
        list.append(li);
      }
      parts.push(list);
    }
    this.replaceChildren(...parts);
  }

  /**
   * Draws a triplet.
   * @param {object} node Triplet node.
   * @param {object} f Its field.
   * @returns {void}
   */
  #renderTriplet(node, f) {
    const tr = f.triplets[node.tripletIndex];
    const head = el('div', undefined, 'detail-head');
    const title = el('h3');
    title.append(kindIcon('triplet'), el('span', `X'${node.code}' – ${node.fullName ?? t('detail.unknownTriplet')}`));
    head.append(title);
    const parts = [head, facts([
      ['detail.tripletOf', `${f.shortName ?? f.idHex} – ${f.fullName ?? ''}`], ['detail.offset', offsetText(node.offset)],
      ['detail.length', String(node.length)], ['detail.path', this.path.join(' › ')],
    ])];
    if (tr) parts.push(el('h4', t('detail.values')), tripletValues(tr));
    this.replaceChildren(...parts);
  }
}

customElements.define('field-detail', FieldDetail);
