/**
 * File-level metadata (FR-038, FR-039): XMP packets and color management of one file.
 *
 * XMP comes from Metadata Objects (object containers with object type OID 1.3.18.0.4.1.1.67,
 * MO:DCA "Metadata Objects in AFP") and from XMP embedded in data objects: JPEG APP1
 * "http://ns.adobe.com/xap/1.0/" segments, PNG iTXt "XML:com.adobe.xmp" chunks, the TIFF tag 700
 * (XMP Specification Part 3) and uncompressed XMP packets in PDF files.
 *
 * Color management: Color Management Resources (object type OID 1.3.18.0.4.1.1.57) with the
 * pages, objects or documents that map them (Map Data Resource with a CMR Descriptor X'91'), and
 * ICC profiles inside CMRs and inside JPEG, PNG and TIFF data objects.
 */

import { fieldData, childRows } from '../modca/access.js';
import { decodeBeginName } from '../modca/structures.js';
import { parseTriplets } from '../modca/registry/triplets.js';
import { readContainer, containerFormat } from '../objcontainer/object-container.js';
import { loadCodePage, decode } from '../codepages/index.js';
import { parseXmp, readMetadataObject, decodeXmlBytes, inflate } from './xmp.js';
import { parseIccProfile, embeddedProfile, jpegSegments, pngChunks, tiffTag } from './icc.js';
import { parseCmr, PROCESSING_MODES, SCOPES } from './cmr.js';
import { OID_CMR, OID_METADATA } from '../objcontainer/object-types.js';
import { ownerOf, enclosingPage, beginName, inheritedCodePage, codePageOf, BRS, BDT, BMO } from './owner.js';

const BOC = 0xd3a892;
const OCD = 0xd3ee92;
const MDR = 0xd3abc3;
const BOG = 0xd3a8c7;
const IMAGE_FORMATS = new Set(['jpeg', 'png', 'tiff']);

/**
 * Lists the object containers of a file with name, resource name, OID and data format.
 * @param {object} file File record.
 * @returns {Promise<{row: number, name: string, resourceName: string, oid: string|null, format: string}[]>}
 *   Containers in file order (the format is recognized from the first data field).
 */
async function containers(file) {
  const { index } = file;
  const out = [];
  for (let row = 0; row < index.count; row++) {
    if (index.id[row] !== BOC) continue;
    const begin = decodeBeginName(await fieldData(file, row), 8);
    const parent = index.parent[row];
    const resourceName = parent >= 0 && index.id[parent] === BRS ? await beginName(file, parent) : begin.name;
    const first = childRows(index, row).find((r) => index.id[r] === OCD);
    const head = first === undefined ? new Uint8Array(0) : await fieldData(file, first);
    out.push({ row, name: begin.name, resourceName, oid: begin.oid, format: containerFormat(head, begin.oid) });
  }
  return out;
}

/**
 * Finds the first occurrence of a byte pattern.
 * @param {Uint8Array} d Data.
 * @param {string} text ASCII pattern.
 * @param {number} [from] Start position.
 * @returns {number} Position, or −1.
 */
function indexOfText(d, text, from = 0) {
  const p = Array.from(text, (c) => c.charCodeAt(0));
  outer: for (let i = d.indexOf(p[0], from); i >= 0 && i + p.length <= d.length; i = d.indexOf(p[0], i + 1)) {
    for (let k = 1; k < p.length; k++) if (d[i + k] !== p[k]) continue outer;
    return i;
  }
  return -1;
}

/**
 * Extracts the XMP packet of a data object.
 * @param {Uint8Array} d Object data.
 * @param {string} format Data format.
 * @returns {Promise<string|null>} XMP text, or null.
 */
