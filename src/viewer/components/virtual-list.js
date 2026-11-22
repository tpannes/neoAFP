/**
 * <virtual-list>: a scrolling list or tree that creates elements only for the visible rows, so
 * lists with millions of entries (structured fields, diagnostics, resources) stay fast (FR-082,
 * research R16).
 *
 * List mode: set `items` (array) and `renderRow(item, element)`.
 * Tree mode: set `roots` (array of nodes) and `loadChildren(node)` (may be async); nodes need
 * `id` and `hasChildren`. Rows are fixed height (CSS variable --row-height).
 * Events: `select` (detail: { item, index }) and `activate` (Enter or double click).
 * Accessibility: the list is one focusable widget; the selected row is announced through
 * aria-activedescendant. Rows are `option`s (or the role given by `data-row-role`, e.g.
 * `listitem` for rows that contain buttons); in tree mode they are `treeitem`s with level and
 * expanded state.
 */

let listCounter = 0;

const DEFAULT_ROW_HEIGHT = 24;

/** Highest scroll area in pixels; taller lists are squeezed into it (see #viewTop). */
const MAX_SCROLL = 8_000_000;

export class VirtualList extends HTMLElement {
  /** Creates the list; rows appear once items or roots are set. */
  constructor() {
    super();
    /** @type {any[]} visible rows (list items, or tree entries {node, depth}) */
    this.rows = [];
    this.selectedIndex = -1;
    this.renderRow = (item, el) => { el.textContent = String(item?.label ?? item); };
    this.loadChildren = null;
    this.expanded = new Set();
    this.childCache = new Map();
    this.pool = [];
    this.tree = false;
    this.rowHeight = DEFAULT_ROW_HEIGHT;
  }

