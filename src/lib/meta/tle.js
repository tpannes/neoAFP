/**
 * Tag Logical Elements (FR-035, MO:DCA Reference AFPC-0004-11, "Tag Logical Element (TLE)"):
 * attribute name (FQN type X'0B'), attribute value (X'36'), optional attribute qualifier
 * (X'80': sequence and level number) and the code page of these strings (X'01' triplets in the
 * TLE, which apply to the strings after them, else the code page of the including object).
 *
 * Owner: a TLE embedded in a page belongs to the page, one embedded in a page group (after Begin
 * Named Page Group) to the page group. A TLE in a document index names its page (FQN X'87') or
 * page group (FQN X'0D'), or inherits that reference from the last preceding Index Element.
 * TLEs elsewhere (directly in a document, outside any page group) are listed as document TLEs.
 */

import { sequentialReader, fieldData } from '../modca/access.js';
import { ebcdicName } from '../modca/bytes.js';
import { parseTriplets } from '../modca/registry/triplets.js';
import { tripletRegistry } from '../modca/registry/index.js';
import { loadCodePage, decode } from '../codepages/index.js';
import { ownerOf, inheritedCodePage, codePageOf, pageNumberOfBegin, BPG, BNG, BDI } from './owner.js';
import { printable, DEFAULT_CODE_PAGE } from './hex.js';

const TLE = 0xd3a090;
const IEL = 0xd3b2a7;

/** Owner types of TLEs, by their code in a TleStore. */
export const TLE_OWNER_TYPES = Object.freeze(['page', 'pageGroup', 'document']);

/**
 * The TLEs of one file, undecoded, kept in columns (typed arrays and one byte pool) rather than
 * one object per TLE: mass output carries millions of TLEs (2 GB with 1.3 million in the T230
 * measurement), and an object with two byte arrays per TLE costs several hundred bytes each.
 * TLE `i` has: field row `row[i]`; owner type code `ownerType[i]` (TLE_OWNER_TYPES); owner Begin
 * row `ownerRef[i]` (−1 = none); page number `pageNumber[i]` (0 = none); attribute qualifier
 * `sequence[i]`/`level[i]` (NaN = none); code pages `nameCp[i]`/`valueCp[i]` as indexes into
 * `codePages` (0 = none given); name and value bytes at `nameAt`/`nameLen` and
 * `valueAt`/`valueLen` in `pool`. Owner names are kept once per owner row (`ownerNames`), or per
 * TLE for document-index references without a row (`refNames`).
 */
export class TleStore {
  /** Creates an empty store. */
  constructor() {
    this.count = 0;
    this.capacity = 0;
    this.poolUsed = 0;
    this.pool = new Uint8Array(1024);
    /** @type {{id: string|null, number: number|null}[]} index 0: none */
    this.codePages = [null];
    this.codePageIndex = new Map();
    /** @type {Map<number, string>} owner row → name */
    this.ownerNames = new Map();
    /** @type {Map<number, string>} TLE number → owner name (no owner row) */
    this.refNames = new Map();
    this.#grow(256);
  }

