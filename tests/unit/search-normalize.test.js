/**
 * Search normalization and tokenization (T143, FR-061, research R10): Unicode NFKD, diacritics
 * removed, lowercase (ß as "ss"), words of letters and digits with their position in the original
 * text, CJK text (Han, Hiragana, Katakana, Hangul) split into character bigrams.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWord, tokenize } from '../../src/lib/search/normalize.js';
import { describeHit } from '../../src/lib/search/search-index.js';

const words = (text) => tokenize(text).map((t) => t.word);

test('NFKD, diacritics, case, ß, compatibility characters', () => {
  assert.equal(normalizeWord('Müller'), 'muller');
  assert.equal(normalizeWord('ÉCOLE'), 'ecole');
  assert.equal(normalizeWord('Straße'), 'strasse');
  assert.equal(normalizeWord('ﬁle'), 'file');
  assert.equal(normalizeWord('ＡＢＣ１２'), 'abc12');
});

test('words with positions in the original text', () => {
  assert.deepEqual(tokenize('Müller-Straße 12, ÉCOLE'), [
    { word: 'muller', start: 0, end: 6 }, { word: 'strasse', start: 7, end: 13 },
    { word: '12', start: 14, end: 16 }, { word: 'ecole', start: 18, end: 23 },
  ]);
  assert.deepEqual(words('  ·· --- '), []);
});

test('CJK text becomes character bigrams; a single character stays a token', () => {
  assert.deepEqual(tokenize('東京都に住む'), [
    { word: '東京', start: 0, end: 2 }, { word: '京都', start: 1, end: 3 }, { word: '都に', start: 2, end: 4 },
    { word: 'に住', start: 3, end: 5 }, { word: '住む', start: 4, end: 6 },
  ]);
  assert.deepEqual(words('Tokyo東京 札'), ['tokyo', '東京', '札']);
  assert.deepEqual(words('カタカナ'), ['カタ', 'タカ', 'カナ']);
});

test('only the matched part of a word is located, also across ß, umlauts and combining marks', async () => {
  const { locatePart } = await import('../../src/lib/search/normalize.js');
  assert.deepEqual(locatePart('Künstlersozialkasse', 'kunstlersozial'), { start: 0, end: 14 });
  assert.deepEqual(locatePart('Straße', 'strasse'), { start: 0, end: 6 });
  assert.deepEqual(locatePart('Straße', 'sse'), { start: 4, end: 6 }, 'part of ß: the whole ß');
  assert.deepEqual(locatePart('Mu\u0308ller', 'ller'), { start: 3, end: 7 });
  assert.equal(locatePart('Rechnung', 'xyz'), null);
});

test('a hit marks only the part of the page word that matches the search term', () => {
  const text = 'Rechnung für Künstlersozialkasse';
  const runs = [{ start: 0, end: text.length, itemIndex: 3, sourceField: 7 }];
  const hit = describeHit(text, runs, 'kunstlersozialkasse', 'sozial');
  assert.equal(hit.match, 'sozial');
  assert.deepEqual(hit.run, { itemIndex: 3, sourceField: 7, charStart: 21, charEnd: 27 });
  assert.equal(hit.excerpt.slice(hit.highlight.start, hit.highlight.end), 'sozial');
  assert.equal(describeHit(text, runs, 'rechnung').match, 'Rechnung', 'without a term: the whole word');
});

test('every occurrence of the query words on the page is listed for marking', async () => {
  const { locateParts } = await import('../../src/lib/search/normalize.js');
  assert.deepEqual(locateParts('Kundekunde', 'kunde'), [{ start: 0, end: 5 }, { start: 5, end: 10 }]);
  const first = 'Kundennummer KD-1';
  const second = 'Rechnungen oder Kundenbriefe für Kunden';
  const text = `${first} ${second}`;
  const runs = [{ start: 0, end: first.length, itemIndex: 2, sourceField: 1 }, { start: first.length + 1, end: text.length, itemIndex: 5, sourceField: 1 }];
  const hit = describeHit(text, runs, 'kundennummer', 'kunde');
  assert.deepEqual(hit.run, { itemIndex: 2, sourceField: 1, charStart: 0, charEnd: 5 });
  assert.deepEqual(hit.marks, [
    { itemIndex: 2, charStart: 0, charEnd: 5 }, { itemIndex: 5, charStart: 16, charEnd: 21 }, { itemIndex: 5, charStart: 33, charEnd: 38 },
  ]);
  // Several query words: each one's occurrences.
  assert.equal(describeHit(text, runs, 'kundennummer', 'kunde', ['kunde', 'rechnung']).marks.length, 4);
});
