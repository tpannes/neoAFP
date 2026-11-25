/**
 * Workspace: the set of files the user has opened, and the main entry point of the library.
 *
 * Adding files classifies each one by content and indexes its structured fields. Problems never
 * make `addFiles` fail: they become diagnostics and file kinds (contracts/library-api.md).
 * Later user stories extend the workspace with pages, structure, resources and search.
 */

import { buildFieldIndex } from './modca/field-index.js';
import { sniffFile, classifyIndex } from './modca/classify.js';
import { idToHex } from './modca/reader.js';
import { lookupField } from './modca/registry/index.js';
import './modca/registry/modca-fields.js';
import './modca/registry/field-decoders.js';
import { DiagnosticCollector } from './diagnostics.js';
import { listCodePages as catalog } from './codepages/index.js';
import { ResourceCatalog } from './resources/resolver.js';
import { FontManager, rasterGlyphs, fontBytesOf } from './render/fonts.js';
import { renderPage, readEnvironment, renderContent, readObjectArea } from './render/page-renderer.js';
import { readDocument, readPage } from './modca/document-model.js';
import { readFormDefinition } from './formdef/formdef.js';
import { isSystemFile } from './io/system-files.js';
import { buildSheetModel, printInfoOf } from './formdef/sheets.js';
import { pageOverflow, placementOverflow } from './render/content-bounds.js';
import { placeItem } from './render/transform.js';
import { decodeIncludePage } from './render/include-page.js';
import { fileStatistics } from './meta/file-stats.js';
import { ebcdicName } from './modca/bytes.js';
import { readFontNames } from './foca/opentype.js';
import { outlineReader } from './foca/type1.js';
import { imImagePixels, BEGIN_IM_IMAGE } from './im/im-image.js';
import { readIocaImage, readJbig2Image, BEGIN_IMAGE_OBJECT } from './ioca/ioca.js';
import { imagePdf, jpeg2000Header } from './objcontainer/image-pdf.js';
import './goca/goca.js';
import './bcoca/bcoca.js';
import { containerPixels, readContainer, BEGIN_OBJECT_CONTAINER } from './objcontainer/object-container.js';
import { fieldData, childRows } from './modca/access.js';
import { decodePGD } from './modca/structures.js';
import { getTree as treeOf, treePath } from './modca/tree.js';
import { locate as locateField } from './modca/locate.js';
import { getFields as fieldsOf, findFieldAtOffset as fieldAtOffset, getField as fieldOf } from './modca/fields.js';
import { hexRows, printable, DEFAULT_CODE_PAGE } from './meta/hex.js';
import { collectTles, decodeTles, loadTleCodePages, tlesOfPage } from './meta/tle.js';
import { TleTable, pagesWithin } from './meta/tle-table.js';
import { pageTextLines } from './export/page-text.js';
import { readNops, countNops } from './meta/nop.js';
import { readXmpPackets, readColorManagement } from './meta/metadata.js';
import { loadCodePage, decode as decodeBytes } from './codepages/index.js';
import { describeResource, linkDuplicates, linkFontTypes, groupIdentical, publicRecord } from './resources/catalog.js';
import { filterResources, sortResources, filterOptions } from './resources/filter.js';
import { extractResource as extractBytes } from './resources/extract.js';
import { exportResourcesCsv as csvText } from './export/csv.js';
import { SearchIndex, describeHit } from './search/search-index.js';
import { missingResources } from './render/missing.js';
import { resourceRenderModel, fontCharacterGrid, codePageTable, afpGlyphHandle, codedFontGrid } from './render/resource-renderer.js';
import { formDefinitionSummary, formDefinitionDiagram } from './render/formdef-diagram.js';

/** Word entries (word, page) after which search indexing stops (about 0.5–1 GB of postings). */
const SEARCH_ENTRY_LIMIT = 120_000_000;
/** Results of a search that come with excerpt and match position. */
const SEARCH_DETAILED = 20;

/** Largest font file read for its names (larger files are listed without names). */
const MAX_FONT_FILE = 64 * 1024 * 1024;

/** Code page override categories (FR-037). */
const OVERRIDE_CATEGORIES = ['nop', 'tle', 'text'];
/** Begin Document, Begin Named Page Group and Tag Logical Element (MO:DCA Reference). */
const BDT_ID = 0xd3a8a8;
const BNG_ID = 0xd3a8ad;
const TLE_ID = 0xd3a090;

/**
 * Counts the fields with an identifier.
 * @param {object|null} index Field index.
 * @param {number} id Identifier.
 * @returns {number} Count.
 */
function countIds(index, id) {
  let n = 0;
  for (let r = 0; r < (index?.count ?? 0); r++) if (index.id[r] === id) n++;
  return n;
}

/**
 * @typedef {object} AfpFileSummary
 * @property {string} id File id, stable within the session.
 * @property {string} name File name.
 * @property {string} path Path relative to the opened folder.
 * @property {number} size Size in bytes.
 * @property {string} kind Data-model FileKind.
 * @property {'notAfp'|'unknownEncoding'|'onlyComments'|null} skipReason Why the file is skipped.
 * @property {'file'|'folder'} source How the file was opened.
 * @property {'plain'|'lineBreaks'|'padded'|null} recordFormat Separators between records.
 * @property {'added'|'classifying'|'indexed'|'ready'|'failed'} state Processing state.
 * @property {number} fieldCount Number of structured fields.
 * @property {number} pageCount Number of Begin Page fields.
 * @property {number|null} truncatedAt Offset where reading stopped early.
 * @property {object[]} fontNames TrueType/OpenType font names (filled in user story 1).
 */

/**
 * Creates an empty workspace.
 * @param {{onProgress?: (event: object) => void, onDiagnostic?: (d: object) => void}} [options]
 *   Callbacks for progress events and new diagnostics.
 * @returns {Workspace} The workspace.
 */
export function createWorkspace(options = {}) {
  return new Workspace(options);
}

/**
 * The set of open files with their indexes and diagnostics.
 */
export class Workspace {
  /**
   * Creates an empty workspace; use createWorkspace().
   * @param {{onProgress?: (event: object) => void, onDiagnostic?: (d: object) => void, searchEntryLimit?: number}} options
   *   Callbacks; searchEntryLimit overrides SEARCH_ENTRY_LIMIT (tests).
   */
  constructor(options) {
    this.onProgress = options.onProgress ?? (() => {});
    this.onPagesInvalidated = options.onPagesInvalidated ?? (() => {});
    this.diagnostics = new DiagnosticCollector(options.onDiagnostic);
    this.catalog = new ResourceCatalog((id) => this.getFileRecord(id), (d) => this.diagnostics.add(d));
    /** Parsed resources shared by all documents (catalog entry id → Promise). */
    this.resourceCache = new Map();
    /** Resource viewer records by catalog entry id (Promise). */
    this.resourceRecords = new Map();
    /** Full-text search index and the work still to do for it (US4). */
    this.searchIndex = new SearchIndex();
    /** @type {Map<string, number>} document file id → next page to index */
    this.searchCursor = new Map();
    /** Set when indexing stopped at the memory limit: { pages, totalPages }. */
    this.searchLimited = null;
    this.searchEntryLimit = options.searchEntryLimit ?? SEARCH_ENTRY_LIMIT;
    /** Font handles by reference, for glyph and font byte requests from the viewer. */
    this.fontHandles = new Map();
    /** Per-document render state: font manager, resolution, reported missing resources. */
    this.documentState = new Map();
    this.activeDocumentId = null;
    /** @type {Map<string, object>} */
    this.files = new Map();
    this.nextId = 1;
    this.codePageOverrides = { nop: null, tle: null, text: null };
  }

