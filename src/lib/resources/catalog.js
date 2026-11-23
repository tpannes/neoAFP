/**
 * Resource records for the resource viewer (FR-050–FR-053, data-model "Resource"): one record per
 * entry of the ResourceCatalog, with type, source and byte range, file size, dimensions and size
 * class, resolution, color profile, encoding, whether a preview exists, and the other sources of
 * the same name (FR-081).
 *
 * - Types: the catalog's types, with object containers refined to `colorManagementResource`
 *   (object type OID 1.3.18.0.4.1.1.57) and `iccProfile` (data with the ICC 'acsp' signature).
 * - Byte range and size: the whole file for resource files and TrueType/OpenType font files; the
 *   object's Begin … End fields for members of resource groups; for object containers the range
 *   of Begin … End Object Container, while the size is that of the contained data, which is what
 *   extraction returns (FR-057).
 * - Dimensions: overlays from their Page Descriptor; page segments from the union of their
 *   objects' areas (Object Area Descriptor and Position, IM image size and offset); images,
 *   graphics, bar codes and object containers from their object area, else from the image header
 *   (IOCA Image Data Descriptor, JPEG/PNG/GIF/TIFF header) or the PDF media box.
 * - Resolution: raster fonts from Font Control; page segments, overlays and images from their
 *   first IM or IOCA image; object container images from their header.
 * - Encoding: font technology (Raster, Type 1, CID-keyed), "IOCA, <compression>", "IM image",
 *   "GOCA", "BCOCA", the container format, "CMR <type>", the ICC color space, TrueType/OpenType.
 * - Color profile: the description of an ICC profile in the resource (ICC profile, CMR, image
 *   with an embedded profile).
 * - Name and internal name: the name is the file name without extension for resource files
 *   (S1NEOSEG for S1NEOSEG.PSG), the Begin Resource name for inline resources, the full name of
 *   TrueType fonts; the internal name is the one in the resource's own Begin field (e.g. Begin Page
 *   Segment "70001"), null for TrueType fonts. Duplicates are found by lookup name (FR-081).
 * - Font types (FONT_TYPES_ORDER): of a font character set its pattern technology (raster,
 *   Type 1, CID-keyed); of a TrueType resource its format (TrueType, OpenType with CFF outlines,
 *   TrueType collection); of a coded font those of its character sets; of an overlay or page
 *   segment those of the fonts it maps. Coded fonts, overlays and page segments only get theirs
 *   in linkFontTypes, once all records exist; fonts that are not loaded add nothing.
 */

import { fieldData, childRows, innerRange } from '../modca/access.js';
import { u, s, toPageUnits, ebcdicName } from '../modca/bytes.js';
import { decodeBeginName } from '../modca/structures.js';
import { readEnvironment, readObjectArea } from '../render/page-renderer.js';
import { readContainer, containerFormat, imageHeader, pdfPageSize } from '../objcontainer/object-container.js';
import { COMPRESSIONS, selfDefiningFields } from '../ioca/ioca.js';
import { parseIccProfile, embeddedProfile } from '../meta/icc.js';
import { parseCmr } from '../meta/cmr.js';
import { sizeClass } from './size-class.js';
import { iocaColorModel, imageColorModel, iccColorModel } from './color-model.js';
import { sourceText, FONT_TYPES_ORDER } from './filter.js';
import { OID_CMR } from '../objcontainer/object-types.js';
import { lookupField } from '../modca/registry/index.js';
import { readCodedFont } from '../foca/coded-font.js';

/**
 * Content kinds of overlays and page segments by the short name of the field that holds them
 * (MO:DCA Reference: Presentation Text, IM Image, IOCA Image, Graphics, Bar Code and Object
 * Container objects; Include Page Segment; Include Object). PTX also counts outside a BPT, as
 * in overlays written without text object brackets.
 */
const CONTENT_KINDS = {
  BPT: 'text', PTX: 'text', BII: 'imImage', BIM: 'ioca', BGR: 'graphics', BBC: 'barcode',
  BOC: 'objectContainer', IPS: 'pageSegment', IOB: 'includedObject',
};