  /**
   * Makes room for more TLEs.
   * @param {number} capacity New capacity.
   * @returns {void}
   */
  #grow(capacity) {
    const columns = { row: Int32Array, ownerType: Uint8Array, ownerRef: Int32Array, pageNumber: Int32Array, sequence: Float64Array,
      level: Float64Array, nameCp: Uint16Array, valueCp: Uint16Array, nameAt: Float64Array, nameLen: Uint16Array, valueAt: Float64Array, valueLen: Uint16Array };
    for (const [key, Type] of Object.entries(columns)) {
      const next = new Type(capacity);
      if (this[key]) next.set(this[key].subarray(0, this.count));
      this[key] = next;
    }
    this.capacity = capacity;
  }

  /**
   * Copies bytes into the pool.
   * @param {Uint8Array} bytes Bytes.
   * @returns {number} Their position.
   */
  #keep(bytes) {
    if (this.poolUsed + bytes.length > this.pool.length) {
      const next = new Uint8Array(Math.max(this.pool.length * 2, this.poolUsed + bytes.length));
      next.set(this.pool.subarray(0, this.poolUsed));
      this.pool = next;
    }
    const at = this.poolUsed;
    this.pool.set(bytes, at);
    this.poolUsed += bytes.length;
    return at;
  }

  /**
   * Numbers a code page.
   * @param {{id: string|null, number: number|null}|null} cp Code page.
   * @returns {number} Its index in `codePages` (0 for none).
   */
  #codePage(cp) {
    if (!cp) return 0;
    const key = `${cp.id}:${cp.number}`;
    if (!this.codePageIndex.has(key)) {
      this.codePageIndex.set(key, this.codePages.length);
      this.codePages.push(cp);
    }
    return this.codePageIndex.get(key);
  }

  /**
   * Adds a TLE.
   * @param {object} t TLE: row, ownerType, ownerRef, ownerName, pageNumber, sequence, level,
   *   nameCp, valueCp, nameBytes, valueBytes.
   * @returns {void}
   */
  add(t) {
    if (this.count === this.capacity) this.#grow(this.capacity * 2);
    const i = this.count++;
    this.row[i] = t.row;
    this.ownerType[i] = Math.max(0, TLE_OWNER_TYPES.indexOf(t.ownerType));
    this.ownerRef[i] = t.ownerRef ?? -1;
    this.pageNumber[i] = t.pageNumber ?? 0;
    this.sequence[i] = t.sequence ?? NaN;
    this.level[i] = t.level ?? NaN;
    this.nameCp[i] = this.#codePage(t.nameCp);
    this.valueCp[i] = this.#codePage(t.valueCp ?? t.nameCp);
    this.nameAt[i] = this.#keep(t.nameBytes);
    this.nameLen[i] = t.nameBytes.length;
    this.valueAt[i] = this.#keep(t.valueBytes);
    this.valueLen[i] = t.valueBytes.length;
    if (t.ownerRef !== null && t.ownerRef !== undefined) {
      if (!this.ownerNames.has(t.ownerRef)) this.ownerNames.set(t.ownerRef, t.ownerName ?? null);
    } else if (t.ownerName) {
      this.refNames.set(i, t.ownerName);
    }
  }

  /**
   * Name bytes of a TLE.
   * @param {number} i TLE number.
   * @returns {Uint8Array} Bytes (a view on the pool).
   */
  nameBytes(i) {
    return this.pool.subarray(this.nameAt[i], this.nameAt[i] + this.nameLen[i]);
  }

  /**
   * Value bytes of a TLE.
   * @param {number} i TLE number.
   * @returns {Uint8Array} Bytes (a view on the pool).
   */
  valueBytes(i) {
    return this.pool.subarray(this.valueAt[i], this.valueAt[i] + this.valueLen[i]);
  }

  /**
   * Owner name of a TLE.
   * @param {number} i TLE number.
   * @returns {string|null} Name.
   */
  ownerName(i) {
    return this.ownerRef[i] >= 0 ? this.ownerNames.get(this.ownerRef[i]) ?? null : this.refNames.get(i) ?? null;
  }

  /**
   * The code page to decode a TLE's name and value with.
   * @param {number} i TLE number.
   * @param {string|null} override Code page chosen by the user, or null.
   * @returns {{name: string, value: string}} Code page ids.
   */
  codePagesOf(i, override) {
    const value = override ?? this.codePages[this.valueCp[i]]?.id ?? DEFAULT_CODE_PAGE;
    const name = override ?? this.codePages[this.nameCp[i]]?.id ?? this.codePages[this.valueCp[i]]?.id ?? DEFAULT_CODE_PAGE;
    return { name, value };
  }

  /** Releases unused capacity once collecting is done. */
  trim() {
    this.pool = this.pool.slice(0, this.poolUsed);
  }
}

/**
 * Collects the TLEs of a file (without decoding the text), reading it in order through a
 * sequentialReader.
 * @param {object} file File record.
 * @param {(d: object) => void} report Records a diagnostic (unknown triplets).
 * @returns {Promise<TleStore>} TLEs in file order.
 */
