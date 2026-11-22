/**
 * Sheet model (FR-014, FR-018, FR-019, task T080, data-model "Sheet"): which pages are printed
 * on which side of which sheet of paper, with the print settings of each sheet.
 *
 * Rules: the active medium map changes at every Invoke Medium Map (IMM) in the document and
 * always starts a new sheet. Without a form definition, a default medium map is used (simplex,
 * one page per side). In duplex mode, pages alternate front/back; an odd final page leaves the
 * back side empty. N-up places several pages on one side at the page positions of the map
 * (partition = position number on the side). The back side of a tumble duplex sheet is turned
 * upside down (orientation 180) relative to the front; normal duplex keeps it upright.
 *
 * Forced duplex (the viewer's "Duplex" choice, FR-018): pages of simplex medium maps are paired
 * front/back in page order as if printed normal duplex, also across Invoke Medium Map, as long as
 * the number of pages per side stays the same. Sheets of duplex medium maps are built as above.
 * Such sheets keep their real duplex mode ('simplex') and are marked `forced`.
 */

import { DEFAULT_MEDIUM_MAP } from './formdef.js';

/**
 * @typedef {object} Sheet
 * @property {number} number Sheet number (1-based).
 * @property {{placements: {pageNumber: number, x: number, y: number, rotation: number, partition: number}[],
 *   orientation: 0|180}} front Front side.
 * @property {{placements: {pageNumber: number, x: number, y: number, rotation: number, partition: number}[],
 *   orientation: 0|180}|null} back Back side (duplex only; orientation 180 for tumble).
 * @property {string|null} mediumMap Name of the medium map.
 * @property {'simplex'|'normal'|'tumble'} duplex Duplex mode.
 * @property {number|null} inputBin Paper tray.
 * @property {number|null} outputBin Output bin.
 * @property {string|null} mediaType Media type.
 * @property {string[]} mediumOverlays Overlays on the front side (and on the back unless the back
 *   side names its own, `back.mediumOverlays`: the second MMC of a duplex copy subgroup pair).
 * @property {{front: boolean, back: boolean}} constantForms Sides that show only medium overlays
 *   (MMC X'F9').
 * @property {{front: number[], back: number[]}} suppressions Active text suppression local IDs
 *   per side (MMC X'F3').
 * @property {object} controls Further MMC controls (jog, quality, cuts, constant forms, set-up ID).
 * @property {number} copies Copies printed of the sheet (medium map copy groups).
 * @property {{operation: string, edge: string|null, count: number}[]} finishing Finishing operations.
 * @property {number} nUp Pages per side.
 * @property {boolean} forced True when a simplex sheet was given a back side by forced duplex; its
 *   back side then carries the medium overlays of its own page's map (`back.mediumOverlays`).
 */

/**
 * The sheets of a document in compact form (T230): mass output has hundreds of thousands of
 * sheets, so the model keeps a few numbers per sheet and per page and builds a Sheet object only
 * when one is asked for (`sheet(number)`). The pages of a sheet are consecutive: sheet n holds
 * pages `firstPage[n − 1]` up to `firstPage[n] − 1`.
 */
export class SheetModel {
  /**
   * @param {number} pageCount Number of pages.
   * @param {object[]} maps Medium maps used (by index).
   */
  constructor(pageCount, maps) {
    this.pageCount = pageCount;
    this.maps = maps;
    this.count = 0;
    /** Sheet number of each page (index 0 unused). */
    this.sheetOfPage = new Int32Array(pageCount + 1);
    /** Medium map (index into `maps`) of each page. */
    this.mapOfPage = new Uint16Array(pageCount + 1);
    /** First page of each sheet, plus pageCount + 1 at the end. */
    this.firstPage = new Int32Array(pageCount + 1);
    /** Per sheet: 1 for forced duplex. */
    this.forced = new Uint8Array(pageCount);
  }

  /**
   * Builds one sheet.
   * @param {number} number Sheet number (1-based).
   * @returns {Sheet|null} Sheet, or null outside the document.
   */
  sheet(number) {
    if (!(number >= 1 && number <= this.count)) return null;
    const first = this.firstPage[number - 1];
    const last = this.firstPage[number] - 1;
    const map = this.maps[this.mapOfPage[first]];
    const forced = this.forced[number - 1] === 1;
    const perSide = Math.max(1, map.nUp);
    const sides = map.duplex === 'simplex' && !forced ? 1 : 2;
    const sheet = {
      number,
      front: { placements: [], orientation: 0 },
      back: sides === 2 ? {
        placements: [], orientation: map.duplex === 'tumble' ? 180 : 0,
        ...(forced ? {} : { mediumOverlays: [...(map.backMediumOverlays ?? map.mediumOverlays)] }),
      } : null,
      mediumMap: map.name, duplex: map.duplex, inputBin: map.inputBin, outputBin: map.outputBin, mediaType: map.mediaType,
      mediumOverlays: [...map.mediumOverlays], mediumSize: map.mediumSize, forced,
      copies: map.copies ?? 1, finishing: [...(map.finishing ?? [])], nUp: perSide,
      constantForms: { ...(map.constantForms ?? { front: false, back: false }) },
      suppressions: { front: [...(map.suppressions?.front ?? [])], back: [...(map.suppressions?.back ?? [])] },
      controls: { ...(map.controls ?? {}) },
    };
    for (let page = first; page <= last; page++) {
      const slot = page - first;
      const pageMap = this.maps[this.mapOfPage[page]];
      const position = pageMap.pagePositions[slot % perSide] ?? pageMap.pagePositions[0] ?? { x: 0, y: 0, rotation: 0 };
      const side = Math.floor(slot / perSide) === 0 ? sheet.front : sheet.back;
      if (forced && side === sheet.back) side.mediumOverlays ??= [...pageMap.mediumOverlays];
      side.placements.push({ pageNumber: page, x: position.x, y: position.y, rotation: position.rotation ?? 0, partition: (slot % perSide) + 1,
        flags: position.flags ?? 0, pmcId: position.pmcId ?? null });
    }
    return sheet;
  }