/** Content kind of the resources that are themselves one object. */
const TYPE_CONTENTS = { graphics: 'graphics', barcode: 'barcode', objectContainer: 'objectContainer' };

/** Resource types that are fonts (their own name counts as the font they use). */
const FONT_TYPES = new Set(['fontCharacterSet', 'codedFont', 'codePage', 'truetypeFont']);

const BRG = 0xd3a8c6;
const BOC = 0xd3a892;
const OCD = 0xd3ee92;
const FNC = 0xd3a789;
const IDD = 0xd3a6fb;
const IPD = 0xd3eefb;
const IID = 0xd3a67b;
const IOC = 0xd3a77b;
const OBJECT_BEGINS = new Set([0xd3a8fb, 0xd3a8bb, 0xd3a8eb, 0xd3a892, 0xd3a87b, 0xd3a89b]);
const PREVIEW_TYPES = new Set(['pageSegment', 'overlay', 'image', 'graphics', 'barcode', 'truetypeFont', 'codedFont', 'formDefinition']);
const PREVIEW_FORMATS = new Set(['pdf', 'jpeg', 'png', 'gif', 'tiff', 'jpeg2000']);
const PATTERN_TECHNOLOGY = { 0x05: 'Raster', 0x1e: 'CID-keyed', 0x1f: 'Type 1' };
/** Font type of a pattern technology. */
const PATTERN_FONT_TYPE = { 0x05: 'raster', 0x1e: 'cid', 0x1f: 'type1' };
/** Font type of a TrueType resource by its encoding text. */
const TRUETYPE_FONT_TYPE = { TrueType: 'truetype', 'OpenType (CFF)': 'opentype', 'TrueType collection': 'collection' };

/**
 * Converts page units (1/1440 inch) to millimeters.
 * @param {number} units Page units.
 * @returns {number} Millimeters.
 */
const mm = (units) => (units * 25.4) / 1440;

/**
 * Tells whether a row lies inside a resource group.
 * @param {object} index Field index.
 * @param {number} row Row.
 * @returns {boolean} True if a Begin Resource Group encloses it.
 */
function inResourceGroup(index, row) {
  for (let r = index.parent[row]; r >= 0; r = index.parent[r]) if (index.id[r] === BRG) return true;
  return false;
}

/**
 * Reads the data of an object container, or only its first data field.
 * @param {object} file File record.
 * @param {number} row Begin Object Container row.
 * @returns {Promise<{head: Uint8Array, length: number, oid: string|null}>} First data bytes,
 *   total data length and object type OID.
 */
async function containerInfo(file, row) {
  const { index } = file;
  const ocd = childRows(index, row).filter((r) => index.id[r] === OCD);
  const begin = decodeBeginName(await fieldData(file, row), 8);
  return {
    head: ocd.length ? await fieldData(file, ocd[0]) : new Uint8Array(0),
    length: ocd.reduce((n, r) => n + index.dataLength[r], 0),
    oid: begin.oid,
  };
}

/**
 * Describes the IOCA compression of an image object (first segment).
 * @param {object} file File record.
 * @param {number} row Begin Image Object row.
 * @returns {Promise<string|null>} "IOCA, <compression>".
 */
async function iocaEncoding(file, row) {
  const ipd = childRows(file.index, row).find((r) => file.index.id[r] === IPD);
  if (ipd === undefined) return 'IOCA';
  const sdf = selfDefiningFields(await fieldData(file, ipd)).find((f) => f.code === 0x95);
  if (!sdf) return 'IOCA, uncompressed';
  const c = sdf.body[0];
  const name = c === 0x03 ? 'uncompressed' : COMPRESSIONS[c] ?? `X'${c.toString(16).toUpperCase().padStart(2, '0')}'`;
  return `IOCA, ${name}`;
}

