/**
 * Fuzzy filtering of table rows (TLE and NOP browsers, FR-035, FR-036), with the same rules as
 * the page text search (FR-061): case- and accent-insensitive words (see normalize.js); a row
 * matches when every query word is part of one of its words, or differs from one by at most the
 * allowed number of edits (see fuzzy.js allowedEdits). Being part of a word matters for index
 * values: "4711" finds "K4711".
 */

import { tokenize } from './normalize.js';
import { distance, allowedEdits } from './fuzzy.js';

/**
 * Splits a text into normalized words (computed once per row).
 * @param {string} text Text.
 * @returns {string[]} Words.
 */
export function words(text) {
  return tokenize(text).map((t) => t.word);
}

/**
 * Builds a filter for a query.
 * @param {string} query Query text.
 * @returns {((rowWords: string[]) => boolean)|null} Test for a row's words, or null for an empty
 *   query (everything matches).
 */
export function wordFilter(query) {
  const wanted = [...new Set(words(query))];
  if (!wanted.length) return null;
  return (rowWords) => wanted.every((w) => {
    const max = allowedEdits(w);
    return rowWords.some((r) => r.includes(w) || (max > 0 && distance(w, r, max) <= max));
  });
}
