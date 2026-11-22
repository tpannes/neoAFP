/**
 * <diagnostics-panel>: the Log Viewer (FR-081, FR-092): lists problems found in the open files —
 * severity, byte offset and the translated message. Toggle buttons switch errors, warnings and
 * infos on and off one by one, each with its count. The choice is remembered (preference
 * `logSeverities`). Opened from the status bar; its
 * close button emits `close`. A scope (setScope, from the Details panel's page messages) shows
 * only the messages of one byte range of one file — a page — with a removable chip naming it.
 */

import './virtual-list.js';
import { t, onLanguageChange, applyTranslations } from '../i18n/i18n.js';
import { iconButton } from '../icons.js';
import { loadPrefs, savePrefs } from '../prefs.js';

/** Message types, most severe first, with their icons. */
const SEVERITIES = [['error', 'error'], ['warning', 'warning'], ['info', 'info']];

export class DiagnosticsPanel extends HTMLElement {
  /** Creates an empty panel. */
  constructor() {
    super();
    /** @type {object[]} all diagnostics */
    this.all = [];
    /** @type {Map<string, string>} file id → path */
    this.fileNames = new Map();
    /** @type {Set<string>} message types shown */
    this.shownTypes = new Set(loadPrefs().logSeverities);
    /** @type {{fileId: string, from: number, to: number, label: string}|null} shown range */
    this.scope = null;
  }

  /** Builds the filter and the list. */
  connectedCallback() {
    if (this.list) return;
    this.className = 'diagnostics';
    const header = document.createElement('div');
    header.className = 'panel-title';
    const title = document.createElement('span');
    title.dataset.i18n = 'panel.diagnostics';
    title.textContent = t('panel.diagnostics');
    const types = document.createElement('div');
    types.className = 'segmented log-types';
    types.setAttribute('role', 'group');
    types.dataset.i18nAttr = 'aria-label:diagnostics.types';
    this.typeButtons = new Map(SEVERITIES.map(([severity, iconName]) => {
      const b = iconButton(iconName, `severity.${severity}`, { className: `severity-${severity}` });
      b.addEventListener('click', () => {
        const next = new Set(this.shownTypes);
        if (next.has(severity)) next.delete(severity);
        else next.add(severity);
        this.#setTypes([...next]);
      });
      return [severity, b];
    }));
    types.append(...this.typeButtons.values());
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    // Scope chip: "Page 5 ×" while only one page's messages are shown.
    this.scopeChip = iconButton('close', 'diagnostics.showAll', { className: 'scope-chip' });
    this.scopeChip.hidden = true;
    this.scopeChip.addEventListener('click', () => this.setScope(null));
    const close = iconButton('close', 'panel.close', { iconOnly: true });
    close.addEventListener('click', () => this.dispatchEvent(new CustomEvent('close')));
    header.append(title, types, this.scopeChip, spacer, close);
    applyTranslations(header);
    this.list = document.createElement('virtual-list');
    this.list.style.height = '200px';
    this.list.renderRow = (d, el) => this.#renderRow(d, el);
    this.append(header, this.list);
    onLanguageChange(() => this.#refresh());
    this.#refresh();
  }

  /**
   * Shows the given message types and remembers the choice.
   * @param {string[]} types Message types to show.
   * @returns {void}
   */
  #setTypes(types) {
    this.shownTypes = new Set(types);
    savePrefs({ logSeverities: SEVERITIES.map(([s]) => s).filter((s) => this.shownTypes.has(s)) });
    this.#refresh();
  }

  /** Marks the pressed buttons and writes the counts into their labels. */
  #updateButtons() {
    const s = this.scope;
    const count = (severity) => this.all.filter((d) => d.severity === severity
      && (!s || (d.fileId === s.fileId && d.offset !== null && d.offset >= s.from && d.offset < s.to))).length;
    const label = (button, text) => {
      const span = button.querySelector('span');
      span.removeAttribute('data-i18n');
      span.textContent = text;
    };
    for (const [severity, b] of this.typeButtons) {
      b.setAttribute('aria-pressed', String(this.shownTypes.has(severity)));
      label(b, `${t(`severity.${severity}`)} (${count(severity)})`);
    }
  }

  /**
   * Writes one diagnostic into a row element.
   * @param {object} d Diagnostic.
   * @param {HTMLElement} el Row element.
   * @returns {void}
   */
  #renderRow(d, el) {
    if (!d) {
      el.textContent = t(this.all.length ? 'diagnostics.noneShown' : 'diagnostics.none');
      el.className = 'vl-row';
      return;
    }
    const where = d.offset !== null ? ` (${t('diagnostics.atOffset', { offset: d.offset })})` : '';
    el.className = `vl-row severity-${d.severity}`;
    el.textContent = `${t(`severity.${d.severity}`)}: ${t(d.messageKey, this.#params(d))}${where}`;
    el.title = el.textContent;
  }

  /**
   * Translates parameters that are themselves keys (file kinds, skip reasons).
   * @param {object} d Diagnostic.
   * @returns {object} Parameters for the message.
   */
  #params(d) {
    const p = { ...d.params };
    if (p.kind) p.kind = t(`kind.${p.kind}`);
    if (p.reason && ['notAfp', 'unknownEncoding', 'onlyComments'].includes(p.reason)) p.reason = t(`skip.${p.reason}`);
    if (p.reason === null) p.reason = '';
    return p;
  }

  /**
   * Adds diagnostics.
   * @param {...object} diagnostics Diagnostics from the worker.
   * @returns {void}
   */
  add(...diagnostics) {
    this.all.push(...diagnostics);
    this.#refresh();
  }

  /** Removes all diagnostics. */
  clear() {
    this.all = [];
    this.#refresh();
  }

  /**
   * Shows only the messages of one byte range of a file (a page), or all again.
   * @param {{fileId: string, from: number, to: number, label: string}|null} scope Range, or null.
   * @returns {void}
   */
  setScope(scope) {
    this.scope = scope;
    this.#refresh();
  }

  /** Re-applies the chosen message types and scope and updates the buttons. */
  #refresh() {
    if (!this.list) return;
    const s = this.scope;
    const inScope = (d) => !s || (d.fileId === s.fileId && d.offset !== null && d.offset >= s.from && d.offset < s.to);
    const shown = this.all.filter((d) => this.shownTypes.has(d.severity) && inScope(d));
    if (this.scopeChip) {
      this.scopeChip.hidden = !s;
      const span = this.scopeChip.querySelector('span');
      span.removeAttribute('data-i18n');
      span.textContent = s ? s.label : '';
      this.scopeChip.title = t('diagnostics.showAll');
    }
    this.list.items = shown.length ? shown : [null];
    this.#updateButtons();
  }
}

customElements.define('diagnostics-panel', DiagnosticsPanel);
