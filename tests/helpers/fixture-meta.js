/**
 * Builders for the US2 metadata fixtures: Tag Logical Elements, code page triplets, Map Data
 * Resource for a Color Management Resource, the CMR itself (CMOCA), a minimal ICC profile, and a
 * Metadata Object (MOCA) carrying XMP.
 *
 * Layouts, written from the specifications (not from neoAFP code):
 * - MO:DCA Reference AFPC-0004-11: TLE (triplets X'02' FQN type X'0B', X'36' Attribute Value,
 *   X'80' Attribute Qualifier, X'01' CGCSGID), MDR repeating groups, CMR Descriptor X'91',
 *   Object Classification X'10', registered object type OIDs (CMR 1.3.18.0.4.1.1.57,
 *   Metadata Object 1.3.18.0.4.1.1.67, AFPC JPEG Subset 1.3.18.0.4.1.1.23);
 * - CMOCA Reference AFPC-0006-02, Table 4 "CMR Object Syntax" (164-byte header, UTF-16BE fields
 *   padded with "@"), Table 24 "CMR Data Tag Syntax", tags X'3011' ICC Profile Subset,
 *   X'3015' ICC Profile Data, X'3025' ICC Profile Filename, X'FFFF' End Data;
 * - MOCA Reference AFPC-0013-02, Table 4 "MO Syntax" (MOType DES, MOFormat XMP, MOCompression);
 * - ICC.1:2010 (ISO 15076-1) profile header, tag table, 'desc' (ICC v2 textDescriptionType) and
 *   'mluc' (multiLocalizedUnicodeType);
 * - JPEG (ITU-T T.81) APP2 "ICC_PROFILE" marker as defined in ICC.1:2010 annex B.4.
 */
import { bytes, uint, triplet, ebcdic, utf16be, field, ID } from './afp-builder.js';

/** CGCSGID triplet X'01' with a graphic character set and code page (GCSGID 697 = Latin 1). */
export const cgcsgid = (cpgid, gcsgid = 697) => triplet(0x01, uint(gcsgid, 2), uint(cpgid, 2));
/** CGCSGID triplet X'01' with a CCSID (first two bytes zero). */
export const ccsid = (value) => triplet(0x01, uint(0, 2), uint(value, 2));

/**
 * Encodes text in a single-byte EBCDIC code page from a small table of the characters the
 * fixtures use (values from the IBM code page charts for CCSIDs 037, 273 and 500).
 * @param {string} text Text.
 * @param {37|273|500} cp Code page.
 * @returns {Uint8Array} Bytes.
 */
export function ebcdicCp(text, cp) {
  const special = {
    37: { '[': 0xba, ']': 0xbb, '!': 0x5a, '|': 0x4f },
    273: { 'ä': 0xc0, 'ö': 0x6a, 'ü': 0xd0, 'Ä': 0x4a, 'Ö': 0xe0, 'Ü': 0x5a, 'ß': 0xa1, '!': 0x4f },
    500: { '[': 0x4a, ']': 0x5a, '!': 0x4f, '|': 0xbb, 'ä': 0x43, 'ö': 0xcc, 'ü': 0xdc, 'Ä': 0x63, 'Ö': 0xec, 'Ü': 0xfc, 'ß': 0x59, ',': 0x6b },
  }[cp];
  return bytes(...[...text].map((ch) => special[ch] ?? ebcdic(ch)[0]));
}

/**
 * Builds a Tag Logical Element.
 * @param {Uint8Array} name Attribute name bytes.
 * @param {Uint8Array} value Attribute value bytes.
 * @param {{before?: Uint8Array[], qualifier?: [number, number], extra?: Uint8Array[]}} [o]
 *   Triplets before the name (e.g. CGCSGID), attribute qualifier (sequence, level), and
 *   triplets after the value.
 * @returns {Uint8Array} TLE field.
 */
export function tle(name, value, o = {}) {
  return field(ID.TLE, bytes(
    ...(o.before ?? []),
    triplet(0x02, 0x0b, 0x00, name),
    triplet(0x36, 0x00, 0x00, value),
    ...(o.qualifier ? [triplet(0x80, uint(o.qualifier[0], 4), uint(o.qualifier[1], 4))] : []),
    ...(o.extra ?? []),
  ));
}

/** Pads text with "@" to a fixed number of characters and encodes it in UTF-16BE. */
const at = (text, n) => utf16be(text.padEnd(n, '@').slice(0, n));

/**
 * CMR header fields in order, with their lengths in characters (CMOCA Table 4).
 * @type {[string, number][]}
 */
export const CMR_FIELDS = [
  ['CMRAlias', 8], ['CMRType', 2], ['CMRVersion', 7], ['ManufacturerName', 5], ['DeviceType', 6],
  ['DeviceModel', 3], ['MediaBrightness', 3], ['MediaColor', 3], ['MediaFinish', 2], ['MediaWeight', 3],
  ['Prop1', 5], ['Prop2', 6], ['Prop3', 4], ['Prop4', 4], ['Prop5', 4], ['Reserved', 8],
];

/**
 * Builds the 73-character CMR name from header field values (unspecified fields are "@").
 * @param {Object<string, string>} values Field values by CMR_FIELDS name.
 * @returns {string} CMR name.
 */
