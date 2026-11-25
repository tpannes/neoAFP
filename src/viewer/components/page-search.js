/**
 * <page-search>: search in the page text of the shown AFP file (FR-060–FR-063): a search box,
 * the position among the hits ("2 / 7": every occurrence of the search words) and buttons for the
 * previous and next hit; Enter goes to the next hit, Shift+Enter to the previous one. A word
 * matches when it contains the search term (see src/lib/search).
 * The page text index is built in the parser worker in short low-priority slices the first time a
 * search is typed and again after files were added or the text code page changed; meanwhile hits
 * found so far are shown and the box says that indexing is running. For very large files the
 * library stops indexing at a memory limit (T230); the hit count then gets a "*" whose tooltip
 * names the pages searched.
 * The library returns one result per page; the occurrences on it (`marks`) come with the first
 * results and are fetched (resolveSearchHit) for the others when the search gets there or the page
 * is shown (marksOf); the index tells how many there are, so the count is exact. It gets a "+"
 * while indexing may still add hits. After the user scrolled elsewhere (`viewPage`), the next hit is searched from the page shown, the previous
 * one before it.
 * Events: `hit` (detail: { pageNumber, itemIndex, charStart, charEnd }) for the page viewer to
 * show; `clear` when the box was emptied or the query has no hits; `marks` when the occurrences
 * of more pages are known, to draw them.
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
    this.occurrence = 0;
    /** @type {Map<number, object[]>} page → occurrences (marks) of the current query */
    this.marks = new Map();
    this.byPage = new Map();
    this.pendingPages = new Set();
    /** Page the viewer shows (set by the document view). */
    this.viewPage = null;
    this.#showCount();
  }

  /**
   * The occurrences on a page for marking, or null when not known (yet). Unknown occurrences of a
   * page with hits are fetched; a `marks` event follows.
   * @param {number} page Page number.
   * @returns {{itemIndex: number, charStart: number, charEnd: number}[]|null} Occurrences.
   */
  marksOf(page) {
    if (this.marks.has(page)) return this.marks.get(page);
    const position = this.byPage.get(page);
    if (position === undefined || this.pendingPages.has(page)) return null;
    this.pendingPages.add(page);
    const key = this.marksKey;
    this.#resolve(position).then(() => {
      if (this.marksKey === key) this.dispatchEvent(new CustomEvent('marks'));
    }).catch(() => {}).finally(() => this.pendingPages.delete(page));
    return null;
  }

  /**
   * Takes the results of a query: indexes them by page and keeps the occurrences already known.
   * @param {object[]} results Search results.
   * @param {string} key Query and file.
   * @returns {void}
   */
  #setResults(results, key) {
    if (key !== this.marksKey) {
      this.marksKey = key;
      this.marks = new Map();
      this.pendingPages = new Set();
    }
    this.hits = results;
    this.byPage = new Map(results.map((r, i) => [r.location.pageNumber, i]));
    for (const r of results) if (r.resolved !== false) this.#remember(r);
  }

  /**
   * Keeps the occurrences of a resolved result.
   * @param {object} hit Resolved search result.
   * @returns {void}
   */
  #remember(hit) {
    const { location } = hit;
    let marks = location.marks ?? [];
    if (!marks.length && location.itemIndex !== undefined && location.itemIndex !== null) marks = [{ itemIndex: location.itemIndex, charStart: location.charStart, charEnd: location.charEnd }];
    this.marks.set(location.pageNumber, marks);
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
      // Only the shown document counts (it is indexed first; see #index). Once it is complete,
      // its final hits are fetched at once.
      const complete = p.done >= p.total || Boolean(p.completeFiles?.includes(this.fileId));
      if (complete && this.indexing && this.input.value.trim()) {
        // The "+" stays until the final hits are there; fetched once per document.
        if (this.finalFor !== this.fileId) {
          this.finalFor = this.fileId;
          this.run(true);
        }
        return;
      }
      this.indexing = !complete;
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
    this.finalFor = null;
    this.#setResults([], '');
    this.position = -1;
    this.viewPage = null;
    if (this.input?.value.trim()) this.run();
    else this.#showCount();
  }

  /** Builds the index again (after files were added or the text code page changed). */
  invalidate() {
    this.finalFor = null;
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
          const { done } = await this.client.request({ method: 'buildSearchIndex', args: [{ budgetMs: 100, firstFileId: this.fileId }], priority: 'low' });
          if (done) break;
        }
      }
    } finally {
      this.building = false;
      // With a query the new results set the state; until then the old count keeps its "+".
      if (this.input.value.trim()) this.run(true);
      else this.indexing = false;
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
      this.#setResults([], '');
      this.position = -1;
      this.#showCount();
      this.dispatchEvent(new CustomEvent('clear'));
      return;
    }
    if (!this.started) this.#index();
    const started = Date.now();
    const { results, indexing, limited } = await this.client.request({ method: 'search', args: [{ text, fileId: this.fileId }, 10000], priority: 'high' });
    this.lastDuration = Date.now() - started;
    if (token !== this.token) return;
    const current = this.hits[this.position];
    this.#setResults(results, `${this.fileId}\n${text}`);
    this.limited = limited;
    this.indexing = indexing && !limited; // the shown document only (see Workspace.search)
    if (keep && current) {
      this.position = results.findIndex((r) => r.location.pageNumber === current.location.pageNumber);
      this.#showCount();
    } else {
      this.position = -1;
      this.occurrence = 0;
      this.#showCount();
      if (results.length) this.step(1);
      else this.dispatchEvent(new CustomEvent('clear'));
    }
  }

  /**
   * The occurrences of a result: its marks once known, else the count from the index.
   * @param {object} hit Search result.
   * @returns {number} Count, at least 1.
   */
  #occurrences(hit) {
    return Math.max(1, this.marks.get(hit?.location.pageNumber)?.length ?? hit?.occurrences ?? 1);
  }

  /**
   * Fetches the occurrences of a result that came without them (T230).
   * @param {number} position Index in `hits`.
   * @returns {Promise<object>} The resolved result.
   */
  async #resolve(position) {
    const hit = this.hits[position];
    if (this.marks.has(hit.location.pageNumber)) return hit;
    const key = this.marksKey;
    const full = await this.client.request({ method: 'resolveSearchHit', args: [hit], priority: 'high' });
    if (this.marksKey === key) this.#remember(full);
    return full;
  }

  /**
   * Goes to the next or previous occurrence, across pages (wrapping around). When the viewer shows
   * another page than the current hit's (the user scrolled), it goes to the first occurrence from
   * that page on (or the last one before it).
   * @param {number} delta 1 or −1.
   * @returns {Promise<void>} Resolves when the hit is shown.
   */
  async step(delta) {
    if (!this.hits.length) {
      if (this.input.value.trim()) this.run();
      return;
    }
    const hits = this.hits;
    const token = (this.stepToken = (this.stepToken ?? 0) + 1);
    const here = this.viewPage;
    const at = hits[this.position]?.location.pageNumber;
    const inPage = this.occurrence + delta;
    if (this.position < 0 || (here && here !== at)) {
      const from = here ?? 1;
      let i = delta > 0 ? hits.findIndex((h) => h.location.pageNumber >= from) : hits.findLastIndex((h) => h.location.pageNumber <= from);
      if (i < 0) i = delta > 0 ? 0 : hits.length - 1;
      if (!(await this.#enter(i, delta < 0, token, hits))) return;
    } else if (inPage >= 0 && inPage < this.#occurrences(hits[this.position])) {
      this.occurrence = inPage;
    } else if (!(await this.#enter((this.position + delta + hits.length) % hits.length, delta < 0, token, hits))) {
      return;
    }
    this.#showCount();
    this.dispatchEvent(new CustomEvent('hit', { detail: this.#detail(hits[this.position], this.occurrence) }));
  }

  /**
   * Makes a page with hits current: its first occurrence, or its last one (going back). Shows the
   * page at once when its occurrences must be fetched first.
   * @param {number} position Index in `hits`.
   * @param {boolean} last Start at the last occurrence.
   * @param {number} token Step token (a newer step wins).
   * @param {object[]} hits The hits the step started with.
   * @returns {Promise<boolean>} False when the step was overtaken or failed.
   */
  async #enter(position, last, token, hits) {
    this.position = position;
    this.occurrence = 0;
    this.#showCount();
    const hit = hits[position];
    if (!this.marks.has(hit.location.pageNumber)) {
      this.dispatchEvent(new CustomEvent('hit', { detail: hit.location }));
      try {
        await this.#resolve(position);
      } catch {
        return false;
      }
      if (token !== this.stepToken || this.hits !== hits) return false;
    }
    if (last) this.occurrence = this.#occurrences(hit) - 1;
    return true;
  }

  /**
   * The event detail for one occurrence: the page and the glyph run range of the occurrence.
   * @param {object} hit Search result.
   * @param {number} occurrence Index among its marks.
   * @returns {object} Detail.
   */
  #detail(hit, occurrence) {
    const { location } = hit;
    const mark = this.marks.get(location.pageNumber)?.[occurrence];
    return mark ? { ...location, itemIndex: mark.itemIndex, charStart: mark.charStart, charEnd: mark.charEnd } : location;
  }

  /** Shows the hit position, "no hits" or the indexing state. */
  #showCount() {
    if (!this.count) return;
    const text = this.input.value.trim();
    const n = this.hits.length;
    let label = '';
    if (text && n) {
      // Occurrences before the current one, and of all pages; "+" while indexing may add more.
      let before = 0;
      let count = 0;
      this.hits.forEach((hit, i) => {
        const k = this.#occurrences(hit);
        if (i < this.position) before += k;
        count += k;
      });
      const index = this.position < 0 ? 0 : before + this.occurrence + 1;
      label = t('search.position', { index, count: this.indexing ? `${count}+` : count });
    }
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
