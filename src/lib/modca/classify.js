/**
 * File classification: decides from a file's content (never its name) what it is — an AFP
 * document, a page segment, an overlay, a font, a form definition, a TrueType font, an
 * unsupported AFP variant, or not an AFP file at all (FR-003, data-model "AfpFile.kind").
 *
 * Classification happens in two steps:
 * 1. `sniffFile` looks at the first bytes: TrueType/OpenType fonts, files damaged by a text-mode
 *    transfer (record introducer X'5A' turned into X'DC'), AFP line data and mixed-mode data.
 * 2. `classifyIndex` looks at the structured field index of AFP files: it reads past a leading
 *    Begin Print File, resource groups, document indexes and comments (NOP) until the first
 *    object begins, and names the file after that object. A file that starts with Begin Resource
 *    gets the type of the resource inside it.
 */

/** Begin field category byte (last byte of D3A8xx) → file kind. */
const BEGIN_KIND = new Map([
  [0xa8, 'document'], // BDT Begin Document
  [0x5f, 'pageSegment'], // BPS
  [0xdf, 'overlay'], // BMO
  [0x89, 'fontCharacterSet'], // BFN
  [0x87, 'codePage'], // BCP
  [0x8a, 'codedFont'], // BCF
  [0xcd, 'formDefinition'], // BFM
  [0xcb, 'unsupported:pageDefinition'], // BPM Begin Page Map
  [0xca, 'unsupported:pageDefinition'], // BDM Begin Data Map
  [0xfb, 'otherResource'], // BIM image
  [0x7b, 'otherResource'], // BII IM image
  [0xbb, 'otherResource'], // BGR graphics
  [0xeb, 'otherResource'], // BBC bar code
  [0x92, 'otherResource'], // BOC object container
  [0x77, 'otherResource'], // BCA color attribute table
]);

const BPF = 0xd3a8a5;
const BRG = 0xd3a8c6;
const BRS = 0xd3a8ce;
const BDI = 0xd3a8a7;
const NOP = 0xd3eeee;

/** ANSI carriage control characters (first byte of a line-data record): ASCII and EBCDIC. */
const ANSI_CC = new Set([
  0x20, 0x30, 0x2d, 0x2b, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x41, 0x42, 0x43,
  0x40, 0xf0, 0x60, 0x4e, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xc1, 0xc2, 0xc3,
]);

/**
 * @typedef {object} Classification
 * @property {string} kind Data-model FileKind, e.g. 'document' or 'notRecognized'.
 * @property {'notAfp'|'unknownEncoding'|'onlyComments'|null} skipReason Why the file is not used.
 */

/**
 * Checks for records with a 4-byte record descriptor word (2-byte length, 2 zero bytes), the
 * usual format of line data copied from mainframes.
 * @param {Uint8Array} head First bytes of the file.
 * @returns {{records: number, structuredFields: number}|null} Record statistics, or null.
 */
function rdwRecords(head) {
  let pos = 0;
  let records = 0;
  let structuredFields = 0;
  while (pos + 4 <= head.length && records < 64) {
    const len = (head[pos] << 8) | head[pos + 1];
    if (len < 5 || head[pos + 2] !== 0 || head[pos + 3] !== 0) break;
    if (head[pos + 4] === 0x5a) structuredFields++;
    records++;
    pos += len;
  }
  return records >= 3 || (records > 0 && pos === head.length) ? { records, structuredFields } : null;
}

/**
 * Checks for text lines (ASCII LF or EBCDIC NL/LF separated) that start with carriage control
 * characters, the other common form of line data.
 * @param {Uint8Array} head First bytes of the file.
 * @returns {{lines: number, structuredFields: number}|null} Line statistics, or null.
 */
function ccLines(head) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < head.length && lines.length < 64; i++) {
    const b = head[i];
    if (b === 0x0a || b === 0x15 || b === 0x25) {
      if (i > start) lines.push(head.subarray(start, i));
      start = i + 1;
      if (head[start] === 0x0d) start++;
    }
  }
  if (lines.length < 3) return null;
  const withCc = lines.filter((l) => ANSI_CC.has(l[0] === 0x0d ? l[1] : l[0])).length;
  if (withCc / lines.length < 0.9) return null;
  return { lines: lines.length, structuredFields: lines.filter((l) => l[0] === 0x5a).length };
}

/**
 * Looks at the first bytes of a file to recognize non-MO:DCA content.
 * @param {import('../io/byte-source.js').ByteSource} source File to check.
 * @returns {Promise<Classification & {isAfp: boolean}>} `isAfp` true means: read the structured
 *   fields and call classifyIndex; otherwise `kind` is final.
 */
export async function sniffFile(source) {
  const head = await source.read(0, 4096);
  const result = (kind, skipReason = null) => ({ isAfp: false, kind, skipReason });
  if (head.length === 0) return result('notRecognized', 'notAfp');
  const magic = String.fromCharCode(...head.subarray(0, 4));
  if (magic === '\x00\x01\x00\x00' || magic === 'true' || magic === 'OTTO' || magic === 'ttcf') {
    return result('truetypeFont');
  }
  if (head[0] === 0x5a) return { isAfp: true, kind: null, skipReason: null };
  // X'5A' read as EBCDIC 273 is "Ü", which Latin-1 stores as X'DC'; X'D3' becomes X'4C'.
  if (head[0] === 0xdc && head[3] === 0x4c) return result('notRecognized', 'unknownEncoding');
  const rdw = rdwRecords(head);
  if (rdw) return result(rdw.structuredFields > 0 ? 'unsupported:mixedMode' : 'unsupported:lineData');
  const lines = ccLines(head);
  if (lines) return result(lines.structuredFields > 0 ? 'unsupported:mixedMode' : 'unsupported:lineData');
  return result('notRecognized', 'notAfp');
}

/**
 * Names an AFP file after the first object it contains.
 * @param {import('./field-index.js').FieldIndex} index The file's structured field index.
 * @returns {Classification} Kind and skip reason.
 */
export function classifyIndex(index) {
  if (index.count === 0) return { kind: 'notRecognized', skipReason: 'notAfp' };
  let printFile = -1;
  let sawResourceGroup = false;
  let sawOther = false;
  for (let row = 0; row < index.count; row++) {
    const parent = index.parent[row];
    if (parent !== -1 && parent !== printFile) continue; // inside an object: not decisive
    const id = index.id[row];
    if (id === BPF) { printFile = row; continue; }
    if (id === NOP) continue;
    if (id === BRG) { sawResourceGroup = true; continue; }
    if (id === BDI) continue;
    if (id === BRS) {
      for (let r = row + 1; r < index.count && index.parent[r] === row; r++) {
        const kind = BEGIN_KIND.get(index.id[r] & 0xff);
        if ((index.id[r] >> 8) === 0xd3a8 && kind) return { kind, skipReason: null };
      }
      sawOther = true;
      continue;
    }
    if ((id >> 8) === 0xd3a8) {
      const kind = BEGIN_KIND.get(id & 0xff);
      if (kind) return { kind, skipReason: null };
    }
    if ((id >> 8) !== 0xd3a9) sawOther = true; // ignore End fields
  }
  if (sawResourceGroup) return { kind: 'resourceGroup', skipReason: null };
  if (!sawOther) return { kind: 'notRecognized', skipReason: 'onlyComments' };
  return { kind: 'otherResource', skipReason: null };
}
