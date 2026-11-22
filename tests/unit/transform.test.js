/**
 * Placing render items (T278, T279; render/transform.js): MO:DCA turns an overlay about its origin
 * (IPO OvlyOrent) and a page on the medium about its origin (PGP PGorient) clockwise, the Y axis
 * always 90° after the X axis (y down): a point (x, y) of the turned space lands at
 * (dx + x·cos θ − y·sin θ, dy + x·sin θ + y·cos θ).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeItem } from '../../src/lib/render/transform.js';

const at = { dx: 1000, dy: 2000 };

test('glyph runs: start point turned and moved, their rotation grows', () => {
  const run = { type: 'glyphRun', x: 100, y: 50, rotation: 0 };
  assert.deepEqual(placeItem(run, at), { ...run, x: 1100, y: 2050 });
  assert.deepEqual(placeItem(run, { ...at, rotation: 90 }), { ...run, x: 950, y: 2100, rotation: 90 });
  assert.deepEqual(placeItem(run, { ...at, rotation: 180 }), { ...run, x: 900, y: 1950, rotation: 180 });
  assert.deepEqual(placeItem(run, { ...at, rotation: 270 }), { ...run, x: 1050, y: 1900, rotation: 270 });
  assert.equal(placeItem({ ...run, rotation: 270 }, { rotation: 180 }).rotation, 90);
});

test('rules and paths: every point', () => {
  const rule = { type: 'rule', x1: 0, y1: 0, x2: 100, y2: 0, thickness: 10 };
  assert.deepEqual(placeItem(rule, { ...at, rotation: 90 }), { ...rule, x1: 1000, y1: 2000, x2: 1000, y2: 2100 });
  const path = { type: 'path', commands: [['M', 0, 0], ['L', 100, 0], ['C', 0, 10, 20, 30, 40, 50], ['Z']] };
  assert.deepEqual(placeItem(path, { rotation: 90 }).commands, [['M', 0, 0], ['L', 0, 100], ['C', -10, 0, -30, 20, -50, 40], ['Z']]);
});

test('images turn about their rectangle origin; placeholders and clips as turned boxes', () => {
  const image = { type: 'image', rect: { x: 10, y: 20, width: 300, height: 100 }, rotation: 0, clip: { x: 10, y: 20, width: 300, height: 100 } };
  const turned = placeItem(image, { ...at, rotation: 90 });
  assert.deepEqual(turned.rect, { x: 980, y: 2010, width: 300, height: 100 });
  assert.equal(turned.rotation, 90);
  assert.deepEqual(turned.clip, { x: 880, y: 2010, width: 100, height: 300 });
  const ph = { type: 'placeholder', rect: { x: 0, y: 0, width: 300, height: 100 } };
  assert.deepEqual(placeItem(ph, { rotation: 180 }).rect, { x: -300, y: -100, width: 300, height: 100 });
});

test('nothing to do: the item itself', () => {
  const run = { type: 'glyphRun', x: 1, y: 2 };
  assert.equal(placeItem(run, {}), run);
});
