/**
 * Parameter decoders for the structured fields used in rendering (task T056): document, page,
 * environment, resource, include, object area, mapping and IM image fields, and the object
 * descriptors defined by the object architectures (IDD, GDD, BDD, PTD).
 *
 * Every layout is a table of parameters with the offsets, types and names of the defining
 * specification, so the structure view shows the specification's own parameter names:
 * - MO:DCA Reference (AFPC-0004-11): BDT, BNG, BPG, BAG, BRG, BRS, IPS, IPO, IOB, IMM, BOC, OBD,
 *   OBP, CDD, MBC, MIO, MGO, MDD, PEC, PGD, PTD format 1, MCF formats 1 and 2, MDR, and the IM
 *   image fields BII, EII, ICP, IID, IOC, IRD (appendix "IM Image Object");
 * - PTOCA Reference (AFPC-0009-04), "Presentation Text Data Descriptor (PTD)": PTD format 2;
 * - IOCA Reference (AFPC-0003-09), "Image Data Descriptor (IDD)";
 * - GOCA for AFP Reference (AFPC-0008-03), "Graphics Data Descriptor (GDD) in the MO:DCA
 *   Environment" (Window Specification X'F6');
 * - BCOCA Reference (AFPC-0005), Table 8 "Bar Code Symbol Descriptor" (BDD).
 *
 * Parameter values: CHAR → text (EBCDIC 500), UBIN/SBIN → number, CODE and BITS → hex text such
 * as "X'2D00'", UNDF data → its length in bytes. Reserved and retired bytes are not listed.
 * Triplets are returned as byte ranges and decoded by the triplet registry.
 *
 * Coverage (Principle I, task T020): fields whose decoded values are asserted in no committed
 * expectation stay `rawOnly` (see RAW_ONLY below); the structure view then shows them raw.
 */

import { fieldRegistry } from './index.js';
import { ebcdicName } from '../bytes.js';

/**
 * @typedef {object} DecodedField
 * @property {{name: string, value: (string|number)}[]} parameters Parameters in field order.
 * @property {[number, number][]} tripletRanges Byte ranges [start, end) holding triplets.
 */

/**
 * Reads a big-endian unsigned number (missing bytes count as zero).
 * @param {Uint8Array} d Data.
 * @param {number} at Position.
 * @param {number} n Number of bytes.
 * @returns {number} Value.
 */
const ubin = (d, at, n) => {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + (d[at + i] ?? 0);
  return v;
};
/**
 * Reads a big-endian two's-complement signed number.
 * @param {Uint8Array} d Data.
 * @param {number} at Position.
 * @param {number} n Number of bytes.
 * @returns {number} Value.
 */
const sbin = (d, at, n) => {
  const v = ubin(d, at, n);
  return v >= 2 ** (8 * n - 1) ? v - 2 ** (8 * n) : v;
};
/**
 * Writes a byte range as hex text, e.g. "X'2D00'".
 * @param {Uint8Array} d Data.
 * @param {number} at Position.
 * @param {number} n Number of bytes.
 * @returns {string} Hex text.
 */
const code = (d, at, n) => `X'${Array.from(d.subarray(at, at + n), (b) => b.toString(16).toUpperCase().padStart(2, '0')).join('')}'`;

/**
 * Reads fixed parameters.
 * @param {Uint8Array} d Field data.
 * @param {[number, number, string, string][]} layout [offset, length, type, name]; type is one
 *   of 'char', 'ubin', 'sbin', 'code', 'undf'.
 * @param {number} [base] Offset added to every parameter offset (for repeating groups).
 * @param {string} [prefix] Prefix for the names (e.g. "RG 1 ").
 * @returns {{name: string, value: (string|number)}[]} Parameters present in the data.
 */
