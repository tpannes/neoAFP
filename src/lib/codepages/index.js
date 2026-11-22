/**
 * Code pages: turning text bytes from AFP files into readable characters.
 *
 * AFP text is usually stored in EBCDIC, the character encodings of IBM mainframes, which
 * browsers do not support. EBCDIC code pages are decoded with generated lookup tables
 * (src/lib/codepages/tables/, research R9); ASCII-based and Unicode encodings use the platform's
 * TextDecoder (available in browsers and Node.js).
 *
 * Japanese and Chinese EBCDIC code pages mix one-byte and two-byte characters: the byte X'0E'
 * (shift-out) switches to two-byte characters and X'0F' (shift-in) switches back.
 *
 * Usage: `await loadCodePage(id)` once, then `decode(id, bytes)` synchronously.
 */

/** EBCDIC code pages with generated tables: CCSID and a short description. */
const EBCDIC = [
  [37, 'USA, Canada'], [273, 'Germany, Austria'], [277, 'Denmark, Norway'],
  [278, 'Finland, Sweden'], [280, 'Italy'], [284, 'Spain, Latin America'], [285, 'United Kingdom'],
  [297, 'France'], [500, 'International'], [871, 'Iceland'], [1047, 'Latin-1 (open systems)'],
  [1140, 'USA, Canada (euro)'], [1141, 'Germany, Austria (euro)'], [1142, 'Denmark, Norway (euro)'],
  [1143, 'Finland, Sweden (euro)'], [1144, 'Italy (euro)'], [1145, 'Spain, Latin America (euro)'],
  [1146, 'United Kingdom (euro)'], [1147, 'France (euro)'], [1148, 'International (euro)'],
  [1149, 'Iceland (euro)'], [300, 'Japanese, double-byte'], [930, 'Japanese Katakana, mixed'],
  [939, 'Japanese Latin, mixed'], [1390, 'Japanese Katakana, mixed (extended)'],
  [1399, 'Japanese Latin, mixed (extended)'], [935, 'Simplified Chinese, mixed'],
  [1388, 'Simplified Chinese (GBK), mixed'],
];

/** ASCII-based and Unicode code pages: id, label, kind and TextDecoder label (null = own decoder). */
const OTHERS = [
  ['iso-8859-1', 'ISO 8859-1 (Latin-1)', 'ascii', null],
  ['iso-8859-15', 'ISO 8859-15 (Latin-9)', 'ascii', 'iso-8859-15'],
  ['windows-1252', 'Windows-1252 (Western)', 'ascii', 'windows-1252'],
  ['shift-jis', 'Shift-JIS (Japanese)', 'ascii', 'shift_jis'],
  ['gbk', 'GBK (Simplified Chinese)', 'ascii', 'gbk'],
  ['gb18030', 'GB 18030 (Simplified Chinese)', 'ascii', 'gb18030'],
  ['utf-8', 'UTF-8', 'unicode', 'utf-8'],
  ['utf-16be', 'UTF-16 big-endian', 'unicode', null],
  ['utf-16le', 'UTF-16 little-endian', 'unicode', null],
];

/**
 * Builds the code page id of an EBCDIC CCSID, e.g. 37 → "ebcdic-037".
 * @param {number} ccsid Code page number.
 * @returns {string} Code page id.
 */
function ebcdicId(ccsid) {
  return `ebcdic-${String(ccsid).padStart(3, '0')}`;
}

/** All code pages: id → { id, label, kind, ccsid?, textDecoderLabel? }. */
const CATALOG = new Map([
  ...EBCDIC.map(([ccsid, label]) => [ebcdicId(ccsid), {
    id: ebcdicId(ccsid), label: `EBCDIC ${ccsid} – ${label}`, kind: 'ebcdic', ccsid,
  }]),
  ...OTHERS.map(([id, label, kind, textDecoderLabel]) => [id, { id, label, kind, textDecoderLabel }]),
]);

/** CCSIDs / code page numbers that name a non-EBCDIC code page. */
const CCSID_ALIASES = new Map([
  [819, 'iso-8859-1'], [923, 'iso-8859-15'], [1252, 'windows-1252'], [5348, 'windows-1252'],
  [932, 'shift-jis'], [942, 'shift-jis'], [943, 'shift-jis'], [1386, 'gbk'], [1392, 'gb18030'],
  [5488, 'gb18030'], [1208, 'utf-8'], [1200, 'utf-16be'], [13488, 'utf-16be'], [17584, 'utf-16be'],
  [1202, 'utf-16le'],
]);

/** Loaded decoders by code page id. */
const loaded = new Map();

/**
 * Lists every code page the user can choose (FR-037).
 * @returns {{id: string, label: string, kind: 'ebcdic'|'ascii'|'unicode'}[]} Code pages.
 */
export function listCodePages() {
  return [...CATALOG.values()].map(({ id, label, kind }) => ({ id, label, kind }));
}

/**
 * Finds the code page for a CCSID or code page number given in an AFP file
 * (e.g. in a Coded Graphic Character Set Global Identifier triplet).
 * @param {number} ccsid CCSID or CPGID.
 * @returns {string|null} Code page id, or null if neoAFP has no decoder for it.
 */
export function codePageIdFromCcsid(ccsid) {
  if (CATALOG.has(ebcdicId(ccsid))) return ebcdicId(ccsid);
  return CCSID_ALIASES.get(ccsid) ?? null;
}

/** EBCDIC code pages with two-byte characters (double-byte or mixed). */
const MULTI_BYTE_EBCDIC = new Set([300, 930, 939, 1390, 1399, 935, 1388]);

/**
 * Tells whether every byte of a code page is one character (needed to align a hex display).
 * @param {string} id Code page id.
 * @returns {boolean} True for single-byte code pages.
 */
