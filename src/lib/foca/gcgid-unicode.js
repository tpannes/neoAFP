/**
 * GCGID → Unicode: turns AFP character names (GCGIDs, e.g. "LA010000" = small a) into Unicode
 * text. Needed when text is shown with a substitute font because its AFP font is missing
 * (FR-021, `fontSubstituted`) and for text search (US4). Rendering with AFP fonts does not need
 * it: AFP fonts look glyphs up by GCGID.
 *
 * Sources: the generated table (src/lib/foca/gcgid-table.js)
 * plus pairs learned at run time from every opened code page that declares a code page number
 * neoAFP can decode (pairsFromCodePage), plus the Unicode-based GCGIDs "UNIC" + 4 hex digits
 * (e.g. UNIC2022 = •, used by newer Unicode-based code pages), which name their code point
 * themselves. Control characters (U+0000–U+001F, U+007F–U+009F) are not text: they give null
 * (unicodeOfGcgid tells them apart from unknown names).
 */

import { GCGID_ENTRIES } from './gcgid-table.js';
import { codePageIdFromCcsid, loadCodePage, decode } from '../codepages/index.js';

/** GCGID → Unicode text. */
const table = new Map(GCGID_ENTRIES.map((e) => [e.slice(0, 8), e.slice(8)]));

/**
 * Derives GCGID → Unicode pairs from a code page resource that declares a decodable code page
 * number (CPGID). For CPGID 1200 (UTF-16) the code point is the Unicode value itself.
 * @param {import('./code-page.js').CodePage} cp Code page resource.
 * @returns {Promise<Map<string, string>>} Pairs (empty if the code page cannot be decoded).
 */
export async function pairsFromCodePage(cp) {
  const pairs = new Map();
  if (!cp.cpgid) return pairs;
  if (cp.cpgid === 1200 || cp.cpgid === 13488) {
    for (const [codePoint, { gcgid }] of cp.map) if (gcgid) pairs.set(gcgid, String.fromCharCode(codePoint));
    return pairs;
  }
  const id = codePageIdFromCcsid(cp.cpgid);
  if (!id) return pairs;
  await loadCodePage(id);
  for (const [codePoint, { gcgid }] of cp.map) {
    if (!gcgid) continue;
    const bytes = cp.doubleByte ? Uint8Array.of(0x0e, codePoint >> 8, codePoint & 0xff, 0x0f) : Uint8Array.of(codePoint);
    const text = decode(id, bytes);
    if (text && text !== '�' && !/[\u0000-\u001f\u007f-\u009f]/.test(text)) pairs.set(gcgid, text);
  }
  return pairs;
}

/**
 * Learns GCGID → Unicode pairs from an opened code page (does not overwrite known pairs).
 * @param {import('./code-page.js').CodePage} cp Code page resource.
 * @returns {Promise<number>} Number of new pairs.
 */
export async function learnFromCodePage(cp) {
  let added = 0;
  for (const [gcgid, text] of await pairsFromCodePage(cp)) {
    if (!table.has(gcgid)) {
      table.set(gcgid, text);
      added++;
    }
  }
  return added;
}

/**
 * Looks up the Unicode text of a GCGID.
 * @param {string} gcgid 8-character GCGID.
 * @returns {string|null} The text, or null if unknown.
 */
export function gcgidToUnicode(gcgid) {
  const known = table.get(gcgid);
  if (known !== undefined) return known;
  const cp = unicodeOfGcgid(gcgid);
  return cp === null || isControl(cp) ? null : String.fromCodePoint(cp);
}

/**
 * Reads the code point of a Unicode-based GCGID ("UNIC" + 4 hex digits).
 * @param {string} gcgid GCGID.
 * @returns {number|null} Code point, or null for other GCGIDs.
 */
export function unicodeOfGcgid(gcgid) {
  const m = /^UNIC([0-9A-F]{4})$/.exec(gcgid ?? '');
  return m ? parseInt(m[1], 16) : null;
}

/**
 * Tells whether a code point is a control character (C0, DEL, C1).
 * @param {number} cp Code point.
 * @returns {boolean} True for control characters.
 */
export function isControl(cp) {
  return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);
}

/**
 * Chooses a substitute system font family for a missing AFP font from its name and typeface.
 * @param {string} name Font or typeface name, e.g. "Times New Roman", "C0H20000".
 * @returns {'serif'|'sans-serif'|'monospace'} Generic CSS font family.
 */
export function substituteFamily(name = '') {
  const n = name.toLowerCase();
  if (/courier|mono|gothic text|letter gothic|prestige|ocr|\bgt\d|typewriter/.test(n)) return 'monospace';
  if (/times|roman|serif(?!.*sans)|garamond|bodoni|century|book|tn\d|\btn/.test(n) && !/sans/.test(n)) return 'serif';
  return 'sans-serif';
}
