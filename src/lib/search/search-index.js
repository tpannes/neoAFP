/**
 * Page text search index (FR-060–FR-063, research R10, data-model "SearchIndex"): the text of
 * each page split into normalized words; a vocabulary of all words with the pages containing them.
 *
 * Built for mass output (T230: 880,000 pages, 2 GB): a page is a number (its unit id) with its
 * file and page number in typed arrays, and each word keeps a plain list of unit ids. Neither the
 * page text nor its words are kept: a result's excerpt and the position of the matched word are
 * found by reading the page again (`describeHit`), only for the results shown. The index counts
 * its word entries (`entries`) so the workspace can stop indexing before memory runs out.
 *
 * A query matches a page when every query word is contained in one of its words (see
 * vocabulary.js); the page's distance is that of its worst-matching query word (0: the word
 * itself, 1: a longer word containing it). Results are ordered by distance, then file order and page.
 */

import { tokenize, locatePart, locateParts } from './normalize.js';
import { Vocabulary } from './vocabulary.js';

const EXCERPT = 40;

export class SearchIndex {
  /** Creates an empty index. */
  constructor() {
    this.clear();
  }

  /** Removes everything. */
  clear() {
    /** @type {Map<string, number[]>} word → unit ids (ascending) */
    this.postings = new Map();
    this.vocabulary = new Vocabulary();
    this.count = 0;
    this.unitFile = new Int32Array(1024);
    this.unitPage = new Int32Array(1024);
    /** @type {string[]} file order number → file id */
    this.fileIds = [];
    this.fileOrder = new Map();
    /** Number of (word, page) entries in all postings. */
    this.entries = 0;
  }

  /**
   * Adds the text of a page (each page once; clear() before indexing again).
   * @param {string} fileId Document file id.
   * @param {number} pageNumber Page number.
   * @param {string} text Page text.
   * @returns {void}
   */
  putPage(fileId, pageNumber, text) {
    const words = new Set(tokenize(text).map((t) => t.word));
    if (!words.size) return;
    if (!this.fileOrder.has(fileId)) {
      this.fileOrder.set(fileId, this.fileIds.length);
      this.fileIds.push(fileId);
    }
    if (this.count === this.unitFile.length) {
      const grow = (a) => { const n = new Int32Array(a.length * 2); n.set(a); return n; };
      this.unitFile = grow(this.unitFile);
      this.unitPage = grow(this.unitPage);
    }
    const id = this.count++;
    this.unitFile[id] = this.fileOrder.get(fileId);
    this.unitPage[id] = pageNumber;
    for (const word of words) {
      let list = this.postings.get(word);
      if (!list) {
        list = [];
        this.postings.set(word, list);
        this.vocabulary.add(word);
      }
      list.push(id);
    }
    this.entries += words.size;
  }

  /**
   * Searches.
   * @param {{text: string, fileId?: string}} query Query; `fileId` keeps one document's pages and
   *   orders them by page.
   * @returns {{fileId: string, pageNumber: number, distance: number, word: string, term: string}[]}
   *   Matching pages, best first (by page with fileId), with the page word the first query word
   *   matched, that query word and all query words (normalized).
   */
  search(query) {
    const words = [...new Set(tokenize(query.text ?? '').map((t) => t.word))];
    if (!words.length || !this.count) return [];
    const onlyFile = query.fileId === undefined ? -1 : this.fileOrder.get(query.fileId) ?? -2;
    if (onlyFile === -2) return [];
    // Per unit: worst distance so far (255 = not matched) and the first word's match.
    let distance = null;
    let firstHit = null;
    for (const [i, word] of words.entries()) {
      const best = new Uint8Array(this.count).fill(255);
      const hit = i === 0 ? new Int32Array(this.count) : null;
      const { matches } = this.vocabulary.lookup(word);
      matches.forEach(({ word: match, distance: d }, m) => {
        for (const id of this.postings.get(match) ?? []) {
          if (distance && distance[id] === 255) continue;
          if (d < best[id]) {
            best[id] = d;
            if (hit) hit[id] = m;
          }
        }
      });
      if (distance) for (let id = 0; id < this.count; id++) best[id] = best[id] === 255 ? 255 : Math.max(best[id], distance[id]);
      distance = best;
      if (hit) firstHit = { hit, words: matches.map((x) => x.word) };
    }
    const out = [];
    for (let id = 0; id < this.count; id++) {
      if (distance[id] === 255 || (onlyFile >= 0 && this.unitFile[id] !== onlyFile)) continue;
      out.push(id);
    }
    if (onlyFile >= 0) out.sort((a, b) => this.unitPage[a] - this.unitPage[b]);
    else out.sort((a, b) => distance[a] - distance[b] || this.unitFile[a] - this.unitFile[b] || this.unitPage[a] - this.unitPage[b]);
    return out.map((id) => ({
      fileId: this.fileIds[this.unitFile[id]], pageNumber: this.unitPage[id], distance: distance[id], word: firstHit.words[firstHit.hit[id]], term: words[0], terms: words,
    }));
  }
}