export function isSingleByte(id) {
  const info = CATALOG.get(id);
  if (!info) return false;
  if (info.kind === 'ebcdic') return !MULTI_BYTE_EBCDIC.has(info.ccsid);
  return ['iso-8859-1', 'iso-8859-15', 'windows-1252'].includes(id);
}

/**
 * Turns the packed Base64 double-byte table of a generated module into a lookup map.
 * @param {{dbcsPacked: string, dbcsMulti: Object<string,string>}} table Generated table module.
 * @returns {Map<number, string>} Byte pair (16-bit number) → text.
 */
function unpackDouble(table) {
  const bin = atob(table.dbcsPacked);
  const map = new Map();
  for (let i = 0; i + 6 <= bin.length; i += 6) {
    const key = (bin.charCodeAt(i) << 8) | bin.charCodeAt(i + 1);
    const cp = ((bin.charCodeAt(i + 2) << 24) >>> 0) + (bin.charCodeAt(i + 3) << 16)
      + (bin.charCodeAt(i + 4) << 8) + bin.charCodeAt(i + 5);
    map.set(key, String.fromCodePoint(cp));
  }
  for (const [key, text] of Object.entries(table.dbcsMulti ?? {})) map.set(Number(key), text);
  return map;
}

/**
 * Creates the decode function for a generated EBCDIC table.
 * @param {object} table Generated table module (see tables/SOURCE.md).
 * @returns {(bytes: Uint8Array) => string} Decoder.
 */
function ebcdicDecoder(table) {
  const sbcs = table.sbcs;
  const dbcs = table.kind === 'sbcs' ? null : unpackDouble(table);
  const one = (b) => (sbcs && sbcs[b] !== 0xffff ? String.fromCharCode(sbcs[b]) : '�');
  const two = (hi, lo) => dbcs.get((hi << 8) | lo) ?? '�';
  if (table.kind === 'sbcs') {
    return (bytes) => {
      let s = '';
      for (const b of bytes) s += one(b);
      return s;
    };
  }
  if (table.kind === 'dbcs') {
    return (bytes) => {
      let s = '';
      for (let i = 0; i + 1 < bytes.length; i += 2) s += two(bytes[i], bytes[i + 1]);
      if (bytes.length % 2) s += '�';
      return s;
    };
  }
  // Mixed: X'0E' shift-out → two-byte characters, X'0F' shift-in → one-byte characters.
  return (bytes, options = {}) => {
    let s = '';
    let double = options.startInDoubleByte === true;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === 0x0e) { double = true; continue; }
      if (b === 0x0f) { double = false; continue; }
      if (double) {
        if (i + 1 >= bytes.length) { s += '�'; break; }
        s += two(b, bytes[++i]);
      } else {
        s += one(b);
      }
    }
    return s;
  };
}

/**
 * Decodes ISO 8859-1 (every byte is the Unicode code point of the same value). Done by hand
 * because TextDecoder treats the label "iso-8859-1" as Windows-1252.
 * @param {Uint8Array} bytes Text bytes.
 * @returns {string} Text.
 */
function latin1(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/**
 * Decodes UTF-16 in either byte order.
 * @param {boolean} bigEndian True for big-endian.
 * @returns {(bytes: Uint8Array) => string} Decoder.
 */
function utf16(bigEndian) {
  return (bytes) => {
    const units = [];
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      units.push(bigEndian ? (bytes[i] << 8) | bytes[i + 1] : bytes[i] | (bytes[i + 1] << 8));
    }
    let s = '';
    for (let i = 0; i < units.length; i += 4096) s += String.fromCharCode(...units.slice(i, i + 4096));
    return s;
  };
}

/**
 * Loads a code page so that decode() can use it. Tables are loaded only when first needed.
 * @param {string} id Code page id from listCodePages().
 * @returns {Promise<void>} Resolves when the code page is ready.
 */
export async function loadCodePage(id) {
  if (loaded.has(id)) return;
  const info = CATALOG.get(id);
  if (!info) throw new RangeError(`unknown code page: ${id}`);
  let fn;
  if (info.kind === 'ebcdic') {
    fn = ebcdicDecoder(await import(`./tables/${id}.js`));
  } else if (id === 'iso-8859-1') {
    fn = latin1;
  } else if (id === 'utf-16be' || id === 'utf-16le') {
    fn = utf16(id === 'utf-16be');
  } else {
    const decoder = new TextDecoder(info.textDecoderLabel);
    fn = (bytes) => decoder.decode(bytes);
  }
  loaded.set(id, fn);
}

/**
 * Tells whether a code page is loaded and can be used with decode().
 * @param {string} id Code page id.
 * @returns {boolean} True when loaded.
 */
export function isCodePageLoaded(id) {
  return loaded.has(id);
}

/**
 * Decodes text bytes with a loaded code page.
 * @param {string} id Code page id (must be loaded with loadCodePage first).
 * @param {Uint8Array} bytes Text bytes.
 * @param {{startInDoubleByte?: boolean}} [options] For mixed EBCDIC code pages: start in
 *   two-byte mode (used when text continues after a shift-out in an earlier piece).
 * @returns {string} The text; bytes without a mapping become U+FFFD (�).
 */
export function decode(id, bytes, options) {
  const fn = loaded.get(id);
  if (!fn) throw new Error(`code page not loaded: ${id}`);
  return fn(bytes, options);
}

/**
 * Loads a code page if needed and decodes text bytes.
 * @param {string} id Code page id.
 * @param {Uint8Array} bytes Text bytes.
 * @returns {Promise<string>} The text.
 */
export async function decodeText(id, bytes) {
  await loadCodePage(id);
  return decode(id, bytes);
}
