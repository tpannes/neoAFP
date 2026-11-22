/**
 * Keyboard support for tab lists (WAI-ARIA tabs pattern): only the selected tab is in the tab
 * order; Left/Right (Up/Down) move to the previous/next tab and select it, Home/End to the first
 * and last.
 */

/**
 * Adds arrow-key navigation to a tab list.
 * @param {HTMLElement} list Element with role="tablist" whose buttons have role="tab".
 * @returns {void}
 */
export function enableTabKeys(list) {
  list.addEventListener('keydown', (e) => {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const moves = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tabs.length - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next = tabs[(moves[e.key] + tabs.length) % tabs.length];
    next.focus();
    next.click();
  });
}

/**
 * Marks the selected tab and puts only it in the tab order.
 * @param {Iterable<[string, HTMLElement]>} tabs Tab name → button.
 * @param {string} selected Selected tab name.
 * @returns {void}
 */
export function markSelectedTab(tabs, selected) {
  for (const [name, button] of tabs) {
    button.setAttribute('aria-selected', String(name === selected));
    button.tabIndex = name === selected ? 0 : -1;
    button.classList.toggle('active', name === selected);
  }
}
