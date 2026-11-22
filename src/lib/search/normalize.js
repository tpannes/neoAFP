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