/**
 * Color model of an IOCA image, from its first Image Picture Data field.
 * @param {object} file File record.
 * @param {number} row Begin Image row.
 * @returns {Promise<'rgb'|'cmyk'|null>} Color model.
 */
async function iocaModel(file, row) {
  const ipd = childRows(file.index, row).find((r) => file.index.id[r] === IPD);
  return ipd === undefined ? null : iocaColorModel(await fieldData(file, ipd));
}

/**
 * Lists color models in a fixed order (RGB, then CMYK), without null.
 * @param {...(string|null)} found Color models found.
 * @returns {string[]} Color models.
 */
function models(...found) {
  return ['rgb', 'cmyk'].filter((m) => found.includes(m));
}

/**
 * Size and resolution of an IOCA or IM image from its own descriptor.
 * @param {object} file File record.
 * @param {number} row Begin Image or Begin IM Image row.
 * @returns {Promise<{width: number, height: number, x: number, y: number, dpi: number}|null>}
 *   Size and offset in page units, resolution in dpi.
 */
async function imageExtent(file, row) {
  // The IDD sits in the image's Object Environment Group (BOG … EOG), so search all inner rows.
  const [from, to] = innerRange(file.index, row);
  for (let r = from; r < to; r++) {
    const id = file.index.id[r];
    if (id !== IDD && id !== IID) continue;
    const d = await fieldData(file, r);
    if (id === IDD) {
      const k = toPageUnits(d[0], u(d, 1, 2));
      return { width: u(d, 5, 2) * k, height: u(d, 7, 2) * k, x: 0, y: 0, dpi: 1440 / k };
    }
    const k = toPageUnits(d[12], u(d, 14, 2));
    let x = 0;
    let y = 0;
    const ioc = childRows(file.index, row).find((c) => file.index.id[c] === IOC);
    if (ioc !== undefined) {
      const c = await fieldData(file, ioc);
      x = s(c, 0, 3) * k;
      y = s(c, 3, 3) * k;
    }
    return { width: u(d, 18, 2) * k, height: u(d, 20, 2) * k, x, y, dpi: 1440 / k };
  }
  return null;
}

/**
 * Area of one object inside a page segment or a resource: its object area, else its own size.
 * @param {object} file File record.
 * @param {number} row Object Begin row.
 * @param {object} env Environment.
 * @returns {Promise<{x: number, y: number, width: number, height: number}|null>} Page units.
 */
async function objectRect(file, row, env) {
  const area = await readObjectArea(file, row, env);
  if (area?.width && area?.height) return { x: area.x, y: area.y, width: area.width, height: area.height };
  const own = await imageExtent(file, row);
  return own ? { x: own.x, y: own.y, width: own.width, height: own.height } : null;
}

/**
 * Area covered by a page segment's objects, or by one object (page units).
 * @param {object} file File record.
 * @param {number} row Begin row of the page segment or object.
 * @returns {Promise<{x0: number, y0: number, x1: number, y1: number}|null>} Box, or null.
 */
export async function contentBox(file, row) {
  const { index } = file;
  const env = await readEnvironment(file, row);
  const rows = index.id[row] === 0xd3a85f ? childRows(index, row).filter((c) => OBJECT_BEGINS.has(index.id[c]) && index.id[c] !== 0xd3a89b) : [row];
  let box = null;
  for (const c of rows) {
    const rect = await objectRect(file, c, env);
    if (!rect) continue;
    box = box ? {
      x0: Math.min(box.x0, rect.x), y0: Math.min(box.y0, rect.y),
      x1: Math.max(box.x1, rect.x + rect.width), y1: Math.max(box.y1, rect.y + rect.height),
    } : { x0: rect.x, y0: rect.y, x1: rect.x + rect.width, y1: rect.y + rect.height };
  }
  return box;
}

/**
 * Builds the record of one catalog entry (without duplicates).
 * @param {object} entry ResourceCatalog entry.
 * @param {(fileId: string) => object} getFile Returns a file record.
 * @returns {Promise<object>} Resource record; `_container` and `_wholeFile` drive extraction.
 */
