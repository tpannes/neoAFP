/**
 * File statistics for the Details panel (FR-096): what a whole print file needs — sheets, medium
 * map changes, the resources it uses, whether it prints in color, the page sizes and orientations
 * that occur, and the code pages and double-byte fonts of its text.
 *
 * One pass over the file in file order (sequentialReader, so mass output of several GB stays
 * usable) reads only the fields that matter:
 * - Page Descriptor (PGD) of each page (in its Active Environment Group) → page sizes;
 * - Map Coded Font (MCF-1/MCF-2) and Map Data Resource (MDR, TrueType fonts) → fonts;
 * - Include Page Segment / Overlay / Object (IPS, IPO, IOB) → resources used;
 * - color sources: text color control sequences (STC X'74', SEC X'80' in PTX), IOCA image color
 *   model (first Image Picture Data of each image), IM image color (IID), GOCA colors (GSCOL,
 *   GSECOL, GSPCOL in Graphics Data), bar code color (BDD), image files in object containers
 *   (first data field).
 * External overlays and page segments the file includes (and the medium overlays of the medium
 * maps in use) are scanned for colors and fonts the same way. Black, white, gray and the
 * default color do not count as color; for images, an RGB or CMYK color model counts.
 * Resources are counted by distinct name and sorted by where they were found: inline (in the
 * file's resource group), external (folder or opened files) or missing.
 */

import { sequentialReader, innerRange } from '../modca/access.js';
import { u, toPageUnits } from '../modca/bytes.js';
import { decodePGD, decodeMCF1, decodeMCF2, decodeMDR, decodeInclude, decodeIOB, decodeBeginName } from '../modca/structures.js';
import { NAMED_COLORS, extendedColor } from '../ptoca/ptoca.js';
import { splitOrders } from '../goca/goca.js';
import { readBsd } from '../bcoca/bcoca.js';
import { iocaColorModel, imageColorModel } from '../resources/color-model.js';
import { containerFormat } from '../objcontainer/object-container.js';
import { readCodedFont } from '../foca/coded-font.js';
import { readCodePage } from '../foca/code-page.js';

const ID = {
  BPG: 0xd3a8af, BAG: 0xd3a8c9, PGD: 0xd3a6af, MCF1: 0xd3b18a, MCF2: 0xd3ab8a, MDR: 0xd3abc3, IPS: 0xd3af5f,
  IPO: 0xd3afd8, IOB: 0xd3afc3, IMM: 0xd3abcc, PTX: 0xd3ee9b, BIM: 0xd3a8fb, IPD: 0xd3eefb, IID: 0xd3a67b,
  GAD: 0xd3eebb, BDD: 0xd3a6eb, BOC: 0xd3a892, OCD: 0xd3ee92,
};

/** Default page size when a page has no Page Descriptor (8.5 × 11 in), page units. */
const DEFAULT_SIZE = { width: 12240, height: 15840 };

/** Paper formats recognized (portrait, mm); a size matches within 2 mm. */
const FORMATS = [
  ['A3', 297, 420], ['A4', 210, 297], ['A5', 148, 210], ['A6', 105, 148], ['B5', 176, 250], ['C5', 162, 229],
  ['DL', 110, 220], ['Letter', 215.9, 279.4], ['Legal', 215.9, 355.6],
];

/** Image formats in object containers whose color model can be read. */
const IMAGE_FORMATS = new Set(['jpeg', 'png', 'gif', 'tiff']);

/** Color spaces of extended colors (SEC, GSPCOL, Color Specification). */
const SPACES = { 0x01: 'rgb', 0x04: 'cmyk', 0x06: 'highlight', 0x08: 'cielab', 0x40: 'oca' };

/**
 * Tells whether an RGB color is a real color (not black, white or gray).
 * @param {string|null} hex "#rrggbb".
 * @returns {boolean} True for a color.
 */
export function isColor(hex) {
  if (!hex) return false;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) > 12;
}

/**
 * Names the paper format of a page size.
 * @param {number} w Width in mm.
 * @param {number} h Height in mm.
 * @returns {string|null} Format name (A4, Letter …) or null.
 */
export function formatName(w, h) {
  const [a, b] = w <= h ? [w, h] : [h, w];
  return FORMATS.find(([, fw, fh]) => Math.abs(a - fw) <= 2 && Math.abs(b - fh) <= 2)?.[0] ?? null;
}

