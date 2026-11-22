/**
 * Names, specification references and basic decoders of MO:DCA triplets.
 *
 * Triplets are small parameters appended to many structured fields: a length byte, an
 * identifier byte and data (MO:DCA Reference, AFPC-0004, chapter "MO:DCA Triplets"). Unknown
 * triplets are kept as raw bytes and reported, never guessed (Principle I).
 *
 * A decoder is `rawOnly` until a committed test expectation asserts its output (field coverage
 * rule, tasks T020/T104; see COVERED below).
 */

import { tripletRegistry } from './index.js';
import { ebcdicName } from '../bytes.js';

const MODCA = 'MO:DCA Reference (AFPC-0004), Triplets';

/** [identifier, short name, full name]. */
const TRIPLETS = [
  [0x01, 'CGCSGID', 'Coded Graphic Character Set Global Identifier'],
  [0x02, 'FQN', 'Fully Qualified Name'],
  [0x04, 'MO', 'Mapping Option'],
  [0x10, 'OC', 'Object Classification'],
  [0x18, 'MIS', 'MO:DCA Interchange Set'],
  [0x1f, 'FDS', 'Font Descriptor Specification'],
  [0x20, 'FCGCSGID', 'Font Coded Graphic Character Set Global Identifier'],
  [0x21, 'ROT', 'Resource Object Type'],
  [0x22, 'ERLID', 'Extended Resource Local Identifier'],
  [0x24, 'RLID', 'Resource Local Identifier'],
  [0x25, 'RSN', 'Resource Section Number'],
  [0x26, 'CR', 'Character Rotation'],
  [0x2d, 'OBO', 'Object Byte Offset'],
  [0x36, 'AV', 'Attribute Value'],
  [0x43, 'DP', 'Descriptor Position'],
  [0x45, 'MEC', 'Media Eject Control'],
  [0x46, 'POCP', 'Page Overlay Conditional Processing'],
  [0x47, 'RUA', 'Resource Usage Attribute'],
  [0x4b, 'MU', 'Measurement Units'],
  [0x4c, 'OAS', 'Object Area Size'],
  [0x4d, 'AD', 'Area Definition'],
  [0x4e, 'CS', 'Color Specification'],
  [0x50, 'ESI', 'Encoding Scheme ID'],
  [0x56, 'MMPN', 'Medium Map Page Number'],
  [0x57, 'OBE', 'Object Byte Extent'],
  [0x58, 'OSFO', 'Object Structured Field Offset'],
  [0x59, 'OSFE', 'Object Structured Field Extent'],
  [0x5a, 'OO', 'Object Offset'],
  [0x5d, 'FHSF', 'Font Horizontal Scale Factor'],
  [0x5e, 'OCO', 'Object Count'],
  [0x62, 'LDTS', 'Local Date and Time Stamp'],
  [0x63, 'OCS', 'Object Checksum'], // retired (AFPC-0004-11 appendix, FOCA "CRC Resource Management")
  [0x64, 'OOI', 'Object Origin Identifier'], // retired (AFPC-0004-11 appendix)
  [0x65, 'C', 'Comment'],
  [0x68, 'MO', 'Medium Orientation'],
  [0x6c, 'ROI', 'Resource Object Include'],
  [0x70, 'PSRM', 'Presentation Space Reset Mixing'],
  [0x71, 'PSMR', 'Presentation Space Mixing Rules'],
  [0x72, 'UDTS', 'Universal Date and Time Stamp'],
  [0x74, 'TS', 'Toner Saver'],
  [0x75, 'CF', 'Color Fidelity'],
  [0x78, 'FF', 'Font Fidelity'],
  [0x80, 'AQ', 'Attribute Qualifier'],
  [0x81, 'PPI', 'Page Position Information'],
  [0x82, 'PV', 'Parameter Value'],
  [0x83, 'PC', 'Presentation Control'],
  [0x84, 'FRMT', 'Font Resolution and Metric Technology'],
  [0x85, 'FO', 'Finishing Operation'],
  [0x86, 'TF', 'Text Fidelity'],
  [0x87, 'MF', 'Media Fidelity'],
  [0x88, 'FIF', 'Finishing Fidelity'],
  [0x8b, 'DOFD', 'Data-Object Font Descriptor'],
  [0x8c, 'LS', 'Locale Selector'],
  [0x8e, 'UP3iFO', 'UP3i Finishing Operation'],
  [0x91, 'CMRD', 'Color Management Resource Descriptor'],
  [0x95, 'RI', 'Rendering Intent'],
  [0x96, 'CMRTF', 'CMR Tag Fidelity'],
  [0x97, 'DA', 'Device Appearance'],
  [0x9a, 'IR', 'Image Resolution'],
  [0x9c, 'OCPSS', 'Object Container Presentation Space Size'],
];