export async function describeResource(entry, getFile) {
  const file = getFile(entry.fileId);
  const { index } = file;
  const r = {
    id: entry.fontIndex ? `${entry.id}:${entry.fontIndex}` : entry.id,
    name: entry.displayName || entry.name,
    type: entry.type,
    source: { fileId: file.id, kind: entry.origin, path: file.path, byteRange: [0, file.size] },
    fileSize: file.size, widthMm: null, heightMm: null, sizeClass: 'notApplicable', resolution: null,
    colorProfile: null, colorModels: [], encoding: null, hasPreview: false, duplicates: [], contents: [], fonts: [],
    internalName: null, fontTypes: [], _fontRefs: [], _entry: entry, _wholeFile: true, _container: null,
  };
  if (entry.beginRow >= 0) {
    const row = entry.beginRow;
    if (r.type !== 'truetypeFont') r.internalName = ebcdicName(await fieldData(file, row)) || null;
    const end = index.end[row] >= 0 ? index.end[row] : row;
    const wholeFile = !inResourceGroup(index, row) && file.kind !== 'document';
    r._wholeFile = wholeFile;
    if (!wholeFile) {
      r.source.byteRange = [index.offset[row], index.offset[end] + index.length[end]];
      r.fileSize = r.source.byteRange[1] - r.source.byteRange[0];
    }
    await describeContent(r, file, row);
  } else if (r.type === 'iccProfile') {
    // A stand-alone ICC profile file (T308): listed with its color space and description.
    const icc = parseIccProfile(await file.byteSource.read(0, file.size));
    r.encoding = icc?.colorSpace ?? null;
    r.colorProfile = icc?.description ?? null;
    r.colorModels = models(iccColorModel(icc?.colorSpace));
  } else {
    r.encoding = fontEncoding(await file.byteSource.read(0, 4));
  }
  if (FONT_TYPES.has(r.type)) r.fonts = [r.name];
  if (r.type === 'truetypeFont' && TRUETYPE_FONT_TYPE[r.encoding]) r.fontTypes = [TRUETYPE_FONT_TYPE[r.encoding]];
  if (TYPE_CONTENTS[r.type]) r.contents = [TYPE_CONTENTS[r.type]];
  r.hasPreview = PREVIEW_TYPES.has(r.type) || (r.type === 'objectContainer' && PREVIEW_FORMATS.has(r._format));
  if (typeof r.widthMm === 'number') r.sizeClass = sizeClass(r.widthMm, r.heightMm);
  return r;
}

/**
 * Lists what an overlay or page segment contains: text, images (IM or IOCA), graphics, bar
 * codes, object containers, included page segments and included objects.
 * @param {object} index Field index.
 * @param {number} row Begin row of the overlay or page segment.
 * @returns {string[]} Content kinds in the order of CONTENT_KINDS.
 */
export function contentKinds(index, row) {
  const end = index.end[row] >= 0 ? index.end[row] : index.count;
  const found = new Set();
  for (let r = row + 1; r < end; r++) {
    const kind = CONTENT_KINDS[lookupField(index.id[r])?.shortName];
    if (kind) found.add(kind);
  }
  return [...new Set(Object.values(CONTENT_KINDS))].filter((k) => found.has(k));
}

/**
 * Names the outline format of font data.
 * @param {Uint8Array} head First bytes.
 * @returns {string} TrueType, OpenType (CFF) or TrueType collection.
 */
function fontEncoding(head) {
  const magic = String.fromCharCode(...head.subarray(0, 4));
  return magic === 'OTTO' ? 'OpenType (CFF)' : magic === 'ttcf' ? 'TrueType collection' : 'TrueType';
}

/**
 * Fills type-specific values of a resource record.
 * @param {object} r Record.
 * @param {object} file File record.
 * @param {number} row Begin row of the resource object.
 * @returns {Promise<void>} Resolves when filled.
 */
