/**
 * <details-panel>: the Details panel on the right of the page viewer (FR-096, FR-097), with two
 * tabs:
 * - File: name, path, size and record format; the documents in the file, number of page groups,
 *   pages, structured fields, TLEs, NOPs (and ISIS tagging NOPs) and inline resources; the form
 *   definition (with a choice when several apply, see the edge case "Several form definitions
 *   available"); the print job (sheets, also as printed with copies; medium map changes and the
 *   maps used; color or black and white), page sizes and orientations with their share, the
 *   resources used (fonts, overlays, page segments, objects: inline, external, missing) and the
 *   code pages and double-byte fonts of the text — these come from getFileStatistics, which
 *   reads the whole file and arrives later ("being determined" until then); missing resources
 *   with "Add files"; the number of messages with a link to the Log Viewer.
 * - Page: number and name, page group, size and resolution, sheet and side, the position on the
 *   sheet when several pages share a side (N-up), a warning when content reaches beyond the
 *   page (or the placed page beyond the paper), print information (duplex, paper tray, output
 *   tray, paper type, medium map, copies, finishing), fonts, overlays and page segments
 *   included, objects by kind (its TLEs are not shown: the TLE view lists them), missing
 *   resources and the messages of this page (by byte offset) with a link that opens the Log
 *   Viewer showing only them.
 * The page tab follows the current page with a short delay while scrolling.
 * Events: `formdefchange`, `openlog`.
 */

import { t, onLanguageChange, applyTranslations } from '../i18n/i18n.js';
import { enableTabKeys, markSelectedTab } from './tablist.js';
import { fileSizeText } from '../render/resource-thumbs.js';
import { pickFiles } from '../file-open.js';
import { iconButton } from '../icons.js';

/** Delay before the page tab follows the current page while scrolling (ms). */
const FOLLOW_DELAY = 150;

/**
 * Formats a number in the interface language.
 * @param {number} value Number.
 * @param {number} [digits] Maximum fraction digits.
 * @returns {string} Text.
 */
function num(value, digits = 1) {
  return value.toLocaleString(document.documentElement.lang || undefined, { maximumFractionDigits: digits });
}

/**
 * Converts page units (1/1440 inch) to millimeters text.
 * @param {number} units Page units.
 * @returns {string} Millimeters.
 */
const mmText = (units) => num(units / 1440 * 25.4);

/**
 * Creates an element with text.
 * @param {string} tag Tag name.
 * @param {string} [text] Text.
 * @param {string} [className] Class.
 * @returns {HTMLElement} Element.
 */
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined && text !== null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

/**
 * Builds a titled section with name/value rows; rows with an empty value show "–". A row may
 * name a third locale key: an explanation shown as the tooltip of its name (dotted underline).
 * @param {string} titleKey Locale key of the title.
 * @param {[string, string|number|Node|null, string?][]} rows Locale key of the name → value
 *   (→ locale key of the explanation).
 * @returns {HTMLElement} Section.
 */
function section(titleKey, rows) {
  const box = el('section', undefined, 'detail-card');
  box.append(el('h3', t(titleKey)));
  const dl = el('dl', undefined, 'detail-facts');
  for (const [key, value, hintKey] of rows) {
    const dd = el('dd');
    if (value instanceof Node) dd.append(value);
    else dd.textContent = value === null || value === undefined || value === '' ? '–' : String(value);
    const dt = el('dt', t(key));
    if (hintKey) {
      dt.title = t(hintKey);
      dt.classList.add('has-hint');
    }
    dl.append(dt, dd);
  }
  box.append(dl);
  return box;
}

/**
 * Builds a titled list of short texts (fonts, overlays …); empty lists show "none".
 * @param {string} titleKey Locale key of the title.
 * @param {string[]} items Texts.
 * @returns {HTMLElement} Section.
 */
function listSection(titleKey, items) {
  const box = el('section', undefined, 'detail-card');
  box.append(el('h3', `${t(titleKey)} (${items.length})`));
  if (!items.length) {
    box.append(el('p', t('details.none'), 'detail-none'));
    return box;
  }
  const ul = el('ul', undefined, 'detail-list');
  for (const item of items) ul.append(el('li', item, 'mono'));
  box.append(ul);
  return box;
}