/**
 * Describes a hit on a page: the excerpt around the matched word and where it lies.
 * @param {string} text Page text (glyph run texts joined with blanks).
 * @param {{start: number, end: number, itemIndex: number, sourceField: number}[]} runs Where each
 *   glyph run's text lies in `text`.
 * @param {string} word Normalized page word that matched.
 * @param {string} [term] Normalized query word: only the part of the page word that it matches is
 *   marked (the whole word without it).
 * @param {string[]} [terms] Normalized query words whose every occurrence on the page is listed in
 *   `marks` (default: `term`).
 * @returns {{excerpt: string, highlight: {start: number, end: number}, match: string,
 *   run: {itemIndex: number, sourceField: number, charStart: number, charEnd: number}|null,
 *   marks: {itemIndex: number, charStart: number, charEnd: number}[]}|null}
 *   Hit details, or null when the word is not (any longer) on the page.
 */
export function describeHit(text, runs, word, term, terms = term ? [term] : []) {
  const tokens = tokenize(text);
  const found = tokens.find((t) => t.word === word) ?? tokens[0];
  if (!found) return null;
  const part = term && locatePart(text.slice(found.start, found.end), term);
  const token = part ? { start: found.start + part.start, end: found.start + part.end } : found;
  const from = Math.max(0, token.start - EXCERPT);
  const to = Math.min(text.length, token.end + EXCERPT);
  const excerpt = `${from > 0 ? '…' : ''}${text.slice(from, to)}${to < text.length ? '…' : ''}`;
  const shift = from > 0 ? 1 : 0;
  const run = runs.find((r) => token.start >= r.start && token.start < r.end) ?? runs[0] ?? null;
  return {
    excerpt,
    highlight: { start: token.start - from + shift, end: token.end - from + shift },
    match: text.slice(token.start, token.end),
    run: run && { itemIndex: run.itemIndex, sourceField: run.sourceField, charStart: token.start - run.start, charEnd: Math.min(token.end, run.end) - run.start },
    marks: pageMarks(text, runs, tokens, terms),
  };
}

/**
 * Every occurrence of the query words on a page, as character ranges of its glyph runs.
 * @param {string} text Page text.
 * @param {{start: number, end: number, itemIndex: number}[]} runs Glyph runs in `text`.
 * @param {{word: string, start: number, end: number}[]} tokens Words of `text`.
 * @param {string[]} terms Normalized query words.
 * @returns {{itemIndex: number, charStart: number, charEnd: number}[]} Ranges in text order.
 */
function pageMarks(text, runs, tokens, terms) {
  const marks = [];
  for (const t of tokens) {
    for (const term of terms) {
      if (!t.word.includes(term)) continue;
      for (const p of locateParts(text.slice(t.start, t.end), term)) {
        const start = t.start + p.start, end = t.start + p.end;
        const run = runs.find((r) => start >= r.start && start < r.end);
        if (run) marks.push({ itemIndex: run.itemIndex, charStart: start - run.start, charEnd: Math.min(end, run.end) - run.start });
      }
    }
  }
  return marks;
}