async function embeddedXmp(d, format) {
  if (format === 'jpeg') {
    const ns = 'http://ns.adobe.com/xap/1.0/\0';
    const seg = jpegSegments(d).find((s) => s.marker === 0xe1 && String.fromCharCode(...s.data.subarray(0, ns.length)) === ns);
    return seg ? decodeXmlBytes(seg.data.subarray(ns.length)) : null;
  }
  if (format === 'png') {
    for (const c of pngChunks(d)) {
      if (c.type !== 'iTXt' || String.fromCharCode(...c.data.subarray(0, 18)) !== 'XML:com.adobe.xmp\0') continue;
      let pos = 18;
      const compressed = c.data[pos] === 1;
      pos += 2;
      pos = c.data.indexOf(0, pos) + 1; // language tag
      pos = c.data.indexOf(0, pos) + 1; // translated keyword
      const text = c.data.subarray(pos);
      return new TextDecoder('utf-8').decode(compressed ? await inflate(text, 'deflate') : text);
    }
    return null;
  }
  if (format === 'tiff') {
    const tag = tiffTag(d, 700);
    return tag ? decodeXmlBytes(tag) : null;
  }
  if (format === 'pdf') {
    const start = indexOfText(d, '<x:xmpmeta');
    if (start < 0) return null;
    const end = indexOfText(d, '</x:xmpmeta>', start);
    return end < 0 ? null : decodeXmlBytes(d.subarray(start, end + 12));
  }
  return null;
}

/**
 * Reads all XMP packets of a file.
 * @param {object} file File record.
 * @param {(d: object) => void} report Records a diagnostic.
 * @returns {Promise<object[]>} Data-model XmpPacket objects with owner, name, source, format,
 *   compression, rawText and properties.
 */
export async function readXmpPackets(file, report) {
  const out = [];
  for (const c of await containers(file)) {
    const fail = (reason) => report({ severity: 'warning', code: 'decodeFailed', fileId: file.id, offset: file.index.offset[c.row], params: { file: file.path, reason } });
    let entry = null;
    if (c.oid === OID_METADATA) {
      const owner = await ownerOf(file, c.row);
      try {
        const mo = await readMetadataObject((await readContainer(file, c.row)).bytes);
        const parsed = mo.format === 'XMP' ? parseXmp(mo.rawText, (d) => fail(d.params.reason)) : { rawText: mo.rawText, properties: [] };
        entry = { ...owner, name: mo.name, source: 'metadataObject', format: mo.format, compression: mo.compression, ...parsed };
      } catch (e) {
        fail(`metadata object: ${e.message}`);
        entry = { ...owner, name: c.name, source: 'metadataObject', format: null, compression: null, rawText: '', properties: [] };
      }
    } else if (IMAGE_FORMATS.has(c.format) || c.format === 'pdf') {
      const text = await embeddedXmp((await readContainer(file, c.row)).bytes, c.format);
      if (text !== null) {
        entry = {
          ownerType: 'object', ownerRef: c.row, ownerName: c.resourceName, pageNumber: enclosingPage(file, c.row)?.pageNumber ?? null,
          name: c.resourceName, source: c.format, format: 'XMP', compression: 'NONE', ...parseXmp(text, (d) => fail(d.params.reason)),
        };
      }
    }
    if (entry) out.push({ index: c.row, ...entry });
  }
  return out;
}

/**
 * Reads the CMR mappings of the Map Data Resource fields of a file.
 * @param {object} file File record.
 * @returns {Promise<{row: number, name: string, processingMode: string, scope: {level: string, ref: (number|string|null)}}[]>}
 *   Mappings in file order.
 */
async function cmrMappings(file) {
  const { index } = file;
  const out = [];
  for (let row = 0; row < index.count; row++) {
    if (index.id[row] !== MDR) continue;
    const d = await fieldData(file, row);
    const inherited = await inheritedCodePage(file, row);
    for (let pos = 0; pos + 2 <= d.length;) {
      const len = (d[pos] << 8) | d[pos + 1];
      if (len < 2) break;
      let cp = inherited;
      let name = null;
      let descriptor = null;
      for (const t of parseTriplets(d.subarray(pos + 2, pos + len))) {
        const body = t.raw.subarray(2);
        if (t.id === 0x01 && t.decoded) cp = codePageOf(t.decoded);
        else if (t.id === 0x02 && (body[0] === 0xde || body[0] === 0xee) && body[1] === 0x00) name = { bytes: body.subarray(2), cp: cp?.id ?? 'ebcdic-500' };
        else if (t.id === 0x91 && body.length >= 3) descriptor = { mode: body[1], scope: body[2] };
      }
      if (name && descriptor) {
        await loadCodePage(name.cp);
        out.push({
          row, name: decode(name.cp, name.bytes),
          processingMode: PROCESSING_MODES[descriptor.mode] ?? null,
          scope: { level: SCOPES[descriptor.scope] ?? null, ref: await scopeRef(file, row, SCOPES[descriptor.scope]) },
        });
      }
      pos += len;
    }
  }
  return out;
}

