/**
 * <language-menu>: the interface language choice with a small flag per language. The button
 * shows only the current language's flag (its name as tooltip); the list shows flag and name. A native
 * <select> cannot show images and flag emoji are not drawn on every system, so this is a button
 * with a list box (WAI-ARIA "select-only combobox" pattern): Enter, Space or arrow keys open it;
 * arrow keys, Home and End move; Enter or Space choose; Escape or Tab close.
 * Event: `change` (detail: { tag }).
 */

import { t, onLanguageChange } from '../i18n/i18n.js';

/** Flag file (in assets/flags/) per language tag; languages without an entry show no flag. */
const FLAGS = { en: 'gb', de: 'de', fr: 'fr', es: 'es', it: 'it', nl: 'nl', 'zh-Hans': 'cn', ja: 'jp' };
const FLAG_DIR = new URL('../assets/flags/', import.meta.url);

/**
 * Creates the flag image of a language.
 * @param {string} tag Language tag.
 * @returns {HTMLImageElement|HTMLSpanElement} Image (decorative), or an empty placeholder.
 */
function flag(tag) {
  if (!FLAGS[tag]) {
    const blank = document.createElement('span');
    blank.className = 'flag';
    return blank;
  }
  const img = document.createElement('img');
  img.className = 'flag';
  img.src = new URL(`${FLAGS[tag]}.svg`, FLAG_DIR).href;
  img.alt = '';
  img.width = 20;
  img.height = 14;
  return img;
}

let menuCount = 0;

export class LanguageMenu extends HTMLElement {
  /** Builds button and list. */
  connectedCallback() {
    if (this.button) return;
    const id = `language-list-${++menuCount}`;
    this.languages = [];
    this.current = null;
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.className = 'language-button';
    this.button.setAttribute('aria-haspopup', 'listbox');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.setAttribute('aria-controls', id);
    this.list = document.createElement('ul');
    this.list.id = id;
    this.list.className = 'language-list';
    this.list.setAttribute('role', 'listbox');
    this.list.tabIndex = -1;
    this.list.hidden = true;
    this.append(this.button, this.list);
    this.button.addEventListener('click', () => (this.list.hidden ? this.#open() : this.#close(true)));
    this.button.addEventListener('keydown', (e) => {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        this.#open();
      }
    });
    this.list.addEventListener('keydown', (e) => this.#onKey(e));
    this.list.addEventListener('click', (e) => {
      const li = e.target.closest('[role="option"]');
      if (li) this.#choose(li.dataset.tag);
    });
    this.list.addEventListener('mousemove', (e) => {
      const li = e.target.closest('[role="option"]');
      if (li) this.#activate(this.#options().indexOf(li));
    });
    this.list.addEventListener('focusout', (e) => {
      if (!this.contains(e.relatedTarget)) this.#close(false);
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.list.hidden && !this.contains(e.target)) this.#close(false);
    });
    onLanguageChange(() => this.#updateButton());
    if (this.pending) this.setLanguages(...this.pending);
  }

  /**
   * Sets the languages and the current one.
   * @param {{tag: string, name: string}[]} languages Languages (name in the language itself).
   * @param {string} current Tag of the current language.
   * @returns {void}
   */
  setLanguages(languages, current) {
    if (!this.button) {
      this.pending = [languages, current];
      return;
    }
    this.languages = languages;
    this.current = current;
    this.list.replaceChildren(...languages.map(({ tag, name }) => {
      const li = document.createElement('li');
      li.id = `${this.list.id}-${tag}`;
      li.setAttribute('role', 'option');
      li.dataset.tag = tag;
      const label = document.createElement('span');
      label.lang = tag;
      label.textContent = name;
      li.append(flag(tag), label);
      return li;
    }));
    this.#updateButton();
  }

  /** Shows the current language on the button. */
  #updateButton() {
    const lang = this.languages.find((l) => l.tag === this.current);
    const name = lang?.name ?? this.current ?? '';
    // The button shows only the flag; the name is its tooltip and accessible name. A language
    // without a flag shows its name instead.
    const parts = [FLAGS[this.current] ? flag(this.current) : Object.assign(document.createElement('span'), { textContent: name })];
    this.button.replaceChildren(...parts, Object.assign(document.createElement('span'), { className: 'caret', textContent: '▾' }));
    this.button.title = name;
    this.button.setAttribute('aria-label', `${t('toolbar.language')}: ${name}`);
    this.list.setAttribute('aria-label', t('toolbar.language'));
    for (const li of this.#options()) li.setAttribute('aria-selected', String(li.dataset.tag === this.current));
  }

  /**
   * Lists the option elements.
   * @returns {HTMLElement[]} Options.
   */
  #options() {
    return [...this.list.children];
  }

  /** Opens the list with the current language active. */
  #open() {
    this.list.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.#activate(Math.max(0, this.#options().findIndex((li) => li.dataset.tag === this.current)));
    this.list.focus();
  }

  /**
   * Closes the list.
   * @param {boolean} focusButton Moves the focus back to the button.
   * @returns {void}
   */
  #close(focusButton) {
    if (this.list.hidden) return;
    this.list.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    if (focusButton) this.button.focus();
  }

  /**
   * Marks an option as active (keyboard position).
   * @param {number} index Option index.
   * @returns {void}
   */
  #activate(index) {
    const options = this.#options();
    if (!options.length) return;
    this.active = Math.min(options.length - 1, Math.max(0, index));
    options.forEach((li, i) => li.classList.toggle('active', i === this.active));
    this.list.setAttribute('aria-activedescendant', options[this.active].id);
    options[this.active].scrollIntoView({ block: 'nearest' });
  }

  /**
   * Keyboard handling inside the open list.
   * @param {KeyboardEvent} e Key event.
   * @returns {void}
   */
  #onKey(e) {
    const last = this.#options().length - 1;
    const moves = { ArrowDown: this.active + 1, ArrowUp: this.active - 1, Home: 0, End: last };
    if (e.key in moves) this.#activate(moves[e.key]);
    else if (e.key === 'Enter' || e.key === ' ') this.#choose(this.#options()[this.active]?.dataset.tag);
    else if (e.key === 'Escape') this.#close(true);
    else if (e.key === 'Tab') { this.#close(false); return; }
    else return;
    e.preventDefault();
  }

  /**
   * Chooses a language.
   * @param {string|undefined} tag Language tag.
   * @returns {void}
   */
  #choose(tag) {
    this.#close(true);
    if (!tag || tag === this.current) return;
    this.current = tag;
    this.#updateButton();
    this.dispatchEvent(new CustomEvent('change', { detail: { tag } }));
  }
}

customElements.define('language-menu', LanguageMenu);
