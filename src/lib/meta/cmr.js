/**
 * Color Management Resources (FR-039): the CMR header and tags (CMOCA Reference AFPC-0006-02,
 * Table 4 "CMR Object Syntax", Table 24 "CMR Data Tag Syntax") and how a document maps CMRs:
 * a Map Data Resource repeating group with the CMR name in an FQN type X'DE' or X'EE' triplet
 * (encoding given by a preceding CGCSGID X'01' triplet) and a CMR Descriptor triplet X'91' with
 * processing mode and scope (MO:DCA Reference AFPC-0004-11, "Using the MDR to Map a Color
 * Management Resource" and "Color Management Resource Descriptor Triplet X'91'").
 */

import { parseIccProfile } from './icc.js';

/** Header fields after the signature: name and length in characters (CMOCA Table 4). */
const FIELDS = [
  ['CMRAlias', 8], ['CMRType', 2], ['CMRVersion', 7], ['ManufacturerName', 5], ['DeviceType', 6],
  ['DeviceModel', 3], ['MediaBrightness', 3], ['MediaColor', 3], ['MediaFinish', 2], ['MediaWeight', 3],
  ['Prop1', 5], ['Prop2', 6], ['Prop3', 4], ['Prop4', 4], ['Prop5', 4],
];

/** Bytes per value of each tag field type (CMOCA Table 24). */
const TYPE_SIZE = { 0x01: 1, 0x02: 2, 0x04: 4, 0x05: 1, 0x06: 1, 0x07: 2, 0x08: 1, 0x09: 1 };

/** Processing modes (triplet X'91' ProcMode). */
export const PROCESSING_MODES = { 0x01: 'audit', 0x02: 'instruction', 0x03: 'link' };
/** Scopes (triplet X'91' CMRScpe). */
export const SCOPES = { 0x01: 'object', 0x02: 'page', 0x03: 'document', 0x04: 'printFile', 0x05: 'pageGroup' };

/**
 * Reads a big-endian 32-bit unsigned number.
 * @param {Uint8Array} d Bytes.
 * @param {number} at Position.
 * @returns {number} Value.
 */
const u32 = (d, at) => ((d[at] << 24) >>> 0) + (d[at + 1] << 16) + (d[at + 2] << 8) + d[at + 3];
/**
 * Reads UTF-16BE text.
 * @param {Uint8Array} d Bytes.
 * @param {number} at Position.
 * @param {number} n Number of bytes.
 * @returns {string} Text.
 */
const utf16 = (d, at, n) => {
  let s = '';
  for (let i = at; i + 1 < at + n; i += 2) s += String.fromCharCode((d[i] << 8) | d[i + 1]);
  return s;
};

/**
 * Decodes the text of a tag (ASCII X'06' or UTF-16BE X'07').
 * @param {number} type Field type.
 * @param {Uint8Array} data Tag data.
 * @returns {string} Text.
 */
const tagText = (type, data) => (type === 0x07 ? utf16(data, 0, data.length) : String.fromCharCode(...data));

/**
 * Parses a CMR.
 * @param {Uint8Array} d CMR bytes.
 * @returns {{name: string, alias: string, cmrType: string, version: string,
 *   fields: {name: string, value: string}[], tags: {id: number, type: number, count: number}[],
 *   comment: string|null, profileFilename: string|null, iccSubset: number|null,
 *   iccProfile: object|null}|null} CMR, or null if the data has no CMR signature.
 */
export function parseCmr(d) {
  if (!d || d.length < 164 || u32(d, 4) !== 0x434d5239) return null;
  const name = utf16(d, 10, 146);
  const fields = [];
  let at = 10;
  for (const [field, chars] of FIELDS) {
    fields.push({ name: field, value: utf16(d, at, chars * 2).replace(/@+$/, '') });
    at += chars * 2;
  }
  const value = (n) => fields.find((f) => f.name === n).value;
  const out = {
    name, alias: value('CMRAlias'), cmrType: value('CMRType'), version: value('CMRVersion'), fields,
    tags: [], comment: null, profileFilename: null, iccSubset: null, iccProfile: null,
  };
  const end = Math.min(d.length, u32(d, 0));
  for (let t = 164; t + 12 <= end; t += 12) {
    const id = (d[t] << 8) | d[t + 1];
    const type = d[t + 3];
    const count = u32(d, t + 4);
    out.tags.push({ id, type, count });
    if (id === 0xffff) break;
    const size = count * (TYPE_SIZE[type] ?? 1);
    const from = size <= 4 ? t + 8 : 164 + u32(d, t + 8);
    if (from + size > end) continue;
    const data = d.subarray(from, from + size);
    if (id === 0x0004) out.comment = tagText(type, data);
    else if (id === 0x3011) out.iccSubset = data[0];
    else if (id === 0x3015) out.iccProfile = parseIccProfile(data);
    else if (id === 0x3025) out.profileFilename = tagText(type, data);
  }
  return out;
}