/**
 * Lists the control sequences of presentation text data (chains start with X'2BD3'; a chained
 * sequence has an odd type and is followed directly by the next one).
 * @param {Uint8Array} d PTX data.
 * @returns {Generator<{type: number, data: Uint8Array}>} Sequences with the chaining bit cleared.
 */
function* controlSequences(d) {
  let pos = 0;
  while (pos + 1 < d.length) {
    if (d[pos] !== 0x2b || d[pos + 1] !== 0xd3) { pos++; continue; }
    pos += 2;
    let chained = true;
    while (chained && pos + 1 < d.length) {
      const len = d[pos];
      const type = d[pos + 1];
      if (len < 2) return;
      yield { type: type & 0xfe, data: d.subarray(pos + 2, pos + len) };
      chained = (type & 1) === 1;
      pos += len;
    }
  }
}

/** Collects colors found. */
class ColorFinder {
  constructor() {
    this.sources = new Set();
    this.models = new Set();
  }

  /**
   * Notes a color.
   * @param {string} source text, image, graphics or barcode.
   * @param {string|null} hex RGB color.
   * @param {string} model Color space (rgb, cmyk, highlight, cielab, oca).
   * @returns {void}
   */
  add(source, hex, model) {
    if (!isColor(hex)) return;
    this.sources.add(source);
    this.models.add(model);
  }

  /**
   * Notes an extended color (SEC, GSPCOL) by its data.
   * @param {string} source Source.
   * @param {Uint8Array} d Data: reserved (1), color space (1), …, values from byte 10.
   * @returns {void}
   */
  extended(source, d) {
    const space = SPACES[d[1]] ?? 'other';
    // Highlight colors are numbered, not RGB: any highlight other than 0 (default) is a color.
    if (space === 'highlight') {
      if (u(d.subarray(10), 0, 2)) { this.sources.add(source); this.models.add(space); }
      return;
    }
    this.add(source, extendedColor(d), space);
  }

  /**
   * Notes the color model of an image.
   * @param {'rgb'|'cmyk'|null} model Model.
   * @returns {void}
   */
  image(model) {
    if (!model) return;
    this.sources.add('image');
    this.models.add(model);
  }
}

/**
 * Scans fields of a file range for colors and resource references.
 * @param {object} file File record.
 * @param {number} from First row.
 * @param {number} to Row after the last.
 * @param {object} found Collector: colors (ColorFinder), fonts (Map key → spec), includes (Map
 *   "type:name" → {type, name}), pageSizes (Map, only for the document itself), imms (count).
 * @param {boolean} isDocument True for the document file (page sizes and IMMs are counted).
 * @returns {Promise<void>} Resolves when scanned.
 */
