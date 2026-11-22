/**
 * <welcome-panel>: what the page viewer shows while no AFP file is open (FR-094): a start
 * document in the page area, drawn like a page of the viewer (a sheet with a page shadow on the
 * viewer's background), not as a dialog: the large neoAFP logo as letterhead, a one-line purpose
 * and a short summary, a drop area with the hint to drop files or a folder or use the Open
 * buttons in the top bar, the fourteen main features (title and one sentence each), and the note that files are processed on the
 * device and never uploaded. It has no buttons of its own (the top bar has them), dims nothing
 * and blocks nothing: every control of the app stays usable.
 *
 * Dropped files are handled by the application frame, which accepts drops anywhere in the
 * window; this panel only highlights its drop area while files are dragged over the window.
 */

import { t, applyTranslations } from '../i18n/i18n.js';
import { icon, brandLogo } from '../icons.js';

/** The fourteen features shown, each with a short title (`start.feature.<key>`) and a sentence (`.text`). */
// The sheet holds two columns, filled row by row: the second entry stands at the top right,
// the thirteenth ("Pages to go") at the bottom left.
const FEATURES = ['view', 'performance', 'sheets', 'inspect', 'structure', 'resources', 'missing', 'indexes', 'search', 'large', 'barcodes', 'content', 'export', 'languages'];

/**
 * Creates an element with an optional class and text key.
 * @param {string} tag Tag name.
 * @param {string} [className] Class.
 * @param {string} [i18n] Locale key of its text.
 * @returns {HTMLElement} Element.
 */
function el(tag, className, i18n) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (i18n) {
    node.dataset.i18n = i18n;
    node.textContent = t(i18n);
  }
  return node;
}

/**
 * Creates an icon from assets/icons/ drawn in the text color (see .icon in base.css).
 * @param {string} name Icon class suffix.
 * @returns {HTMLElement} Icon.
 */
function assetIcon(name) {
  const span = el('span', `icon icon-${name}`);
  span.setAttribute('aria-hidden', 'true');
  return span;
}

/**
 * The large logo with a slow glint of light gliding across it (base.css `.welcome-shine`): a
 * layer over the image, masked with the logo's own shape so the light falls only on the logo,
 * not on the box around it. Without motion when the system asks for reduced motion.
 * @returns {HTMLElement} Logo.
 */
function shiningLogo() {
  const wrap = el('div', 'welcome-logo-wrap');
  const shine = el('span', 'welcome-shine');
  shine.setAttribute('aria-hidden', 'true');
  const mask = `url("${new URL('../assets/logos/neoafp-logo.svg', import.meta.url).href}")`;
  shine.style.maskImage = mask;
  shine.style.webkitMaskImage = mask;
  wrap.append(brandLogo('welcome-logo'), shine);
  return wrap;
}

export class WelcomePanel extends HTMLElement {
  /** Builds the panel when added to the document. */
  connectedCallback() {
    if (this.drop) return;
    this.className = 'welcome-panel';
    const sheet = el('article', 'welcome-sheet');
    sheet.setAttribute('aria-labelledby', 'welcome-tagline');
    const tagline = el('h1', 'welcome-tagline', 'start.tagline');
    tagline.id = 'welcome-tagline';
    const summary = el('p', 'welcome-summary', 'start.summary');
    this.drop = el('section', 'welcome-drop');
    const badge = el('div', 'welcome-badge');
    badge.append(icon('open'));
    this.drop.append(badge, el('p', 'welcome-drop-hint', 'start.dropHint'));
    const features = el('ul', 'welcome-features');
    for (const key of FEATURES) {
      const li = el('li');
      const body = el('span', 'welcome-feature');
      body.append(el('strong', '', `start.feature.${key}`), el('span', '', `start.feature.${key}.text`));
      li.append(assetIcon('check'), body);
      features.append(li);
    }
    const privacy = el('p', 'welcome-privacy');
    privacy.append(assetIcon('lock'), el('span', '', 'start.privacy'));
    sheet.append(shiningLogo(), tagline, summary, this.drop, features, privacy);
    this.append(sheet);
    applyTranslations(this);

    // Highlight the drop area while files are dragged anywhere over the window.
    let depth = 0;
    const set = (on) => this.drop.classList.toggle('dragging', on);
    window.addEventListener('dragenter', () => { depth++; set(true); });
    window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (depth === 0) set(false); });
    window.addEventListener('drop', () => { depth = 0; set(false); });
  }
}

customElements.define('welcome-panel', WelcomePanel);
