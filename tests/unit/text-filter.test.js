/**
 * Row filter of the TLE and NOP browsers (T193, FR-035, FR-036): every query word must be part of
 * a row word (no typo tolerance); case and accents do not matter.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { words, wordFilter } from '../../src/lib/search/text-filter.js';

test('parts of words, case and accents; typos do not match', () => {
  const row = words('Kunde K4711 Zürich Rechnung');
  const match = (q) => wordFilter(q)(row);
  assert.equal(wordFilter('  '), null);
  assert.ok(match('4711'));
  assert.ok(match('zurich'));
  assert.ok(match('Rechnung kunde'));
  assert.equal(match('Rechnug'), false);
  assert.equal(match('Rechnung Berlin'), false);
  assert.equal(match('k99'), false);
});