async function describeContent(r, file, row) {
  const { index } = file;
  const id = index.id[row];
  const setSize = (w, h) => { r.widthMm = mm(w); r.heightMm = mm(h); };
  if (id === BOC) {
    const info = await containerInfo(file, row);
    r.fileSize = info.length;
    r._container = row;
    if (r.type === 'truetypeFont') {
      r.encoding = fontEncoding(info.head);
      return;
    }
    if (info.oid === OID_CMR) {
      r.type = 'colorManagementResource';
      const c = parseCmr((await readContainer(file, row)).bytes);
      r.encoding = c ? `CMR ${c.cmrType}` : 'CMR';
      r.colorProfile = c?.iccProfile?.description ?? null;
      r.colorModels = models(iccColorModel(c?.iccProfile?.colorSpace));
      return;
    }
    const format = containerFormat(info.head, info.oid);
    r._format = format;
    const icc = info.head.length >= 132 ? parseIccProfile(info.head.length >= info.length ? info.head : (await readContainer(file, row)).bytes) : null;
    if (format === 'other' && icc) {
      r.type = 'iccProfile';
      r.encoding = icc.colorSpace;
      r.colorProfile = icc.description;
      r.colorModels = models(iccColorModel(icc.colorSpace));
      return;
    }
    r.encoding = format === 'other' ? null : format.toUpperCase();
    const env = await readEnvironment(file, row);
    const area = await readObjectArea(file, row, env);
    const data = PREVIEW_FORMATS.has(format) ? (await readContainer(file, row)).bytes : null;
    if (area?.width && area?.height) setSize(area.width, area.height);
    if (data && format === 'pdf') {
      const page = pdfPageSize(data);
      if (page && !r.widthMm) setSize(page.width * 20, page.height * 20);
    } else if (data) {
      const head = imageHeader(data, format);
      if (head) {
        if (!r.widthMm) setSize((head.width / head.xRes) * 1440, (head.height / head.yRes) * 1440);
        r.resolution = Math.round(head.xRes);
      }
      r.colorProfile = parseIccProfile(await embeddedProfile(data, format))?.description ?? null;
      r.colorModels = models(imageColorModel(data, format));
    }
    return;
  }
  if (r.type === 'fontCharacterSet') {
    const fnc = childRows(index, row).find((c) => index.id[c] === FNC);
    if (fnc !== undefined) {
      const d = await fieldData(file, fnc);
      r.encoding = PATTERN_TECHNOLOGY[d[1]] ?? `X'${d[1].toString(16).toUpperCase().padStart(2, '0')}'`;
      if (PATTERN_FONT_TYPE[d[1]]) r.fontTypes = [PATTERN_FONT_TYPE[d[1]]];
      if (d[1] === 0x05 && d[4] === 0) r.resolution = u(d, 6, 2) / 10;
    }
    return;
  }
  if (r.type === 'codedFont') {
    r._fontRefs = (await readCodedFont(file, row)).parts.map((p) => ({ characterSet: p.fcsName }));
    return;
  }
  if (r.type === 'overlay' || r.type === 'pageSegment') {
    const env = await readEnvironment(file, row);
    r.contents = contentKinds(index, row);
    r._fontRefs = [...env.fonts.values()].map((f) => ({ codedFont: f.codedFont, characterSet: f.characterSet, dataObject: f.dataObject?.name }));
    r.fonts = [...new Set([...env.fonts.values()].map((f) => f.codedFont || f.characterSet || f.dataObject?.name).filter(Boolean))].sort();
    if (r.type === 'overlay' && !env.missingDescriptor) setSize(env.width, env.height);
    const encodings = new Set();
    const colors = new Set();
    for (const c of childRows(index, row)) {
      const cid = index.id[c];
      // Color models of the images inside (IOCA images and image files in object containers).
      if (cid === 0xd3a8fb) colors.add(await iocaModel(file, c));
      if (cid === BOC) {
        const { format, bytes } = await readContainer(file, c);
        colors.add(imageColorModel(bytes, format));
      }
      if (cid === 0xd3a8fb) encodings.add(await iocaEncoding(file, c));
      if (cid === 0xd3a87b) encodings.add('IM image');
      if (r.resolution === null && (cid === 0xd3a8fb || cid === 0xd3a87b)) r.resolution = Math.round((await imageExtent(file, c))?.dpi ?? 0) || null;
    }
    if (r.type === 'pageSegment') {
      const box = await contentBox(file, row);
      if (box) setSize(box.x1 - box.x0, box.y1 - box.y0);
    }
    r.encoding = encodings.size ? [...encodings].join(', ') : null;
    r.colorModels = models(...colors);
    return;
  }
  if (r.type === 'image' || r.type === 'graphics' || r.type === 'barcode') {
    const env = await readEnvironment(file, row);
    const rect = await objectRect(file, row, env);
    if (rect) setSize(rect.width, rect.height);
    if (r.type === 'image') {
      const own = await imageExtent(file, row);
      if (own) r.resolution = Math.round(own.dpi);
      r.encoding = id === 0xd3a87b ? 'IM image' : await iocaEncoding(file, row);
      if (id !== 0xd3a87b) r.colorModels = models(await iocaModel(file, row));
      r.contents = [id === 0xd3a87b ? 'imImage' : 'ioca'];
    } else {
      r.encoding = r.type === 'graphics' ? 'GOCA' : 'BCOCA';
    }
  }
}

