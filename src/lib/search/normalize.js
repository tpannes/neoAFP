/**
 * Search normalization and tokenization (FR-061, research R10): text is compared after Unicode
 * NFKD decomposition with diacritics removed, in lower case, with ß as "ss". Words are runs of
 * letters and digits; CJK text (Han, Hiragana, Katakana, Hangul), which has no spaces between
 * words, is split into overlapping character bigrams. Every token keeps its position in the
 * original text for excerpts and highlighting.
 */

const WORD = /[\p{L}\p{N}]+/gu;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Normalizes a word for comparison.
 * @param {string} text Text.
 * @returns {string} Normalized text.
 */
export function normalizeWord(text) {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/ß/g, 'ss');
}

/**
 * Splits text into normalized tokens.
 * @param {string} text Text.
 * @returns {{word: string, start: number, end: number}[]} Tokens with start and end offsets
 *   (UTF-16 code units) in the original text.
 */
export function tokenize(text) {
  const out = [];
  for (const m of text.matchAll(WORD)) {
    const chars = [...m[0]];
    let offset = m.index;
    let i = 0;
    while (i < chars.length) {
      const cjk = CJK.test(chars[i]);
      let j = i;
      let length = 0;
      while (j < chars.length && CJK.test(chars[j]) === cjk) { length += chars[j].length; j++; }
      if (cjk) {
        const positions = [];
        let p = offset;
        for (let k = i; k < j; k++) { positions.push(p); p += chars[k].length; }
        positions.push(p);
        if (j - i === 1) out.push({ word: chars[i], start: positions[0], end: positions[1] });
        for (let k = i; k + 1 < j; k++) out.push({ word: chars[k] + chars[k + 1], start: positions[k - i], end: positions[k - i + 2] });
      } else {
        const word = normalizeWord(chars.slice(i, j).join(''));
        if (word) out.push({ word, start: offset, end: offset + length });
      }
      offset += length;
      i = j;
    }
  }
  return out;
}

/**
 * Finds a normalized part in a piece of original text (a word), for marking only the part of a
 * word that matched: "strasse" in "Straße", "kunstler" in "Künstlerin".
 * @param {string} text Original text.
 * @param {string} part Normalized part.
 * @returns {{start: number, end: number}|null} Offsets (UTF-16 code units) in `text`, or null.
 */
export function locatePart(text, part) {
  return locateParts(text, part)[0] ?? null;
}

/**
 * Finds every occurrence of a normalized part in a piece of original text (see locatePart).
 * @param {string} text Original text.
 * @param {string} part Normalized part.
 * @returns {{start: number, end: number}[]} Offsets (UTF-16 code units) in `text`, in order.
 */
export function locateParts(text, part) {
  if (!part) return [];
  let normalized = '';
  const starts = [];
  const ends = [];
  let offset = 0;
  for (const ch of text) {
    const n = normalizeWord(ch);
    for (let i = 0; i < n.length; i++) { starts.push(offset); ends.push(offset + ch.length); }
    normalized += n;
    offset += ch.length;
  }
  const out = [];
  for (let at = normalized.indexOf(part); at >= 0; at = normalized.indexOf(part, at + part.length)) {
    out.push({ start: starts[at], end: ends[at + part.length - 1] });
  }
  return out;
}
