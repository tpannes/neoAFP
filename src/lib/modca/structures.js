/**
 * Decoders for the MO:DCA structured fields that describe documents, pages and how objects are
 * placed and mapped (task T056). Each decoder turns a field's data bytes into named values.
 * Positions and sizes are in the measurement units of the page or object (see `toPageUnits`).
 *
 * Spec references: MO:DCA Reference (AFPC-0004), the structured field of the same name. Layouts
 * were checked against sample files.
 */

import { u, s, orientation, ebcdicName, triplets } from './bytes.js';
import { decodeOid } from './registry/triplets.js';

/**
 * Page Descriptor (PGD): unit base and units per base in X and Y, page width and height.
 * @param {Uint8Array} d Field data.
 * @returns {{xBase: number, yBase: number, xUnits: number, yUnits: number, width: number, height: number}}
 *   Measurement units and page size in those units.
 */
export function decodePGD(d) {
  return { xBase: d[0], yBase: d[1], xUnits: u(d, 2, 2), yUnits: u(d, 4, 2), width: u(d, 6, 3), height: u(d, 9, 3) };
}

/**
 * Presentation Text Data Descriptor, format 1 (2-byte extents) or 2 (3-byte extents, followed
 * by optional initial text conditions).
 * @param {Uint8Array} d Field data.
 * @param {1|2} format Field format.
 * @returns {{xBase: number, yBase: number, xUnits: number, yUnits: number, width: number,
 *   height: number, initialText: Uint8Array}} Text presentation space and initial text conditions.
 */
export function decodePTD(d, format) {
  if (format === 1) {
    return { xBase: d[0], yBase: d[1], xUnits: u(d, 2, 2), yUnits: u(d, 4, 2), width: u(d, 6, 2), height: u(d, 8, 2), initialText: new Uint8Array(0) };
  }
  return { xBase: d[0], yBase: d[1], xUnits: u(d, 2, 2), yUnits: u(d, 4, 2), width: u(d, 6, 3), height: u(d, 9, 3), initialText: d.subarray(14) };
}

/**
 * Reads the name carried by a Fully Qualified Name triplet.
 * @param {Uint8Array} body Triplet data (type, format, name).
 * @param {number} ccsid Encoding of character names (1200 = UTF-16BE, otherwise EBCDIC 500).
 * @returns {string} The name.
 */
function fqnName(body, ccsid) {
  const name = body.subarray(2);
  if (body[1] === 0x10) return decodeOid(name) ?? '';
  if (ccsid === 1200 || ccsid === 13488) {
    let out = '';
    for (let i = 0; i + 1 < name.length; i += 2) out += String.fromCharCode((name[i] << 8) | name[i + 1]);
    return out.replace(/\u0000+$/, '');
  }
  return ebcdicName(name, 0, name.length);
}

/**
 * Collects the common triplets of a repeating group or field: fully qualified names by type,
 * local id, character rotation, font descriptor, data-object font descriptor, object
 * classification, mapping option, measurement units and object area size.
 * @param {Uint8Array} d Triplet bytes.
 * @returns {object} Named values (only those present).
 */
export function readCommonTriplets(d) {
  const out = { names: {} };
  let ccsid = 500;
  for (const { id, body } of triplets(d)) {
    switch (id) {
      case 0x01:
        if (u(body, 0, 2) === 0) ccsid = u(body, 2, 2);
        else out.cpgid = u(body, 2, 2);
        break;
      case 0x02: out.names[body[0]] = body[0] === 0xbe ? u(body, 2, body.length - 2) : fqnName(body, ccsid); break;
      case 0x04: out.mappingOption = body[0]; break;
      case 0x10: out.objectClass = body[1]; out.oid = decodeOid(body.subarray(6, 22)); break;
      case 0x1f: out.fontHeight = u(body, 2, 2); out.fontWidth = u(body, 4, 2); break; // 1/1440 inch
      case 0x24: out.localIdType = body[0]; out.localId = body[1]; break;
      case 0x26: out.charRotation = orientation(u(body, 0, 2)); break;
      case 0x4b: out.units = { xBase: body[0], yBase: body[1], xUnits: u(body, 2, 2), yUnits: u(body, 4, 2) }; break;
      case 0x4c: out.areaSize = { width: u(body, 1, 3), height: u(body, 4, 3) }; break;
      case 0x50: out.userDataEncoding = u(body, 2, 2); break;
      case 0x5d: out.horizontalScale = u(body, 0, 2); break;
      case 0x8b: out.dataObjectFont = { technology: body[1], height: u(body, 2, 2), width: u(body, 4, 2),
        rotation: orientation(u(body, 6, 2)), encodingEnv: u(body, 8, 2), encodingId: u(body, 10, 2) }; break;
      default: break;
    }
  }
  return out;
}

