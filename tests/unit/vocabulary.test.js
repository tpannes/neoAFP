/**
 * Word matching (FR-061): a query word matches the words that contain it exactly (after
 * normalization), the word itself first; no typo tolerance. The table filter of the TLE and NOP
 * browsers uses the same rule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vocabulary } from '../../src/lib/search/vocabulary.js';
import { wordFilter } from '../../src/lib/search/text-filter.js';

test('vocabulary lookup: the word itself, then words containing it; shorter words are skipped', () => {
  const v = new Vocabulary();
  for (const w of ['kunstlersozialkasse', 'kunstler', 'kunstlerin', 'kunstler', 'kunst', 'kunstlr']) v.add(w);
  const { matches, compared } = v.lookup('kunstler');
  assert.deepEqual(matches, [
    { word: 'kunstler', distance: 0 }, { word: 'kunstlersozialkasse', distance: 1 }, { word: 'kunstlerin', distance: 1 },
  ]);
  assert.equal(compared, 3, 'words shorter than the query are not compared');
  assert.deepEqual(v.lookup('kunstlersozial').matches.map((m) => m.word), ['kunstlersozialkasse']);
});

test('no typo tolerance', () => {
  const v = new Vocabulary();
  for (const w of ['rechnung', 'bsu00303', 'bsu00367']) v.add(w);
  assert.deepEqual(v.lookup('rechnug').matches, []);
  assert.deepEqual(v.lookup('rehcnung').matches, []);
  assert.deepEqual(v.lookup('bsu00303').matches.map((m) => m.word), ['bsu00303']);
});

test('table filter: every query word must be contained in a row word', () => {
  const filter = wordFilter('BSU00303');
  assert.equal(filter(['bsu00303']), true);
  assert.equal(filter(['bsu00367']), false);
  assert.equal(wordFilter('4711')(['k4711']), true);
  assert.equal(wordFilter('Rechnug')(['rechnung']), false);
  assert.equal(wordFilter('nord sud')(['nord']), false);
  assert.equal(wordFilter(' '), null);
});
