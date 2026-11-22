/**
 * Fuzzy matching for search (FR-061, research R10): Damerau–Levenshtein distance in the optimal
 * string alignment form (substitution, insertion, deletion, transposition of neighbors each count
 * one), computed only up to a limit, and a vocabulary that compares a query word only with words
 * of similar length.
 */

/**
 * Distance between two words, at most `max + 1`.
 * @param {string} a Word.
 * @param {string} b Word.
 * @param {number} [max] Largest distance of interest (default 2).
 * @returns {number} Distance, or max + 1 if it is larger.
 */
export function distance(a, b, max = 2) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = b.length;
  let prev2 = null;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return Math.min(prev[n], max + 1);
}

/**
 * Number of edits allowed for a query word: none for 1–2 characters, one for 3–5, two from 6
 * (short words with two edits would match almost any short word).
 * @param {string} word Normalized query word.
 * @returns {number} 0, 1 or 2.
 */
export function allowedEdits(word) {
  const n = [...word].length;
  return n <= 2 ? 0 : n <= 5 ? 1 : 2;
}

/**
 * Distinct words, grouped by length for fast fuzzy lookup.
 */
export class Vocabulary {
  /** Creates an empty vocabulary. */
  constructor() {
    /** @type {Map<string, number>} word → insertion order */
    this.order = new Map();
    /** @type {Map<number, string[]>} length → words */
    this.byLength = new Map();
  }

  /**
   * Adds a word (once).
   * @param {string} word Normalized word.
   * @returns {void}
   */
  add(word) {
    if (this.order.has(word)) return;
    this.order.set(word, this.order.size);
    if (!this.byLength.has(word.length)) this.byLength.set(word.length, []);
    this.byLength.get(word.length).push(word);
  }

  /** @returns {number} Number of words. */
  get size() {
    return this.order.size;
  }

  /**
   * Finds the words within a distance of a query word.
   * @param {string} query Normalized query word.
   * @param {number} [max] Largest distance (default 2).
   * @returns {{matches: {word: string, distance: number}[], compared: number}} Matches ordered by
   *   distance, then insertion order; how many words were compared.
   */
  lookup(query, max = 2) {
    const matches = [];
    let compared = 0;
    for (let len = Math.max(0, query.length - max); len <= query.length + max; len++) {
      for (const word of this.byLength.get(len) ?? []) {
        compared++;
        const d = distance(query, word, max);
        if (d <= max) matches.push({ word, distance: d });
      }
    }
    matches.sort((x, y) => x.distance - y.distance || this.order.get(x.word) - this.order.get(y.word));
    return { matches, compared };
  }
}
