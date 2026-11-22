/**
 * Mapping options (MO:DCA Reference AFPC-0004-11, Mapping Option triplet X'04'): X'00' position,
 * X'10' position and trim, X'20' scale to fit, X'30' center and trim, X'60' scale to fill; without
 * a Map Image/Graphics Object or Map Container Data the architected default is scale to fit.
 * Regression: X'10' was treated as scale to fit and X'20' as center and trim.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeInArea } from '../../src/lib/ioca/ioca.js';

const area = (mappingOption) => ({ x: 100, y: 200, width: 1000, height: 500, contentX: 10, contentY: 20, mappingOption });

test('each mapping option places a 2000 × 500 image in a 1000 × 500 area as specified', () => {
  const clip = { x: 100, y: 200, width: 1000, height: 500 };
  assert.deepEqual(placeInArea(area(0x00), 2000, 500), { rect: { x: 110, y: 220, width: 2000, height: 500 }, clip: null });
  assert.deepEqual(placeInArea(area(0x10), 2000, 500), { rect: { x: 110, y: 220, width: 2000, height: 500 }, clip });
  assert.deepEqual(placeInArea(area(0x20), 2000, 500), { rect: { x: 100, y: 325, width: 1000, height: 250 }, clip: null });
  assert.deepEqual(placeInArea(area(0x30), 2000, 500), { rect: { x: -400, y: 200, width: 2000, height: 500 }, clip });
  assert.deepEqual(placeInArea(area(0x60), 2000, 500), { rect: { x: 100, y: 200, width: 1000, height: 500 }, clip: null });
});

test('without a mapping option the default is scale to fit', () => {
  assert.deepEqual(placeInArea(area(null), 2000, 500), placeInArea(area(0x20), 2000, 500));
});