export class DetailsPanel extends HTMLElement {
  /** Builds the tabs. */
  connectedCallback() {
    if (this.tabs) return;
    this.className = 'details-panel';
    this.setAttribute('role', 'complementary');
    this.dataset.i18nAttr = 'aria-label:details.title';
    // Header band: the tabs, and at the right the button that hides the panel (afp-viewer.js).
    this.header = el('div', undefined, 'details-tabs');
    const header = el('div', undefined, 'details-tablist');
    header.setAttribute('role', 'tablist');
    enableTabKeys(header);
    this.header.append(header);
    this.tabs = new Map();
    this.panes = new Map();
    for (const tab of ['file', 'page']) {
      const b = el('button');
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.dataset.i18n = `details.tab.${tab}`;
      b.addEventListener('click', () => this.showTab(tab));
      this.tabs.set(tab, b);
      header.append(b);
      const pane = el('div', undefined, 'details-pane');
      pane.setAttribute('role', 'tabpanel');
      this.panes.set(tab, pane);
    }
    this.append(this.header, ...this.panes.values());
    applyTranslations(this);
    this.showTab('file');
    onLanguageChange(() => this.#render());
    this.#render();
  }

  /**
   * Connects the panel.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   * @param {HTMLElement} app Application frame (for opening files).
   * @returns {void}
   */
  attach(client, app) {
    this.client = client;
    this.app = app;
    client.on('diagnostic', ({ diagnostic }) => {
      if (diagnostic.fileId !== this.documentId) return;
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => this.refresh(), 500);
    });
  }

  /**
   * Shows a tab.
   * @param {'file'|'page'} tab Tab.
   * @returns {void}
   */
  showTab(tab) {
    this.tab = tab;
    markSelectedTab(this.tabs, tab);
    for (const [name, pane] of this.panes) pane.hidden = name !== tab;
  }

  /**
   * Shows a document (null: no file open).
   * @param {string|null} documentId Document id.
   * @returns {Promise<void>} Resolves when the file tab is filled.
   */
  async setDocument(documentId) {
    this.documentId = documentId;
    this.file = null;
    this.stats = null;
    this.messages = [];
    this.pageInfo = null;
    this.page = null;
    this.#render();
    await this.refresh();
  }

  /** Reads the file details again (after files were added or problems were found). */
  async refresh() {
    const id = this.documentId;
    if (!id) return;
    // Low priority: the page comes first. The page's TLEs come with getPageDetails, so the
    // whole TLE table (hundreds of thousands of rows in mass output) is never loaded here (T230).
    const [file, messages] = await Promise.all([
      this.client.request({ method: 'getFileDetails', args: [id], priority: 'low' }),
      this.client.request({ method: 'getDiagnostics', args: [{ fileId: id }], priority: 'low' }),
    ]);
    if (id !== this.documentId) return;
    this.file = file;
    this.messages = messages;
    this.messageCount = messages.length;
    this.#render();
    // The statistics read the whole file: they come later and fill in when ready.
    this.client.request({ method: 'getFileStatistics', args: [id], priority: 'low' }).then((stats) => {
      if (id !== this.documentId) return;
      this.stats = stats;
      this.#renderFile();
    }).catch(() => {});
  }

  /**
   * Follows the current page (after a short delay while it keeps changing).
   * @param {number} page Page number.
   * @returns {void}
   */
  setPage(page) {
    this.page = page;
    clearTimeout(this.followTimer);
    this.followTimer = setTimeout(async () => {
      const { documentId } = this;
      if (!documentId) return;
      const info = await this.client.request({ method: 'getPageDetails', args: [documentId, page], priority: 'high' }).catch(() => null);
      if (documentId !== this.documentId || page !== this.page) return;
      this.pageInfo = info;
      this.#renderPage();
    }, FOLLOW_DELAY);
  }

