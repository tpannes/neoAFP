/**
 * <about-dialog>: "About neoAFP", opened from the info button at the right end of the status
 * bar (FR-101): the logo and version, the author, the note that neoAFP was developed entirely by
 * AI (Claude Opus by Anthropic, guided by the author), and the license — GNU Affero General
 * Public License v3.0 or later, in short what it allows and asks, with a link to the full text in
 * the LICENSE file shipped with the app (next to index.html), and the link to the source code
 * (AGPL section 13: users of a version offered over a network can get its source; whoever offers
 * a changed version must point SOURCE_URL at that version's source). The file has no extension, so web
 * servers tend to send it as a download; the link therefore loads it and shows it as plain text
 * in a new tab (falling back to the plain link if that fails).
 * A modal dialog; Escape, the close button or a click on the backdrop closes it.
 */

import { t, onLanguageChange } from '../i18n/i18n.js';
import { iconButton, brandLogo } from '../icons.js';
import { VERSION } from '../../version.js';

/** Author of neoAFP (package.json "author"). */
const AUTHOR = 'Timo Pannes';
/** Source code of this version (AGPL section 13). */
const SOURCE_URL = 'https://github.com/tpannes/neoAFP';
/** Full text of the license: the LICENSE file at the app's root (three levels above this module). */
const LICENSE_URL = new URL('../../../LICENSE', import.meta.url).href;

/**
 * Opens the license file as plain text in a new tab.
 * @param {MouseEvent} e Click on the link.
 * @returns {Promise<void>} Resolves when opened.
 */
async function openLicense(e) {
  e.preventDefault();
  // Open the tab right away (still inside the click, so it is not blocked as a pop-up).
  const tab = window.open('', '_blank');
  try {
    const response = await fetch(LICENSE_URL);
    if (!response.ok) throw new Error(String(response.status));
    const blob = new Blob([await response.text()], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    if (tab) tab.location.href = url; else window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch {
    if (tab) tab.location.href = LICENSE_URL; else window.open(LICENSE_URL, '_blank');
  }
}

/**
 * Creates an element with a class and text.
 * @param {string} tag Tag name.
 * @param {string} [className] Class.
 * @param {string} [text] Text.
 * @returns {HTMLElement} Element.
 */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class AboutDialog extends HTMLElement {
  /** Builds the dialog. */
  connectedCallback() {
    if (this.dialog) return;
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'about-dialog';
    this.dialog.addEventListener('click', (e) => { if (e.target === this.dialog) this.dialog.close(); });
    this.append(this.dialog);
    this.#render();
    onLanguageChange(() => this.#render());
  }

  /** Opens the dialog. */
  open() {
    this.#render();
    this.dialog.showModal();
  }

  /** Fills the dialog in the current language. */
  #render() {
    const close = iconButton('close', 'about.close', { iconOnly: true, className: 'dialog-close' });
    close.title = t('about.close');
    close.setAttribute('aria-label', t('about.close'));
    close.addEventListener('click', () => this.dialog.close());
    const head = el('header', 'about-head');
    const logo = brandLogo('about-logo');
    logo.querySelector('img').alt = t('app.title');
    const title = el('h2', 'about-title', t('about.title'));
    title.id = 'about-title';
    this.dialog.setAttribute('aria-labelledby', title.id);
    head.append(logo, close);
    const version = el('p', 'about-version', t('about.version', { version: VERSION }));
    const facts = el('dl', 'about-facts');
    const source = el('a', '', SOURCE_URL.replace(/^https:\/\//, ''));
    source.href = SOURCE_URL;
    source.target = '_blank';
    source.rel = 'noopener';
    const sourceCell = el('dd');
    sourceCell.append(source);
    facts.append(el('dt', '', t('about.author')), el('dd', '', AUTHOR), el('dt', '', t('about.source')), sourceCell);
    const ai = el('section', 'about-ai');
    ai.append(el('h3', '', t('about.aiTitle')), el('p', '', t('about.aiText')));
    const license = el('section', 'about-license');
    const link = el('a', '', t('about.licenseLink'));
    link.href = LICENSE_URL;
    link.target = '_blank';
    link.addEventListener('click', openLicense);
    license.append(el('h3', '', t('about.licenseTitle')), el('p', '', t('about.licenseText')), link);
    this.dialog.replaceChildren(head, title, version, facts, ai, license);
  }
}

customElements.define('about-dialog', AboutDialog);
