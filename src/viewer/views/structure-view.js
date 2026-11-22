/**
 * Structure view (user story 2, FR-030–FR-034): the structure of the shown AFP file.
 * - Left: every structured field in a tree (src/lib/modca/tree.js): a Begin field opens a branch
 *   with its triplets, the fields inside and its End field; other fields open to show their
 *   triplets. Branches open and close with a click on the arrow, a double click or the arrow keys.
 *   Each item has an icon for its kind (page, overlay, image, map, descriptor, TLE, NOP …), its
 *   short name, the name it carries and its full name.
 * - Right: the Details panel (field-detail.js) for the selected item and its raw bytes in hex,
 *   with the code page of the hex view's text column (FR-037) and a button that copies the
 *   bytes (of a triplet, or of a whole field) to the clipboard as one hex string.
 * The toolbar closes all branches, switches grouping on and off, finds fields by short name,
 * full name or identifier (next/previous match) and jumps to the field at a byte offset.
 *
 * Grouping (switch in the toolbar, remembered as the `groupStructure` preference, on by
 * default): runs of three or more like items directly after one another — the same field, e.g.
 * TLEs or a document's page groups, or the same triplet — show as one group item ("TLE × 37",
 * tree-groups.js) that opens to the items. Selecting a group shows its first item. Finding,
 * offset jumps and selecting a page (thumbnail clicks) open the group around the item they select.
 *
 * Links (FR-034): `inspectPage(page)` selects a page (thumbnail clicks);
 * "Show on page" emits `showonpage` (detail: { page, highlight }); selecting an item on a page
 * emits `pageselect` (detail: { page }) so the thumbnails mark that page.
 */

import '../components/virtual-list.js';
import '../components/field-detail.js';
import '../components/hex-view.js';
import '../components/codepage-settings.js';
import { t, onLanguageChange, applyTranslations } from '../i18n/i18n.js';
import { icon, iconButton, kindIcon } from '../icons.js';
import { loadPrefs, savePrefs } from '../prefs.js';
import { groupNodes } from '../tree-groups.js';