/**
 * Reads a big-endian unsigned number.
 * @param {Uint8Array} d Bytes.
 * @param {number} at Start position.
 * @param {number} n Number of bytes (1–4).
 * @returns {number} The number (0 for bytes past the end).
 */
function num(d, at, n) {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + (d[at + i] ?? 0);
  return v;
}

/**
 * Formats bytes as upper-case hex text.
 * @param {Uint8Array} d Bytes.
 * @returns {string} Hex text, e.g. "C1C2".
 */
function hexOf(d) {
  return Array.from(d, (b) => b.toString(16).toUpperCase().padStart(2, '0')).join('');
}

/**
 * Turns an ASN.1 DER object identifier (tag X'06', length, value) into dotted notation.
 * @param {Uint8Array} d Bytes starting with X'06'.
 * @returns {string|null} E.g. "1.3.18.0.4.1.1.51", or null if the bytes are not an OID.
 */
export function decodeOid(d) {
  if (d[0] !== 0x06 || d.length < 3) return null;
  const len = d[1];
  const body = d.subarray(2, 2 + len);
  if (body.length !== len || len === 0) return null;
  const parts = [Math.floor(body[0] / 40), body[0] % 40];
  let value = 0;
  for (let i = 1; i < body.length; i++) {
    value = value * 128 + (body[i] & 0x7f);
    if ((body[i] & 0x80) === 0) {
      parts.push(value);
      value = 0;
    }
  }
  return parts.join('.');
}

/**
 * Reads EBCDIC digit bytes X'F0'–X'F9' as text.
 * @param {Uint8Array} d Bytes.
 * @returns {string} Digits ("?" for other bytes).
 */
function ebcdicDigits(d) {
  return Array.from(d, (b) => (b >= 0xf0 && b <= 0xf9 ? String(b - 0xf0) : '?')).join('');
}

/** Decoders for the triplets listed in task T027 (data = bytes after length and identifier). */
const DECODERS = {
  0x01: (d) => (num(d, 0, 2) === 0 ? { ccsid: num(d, 2, 2) } : { gcsgid: num(d, 0, 2), cpgid: num(d, 2, 2) }),
  0x02: (d) => {
    const fqnType = d[0];
    const fqnFormat = d[1];
    const name = d.subarray(2);
    return fqnFormat === 0x10
      ? { fqnType, fqnFormat, oid: decodeOid(name), nameHex: hexOf(name) }
      : { fqnType, fqnFormat, nameHex: hexOf(name) };
  },
  0x04: (d) => ({ mappingOption: d[0] }),
  0x10: (d) => ({
    objectClass: d[1],
    structureFlags: num(d, 4, 2),
    oid: decodeOid(d.subarray(6, 22)),
  }),
  0x18: (d) => ({ interchangeSetType: d[0], interchangeSetId: num(d, 1, 2) }),
  0x21: (d) => ({ objectType: d[0] }),
  0x24: (d) => ({ resourceType: d[0], localId: d[1] }),
  0x26: (d) => ({ charRotation: num(d, 0, 2) }),
  0x43: (d) => ({ descriptorPositionId: d[0] }),
  0x4b: (d) => ({ xUnitBase: d[0], yUnitBase: d[1], xUnitsPerBase: num(d, 2, 2), yUnitsPerBase: num(d, 4, 2) }),
  0x4c: (d) => ({ sizeType: d[0], xSize: num(d, 1, 3), ySize: num(d, 4, 3) }),
  0x50: (d) => ({ codePageScheme: num(d, 0, 2), userDataScheme: num(d, 2, 2) }),
  0x5a: (d) => ({ objectType: d[0], objectCount: num(d, 2, 4) }),
  // THunYear: X'40' = 19xx, X'F0' = 20xx, X'F1' = 21xx, … (MO:DCA, Local Date and Time Stamp)
  0x62: (d) => ({
    stampType: d[0],
    year: (d[1] === 0x40 ? 1900 : 2000 + 100 * (d[1] - 0xf0)) + Number(ebcdicDigits(d.subarray(2, 4)) || 0),
    dayOfYear: ebcdicDigits(d.subarray(4, 7)),
    time: `${ebcdicDigits(d.subarray(7, 9))}:${ebcdicDigits(d.subarray(9, 11))}:${ebcdicDigits(d.subarray(11, 13))}.${ebcdicDigits(d.subarray(13, 15))}`,
  }),
  0x65: (d) => ({ commentHex: hexOf(d) }),
};