async function scan(file, from, to, found, isDocument) {
  const { index } = file;
  const read = sequentialReader(file);
  // The file's own pages (pages of documents kept in a resource group for Include Page are not).
  const ownPages = isDocument ? new Set(index.pages) : null;
  let checkedImage = -1;
  let containerOid = new Map();
  let checkedContainer = -1;
  for (let row = from; row < to; row++) {
    const id = index.id[row];
    switch (id) {
      case ID.PGD: {
        if (!isDocument) break;
        const bag = index.parent[row];
        if (bag < 0 || index.id[bag] !== ID.BAG || !ownPages.has(index.parent[bag])) break;
        const pgd = decodePGD(await read(row));
        const size = pgd.width > 0 && pgd.height > 0 && pgd.xUnits > 0 && pgd.yUnits > 0
          ? { width: pgd.width * toPageUnits(pgd.xBase, pgd.xUnits), height: pgd.height * toPageUnits(pgd.yBase, pgd.yUnits) } : DEFAULT_SIZE;
        found.pagesWithSize++;
        const key = `${Math.round(size.width / 1440 * 254)}x${Math.round(size.height / 1440 * 254)}`;
        found.pageSizes.set(key, (found.pageSizes.get(key) ?? 0) + 1);
        break;
      }
      case ID.MCF1:
      case ID.MCF2:
        for (const m of (id === ID.MCF1 ? decodeMCF1 : decodeMCF2)(await read(row))) {
          if (m.codedFont) found.fonts.set(`codedFont:${m.codedFont}`, { type: 'codedFont', name: m.codedFont });
          else if (m.characterSet) {
            found.fonts.set(`fontCharacterSet:${m.characterSet}`, { type: 'fontCharacterSet', name: m.characterSet, codePage: m.codePage });
          }
          if (m.codePage) found.codePageNames.add(m.codePage);
        }
        break;
      case ID.MDR:
        for (const m of decodeMDR(await read(row))) {
          if (m.font && m.name) found.fonts.set(`truetypeFont:${m.name}`, { type: 'truetypeFont', name: m.name });
        }
        break;
      case ID.IPS:
      case ID.IPO: {
        const { name } = decodeInclude(await read(row));
        const type = id === ID.IPO ? 'overlay' : 'pageSegment';
        if (name) found.includes.set(`${type}:${name}`, { type, name });
        break;
      }
      case ID.IOB: {
        const iob = decodeIOB(await read(row));
        const type = iob.objectType === 0x5f ? 'pageSegment' : 'object';
        if (iob.name) found.includes.set(`${type}:${iob.name}`, { type, name: iob.name, objectType: iob.objectType });
        break;
      }
      case ID.IMM:
        if (isDocument) found.imms++;
        break;
      case ID.PTX:
        for (const cs of controlSequences(await read(row))) {
          if (cs.type === 0x74 && cs.data.length >= 2) found.colors.add('text', NAMED_COLORS[u(cs.data, 0, 2)] ?? null, 'oca');
          else if (cs.type === 0x80 && cs.data.length >= 11) found.colors.extended('text', cs.data);
        }
        break;
      case ID.IPD: {
        const parent = index.parent[row];
        if (parent === checkedImage || index.id[parent] !== ID.BIM) break;
        checkedImage = parent;
        found.colors.image(iocaColorModel(await read(row)));
        break;
      }
      case ID.IID: {
        const d = await read(row);
        if (d.length >= 36) found.colors.add('image', NAMED_COLORS[u(d, 34, 2)] ?? null, 'oca');
        break;
      }
      case ID.GAD:
        for (const o of splitOrders(await read(row))) {
          if (o.code === 0x0a && o.data.length) found.colors.add('graphics', NAMED_COLORS[o.data[0]] ?? null, 'oca');
          else if (o.code === 0x26 && o.data.length >= 2) found.colors.add('graphics', NAMED_COLORS[u(o.data, 0, 2)] ?? null, 'oca');
          else if (o.code === 0xb2 && o.data.length >= 11) found.colors.extended('graphics', o.data);
        }
        break;
      case ID.BDD: {
        const bsd = readBsd(await read(row));
        found.colors.add('barcode', bsd.color, 'oca');
        break;
      }
      case ID.BOC:
        containerOid.set(row, decodeBeginName(await read(row), 8).oid);
        break;
      case ID.OCD: {
        const parent = index.parent[row];
        if (parent === checkedContainer || index.id[parent] !== ID.BOC) break;
        checkedContainer = parent;
        const head = (await read(row)).slice();
        const format = containerFormat(head, containerOid.get(parent) ?? null);
        if (IMAGE_FORMATS.has(format)) found.colors.image(imageColorModel(head, format));
        if (containerOid.size > 1000) containerOid = new Map();
        break;
      }
      default:
    }
  }
}

/**
 * Computes the statistics of a document file.
 * @param {object} file Document file record.
 * @param {object} ctx Services.
 * @param {object} ctx.sheets Sheet model (formdef/sheets.js SheetModel).
 * @param {(type: string, name: string) => Promise<object|null>} ctx.lookup Finds a resource entry.
 * @param {(fileId: string) => object} ctx.getFile Returns a file record.
 * @returns {Promise<object>} `{ sheets, printedSheets, mediumMaps: {invocations, used: [{name,
 *   pages, sheets}]}, pageSizes: [{widthMm, heightMm, orientation, format, pages}], resources:
 *   {fonts, overlays, pageSegments, objects: {inline, external, missing}}, color: {colored,
 *   sources, models}, codePages: [{name, cpgid, doubleByte, missing}], doubleByteFonts: string[],
 *   trueType: boolean }`.
 */