export async function collectTles(file, report) {
  const { index } = file;
  const store = new TleStore();
  const read = sequentialReader(file);
  let indexRef = null; // page or page group named by the last Index Element in a document index
  let namedRows = null; // Begin Page / Begin Named Page Group rows by name, built when needed
  const rowNamed = async (id, name) => {
    if (!namedRows) {
      namedRows = new Map();
      const names = sequentialReader(file);
      for (let r = 0; r < index.count; r++) {
        if (index.id[r] === BPG || index.id[r] === BNG) namedRows.set(`${index.id[r]}:${ebcdicName(await names(r), 0, 8)}`, r);
      }
    }
    return namedRows.get(`${id}:${name}`) ?? null;
  };
  for (let row = 0; row < index.count; row++) {
    const id = index.id[row];
    if (id === IEL) indexRef = referenceOf(parseTriplets(await read(row)));
    if (id !== TLE) continue;
    const { triplets, ...t } = await readTle(file, row, read, report);
    let owner = await ownerOf(file, row, read);
    if (owner.ownerType !== 'page' && owner.ownerType !== 'pageGroup') {
      const ref = index.parent[row] >= 0 && index.id[index.parent[row]] === BDI ? (referenceOf(triplets) ?? indexRef) : null;
      if (ref) {
        const target = await rowNamed(ref.type === 'page' ? BPG : BNG, ref.name);
        owner = { ownerType: ref.type, ownerRef: target, ownerName: ref.name, pageNumber: ref.type === 'page' && target !== null ? pageNumberOfBegin(file, target) : null };
      } else {
        owner = { ...owner, ownerType: 'document' };
      }
    }
    store.add({ row, ...owner, sequence: t.sequence, level: t.level, nameCp: t.nameCp, valueCp: t.valueCp ?? t.nameCp, nameBytes: t.nameBytes, valueBytes: t.valueBytes });
  }
  store.trim();
  return store;
}

/**
 * Reads one TLE: name and value bytes with their code pages (X'01' triplets before them, else the
 * code page inherited from enclosing Begin fields) and the attribute qualifier.
 * @param {object} file File record.
 * @param {number} row TLE row.
 * @param {(row: number) => Promise<Uint8Array>} read Field reader.
 * @param {(d: object) => void} report Records a diagnostic (unknown triplets).
 * @returns {Promise<{triplets: object[], nameBytes: Uint8Array, valueBytes: Uint8Array, nameCp: object|null,
 *   valueCp: object|null, sequence: number|null, level: number|null}>} TLE (bytes are views on the read data).
 */
async function readTle(file, row, read, report) {
  const triplets = parseTriplets(await read(row));
  const inherited = await inheritedCodePage(file, row, read);
  let current = inherited;
  const t = { triplets, nameBytes: new Uint8Array(0), valueBytes: new Uint8Array(0), nameCp: inherited, valueCp: inherited, sequence: null, level: null };
  for (const tr of triplets) {
    const body = tr.raw.subarray(2);
    if (tr.id === 0x01 && tr.decoded) current = codePageOf(tr.decoded);
    else if (tr.id === 0x02 && body[0] === 0x0b) Object.assign(t, { nameBytes: body.subarray(2), nameCp: current });
    else if (tr.id === 0x36) Object.assign(t, { valueBytes: body.subarray(2), valueCp: current });
    else if (tr.id === 0x80 && body.length >= 8) Object.assign(t, { sequence: u32(body, 0), level: u32(body, 4) });
    else if (!tripletRegistry.lookup(tr.id)) {
      report({
        severity: 'warning', code: 'unknownTriplet', fileId: file.id, offset: file.index.offset[row],
        params: { file: file.path, tripletId: hex2(tr.id), fieldId: 'D3A090' },
      });
    }
  }
  return t;
}

/**
 * Lists the TLEs that apply to a page (Details panel, FR-097): those directly in the page and
 * in every page group around it, outermost group first. Found by walking the field index from
 * the page up (a page group's own fields, skipping nested objects), so it costs a few reads
 * even when the file has millions of TLEs. TLEs in a document index that name the page group
 * from outside are not included.
 * @param {object} file File record.
 * @param {number} pageRow Begin Page row.
 * @param {string|null} override Code page chosen for TLEs, or null.
 * @returns {Promise<string[]>} "name = value" texts.
 */
