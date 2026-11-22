/**
 * Layout of the continuous page view (src/viewer/components/scroll-layout.js, FR-017): estimated
 * sizes from the first row, corrections, finding rows, keeping the view in place, fit zoom.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScrollLayout } from '../../src/viewer/components/scroll-layout.js';

const A4 = { width: 11906, height: 16838 };

test('every row is assumed to be as large as the first until its size is known', () => {
  const layout = new ScrollLayout({ count: 3, estimate: { width: 100, height: 200 }, gap: 10, padding: 5 });
  assert.equal(layout.top(0), 5);
  assert.equal(layout.top(1), 215);
  assert.equal(layout.top(2), 425);
  assert.deepEqual(layout.extent(), { width: 110, height: 630 });
});

test('a corrected row moves the rows below it and widens the scroll area', () => {
  const layout = new ScrollLayout({ count: 3, estimate: { width: 100, height: 200 }, gap: 10, padding: 5 });
  assert.equal(layout.setSize(1, { width: 100, height: 200 }), false, 'same size: nothing changes');
  assert.equal(layout.setSize(1, { width: 300, height: 50 }), true);
  assert.equal(layout.top(1), 215);
  assert.equal(layout.top(2), 275);
  assert.equal(layout.extent().width, 310);
});

test('sheet rows: two sides with a gap, captions below', () => {
  const layout = new ScrollLayout({ count: 2, estimate: { width: 100, height: 200 }, columns: 2, columnGap: 24, extraHeight: 24, gap: 16, padding: 16 });
  assert.equal(layout.rowWidth(0), 224);
  assert.equal(layout.rowHeight(0), 224);
  assert.equal(layout.top(1), 16 + 224 + 16);
});

test('indexAt finds the row at a position, also in gaps and outside', () => {
  const layout = new ScrollLayout({ count: 3, estimate: { width: 100, height: 200 }, gap: 10, padding: 5 });
  assert.equal(layout.indexAt(-50), 0);
  assert.equal(layout.indexAt(0), 0);
  assert.equal(layout.indexAt(214), 0, 'the gap below a row belongs to it');
  assert.equal(layout.indexAt(215), 1);
  assert.equal(layout.indexAt(10_000), 2);
  assert.deepEqual(layout.range(100, 430), { first: 0, last: 2 });
});

test('an anchor keeps its spot when rows above it are corrected or the scale changes', () => {
  const layout = new ScrollLayout({ count: 100, estimate: { width: 100, height: 200 }, gap: 10, padding: 5 });
  const y = layout.top(40) + 50;
  const anchor = layout.anchor(y);
  assert.equal(anchor.index, 40);
  layout.setSize(3, { width: 100, height: 400 });
  assert.equal(layout.positionOf(anchor), y + 200);
  layout.setScale(2);
  const now = layout.positionOf(anchor);
  assert.equal(layout.indexAt(now), 40);
  // 50 px of a 200 px row with a 10 px gap; at scale 2 the row is 400 px, the gap still 10 px.
  assert.ok(Math.abs(now - layout.top(40) - (50 / 210) * 410) < 1e-9, 'same share of the row');
});

test('fitZoom measures the first row: width alone or width and height', () => {
  const base = 96 / 1440;
  const layout = new ScrollLayout({ count: 5, estimate: A4 });
  const pageW = A4.width * base;
  const pageH = A4.height * base;
  assert.equal(layout.fitZoom('fitWidth', pageW * 2, pageH, base), 2);
  assert.equal(layout.fitZoom('fitPage', pageW * 2, pageH, base), 1);
  const sheets = new ScrollLayout({ count: 5, estimate: A4, columns: 2, columnGap: 24, extraHeight: 24 });
  assert.equal(sheets.fitZoom('fitWidth', 2 * pageW + 24, 1e6, base), 1);
  assert.equal(sheets.fitZoom('fitPage', 1e6, pageH + 24, base), 1);
});

test('no rows: positions stay valid', () => {
  const layout = new ScrollLayout({ count: 0, estimate: A4 });
  assert.equal(layout.indexAt(100), 0);
  assert.deepEqual(layout.extent(), { width: 32, height: 32 });
});
