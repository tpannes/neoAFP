/**
 * <page-search>: search in the page text of the shown AFP file (FR-060–FR-063): a search box,
 * the position among the hits ("2 / 7", one hit per page) and buttons for the previous and next
 * hit; Enter goes to the next hit, Shift+Enter to the previous one. Matching is fuzzy (see
 * src/lib/search). The page text index is built in the parser worker in short low-priority slices
 * the first time a search is typed and again after files were added or the text code page changed;
 * meanwhile hits found so far are shown and the box says that indexing is running.
 * For very large files the library stops indexing at a memory limit (T230); the hit count then
 * gets a "*" whose tooltip names the pages searched. Hits beyond the first few come without the
 * matched word's position; it is fetched (resolveSearchHit) when the hit is shown.
 * Event: `hit` (detail: { pageNumber, itemIndex, charStart, charEnd }) for the page viewer to show.
 */

import { t, onLanguageChange, applyTranslations } from '../i18n/i18n.js';
import { iconButton, icon } from '../icons.js';

export class PageSearch extends HTMLElement {
  /** Builds the controls. */
  connectedCallback() {
    if (this.input) return;
    this.className = 'page-search';
    this.setAttribute('role', 'search');
    const box = document.createElement('label');
    box.className = 'search-box';
    this.input = document.createElement('input');
    this.input.type = 'search';
    this.input.dataset.i18nAttr = 'placeholder:search.placeholder,aria-label:search.placeholder';
    box.append(icon('search'), this.input);
    this.count = document.createElement('span');
    this.count.className = 'search-count';
    this.count.setAttribute('aria-live', 'polite');
    this.prev = iconButton('up', 'search.previous', { iconOnly: true });
    this.next = iconButton('down', 'search.next', { iconOnly: true });
    this.prev.addEventListener('click', () => this.step(-1));
    this.next.addEventListener('click', () => this.step(1));
    let timer = null;
    this.input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => this.run(), 250); });
    this.input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      this.step(e.shiftKey ? -1 : 1);
    });
    this.append(box, this.count, this.prev, this.next);
    applyTranslations(this);
    onLanguageChange(() => this.#showCount());
    this.hits = [];
    this.position = -1;
    this.#showCount();
  }

  /**
   * Connects the search to the worker.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   * @returns {void}
   */
  attach(client) {
    this.client = client;
    client.on('progress', (p) => {
      if (p.phase !== 'search') return;
      this.indexing = p.done < p.total;
      // Show new hits now and then while the index grows; less often when searching takes long
      // (hundreds of thousands of pages), so the searches do not slow indexing down.
      const pause = Math.max(1500, 10 * (this.lastDuration ?? 0));
      if (this.input.value.trim() && Date.now() - (this.lastRun ?? 0) > pause) this.run(true);
      this.#showCount();
    });
  }

  /**
   * Sets the file to search in and clears the hits.
   * @param {string|null} fileId Document id.
   * @returns {void}
   */
  setFile(fileId) {
    this.fileId = fileId;
    this.hits = [];
    this.position = -1;
    if (this.input?.value.trim()) this.run();
    else this.#showCount();
  }

  /** Builds the index again (after files were added or the text code page changed). */
  invalidate() {
    if (this.started) this.#index();
    if (this.input?.value.trim()) this.run(true);
  }

  /** Builds the index in slices until it is complete; repeated calls join the running loop. */
  async #index() {
    this.started = true;
    this.pending = true;
    if (this.building) return;
    this.building = true;
    try {
      while (this.pending) {
        this.pending = false;
        for (;;) {
          const { done } = await this.client.request({ method: 'buildSearchIndex', args: [{ budgetMs: 100 }], priority: 'low' });
          if (done) break;
        }
      }
    } finally {
      this.building = false;
      this.indexing = false;
      if (this.input.value.trim()) this.run(true);
    }
  }

  /**
   * Runs the current query.
   * @param {boolean} [keep] Keep the current hit (when hits are added while indexing).
   * @returns {Promise<void>} Resolves when the hits are known.
   */
  async run(keep = false) {
    const text = this.input.value.trim();
    this.lastRun = Date.now();
    const token = (this.token = (this.token ?? 0) + 1);
    if (!text || !this.fileId) {
      this.hits = [];
      this.position = -1;
      this.#showCount();
      return;
    }
    if (!this.started) this.#index();
    const started = Date.now();
    const { results, indexing, limited } = await this.client.request({ method: 'search', args: [{ text, fileId: this.fileId }, 10000], priority: 'high' });
    this.lastDuration = Date.now() - started;
    if (token !== this.token) return;
    const current = this.hits[this.position];
    this.hits = results;
    this.limited = limited;
    this.indexing = (indexing || this.building) && !limited;
    if (keep && current) {
      this.position = results.findIndex((r) => r.location.pageNumber === current.location.pageNumber);
      this.#showCount();
    } else {
      this.position = -1;
      this.#showCount();
      if (results.length) this.step(1);
    }
  }

  /**
   * Goes to the next or previous hit (wrapping around).
   * @param {number} delta 1 or −1.
   * @returns {void}
   */
  step(delta) {
    if (!this.hits.length) {
      if (this.input.value.trim()) this.run();
      return;
    }
    this.position = (this.position + delta + this.hits.length) % this.hits.length;
    this.#showCount();
    const position = this.position;
    const hits = this.hits;
    const hit = hits[position];
    if (hit.resolved === false) {
      // Only the first results come with the matched word's position (T230): fetch it now.
      this.dispatchEvent(new CustomEvent('hit', { detail: hit.location }));
      this.client.request({ method: 'resolveSearchHit', args: [hit], priority: 'high' }).then((full) => {
        hits[position] = full;
        if (this.hits === hits && this.position === position) this.dispatchEvent(new CustomEvent('hit', { detail: full.location }));
      }).catch(() => {});
      return;
    }
    this.dispatchEvent(new CustomEvent('hit', { detail: hit.location }));
  }

  /** Shows the hit position, "no hits" or the indexing state. */
  #showCount() {
    if (!this.count) return;
    const text = this.input.value.trim();
    const n = this.hits.length;
    let label = '';
    if (text && n) label = t('search.position', { index: this.position + 1, count: n });
    else if (text && this.indexing) label = t('search.indexingShort');
    else if (text) label = t('search.none');
    // Indexing stopped at the memory limit: mark the count, the tooltip says which pages.
    if (text && this.limited) label = `${label} *`;
    this.count.textContent = label;
    this.count.title = this.limited ? t('search.limited', { pages: this.limited.pages, total: this.limited.totalPages }) : '';
    this.count.classList.toggle('limited', Boolean(this.limited && text));
    this.count.classList.toggle('busy', Boolean(this.indexing && text));
    this.prev.disabled = this.next.disabled = n === 0;
  }
}

customElements.define('page-search', PageSearch);
