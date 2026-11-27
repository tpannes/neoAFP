/**
 * Every item under a point (render/hit-test.js hitAll, for the color picker's stacked elements):
 * smallest first, on equal size the one drawn last; hitTest gives the first of them; items without
 * a source field only when asked for (resource previews).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitAll, hitTest } from '../../src/lib/render/hit-test.js';

const rect = (x, y, width, height, extra = {}) => ({ type: 'image', rect: { x, y, width, height }, rotation: 0, sourceField: 1, ...extra });

test('stacked items: smallest first, then the one drawn last; hitTest takes the first', () => {
  const model = { items: [rect(0, 0, 100, 100), rect(10, 10, 20, 20), rect(10, 10, 20, 20), rect(200, 200, 5, 5)] };
  assert.deepEqual(hitAll(model, 15, 15), [2, 1, 0]);
  assert.equal(hitTest(model, 15, 15), 2);
  assert.deepEqual(hitAll(model, 50, 50), [0]);
  assert.deepEqual(hitAll(model, 150, 150), []);
});

test('items without a source field count only for previews', () => {
  const model = { items: [rect(0, 0, 10, 10, { sourceField: null })] };
  assert.deepEqual(hitAll(model, 5, 5), []);
  assert.deepEqual(hitAll(model, 5, 5, { withoutSource: true }), [0]);
});
