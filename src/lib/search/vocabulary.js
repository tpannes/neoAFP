/**
 * Word matching for search (FR-061): a query word matches every word that contains it exactly,
 * after normalization (case and accents, see normalize.js). There is no typo tolerance: "Rechnug"
 * does not find "Rechnung", "BSU00303" does not find "BSU00367". A word equal to the query ranks
 * before words that only contain it.
 */

/**
 * Distinct words, grouped by length: words shorter than the query are never compared.
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
   * Finds the words containing a query word.
   * @param {string} query Normalized query word.
   * @returns {{matches: {word: string, distance: number}[], compared: number}} Matches: distance 0
   *   for the word itself, 1 for words containing it; ordered by distance, then insertion order.
   *   `compared`: how many words were looked at.
   */
  lookup(query) {
    const matches = [];
    let compared = 0;
    for (const [len, list] of this.byLength) {
      if (len < query.length) continue;
      for (const word of list) {
        compared++;
        if (word === query) matches.push({ word, distance: 0 });
        else if (word.includes(query)) matches.push({ word, distance: 1 });
      }
    }
    matches.sort((x, y) => x.distance - y.distance || this.order.get(x.word) - this.order.get(y.word));
    return { matches, compared };
  }
}