  /**
   * Sheets that come out of the printer: each sheet times the copies of its medium map.
   * @returns {number} Printed sheets.
   */
  printedSheets() {
    let n = 0;
    for (let s = 0; s < this.count; s++) n += this.maps[this.mapOfPage[this.firstPage[s]]].copies ?? 1;
    return n;
  }

  /**
   * Medium maps in use with their page and sheet counts.
   * @returns {{name: string|null, pages: number, sheets: number}[]} In order of first use.
   */
  mapUsage() {
    const pages = new Array(this.maps.length).fill(0);
    const sheets = new Array(this.maps.length).fill(0);
    for (let p = 1; p <= this.pageCount; p++) pages[this.mapOfPage[p]]++;
    for (let s = 0; s < this.count; s++) sheets[this.mapOfPage[this.firstPage[s]]]++;
    return this.maps.map((m, i) => ({ name: m.name, pages: pages[i], sheets: sheets[i] }));
  }

  /**
   * The layout the page viewer needs, as typed arrays (sent to the viewer instead of all sheets).
   * @returns {{count: number, firstPage: Int32Array, hasBack: Uint8Array}} Sheets: first page of
   *   each (plus pageCount + 1 at the end) and whether a page is on its back side.
   */
  layout() {
    const hasBack = new Uint8Array(this.count);
    for (let n = 1; n <= this.count; n++) {
      const first = this.firstPage[n - 1];
      const map = this.maps[this.mapOfPage[first]];
      const sides = map.duplex === 'simplex' && !this.forced[n - 1] ? 1 : 2;
      hasBack[n - 1] = sides === 2 && this.firstPage[n] - first > Math.max(1, map.nUp) ? 1 : 0;
    }
    return { count: this.count, firstPage: this.firstPage.slice(0, this.count + 1), hasBack };
  }
}

/**
 * Builds the sheet model of a document.
 * @param {number} pageCount Number of pages.
 * @param {(string|null)[]} mapNameByPage Medium map name invoked before each page (index 0 = page 1),
 *   null where no IMM precedes the page.
 * @param {Set<number>} newSheetBefore Page numbers that an IMM directly precedes (start a new sheet).
 * @param {{mediumMaps: Map<string, object>, first: object|null}|null} formdef Form definition, or null.
 * @param {{forceDuplex?: boolean}} [options] forceDuplex: pair the pages of simplex medium maps
 *   front/back (see above).
 * @returns {SheetModel} Sheets.
 */
export function buildSheetModel(pageCount, mapNameByPage, newSheetBefore, formdef, { forceDuplex = false } = {}) {
  const maps = [];
  const mapIndex = new Map();
  const model = new SheetModel(pageCount, maps);
  let current = null;
  let slot = 0;
  const mapFor = (name) => (name && formdef?.mediumMaps.get(name)) || formdef?.first || DEFAULT_MEDIUM_MAP;
  for (let page = 1; page <= pageCount; page++) {
    const map = mapFor(mapNameByPage[page - 1]);
    if (!mapIndex.has(map)) {
      mapIndex.set(map, maps.length);
      maps.push(map);
    }
    const perSide = Math.max(1, map.nUp);
    const forced = forceDuplex && map.duplex === 'simplex';
    const sides = map.duplex === 'simplex' && !forced ? 1 : 2;
    const capacity = perSide * sides;
    const continues = current && slot < capacity && (forced
      ? current.forced && current.perSide === perSide
      : !newSheetBefore.has(page) && current.map === map);
    if (!continues) {
      model.firstPage[model.count] = page;
      model.forced[model.count] = forced ? 1 : 0;
      model.count++;
      current = { map, forced, perSide };
      slot = 0;
    }
    model.mapOfPage[page] = mapIndex.get(map);
    model.sheetOfPage[page] = model.count;
    slot++;
  }
  model.firstPage[model.count] = pageCount + 1;
  return model;
}

/**
 * Builds the sheets of a document as objects (all at once; for small documents and tests, see
 * buildSheetModel).
 * @param {number} pageCount Number of pages.
 * @param {(string|null)[]} mapNameByPage Medium map name invoked before each page.
 * @param {Set<number>} newSheetBefore Page numbers that an IMM directly precedes.
 * @param {{mediumMaps: Map<string, object>, first: object|null}|null} formdef Form definition, or null.
 * @param {{forceDuplex?: boolean}} [options] forceDuplex.
 * @returns {{sheets: Sheet[], sheetOfPage: number[]}} Sheets and the sheet number of each page.
 */
export function buildSheets(pageCount, mapNameByPage, newSheetBefore, formdef, options = {}) {
  const model = buildSheetModel(pageCount, mapNameByPage, newSheetBefore, formdef, options);
  const sheets = [];
  for (let n = 1; n <= model.count; n++) sheets.push(model.sheet(n));
  return { sheets, sheetOfPage: [...model.sheetOfPage] };
}

/**
 * Returns the print information of a sheet (FR-019); null means "not specified".
 * @param {Sheet} sheet Sheet.
 * @returns {{duplex: string, inputBin: number|null, outputBin: number|null, mediaType: string|null,
 *   mediumMap: string|null}} Print information.
 */
export function printInfoOf(sheet) {
  return { duplex: sheet.duplex, inputBin: sheet.inputBin, outputBin: sheet.outputBin, mediaType: sheet.mediaType, mediumMap: sheet.mediumMap };
}