  /**
   * Adds files: classifies each by content and indexes its structured fields.
   * Never rejects because of file content.
   * @param {import('./io/byte-source.js').ByteSource[]} sources Files to add.
   * @param {'file'|'folder'} origin How the files were opened (affects resource lookup order);
   *   from a folder, operating system metadata files are skipped (io/system-files.js).
   * @returns {Promise<AfpFileSummary[]>} Summaries of the added files (skipped files not included).
   */
  async addFiles(sources, origin) {
    if (!Array.isArray(sources)) throw new TypeError('sources must be an array');
    if (origin !== 'file' && origin !== 'folder') throw new TypeError(`invalid origin: ${origin}`);
    // Folders often hold operating system metadata (.DS_Store and the like); it is not AFP data.
    if (origin === 'folder') sources = sources.filter((s) => !isSystemFile(s.path ?? s.name));
    const added = [];
    let newResources = false;
    for (let i = 0; i < sources.length; i++) {
      const file = this.#createFile(sources[i], origin);
      this.onProgress({ phase: 'classify', fileId: file.id, done: i, total: sources.length });
      await this.#process(file);
      const before = this.catalog.entries.length;
      if (file.state === 'ready') await this.catalog.addFile(file).catch(() => {});
      if (file.state === 'ready' && file.kind === 'document') await this.#reportPageIncludes(file);
      if (this.catalog.entries.length > before && file.kind !== 'document') newResources = true;
      added.push(summarize(file));
      this.onProgress({ phase: 'classify', fileId: file.id, done: i + 1, total: sources.length });
    }
    if (newResources && this.documentState.size) {
      // Resources that were missing may now exist: re-render (FR-021).
      const documents = [...this.documentState.keys()];
      this.documentState.clear();
      this.sheetCache?.clear();
      for (const documentId of documents) this.onPagesInvalidated({ documentId, pageNumbers: 'all' });
    }
    return added;
  }