/**
 * Adds the other sources of the same type and name to every record.
 * @param {object[]} records Resource records.
 * @returns {void}
 */
export function linkDuplicates(records) {
  const byKey = new Map();
  for (const r of records) {
    // By the lookup name: the shown name of a resource file is its file name, which may differ.
    const key = `${r.type}:${(r._entry?.name ?? r.name).toUpperCase()}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  for (const group of byKey.values()) {
    for (const r of group) r.duplicates = group.filter((o) => o !== r).map(sourceText);
  }
}

/**
 * Hashes the content of a resource for finding identical copies: for AFP data the structured
 * fields (length, identifier, flags and data) without their sequence numbers and without the
 * separators between fields — copies written by different jobs differ only there (e.g. a form
 * definition in a .FDF file and inline in several documents); other data (TrueType
 * fonts) byte by byte. FNV-1a, 32 bits, plus the length.
 * @param {Uint8Array} d Resource bytes.
 * @returns {string} Hash.
 */
export function contentHash(d) {
  let h = 0x811c9dc5;
  const add = (b) => { h = Math.imul(h ^ b, 0x01000193); };
  let n = 0;
  if (d[0] !== 0x5a) {
    for (const b of d) add(b);
    return `${(h >>> 0).toString(16)}:${d.length}`;
  }
  for (let p = 0; p < d.length;) {
    if (d[p] !== 0x5a) { p++; continue; }
    const len = (d[p + 1] << 8) | d[p + 2];
    if (len < 8) { p++; continue; }
    const end = Math.min(d.length, p + 1 + len);
    for (let i = p + 1; i < end; i++) if (i !== p + 7 && i !== p + 8) { add(d[i]); n++; }
    p = end;
  }
  return `${(h >>> 0).toString(16)}:${n}`;
}

/**
 * Reads the bytes of a resource record (its byte range; TrueType fonts in object containers
 * included as stored).
 * @param {object} r Record.
 * @param {(fileId: string) => object} getFile Returns a file record.
 * @returns {Promise<Uint8Array>} Bytes.
 */
async function recordBytes(r, getFile) {
  const [from, to] = r.source.byteRange;
  return getFile(r.source.fileId).byteSource.read(from, to - from);
}

/**
 * Combines identical resources — same type, lookup name and content (contentHash) — into one
 * record (FR-051): the first source that is not inline (else the first) represents them, and
 * `sources` lists all their sources, `memberIds` their ids. `duplicates` then names only the
 * same-named resources with other content (e.g. a font in 240 and 300 dpi), which stay separate.
 * Content is hashed only where a name occurs more than once, and kept on the record.
 * @param {object[]} records All records (after linkDuplicates).
 * @param {(fileId: string) => object} getFile Returns a file record.
 * @returns {Promise<object[]>} Records, one per group, in the order of their first member.
 */
export async function groupIdentical(records, getFile) {
  const byName = new Map();
  for (const r of records) {
    const key = `${r.type}:${(r._entry?.name ?? r.name).toUpperCase()}`;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(r);
  }
  const groupOf = new Map();
  for (const same of byName.values()) {
    if (same.length === 1) { groupOf.set(same[0], [same[0]]); continue; }
    const byContent = new Map();
    for (const r of same) {
      r._hash ??= contentHash(await recordBytes(r, getFile));
      if (!byContent.has(r._hash)) byContent.set(r._hash, []);
      byContent.get(r._hash).push(r);
    }
    for (const members of byContent.values()) {
      for (const r of members) groupOf.set(r, members);
    }
  }
  const out = [];
  const seen = new Set();
  for (const r of records) {
    const members = groupOf.get(r);
    if (seen.has(members)) continue;
    seen.add(members);
    const lead = members.find((m) => m.source.kind !== 'inline') ?? members[0];
    const sameName = byName.get(`${lead.type}:${(lead._entry?.name ?? lead.name).toUpperCase()}`);
    // The lead (a file of its own if there is one) comes first, inline copies after it.
    const ordered = [lead, ...members.filter((m) => m !== lead)];
    out.push(Object.assign(Object.create(lead), {
      sources: ordered.map((m) => m.source),
      memberIds: ordered.map((m) => m.id),
      duplicates: sameName.filter((m) => !members.includes(m)).map(sourceText),
    }));
  }
  return out;
}

/**
 * Gives coded fonts, overlays and page segments the font types of the fonts they refer to (by
 * name, among the loaded resources): coded fonts through their character sets, overlays and page
 * segments through their coded fonts, character sets and TrueType data objects.
 * @param {object[]} records All records.
 * @returns {void}
 */
export function linkFontTypes(records) {
  const byName = (type) => {
    const map = new Map();
    for (const r of records.filter((x) => x.type === type)) {
      for (const n of [r.name, r._entry?.name, r.internalName]) {
        if (!n) continue;
        const key = n.toUpperCase();
        map.set(key, [...new Set([...(map.get(key) ?? []), ...r.fontTypes])]);
      }
    }
    return map;
  };
  const ordered = (types) => FONT_TYPES_ORDER.filter((t) => types.has(t));
  const charSets = byName('fontCharacterSet');
  const trueType = byName('truetypeFont');
  const typesOf = (map, name) => (name ? map.get(name.toUpperCase()) ?? [] : []);
  for (const r of records.filter((x) => x.type === 'codedFont')) {
    r.fontTypes = ordered(new Set(r._fontRefs.flatMap((f) => typesOf(charSets, f.characterSet))));
  }
  const coded = byName('codedFont');
  for (const r of records.filter((x) => x.type === 'overlay' || x.type === 'pageSegment')) {
    r.fontTypes = ordered(new Set(r._fontRefs.flatMap((f) => [
      ...typesOf(coded, f.codedFont), ...typesOf(charSets, f.characterSet), ...typesOf(trueType, f.dataObject),
    ])));
  }
}

/**
 * Removes the internal fields of a record (for the viewer).
 * @param {object} r Record.
 * @returns {object} Public record.
 */
export function publicRecord(r) {
  // Grouped records inherit from their lead record (groupIdentical): copy all fields.
  const all = {};
  for (const key in r) all[key] = r[key];
  const { _entry, _wholeFile, _container, _format, _fontRefs, _hash, ...out } = all;
  return {
    ...out, source: { ...out.source }, duplicates: [...out.duplicates], fontTypes: [...out.fontTypes],
    sources: (out.sources ?? [out.source]).map((s) => ({ ...s })), memberIds: [...(out.memberIds ?? [out.id])],
  };
}