/** Fully Qualified Name types used below. */
export const FQN = Object.freeze({
  REPLACE_FIRST_GID: 0x01, RESOURCE_OBJECT: 0x84, CODE_PAGE: 0x85, CHARACTER_SET: 0x86,
  CODED_FONT: 0x8e, OVERLAY: 0xb0, DATA_OBJECT_INTERNAL: 0xbe, DATA_OBJECT_EXTERNAL: 0xde,
  MEDIA_TYPE: 0x11, MEDIUM_MAP: 0x8d,
});

/**
 * Map Coded Font, format 1: header (repeating group length, 3 reserved) then repeating groups of
 * local id, reserved, section, reserved, coded font name, code page name, character set name and
 * (if the group is 30 bytes) character rotation.
 * @param {Uint8Array} d Field data.
 * @returns {{localId: number, codedFont: string, codePage: string, characterSet: string, rotation: number}[]}
 *   Font mappings; empty names mean "not given".
 */
export function decodeMCF1(d) {
  const rgLen = d[0] || 28;
  const out = [];
  for (let pos = 4; pos + 28 <= d.length; pos += rgLen) {
    out.push({
      localId: d[pos],
      codedFont: ebcdicName(d, pos + 4),
      codePage: ebcdicName(d, pos + 12),
      characterSet: ebcdicName(d, pos + 20),
      rotation: rgLen >= 30 ? orientation(u(d, pos + 28, 2)) : 0,
    });
  }
  return out;
}

/**
 * Map Coded Font, format 2: repeating groups (2-byte length + triplets) naming a coded font, or a
 * character set and code page, with local id, rotation and font size.
 * @param {Uint8Array} d Field data.
 * @returns {{localId: number, codedFont: string, codePage: string, characterSet: string,
 *   rotation: number, height: number|null}[]} Font mappings.
 */
export function decodeMCF2(d) {
  const out = [];
  for (let pos = 0; pos + 2 <= d.length;) {
    const len = u(d, pos, 2);
    if (len < 2) break;
    const t = readCommonTriplets(d.subarray(pos + 2, pos + len));
    out.push({
      localId: t.localId ?? 0,
      codedFont: t.names[FQN.CODED_FONT] ?? '',
      codePage: t.names[FQN.CODE_PAGE] ?? '',
      characterSet: t.names[FQN.CHARACTER_SET] ?? '',
      rotation: t.charRotation ?? 0,
      height: t.fontHeight || null,
    });
    pos += len;
  }
  return out;
}

/**
 * Map Data Resource: repeating groups mapping data-object resources, e.g. TrueType/OpenType
 * fonts by full font name (FQN X'DE') with local id (FQN X'BE') and size (X'8B').
 * @param {Uint8Array} d Field data.
 * @returns {{name: string, localId: number|null, oid: string|null, font: object|null}[]} Mappings.
 */
export function decodeMDR(d) {
  const out = [];
  for (let pos = 0; pos + 2 <= d.length;) {
    const len = u(d, pos, 2);
    if (len < 2) break;
    const t = readCommonTriplets(d.subarray(pos + 2, pos + len));
    out.push({
      name: t.names[FQN.DATA_OBJECT_EXTERNAL] ?? t.names[FQN.RESOURCE_OBJECT] ?? '',
      localId: t.names[FQN.DATA_OBJECT_INTERNAL] ?? t.localId ?? null,
      oid: t.oid ?? null,
      font: t.dataObjectFont ?? null,
    });
    pos += len;
  }
  return out;
}

/**
 * Map Page Segment: header (repeating group length, 3 reserved) then groups of 4 reserved bytes
 * and the segment name.
 * @param {Uint8Array} d Field data.
 * @returns {string[]} Page segment names.
 */
export function decodeMPS(d) {
  const rgLen = d[0] || 12;
  const out = [];
  for (let pos = 4; pos + 12 <= d.length; pos += rgLen) out.push(ebcdicName(d, pos + 4));
  return out;
}