  /** Draws both tabs. */
  #render() {
    if (!this.panes) return;
    this.#renderFile();
    this.#renderPage();
  }

  /** Draws the file tab. */
  #renderFile() {
    const pane = this.panes.get('file');
    const f = this.file;
    if (!f) {
      pane.replaceChildren(el('p', t(this.documentId ? 'details.loading' : 'details.noFile'), 'empty-state'));
      return;
    }
    const parts = [section('details.section.file', [
      ['details.name', f.name], ['details.path', f.path], ['details.size', `${fileSizeText(f.size)} (${t('details.bytes', { count: f.size })})`],
      ['details.recordFormat', t(`details.recordFormat.${f.recordFormat}`), 'details.recordFormat.hint'],
    ]), section('details.section.content', [
      ['details.documents', f.documents.length],
      ['details.pageGroups', f.pageGroupCount], ['details.pages', f.pageCount], ['details.fields', f.fieldCount],
      ['details.tles', f.tleCount], ['details.nops', f.isisTagCount ? t('details.nopsWithIsis', { count: f.nopCount, isis: f.isisTagCount }) : f.nopCount],
      ['details.inlineResources', f.inlineResourceCount],
    ]), section('details.section.formdef', [['details.formdef', this.#formdefChoice(f.formDefinitions)]]),
    ...this.#statisticsSections()];
    const missing = listSection('details.missing', f.missingResources);
    if (f.missingResources.length) {
      missing.classList.add('warning');
      const add = iconButton('open', 'missing.add');
      applyTranslations(add);
      add.addEventListener('click', async () => this.app.openFiles(await pickFiles({ folder: false }), 'file'));
      missing.append(add);
    }
    parts.push(missing);
    const log = el('button', t('details.messages', { count: this.messageCount ?? 0 }), 'link-button');
    log.type = 'button';
    log.addEventListener('click', () => this.dispatchEvent(new CustomEvent('openlog')));
    parts.push(section('details.section.log', [['details.log', log]]));
    pane.replaceChildren(...parts);
  }

  /**
   * Builds the sections from the file statistics: print job, page sizes, resources used, text.
   * @returns {HTMLElement[]} Sections ("being determined" while the statistics are on their way).
   */
  #statisticsSections() {
    const s = this.stats;
    const wait = t('details.computing');
    if (!s) {
      return [section('details.section.job', [['details.sheets', wait], ['details.mediumMaps', wait], ['details.color', wait]])];
    }
    const sheets = s.printedSheets !== s.sheets
      ? t('details.sheetsWithCopies', { sheets: num(s.sheets, 0), printed: num(s.printedSheets, 0) }) : num(s.sheets, 0);
    const maps = el('div', undefined, 'detail-lines');
    const named = s.mediumMaps.used.filter((m) => m.name);
    maps.append(el('div', t('details.mediumMapChanges', { count: num(s.mediumMaps.invocations, 0) })));
    if (!named.length) maps.append(el('div', t('details.mediumMapDefault')));
    for (const m of named) maps.append(el('div', t('details.mediumMapUse', { name: m.name, pages: num(m.pages, 0), sheets: num(m.sheets, 0) }), 'mono'));
    const color = s.color.colored
      ? t('details.colorYes', {
        sources: s.color.sources.map((x) => t(`details.colorSource.${x}`)).join(', '),
        models: s.color.models.map((m) => t(`details.colorModel.${m}`)).join(', '),
      })
      : t('details.colorNo');
    const total = s.pageSizes.reduce((n, z) => n + z.pages, 0) || 1;
    const sizes = s.pageSizes.map((z) => t('details.pageSizeShare', {
      size: z.format ?? t('details.mm', { width: num(z.widthMm), height: num(z.heightMm) }),
      orientation: t(`details.orientation.${z.orientation}`),
      share: num((z.pages / total) * 100), pages: num(z.pages, 0),
    }));
    const usage = (c) => {
      const all = c.inline + c.external + c.missing;
      if (!all) return '0';
      const parts = [['inline', c.inline], ['external', c.external], ['missing', c.missing]].filter(([, n]) => n)
        .map(([k, n]) => t(`details.resourceOrigin.${k}`, { count: num(n, 0) }));
      return `${num(all, 0)} (${parts.join(', ')})`;
    };
    const codePages = s.codePages.map((c) => {
      const id = c.cpgid ? ` (CPGID ${c.cpgid})` : '';
      return `${c.name}${id}${c.missing ? ` – ${t('details.notFound')}` : ''}${c.doubleByte ? ` – ${t('details.doubleByte')}` : ''}`;
    });
    if (s.trueType) codePages.push(t('details.unicodeTrueType'));
    return [
      section('details.section.job', [['details.sheets', sheets], ['details.mediumMaps', maps], ['details.color', color]]),
      listSection('details.pageSizes', sizes),
      section('details.section.usedResources', [
        ['details.fonts', usage(s.resources.fonts)], ['details.overlays', usage(s.resources.overlays)],
        ['details.segments', usage(s.resources.pageSegments)], ['details.otherObjects', usage(s.resources.objects)],
      ]),
      section('details.section.text', [
        ['details.codePages', codePages.length ? codePages.join(', ') : t('details.none')],
        ['details.dbcs', s.doubleByteFonts.length ? t('details.dbcsYes', { fonts: s.doubleByteFonts.join(', ') }) : t('details.dbcsNo')],
      ]),
    ];
  }

  /**
   * Builds the form definition value: its name, or a choice when several apply.
   * @param {{candidates: {id: string, name: string, path: string, origin: string}[], chosenId: string|null}} defs Form definitions.
   * @returns {string|HTMLElement} Text or a selector.
   */
  #formdefChoice(defs) {
    const inline = defs.candidates.find((c) => c.origin === 'inline');
    if (inline) return t('details.formdefInline', { name: inline.name });
    if (defs.candidates.length < 2) {
      const only = defs.candidates[0];
      return only ? `${only.name} (${only.path})` : t('details.formdefNone');
    }
    const select = el('select');
    select.setAttribute('aria-label', t('formdef.label'));
    if (!defs.chosenId) select.append(new Option(t('formdef.choose'), ''));
    for (const c of defs.candidates) select.append(new Option(`${c.name} (${c.path})`, c.id, false, c.id === defs.chosenId));
    select.addEventListener('change', async () => {
      if (!select.value) return;
      await this.client.call('chooseFormDefinition', this.documentId, select.value);
      this.dispatchEvent(new CustomEvent('formdefchange'));
      await this.refresh();
    });
    return select;
  }

  /** Draws the page tab. */
  #renderPage() {
    const pane = this.panes.get('page');
    const p = this.pageInfo;
    if (!p) {
      pane.replaceChildren(el('p', t(this.documentId ? 'details.loading' : 'details.noFile'), 'empty-state'));
      return;
    }
    const mm = (units) => (units / 1440 * 25.4).toFixed(1);
    const none = t('print.notSpecified');
    const print = p.print;
    const counts = {};
    for (const o of p.objects) counts[o.kind] = (counts[o.kind] ?? 0) + 1;
    const parts = [
      section('details.section.page', [
        ['details.pageNumber', t('details.pageOf', { page: p.number, count: this.file?.pageCount ?? p.number })],
        ['details.name', p.name], ['details.pageGroup', p.pageGroup],
        ['details.pageSize', t('details.mm', { width: mm(p.widthUnits), height: mm(p.heightUnits) })],
        ['details.resolution', t('details.unitsPerInch', { x: p.xResolution, y: p.yResolution })],
        ['details.sheet', t(`details.sheetSide.${p.side}`, { sheet: p.sheetNumber })],
        ...(p.placement ? [['details.placement', this.#placementText(p.placement)]] : []),
      ]),
      ...(p.overflow ? [this.#overflowSection(p.overflow)] : []),
      section('details.section.print', [
        ['print.duplex', t(`print.duplex.${print.duplex}`)], ['print.inputBin', print.inputBin ?? none],
        ['print.outputBin', print.outputBin ?? none], ['print.mediaType', print.mediaType ?? none],
        ['print.mediumMap', print.mediumMap ?? none], ['details.copies', num(p.copies ?? 1, 0)],
        ['details.finishing', p.finishing?.length ? p.finishing.map((f) => this.#finishingText(f)).join(', ') : none],
        ['details.mediumOverlays', p.mediumOverlays?.length ? p.mediumOverlays.join(', ') : t('details.none')],
        ['details.controls', this.#controlsText(p.controls) || none],
      ]),
      listSection('details.fonts', p.fonts),
      listSection('details.overlays', p.includedOverlays.map((o) => o.name)),
      listSection('details.segments', p.includedSegments.map((s) => s.name)),
      listSection('details.objects', Object.entries(counts).map(([kind, n]) => `${t(`node.${kind}`)}: ${n}`)),
    ];
    if (p.missingResources.length) {
      const missing = listSection('details.missing', p.missingResources.map((m) => `${m.name} (${t(`resource.type.${m.type}`)})`));
      missing.classList.add('warning');
      parts.push(missing);
    }
    parts.push(this.#pageMessages(p));
    pane.replaceChildren(...parts);
  }

  /**
   * Describes the position of a page on its sheet (N-up).
   * @param {{partition: number, nUp: number, side: string, x: number, y: number, rotation: number}} pl Placement.
   * @returns {string} Text.
   */
  #placementText(pl) {
    const text = t('details.placementText', {
      partition: pl.partition, nUp: pl.nUp, side: t(`details.side.${pl.side}`), x: mmText(pl.x), y: mmText(pl.y),
    });
    return pl.rotation ? `${text}, ${t('details.rotated', { degrees: pl.rotation })}` : text;
  }

  /**
   * Lists the further medium map controls that are set (MMC keywords, T282).
   * @param {object|undefined} c Controls from getPageDetails.
   * @returns {string} Text, empty when none is set.
   */
  #controlsText(c) {
    if (!c) return '';
    const parts = [];
    if (c.constantForms) parts.push(t('details.control.constantForms'));
    if (c.suppressions?.length) parts.push(t('details.control.suppressions', { ids: c.suppressions.join(', ') }));
    if (c.jog) parts.push(t('details.control.jog'));
    // X'FF' is the printer's default quality: not worth a mention.
    if (c.quality !== null && c.quality !== undefined && c.quality !== 0xff) parts.push(t('details.control.quality', { value: c.quality }));
    if (c.perforationCut) parts.push(t('details.control.perforationCut'));
    if (c.separationCut) parts.push(t('details.control.separationCut'));
    if (c.setupId !== null && c.setupId !== undefined) parts.push(t('details.control.setupId', { id: c.setupId }));
    return parts.join(', ');
  }

  /**
   * Names a finishing operation.
   * @param {{operation: string, edge: string|null, count: number}} f Operation.
   * @returns {string} Text, e.g. "Corner staple (top), 2×".
   */
  #finishingText(f) {
    let text = f.operation.startsWith("X'") ? f.operation : t(`finishing.${f.operation}`);
    if (f.edge) text += ` (${t(`finishing.edge.${f.edge}`)})`;
    if (f.count) text += `, ${f.count}×`;
    return text;
  }

  /**
   * Builds the warning about content beyond the page edges or a page beyond the paper.
   * @param {object} o Overflow (getPageDetails `overflow`).
   * @returns {HTMLElement} Section.
   */
  #overflowSection(o) {
    const edges = (x) => ['left', 'right', 'top', 'bottom'].filter((e) => x[e] > 0)
      .map((e) => t(`details.overflow.${e}`, { mm: mmText(x[e]) })).join(', ');
    const rows = [];
    if (o.count) {
      rows.push(['details.overflow.content', t('details.overflow.what', {
        kinds: o.kinds.map((k) => t(`details.overflow.kind.${k}`)).join(', '), count: num(o.count, 0),
      })]);
      rows.push(['details.overflow.edges', edges(o)]);
    }
    if (o.sheet) rows.push(['details.overflow.sheet', edges(o.sheet)]);
    const box = section('details.section.overflow', rows);
    box.classList.add('warning');
    box.append(el('p', t('details.overflow.hint'), 'detail-note'));
    return box;
  }

  /**
   * Builds the messages of the page: those whose byte offset lies in the page, with a link to
   * the Log Viewer showing only them.
   * @param {object} p Page details.
   * @returns {HTMLElement} Section.
   */
  #pageMessages(p) {
    const [from, to] = p.byteRange ?? [0, 0];
    const count = (this.messages ?? []).filter((d) => d.offset !== null && d.offset >= from && d.offset < to).length;
    const link = el('button', t('details.messages', { count }), 'link-button');
    link.type = 'button';
    link.addEventListener('click', () => this.dispatchEvent(new CustomEvent('openlog', {
      detail: { scope: { fileId: this.documentId, from, to, label: t('diagnostics.pageScope', { page: p.number }) } },
    })));
    return section('details.section.pageLog', [['details.log', link]]);
  }
}

customElements.define('details-panel', DetailsPanel);
