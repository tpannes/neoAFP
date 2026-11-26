/**
 * Field tree for the structure view (FR-030, data-model "TreeNode"): every structured field of a
 * file in file order, built lazily one level at a time from the field index.
 * - A Begin field is a branch: its own triplets come first, then the fields inside it, then its
 *   End field (MO:DCA Reference, "Begin/End structured fields" delimit objects and groups).
 * - Any other field with triplets is a branch holding its triplets.
 * - Triplets are leaves.
 * Each node has a kind the viewer turns into an icon: the object kind for Begin fields (page,
 * overlay, image …), the include kind for Include fields, else the kind of structured field
 * named by the type code in its identifier (MO:DCA Reference, "Structured Field Introducer":
 * X'A6' descriptor, X'AB' map, X'EE' data …), with TLEs and NOPs on their own.
 */

import { fieldData, sequentialReader } from './access.js';
import { ebcdicName } from './bytes.js';
import { lookupField } from './registry/index.js';
import { fieldTriplets, pageNumberOfBegin, enclosingPage } from '../meta/owner.js';
import { tlePreview } from '../meta/tle.js';
import { inheritedCodePage } from '../meta/owner.js';
import { detectNopCodePage } from '../meta/nop.js';
import { decodePrintable, DEFAULT_CODE_PAGE } from '../meta/hex.js';
import { loadCodePage } from '../codepages/index.js';
import { tripletPreviews } from './triplet-preview.js';

const TLE = 0xd3a090;
const NOP = 0xd3eeee;

/** Object kinds by the short name of the Begin field. */
const BEGIN_KINDS = {
  BPF: 'printFile', BDT: 'document', BNG: 'pageGroup', BPG: 'page', BAG: 'environmentGroup',
  BOG: 'objectEnvironmentGroup', BDG: 'documentEnvironmentGroup', BDI: 'documentIndex',
  BRG: 'resourceGroup', BRS: 'resource', BPS: 'pageSegment', BMO: 'overlay', BPT: 'text',
  BIM: 'image', BII: 'imImage', BGR: 'graphics', BBC: 'barcode', BOC: 'objectContainer',
  BFM: 'formDefinition', BMM: 'mediumMap', BPM: 'pageMap', BDM: 'dataMap', BFN: 'fontCharacterSet',
  BCP: 'codePage', BCF: 'codedFont', BCA: 'colorAttributeTable',
};

/** Include fields: kinds; their first 8 bytes name what they include. */
const INCLUDE_KINDS = { IPS: 'includeSegment', IPO: 'includeOverlay', IOB: 'includeObject', IPG: 'includePage' };

/**
 * Font and code page fields (FOCA Reference: font character set fields end in X'89', code page
 * fields in X'87'; coded font control and index by name) – their type codes do not follow the
 * MO:DCA meaning, so they get one kind of their own.
 */
const FONT_SHORT_NAMES = new Set(['CFC', 'CFI']);

/** Kinds of the other fields by the type code (second byte of the identifier). */
const TYPE_KINDS = {
  0xa0: 'attribute', 0xa2: 'copyCount', 0xa6: 'descriptor', 0xa7: 'control', 0xa9: 'end', 0xab: 'map',
  0xac: 'position', 0xad: 'process', 0xaf: 'include', 0xb0: 'table', 0xb1: 'migration',
  0xb2: 'variable', 0xb4: 'link', 0xee: 'data',
};

/**
 * @typedef {object} TreeNode
 * @property {string} id Node id: the field row as text ("12"), or "<row>.<n>" for the n-th
 *   triplet of a field; used to ask for the children.
 * @property {'field'|'triplet'} type Field or triplet.
 * @property {number} row Field row (for a triplet: the row of its field).
 * @property {string} kind Node kind, e.g. 'page', 'map', 'tle' or 'triplet'.
 * @property {string} code Identifier: 6 hex digits for a field, 2 for a triplet.
 * @property {string|null} shortName Short name of a field (null for unknown fields and triplets).
 * @property {string|null} fullName Full name (null if unknown).
 * @property {string} label Name the field carries (Begin, End and Include fields), else ''.
 * @property {number} offset Byte offset in the file.
 * @property {number} length Length in bytes.
 * @property {boolean} hasChildren Whether getTree(nodeId) returns nodes.
 * @property {number|null} pageNumber Page the node is or is in.
 * @property {number} [tripletIndex] Position of a triplet among its field's triplets.
 */

/**
 * Names the kind of a field.
 * @param {number} id Field identifier.
 * @returns {string} Kind.
 */