/**
 * Names what a CMR mapped by a Map Data Resource applies to: the page number for pages, else the
 * name of the overlay, object or document whose environment group holds the field.
 * @param {object} file File record.
 * @param {number} row Map Data Resource row.
 * @param {string|undefined} level Scope level.
 * @returns {Promise<number|string|null>} Reference.
 */
async function scopeRef(file, row, level) {
  const { index } = file;
  if (level === 'page') {
    const page = enclosingPage(file, row);
    if (page) return page.pageNumber;
    for (let r = index.parent[row]; r >= 0; r = index.parent[r]) if (index.id[r] === BMO) return beginName(file, r);
    return null;
  }
  const wanted = level === 'object' ? BOG : level === 'document' ? BDT : null;
  for (let r = index.parent[row]; r >= 0; r = index.parent[r]) {
    if (index.id[r] === wanted) return beginName(file, level === 'object' ? index.parent[r] : r);
  }
  return null;
}

/**
 * Reads the color management resources and ICC profiles of a file.
 * @param {object} file File record.
 * @param {(d: object) => void} report Records a diagnostic.
 * @returns {Promise<{cmrs: object[], profiles: object[]}>} Data-model ColorManagementResource
 *   and IccProfile objects.
 */
export async function readColorManagement(file, report) {
  const cmrs = [];
  const profiles = [];
  const imageProfiles = [];
  for (const c of await containers(file)) {
    if (c.oid === OID_CMR) {
      const parsed = parseCmr((await readContainer(file, c.row)).bytes);
      if (!parsed) {
        report({ severity: 'warning', code: 'decodeFailed', fileId: file.id, offset: file.index.offset[c.row], params: { file: file.path, reason: 'color management resource without CMR header' } });
        continue;
      }
      cmrs.push({ index: c.row, resourceName: c.resourceName, available: true, ...parsed, processingMode: null, scope: null, scopes: [] });
    } else if (IMAGE_FORMATS.has(c.format)) {
      const icc = parseIccProfile(await embeddedProfile((await readContainer(file, c.row)).bytes, c.format));
      if (icc) imageProfiles.push({ name: c.resourceName, ...icc, source: { kind: 'object', resourceName: c.resourceName, index: c.row } });
    }
  }
  const strip = (s) => s.replace(/[@ ]+$/, '');
  for (const m of await cmrMappings(file)) {
    let cmr = cmrs.find((x) => x.name === m.name) ?? cmrs.find((x) => strip(x.name) === strip(m.name));
    if (!cmr) {
      // Mapped but not in this file (resident or in another resource library).
      cmr = { index: null, resourceName: null, available: false, name: m.name, alias: strip(m.name.slice(0, 8)), cmrType: m.name.slice(8, 10), version: strip(m.name.slice(10, 17)), fields: [], tags: [], comment: null, profileFilename: null, iccSubset: null, iccProfile: null, processingMode: null, scope: null, scopes: [] };
      cmrs.push(cmr);
    }
    cmr.scopes.push({ ...m.scope, processingMode: m.processingMode, mapRef: m.row });
    if (!cmr.scope) Object.assign(cmr, { scope: m.scope, processingMode: m.processingMode });
  }
  for (const cmr of cmrs) {
    if (cmr.iccProfile) profiles.push({ name: cmr.profileFilename ?? cmr.alias, ...cmr.iccProfile, source: { kind: 'cmr', resourceName: cmr.resourceName, index: cmr.index } });
  }
  profiles.push(...imageProfiles);
  return { cmrs, profiles };
}