export async function fileStatistics(file, { sheets, lookup, getFile }) {
  const found = {
    colors: new ColorFinder(), fonts: new Map(), includes: new Map(), pageSizes: new Map(), pagesWithSize: 0, imms: 0,
    codePageNames: new Set(),
  };
  await scan(file, 0, file.index.count, found, true);
  // Pages without a Page Descriptor count with the default size.
  const missingSize = file.index.pages.length - found.pagesWithSize;
  if (missingSize > 0) {
    const key = `${Math.round(DEFAULT_SIZE.width / 1440 * 254)}x${Math.round(DEFAULT_SIZE.height / 1440 * 254)}`;
    found.pageSizes.set(key, (found.pageSizes.get(key) ?? 0) + missingSize);
  }
  // Medium overlays of the medium maps in use.
  for (const m of sheets.maps) for (const name of m.mediumOverlays ?? []) found.includes.set(`overlay:${name}`, { type: 'overlay', name });

  // Where each resource comes from; external overlays and page segments are scanned too.
  const resources = { fonts: count(), overlays: count(), pageSegments: count(), objects: count() };
  const scanned = new Set();
  const place = async (bucket, type, name) => {
    const entry = await lookup(type, name);
    if (!entry) bucket.missing++;
    else if (entry.origin === 'inline') bucket.inline++;
    else bucket.external++;
    return entry;
  };
  for (const inc of found.includes.values()) {
    const bucket = inc.type === 'overlay' ? resources.overlays : inc.type === 'pageSegment' ? resources.pageSegments : resources.objects;
    const type = inc.type === 'object' ? (inc.objectType === 0xfb ? 'image' : inc.objectType === 0xbb ? 'graphics' : inc.objectType === 0xeb ? 'barcode' : 'objectContainer') : inc.type;
    const entry = await place(bucket, type, inc.name);
    if (entry && entry.origin !== 'inline' && entry.beginRow >= 0 && !scanned.has(entry.id)) {
      scanned.add(entry.id);
      const res = getFile(entry.fileId);
      const [from, to] = innerRange(res.index, entry.beginRow);
      await scan(res, from, to, found, false);
    }
  }
  const codePages = new Map();
  const doubleByteFonts = new Set();
  for (const f of found.fonts.values()) {
    const entry = await place(resources.fonts, f.type, f.name);
    if (f.type === 'codedFont' && entry) {
      const cf = await readCodedFont(getFile(entry.fileId), entry.beginRow);
      for (const p of cf.parts) if (p.cpName) codePages.set(p.cpName, null);
      if (cf.parts.length > 1 || cf.parts.some((p) => p.section > 0)) doubleByteFonts.add(f.name);
      f.parts = cf.parts;
    }
  }
  for (const name of found.codePageNames) codePages.set(name, null);
  const doubleBytePages = new Set();
  for (const name of codePages.keys()) {
    const entry = await lookup('codePage', name);
    if (!entry) { codePages.set(name, { name, cpgid: null, doubleByte: null, missing: true }); continue; }
    const cp = await readCodePage(getFile(entry.fileId), entry.beginRow);
    codePages.set(name, { name, cpgid: cp.cpgid || null, doubleByte: Boolean(cp.doubleByte), missing: false });
    if (cp.doubleByte) doubleBytePages.add(name);
  }
  for (const f of found.fonts.values()) {
    if (f.parts?.some((p) => doubleBytePages.has(p.cpName))) doubleByteFonts.add(f.name);
  }

  const pageSizes = [...found.pageSizes].map(([key, pages]) => {
    const [w, h] = key.split('x').map((v) => Number(v) / 10);
    return { widthMm: w, heightMm: h, orientation: w > h ? 'landscape' : 'portrait', format: formatName(w, h), pages };
  }).sort((a, b) => b.pages - a.pages);
  return {
    sheets: sheets.count,
    printedSheets: sheets.printedSheets(),
    mediumMaps: { invocations: found.imms, used: sheets.mapUsage() },
    pageSizes,
    resources,
    color: { colored: found.colors.sources.size > 0, sources: [...found.colors.sources], models: [...found.colors.models] },
    codePages: [...codePages.values()].sort((a, b) => a.name.localeCompare(b.name)),
    doubleByteFonts: [...doubleByteFonts].sort(),
    trueType: [...found.fonts.values()].some((f) => f.type === 'truetypeFont'),
  };
}

/**
 * Creates an empty counter of resources by origin.
 * @returns {{inline: number, external: number, missing: number}} Counter.
 */
function count() {
  return { inline: 0, external: 0, missing: 0 };
}