export function fieldKind(id) {
  const short = lookupField(id)?.shortName;
  if (id === TLE) return 'tle';
  if (id === NOP) return 'nop';
  if (short && INCLUDE_KINDS[short]) return INCLUDE_KINDS[short];
  if ((id >> 16) !== 0xd3) return 'unknown';
  const type = (id >> 8) & 0xff;
  if (type === 0xa8) return (short && BEGIN_KINDS[short]) ?? 'object';
  if (type === 0xa9) return 'end';
  if ((id & 0xff) === 0x89 || (id & 0xff) === 0x87 || FONT_SHORT_NAMES.has(short)) return 'fontData';
  return TYPE_KINDS[type] ?? (short ? 'other' : 'unknown');
}

/**
 * Lists the rows shown directly below a node: the fields inside a Begin field (a nested Begin
 * stands for its whole object, End included) followed by the Begin field's own End field; or
 * the top-level fields.
 * @param {object} index Field index.
 * @param {number} parent Begin row, or −1 for the top level.
 * @returns {number[]} Rows in file order.
 */
export function childFieldRows(index, parent) {
  const out = [];
  const start = parent < 0 ? 0 : parent + 1;
  const stop = parent < 0 || index.end[parent] < 0 ? index.count : index.end[parent];
  for (let r = start; r < stop; r++) {
    if (index.parent[r] !== parent) continue;
    out.push(r);
    if (index.end[r] > r) r = index.end[r];
  }
  if (parent >= 0 && index.end[parent] >= 0) out.push(index.end[parent]);
  return out;
}

/**
 * Tells whether a row is a Begin field.
 * @param {object} index Field index.
 * @param {number} row Row.
 * @returns {boolean} True for Begin fields.
 */
function isBegin(index, row) {
  return (index.id[row] >> 8) === 0xd3a8;
}

/**
 * Reads the triplets of a field (none if its data cannot be read).
 * @param {object} file File record.
 * @param {number} row Row.
 * @param {(row: number) => Promise<Uint8Array>} [read] Field reader.
 * @returns {Promise<{triplets: object[], data: Uint8Array}>} Triplets and field data.
 */
async function tripletsOf(file, row, read = (r) => fieldData(file, r)) {
  const data = await read(row);
  let triplets = [];
  try {
    triplets = fieldTriplets(file.index.id[row], data);
  } catch {
    triplets = [];
  }
  return { triplets, data };
}

/**
 * The page a row is or lies in.
 * @param {object} file File record.
 * @param {number} row Row.
 * @returns {number|null} Page number.
 */
function pageOf(file, row) {
  const begin = beginOfEnd(file, row);
  if (begin !== null) return pageOf(file, begin);
  return pageNumberOfBegin(file, row) ?? enclosingPage(file, row)?.pageNumber ?? null;
}

/**
 * Builds the node of a field.
 * @param {object} file File record.
 * @param {number} row Row.
 * @param {(row: number) => Promise<Uint8Array>} [read] Field reader (a sequentialReader for long lists).
 * @param {{tle?: string|null, nop?: string|null}} [overrides] Code pages chosen for TLEs and NOPs.
 * @returns {Promise<TreeNode>} Node; a TLE has `tle` (name and value), a NOP `nop` (its text),
 *   both for the row preview.
 */
async function fieldNode(file, row, read, overrides = {}) {
  const { index } = file;
  const id = index.id[row];
  const entry = lookupField(id);
  const kind = fieldKind(id);
  const { triplets, data } = await tripletsOf(file, row, read);
  // Invoke Medium Map carries the name of the medium map like an Include field.
  const named = isBegin(index, row) || kind === 'end' || kind.startsWith('include') || entry?.shortName === 'IMM';
  return {
    id: String(row), type: 'field', row, kind,
    code: id.toString(16).toUpperCase().padStart(6, '0'),
    shortName: entry?.shortName ?? null, fullName: entry?.fullName ?? null,
    label: named ? ebcdicName(data, 0, Math.min(8, data.length)) : '',
    offset: index.offset[row], length: index.length[row],
    // A Begin field shows its End field below it, so it has children when it is closed, or when
    // the field after it lies inside it (not scanning all children: a document has hundreds of
    // thousands in mass output, T230).
    hasChildren: triplets.length > 0 || (isBegin(index, row) && (index.end[row] >= 0 || (row + 1 < index.count && index.parent[row + 1] === row))),
    pageNumber: pageOf(file, row),
    tle: id === TLE ? await tlePreview(file, row, data, overrides.tle ?? null).catch(() => null) : null,
    nop: id === NOP ? await nopPreview(data, overrides.nop ?? null) : null,
  };
}

/** Longest NOP text a tree node carries. */
const NOP_PREVIEW = 200;

