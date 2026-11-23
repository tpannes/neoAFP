/**
 * Resource resolution (FR-020, FR-021, data-model "ResourceCatalog"): finds the page segments,
 * overlays, fonts, code pages, form definitions and other resources a document refers to by name.
 *
 * Lookup order: the document's own inline resource group, then files from the opened folder,
 * then individually opened files. Among same-named resources outside the inline group, the one
 * whose resolution equals the document's is preferred, then the closest higher, then the closest
 * lower resolution (e.g. fonts240/, fonts300/, fonts600/ copies of the same font). When several
 * candidates exist, a `duplicateResource` diagnostic names the chosen one.
 *
 * TrueType/OpenType references are matched by full font name (case-insensitive).
 */

import { ebcdicName, u } from '../modca/bytes.js';
import { fieldData, collectFields } from '../modca/access.js';
import { decodeBeginName } from '../modca/structures.js';
import { isFontOid } from '../objcontainer/object-types.js';

/** Begin field category → resource type. */
const BEGIN_TYPE = new Map([
  [0x5f, 'pageSegment'], [0xdf, 'overlay'], [0x89, 'fontCharacterSet'], [0x87, 'codePage'],
  [0x8a, 'codedFont'], [0xcd, 'formDefinition'], [0xfb, 'image'], [0x7b, 'image'],
  [0xbb, 'graphics'], [0xeb, 'barcode'], [0x92, 'objectContainer'], [0x77, 'colorAttributeTable'],
]);

/** File kinds that are single resources (named after their Begin field or the file name). */
const RESOURCE_KINDS = new Set(['pageSegment', 'overlay', 'fontCharacterSet', 'codePage', 'codedFont',
  'formDefinition', 'otherResource']);

const BRG = 0xd3a8c6;
const BRS = 0xd3a8ce;
const FNC = 0xd3a789;
const IID = 0xd3a67b;
const IDD = 0xd3a6fb;

/**
 * @typedef {object} ResourceEntry
 * @property {string} id Unique id: "<fileId>:<beginRow>".
 * @property {string} type Resource type, e.g. 'fontCharacterSet'.
 * @property {string} name Name used for lookup (upper-case for AFP names).
 * @property {string|null} [displayName] Name shown to the user: the full name of TrueType fonts;
 *   for resource files the file name without extension (as written), which is what users know the
 *   file by, also when it is no valid AFP name and the lookup name is the Begin field's.
 * @property {string} fileId File containing it.
 * @property {number} beginRow Row of the resource's Begin field.
 * @property {'inline'|'folder'|'file'} origin Where it comes from.
 * @property {number|undefined|null} resolution Resolution in dpi (computed when needed).
 */

/**
 * Strips folders and the extension from a file name and upper-cases it, e.g. "pseg/S1NEOSEG.240" → "S1NEOSEG".
 * @param {string} fileName File name.
 * @returns {string} Name stem.
 */
function stem(fileName) {
  return fileName.split(/[\\/]/).pop().replace(/\.[^.]*$/, '').toUpperCase();
}

/**
 * Catalog of all resources of the open files, with name lookup.
 */
export class ResourceCatalog {
  /**
   * Creates an empty catalog.
   * @param {(fileId: string) => object} getFile Returns the internal record of a file.
   * @param {(d: object) => void} report Records a diagnostic.
   */
  constructor(getFile, report) {
    this.getFile = getFile;
    this.report = report;
    /** @type {Map<string, ResourceEntry[]>} "type:name" → entries in registration order */
    this.byName = new Map();
    /** @type {ResourceEntry[]} */
    this.entries = [];
    this.reportedDuplicates = new Set();
    this.version = 0;
  }