  /** Builds the inner structure when the element is added to the page. */
  connectedCallback() {
    if (this.spacer) return;
    this.tabIndex = 0;
    this.setAttribute('role', this.getAttribute('role') ?? 'listbox');
    this.listId = `vl${++listCounter}`;
    this.spacer = document.createElement('div');
    this.spacer.className = 'vl-spacer';
    this.spacer.setAttribute('role', 'presentation');
    this.append(this.spacer);
    const css = getComputedStyle(this).getPropertyValue('--row-height');
    this.rowHeight = parseInt(css, 10) || DEFAULT_ROW_HEIGHT;
    this.addEventListener('scroll', () => this.#onScroll(), { passive: true });
    this.addEventListener('wheel', (e) => this.#onWheel(e), { passive: false });
    this.addEventListener('keydown', (e) => this.#onKey(e));
    this.addEventListener('click', (e) => this.#onClick(e));
    this.addEventListener('dblclick', () => this.#activate());
    new ResizeObserver(() => this.#render()).observe(this);
    this.#render();
  }

  /**
   * Sets the items of a flat list.
   * @param {any[]} items Items in display order.
   */
  set items(items) {
    this.tree = false;
    this.rows = items;
    this.selectedIndex = Math.min(this.selectedIndex, items.length - 1);
    this.#render();
  }

  /** @returns {any[]} Current rows. */
  get items() {
    return this.rows;
  }

  /**
   * Sets the root nodes of a tree.
   * @param {{id: string, hasChildren: boolean}[]} roots Root nodes.
   */
  set roots(roots) {
    this.tree = true;
    this.rootNodes = roots;
    this.expanded.clear();
    this.childCache.clear();
    this.#rebuildTree();
  }

  /**
   * Recomputes the visible tree rows from roots and expanded nodes. The selection stays on the
   * same node; if that node is now inside a closed branch, its nearest visible ancestor is
   * selected instead (without a `select` event).
   */
  #rebuildTree() {
    const keep = this.#selectedPath();
    const rows = [];
    const visit = (nodes, depth) => {
      for (const node of nodes) {
        rows.push({ node, depth });
        if (this.expanded.has(node.id) && this.childCache.has(node.id)) visit(this.childCache.get(node.id), depth + 1);
      }
    };
    visit(this.rootNodes ?? [], 0);
    this.rows = rows;
    if (keep.length) {
      const at = new Map(rows.map((r, i) => [r.node.id, i]));
      const id = keep.find((k) => at.has(k));
      this.selectedIndex = id === undefined ? -1 : at.get(id);
    }
    this.#render();
  }

  /**
   * Lists the ids of the selected tree node and its ancestors, the node first.
   * @returns {string[]} Node ids (empty without a selection).
   */
  #selectedPath() {
    const i = this.selectedIndex;
    if (!this.tree || i < 0 || i >= this.rows.length) return [];
    const ids = [this.rows[i].node.id];
    let depth = this.rows[i].depth;
    for (let r = i - 1; r >= 0 && depth > 0; r--) {
      if (this.rows[r].depth < depth) {
        ids.push(this.rows[r].node.id);
        depth = this.rows[r].depth;
      }
    }
    return ids;
  }

  /**
   * Closes every node, or every node in the branch of one node (loaded children are kept).
   * @param {object} [node] Node whose branch to close; omitted for the whole tree.
   * @returns {void}
   */
  collapseAll(node) {
    if (!node) this.expanded.clear();
    else {
      const close = (id) => {
        this.expanded.delete(id);
        for (const child of this.childCache.get(id) ?? []) close(child.id);
      };
      close(node.id);
    }
    this.#rebuildTree();
  }

  /**
   * Expands or collapses a tree node, loading its children if needed.
   * @param {object} node Tree node.
   * @returns {Promise<void>} Resolves when the tree is updated.
   */
  async toggle(node) {
    if (!node.hasChildren) return;
    if (this.expanded.has(node.id)) {
      this.expanded.delete(node.id);
    } else {
      if (!this.childCache.has(node.id)) this.childCache.set(node.id, await this.loadChildren(node));
      this.expanded.add(node.id);
    }
    this.#rebuildTree();
  }

  /**
   * Expands the nodes of a path and selects its last node (tree mode).
   * @param {string[]} ids Node ids from a root down to the node to select.
   * @returns {Promise<boolean>} True if the last node was found.
   */
  async reveal(ids) {
    for (const id of ids.slice(0, -1)) {
      const row = this.rows.find((r) => r.node.id === id);
      if (!row) return false;
      if (!this.expanded.has(id)) await this.toggle(row.node);
    }
    const index = this.rows.findIndex((r) => r.node.id === ids[ids.length - 1]);
    if (index >= 0) this.select(index);
    return index >= 0;
  }

  /**
   * Marks a row as selected and scrolls to it without firing `select` (for links from elsewhere).
   * @param {number} index Row index.
   * @returns {void}
   */
  mark(index) {
    if (index < 0 || index >= this.rows.length) return;
    this.selectedIndex = index;
    this.#setTop(index * this.rowHeight - this.clientHeight / 3);
    this.#render();
  }

  /**
   * The position of the window in the list (pixels). Equal to scrollTop, unless the list is
   * taller than MAX_SCROLL (hundreds of thousands of thumbnails, T230): browsers cap element
   * heights at about 33 million pixels, so the scroll area is then MAX_SCROLL high and stands for
   * the whole list (scrollTop = position / squeeze); the exact position is `virtualTop`.
   * @returns {number} Pixels.
   */
  #viewTop() {
    return this.squeeze > 1 ? this.virtualTop : this.scrollTop;
  }

  /**
   * Scrolls to a position in the list.
   * @param {number} top Pixels.
   * @returns {void}
   */
  #setTop(top) {
    const max = Math.max(0, this.rows.length * this.rowHeight - this.clientHeight);
    const value = Math.max(0, Math.min(top, max));
    if (this.squeeze > 1) {
      this.virtualTop = value;
      this.scrollTop = value / this.squeeze;
      this.expectedTop = this.scrollTop;
    } else {
      this.scrollTop = value;
    }
  }

  /** Follows scrolling; in a squeezed list the scroll bar's position stands for the list position. */
  #onScroll() {
    if (this.squeeze > 1 && Math.abs(this.scrollTop - (this.expectedTop ?? NaN)) > 0.5) this.virtualTop = this.scrollTop * this.squeeze;
    this.expectedTop = NaN;
    this.#render();
  }

  /**
   * Mouse wheel in a squeezed list: native scrolling would move `squeeze` times too far.
   * @param {WheelEvent} e Event.
   * @returns {void}
   */
  #onWheel(e) {
    if (!(this.squeeze > 1) || e.ctrlKey || !e.deltaY) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? this.rowHeight : e.deltaMode === 2 ? this.clientHeight : 1;
    this.#setTop(this.virtualTop + e.deltaY * unit);
    this.#render();
  }

  /**
   * Scrolls a row to the top of the window unless it is already in view.
   * @param {number} index Row index.
   * @returns {void}
   */
  showIndex(index) {
    const top = index * this.rowHeight;
    const viewTop = this.#viewTop();
    if (top < viewTop || top > viewTop + this.clientHeight - this.rowHeight) {
      this.#setTop(top);
      this.#render();
    }
  }

  /** Scrolls to the first row. */
  scrollToStart() {
    this.#setTop(0);
    this.#render();
  }

  /** Redraws the visible rows (after rows were loaded or changed in place). */
  refresh() {
    this.#render();
  }