export class StructureView extends HTMLElement {
  /**
   * Connects the view.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   * @param {HTMLElement} app Application frame (for status messages).
   * @returns {Promise<void>} Resolves when built.
   */
  async attach(client, app) {
    this.client = client;
    this.app = app;
    this.classList.add('structure-view');
    const bar = document.createElement('div');
    bar.className = 'browser-toolbar';
    const findForm = document.createElement('form');
    findForm.className = 'search-box';
    this.findInput = document.createElement('input');
    this.findInput.type = 'search';
    this.findInput.dataset.i18nAttr = 'placeholder:structure.find,aria-label:structure.find';
    this.findInput.addEventListener('input', () => { this.matches = null; this.findCount.textContent = ''; });
    findForm.append(icon('search'), this.findInput);
    findForm.addEventListener('submit', (e) => { e.preventDefault(); this.#find(1); });
    this.findCount = document.createElement('span');
    this.findCount.className = 'table-count';
    this.findCount.setAttribute('role', 'status');
    const prev = iconButton('up', 'search.previous', { iconOnly: true });
    const next = iconButton('down', 'search.next', { iconOnly: true });
    prev.addEventListener('click', () => this.#find(-1));
    next.addEventListener('click', () => this.#find(1));
    const offsetForm = document.createElement('form');
    offsetForm.className = 'offset-jump';
    this.offsetInput = document.createElement('input');
    this.offsetInput.dataset.i18nAttr = 'placeholder:fields.offset,aria-label:fields.offset';
    this.offsetInput.size = 12;
    const go = iconButton('locate', 'fields.go', { iconOnly: true });
    go.type = 'submit';
    offsetForm.append(this.offsetInput, go);
    offsetForm.addEventListener('submit', (e) => { e.preventDefault(); this.#jumpToOffset(); });
    this.collapseButton = iconButton('collapseAll', 'structure.collapseAll', { iconOnly: true });
    this.collapseButton.addEventListener('click', () => this.collapseAll());
    this.grouping = loadPrefs().groupStructure;
    this.groupButton = iconButton('groupItems', 'structure.group', { iconOnly: true, className: 'toggle' });
    this.groupButton.setAttribute('aria-pressed', String(this.grouping));
    this.groupButton.addEventListener('click', () => this.setGrouping(!this.grouping));
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    bar.append(this.collapseButton, this.groupButton, findForm, prev, next, this.findCount, spacer, offsetForm);

    this.tree = document.createElement('virtual-list');
    this.tree.className = 'field-tree';
    this.tree.setAttribute('role', 'tree');
    this.tree.dataset.i18nAttr = 'aria-label:structure.tree';
    this.tree.renderRow = (node, label) => this.#renderNode(node, label);
    this.tree.addEventListener('select', (e) => this.#onSelect(e.detail.item));
    this.tree.addEventListener('activate', (e) => this.tree.toggle(e.detail.item));
    this.detail = document.createElement('field-detail');
    this.detail.addEventListener('showonpage', (e) => this.#showOnPage(e.detail.fieldIndex));
    const hexHead = document.createElement('div');
    hexHead.className = 'hex-head';
    const hexTitle = document.createElement('h4');
    hexTitle.dataset.i18n = 'hex.label';
    this.settings = document.createElement('codepage-settings');
    await this.settings.attach(client, ['text']);
    this.settings.addEventListener('change', () => {
      this.hex.refresh();
      this.dispatchEvent(new CustomEvent('codepagechange', { bubbles: true }));
    });
    this.copyButton = iconButton('copy', 'hex.copy', { iconOnly: true });
    this.copyButton.disabled = true;
    this.copyButton.addEventListener('click', () => this.#copyHex());
    hexHead.append(hexTitle, this.copyButton, this.settings);
    this.hex = document.createElement('hex-view');
    const right = document.createElement('aside');
    right.className = 'structure-detail';
    right.append(this.detail, hexHead, this.hex);
    const body = document.createElement('div');
    body.className = 'structure-body';
    body.append(this.tree, right);
    this.append(bar, body);
    applyTranslations(this);
    onLanguageChange(() => this.tree.refresh());
  }

  /**
   * Shows the structure of a document (loaded when the view is shown).
   * @param {string|null} documentId Document id.
   * @returns {void}
   */
  setDocument(documentId) {
    this.fileId = documentId;
    this.loadedFor = null;
    this.matches = null;
  }

  /**
   * Loads the tree if the document changed since it was last loaded.
   * @returns {Promise<void>} Resolves when the top level is shown.
   */
  async ensureLoaded() {
    if (!this.fileId || this.loadedFor === this.fileId) return;
    const id = this.fileId;
    this.loadedFor = id;
    this.detail.show(null, null, null);
    this.hex.clear();
    this.copyButton.disabled = true;
    const group = (nodes) => (this.grouping ? groupNodes(nodes) : nodes);
    this.tree.loadChildren = async (node) => (node.type === 'group' ? node.members : group(await this.client.call('getTree', id, node.id)));
    const roots = await this.client.call('getTree', id);
    if (id === this.fileId) this.tree.roots = group(roots);
  }

  /**
   * Switches grouping of like items on or off; the tree is built again and the selected item
   * stays selected.
   * @param {boolean} on True to group.
   * @returns {Promise<void>} Resolves when the tree is shown again.
   */
  async setGrouping(on) {
    this.grouping = on;
    savePrefs({ groupStructure: on });
    this.groupButton.setAttribute('aria-pressed', String(on));
    const selected = this.tree.items[this.tree.selectedIndex]?.node;
    this.loadedFor = null;
    await this.ensureLoaded();
    if (!selected) return;
    const target = selected.type === 'group' ? selected.members[0] : selected;
    const ids = await this.client.call('getTreePath', this.fileId, { row: target.row });
    if (target.type === 'triplet') ids.push(target.id);
    await this.#reveal(ids);
  }

  /**
   * Opens the branches above an item, and the groups it lies in, and selects it.
   * @param {string[]} ids Node ids from the top level down to the item (getTreePath).
   * @returns {Promise<boolean>} True if the item was found.
   */
  async #reveal(ids) {
    const rowOf = (id) => this.tree.items.find((r) => r.node.id === id);
    for (const [i, id] of ids.entries()) {
      let row = rowOf(id);
      if (!row) {
        const groupRow = this.tree.items.find((r) => r.node.type === 'group' && r.node.memberIds.has(id));
        if (!groupRow) return false;
        if (!this.tree.expanded.has(groupRow.node.id)) await this.tree.toggle(groupRow.node);
        row = rowOf(id);
        if (!row) return false;
      }
      if (i < ids.length - 1 && !this.tree.expanded.has(id)) await this.tree.toggle(row.node);
    }
    const index = this.tree.items.findIndex((r) => r.node.id === ids[ids.length - 1]);
    if (index >= 0) this.tree.select(index);
    return index >= 0;
  }

  /** Closes every branch; a selected item inside a closed branch passes the selection on to its top-level item. */
  collapseAll() {
    const before = this.tree.items[this.tree.selectedIndex]?.node.id;
    this.tree.collapseAll();
    const after = this.tree.items[this.tree.selectedIndex]?.node;
    if (after && after.id !== before) this.tree.select(this.tree.selectedIndex);
    else this.#keepSelectionInView();
  }

  /** Scrolls the selected item into view after the rows above it changed. */
  #keepSelectionInView() {
    if (this.tree.selectedIndex >= 0) this.tree.mark(this.tree.selectedIndex);
  }

  /**
   * Draws one tree item: icon, short name (or triplet identifier), carried name, full name.
   * @param {object} node Tree node.
   * @param {HTMLElement} label Label element.
   * @returns {void}
   */
  #renderNode(node, label) {
    const short = document.createElement('span');
    short.className = 'node-short mono';
    const triplet = node.type === 'triplet' || node.memberType === 'triplet';
    short.textContent = triplet ? `X'${node.code}'` : node.shortName ?? `X'${node.code}'`;
    const group = node.type === 'group';
    // A group is no item of the file, only a way of showing like items together: icon and bold
    // identifier as for its items, then the count, in a dashed frame with muted text (CSS .node-group).
    const parts = [kindIcon(node.kind), short];
    if (group) {
      const count = document.createElement('span');
      count.className = 'node-count';
      count.textContent = `× ${node.count.toLocaleString()}`;
      parts.push(count);
    }
    if (node.label) {
      const name = document.createElement('span');
      name.className = 'node-name mono';
      name.textContent = node.label;
      parts.push(name);
    }
    const full = document.createElement('span');
    full.className = 'node-full';
    full.textContent = node.fullName ?? (triplet ? t('detail.unknownTriplet') : t('detail.unknownField'));
    parts.push(full);
    label.className = `node-label kind-${node.kind}${group ? ' node-group' : ''}`;
    label.replaceChildren(...parts);
    label.title = group
      ? t('structure.groupTitle', { count: node.count.toLocaleString(), name: `${short.textContent} ${full.textContent}` })
      : `${short.textContent} ${node.label} ${full.textContent}`.replace(/\s+/g, ' ').trim();
  }

  /**
   * Shows the details and bytes of the selected item.
   * @param {object} node Tree node.
   * @returns {Promise<void>} Resolves when shown.
   */
  async #onSelect(selected) {
    // A group shows its first item.
    const node = selected.type === 'group' ? selected.members[0] : selected;
    if (node.pageNumber) this.dispatchEvent(new CustomEvent('pageselect', { detail: { page: node.pageNumber } }));
    const token = (this.selectToken = (this.selectToken ?? 0) + 1);
    this.copyButton.disabled = true;
    const [field, location, path] = await Promise.all([
      this.client.call('getField', this.fileId, node.row),
      this.client.call('locate', this.fileId, node.row),
      this.#pathNames(node),
    ]);
    if (token !== this.selectToken) return;
    this.detail.show(node, field, location, path);
    await this.hex.show(this.client, this.fileId, node.offset, node.length);
    if (token === this.selectToken) this.copyButton.disabled = false;
  }

  /**
   * Copies the raw bytes of the selected item (a triplet, or a whole field) to the clipboard as
   * one hex string, e.g. "0C028BC1C6D7F0F0F0F0F1", and confirms it in the status bar.
   * @returns {Promise<void>} Resolves when copied.
   */
  async #copyHex() {
    const hex = this.hex.hexString();
    if (!hex) return;
    try {
      await navigator.clipboard.writeText(hex);
      this.app.setStatus(t('hex.copied', { count: hex.length / 2 }));
    } catch {
      this.app.setStatus(t('hex.copyFailed'));
    }
  }

  /**
   * Names the items above a node (from the rows of the tree that are open).
   * @param {object} node Tree node.
   * @returns {Promise<string[]>} Names, outermost first.
   */
  async #pathNames(node) {
    const ids = await this.client.call('getTreePath', this.fileId, { row: node.row });
    if (node.type === 'field') ids.pop();
    const byId = new Map(this.tree.items.map((r) => [r.node.id, r.node]));
    return ids.map((id) => byId.get(id)).filter(Boolean).map((n) => [n.shortName, n.label].filter(Boolean).join(' '));
  }

  /**
   * Selects a field: opens the branches above it and selects it.
   * @param {number} row Field row.
   * @returns {Promise<void>} Resolves when selected.
   */
  async selectField(row) {
    await this.ensureLoaded();
    await this.#reveal(await this.client.call('getTreePath', this.fileId, { row }));
  }

  /**
   * Selects a page (thumbnail clicks).
   * @param {number} pageNumber Page number.
   * @returns {Promise<void>} Resolves when the page is selected.
   */
  async inspectPage(pageNumber) {
    await this.ensureLoaded();
    await this.#reveal(await this.client.call('getTreePath', this.fileId, { pageNumber }));
  }

  /**
   * Finds the next or previous field whose short name, full name or identifier contains the
   * text in the find box (from the selected item on, wrapping around).
   * @param {number} direction 1 or −1.
   * @returns {Promise<void>} Resolves when selected.
   */
  async #find(direction) {
    const text = this.findInput.value.trim();
    if (!text || !this.fileId) return;
    if (!this.matches) this.matches = (await this.client.call('getFields', this.fileId, undefined, { text })).map((f) => f.index);
    const m = this.matches;
    if (!m.length) {
      this.findCount.textContent = t('search.none');
      return;
    }
    const current = this.tree.items[this.tree.selectedIndex]?.node.row ?? -1;
    let i = direction > 0 ? m.findIndex((r) => r > current) : m.findLastIndex((r) => r < current);
    if (i < 0) i = direction > 0 ? 0 : m.length - 1;
    this.findCount.textContent = t('search.position', { index: i + 1, count: m.length });
    await this.selectField(m[i]);
  }

  /** Selects the field at the byte offset in the offset box. */
  async #jumpToOffset() {
    const text = this.offsetInput.value.trim();
    const value = /^(0x|x')/i.test(text) ? Number.parseInt(text.replace(/^(0x|x')/i, '').replace(/'$/, ''), 16) : Number(text);
    this.offsetInput.setCustomValidity(Number.isFinite(value) && value >= 0 ? '' : t('fields.offsetInvalid'));
    if (!this.offsetInput.reportValidity() || !this.fileId) return;
    const row = await this.client.call('findFieldAtOffset', this.fileId, value);
    if (row === null) {
      this.app.setStatus(t('fields.offsetNotFound', { offset: value }));
      return;
    }
    await this.selectField(row);
  }

  /**
   * Asks to show the page of a field with the field's object highlighted.
   * @param {number} row Field row.
   * @returns {Promise<void>} Resolves when asked.
   */
  async #showOnPage(row) {
    const { pageNumber, sourceField, textField, dataField } = await this.client.call('locate', this.fileId, row);
    if (!pageNumber) return;
    // A PTX field marks only its own text, not the whole text object.
    const marked = textField ?? dataField ?? sourceField;
    this.dispatchEvent(new CustomEvent('showonpage', { detail: { page: pageNumber, highlight: marked === null ? null : new Set([marked]) } }));
  }
}

customElements.define('structure-view', StructureView);
