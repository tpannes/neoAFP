/**
 * GOCA areas: lines that continue each other form one boundary (regression: every line became
 * its own subpath, so canvas filled nothing — bar and area charts stayed empty).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGoca } from '../../src/lib/goca/goca.js';

/**
 * Builds a GLINE order at given position (code X'C1') through the points.
 * @param {number[][]} points Points in graphics units.
 * @returns {{code: number, data: Uint8Array}} Order.
 */
function line(points) {
  const data = new Uint8Array(points.length * 4);
  const view = new DataView(data.buffer);
  points.forEach(([x, y], i) => { view.setInt16(i * 4, x); view.setInt16(i * 4 + 2, y); });
  return { code: 0xc1, data };
}

/**
 * Runs orders with an identity mapping.
 * @param {{code: number, data: Uint8Array}[]} orders Orders.
 * @returns {object[]} Items.
 */
const run = (orders) => runGoca(orders, { k: 1, toPage: (x, y) => [x, y], report: () => {}, sourceField: 0, fileId: 'f' });

test('continuing lines inside an area form one closed figure', () => {
  const items = run([
    { code: 0x68, data: new Uint8Array([0]) },
    line([[0, 0], [10, 0]]),
    line([[10, 0], [10, 10]]),
    line([[10, 10], [0, 10]]),
    { code: 0x60, data: new Uint8Array(0) },
  ]);
  assert.equal(items.length, 1);
  const moves = items[0].commands.filter((c) => c[0] === 'M');
  assert.equal(moves.length, 1, 'one subpath');
  assert.ok(items[0].fill);
});

test('a jump inside an area starts a new figure', () => {
  const items = run([
    { code: 0x68, data: new Uint8Array([0]) },
    line([[0, 0], [10, 0], [10, 10]]),
    line([[20, 0], [30, 0], [30, 10]]),
    { code: 0x60, data: new Uint8Array(0) },
  ]);
  assert.equal(items[0].commands.filter((c) => c[0] === 'M').length, 2);
});