export const cmrName = (values) => CMR_FIELDS.map(([n, len]) => (values[n] ?? '').padEnd(len, '@').slice(0, len)).join('');

/**
 * Builds a CMR: header and tagged data.
 * @param {Object<string, string>} values Header field values.
 * @param {{id: number, type: number, count: number, data: Uint8Array}[]} tags Tags in TagID order
 *   (End Data is added); data of up to 4 bytes is stored in the tag itself.
 * @returns {Uint8Array} CMR bytes.
 */
export function cmr(values, tags) {
  const all = [...tags, { id: 0xffff, type: 0x05, count: 0, data: new Uint8Array(0) }];
  const tagBytes = [];
  const dataBytes = [];
  let dataPos = all.length * 12;
  for (const t of all) {
    let value;
    if (t.data.length <= 4) {
      value = bytes(t.data, new Uint8Array(4 - t.data.length));
    } else {
      value = uint(dataPos, 4);
      dataBytes.push(t.data);
      dataPos += t.data.length;
    }
    tagBytes.push(bytes(uint(t.id, 2), 0x00, t.type, uint(t.count, 4), value));
  }
  const body = bytes(
    0x43, 0x4d, 0x52, 0x39, 0x00, 0x00,
    ...CMR_FIELDS.map(([n, len]) => at(values[n] ?? '', len)),
    new Uint8Array(8), ...tagBytes, ...dataBytes);
  return bytes(uint(body.length + 4, 4), body);
}

/**
 * Builds a minimal ICC profile: header and one description tag.
 * @param {object} o Settings.
 * @param {number} o.version Version bytes 8–11 as a number, e.g. 0x02100000 or 0x04300000.
 * @param {string} o.deviceClass Four-character class, e.g. 'mntr'.
 * @param {string} o.colorSpace Four characters, e.g. 'RGB '.
 * @param {string} o.pcs Four characters, 'XYZ ' or 'Lab '.
 * @param {number} o.intent Rendering intent 0–3.
 * @param {string} o.description Description text (ASCII in 'desc', UTF-16BE in 'mluc').
 * @returns {Uint8Array} Profile bytes.
 */
export function iccProfile(o) {
  const ascii = (s) => new Uint8Array(Buffer.from(s, 'latin1'));
  let tag;
  if (o.version >= 0x04000000) {
    const text = utf16be(o.description);
    tag = bytes(ascii('mluc'), uint(0, 4), uint(1, 4), uint(12, 4), ascii('en'), ascii('US'), uint(text.length, 4), uint(28, 4), text);
  } else {
    const text = bytes(ascii(o.description), 0);
    tag = bytes(ascii('desc'), uint(0, 4), uint(text.length, 4), text, uint(0, 4), uint(0, 4), uint(0, 2), 0, new Uint8Array(67));
  }
  while (tag.length % 4) tag = bytes(tag, 0);
  const tagTable = bytes(uint(1, 4), ascii('desc'), uint(128 + 16, 4), uint(tag.length, 4));
  const size = 128 + tagTable.length + tag.length;
  const header = bytes(
    uint(size, 4), ascii('none'), uint(o.version, 4), ascii(o.deviceClass), ascii(o.colorSpace), ascii(o.pcs),
    uint(2026, 2), uint(11, 2), uint(7, 2), uint(10, 2), uint(0, 2), uint(0, 2),
    ascii('acsp'), ascii('APPL'), uint(0, 4), uint(0, 4), uint(0, 4), new Uint8Array(8), uint(o.intent, 4),
    uint(0xf6d6, 4), uint(0x10000, 4), uint(0xd32d, 4), ascii('neoA'), new Uint8Array(16), new Uint8Array(28));
  return bytes(header, tagTable, tag);
}

/**
 * Builds a Metadata Object (MOCA) with XMP data.
 * @param {string} xml XMP packet.
 * @param {{name?: string, compression?: 'NONE'|'GZIP', data?: Uint8Array}} [o] MO name,
 *   compression label, and data bytes (default: the UTF-8 XML).
 * @returns {Uint8Array} MO bytes.
 */
export function metadataObject(xml, o = {}) {
  const name = utf16be(o.name ?? '');
  const data = o.data ?? new Uint8Array(Buffer.from(xml, 'utf8'));
  const header = bytes(utf16be('DES'), at('XMP', 4), at(o.compression ?? 'NONE', 10), new Uint8Array(8), uint(name.length, 2), name);
  return bytes(uint(4 + 2 + header.length + data.length, 4), uint(2 + header.length, 2), header, data);
}

/**
 * Inserts an APP2 "ICC_PROFILE" segment after the SOI and APP0 markers of a JPEG.
 * @param {Uint8Array} jpeg JPEG bytes starting with SOI and APP0.
 * @param {Uint8Array} profile ICC profile.
 * @returns {Uint8Array} JPEG with the profile.
 */
export function jpegWithIcc(jpeg, profile) {
  const app0End = 4 + ((jpeg[4] << 8) | jpeg[5]);
  const payload = bytes(...Buffer.from('ICC_PROFILE\0', 'latin1'), 1, 1, profile);
  return bytes(jpeg.subarray(0, app0End), 0xff, 0xe2, uint(payload.length + 2, 2), payload, jpeg.subarray(app0End));
}
