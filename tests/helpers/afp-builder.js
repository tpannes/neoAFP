/**
 * Writer for small synthetic AFP (MO:DCA) test files.
 *
 * AFP files are a sequence of "structured fields": records that start with the byte X'5A',
 * followed by a 2-byte length, a 3-byte identifier saying what kind of record it is, a flag
 * byte, two sequence bytes and the record's data. This module builds such records byte by byte
 * so tests can create small, fully known AFP files without real customer data.
 *
 * Pure JavaScript without platform APIs: runs in Node.js and browsers.
 * Spec reference: MO:DCA Reference (AFPC-0004), "Structured Field Introducer" and "Triplets".
 */

/** Largest data length one structured field can carry (32767 − 8 header bytes). */
export const MAX_FIELD_DATA = 32759;

/** Flag bits of the structured field introducer. */
export const FLAG_EXTENSION = 0x80;
export const FLAG_SEGMENTED = 0x20;
export const FLAG_PADDING = 0x08;

/** Identifiers (as hex text) of the structured fields the convenience builders use. */
export const ID = {
  BPF: 'D3A8A5', EPF: 'D3A9A5', BRG: 'D3A8C6', ERG: 'D3A9C6', BRS: 'D3A8CE', ERS: 'D3A9CE',
  BDT: 'D3A8A8', EDT: 'D3A9A8', BNG: 'D3A8AD', ENG: 'D3A9AD', BPG: 'D3A8AF', EPG: 'D3A9AF',
  BAG: 'D3A8C9', EAG: 'D3A9C9', PGD: 'D3A6AF', PTD: 'D3B19B', BPT: 'D3A89B', PTX: 'D3EE9B',
  EPT: 'D3A99B', BOC: 'D3A892', OCD: 'D3EE92', EOC: 'D3A992', NOP: 'D3EEEE', TLE: 'D3A090',
  BDI: 'D3A8A7', EDI: 'D3A9A7', BPS: 'D3A85F', EPS: 'D3A95F', BMO: 'D3A8DF', EMO: 'D3A9DF',
  BFN: 'D3A889', EFN: 'D3A989', BCP: 'D3A887', ECP: 'D3A987', BCF: 'D3A88A', ECF: 'D3A98A',
  BFM: 'D3A8CD', EFM: 'D3A9CD', BPM: 'D3A8CB', EPM: 'D3A9CB', BIM: 'D3A8FB', EIM: 'D3A9FB',
};

/**
 * Joins byte arrays, number arrays and single numbers (one byte each) into one byte array.
 * @param {...(Uint8Array|number[]|number)} parts Parts in order.
 * @returns {Uint8Array} All parts concatenated.
 */
export function bytes(...parts) {
  const arrays = parts.map((p) => (typeof p === 'number' ? [p] : p));
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let pos = 0;
  for (const a of arrays) {
    out.set(a, pos);
    pos += a.length;
  }
  return out;
}

/**
 * Writes an unsigned whole number as big-endian bytes (most significant byte first), as AFP does.
 * @param {number} value Non-negative integer.
 * @param {number} size Number of bytes (1–4).
 * @returns {Uint8Array} The encoded number.
 */
export function uint(value, size) {
  if (!Number.isInteger(value) || value < 0 || value >= 2 ** (8 * size)) {
    throw new RangeError(`value ${value} does not fit in ${size} byte(s)`);
  }
  const out = new Uint8Array(size);
  for (let i = size - 1; i >= 0; i--) {
    out[i] = value % 256;
    value = Math.floor(value / 256);
  }
  return out;
}

/**
 * Turns a hexadecimal string such as "D3A8AF" into bytes.
 * @param {string} text Even number of hex digits; spaces are ignored.
 * @returns {Uint8Array} The bytes.
 */