  /**
   * Registers a new file record.
   * @param {import('./io/byte-source.js').ByteSource} source The file.
   * @param {'file'|'folder'} origin How it was opened.
   * @returns {object} Internal file record.
   */
  #createFile(source, origin) {
    const file = {
      id: `f${this.nextId++}`,
      name: source.name,
      path: source.path ?? source.name,
      size: source.size,
      kind: null,
      skipReason: null,
      source: origin,
      recordFormat: null,
      state: 'added',
      fieldCount: 0,
      pageCount: 0,
      truncatedAt: null,
      fontNames: [],
      byteSource: source,
      index: null,
    };
    this.files.set(file.id, file);
    return file;
  }

  /**
   * Classifies and indexes one file; records problems as diagnostics.
   * @param {object} file Internal file record.
   * @returns {Promise<void>} Resolves when done (also on failure).
   */
  async #process(file) {
    try {
      file.state = 'classifying';
      const sniff = await sniffFile(file.byteSource);
      if (sniff.isAfp) {
        const index = await buildFieldIndex(file.byteSource, {
          onProgress: (done, total) => this.onProgress({ phase: 'index', fileId: file.id, done, total }),
        });
        file.index = index;
        file.state = 'indexed';
        Object.assign(file, classifyIndex(index));
        file.recordFormat = index.recordFormat;
        file.fieldCount = index.count;
        file.pageCount = index.pages.length;
        file.truncatedAt = index.truncatedAt;
        this.#reportIndexProblems(file);
      } else {
        file.kind = sniff.kind;
        file.skipReason = sniff.skipReason;
        if (file.kind === 'truetypeFont' && file.size <= MAX_FONT_FILE) {
          file.fontNames = readFontNames(await file.byteSource.read(0, file.size));
        }
      }
      this.#reportKind(file);
      file.state = 'ready';
    } catch (error) {
      file.state = 'failed';
      file.kind ??= 'notRecognized';
      file.skipReason ??= 'notAfp';
      this.diagnostics.add({
        severity: 'error', code: 'decodeFailed', fileId: file.id,
        params: { file: file.path, reason: String(error?.message ?? error) },
      });
    }
  }

  /**
   * Reports truncation and unknown structured fields of an indexed file.
   * @param {object} file Internal file record with index.
   * @returns {void}
   */
  #reportIndexProblems(file) {
    const { index } = file;
    if (index.truncatedAt !== null && index.count > 0) {
      this.diagnostics.add({
        severity: 'error', code: 'truncated', fileId: file.id, offset: index.truncatedAt,
        params: { file: file.path, reason: index.truncatedReason },
      });
    }
    const unknown = new Map();
    for (let row = 0; row < index.count; row++) {
      const id = index.id[row];
      if (lookupField(id)) continue;
      const entry = unknown.get(id);
      if (entry) entry.count++;
      else unknown.set(id, { count: 1, offset: index.offset[row] });
    }
    for (const [id, { count, offset }] of unknown) {
      this.diagnostics.add({
        severity: 'warning', code: 'unknownField', fileId: file.id, offset, fieldId: idToHex(id),
        params: { file: file.path, fieldId: idToHex(id), count },
      });
    }
  }

  /**
   * Reports files that are skipped or not supported. Files with only comments are not an error
   * (spec edge case), but they are listed as skipped with an info entry so the user can see why
   * they are not offered as documents.
   * @param {object} file Internal file record with kind.
   * @returns {void}
   */
  #reportKind(file) {
    if (file.kind === 'notRecognized' || file.kind.startsWith('unsupported:')) {
      this.diagnostics.add({
        severity: file.skipReason === 'unknownEncoding' || file.kind.startsWith('unsupported:') ? 'warning' : 'info',
        code: 'unsupportedFileKind', fileId: file.id,
        params: { file: file.path, kind: file.kind, reason: file.skipReason },
      });
    }
  }

  /**
   * Lists all files.
   * @returns {AfpFileSummary[]} File summaries in the order they were added.
   */
  listFiles() {
    return [...this.files.values()].map(summarize);
  }

  /**
   * Removes all files and diagnostics.
   * @returns {void}
   */
  removeAll() {
    this.files.clear();
    this.diagnostics.clear();
    this.catalog.clear();
    this.resourceCache.clear();
    this.resourceRecords.clear();
    this.searchIndex.clear();
    this.searchCursor.clear();
    this.searchLimited = null;
    this.fontHandles.clear();
    this.documentState.clear();
    this.renderReported?.clear();
    this.sheetCache?.clear();
    this.formdefChoice?.clear();
    this.activeDocumentId = null;
  }

  /**
   * Lists the AFP documents among the open files.
   * @returns {{id: string, name: string, path: string, pageCount: number, documentCount: number}[]}
   *   AFP files with their number of pages and of documents (Begin Document fields).
   */
  listDocuments() {
    return [...this.files.values()].filter((f) => f.kind === 'document')
      .map((f) => ({ id: f.id, name: f.name, path: f.path, pageCount: f.pageCount, documentCount: countIds(f.index, BDT_ID) }));
  }

  /**
   * Chooses the document shown in the viewer.
   * @param {string} documentId Id of a document file.
   * @returns {{id: string, name: string, path: string, pageCount: number}} The document.
   */
  setActiveDocument(documentId) {
    const doc = this.listDocuments().find((d) => d.id === documentId);
    if (!doc) throw new RangeError(`not a document: ${documentId}`);
    this.activeDocumentId = documentId;
    return doc;
  }

  /**
   * Returns the number of pages of a document.
   * @param {string} documentId Document file id.
   * @returns {number} Page count.
   */
  getPageCount(documentId) {
    return this.#document(documentId).index.pages.length;
  }

  /**
   * Returns a document file record and checks the id.
   * @param {string} documentId Document file id.
   * @returns {object} File record.
   */
  #document(documentId) {
    const file = this.getFileRecord(documentId);
    if (file.kind !== 'document') throw new RangeError(`not a document: ${documentId}`);
    return file;
  }

  /**
   * Returns the Begin Page row of a page.
   * @param {object} file Document file record.
   * @param {number} pageNumber Page number starting at 1.
   * @returns {number} Row.
   */
  #pageRow(file, pageNumber) {
    const row = file.index.pages[pageNumber - 1];
    if (row === undefined) throw new RangeError(`no page ${pageNumber}`);
    return row;
  }

  /**
   * Returns the structure of a document (data-model "Document"): name, nested page groups,
   * pages with their field ranges, inline resource group and medium map invocations.
   * @param {string} documentId Document file id.
   * @returns {Promise<object>} Document.
   */
  async getDocument(documentId) {
    return readDocument(this.#document(documentId));
  }

  /**
   * Returns a page without rendering it (data-model "Page"): size and resolution, content
   * objects with their areas, included page segments and overlays, TLE/NOP fields and missing
   * resources.
   * @param {string} documentId Document file id.
   * @param {number} pageNumber Page number starting at 1.
   * @returns {Promise<object>} Page.
   */
  async getPageInfo(documentId, pageNumber) {
    const file = this.#document(documentId);
    this.#pageRow(file, pageNumber);
    const r = await this.#renderContext(file);
    return readPage(file, pageNumber, {
      objectArea: (f, row, env) => readObjectArea(f, row, env),
      exists: async (type, name) => Boolean(await this.catalog.lookup(type, name, r.lookupContext)),
      containerFormat: async (f, row) => (await readContainer(f, row)).format,
      report: ({ offset, reason }) => r.report({ severity: 'warning', code: 'decodeFailed', fileId: file.id, offset, params: { file: file.path, reason } }),
    });
  }

  /**
   * Reports Include Page fields outside pages (document or page-group state, MO:DCA "Include
   * Page"): they add a page to the page sequence, which neoAFP does not do (T280). Such an IPG
   * used to be skipped without a word; now each one is a warning naming the page and document.
   * @param {object} file Document file record.
   * @returns {Promise<void>} Resolves when reported.
   */
  async #reportPageIncludes(file) {
    const { index } = file;
    for (let row = 0; row < index.count; row++) {
      if (index.id[row] !== 0xd3afaf) continue;
      let inPage = false;
      for (let p = index.parent[row]; p >= 0; p = index.parent[p]) if (index.id[p] === 0xd3a8af) inPage = true;
      if (inPage) continue;
      const ipg = decodeIncludePage(await fieldData(file, row));
      const name = ipg.document ? `${ipg.document}/${ipg.offset !== null ? `#${ipg.offset + 1}` : ipg.name}` : ipg.name;
      this.diagnostics.add({ severity: 'warning', code: 'unsupportedObject', fileId: file.id, offset: index.offset[row],
        params: { file: file.path, reason: `Include Page ${name} between pages adds a page that is not shown` } });
    }
  }

  /**
   * Renders a page with what its medium map applies to it on its sheet-side (real sheets, not the
   * forced duplex view): text suppressions activated by the side's MMC (X'F3', T284) and the PMC
   * overlays (T283) — without N-up all PMCs of the medium map; with N-up the PGP repeating
   * group's PMCid (X'FF' or none: all) and its PgFlgs bit 0 (X'80': no variable page data, a
   * blank page) and bit 1 (X'40': no PMC overlays). Only the first preprinted form overlay is
   * used. PMC overlays are page overlays: drawn at their offset in page units, turned about their
   * origin by their rotation, marked `pmcOverlay` (they come from the form definition).
   * @param {object} r Render context.
   * @param {object} file Document file record.
   * @param {number} pageNumber Page number.
   * @returns {Promise<object>} Render model (text code page override applied).
   */
  async #renderPageAsPrinted(r, file, pageNumber) {
    const sheets = await this.#sheetModel(file, false);
    const sheet = sheets.sheet(sheets.sheetOfPage[pageNumber]);
    const side = sheet?.back?.placements.some((p) => p.pageNumber === pageNumber) ? 'back' : 'front';
    const placed = sheet?.[side]?.placements.find((p) => p.pageNumber === pageNumber) ?? null;
    const ids = sheet?.suppressions?.[side] ?? [];
    const page = await this.#applyTextOverride(await renderPage(r, file, this.#pageRow(file, pageNumber), { suppressed: ids.length ? new Set(ids) : null }));
    const map = sheets.maps[sheets.mapOfPage[pageNumber]];
    const nUp = (sheet?.nUp ?? 1) > 1;
    const flags = nUp ? (placed?.flags ?? 0) : 0;
    if (flags & 0x80) page.items = [];
    if (!map?.pmcs?.length || (flags & 0x40)) return page;
    const pmcId = nUp ? placed?.pmcId : null;
    const chosen = pmcId !== null && pmcId !== undefined && pmcId !== 0xff ? map.pmcs.filter((p) => p.id === pmcId) : map.pmcs;
    let formUsed = false;
    for (const ov of chosen.flatMap((p) => p.overlays)) {
      if (ov.form) {
        if (formUsed) continue;
        formUsed = true;
      }
      const entry = await this.catalog.lookup('overlay', ov.name, r.lookupContext);
      if (!entry) { r.missing('overlay', ov.name); continue; }
      const of = this.getFileRecord(entry.fileId);
      const drawn = await renderContent(r, of, entry.beginRow, await readEnvironment(of, entry.beginRow), { x: 0, y: 0 });
      for (const item of drawn) page.items.push({ ...placeItem(item, { dx: ov.x, dy: ov.y, rotation: ov.rotation }), pmcOverlay: ov.name });
    }
    return page;
  }

  /**
   * Returns (and creates) the render state of a document.
   * @param {object} file Document file record.
   * @returns {Promise<object>} Render context for the page renderer.
   */
  async #renderContext(file) {
    if (!this.documentState.has(file.id)) {
      const resolution = await this.#documentResolution(file);
      // Pages are rendered again and again (main view, thumbnails, zoom, after new resources):
      // report each distinct problem of this document only once.
      this.renderReported ??= new Map();
      if (!this.renderReported.has(file.id)) this.renderReported.set(file.id, new Set());
      const reported = this.renderReported.get(file.id);
      const report = (input) => {
        // Messages name their file ("{file}: …"); helpers such as the font manager do not know
        // the path, so it is filled in here.
        const d = input.params && !('file' in input.params) ? { ...input, params: { file: file.path, ...input.params } } : input;
        const key = JSON.stringify([d.severity, d.code, d.fileId, d.offset ?? null, d.messageKey ?? null, d.params ?? null]);
        if (reported.has(key)) return;
        reported.add(key);
        this.diagnostics.add(d);
      };
      const missingReported = new Set();
      const getFile = (id) => this.getFileRecord(id);
      const lookupContext = { documentFileId: file.id, resolution };
      this.documentState.set(file.id, {
        fonts: new FontManager({ catalog: this.catalog, getFile, resourceCache: this.resourceCache, handles: this.fontHandles,
          documentFileId: file.id, resolution, report }),
        catalog: this.catalog,
        getFile,
        report,
        lookupContext,
        resolution,
        missing: (type, name) => {
          if (missingReported.has(`${type}:${name}`)) return;
          missingReported.add(`${type}:${name}`);
          report({ severity: 'warning', code: 'missingResource', fileId: file.id, params: { file: file.path, name, type } });
        },
      });
    }
    return this.documentState.get(file.id);
  }

  /**
   * Determines a document's resolution for choosing between same-named resources: the page
   * descriptor's units if they name a printer resolution (240, 300, 600 dpi), else unknown
   * (which prefers the highest available resolution).
   * @param {object} file Document file record.
   * @returns {Promise<number|null>} Resolution in dpi, or null.
   */
  async #documentResolution(file) {
    const row = file.index.pages[0];
    if (row === undefined) return null;
    const bag = childRows(file.index, row).find((r) => file.index.id[r] === 0xd3a8c9);
    if (bag === undefined) return null;
    const pgdRow = childRows(file.index, bag).find((r) => file.index.id[r] === 0xd3a6af);
    if (pgdRow === undefined) return null;
    const pgd = decodePGD(await fieldData(file, pgdRow));
    return pgd.xBase === 0 && [2400, 3000, 6000].includes(pgd.xUnits) ? pgd.xUnits / 10 : null;
  }

  /**
   * Renders a page into a render model (display list in 1/1440 inch).
   * @param {string} documentId Document file id.
   * @param {number} pageNumber Page number starting at 1.
   * @returns {Promise<{widthUnits: number, heightUnits: number, items: object[]}>} Render model.
   */
  async getRenderModel(documentId, pageNumber) {
    const file = this.#document(documentId);
    const r = await this.#renderContext(file);
    const model = await this.#renderPageAsPrinted(r, file, pageNumber);
    model.pageAreas = [{ pageNumber, x: 0, y: 0, width: model.widthUnits, height: model.heightUnits, unitsPerInch: model.unitsPerInch }];
    return model;
  }

  /**
   * Re-decodes the text of presentation text glyph runs with the `text` code page override
   * (FR-037); the glyphs drawn stay those of the AFP code page.
   * @param {object} model Render model.
   * @returns {Promise<object>} The model, with replaced `text` and `chars` where runs carry codes.
   */
  async #applyTextOverride(model) {
    const cp = this.codePageOverrides.text;
    if (!cp) return model;
    await loadCodePage(cp);
    const items = model.items.map((item) => {
      if (item.type !== 'glyphRun' || !item.codes) return item;
      const chars = item.codes.map((c) => decodeBytes(cp, c > 0xff ? Uint8Array.of(c >> 8, c & 0xff) : Uint8Array.of(c), { startInDoubleByte: c > 0xff }));
      return { ...item, chars, text: chars.join('') };
    });
    return { ...model, items };
  }

  /**
   * Returns glyph shapes of a font for the viewer: bitmaps of raster fonts, outlines of Type 1
   * and CID-keyed fonts.
   * @param {string} fontRef Font reference from a glyph run.
   * @param {(string|number)[]} ids Glyph ids (GCGIDs, glyph names or CIDs).
   * @returns {{resolution?: number|null, unitsPerEm?: number, glyphs: object[]}} Bitmaps in pels, or
   *   outlines (path commands, y up) in font units.
   */
  getGlyphs(fontRef, ids) {
    const handle = this.fontHandles.get(fontRef);
    if (!handle) throw new RangeError(`unknown font: ${fontRef}`);
    if (handle.kind === 'outline') {
      handle.reader ??= outlineReader(handle.fcs);
      if (!handle.reader) return { unitsPerEm: 1000, glyphs: [] };
      const glyphs = [];
      for (const id of ids) {
        const o = handle.reader.outline(id);
        if (o) glyphs.push({ id, path: o.path });
      }
      return { unitsPerEm: handle.reader.unitsPerEm, glyphs };
    }
    if (handle.kind !== 'raster') return { resolution: null, glyphs: [] };
    return { resolution: handle.fcs.unitsPerInch, glyphs: rasterGlyphs(handle, ids) };
  }

  /**
   * Returns the pixels of an image item for the viewer.
   * @param {string} imageRef Reference from an image item ("<fileId>:<row>").
   * @returns {Promise<{width: number, height: number, bilevel?: object, rgba?: Uint8ClampedArray,
   *   jpegBytes?: Uint8Array}>} Pixels: 1-bit rows (bilevel), RGBA, or JPEG data to decode.
   */
  async getImagePixels(imageRef) {
    const [fileId, rowText] = String(imageRef).split(':');
    const file = this.getFileRecord(fileId);
    const row = Number(rowText);
    if (file.index?.id[row] === BEGIN_IM_IMAGE) return imImagePixels(file, row);
    if (file.index?.id[row] === BEGIN_OBJECT_CONTAINER) return containerPixels(file, row);
    if (file.index?.id[row] === BEGIN_IMAGE_OBJECT) {
      const image = await readIocaImage(file, row);
      return { width: image.width, height: image.height, tiles: image.parts };
    }
    throw new RangeError(`not an image: ${imageRef}`);
  }

  /**
   * Lists the form definitions that can apply to a document and the one in use (FR-014).
   * @param {string} documentId Document file id.
   * @returns {{candidates: {id: string, name: string, path: string, origin: string}[],
   *   chosenId: string|null, choiceNeeded: boolean}} Candidates (inline first) and the chosen one.
   */
  listFormDefinitions(documentId) {
    const file = this.#document(documentId);
    const all = this.catalog.list().filter((e) => e.type === 'formDefinition');
    const inline = all.filter((e) => e.origin === 'inline' && e.documentFileId === file.id);
    const external = all.filter((e) => e.origin !== 'inline');
    const candidates = [...inline, ...external].map((e) => ({ id: e.id, name: e.name, path: this.getFileRecord(e.fileId).path, origin: e.origin }));
    const choice = this.formdefChoice?.get(file.id) ?? null;
    const chosenId = inline[0]?.id ?? choice ?? (external.length === 1 ? external[0].id : null);
    return { candidates, chosenId, choiceNeeded: !inline.length && external.length > 1 && !choice };
  }

  /**
   * Chooses the form definition for a document when several external ones are available.
   * @param {string} documentId Document file id.
   * @param {string} formDefResourceId Catalog id of the form definition.
   * @returns {Promise<void>} Resolves when the sheets are recomputed.
   */
  async chooseFormDefinition(documentId, formDefResourceId) {
    this.#document(documentId);
    if (!this.catalog.list().some((e) => e.id === formDefResourceId && e.type === 'formDefinition')) {
      throw new RangeError(`not a form definition: ${formDefResourceId}`);
    }
    this.formdefChoice ??= new Map();
    this.formdefChoice.set(documentId, formDefResourceId);
    this.sheetCache?.delete(documentId);
    this.sheetCache?.delete(`${documentId}:forced`);
  }

  /**
   * Builds (once) the sheet model of a document.
   * @param {object} file Document file record.
   * @param {boolean} [forceDuplex] Pair the pages of simplex medium maps front/back (forced duplex
   *   view, see formdef/sheets.js); print information always uses the real model.
   * @returns {Promise<import('./formdef/sheets.js').SheetModel & {formdef: object|null}>} Sheets.
   */
  async #sheetModel(file, forceDuplex = false) {
    this.sheetCache ??= new Map();
    const key = forceDuplex ? `${file.id}:forced` : file.id;
    if (!this.sheetCache.has(key)) {
      this.sheetCache.set(key, (async () => {
        const { chosenId } = this.listFormDefinitions(file.id);
        const entry = chosenId ? this.catalog.list().find((e) => e.id === chosenId) : null;
        const formdef = entry ? await readFormDefinition(this.getFileRecord(entry.fileId), entry.beginRow) : null;
        const { index } = file;
        const mapNameByPage = [];
        let nextPage = 0; // index.pages is in file order: walk it alongside the rows
        const newSheetBefore = new Set();
        let current = null;
        let pendingImm = false;
        for (let row = 0; row < index.count; row++) {
          const id = index.id[row];
          if (id === 0xd3abcc) {
            current = ebcdicName(await fieldData(file, row));
            pendingImm = true;
          } else if (row === index.pages[nextPage]) {
            nextPage++;
            mapNameByPage.push(current);
            if (pendingImm) newSheetBefore.add(mapNameByPage.length);
            pendingImm = false;
          }
        }
        const model = buildSheetModel(index.pages.length, mapNameByPage, newSheetBefore, formdef, { forceDuplex });
        model.formdef = formdef;
        return model;
      })());
    }
    return this.sheetCache.get(key);
  }

  /**
   * Lists the sheets of a document (front/back sides with placed pages).
   * @param {string} documentId Document file id.
   * @param {{forceDuplex?: boolean}} [options] forceDuplex: sheets of the forced duplex view.
   * @returns {Promise<object[]>} Sheets.
   */
  async getSheets(documentId, { forceDuplex = false } = {}) {
    const model = await this.#sheetModel(this.#document(documentId), forceDuplex);
    const sheets = [];
    for (let n = 1; n <= model.count; n++) sheets.push(model.sheet(n));
    return sheets;
  }

  /**
   * The sheet layout the page viewer needs (T230): how many sheets, the first page of each and
   * whether it has pages on its back, as typed arrays instead of one object per sheet.
   * @param {string} documentId Document file id.
   * @param {{forceDuplex?: boolean}} [options] forceDuplex: the forced duplex view.
   * @returns {Promise<{count: number, firstPage: Int32Array, hasBack: Uint8Array}>} Layout; sheet n
   *   holds pages firstPage[n − 1] to firstPage[n] − 1.
   */
  async getSheetLayout(documentId, { forceDuplex = false } = {}) {
    return (await this.#sheetModel(this.#document(documentId), forceDuplex)).layout();
  }

  /**
   * Returns one sheet.
   * @param {string} documentId Document file id.
   * @param {number} sheetNumber Sheet number (1-based).
   * @param {{forceDuplex?: boolean}} [options] forceDuplex: the forced duplex view.
   * @returns {Promise<object>} Sheet (formdef/sheets.js Sheet).
   */
  async getSheet(documentId, sheetNumber, { forceDuplex = false } = {}) {
    const sheet = (await this.#sheetModel(this.#document(documentId), forceDuplex)).sheet(sheetNumber);
    if (!sheet) throw new RangeError(`no sheet ${sheetNumber}`);
    return sheet;
  }

  /**
   * Returns the sheet a page is printed on.
   * @param {string} documentId Document file id.
   * @param {number} pageNumber Page number.
   * @param {{forceDuplex?: boolean}} [options] forceDuplex: the sheet of the forced duplex view.
   * @returns {Promise<object>} Sheet.
   */
  async getSheetForPage(documentId, pageNumber, { forceDuplex = false } = {}) {
    const model = await this.#sheetModel(this.#document(documentId), forceDuplex);
    const sheet = model.sheet(model.sheetOfPage[pageNumber]);
    if (!sheet) throw new RangeError(`no page ${pageNumber}`);
    return sheet;
  }

  /**
   * Collects what the Details panel shows about an AFP file (FR-096): name, path and size, the
   * documents in it, number of page groups, pages, fields, TLEs, NOPs (and ISIS tagging NOPs)
   * and inline resources, the form definition choice and the names of missing resources.
   * @param {string} documentId Document file id.
   * @returns {Promise<object>} File details.
   */
  async getFileDetails(documentId) {
    const file = this.#document(documentId);
    const { index } = file;
    const documents = [];
    for (let r = 0; r < index.count; r++) if (index.id[r] === BDT_ID) documents.push(ebcdicName(await fieldData(file, r), 0, 8));
    const nops = await countNops(file);
    const missing = this.diagnostics.list({ fileId: file.id }).filter((d) => d.code === 'missingResource').map((d) => d.params.name);
    return {
      name: file.name, path: file.path, size: file.size, recordFormat: index.recordFormat, fieldCount: index.count,
      documents, pageGroupCount: countIds(index, BNG_ID), pageCount: index.pages.length, tleCount: countIds(index, TLE_ID),
      nopCount: nops.nopCount, isisTagCount: nops.isisTagCount,
      inlineResourceCount: this.catalog.list().filter((e) => e.origin === 'inline' && e.documentFileId === file.id).length,
      formDefinitions: this.listFormDefinitions(documentId), missingResources: [...new Set(missing)].sort(),
    };
  }

  /**
   * Computes the statistics of a file for the Details panel (FR-096, meta/file-stats.js): sheets
   * (and sheets printed with copies), medium map changes, resources used (inline, external,
   * missing), color, page sizes and orientations, code pages and double-byte fonts. It reads the
   * whole file once, so it is cached per file and asked for with low priority. The cache is
   * dropped when files are added (resources may then be found).
   * @param {string} documentId Document file id.
   * @returns {Promise<object>} Statistics.
   */
  async getFileStatistics(documentId) {
    const file = this.#document(documentId);
    const version = this.catalog.version;
    if (!file.statistics || file.statistics.version !== version) {
      const r = await this.#renderContext(file);
      const promise = (async () => fileStatistics(file, {
        sheets: await this.#sheetModel(file, false),
        lookup: (type, name) => this.catalog.lookup(type, name, r.lookupContext),
        getFile: (id) => this.getFileRecord(id),
      }))();
      file.statistics = { version, promise };
    }
    return file.statistics.promise;
  }

  /**
   * Collects what the Details panel shows about a page (FR-097): the page (getPageInfo), its
   * sheet and side, print information, the fonts its environment maps and the page group it is in.
   * @param {string} documentId Document file id.
   * @param {number} pageNumber Page number starting at 1.
   * @returns {Promise<object>} Page details: getPageInfo's fields plus `sheetNumber`, `side`,
   *   `print`, `fonts` (names), `pageGroup` (name or null) and `tles` ("name = value" of the TLEs in
 *   the page and its page groups, see meta/tle.js tlesOfPage); also `byteRange` (Begin … End Page,
 *   for the messages of this page), `copies` and `finishing` of its medium map, `placement`
 *   (`{partition, nUp, side, x, y, rotation}` when several pages share a side, else null) and
 *   `overflow` (content beyond the page edges, render/content-bounds.js pageOverflow, plus
 *   `sheet` when the placed page reaches beyond the paper), null when everything fits.
   */
  async getPageDetails(documentId, pageNumber) {
    const file = this.#document(documentId);
    const info = await this.getPageInfo(documentId, pageNumber);
    const sheet = await this.getSheetForPage(documentId, pageNumber);
    const row = this.#pageRow(file, pageNumber);
    const env = await readEnvironment(file, row);
    const fonts = [...new Set([...env.fonts.values()].map((f) => f.codedFont
      || [f.characterSet, f.codePage].filter(Boolean).join(' / ') || f.dataObject?.name).filter(Boolean))];
    let pageGroup = null;
    for (let r = file.index.parent[row]; r >= 0 && pageGroup === null; r = file.index.parent[r]) {
      if (file.index.id[r] === BNG_ID) pageGroup = ebcdicName(await fieldData(file, r), 0, 8);
    }
    const side = sheet.back?.placements.some((p) => p.pageNumber === pageNumber) ? 'back' : 'front';
    const placed = (side === 'back' ? sheet.back : sheet.front).placements.find((p) => p.pageNumber === pageNumber);
    const end = file.index.end[row] >= 0 ? file.index.end[row] : row;
    const content = pageOverflow(await this.getRenderModel(documentId, pageNumber));
    const onSheet = placed ? placementOverflow(placed, { width: info.widthUnits, height: info.heightUnits }, sheet.mediumSize) : null;
    return {
      ...info, sheetNumber: sheet.number, side,
      print: printInfoOf(sheet), fonts, pageGroup, tles: await tlesOfPage(file, row, this.codePageOverrides.tle),
      byteRange: [file.index.offset[row], file.index.offset[end] + file.index.length[end]],
      copies: sheet.copies, finishing: sheet.finishing,
      mediumOverlays: (side === 'back' && sheet.back?.mediumOverlays) || sheet.mediumOverlays,
      controls: { ...(sheet.controls ?? {}), constantForms: Boolean(sheet.constantForms?.[side]), suppressions: sheet.suppressions?.[side] ?? [] },
      placement: sheet.nUp > 1 && placed ? { partition: placed.partition, nUp: sheet.nUp, side, x: placed.x, y: placed.y, rotation: placed.rotation } : null,
      overflow: content || onSheet ? { ...(content ?? { left: 0, right: 0, top: 0, bottom: 0, kinds: [], count: 0 }), sheet: onSheet } : null,
    };
  }

  /**
   * Returns the print information for the sheet of a page (FR-019).
   * @param {string} documentId Document file id.
   * @param {number} pageNumber Page number.
   * @returns {Promise<{duplex: string, inputBin: number|null, outputBin: number|null,
   *   mediaType: string|null, mediumMap: string|null}>} Print information; null = not specified.
   */
  async getPrintInfo(documentId, pageNumber) {
    return printInfoOf(await this.getSheetForPage(documentId, pageNumber));
  }

  /**
   * Renders one side of a sheet: its pages at their positions plus medium overlays (task T083).
   * @param {string} documentId Document file id.
   * @param {number} sheetNumber Sheet number.
   * @param {'front'|'back'} side Side.
   * @param {{forceDuplex?: boolean}} [options] forceDuplex: a sheet of the forced duplex view.
   * @returns {Promise<{widthUnits: number, heightUnits: number, items: object[], pages: number[],
   *   firstItem: Record<number, number>}>} Render model of the side (empty back side for an odd
   *   final page); `firstItem` gives the index of each page's first item in `items`, so item
   *   indexes of a page model (search highlights) can be found on the sheet.
   */
  async getSheetRenderModel(documentId, sheetNumber, side, { forceDuplex = false } = {}) {
    const file = this.#document(documentId);
    const model = await this.#sheetModel(file, forceDuplex);
    const sheet = model.sheet(sheetNumber);
    if (!sheet) throw new RangeError(`no sheet ${sheetNumber}`);
    const placements = (side === 'back' ? sheet.back?.placements : sheet.front.placements) ?? [];
    const r = await this.#renderContext(file);
    const items = [];
    let width = sheet.mediumSize?.width ?? 0;
    let height = sheet.mediumSize?.height ?? 0;
    const firstItem = {};
    const pageAreas = [];
    for (const p of placements) {
      const page = await this.#renderPageAsPrinted(r, file, p.pageNumber);
      // Constant forms control (MMC X'F9'): this sheet-side shows only its medium overlays.
      if (sheet.constantForms?.[side]) page.items = [];
      firstItem[p.pageNumber] = items.length;
      // The page turns clockwise about its origin, which the PGP offsets place (PGorient, T279).
      const place = { dx: p.x, dy: p.y, rotation: p.rotation ?? 0 };
      const area = placeItem({ type: 'placeholder', rect: { x: 0, y: 0, width: page.widthUnits, height: page.heightUnits } }, place).rect;
      pageAreas.push({ pageNumber: p.pageNumber, x: area.x, y: area.y, width: area.width, height: area.height, rotation: place.rotation, unitsPerInch: page.unitsPerInch });
      width = Math.max(width, area.x + area.width);
      height = Math.max(height, area.y + area.height);
      for (const item of page.items) items.push(placeItem(item, place));
    }
    const overlays = (side === 'back' && sheet.back?.mediumOverlays) || sheet.mediumOverlays;
    for (const name of overlays) {
      const entry = await this.catalog.lookup('overlay', name, r.lookupContext);
      if (!entry) { r.missing('overlay', name); continue; }
      const ov = this.getFileRecord(entry.fileId);
      // Medium overlays come from the form definition, not from a field of the page.
      for (const item of await renderContent(r, ov, entry.beginRow, await readEnvironment(ov, entry.beginRow), { x: 0, y: 0 })) {
        items.push({ ...item, mediumOverlay: name });
      }
    }
    if (!width || !height) {
      const info = await this.getPageInfo(documentId, sheet.front.placements[0]?.pageNumber ?? 1);
      width ||= info.widthUnits;
      height ||= info.heightUnits;
    }
    return { widthUnits: width, heightUnits: height, items, pages: placements.map((p) => p.pageNumber), firstItem, pageAreas };
  }

  /**
   * Returns the text of a page as plain lines in reading order (FR-099 text export): the page's
   * text runs grouped by baseline, top to bottom, each line left to right.
   * @param {string} documentId Document file id.
   * @param {number} pageNumber Page number starting at 1.
   * @returns {Promise<string>} Text with LF line ends.
   */
  async getPageText(documentId, pageNumber) {
    return pageTextLines(await this.getRenderModel(documentId, pageNumber)).join('\n');
  }

  /**
   * Returns the content of an object container (e.g. an embedded PDF for pdf.js); for a JPEG 2000
   * container or a JBIG2 IOCA image, a one-page PDF that shows the image (T311).
   * @param {string} objectRef Reference from a render item ("<fileId>:<row>").
   * @returns {Promise<{format: string, bytes: Uint8Array}>} Format and bytes.
   */
  async getEmbeddedObjectBytes(objectRef) {
    const [fileId, rowText] = String(objectRef).split(':');
    const file = this.getFileRecord(fileId);
    const row = Number(rowText);
    // JBIG2 in an IOCA image and JPEG 2000 in a container are passed to pdf.js as a one-page PDF (T311).
    if (file.index?.id[row] === BEGIN_IMAGE_OBJECT) {
      const jbig2 = await readJbig2Image(file, row);
      if (jbig2.error) throw new RangeError(jbig2.error);
      return { format: 'pdf', bytes: imagePdf({ ...jbig2, filter: 'JBIG2Decode', imageMask: true }) };
    }
    if (file.index?.id[row] !== BEGIN_OBJECT_CONTAINER) throw new RangeError(`not an object container: ${objectRef}`);
    const { format, bytes } = await readContainer(file, row);
    if (format === 'jpeg2000') {
      const hdr = jpeg2000Header(bytes);
      if (!hdr) throw new RangeError(`JPEG 2000 image could not be read: ${objectRef}`);
      return { format: 'pdf', bytes: imagePdf({ data: bytes, width: hdr.width, height: hdr.height, filter: 'JPXDecode' }) };
    }
    return { format, bytes };
  }

  /**
   * Returns the bytes of a TrueType/OpenType font for the viewer's FontFace.
   * @param {string} ref Font reference from a glyph run, or a resource catalog id.
   * @returns {Promise<{fullName: string, bytes: Uint8Array}>} Font name and bytes.
   */
  async getFontBytes(ref) {
    const handle = this.fontHandles.get(ref);
    // A font reference from a glyph run, or a resource id from getResources ("<entry id>[:<font index>]").
    const entry = handle?.entry ?? this.catalog.entries.find((e) => e.id === ref || `${e.id}:${e.fontIndex}` === ref);
    if (!entry || entry.type !== 'truetypeFont') throw new RangeError(`not a TrueType/OpenType font: ${ref}`);
    if (!this.resourceCache.has(entry.id)) this.resourceCache.set(entry.id, fontBytesOf(this.getFileRecord(entry.fileId), entry));
    return { fullName: entry.displayName ?? entry.name, bytes: await this.resourceCache.get(entry.id) };
  }

  /**
   * Lists diagnostics, optionally only for one file and/or severity.
   * @param {{fileId?: string, severity?: 'info'|'warning'|'error'}} [filter] Filter.
   * @returns {object[]} Diagnostics.
   */
  getDiagnostics(filter) {
    return this.diagnostics.list(filter);
  }

  /**
   * Sets the code page used for one category of text, overriding what the file specifies.
   * @param {'nop'|'tle'|'text'} category NOP records, TLEs, or all other text.
   * @param {string|null} id Code page id from listCodePages(), or null to use the file's code page.
   * @returns {void}
   */
  setCodePageOverride(category, id) {
    if (!OVERRIDE_CATEGORIES.includes(category)) throw new TypeError(`invalid category: ${category}`);
    if (id !== null && !catalog().some((cp) => cp.id === id)) throw new RangeError(`unknown code page: ${id}`);
    if (this.codePageOverrides[category] === id) return;
    this.codePageOverrides[category] = id;
    // Page text is decoded differently now: index it again (FR-037, FR-060). Only page text is
    // indexed; TLE and NOP choices do not touch the index.
    if (category === 'text') {
      this.searchIndex.clear();
      this.searchCursor.clear();
      this.searchLimited = null;
    }
  }

  /**
   * Returns the current code page overrides.
   * @returns {{nop: string|null, tle: string|null, text: string|null}} Overrides.
   */
  getCodePageOverrides() {
    return { ...this.codePageOverrides };
  }

  /**
   * Lists every code page the user can choose.
   * @returns {{id: string, label: string, kind: string}[]} Code pages.
   */
  listCodePages() {
    return catalog();
  }

  /**
   * Finds the structured field that contains a byte offset.
   * @param {string} fileId File id.
   * @param {number} offset Byte offset in the file.
   * @returns {number|null} Field index (row), or null if no field covers the offset.
   */
  findFieldAtOffset(fileId, offset) {
    return fieldAtOffset(this.getFileRecord(fileId), offset);
  }

  /**
   * Decodes one structured field (data-model "StructuredField", see modca/fields.js).
   * @param {string} fileId File id.
   * @param {number} fieldIndex Field index (row).
   * @returns {Promise<object>} The field with parameters, triplets, `decoded` and raw bytes.
   */
  async getField(fileId, fieldIndex) {
    return fieldOf(this.getFileRecord(fileId), fieldIndex);
  }

  /**
   * Lists structured fields of a row range (FR-031, FR-033).
   * @param {string} fileId File id.
   * @param {[number, number]} [range] First and last row; the whole file when omitted.
   * @param {{text?: string, ids?: string[]}} [filter] Name or identifier filter.
   * @returns {object[]} Field summaries.
   */
  getFields(fileId, range, filter) {
    return fieldsOf(this.getFileRecord(fileId), range, filter);
  }

  /**
   * Returns the children of a structure tree node, or the top-level nodes (FR-030).
   * @param {string} fileId File id.
   * @param {string} [parentNodeId] Node id.
   * @returns {Promise<object[]>} Tree nodes.
   */
  async getTree(fileId, parentNodeId) {
    return treeOf(this.getFileRecord(fileId), parentNodeId);
  }

  /**
   * Lists the tree node ids from the top level to the node of a field or page (FR-034).
   * @param {string} fileId File id.
   * @param {{row?: number, pageNumber?: number}} target Field row or page number.
   * @returns {string[]} Node ids, top level first.
   */
  getTreePath(fileId, target) {
    const file = this.getFileRecord(fileId);
    const row = target.pageNumber !== undefined ? file.index.pages[target.pageNumber - 1] : target.row;
    if (row === undefined) throw new RangeError(`no page ${target.pageNumber}`);
    return treePath(file, row);
  }

  /**
   * Maps a structured field to its page and to the object render items point to (FR-034).
   * @param {string} fileId File id.
   * @param {number} fieldIndex Field index (row).
   * @returns {{pageNumber: number|null, sourceField: number|null}} Page and object row.
   */
  locate(fileId, fieldIndex) {
    return locateField(this.getFileRecord(fileId), fieldIndex);
  }

  /**
   * Returns a hex display of file bytes (FR-032): rows of 16 bytes with a text column.
   * @param {string} fileId File id.
   * @param {number} offset First byte.
   * @param {number} length Number of bytes (at most 1 MiB per call).
   * @param {string} [codePage] Code page of the text column; default: the `text` override, else
   *   EBCDIC 273.
   * @returns {Promise<{rows: {offset: number, hex: string, text: string}[]}>} Rows.
   */
  async getHex(fileId, offset, length, codePage) {
    const file = this.getFileRecord(fileId);
    const start = Math.max(0, Math.min(offset, file.size));
    const n = Math.max(0, Math.min(length, file.size - start, 1 << 20));
    const bytes = n ? await file.byteSource.read(start, n) : new Uint8Array(0);
    return { rows: await hexRows(bytes, start, codePage ?? this.codePageOverrides.text ?? DEFAULT_CODE_PAGE) };
  }

  /**
   * Lists the Tag Logical Elements of a file (FR-035), decoded with the file's code pages or the
   * `tle` override.
   * @param {string} fileId File id (usually a document).
   * @returns {Promise<object[]>} Data-model Tle objects.
   */
  async getTles(fileId) {
    const file = this.getFileRecord(fileId);
    return decodeTles(await this.#tleStore(file), file.index, this.codePageOverrides.tle);
  }

  /**
   * The undecoded TLEs of a file, collected once (meta/tle.js TleStore).
   * @param {object} file File record.
   * @returns {Promise<import('./meta/tle.js').TleStore>} TLEs.
   */
  #tleStore(file) {
    file.tles ??= collectTles(file, (d) => this.diagnostics.add(d));
    return file.tles;
  }

  /**
   * The TLE table of a file for the current TLE code page, built once per code page choice.
   * @param {string} fileId File id.
   * @returns {Promise<TleTable>} Table.
   */
  async #tleTable(fileId) {
    const file = this.getFileRecord(fileId);
    const override = this.codePageOverrides.tle;
    if (file.tleTable?.override !== override) {
      file.tleTable = {
        override,
        table: (async () => {
          const store = await this.#tleStore(file);
          await loadTleCodePages(store, override);
          const decodeAt = (st, i) => {
            const cp = st.codePagesOf(i, override);
            return { name: printable(decodeBytes(cp.name, st.nameBytes(i))), value: printable(decodeBytes(cp.value, st.valueBytes(i))) };
          };
          return new TleTable(store, decodeAt, (row) => pagesWithin(file.index, row));
        })(),
      };
    }
    return file.tleTable.table;
  }

  /**
   * A window of rows of the TLE table (TLE browser, FR-035): the library keeps the table and the
   * viewer asks for the rows it shows (T230).
   * @param {string} fileId File id.
   * @param {{filter?: string, sort?: {key: string, direction: 'asc'|'desc'}|null, start?: number, count?: number}} [options]
   *   Filter text (see search/text-filter.js), sort column ('owner', 'level', 'pages', 'tle:<name>') and window.
   * @returns {Promise<{columns: string[], total: number, shown: number, start: number, rows: object[]}>}
   *   Attribute names, all rows, rows in the view, and the window's rows (TleRow plus `row`).
   */
  async queryTleTable(fileId, options = {}) {
    return (await this.#tleTable(fileId)).query(options);
  }

  /**
   * Finds the row of a page in a view of the TLE table: its innermost page group, else its own row.
   * @param {string} fileId File id.
   * @param {{filter?: string, sort?: object|null}} options View.
   * @param {number} pageNumber Page number.
   * @returns {Promise<number>} Position in the view, or −1.
   */
  async findTleRowOfPage(fileId, options, pageNumber) {
    return (await this.#tleTable(fileId)).positionOfPage(options ?? {}, pageNumber);
  }

  /**
   * Exports a view of the TLE table as CSV or JSON (FR-035).
   * @param {string} fileId File id.
   * @param {{filter?: string, sort?: object|null}} options View.
   * @param {'csv'|'json'} format Format.
   * @param {{key: string, label: string}[]} columns Columns shown, in order.
   * @param {Record<string, string>} [levelLabels] Owner type → label for the CSV level column.
   * @returns {Promise<string>} File content.
   */
  async exportTleTable(fileId, options, format, columns, levelLabels = {}) {
    return (await this.#tleTable(fileId)).export(options ?? {}, format, columns, levelLabels);
  }

  /**
   * Arranges the TLEs of a file as the TLE browser's table (FR-035): one row per page group (or
   * page, or document) that carries TLEs, one column per attribute name.
   * @param {string} fileId File id.
   * @returns {Promise<{columns: string[], rows: object[]}>} Table (see meta/tle-table.js).
   */
  async getTleTable(fileId) {
    const table = await this.#tleTable(fileId);
    const { columns, rows } = table.query({ count: table.count });
    return { columns, rows: rows.map(({ row, ...r }) => r) };
  }

  /**
   * Lists the NOP records of a file (FR-036), decoded with the `nop` override, else per record in EBCDIC 273 or Windows-1252.
   * @param {string} fileId File id.
   * @returns {Promise<object[]>} Data-model Nop objects with `text` and `hex`.
   */
  async getNops(fileId) {
    return readNops(this.getFileRecord(fileId), this.codePageOverrides.nop);
  }

  /**
   * Lists the XMP metadata of a file (FR-038).
   * @param {string} fileId File id.
   * @returns {Promise<object[]>} Data-model XmpPacket objects.
   */
  async getXmp(fileId) {
    const file = this.getFileRecord(fileId);
    file.xmp ??= readXmpPackets(file, (d) => this.diagnostics.add(d));
    return file.xmp;
  }

  /**
   * Lists the color management resources and ICC profiles of a file (FR-039).
   * @param {string} fileId File id.
   * @returns {Promise<{cmrs: object[], profiles: object[]}>} CMRs and profiles.
   */
  async getColorManagement(fileId) {
    const file = this.getFileRecord(fileId);
    file.colorManagement ??= readColorManagement(file, (d) => this.diagnostics.add(d));
    return file.colorManagement;
  }

  /**
   * Builds the records of all resources (cached per catalog entry) with their duplicates.
   * @returns {Promise<object[]>} Internal records.
   */
  async #resourceRecords() {
    const getFile = (id) => this.getFileRecord(id);
    const records = await Promise.all(this.catalog.list().map((entry) => {
      if (!this.resourceRecords.has(entry.id)) this.resourceRecords.set(entry.id, describeResource(entry, getFile));
      return this.resourceRecords.get(entry.id);
    }));
    linkDuplicates(records);
    linkFontTypes(records);
    return records;
  }

  /**
   * The resources as listed: identical copies combined (catalog.js groupIdentical).
   * @returns {Promise<object[]>} Records, one per group.
   */
  async #listedRecords() {
    return groupIdentical(await this.#resourceRecords(), (id) => this.getFileRecord(id));
  }

  /**
   * Lists the resources of all open files (FR-050–FR-053, data-model "Resource").
   * @param {object} [filter] Filter (see resources/filter.js).
   * @param {{by: string, direction?: 'asc'|'desc'}} [sort] Sort column and direction.
   * @returns {Promise<object[]>} Resources.
   */
  async getResources(filter, sort) {
    let list = filterResources(await this.#listedRecords(), filter ?? {});
    if (sort?.by) list = sortResources(list, sort);
    return list.map(publicRecord);
  }

  /**
   * Lists the values the resource filters can offer, from all loaded resources.
   * @returns {Promise<object>} Options per filter.
   */
  async getFilterOptions() {
    return filterOptions(await this.#listedRecords());
  }

  /**
   * Finds the internal record of a resource.
   * @param {string} resourceId Resource id.
   * @returns {Promise<object>} Record.
   */
  async #resource(resourceId) {
    const r = (await this.#resourceRecords()).find((x) => x.id === resourceId);
    if (!r) throw new RangeError(`unknown resource: ${resourceId}`);
    return r;
  }

  /**
   * Renders a resource for its preview (FR-051, FR-054).
   * @param {string} resourceId Resource id.
   * @returns {Promise<object|null>} Render model with `missingResources` ({type, name}[], see
   *   render/missing.js), or null if the resource has no visual preview.
   */
  async getResourceRenderModel(resourceId) {
    const r = await this.#resource(resourceId);
    const file = this.getFileRecord(r.source.fileId);
    const ctx = await this.#renderContext(file);
    const model = await resourceRenderModel(ctx, file, r, translateItem);
    if (!model) return null;
    const out = await this.#applyTextOverride(model);
    // The preview lists what is missing (FR-054); see render/missing.js.
    return { ...out, missingResources: missingResources(out) };
  }

  /**
   * Lists the characters of a font resource (FR-058).
   * @param {string} resourceId Resource id of a font character set, coded font or
   *   TrueType/OpenType font.
   * @returns {Promise<object|null>} Character grid (see render/resource-renderer.js); for coded
   *   fonts the character map by code point.
   */
  async getFontCharacterGrid(resourceId) {
    const r = await this.#resource(resourceId);
    if (r.type === 'codedFont') {
      const file = this.getFileRecord(r.source.fileId);
      return codedFontGrid(await this.#renderContext(file), file, r);
    }
    return fontCharacterGrid(this.getFileRecord(r.source.fileId), r, (fcs, kind) => {
      const handle = afpGlyphHandle(fcs, kind);
      handle.ref = `font${this.fontHandles.size + 1}`;
      handle.descriptor.ref = handle.ref;
      this.fontHandles.set(handle.ref, handle);
      return handle.ref;
    });
  }

  /**
   * Lists the medium maps of a form definition resource with their settings.
   * @param {string} resourceId Resource id of a form definition.
   * @returns {Promise<{name: string, mediumMaps: object[]}|null>} Form definition (see
   *   formdef/formdef.js, MediumMap), or null for other resources.
   */
  async getFormDefinition(resourceId) {
    const r = await this.#resource(resourceId);
    if (r.type !== 'formDefinition' || r._entry.beginRow < 0) return null;
    return formDefinitionSummary(this.getFileRecord(r.source.fileId), r._entry.beginRow);
  }

  /**
   * Draws one medium map of a form definition resource (sheet sides, numbered page areas,
   * medium overlays).
   * @param {string} resourceId Resource id of a form definition.
   * @param {string|null} mapName Medium map name; null for the first one.
   * @returns {Promise<{widthUnits: number, heightUnits: number, items: object[]}|null>} Render
   *   model, or null for other resources.
   */
  async getFormDefinitionDiagram(resourceId, mapName) {
    const r = await this.#resource(resourceId);
    if (r.type !== 'formDefinition' || r._entry.beginRow < 0) return null;
    const file = this.getFileRecord(r.source.fileId);
    return formDefinitionDiagram(await this.#renderContext(file), file, r._entry.beginRow, mapName ?? null, translateItem);
  }

  /**
   * Lists the code points of a code page resource (FR-058).
   * @param {string} resourceId Resource id.
   * @returns {Promise<object[]|null>} Code page entries.
   */
  async getCodePageTable(resourceId) {
    const r = await this.#resource(resourceId);
    return codePageTable(this.getFileRecord(r.source.fileId), r);
  }

  /**
   * Extracts a resource with its exact original bytes (FR-057).
   * @param {string} resourceId Resource id from getResources.
   * @returns {Promise<{fileName: string, bytes: Uint8Array, mimeType: string}>} The resource.
   */
  async extractResource(resourceId) {
    return extractBytes(await this.#resource(resourceId), (id) => this.getFileRecord(id));
  }

  /**
   * Writes the resource list as CSV (FR-055, contracts/csv-export.md).
   * @param {object[]} resources Resources in display order.
   * @param {Record<string, string>} columnLabels Translated header and value labels.
   * @returns {string} CSV text.
   */
  exportResourcesCsv(resources, columnLabels) {
    return csvText(resources, columnLabels);
  }

  /**
   * The documents whose page text is searched, in file order.
   * @returns {object[]} Document file records.
   */
  #searchDocuments() {
    return [...this.files.values()].filter((f) => f.index && f.kind === 'document');
  }

  /**
   * How far indexing is: pages indexed and pages in all documents. Costs one step per file, so
   * it can run on every call (T230: walking every page here made indexing of 880,000 pages stall).
   * @returns {{done: number, total: number}} Progress.
   */
  #searchProgress() {
    let done = 0;
    let total = 0;
    for (const file of this.#searchDocuments()) {
      const pages = file.index.pages.length;
      total += pages;
      done += Math.min(pages, (this.searchCursor.get(file.id) ?? 1) - 1);
    }
    return { done, total };
  }

  /**
   * Reads the text of a page as the index sees it: its glyph runs joined with blanks.
   * @param {object} file Document file record.
   * @param {number} pageNumber Page number.
   * @returns {Promise<{text: string, runs: {start: number, end: number, itemIndex: number, sourceField: number}[]}|null>}
   *   Text and where each run lies in it, or null if the page cannot be read.
   */
  async #searchText(file, pageNumber) {
    let model;
    try {
      model = await this.getRenderModel(file.id, pageNumber);
    } catch {
      return null;
    }
    let text = '';
    const runs = [];
    model.items.forEach((item, itemIndex) => {
      if (item.type !== 'glyphRun' || !item.text) return;
      if (text) text += ' ';
      runs.push({ start: text.length, end: text.length + item.text.length, itemIndex, sourceField: item.sourceField });
      text += item.text;
    });
    return { text, runs };
  }

  /**
   * Builds the search index for a while (FR-060). Call it repeatedly (at low priority) until
   * `done`; new files and code page changes add work again. Indexing stops for good (`limited`)
   * once the index holds SEARCH_ENTRY_LIMIT word entries, so a huge file cannot exhaust the
   * memory of the worker; searches then cover the pages indexed so far.
   * @param {{budgetMs?: number}} [options] Time to spend before returning (default 50 ms).
   * @returns {Promise<{done: boolean, progress: {done: number, total: number}, limited: object|null}>}
   *   State; `limited` = { pages, totalPages } when indexing stopped at the limit.
   */
  async buildSearchIndex(options = {}) {
    const budget = options.budgetMs ?? 50;
    const start = Date.now();
    for (const file of this.#searchDocuments()) {
      if (this.searchLimited) break;
      const pages = file.index.pages.length;
      let next = this.searchCursor.get(file.id) ?? 1;
      while (next <= pages && Date.now() - start < budget) {
        const page = await this.#searchText(file, next);
        if (page) this.searchIndex.putPage(file.id, next, page.text);
        next++;
        this.searchCursor.set(file.id, next);
        if (this.searchIndex.entries >= this.searchEntryLimit) {
          this.searchLimited = { pages: this.#searchProgress().done, totalPages: this.#searchProgress().total };
          break;
        }
      }
      if (next <= pages) break;
    }
    const progress = this.#searchProgress();
    this.onProgress({ phase: 'search', ...progress });
    return { done: progress.done >= progress.total || Boolean(this.searchLimited), progress, limited: this.searchLimited };
  }

  /**
   * Searches the page text of the open documents (FR-060–FR-062), optionally of one document.
   * Excerpts and the position of the matched word come from reading the page again, so only the
   * first SEARCH_DETAILED results carry them; the others have `resolved: false` and get them from
   * resolveSearchHit when the viewer goes to them.
   * @param {{text: string, fileId?: string}} query Query; `fileId` limits it to one document.
   * @param {number} [limit] Largest number of results (default 200).
   * @returns {Promise<{results: object[], indexing: boolean, limited: object|null}>} Results
   *   (data-model "SearchResult"): best matches first, or in page order when limited to one
   *   document; whether indexing is still in progress; and the memory limit state (see
   *   buildSearchIndex).
   */
  async search(query, limit = 200) {
    const hits = this.searchIndex.search(query).slice(0, limit);
    const results = [];
    for (const [i, hit] of hits.entries()) {
      const result = {
        category: 'text', distance: hit.distance, word: hit.word, resolved: false, excerpt: null, highlight: null, match: null,
        location: { fileId: hit.fileId, pageNumber: hit.pageNumber, tleIndex: null, nopIndex: null, resourceId: null },
      };
      results.push(i < SEARCH_DETAILED ? await this.resolveSearchHit(result) : result);
    }
    const progress = this.#searchProgress();
    return { results, indexing: !this.searchLimited && progress.done < progress.total, limited: this.searchLimited };
  }

  /**
   * Adds the excerpt and the position of the matched word to a search result (see search).
   * @param {object} result Search result.
   * @returns {Promise<object>} The result with `excerpt`, `highlight`, `match` and the glyph run
   *   location (`itemIndex`, `sourceField`, `charStart`, `charEnd`), `resolved: true`.
   */
  async resolveSearchHit(result) {
    if (result.resolved) return result;
    const file = this.files.get(result.location.fileId);
    const page = file ? await this.#searchText(file, result.location.pageNumber) : null;
    const hit = page && describeHit(page.text, page.runs, result.word);
    if (!hit) return { ...result, resolved: true };
    const location = { ...result.location };
    if (hit.run) Object.assign(location, hit.run);
    return { ...result, resolved: true, excerpt: hit.excerpt, highlight: hit.highlight, match: hit.match, location };
  }

  /**
   * Returns the internal record of a file (for library modules, not for the viewer).
   * @param {string} fileId File id.
   * @returns {object} Internal file record with byte source and index.
   */
  getFileRecord(fileId) {
    const file = this.files.get(fileId);
    if (!file) throw new RangeError(`unknown file: ${fileId}`);
    return file;
  }
}

/**
 * Moves a render item by an offset (for pages placed on a sheet).
 * @param {object} item Render item.
 * @param {number} dx X offset in page units.
 * @param {number} dy Y offset in page units.
 * @returns {object} Moved copy.
 */
function translateItem(item, dx, dy) {
  return placeItem(item, { dx, dy });
}

/**
 * Copies the public properties of a file record (plain data, safe to send to the viewer).
 * @param {object} file Internal file record.
 * @returns {AfpFileSummary} Summary.
 */
function summarize(file) {
  const { id, name, path, size, kind, skipReason, source, recordFormat, state, fieldCount, pageCount,
    truncatedAt, fontNames } = file;
  return { id, name, path, size, kind, skipReason, source, recordFormat, state, fieldCount, pageCount,
    truncatedAt, fontNames: [...fontNames] };
}
