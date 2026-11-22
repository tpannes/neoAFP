/**
 * Object containers and Include Object (FR-013, task T077): non-AFP data (PDF, JPEG, PNG, GIF,
 * TIFF, TrueType/OpenType fonts) carried in Begin/End Object Container with Object Container
 * Data fields, usually stored as resources and placed on a page with Include Object (IOB).
 *
 * The format is recognized from the data itself (PDF "%PDF", JPEG X'FFD8', PNG, GIF, TIFF) and,
 * for fonts, from the object type identifier (OID 1.3.18.0.4.1.1.51/53, see object-types.js). Include Object also
 * places image (IOCA) and graphics (GOCA) resources; its position, area size, measurement units
 * and mapping option replace the object's own (MO:DCA Reference, "Include Object").
 */

import { collectFields, concat, fieldData } from '../modca/access.js';
import { u, toPageUnits } from '../modca/bytes.js';
import { decodeIOB, decodeBeginName } from '../modca/structures.js';
import { registerObjectRenderer, readObjectArea, renderContent, objectRendererFor } from '../render/page-renderer.js';
import { placeInArea } from '../ioca/ioca.js';
import { readTiff } from './tiff.js';
import { isFontOid } from './object-types.js';

const BOC = 0xd3a892;
const OCD = 0xd3ee92;
const IOB = 0xd3afc3;

/** Include Object object types → resource types. */
const OBJECT_TYPES = { 0x92: 'objectContainer', 0xfb: 'image', 0xbb: 'graphics', 0xeb: 'barcode', 0x5f: 'pageSegment', 0xdf: 'overlay' };

/**
 * Recognizes the format of container data.
 * @param {Uint8Array} d Data.
 * @param {string|null} oid Object type identifier.
 * @returns {'pdf'|'jpeg'|'png'|'gif'|'tiff'|'truetype'|'other'} Format.
 */
export function containerFormat(d, oid = null) {
  if (isFontOid(oid)) return 'truetype';
  const head = String.fromCharCode(...d.subarray(0, 8));
  if (head.startsWith('%PDF')) return 'pdf';
  if (d[0] === 0xff && d[1] === 0xd8) return 'jpeg';
  if (head.startsWith('\x89PNG')) return 'png';
  if (head.startsWith('GIF8')) return 'gif';
  if (head.startsWith('II*\x00') || head.startsWith('MM\x00*')) return 'tiff';
  return 'other';
}

/**
 * Reads an object container: format, identifier and data.
 * @param {object} file File record.
 * @param {number} row Row of Begin Object Container.
 * @returns {Promise<{format: string, oid: string|null, bytes: Uint8Array}>} Container content.
 */
export async function readContainer(file, row) {
  const begin = decodeBeginName(await fieldData(file, row), 8);
  const bytes = concat((await collectFields(file, row, new Set([OCD]))).map((f) => f.data));
  return { format: containerFormat(bytes, begin.oid), oid: begin.oid, bytes };
}

/**
 * Natural size of an image in pels and its resolution, read from the file header.
 * @param {Uint8Array} d Image bytes.
 * @param {string} format 'jpeg', 'png' or 'gif'.
 * @returns {{width: number, height: number, xRes: number, yRes: number}|null} Size, or null.
 */
export function imageHeader(d, format) {
  if (format === 'png') {
    let xRes = 96;
    let yRes = 96;
    const phys = indexOfAscii(d, 'pHYs');
    if (phys > 0 && d[phys + 12] === 1) {
      xRes = u(d, phys + 4, 4) * 0.0254;
      yRes = u(d, phys + 8, 4) * 0.0254;
    }
    return { width: u(d, 16, 4), height: u(d, 20, 4), xRes, yRes };
  }
  if (format === 'gif') return { width: d[6] | (d[7] << 8), height: d[8] | (d[9] << 8), xRes: 96, yRes: 96 };
  if (format === 'jpeg') {
    let xRes = 96;
    let yRes = 96;
    let pos = 2;
    while (pos + 4 < d.length) {
      if (d[pos] !== 0xff) { pos++; continue; }
      const marker = d[pos + 1];
      const len = u(d, pos + 2, 2);
      if (marker === 0xe0 && String.fromCharCode(...d.subarray(pos + 4, pos + 8)) === 'JFIF') {
        const unit = d[pos + 11];
        const xd = u(d, pos + 12, 2);
        const yd = u(d, pos + 14, 2);
        if (unit === 1 && xd) { xRes = xd; yRes = yd; }
        if (unit === 2 && xd) { xRes = xd * 2.54; yRes = yd * 2.54; }
      }
      if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: u(d, pos + 7, 2), height: u(d, pos + 5, 2), xRes, yRes };
      }
      pos += 2 + len;
    }
  }
  return null;
}