function fixed(d, layout, base = 0, prefix = '') {
  const out = [];
  for (const [offset, length, type, name] of layout) {
    const at = base + offset;
    if (type === 'undf') {
      out.push({ name: `${prefix}${name} (bytes)`, value: Math.max(0, d.length - at) });
      continue;
    }
    if (at + length > d.length) break;
    let value;
    if (type === 'char') value = ebcdicName(d, at, length);
    else if (type === 'ubin') value = ubin(d, at, length);
    else if (type === 'sbin') value = sbin(d, at, length);
    else value = code(d, at, length);
    out.push({ name: `${prefix}${name}`, value });
  }
  return out;
}

/**
 * Decoder for "fixed parameters, then triplets".
 * @param {[number, number, string, string][]} layout Parameters.
 * @param {number|null} tripletsAt Offset of the triplets, or null if the field has none.
 * @returns {(d: Uint8Array) => DecodedField} Decoder.
 */
const withTriplets = (layout, tripletsAt) => (d) => ({
  parameters: fixed(d, layout),
  tripletRanges: tripletsAt !== null && d.length > tripletsAt ? [[tripletsAt, d.length]] : [],
});

/**
 * Decoder for fields made of repeating groups with a 2-byte length followed by triplets
 * (MCF format 2, MDR, MBC, MIO, MGO).
 * @param {Uint8Array} d Field data.
 * @returns {DecodedField} Decoded field.
 */
function tripletGroups(d) {
  const parameters = [];
  const tripletRanges = [];
  for (let pos = 0, n = 1; pos + 2 <= d.length; n++) {
    const len = ubin(d, pos, 2);
    parameters.push({ name: `RG ${n} RGLength`, value: len });
    if (len < 2) break;
    tripletRanges.push([pos + 2, Math.min(d.length, pos + len)]);
    pos += len;
  }
  return { parameters, tripletRanges };
}


/**
 * Decoder for repeating groups of a fixed length that follows from the specification or from a
 * length byte in the field (MPS, MMO, MCC, PGP, CFI and the FOCA font tables).
 * @param {number} headerLength Bytes before the first group.
 * @param {[number, number, string, string][]} header Parameters of the header.
 * @param {number|((d: Uint8Array) => number)} groupLength Group length, or a function reading it.
 * @param {[number, number, string, string][]} layout Parameters of each group.
 * @returns {(d: Uint8Array) => DecodedField} Decoder; throws if the data does not consist of
 *   whole groups, so the field is then shown raw.
 */
const fixedGroups = (headerLength, header, groupLength, layout) => (d) => {
  const rg = typeof groupLength === 'function' ? groupLength(d) : groupLength;
  if (!rg || (d.length - headerLength) % rg !== 0) throw new RangeError('data is not made of whole repeating groups');
  const parameters = fixed(d, header);
  for (let pos = headerLength, n = 1; pos + rg <= d.length; pos += rg, n++) parameters.push(...fixed(d, layout, pos, `RG ${n} `));
  return { parameters, tripletRanges: [] };
};

/**
 * Decoder for repeating groups with a 2-byte length, fixed parameters and triplets (MPO, MMD,
 * MMT, LLE, MCD).
 * @param {number} headerLength Bytes before the first group.
 * @param {[number, number, string, string][]} header Parameters of the header.
 * @param {[number, number, string, string][]} layout Parameters of each group after RGLength.
 * @param {number} tripletsAt Offset of the triplets inside a group.
 * @returns {(d: Uint8Array) => DecodedField} Decoder.
 */
const lengthGroups = (headerLength, header, layout, tripletsAt) => (d) => {
  const parameters = fixed(d, header);
  const tripletRanges = [];
  for (let pos = headerLength, n = 1; pos + 2 <= d.length; n++) {
    const len = ubin(d, pos, 2);
    parameters.push({ name: `RG ${n} RGLength`, value: len });
    if (len < tripletsAt) throw new RangeError(`repeating group ${n} too short`);
    parameters.push(...fixed(d.subarray(0, pos + len), layout, pos, `RG ${n} `));
    tripletRanges.push([pos + tripletsAt, Math.min(d.length, pos + len)]);
    pos += len;
  }
  return { parameters, tripletRanges };
};