/**
 * Decodes the start of a NOP for the row preview, like the NOP browser (detected code page
 * unless one is chosen).
 * @param {Uint8Array} data NOP data.
 * @param {string|null} override Code page chosen for NOPs, or null.
 * @returns {Promise<string>} Text, blanks collapsed, cut to NOP_PREVIEW characters.
 */
async function nopPreview(data, override) {
  const head = data.subarray(0, 2 * NOP_PREVIEW);
  await loadCodePage(DEFAULT_CODE_PAGE);
  await loadCodePage('windows-1252');
  await loadCodePage('utf-8');
  const text = (await decodePrintable(override ?? detectNopCodePage(head), head)).replace(/\s+/g, ' ').trim();
  return text.length > NOP_PREVIEW ? `${text.slice(0, NOP_PREVIEW)}…` : text;
}

/**
 * Builds the nodes of a field's triplets, with their byte offsets in the file.
 * @param {object} file File record.
 * @param {number} row Field row.
 * @param {{tle?: string|null}} [overrides] Code page chosen for TLEs (texts in a TLE's triplets).
 * @returns {Promise<TreeNode[]>} Triplet nodes, each with its `preview` (or null).
 */
async function tripletNodes(file, row, overrides = {}) {
  const { triplets, data } = await tripletsOf(file, row);
  const base = file.index.offset[row] + file.index.header[row];
  const page = pageOf(file, row);
  const override = file.index.id[row] === TLE ? overrides.tle ?? null : null;
  const previews = await tripletPreviews(triplets, await inheritedCodePage(file, row), override).catch(() => []);
  return triplets.map((t, i) => ({
    preview: previews[i] ?? null,
    id: `${row}.${i}`, type: 'triplet', row, kind: 'triplet', tripletIndex: i,
    code: t.id.toString(16).toUpperCase().padStart(2, '0'), shortName: null, fullName: t.name ?? null, label: '',
    offset: base + (t.raw.byteOffset - data.byteOffset), length: t.raw.length, hasChildren: false, pageNumber: page,
  }));
}

/**
 * Returns the children of a tree node, or the top-level nodes.
 * @param {object} file File record.
 * @param {string} [parentNodeId] Node id from an earlier call; omitted for the top level.
 * @param {{tle?: string|null, nop?: string|null}} [overrides] Code pages chosen for TLEs and NOPs
 *   (row previews).
 * @returns {Promise<TreeNode[]>} Child nodes in file order.
 */
export async function getTree(file, parentNodeId, overrides = {}) {
  const { index } = file;
  // Child lists can be long (a document's page groups): read them in file order through one
  // sequential reader, one after the other, instead of one read per node.
  const nodes = async (rows) => {
    const read = sequentialReader(file);
    const out = [];
    for (const r of rows) out.push(await fieldNode(file, r, read, overrides));
    return out;
  };
  if (parentNodeId === undefined || parentNodeId === null) return nodes(childFieldRows(index, -1));
  const row = Number(parentNodeId);
  if (!Number.isInteger(row) || row < 0 || row >= index.count) throw new RangeError(`unknown tree node: ${parentNodeId}`);
  const triplets = await tripletNodes(file, row, overrides);
  const inner = isBegin(index, row) ? await nodes(childFieldRows(index, row)) : [];
  return [...triplets, ...inner];
}

/**
 * Finds the Begin field whose End field a row is.
 * @param {object} file File record.
 * @param {number} row Row.
 * @returns {number|null} Begin row, or null if the row ends nothing.
 */
function beginOfEnd(file, row) {
  // An End field has its Begin field's parent; the Begin field is the ancestor of the row before
  // the End field (or that row itself) at the same level. No table over all fields is kept.
  const { index } = file;
  if (row <= 0 || (index.id[row] >> 8) !== 0xd3a9) return null;
  const level = index.parent[row];
  let r = row - 1;
  while (r >= 0 && index.parent[r] !== level) r = index.parent[r];
  return r >= 0 && index.end[r] === row ? r : null;
}

/**
 * Lists the node ids from the top level down to a field (for revealing a field or page in the
 * tree, FR-034). An End field lies below its Begin field.
 * @param {object} file File record.
 * @param {number} row Field row.
 * @returns {string[]} Node ids, top level first, ending with the field itself.
 */
export function treePath(file, row) {
  const { index } = file;
  if (!Number.isInteger(row) || row < 0 || row >= index.count) throw new RangeError(`no field ${row}`);
  const ids = [String(row)];
  let r = beginOfEnd(file, row) ?? index.parent[row];
  while (r >= 0) {
    ids.unshift(String(r));
    r = index.parent[r];
  }
  return ids;
}