/**
 * Include Page Segment / Include Page Overlay: name and offset (3-byte signed), plus orientation
 * for overlays.
 * @param {Uint8Array} d Field data.
 * @returns {{name: string, x: number, y: number, rotation: number}} Include values.
 */
export function decodeInclude(d) {
  return { name: ebcdicName(d), x: s(d, 8, 3), y: s(d, 11, 3), rotation: d.length >= 16 ? orientation(u(d, 14, 2)) : 0 };
}

/**
 * Include Object: object name and type, object area offset and orientation, content offset,
 * reference coordinate system, followed by triplets (units, area size, mapping option, …).
 * @param {Uint8Array} d Field data.
 * @returns {object} Include Object values.
 */
export function decodeIOB(d) {
  return {
    name: ebcdicName(d),
    objectType: d[9],
    x: s(d, 10, 3),
    y: s(d, 13, 3),
    xRotation: orientation(u(d, 16, 2)),
    yRotation: orientation(u(d, 18, 2)),
    contentX: s(d, 20, 3),
    contentY: s(d, 23, 3),
    referenceSystem: d[26],
    ...readCommonTriplets(d.subarray(27)),
    pdfPage: pdfPageFromTriplets(d.subarray(27)),
  };
}

/**
 * Reads the page to show of a multi-page object from an Include Object's triplets (Object
 * Offset triplet X'5A' with object type X'AF' = page; the offset counts from 0).
 * @param {Uint8Array} d Triplet bytes.
 * @returns {number|null} Page number starting at 1, or null if not given.
 */
function pdfPageFromTriplets(d) {
  for (const { id, body } of triplets(d)) if (id === 0x5a && body[0] === 0xaf) return u(body, 2, 4) + 1;
  return null;
}

/**
 * Object Area Position: object area origin and orientation, content origin.
 * @param {Uint8Array} d Field data.
 * @returns {{x: number, y: number, rotation: number, contentX: number, contentY: number,
 *   referenceSystem: number}} Position values in the including page's units.
 */
export function decodeOBP(d) {
  return {
    x: s(d, 2, 3),
    y: s(d, 5, 3),
    rotation: orientation(u(d, 8, 2)),
    contentX: s(d, 13, 3),
    contentY: s(d, 16, 3),
    referenceSystem: d[23] ?? 1,
  };
}

/**
 * Object Area Descriptor: triplets with measurement units and object area size.
 * @param {Uint8Array} d Field data.
 * @returns {{units: object|null, areaSize: object|null}} Units and size.
 */
export function decodeOBD(d) {
  const t = readCommonTriplets(d);
  return { units: t.units ?? null, areaSize: t.areaSize ?? null };
}

/**
 * Map Image Object / Map Graphics Object / Map Bar Code Object / Map Container Data:
 * repeating groups whose triplets give the mapping option.
 * @param {Uint8Array} d Field data.
 * @returns {{mappingOption: number}} Mapping option (0 = position).
 */
export function decodeMapObject(d) {
  const len = u(d, 0, 2);
  const t = readCommonTriplets(d.subarray(2, len >= 2 ? len : d.length));
  return { mappingOption: t.mappingOption ?? 0 };
}

/**
 * Invoke Medium Map: name of the medium map to use from here on.
 * @param {Uint8Array} d Field data.
 * @returns {{name: string}} Medium map name.
 */
export function decodeIMM(d) {
  return { name: ebcdicName(d) };
}

/**
 * Begin fields with a name (BDT, BNG, BPG, BAG, BRG, BRS, BOC, …): the 8-byte name followed by
 * triplets.
 * @param {Uint8Array} d Field data.
 * @param {number} [tripletStart] Where triplets start (8 for most, 10 for Begin Resource).
 * @returns {{name: string, fullName: string|null, objectType: number|null}} Name values.
 */
export function decodeBeginName(d, tripletStart = 8) {
  const t = readCommonTriplets(d.subarray(tripletStart));
  let objectType = null;
  for (const { id, body } of triplets(d, tripletStart)) if (id === 0x21) objectType = body[0];
  return { name: ebcdicName(d), fullName: t.names[FQN.REPLACE_FIRST_GID] ?? null, objectType, oid: t.oid ?? null };
}