/**
 * Decoder for fields whose data is defined by another architecture or not at all (UNDF): shows the byte count.
 * @param {string} name Parameter name.
 * @returns {(d: Uint8Array) => DecodedField} Decoder.
 */
const undefinedData = (name) => (d) => ({ parameters: [{ name: `${name} (bytes)`, value: d.length }], tripletRanges: [] });

/**
 * Layout of an 8-byte name parameter at offset 0.
 * @param {string} name Parameter name.
 * @returns {[number, number, string, string][]} Layout.
 */
const NAME = (name) => [[0, 8, 'char', name]];
/**
 * Layout of two orientation parameters (2 bytes each).
 * @param {string} x Name of the first.
 * @param {string} y Name of the second.
 * @param {number} at Offset of the first.
 * @returns {[number, number, string, string][]} Layout.
 */
const ORIENTATIONS = (x, y, at) => [[at, 2, 'code', x], [at + 2, 2, 'code', y]];

/** Decoders by field identifier. */
const DECODERS = {
  0xd3a8a8: withTriplets(NAME('DocName'), 10), // BDT
  0xd3a8ad: withTriplets(NAME('PGrpName'), 8), // BNG
  0xd3a8af: withTriplets(NAME('PageName'), 8), // BPG
  0xd3a8c9: withTriplets(NAME('AEGName'), 8), // BAG
  0xd3a8c6: withTriplets(NAME('RGrpName'), 8), // BRG
  0xd3a8ce: withTriplets(NAME('RSName'), 10), // BRS
  0xd3abcc: withTriplets(NAME('MMPName'), 8), // IMM
  0xd3a892: withTriplets(NAME('ObjCName'), 8), // BOC
  0xd3af5f: withTriplets([...NAME('PsegName'), [8, 3, 'sbin', 'XpsOset'], [11, 3, 'sbin', 'YpsOset']], 14), // IPS
  0xd3afd8: withTriplets([...NAME('OvlyName'), [8, 3, 'sbin', 'XolOset'], [11, 3, 'sbin', 'YolOset'],
    [14, 2, 'code', 'OvlyOrent']], 16), // IPO
  0xd3afc3: withTriplets([...NAME('ObjName'), [9, 1, 'code', 'ObjType'], [10, 3, 'sbin', 'XoaOset'],
    [13, 3, 'sbin', 'YoaOset'], ...ORIENTATIONS('XoaOrent', 'YoaOrent', 16), [20, 3, 'sbin', 'XocaOset'],
    [23, 3, 'sbin', 'YocaOset'], [26, 1, 'code', 'RefCSys']], 27), // IOB
  0xd3a66b: withTriplets([], 0), // OBD
  0xd3ac6b: withTriplets([[0, 1, 'ubin', 'OAPosID'], [1, 1, 'ubin', 'RGLength'], [2, 3, 'sbin', 'XoaOset'],
    [5, 3, 'sbin', 'YoaOset'], ...ORIENTATIONS('XoaOrent', 'YoaOrent', 8), [13, 3, 'sbin', 'XocaOset'],
    [16, 3, 'sbin', 'YocaOset'], ...ORIENTATIONS('XocaOrent', 'YocaOrent', 19), [23, 1, 'code', 'RefCSys']], null), // OBP
  0xd3a692: withTriplets([], 12), // CDD (bytes 0–11 retired)
  0xd3abeb: tripletGroups, // MBC
  0xd3abfb: tripletGroups, // MIO
  0xd3abbb: tripletGroups, // MGO
  0xd3ab8a: tripletGroups, // MCF format 2
  0xd3abc3: tripletGroups, // MDR
  0xd3a7a8: withTriplets([], 2), // PEC
  0xd3a688: withTriplets([[0, 1, 'code', 'XmBase'], [1, 1, 'code', 'YmBase'], [2, 2, 'ubin', 'XmUnits'],
    [4, 2, 'ubin', 'YmUnits'], [6, 3, 'ubin', 'XmSize'], [9, 3, 'ubin', 'YmSize'], [12, 1, 'code', 'MDDFlgs']], 13), // MDD
  0xd3a6af: withTriplets([[0, 1, 'code', 'XpgBase'], [1, 1, 'code', 'YpgBase'], [2, 2, 'ubin', 'XpgUnits'],
    [4, 2, 'ubin', 'YpgUnits'], [6, 3, 'ubin', 'XpgSize'], [9, 3, 'ubin', 'YpgSize']], 15), // PGD
  0xd3a69b: withTriplets([[0, 1, 'code', 'XptBase'], [1, 1, 'code', 'YptBase'], [2, 2, 'ubin', 'XptUnits'],
    [4, 2, 'ubin', 'YptUnits'], [6, 2, 'ubin', 'XptSize'], [8, 2, 'ubin', 'YptSize']], null), // PTD format 1
  0xd3b19b: withTriplets([[0, 1, 'code', 'XPBASE'], [1, 1, 'code', 'YPBASE'], [2, 2, 'ubin', 'XPUNITVL'],
    [4, 2, 'ubin', 'YPUNITVL'], [6, 3, 'ubin', 'XPEXTENT'], [9, 3, 'ubin', 'YPEXTENT'], [12, 2, 'code', 'TEXTFLAGS'],
    [14, 0, 'undf', 'TXTCONDS']], null), // PTD format 2 (PTOCA)
  0xd3b18a: (d) => { // MCF format 1: RGLength, then fixed repeating groups
    const rg = d[0] || 0x1e;
    const parameters = [{ name: 'RGLength', value: d[0] }];
    for (let pos = 4, n = 1; pos + 28 <= d.length; pos += rg, n++) {
      parameters.push(...fixed(d, [[0, 1, 'ubin', 'CFLid'], [2, 1, 'code', 'Sectid'], [4, 8, 'char', 'CFName'],
        [12, 8, 'char', 'CPName'], [20, 8, 'char', 'FCSName'], ...(rg >= 30 ? [[28, 2, 'code', 'CharRot']] : [])], pos, `RG ${n} `));
    }
    return { parameters, tripletRanges: [] };
  },
  0xd3a6fb: (d) => { // IDD (IOCA): fixed parameters, then self-defining fields
    const parameters = fixed(d, [[0, 1, 'code', 'UNITBASE'], [1, 2, 'ubin', 'XRESOL'], [3, 2, 'ubin', 'YRESOL'],
      [5, 2, 'ubin', 'XSIZE'], [7, 2, 'ubin', 'YSIZE']]);
    for (let pos = 9; pos + 2 <= d.length; pos += 2 + d[pos + 1]) {
      parameters.push({ name: `SDF ${code(d, pos, 1)}`, value: code(d, pos + 2, d[pos + 1]) });
    }
    return { parameters, tripletRanges: [] };
  },
  0xd3a6bb: (d) => { // GDD (GOCA): self-identifying parameters
    const parameters = [];
    for (let pos = 0; pos + 2 <= d.length; pos += 2 + d[pos + 1]) {
      if (d[pos] === 0xf6) {
        // Window Specification; offsets from the GOCA table, which counts the code and length.
        parameters.push(...fixed(d, [[2, 1, 'code', 'FLAGS'], [4, 1, 'code', 'CFORMAT'], [5, 1, 'code', 'UBASE'],
          [6, 2, 'ubin', 'XRESOL'], [8, 2, 'ubin', 'YRESOL'], [10, 2, 'ubin', 'IMXYRES'], [12, 2, 'sbin', 'XLWIND'],
          [14, 2, 'sbin', 'XRWIND'], [16, 2, 'sbin', 'YBWIND'], [18, 2, 'sbin', 'YTWIND']], pos));
      } else {
        parameters.push({ name: `Parameter ${code(d, pos, 1)}`, value: code(d, pos + 2, d[pos + 1]) });
      }
    }
    return { parameters, tripletRanges: [] };
  },
  0xd3a6eb: withTriplets([[0, 1, 'code', 'Unit base'], [2, 2, 'ubin', 'XUPUB'], [4, 2, 'ubin', 'YUPUB'],
    [6, 2, 'ubin', 'X extent'], [8, 2, 'ubin', 'Y extent'], [10, 2, 'ubin', 'Symbol width'], [12, 1, 'code', 'Type'],
    [13, 1, 'code', 'Modifier'], [14, 1, 'code', 'Local ID'], [15, 2, 'code', 'Color'], [17, 1, 'ubin', 'Module width'],
    [18, 2, 'ubin', 'Element height'], [20, 1, 'ubin', 'Multiplier'], [21, 2, 'ubin', 'WE:NE']], 23), // BDD (BCOCA BSD)
  0xd3a87b: withTriplets(NAME('ImoName'), null), // BII
  0xd3a97b: withTriplets(NAME('ImoName'), null), // EII
  0xd3ac7b: withTriplets([[0, 2, 'ubin', 'XCOset'], [2, 2, 'ubin', 'YCOset'], [4, 2, 'ubin', 'XCSize'],
    [6, 2, 'ubin', 'YCSize'], [8, 2, 'ubin', 'XFilSize'], [10, 2, 'ubin', 'YFilSize']], null), // ICP
  0xd3a67b: withTriplets([[0, 12, 'code', 'ConData1'], [12, 1, 'code', 'XBase'], [13, 1, 'code', 'YBase'],
    [14, 2, 'ubin', 'XUnits'], [16, 2, 'ubin', 'YUnits'], [18, 2, 'ubin', 'XSize'], [20, 2, 'ubin', 'YSize'],
    [22, 6, 'code', 'ConData2'], [28, 2, 'ubin', 'XCSizeD'], [30, 2, 'ubin', 'YCSizeD'], [32, 2, 'code', 'ConData3'],
    [34, 2, 'code', 'Color']], null), // IID
  0xd3a77b: withTriplets([[0, 3, 'ubin', 'XoaOset'], [3, 3, 'ubin', 'YoaOset'], ...ORIENTATIONS('XoaOrent', 'YoaOrent', 6),
    [10, 8, 'code', 'ConData1'], [18, 2, 'code', 'XMap'], [20, 2, 'code', 'YMap'], [22, 2, 'code', 'ConData2']], null), // IOC
  0xd3ee7b: withTriplets([[0, 0, 'undf', 'IMdata']], null), // IRD
};