/**
 * Reads triplet parameters from a syntax table (task T104). Offsets are those of the
 * specification (including Tlength and Tid, so the data starts at offset 2); length −1 means
 * "to the end". Types: 'u' UBIN, 's' SBIN, 'c' CODE/BITS (hex text), 'e' CHAR in EBCDIC,
 * 'w' CHAR in UTF-16BE, 'x' undefined bytes (hex text).
 * @param {[number, number, string, string][]} rows Parameters.
 * @returns {(d: Uint8Array) => object} Decoder returning {name: value} for the parameters present.
 */
const table = (rows) => (d) => {
  const out = {};
  for (const [offset, length, type, name] of rows) {
    const at = offset - 2;
    const n = length < 0 ? d.length - at : length;
    if (at + n > d.length || n <= 0) continue;
    const part = d.subarray(at, at + n);
    if (type === 'u') out[name] = num(d, at, n);
    else if (type === 's') { const v = num(d, at, n); out[name] = v >= 2 ** (8 * n - 1) ? v - 2 ** (8 * n) : v; }
    else if (type === 'e') out[name] = ebcdicName(part, 0, part.length);
    else if (type === 'w') out[name] = Array.from({ length: n >> 1 }, (_, i) => String.fromCharCode((part[2 * i] << 8) | part[2 * i + 1])).join('').replace(/\0+$/, '');
    else out[name] = `X'${hexOf(part)}'`;
  }
  return out;
};

/**
 * Decodes keyword/parameter byte pairs (Presentation Space Mixing Rules X'71').
 * @param {Uint8Array} d Triplet data.
 * @returns {Record<string, string>} Keyword → parameter, as hex.
 */
const keywords = (d) => Object.fromEntries(Array.from({ length: d.length >> 1 }, (_, i) => [`Keyword X'${hexOf(d.subarray(2 * i, 2 * i + 1))}'`, `X'${hexOf(d.subarray(2 * i + 1, 2 * i + 2))}'`]));

