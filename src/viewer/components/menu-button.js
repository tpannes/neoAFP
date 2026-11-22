/**
 * <menu-button>: a button that opens a short list of actions (used for the exports: page as PNG,
 * TIFF or text; tables as JSON or CSV). Escape or a click elsewhere closes it; the arrow keys move
 * between the actions.
 * Call `setup(iconName, labelKey, actions, options)` with actions `{ labelKey, run, icon? }`; an
 * action with an icon name shows that icon before its label.
 */

import { applyTranslations } from '../i18n/i18n.js';
import { icon, iconButton } from '../icons.js';

export class MenuButton extends HTMLElement {
  /**
   * Builds the button and its menu.
   * @param {string} iconName Icon of the button.
   * @param {string} labelKey Locale key of the button label.
   * @param {{labelKey: string, run: () => void, icon?: string}[]} actions Menu entries (icon: name in icons.js).
   * @param {{iconOnly?: boolean}} [options] iconOnly: show only the icon (the label is the tooltip).
   * @returns {void}
   */
  setup(iconName, labelKey, actions, { iconOnly = false } = {}) {
    this.className = 'menu-button';
    this.button = iconButton(iconName, labelKey, { iconOnly });
    this.button.setAttribute('aria-haspopup', 'menu');
    this.button.setAttribute('aria-expanded', 'false');
    this.menu = document.createElement('div');
    this.menu.className = 'menu-popup';
    this.menu.setAttribute('role', 'menu');
    this.menu.hidden = true;
    for (const action of actions) {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      const label = document.createElement('span');
      label.dataset.i18n = action.labelKey;
      if (action.icon) item.append(icon(action.icon));
      item.append(label);
      item.addEventListener('click', () => {
        this.close();
        action.run();
      });
      this.menu.append(item);
    }
    this.button.addEventListener('click', () => (this.menu.hidden ? this.open() : this.close()));
    this.menu.addEventListener('keydown', (e) => {
      const items = [...this.menu.querySelectorAll('button')];
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
      else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
      else if (e.key === 'Escape') {
        this.close();
        this.button.focus();
      } else return;
      e.preventDefault();
    });
    document.addEventListener('pointerdown', (e) => { if (!this.contains(e.target)) this.close(); });
    this.replaceChildren(this.button, this.menu);
    applyTranslations(this);
  }

  /** Opens the menu and focuses its first action. */
  open() {
    this.menu.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.menu.querySelector('button')?.focus();
  }

  /** Closes the menu. */
  close() {
    if (!this.menu || this.menu.hidden) return;
    this.menu.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
  }

  /**
   * Enables or disables the button.
   * @param {boolean} disabled True to disable.
   */
  set disabled(disabled) {
    this.button.disabled = disabled;
  }
}

customElements.define('menu-button', MenuButton);