/**
 * Fields whose decoded values no committed expectation asserts yet (Principle I): shown raw in
 * the structure view until a fixture or reference expectation covers them.
 */

/**
 * Decoders added for the structure view (task T104), from the syntax tables of
 * MO:DCA Reference AFPC-0004-11 (chapter 5) and FOCA Reference AFPC-0006-06 (chapter 6).
 * Begin and End fields: name in bytes 0–7, triplets from byte 8 where the field has them.
 * Not decoded (shown raw): Color Attribute Table fields BCA, ECA, CAT, MCA (not in
 * AFPC-0004-11), PGP format 1 (X'D3ACAF', retired), the line-data page definition fields BDM,
 * EDM, BPM, EPM (AFP Line Data Reference, not available here), CPI (its group length is given by
 * CPC and Unicode entries have variable length) and FNN (variable-length sections).
 */
const NAMED = {
  0xd3a8a5: 'PFName', 0xd3a9a5: 'PFName', 0xd3a9a8: 'DocName', 0xd3a9ad: 'PGrpName', 0xd3a9af: 'PageName',
  0xd3a8c7: 'OEGName', 0xd3a8c4: 'DEGName', 0xd3a8a7: 'IndxName', 0xd3a9a7: 'IndxName', 0xd3a9c6: 'RGrpName',
  0xd3a85f: 'PsegName', 0xd3a8df: 'OvlyName', 0xd3a9df: 'OvlyName', 0xd3a89b: 'PTdoName', 0xd3a99b: 'PTdoName',
  0xd3a8fb: 'IdoName', 0xd3a9fb: 'IdoName', 0xd3a8bb: 'GdoName', 0xd3a9bb: 'GdoName', 0xd3a8eb: 'BCdoName',
  0xd3a9eb: 'BCdoName', 0xd3a992: 'ObjCName', 0xd3a8cd: 'FMName', 0xd3a8cc: 'MMName',
  0xd3a889: 'CSName', 0xd3a887: 'CPName', // BFN, BCP (FOCA)
};
/** Begin/End fields with a name only (no triplets). */
const NAME_ONLY = {
  0xd3a9c9: 'AEGName', 0xd3a9c7: 'OEGName', 0xd3a9c4: 'DEGName', 0xd3a9ce: 'RSName', 0xd3a95f: 'PsegName',
  0xd3a9cd: 'FMName', 0xd3a9cc: 'MMName', 0xd3a88a: 'CFName', 0xd3a98a: 'CFName', 0xd3a987: 'CPName', 0xd3a989: 'CSName',
};
for (const [id, name] of Object.entries(NAMED)) DECODERS[id] = withTriplets(NAME(name), 8);
for (const [id, name] of Object.entries(NAME_ONLY)) DECODERS[id] = withTriplets(NAME(name), null);
Object.assign(DECODERS, {
  0xd3a090: withTriplets([], 0), // TLE
  0xd3b2a7: withTriplets([], 0), // IEL
  0xd3eeee: undefinedData('UndfData'), // NOP
  0xd3ee9b: undefinedData('PTOCA data'), // PTX: presentation text control sequences
  0xd3eefb: undefinedData('IOCA data'), // IPD
  0xd3eebb: undefinedData('GOCA data'), // GAD
  0xd3eeeb: undefinedData('BCOCA data'), // BDA
  0xd3ee92: undefinedData('ObjCdat'), // OCD
  0xd3ee89: undefinedData('PatData'), // FNG
  0xd3b490: lengthGroups(2, [[0, 1, 'code', 'LnkType']], [[2, 1, 'code', 'RGFunct']], 3), // LLE
  0xd3b288: withTriplets([[1, 1, 'code', 'PFCFlgs']], 4), // PFC
  0xd3abd8: lengthGroups(0, [], [], 2), // MPO
  0xd3abcd: lengthGroups(0, [], [], 2), // MMD
  0xd3ab88: lengthGroups(0, [], [], 8), // MMT
  0xd3ab92: lengthGroups(0, [], [], 2), // MCD
  0xd3b15f: fixedGroups(4, [[0, 1, 'ubin', 'RGLength']], (d) => d[0], [[4, 8, 'char', 'PsegName']]), // MPS
  0xd3b1df: fixedGroups(4, [[0, 1, 'ubin', 'RGLength']], (d) => d[0], [[0, 1, 'ubin', 'OVLid'], [1, 1, 'code', 'Flags'],
    [4, 8, 'char', 'OVLname']]), // MMO
  0xd3a288: fixedGroups(0, [], 6, [[0, 2, 'ubin', 'Startnum'], [2, 2, 'ubin', 'Stopnum'], [5, 1, 'code', 'MMCid']]), // MCC
  0xd3a788: (d) => { // MMC: identifier, X'FF', keyword/parameter pairs
    const parameters = fixed(d, [[0, 1, 'code', 'MMCid'], [1, 1, 'code', 'Constant']]);
    for (let pos = 2; pos + 2 <= d.length; pos += 2) parameters.push({ name: `Keyword ${code(d, pos, 1)}`, value: code(d, pos + 1, 1) });
    return { parameters, tripletRanges: [] };
  },
  0xd3a088: withTriplets([[0, 1, 'code', 'MFCFlgs'], [2, 1, 'code', 'MedColl'], [3, 1, 'code', 'MFCScpe']], 4), // MFC
  0xd3a7af: withTriplets([[0, 1, 'code', 'PMCid']], 2), // PMC
  // MSU: repeating groups of suppression name (8), reserved (1), local ID (1) (MO:DCA "Map Suppression").
  0xd3abea: fixedGroups(0, [], 10, [[0, 8, 'char', 'SUPname'], [9, 1, 'ubin', 'SUPid']]),
  0xd3afaf: withTriplets([...NAME('PgName'), [16, 1, 'code', 'IPgFlgs']], 17), // IPG
  0xd3b1af: (d) => { // PGP format 2: constant, then groups of RGLength bytes (10–12)
    const parameters = fixed(d, [[0, 1, 'code', 'Constant']]);
    for (let pos = 1, n = 1; pos < d.length; n++) {
      const rg = d[pos];
      if (rg < 10 || pos + rg > d.length) throw new RangeError(`invalid PGP repeating group length ${rg}`);
      parameters.push(...fixed(d.subarray(0, pos + rg), [[0, 1, 'ubin', 'RGLength'], [1, 3, 'sbin', 'XmOset'], [4, 3, 'sbin', 'YmOset'],
        [7, 2, 'code', 'PGorient'], [9, 1, 'code', 'SHside'], [10, 1, 'code', 'PgFlgs'], [11, 1, 'ubin', 'PMCid']], pos, `RG ${n} `));
      pos += rg;
    }
    return { parameters, tripletRanges: [] };
  },
  // FOCA
  0xd3a689: withTriplets([[0, 32, 'char', 'TypeFcDesc'], [32, 1, 'code', 'FtWtClass'], [33, 1, 'code', 'FtWdClass'],
    [34, 2, 'ubin', 'MaxPtSize'], [36, 2, 'ubin', 'NomPtSize'], [38, 2, 'ubin', 'MinPtSize'], [40, 2, 'ubin', 'MaxHSize'],
    [42, 2, 'ubin', 'NomHSize'], [44, 2, 'ubin', 'MinHSize'], [46, 1, 'code', 'DsnGenCls'], [47, 1, 'code', 'DsnSubCls'],
    [48, 1, 'code', 'DsnSpcGrp'], [64, 2, 'code', 'FtDsFlags'], [76, 2, 'ubin', 'GCSGID'], [78, 2, 'ubin', 'FGID']], 80), // FND
  0xd3a789: withTriplets([[1, 1, 'code', 'PatTech'], [3, 1, 'code', 'FntFlags'], [4, 1, 'code', 'XUnitBase'],
    [5, 1, 'code', 'YUnitBase'], [6, 2, 'ubin', 'XftUnits'], [8, 2, 'ubin', 'YftUnits'], [10, 2, 'ubin', 'MaxBoxWd'],
    [12, 2, 'ubin', 'MaxBoxHt'], [14, 1, 'ubin', 'FNORGLen'], [15, 1, 'ubin', 'FNIRGLen'], [16, 1, 'code', 'PatAlign'],
    [17, 3, 'ubin', 'RPatDCnt'], [20, 1, 'ubin', 'FNPRGLen'], [21, 1, 'ubin', 'FNMRGLen'], [22, 1, 'code', 'ResXUBase'],
    [23, 1, 'code', 'ResYUBase'], [24, 2, 'ubin', 'XfrUnits'], [26, 2, 'ubin', 'YfrUnits'], [28, 4, 'ubin', 'OPatDCnt'],
    [35, 1, 'ubin', 'FNNRGLen'], [36, 4, 'ubin', 'FNNDCnt'], [40, 2, 'ubin', 'FNNMapCnt']], 42), // FNC
  0xd3ae89: fixedGroups(0, [], 26, [[2, 2, 'code', 'CharRot'], [4, 2, 'sbin', 'MaxBOset'], [6, 2, 'ubin', 'MaxCharInc'],
    [8, 2, 'ubin', 'SpCharInc'], [10, 2, 'ubin', 'MaxBExt'], [12, 1, 'code', 'OrntFlgs'], [14, 2, 'ubin', 'EmSpInc'],
    [18, 2, 'ubin', 'FigSpInc'], [20, 2, 'ubin', 'NomCharInc'], [22, 2, 'ubin', 'DefBInc'], [24, 2, 'sbin', 'MinASp']]), // FNO
  0xd3ac89: fixedGroups(0, [], 22, [[2, 2, 'sbin', 'LcHeight'], [4, 2, 'sbin', 'CapMHt'], [6, 2, 'sbin', 'MaxAscHt'],
    [8, 2, 'sbin', 'MaxDesDp'], [17, 2, 'ubin', 'UscoreWd'], [19, 1, 'ubin', 'UscoreWdf'], [20, 2, 'sbin', 'UscorePos']]), // FNP
  0xd38c89: fixedGroups(0, [], 28, [[0, 8, 'char', 'GCGID'], [8, 2, 'ubin', 'CharInc'], [10, 2, 'sbin', 'AscendHt'],
    [12, 2, 'sbin', 'DescendDp'], [16, 2, 'ubin', 'FNMCnt'], [18, 2, 'sbin', 'ASpace'], [20, 2, 'ubin', 'BSpace'],
    [22, 2, 'sbin', 'CSpace'], [26, 2, 'sbin', 'BaseOset']]), // FNI
  0xd3a289: fixedGroups(0, [], 8, [[0, 2, 'ubin', 'CharBoxWd'], [2, 2, 'ubin', 'CharBoxHt'], [4, 4, 'ubin', 'PatDOset']]), // FNM
  0xd3a687: withTriplets([[0, 32, 'char', 'CPDesc'], [32, 2, 'ubin', 'GCGIDLen'], [34, 4, 'ubin', 'NumCdPts'],
    [38, 2, 'ubin', 'GCSGID'], [40, 2, 'ubin', 'CPGID'], [42, 2, 'code', 'EncScheme']], null), // CPD
  0xd3a787: withTriplets([[0, 8, 'char', 'DefCharID'], [8, 1, 'code', 'PrtFlags'], [9, 1, 'code', 'CPIRGLen'],
    [10, 1, 'ubin', 'VSCharSN'], [11, 1, 'ubin', 'VSChar'], [12, 1, 'code', 'VSFlags']], null), // CPC
  0xd3a78a: withTriplets([[0, 1, 'ubin', 'CFIRGLen']], 2), // CFC
  0xd38c8a: fixedGroups(0, [], 25, [[0, 8, 'char', 'FCSName'], [8, 8, 'char', 'CPName'], [16, 2, 'ubin', 'SVSize'],
    [18, 2, 'ubin', 'SHScale'], [24, 1, 'ubin', 'Section']]), // CFI
});

// The task T104 decoders are asserted by the synthetic fixtures us2-fields (print file, index,
// form map and medium map fields, coded font), us2-structure (TLE, NOP, End fields),
// us1-overlay-segment (page segment, overlay, text object, font character set and code page
// fields of the fixture font), us1-images, us1-graphics and us1-barcodes.
const RAW_ONLY = new Set([]);

for (const [id, decode] of Object.entries(DECODERS)) {
  fieldRegistry.setDecoder(Number(id), decode, { rawOnly: RAW_ONLY.has(Number(id)) });
}
