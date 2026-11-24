/**
 * Specified Vertical Font Size in the Coded Font Index (FOCA Reference, CFI bytes 16–17): 20ths of
 * a point (1440ths of an inch), 0 = none; values beyond 32,767 (X'FFF0' in some generators' outline
 * coded fonts) are no size either.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { specifiedSize } from '../../src/lib/foca/coded-font.js';

test('CFI vertical size is taken as 1/1440 inch (10.8 pt = 216)', () => {
  assert.equal(specifiedSize(216), 216);
  assert.equal(specifiedSize(200), 200);
});

test('zero and out-of-range values give no size', () => {
  assert.equal(specifiedSize(0), null);
  assert.equal(specifiedSize(0xfff0), null);
  assert.equal(specifiedSize(32768), null);
});