/** Decoders for the remaining triplets, from the syntax tables of AFPC-0004-11 chapter 6. */
const TABLES = {
  0x1f: [[2, 1, 'c', 'FtWtClass'], [3, 1, 'c', 'FtWdClass'], [4, 2, 'u', 'FtHeight'], [6, 2, 'u', 'FtWidth'], [8, 1, 'c', 'FtDsFlags'], [19, 1, 'c', 'FtUsFlags']],
  0x20: [[2, 2, 'c', 'GCSGID'], [4, 2, 'c', 'CPGID']],
  0x22: [[2, 1, 'c', 'ResType'], [3, 4, 'c', 'ResLID']],
  0x25: [[2, 1, 'c', 'ResSNum']],
  0x2d: [[2, 4, 'u', 'DirByOff'], [6, 4, 'u', 'DirByHi']],
  0x36: [[4, -1, 'e', 'AttVal']],
  0x45: [[3, 1, 'c', 'EjCtrl']],
  0x46: [[2, 1, 'c', 'PgOvType'], [3, 1, 'c', 'Level']],
  0x47: [[2, 1, 'c', 'Frequency']],
  0x4d: [[3, 3, 's', 'XarOset'], [6, 3, 's', 'YarOset'], [9, 3, 'u', 'XarSize'], [12, 3, 'u', 'YarSize']],
  0x4e: [[3, 1, 'c', 'ColSpce'], [8, 1, 'u', 'ColSize1'], [9, 1, 'u', 'ColSize2'], [10, 1, 'u', 'ColSize3'], [11, 1, 'u', 'ColSize4'], [12, -1, 'c', 'ColValue']],
  0x56: [[2, 4, 'u', 'PageNum']],
  0x57: [[2, 4, 'u', 'ByteExt'], [6, 4, 'u', 'BytExtHi']],
  0x58: [[2, 4, 'u', 'SFOff'], [6, 4, 'u', 'SFOffHi']],
  0x59: [[2, 4, 'u', 'SFExt'], [6, 4, 'u', 'SFExtHi']],
  0x5d: [[2, 2, 'u', 'Hscale']],
  0x5e: [[2, 1, 'c', 'SubObj'], [4, 4, 'u', 'SObjNum'], [8, 4, 'u', 'SObjNmHi']],
  0x68: [[2, 1, 'c', 'MedOrient']],
  0x6c: [[2, 1, 'c', 'ObjType'], [3, 8, 'e', 'ObjName'], [11, 3, 's', 'XobjOset'], [14, 3, 's', 'YobjOset'], [17, 2, 'c', 'ObOrent']],
  0x70: [[2, 1, 'c', 'BgMxFlag']],
  0x72: [[3, 2, 'u', 'YearAD'], [5, 1, 'u', 'Month'], [6, 1, 'u', 'Day'], [7, 1, 'u', 'Hour'], [8, 1, 'u', 'Minute'], [9, 1, 'u', 'Second'],
    [10, 1, 'c', 'TimeZone'], [11, 1, 'u', 'UTCDiffH'], [12, 1, 'u', 'UTCDiffM']],
  0x74: [[3, 1, 'c', 'TSvCtrl']],
  0x75: [[2, 1, 'c', 'StpCoEx'], [4, 1, 'c', 'RepCoEx'], [6, 1, 'c', 'ColSub']],
  0x78: [[2, 1, 'c', 'StpFntEx']],
  0x80: [[2, 4, 'u', 'SeqNum'], [6, 4, 'u', 'LevNum']],
  0x81: [[2, 1, 'u', 'PGPRG']],
  0x82: [[3, 1, 'c', 'ParmSyn'], [4, -1, 'x', 'ParmVal']],
  0x83: [[2, 1, 'c', 'PRSFlg']],
  0x84: [[2, 1, 'c', 'MetTech'], [3, 1, 'c', 'RPuBase'], [4, 2, 'u', 'RPUnits']],
  0x86: [[2, 1, 'c', 'StpTxtEx'], [4, 1, 'c', 'RepTxtEx']],
  0x87: [[2, 1, 'c', 'StpMedEx']],
  0x88: [[2, 1, 'c', 'StpFinEx'], [4, 1, 'c', 'RepFinEx']],
  0x8b: [[2, 1, 'c', 'DOFtFlgs'], [3, 1, 'c', 'FontTech'], [4, 2, 'u', 'VFS'], [6, 2, 'u', 'HFS'], [8, 2, 'c', 'CharRot'], [10, 2, 'c', 'EncEnv'], [12, 2, 'c', 'EncID']],
  0x8c: [[3, 1, 'c', 'LocFlgs'], [4, 8, 'w', 'LangCode'], [12, 8, 'w', 'ScrptCde'], [20, 8, 'w', 'RegCde'], [36, -1, 'w', 'VarCde']],
  0x8e: [[2, 1, 'u', 'Seqnum'], [4, -1, 'x', 'UP3iDat']],
  0x91: [[3, 1, 'c', 'ProcMode'], [4, 1, 'c', 'CMRScpe']],
  0x95: [[4, 1, 'c', 'IOCARI'], [5, 1, 'c', 'OCRI'], [6, 1, 'c', 'PTOCARI'], [7, 1, 'c', 'GOCARI']],
  0x96: [[2, 1, 'c', 'StpCMREx'], [4, 1, 'c', 'RepCMREx']],
  0x97: [[3, 2, 'c', 'DevApp']],
  0x9a: [[4, 1, 'c', 'XBase'], [5, 1, 'c', 'YBase'], [6, 2, 'u', 'XResol'], [8, 2, 'u', 'YResol']],
  0x9c: [[4, 1, 'c', 'PDFSize'], [5, 1, 'c', 'XocBase'], [6, 1, 'c', 'YocBase'], [7, 2, 'u', 'XocUnits'], [9, 2, 'u', 'YocUnits'],
    [11, 3, 'u', 'XpsSize'], [14, 3, 'u', 'YpsSize']],
};
for (const [id, rows] of Object.entries(TABLES)) DECODERS[id] = table(rows);
DECODERS[0x71] = keywords;
DECODERS[0x85] = (d) => { // Finishing Operation: fixed part, then FOpCnt operation positions
  const out = table([[2, 1, 'c', 'FOpType'], [3, 1, 'c', 'FOpOpt'], [5, 1, 'c', 'RefEdge'], [6, 1, 'u', 'FOpCnt'], [7, 2, 'u', 'AxOffst']])(d);
  out.OpPos = Array.from({ length: Math.max(0, (d.length - 7) >> 1) }, (_, i) => num(d, 7 + 2 * i, 2));
  return out;
};