  /** Draws the rows in view, reusing row elements. */
  #render() {
    if (!this.spacer) return;
    if (this.selectedIndex >= 0 && this.selectedIndex < this.rows.length) this.setAttribute('aria-activedescendant', `${this.listId}-${this.selectedIndex}`);
    else this.removeAttribute('aria-activedescendant');
    const total = this.rows.length;
    const height = total * this.rowHeight;
    const view = this.clientHeight || 400;
    const squeezed = height > MAX_SCROLL;
    if (squeezed && !(this.squeeze > 1)) this.virtualTop = this.scrollTop;
    this.squeeze = squeezed ? Math.max(1, (height - view) / (MAX_SCROLL - view)) : 1;
    if (squeezed) this.virtualTop = Math.max(0, Math.min(this.virtualTop, height - view));
    this.spacer.style.height = `${squeezed ? MAX_SCROLL : height}px`;
    const viewTop = this.#viewTop();
    const first = Math.max(0, Math.floor(viewTop / this.rowHeight) - 2);
    const count = Math.ceil((this.clientHeight || 400) / this.rowHeight) + 4;
    const last = Math.min(total, first + count);
    while (this.pool.length < last - first) {
      const el = document.createElement('div');
      el.className = 'vl-row';
      el.setAttribute('role', 'option');
      this.spacer.append(el);
      this.pool.push(el);
    }
    this.pool.forEach((el, i) => {
      const index = first + i;
      if (index >= last) {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.dataset.index = String(index);
      el.id = `${this.listId}-${index}`;
      el.style.top = `${index * this.rowHeight - viewTop + this.scrollTop}px`;
      el.classList.toggle('selected', index === this.selectedIndex);
      el.setAttribute('aria-selected', String(index === this.selectedIndex));
      const row = this.rows[index];
      el.setAttribute('role', this.tree ? 'treeitem' : this.dataset.rowRole ?? 'option');
      if (this.tree) {
        el.setAttribute('aria-level', String(row.depth + 1));
        if (row.node.hasChildren) el.setAttribute('aria-expanded', String(this.expanded.has(row.node.id)));
        else el.removeAttribute('aria-expanded');
        el.replaceChildren();
        el.style.paddingLeft = `${8 + row.depth * 16}px`;
        const toggle = document.createElement('span');
        toggle.className = 'vl-toggle';
        toggle.textContent = row.node.hasChildren ? (this.expanded.has(row.node.id) ? '▾' : '▸') : '';
        const label = document.createElement('span');
        el.append(toggle, label);
        this.renderRow(row.node, label);
      } else {
        this.renderRow(row, el);
      }
    });
  }

  /**
   * Selects a row and scrolls it into view.
   * @param {number} index Row index.
   * @returns {void}
   */
  select(index) {
    if (index < 0 || index >= this.rows.length) return;
    this.selectedIndex = index;
    const top = index * this.rowHeight;
    const viewTop = this.#viewTop();
    if (top < viewTop) this.#setTop(top);
    else if (top + this.rowHeight > viewTop + this.clientHeight) this.#setTop(top + this.rowHeight - this.clientHeight);
    this.#render();
    const item = this.tree ? this.rows[index].node : this.rows[index];
    this.dispatchEvent(new CustomEvent('select', { detail: { item, index } }));
  }

  /** Fires the activate event for the selected row. */
  #activate() {
    if (this.selectedIndex < 0) return;
    const item = this.tree ? this.rows[this.selectedIndex].node : this.rows[this.selectedIndex];
    this.dispatchEvent(new CustomEvent('activate', { detail: { item, index: this.selectedIndex } }));
  }

  /**
   * Handles clicks on rows and tree toggles.
   * @param {MouseEvent} e Click event.
   * @returns {void}
   */
  #onClick(e) {
    const rowEl = e.target.closest('.vl-row');
    if (!rowEl) return;
    const index = Number(rowEl.dataset.index);
    if (this.tree && e.target.classList.contains('vl-toggle')) this.toggle(this.rows[index].node);
    this.select(index);
  }

  /**
   * Keyboard navigation: arrows, Home/End, Page Up/Down, Enter, and Left/Right in trees.
   * @param {KeyboardEvent} e Key event.
   * @returns {void}
   */
  #onKey(e) {
    const page = Math.max(1, Math.floor(this.clientHeight / this.rowHeight) - 1);
    const moves = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page };
    if (e.key in moves) this.select(Math.min(this.rows.length - 1, Math.max(0, this.selectedIndex + moves[e.key])));
    else if (e.key === 'Home') this.select(0);
    else if (e.key === 'End') this.select(this.rows.length - 1);
    else if (e.key === 'Enter') this.#activate();
    else if (this.tree && (e.key === 'ArrowRight' || e.key === 'ArrowLeft') && this.selectedIndex >= 0) {
      const { node } = this.rows[this.selectedIndex];
      if ((e.key === 'ArrowRight') !== this.expanded.has(node.id)) this.toggle(node);
    } else return;
    e.preventDefault();
  }
}

customElements.define('virtual-list', VirtualList);
