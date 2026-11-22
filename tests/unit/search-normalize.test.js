/**
 * Search normalization and tokenization (T143, FR-061, research R10): Unicode NFKD, diacritics
 * removed, lowercase (ß as "ss"), words of letters and digits with their position in the original
 * text, CJK text (Han, Hiragana, Katakana, Hangul) split into character bigrams.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWord, tokenize } from '../../src/lib/search/normalize.js';

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