/**
 * Triplets whose decoded values committed expectations assert (synthetic fixtures; layouts
 * checked against the MO:DCA Reference AFPC-0004-11:
 * CGCSGID X'01', Fully Qualified Name X'02', Mapping Option X'04', Object Classification X'10',
 * MO:DCA Interchange Set X'18', Resource Object Type X'21', Resource Local Identifier X'24',
 * Character Rotation X'26', Descriptor Position X'43', Measurement Units X'4B', Object Area Size
 * X'4C', Local Date and Time Stamp X'62', and the task T104 triplets). Encoding Scheme ID X'50',
 * Object Offset X'5A' and Comment X'65' stay rawOnly until an expectation covers them.
 */
const COVERED = new Set([0x01, 0x02, 0x04, 0x10, 0x18, 0x21, 0x24, 0x26, 0x43, 0x4b, 0x4c, 0x62,
  // Task T104 (the tables above): synthetic fixture us2-fields, the CMR Descriptor in
  // us2-metadata, and font, color and time stamp triplets in us2-decoders.
  ...Object.keys(TABLES).map(Number), 0x71, 0x85]);

tripletRegistry.register(TRIPLETS.map(([id, shortName, fullName]) => ({
  id,
  shortName,
  fullName,
  specRef: `${MODCA}, "${fullName}" (X'${id.toString(16).toUpperCase().padStart(2, '0')}')`,
  ...(DECODERS[id] ? { decode: DECODERS[id], rawOnly: !COVERED.has(id) } : {}),
})));

/**
 * Splits triplet bytes into individual triplets and decodes the known ones.
 * @param {Uint8Array} data Bytes containing a sequence of triplets.
 * @returns {{id: number, name: string|null, decoded: object|null, raw: Uint8Array, rawOnly: boolean}[]}
 *   One entry per triplet; unknown or malformed triplets keep only their raw bytes.
 */
export function parseTriplets(data) {
  const out = [];
  let pos = 0;
  while (pos + 2 <= data.length) {
    const len = data[pos];
    if (len < 2 || pos + len > data.length) {
      out.push({ id: data[pos + 1] ?? 0, name: null, decoded: null, raw: data.subarray(pos), rawOnly: true });
      break;
    }
    const id = data[pos + 1];
    const body = data.subarray(pos + 2, pos + len);
    const entry = tripletRegistry.lookup(id);
    let decoded = null;
    if (entry?.decode) {
      try {
        decoded = entry.decode(body);
      } catch {
        decoded = null;
      }
    }
    out.push({ id, name: entry?.fullName ?? null, decoded, raw: data.subarray(pos, pos + len), rawOnly: entry?.rawOnly ?? true });
    pos += len;
  }
  return out;
}