export async function tlesOfPage(file, pageRow, override) {
  const { index } = file;
  const owners = [];
  for (let r = pageRow; r >= 0; r = index.parent[r]) if (r === pageRow || index.id[r] === BNG) owners.unshift(r);
  const read = (r) => fieldData(file, r);
  const out = [];
  for (const owner of owners) {
    const end = index.end[owner] >= 0 ? index.end[owner] : index.count;
    for (let r = owner + 1; r < end;) {
      if (index.id[r] === TLE && index.parent[r] === owner) {
        const t = await readTle(file, r, read, () => {});
        const name = override ?? t.nameCp?.id ?? t.valueCp?.id ?? DEFAULT_CODE_PAGE;
        const value = override ?? (t.valueCp ?? t.nameCp)?.id ?? DEFAULT_CODE_PAGE;
        await loadCodePage(name);
        await loadCodePage(value);
        out.push(`${printable(decode(name, t.nameBytes))} = ${printable(decode(value, t.valueBytes))}`);
      }
      // Skip whole nested objects (pages, other groups): only the owner's own fields count.
      r = index.end[r] > r ? index.end[r] + 1 : r + 1;
    }
  }
  return out;
}

/**
 * Decodes collected TLEs into data-model Tle objects (one object each: use for the public
 * `getTles`, not inside the library's own tables).
 * @param {TleStore} store TLEs.
 * @param {object} index Field index of the file (for offsets).
 * @param {string|null} override Code page chosen by the user for TLEs, or null.
 * @returns {Promise<object[]>} Data-model Tle objects with `codePage` (the code page used).
 */
export async function decodeTles(store, index, override) {
  await loadTleCodePages(store, override);
  const out = [];
  for (let i = 0; i < store.count; i++) {
    const cp = store.codePagesOf(i, override);
    const fileCp = store.codePages[store.valueCp[i]];
    out.push({
      index: store.row[i], offset: index.offset[store.row[i]], fileCodePage: fileCp?.id ?? null, fileCodePageNumber: fileCp?.number ?? null,
      ownerType: TLE_OWNER_TYPES[store.ownerType[i]], ownerRef: store.ownerRef[i] >= 0 ? store.ownerRef[i] : null, ownerName: store.ownerName(i),
      pageNumber: store.pageNumber[i] || null, sequence: Number.isNaN(store.sequence[i]) ? null : store.sequence[i],
      level: Number.isNaN(store.level[i]) ? null : store.level[i],
      name: printable(decode(cp.name, store.nameBytes(i))), value: printable(decode(cp.value, store.valueBytes(i))), codePage: cp.value,
    });
  }
  return out;
}

/**
 * Loads every code page the TLEs of a store are decoded with.
 * @param {TleStore} store TLEs.
 * @param {string|null} override Code page chosen by the user, or null.
 * @returns {Promise<void>} Resolves when loaded.
 */
export async function loadTleCodePages(store, override) {
  const ids = new Set([override ?? DEFAULT_CODE_PAGE]);
  if (!override) for (const cp of store.codePages) if (cp?.id) ids.add(cp.id);
  for (const id of ids) await loadCodePage(id);
}

/**
 * Reads the page or page group reference of a TLE or Index Element in a document index
 * (FQN type X'87' Begin Page Name, X'0D' Begin Page Group Name; names in EBCDIC like Begin names).
 * @param {object[]} triplets Parsed triplets.
 * @returns {{type: 'page'|'pageGroup', name: string}|null} Reference.
 */
function referenceOf(triplets) {
  for (const t of triplets) {
    const body = t.raw.subarray(2);
    if (t.id !== 0x02 || (body[0] !== 0x87 && body[0] !== 0x0d)) continue;
    return { type: body[0] === 0x87 ? 'page' : 'pageGroup', name: ebcdicName(body, 2, body.length - 2) };
  }
  return null;
}

/**
 * Reads a big-endian 32-bit unsigned number.
 * @param {Uint8Array} d Bytes.
 * @param {number} at Position.
 * @returns {number} Value.
 */
const u32 = (d, at) => ((d[at] << 24) >>> 0) + (d[at + 1] << 16) + (d[at + 2] << 8) + d[at + 3];
/**
 * Writes a byte as two hex digits.
 * @param {number} n Byte.
 * @returns {string} E.g. "FE".
 */
const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, '0');