  /**
   * Adds a resource entry.
   * @param {Omit<ResourceEntry, 'id'> & {aliases?: string[]}} entry Entry without id; `aliases` are
 *   further names it is found by.
   * @returns {void}
   */
  #add(entry) {
    const { aliases = [], ...rest } = entry;
    const full = { ...rest, id: `${entry.fileId}:${entry.beginRow}`, resolution: undefined };
    for (const name of new Set([full.name, ...aliases].map((n) => n.toUpperCase()))) {
      const key = `${full.type}:${name}`;
      if (!this.byName.has(key)) this.byName.set(key, []);
      this.byName.get(key).push(full);
    }
    this.entries.push(full);
  }

  /**
   * Registers the resources of a newly added file: the file itself if it is a resource, and the
   * members of every resource group in it (inline resources of a document, or the resources of a
   * resource group file).
   * @param {object} file Internal file record (with index and kind).
   * @returns {Promise<void>} Resolves when registered.
   */
  async addFile(file) {
    this.version++;
    if (file.kind === 'iccProfile') {
      // A stand-alone ICC profile file is a resource of its own, named like the file (T308).
      const displayName = file.name.split(/[\\/]/).pop().replace(/\.[^.]*$/, '') || file.name;
      this.#add({ type: 'iccProfile', name: displayName.toUpperCase(), displayName, fileId: file.id, beginRow: -1, origin: file.source });
      return;
    }
    if (file.kind === 'truetypeFont') {
      for (const font of file.fontNames ?? []) {
        this.#add({ type: 'truetypeFont', name: font.fullName.toUpperCase(), displayName: font.fullName, fileId: file.id, beginRow: -1,
          origin: file.source, fontIndex: font.index ?? 0 });
      }
      return;
    }
    const { index } = file;
    if (!index) return;
    if (RESOURCE_KINDS.has(file.kind)) {
      for (let row = 0; row < index.count; row++) {
        const id = index.id[row];
        if (index.parent[row] !== -1 && index.id[index.parent[row]] !== BRS) continue;
        if ((id >> 8) !== 0xd3a8 || !BEGIN_TYPE.has(id & 0xff)) continue;
        // Resource libraries are searched by member (file) name — used when it is a valid AFP name
        // (1–8 characters A–Z, 0–9, @, #, $) —; the name in the Begin field can differ (e.g. a file C0ABC123.CHS that holds Begin Font C0ABC12I) and is kept as
        // an additional lookup name.
        const internal = ebcdicName(await fieldData(file, row));
        const member = stem(file.name);
        const name = /^[A-Z0-9@#$]{1,8}$/.test(member) ? member : internal || member;
        const displayName = file.name.split(/[\\/]/).pop().replace(/\.[^.]*$/, '') || name;
        this.#add({ type: BEGIN_TYPE.get(id & 0xff), name, displayName, aliases: internal ? [internal] : [], fileId: file.id, beginRow: row, origin: file.source });
        break; // one resource per resource file
      }
    }
    for (let row = 0; row < index.count; row++) {
      if (index.id[row] !== BRG) continue;
      for (const child of index.children(row)) {
        if (index.id[child] !== BRS) continue;
        await this.#addInline(file, child);
      }
    }
  }

  /**
   * Registers one inline resource (Begin Resource inside a resource group).
   * @param {object} file Internal file record.
   * @param {number} brsRow Row of the Begin Resource field.
   * @returns {Promise<void>} Resolves when registered.
   */
  async #addInline(file, brsRow) {
    const { index } = file;
    const info = decodeBeginName(await fieldData(file, brsRow), 10);
    const inner = index.children(brsRow).find((r) => (index.id[r] >> 8) === 0xd3a8 && BEGIN_TYPE.has(index.id[r] & 0xff));
    if (inner === undefined) return;
    let type = BEGIN_TYPE.get(index.id[inner] & 0xff);
    let name = info.name;
    let displayName = null;
    if (type === 'objectContainer') {
      const oc = decodeBeginName(await fieldData(file, inner), 8);
      if (isFontOid(oc.oid) || isFontOid(info.oid)) {
        type = 'truetypeFont';
        displayName = info.fullName ?? oc.fullName ?? name;
        name = displayName.toUpperCase();
      } else {
        name = name || oc.name;
      }
    }
    if (!name) name = ebcdicName(await fieldData(file, inner));
    // Resource groups of a document are its inline resources; those of a separate resource file
    // (e.g. a resource group written next to a document) serve every document, like any other
    // opened resource file (FR-020).
    if (file.kind === 'document') this.#add({ type, name, displayName, fileId: file.id, beginRow: inner, origin: 'inline', documentFileId: file.id });
    else this.#add({ type, name, displayName, fileId: file.id, beginRow: inner, origin: file.source });
  }

  /**
   * Finds a resource by type and name.
   * @param {string} type Resource type.
   * @param {string} name Resource name (AFP name or full font name).
   * @param {{documentFileId?: string, resolution?: number|null}} [context] Requesting document and
   *   its resolution (null = unknown, which prefers the highest resolution).
   * @returns {Promise<ResourceEntry|null>} The chosen resource, or null if missing.
   */
  async lookup(type, name, context = {}) {
    const all = this.byName.get(`${type}:${name.toUpperCase()}`) ?? [];
    const inline = all.filter((e) => e.origin === 'inline' && e.documentFileId === context.documentFileId);
    if (inline.length) return inline[0];
    const outside = all.filter((e) => e.origin !== 'inline');
    if (outside.length === 0) return null;
    let chosen = outside[0];
    if (outside.length > 1) {
      for (const e of outside) if (e.resolution === undefined) e.resolution = await this.#resolutionOf(e);
      chosen = [...outside].sort((a, b) => compareCandidates(a, b, context.resolution ?? null))[0];
      const key = `${type}:${name}:${context.documentFileId}`;
      if (!this.reportedDuplicates.has(key)) {
        this.reportedDuplicates.add(key);
        const chosenFile = this.getFile(chosen.fileId);
        this.report({
          severity: 'info', code: 'duplicateResource', fileId: context.documentFileId ?? null,
          params: { name, chosen: chosenFile.path, count: outside.length },
        });
      }
    }
    return chosen;
  }

  /**
   * Determines a resource's resolution: raster fonts from Font Control, page segments and
   * overlays from the first IM image or IOCA image they contain.
   * @param {ResourceEntry} entry Resource.
   * @returns {Promise<number|null>} Resolution in dpi, or null if not known.
   */
  async #resolutionOf(entry) {
    const file = this.getFile(entry.fileId);
    if (entry.beginRow < 0) return null;
    const fields = await collectFields(file, entry.beginRow, new Set([FNC, IID, IDD]));
    for (const { id, data } of fields) {
      if (id === FNC && data[1] === 0x05 && data[4] === 0) return u(data, 6, 2) / 10;
      if (id === IID && data[12] === 0) return u(data, 14, 2) / 10;
      if (id === IDD && data[0] === 0) return u(data, 1, 2) / 10;
    }
    return null;
  }

  /**
   * Lists all resource entries.
   * @returns {ResourceEntry[]} Entries.
   */
  list() {
    return [...this.entries];
  }

  /**
   * Removes all entries.
   * @returns {void}
   */
  clear() {
    this.byName.clear();
    this.entries = [];
    this.reportedDuplicates.clear();
    this.version++;
  }
}

/**
 * Orders two resource candidates: folder files before individually opened files; then equal
 * resolution, then closest higher, then closest lower (unknown resolutions last).
 * @param {ResourceEntry} a Candidate.
 * @param {ResourceEntry} b Candidate.
 * @param {number|null} target Document resolution (null = prefer the highest).
 * @returns {number} Negative if a comes first.
 */
export function compareCandidates(a, b, target) {
  const originRank = (e) => (e.origin === 'folder' ? 0 : 1);
  if (originRank(a) !== originRank(b)) return originRank(a) - originRank(b);
  const rank = (e) => {
    const r = e.resolution;
    if (r === null || r === undefined) return [3, 0];
    if (target === null) return [1, -r]; // unknown target: highest first
    if (r === target) return [0, 0];
    return r > target ? [1, r - target] : [2, target - r];
  };
  const [ra, da] = rank(a);
  const [rb, db] = rank(b);
  return ra - rb || da - db;
}
