/**
 * Fuzzy matching (T144, FR-061, research R10): Damerau–Levenshtein distance (optimal string
 * alignment) with substitution, insertion, deletion and transposition of neighbors, stopping
 * early above 2; vocabulary lookup with a length pre-filter (words differing in length by more
 * than 2 are never compared); matches ordered exact first, then by distance, then in vocabulary
 * order.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, Vocabulary } from '../../src/lib/search/fuzzy.js';

test('distance: each edit counts one; more than 2 gives 3', () => {
  assert.equal(distance('rechnung', 'rechnung'), 0);
  assert.equal(distance('rechnung', 'rechnunk'), 1); // substitution
  assert.equal(distance('rechnung', 'rechnug'), 1); // deletion
  assert.equal(distance('rechnung', 'rechnungx'), 1); // insertion
  assert.equal(distance('rechnung', 'rehcnung'), 1); // transposition
  assert.equal(distance('rechnung', 'rehcnug'), 2);
  assert.equal(distance('kitten', 'sitting'), 3);
  assert.equal(distance('abc', 'xyzabc'), 3);
  assert.equal(distance('', 'ab'), 2);
});

test('vocabulary lookup: length pre-filter and ordering', () => {
  const v = new Vocabulary();
  for (const w of ['mueller', 'muller', 'miller', 'muller', 'mullerstrasse', 'mull', 'm']) v.add(w);
  const { matches, compared } = v.lookup('muller');
  assert.deepEqual(matches, [
    { word: 'muller', distance: 0 }, { word: 'mueller', distance: 1 }, { word: 'miller', distance: 1 }, { word: 'mull', distance: 2 },
  ]);
  assert.equal(compared, 4, 'only words of length 4–8 are compared');
  assert.deepEqual(v.lookup('xyz').matches, []);
});