export function hex(text) {
  const clean = text.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) throw new TypeError(`odd hex length: ${text}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(2 * i, 2 * i + 2), 16);
  return out;
}

/** EBCDIC code page 500 values for letters, digits, space and common punctuation. */
const EBCDIC_500 = (() => {
  const map = new Map([[' ', 0x40], ['.', 0x4b], ['(', 0x4d], ['+', 0x4e], ['&', 0x50],
    ['*', 0x5c], [')', 0x5d], [';', 0x5e], ['-', 0x60], ['/', 0x61], [',', 0x6b], ['%', 0x6c],
    ['_', 0x6d], ['>', 0x6e], ['?', 0x6f], [':', 0x7a], ['#', 0x7b], ['@', 0x7c], ["'", 0x7d],
    ['=', 0x7e], ['"', 0x7f]]);
  const ranges = [['a', 0x81, 9], ['j', 0x91, 9], ['s', 0xa2, 8],
    ['A', 0xc1, 9], ['J', 0xd1, 9], ['S', 0xe2, 8], ['0', 0xf0, 10]];
  for (const [first, code, count] of ranges) {
    for (let i = 0; i < count; i++) map.set(String.fromCharCode(first.charCodeAt(0) + i), code + i);
  }
  return map;
})();

/**
 * Encodes text in EBCDIC code page 500 (the usual code page for AFP names and comments).
 * @param {string} text Letters, digits, space and common punctuation only.
 * @param {number} [padTo] If given, pads with EBCDIC spaces (X'40') to this length.
 * @returns {Uint8Array} EBCDIC bytes.
 */
export function ebcdic(text, padTo) {
  if (padTo !== undefined && text.length > padTo) throw new RangeError(`"${text}" longer than ${padTo}`);
  const out = new Uint8Array(padTo ?? text.length).fill(0x40);
  for (let i = 0; i < text.length; i++) {
    const code = EBCDIC_500.get(text[i]);
    if (code === undefined) throw new RangeError(`character "${text[i]}" not in EBCDIC test table`);
    out[i] = code;
  }
  return out;
}

/**
 * Encodes text as UTF-16 big-endian, the Unicode encoding AFP uses for TrueType text and names.
 * @param {string} text Text to encode.
 * @returns {Uint8Array} UTF-16BE bytes.
 */
export function utf16be(text) {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    out[2 * i] = text.charCodeAt(i) >> 8;
    out[2 * i + 1] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

/**
 * Builds a triplet: a small self-describing parameter (length, identifier, data) appended to
 * many structured fields.
 * @param {number} id Triplet identifier, e.g. 0x02 for Fully Qualified Name.
 * @param {...(Uint8Array|number[]|number)} data Triplet data.
 * @returns {Uint8Array} The complete triplet including its length byte.
 */
export function triplet(id, ...data) {
  const body = bytes(...data);
  if (body.length + 2 > 255) throw new RangeError('triplet too long');
  return bytes(body.length + 2, id, body);
}

/**
 * Builds one structured field.
 * @param {string} id Identifier as 6 hex digits, e.g. "D3A8AF" (Begin Page).
 * @param {Uint8Array|number[]} [data] Field data.
 * @param {object} [options] Optional header features.
 * @param {Uint8Array|number[]} [options.extension] Extension data (flag X'80'); the extension
 *   length byte is added automatically.
 * @param {number} [options.padding] Number of padding bytes to append (flag X'08').
 * @param {boolean} [options.segmented] Set the segmentation flag (X'20').
 * @param {number} [options.sequence] Sequence number (default 0).
 * @returns {Uint8Array} The complete structured field.
 */
export function field(id, data = [], options = {}) {
  let flags = 0;
  const parts = [];
  if (options.extension) {
    flags |= FLAG_EXTENSION;
    parts.push(bytes(options.extension.length + 1, options.extension));
  }
  parts.push(bytes(data));
  if (options.padding) {
    flags |= FLAG_PADDING;
    const n = options.padding;
    // 1–255 padding bytes: the last byte holds the count; more: last byte 0, the two bytes
    // before it hold the count.
    if (n <= 255) parts.push(bytes(new Array(n - 1).fill(0), n));
    else parts.push(bytes(new Array(n - 3).fill(0), uint(n, 2), 0));
  }
  if (options.segmented) flags |= FLAG_SEGMENTED;
  const body = bytes(...parts);
  if (body.length > MAX_FIELD_DATA) throw new RangeError(`field ${id} data too long: ${body.length}`);
  return bytes(0x5a, uint(body.length + 8, 2), hex(id), flags, uint(options.sequence ?? 0, 2), body);
}

/**
 * Builds a Begin/End pair around content, e.g. Begin Page … End Page.
 * @param {string} beginId Begin identifier (D3A8xx); the End identifier is derived (D3A9xx).
 * @param {string} name Name (up to 8 characters, EBCDIC, blank-padded).
 * @param {...Uint8Array} content Fields between Begin and End.
 * @returns {Uint8Array} The complete group.
 */
export function group(beginId, name, ...content) {
  const endId = beginId.slice(0, 2) + 'A9' + beginId.slice(4);
  const nameBytes = name === null ? [] : ebcdic(name, 8);
  return bytes(field(beginId, nameBytes), ...content, field(endId, nameBytes));
}

/**
 * Builds a minimal active environment group with page descriptor and text descriptor.
 * @param {number} [width] Page width in 1/1440 inch (default A4: 11906).
 * @param {number} [height] Page height in 1/1440 inch (default A4: 16838).
 * @param {...Uint8Array} extra Additional fields (e.g. Map Coded Font) placed before the descriptors.
 * @returns {Uint8Array} Begin/End Active Environment Group with its content.
 */
export function environmentGroup(width = 11906, height = 16838, ...extra) {
  const units = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2));
  const extent = bytes(uint(width, 3), uint(height, 3));
  return group(ID.BAG, 'AEG1', ...extra,
    field(ID.PGD, bytes(units, extent, uint(0, 3))),
    field(ID.PTD, bytes(units, extent, uint(0, 2))));
}

/**
 * Builds a page with an environment group and optional content.
 * @param {string} name Page name.
 * @param {...Uint8Array} content Fields after the environment group.
 * @returns {Uint8Array} Begin Page … End Page.
 */
export function page(name, ...content) {
  return group(ID.BPG, name, environmentGroup(), ...content);
}

/**
 * Builds a document.
 * @param {string} name Document name.
 * @param {...Uint8Array} content Pages and page groups.
 * @returns {Uint8Array} Begin Document … End Document.
 */
export function documentOf(name, ...content) {
  return group(ID.BDT, name, ...content);
}

/**
 * Builds a page group (named page group) around pages.
 * @param {string} name Group name.
 * @param {...Uint8Array} content Pages or TLEs.
 * @returns {Uint8Array} Begin Named Page Group … End Named Page Group.
 */
export function pageGroup(name, ...content) {
  return group(ID.BNG, name, ...content);
}

/**
 * Builds a resource group containing resources.
 * @param {...Uint8Array} resources Resources, e.g. from resource().
 * @returns {Uint8Array} Begin Resource Group … End Resource Group.
 */
export function resourceGroup(...resources) {
  return group(ID.BRG, 'RESGRP', ...resources);
}

/**
 * Wraps an object in Begin/End Resource.
 * @param {string} name Resource name.
 * @param {number} objectType Resource object type (triplet X'21'), e.g. 0x92 object container.
 * @param {...Uint8Array} content The resource object.
 * @returns {Uint8Array} Begin Resource … End Resource.
 */
export function resource(name, objectType, ...content) {
  const nameBytes = ebcdic(name, 8);
  return bytes(
    field(ID.BRS, bytes(nameBytes, 0, 0, triplet(0x21, objectType, new Uint8Array(7)))),
    ...content,
    field(ID.ERS, nameBytes));
}

/**
 * Builds an object container holding arbitrary data, split over Object Container Data fields.
 * @param {string} name Container name.
 * @param {Uint8Array} data Container content.
 * @param {...Uint8Array} beginTriplets Triplets for Begin Object Container.
 * @returns {Uint8Array} Begin Object Container … End Object Container.
 */
export function objectContainer(name, data, ...beginTriplets) {
  const parts = [];
  for (let pos = 0; pos < data.length; pos += MAX_FIELD_DATA) {
    parts.push(field(ID.OCD, data.subarray(pos, Math.min(pos + MAX_FIELD_DATA, data.length))));
  }
  const nameBytes = ebcdic(name, 8);
  return bytes(field(ID.BOC, bytes(nameBytes, ...beginTriplets)), ...parts, field(ID.EOC, nameBytes));
}

/**
 * Builds a No Operation (comment) field.
 * @param {string|Uint8Array} content Text (encoded in EBCDIC 500) or raw bytes.
 * @returns {Uint8Array} The NOP field.
 */
export function nop(content) {
  return field(ID.NOP, typeof content === 'string' ? ebcdic(content) : content);
}

/**
 * Inserts separator bytes after every structured field, as files transferred from mainframes
 * sometimes have (CR/LF line ends or blank padding).
 * @param {Uint8Array} afp AFP bytes made of complete structured fields.
 * @param {Uint8Array|number[]} separator Bytes to insert after each field, e.g. [0x0D, 0x0A].
 * @returns {Uint8Array} The same fields with separators.
 */
export function withSeparators(afp, separator) {
  const parts = [];
  let pos = 0;
  while (pos < afp.length) {
    const len = ((afp[pos + 1] << 8) | afp[pos + 2]) + 1;
    parts.push(afp.subarray(pos, pos + len), bytes(separator));
    pos += len;
  }
  return bytes(...parts);
}

/**
 * Lists the structured fields of AFP bytes without separators: offset, total length (including
 * X'5A') and identifier. Used to produce `expected.fields`.
 * @param {Uint8Array} data AFP bytes.
 * @returns {{offset: number, length: number, id: string}[]} One entry per field.
 */
export function listFields(data) {
  const out = [];
  let pos = 0;
  while (pos < data.length && data[pos] === 0x5a) {
    const len = ((data[pos + 1] << 8) | data[pos + 2]) + 1;
    const id = Array.from(data.subarray(pos + 3, pos + 6), (b) => b.toString(16).padStart(2, '0'))
      .join('').toUpperCase();
    out.push({ offset: pos, length: len, id });
    pos += len;
  }
  return out;
}