/**
 * Finds ASCII text in bytes.
 * @param {Uint8Array} d Bytes.
 * @param {string} text Text.
 * @returns {number} Position or −1.
 */
function indexOfAscii(d, text) {
  outer: for (let i = 0; i < Math.min(d.length - text.length, 1 << 20); i++) {
    for (let j = 0; j < text.length; j++) if (d[i + j] !== text.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

/**
 * Reads the media box (page size in points) of the first page of a PDF.
 * @param {Uint8Array} d PDF bytes.
 * @returns {{width: number, height: number}|null} Page size in points, or null.
 */
export function pdfPageSize(d) {
  const text = new TextDecoder('latin1').decode(d.subarray(0, Math.min(d.length, 4 << 20)));
  const m = text.match(/\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/);
  if (!m) return null;
  const [x0, y0, x1, y1] = m.slice(1).map(Number);
  return { width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

/**
 * Renders an object container's content into an area.
 * @param {object} r Render context.
 * @param {object} file File record containing the container.
 * @param {number} row Row of Begin Object Container.
 * @param {{x: number, y: number, width: number|null, height: number|null, contentX: number,
 *   contentY: number, mappingOption: number|null, rotation: number}} area Object area (page units, absolute).
 * @param {{file: object, row: number}} source Field that placed the object (for links and messages).
 * @param {number} pdfPage PDF page to show (1-based).
 * @returns {Promise<object[]>} Render items.
 */
async function renderContainerContent(r, file, row, area, source, pdfPage = 1) {
  const c = await readContainer(file, row);
  const base = { sourceField: source.row, fileId: source.file.id, objectRef: `${file.id}:${row}` };
  const unsupported = (reason) => {
    r.report({ severity: 'warning', code: 'unsupportedObject', fileId: source.file.id, offset: source.file.index.offset[source.row], params: { file: source.file.path, reason } });
    return [{ type: 'placeholder', rect: { x: area.x, y: area.y, width: area.width ?? 1440, height: area.height ?? 1440 }, reason, ...base }];
  };
  if (c.format === 'pdf') {
    const size = pdfPageSize(c.bytes);
    const w = size ? size.width * 20 : (area.width ?? 12240);
    const h = size ? size.height * 20 : (area.height ?? 15840);
    const place = placeInArea(area, w, h);
    return [{ type: 'pdf', rect: place.rect, clip: place.clip, rotation: area.rotation ?? 0, pageNumber: pdfPage, ...base }];
  }
  if (c.format === 'jpeg' || c.format === 'png' || c.format === 'gif' || c.format === 'tiff') {
    const hdr = c.format === 'tiff' ? readTiff(c.bytes) : imageHeader(c.bytes, c.format);
    if (!hdr || !hdr.width) return unsupported(`${c.format.toUpperCase()} image could not be read`);
    if (hdr.error && !hdr.bilevel && !hdr.rgba) return unsupported(hdr.error);
    const place = placeInArea(area, hdr.width * 1440 / (hdr.xRes || 96), hdr.height * 1440 / (hdr.yRes || 96));
    return [{ type: 'image', rect: place.rect, clip: place.clip, rotation: area.rotation ?? 0, imageRef: `${file.id}:${row}`, colorSpace: c.format, ...base }];
  }
  if (c.format === 'truetype') return []; // font resource, not drawn by itself
  return unsupported(`object container format not supported${c.oid ? ` (${c.oid})` : ''}`);
}

/**
 * Renders an object container placed directly on a page (with its own object area), or into a
 * given area (an image of a QR Code with Image bar code).
 * @param {object} r Render context.
 * @param {object} file File record.
 * @param {number} row Row of Begin Object Container.
 * @param {object} env Environment.
 * @param {{x: number, y: number}} origin Origin in page units.
 * @param {object|null} [areaOverride] Object area to use instead of the container's own.
 * @returns {Promise<object[]>} Render items.
 */
async function renderContainer(r, file, row, env, origin, areaOverride = null) {
  const area = (await readObjectArea(file, row, env, areaOverride)) ?? { x: 0, y: 0, width: null, height: null, contentX: 0, contentY: 0, mappingOption: null, rotation: 0 };
  return renderContainerContent(r, file, row, { ...area, x: origin.x + area.x, y: origin.y + area.y }, { file, row });
}

/**
 * Renders an Include Object field: finds the named resource and places it.
 * @param {object} r Render context.
 * @param {object} file File record.
 * @param {number} row Row of Include Object.
 * @param {object} env Environment.
 * @param {{x: number, y: number}} origin Origin in page units.
 * @returns {Promise<object[]>} Render items.
 */
async function renderIncludeObject(r, file, row, env, origin) {
  const iob = decodeIOB(await fieldData(file, row));
  const type = OBJECT_TYPES[iob.objectType] ?? 'objectContainer';
  const entry = await r.catalog.lookup(type, iob.name, r.lookupContext)
    ?? (type !== 'objectContainer' ? null : await r.catalog.lookup('truetypeFont', iob.name, r.lookupContext));
  const fx = iob.units ? toPageUnits(iob.units.xBase, iob.units.xUnits) : env.kx;
  const fy = iob.units ? toPageUnits(iob.units.yBase, iob.units.yUnits) : env.ky;
  const area = {
    x: iob.x * env.kx, y: iob.y * env.ky,
    width: iob.areaSize ? iob.areaSize.width * fx : null,
    height: iob.areaSize ? iob.areaSize.height * fy : null,
    contentX: iob.contentX === -1 ? 0 : iob.contentX * env.kx,
    contentY: iob.contentY === -1 ? 0 : iob.contentY * env.ky,
    rotation: iob.xRotation, mappingOption: iob.mappingOption ?? null,
  };
  if (!entry) {
    r.missing(type, iob.name, file);
    return [{ type: 'placeholder', rect: { x: origin.x + area.x, y: origin.y + area.y, width: area.width ?? 1440, height: area.height ?? 1440 }, reason: 'missingResource', resourceName: iob.name, resourceType: type, sourceField: row, fileId: file.id }];
  }
  const target = r.getFile(entry.fileId);
  // Without a Mapping Option triplet on the IOB, the object's own mapping applies (MO:DCA IOB semantics).
  area.mappingOption ??= (await readObjectArea(target, entry.beginRow, env))?.mappingOption ?? null;
  if (type === 'objectContainer') {
    return renderContainerContent(r, target, entry.beginRow, { ...area, x: origin.x + area.x, y: origin.y + area.y }, { file, row }, iob.pdfPage ?? 1);
  }
  if (type === 'pageSegment' || type === 'overlay') {
    return renderContent(r, target, entry.beginRow, env, { x: origin.x + area.x, y: origin.y + area.y }, 1);
  }
  const renderer = objectRendererFor(target.index.id[entry.beginRow]);
  if (!renderer) return [];
  return renderer(r, target, entry.beginRow, env, origin, area);
}

registerObjectRenderer(BOC, renderContainer);
registerObjectRenderer(IOB, renderIncludeObject);

/**
 * Returns the pixels or encoded bytes of an image in an object container for the viewer.
 * @param {object} file File record.
 * @param {number} row Row of Begin Object Container.
 * @returns {Promise<object>} `{ encodedBytes, mimeType }` (JPEG/PNG/GIF) or decoded TIFF pixels.
 */
export async function containerPixels(file, row) {
  const c = await readContainer(file, row);
  if (c.format === 'tiff') {
    const t = readTiff(c.bytes);
    return { width: t.width, height: t.height, bilevel: t.bilevel, rgba: t.rgba };
  }
  return { encodedBytes: c.bytes, mimeType: `image/${c.format}` };
}

export { BOC as BEGIN_OBJECT_CONTAINER };
