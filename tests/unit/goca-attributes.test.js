/**
 * GOCA line attributes, markers, Begin Area flags and the default pattern set (tasks T296–T299;
 * GOCA for AFP Reference AFPC-0008-03): line types as dash sequences in line widths, invisible
 * lines, line ends and joins, the dash sequence continuing over following lines and restarting at
 * Move Type orders, the ten default markers and their cell size, boundary lines and the fill rule
 * of areas, and fill patterns (no fill, solid, patterned, custom pattern sets reported).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGoca, splitOrders, markerItems } from '../../src/lib/goca/goca.js';
import { PATTERN_TILES, patternFill } from '../../src/lib/goca/patterns.js';

/** Line width of a normal line in page units (goca.js: about 0.01 inch). */
const W = 14.4;

/**
 * Builds an order with 2-byte signed coordinate pairs.
 * @param {number} code Order code.
 * @param {number[][]} points Points.
 * @returns {{code: number, data: Uint8Array}} Order.
 */
function pointsOrder(code, points) {
  const data = new Uint8Array(points.length * 4);
  const view = new DataView(data.buffer);
  points.forEach(([x, y], i) => { view.setInt16(i * 4, x); view.setInt16(i * 4 + 2, y); });
  return { code, data };
}
const line = (points) => pointsOrder(0xc1, points);
const lineHere = (points) => pointsOrder(0x81, points);
const attr = (code, value) => ({ code, data: new Uint8Array([value]) });

/**
 * Runs orders with an identity mapping and collects reports.
 * @param {{code: number, data: Uint8Array}[]} orders Orders.
 * @returns {{items: object[], reports: string[]}} Items and reports.
 */
function run(orders) {
  const reports = [];
  const items = runGoca(orders, { k: 1, toPage: (x, y) => [x, y], report: (r) => reports.push(r), sourceField: 0, fileId: 'f' });
  return { items, reports };
}

test('order formats: GSLT, GSLE, GSLJ, GSPS, GSPT and GSMT are two bytes, GSCLT and GSMC have a length', () => {
  const orders = splitOrders(new Uint8Array([0x18, 0x02, 0x1a, 0x01, 0x1b, 0x03, 0x08, 0x00, 0x28, 0x05, 0x29, 0x06,
    0x20, 0x04, 0x02, 0x80, 0x01, 0x00, 0x37, 0x04, 0x00, 0x0a, 0x00, 0x0a]));
  assert.deepEqual(orders.map((o) => [o.code, o.data.length]), [[0x18, 1], [0x1a, 1], [0x1b, 1], [0x08, 1], [0x28, 1], [0x29, 1], [0x20, 4], [0x37, 4]]);
});

test('standard line types are dash sequences in line widths; X\'07\' solid, X\'08\' invisible', () => {
  const dashes = [];
  for (const type of [0x01, 0x02, 0x03, 0x04, 0x05, 0x06]) dashes.push(run([attr(0x18, type), line([[0, 0], [100, 0]])]).items[0].dash);
  assert.deepEqual(dashes, [[0, 2], [3, 3], [6, 4, 0, 4], [0, 3, 0, 7], [8, 3], [6, 3, 0, 3, 0, 3]].map((seq) => seq.map((v) => v * W)));
  assert.equal(run([attr(0x18, 0x07), line([[0, 0], [100, 0]])]).items[0].dash, undefined);
  assert.equal(run([attr(0x18, 0x4b), line([[0, 0], [100, 0]])]).items[0].dash, undefined, 'invalid value: solid');
  assert.deepEqual(run([attr(0x18, 0x08), line([[0, 0], [100, 0]])]).items, [], 'invisible: nothing drawn');
});

test('an invisible line still moves the current position', () => {
  const { items } = run([attr(0x18, 0x08), line([[0, 0], [50, 0]]), attr(0x18, 0x07), lineHere([[50, 40]])]);
  assert.deepEqual(items[0].commands, [['M', 50, 0], ['L', 50, 40]]);
});

test('custom line types: 8.8 fixed-point dash and move lengths; all zero is solid', () => {
  const custom = { code: 0x20, data: new Uint8Array([0x06, 0x00, 0x00, 0x80]) }; // dash 6, move 0.5
  assert.deepEqual(run([custom, line([[0, 0], [100, 0]])]).items[0].dash, [6 * W, 0.5 * W]);
  const zero = { code: 0x20, data: new Uint8Array([0, 0, 0, 0]) };
  assert.equal(run([zero, line([[0, 0], [100, 0]])]).items[0].dash, undefined);
});

test('the dash sequence continues over following lines and restarts at a given position', () => {
  const { items } = run([attr(0x18, 0x02), line([[0, 0], [30, 0]]), lineHere([[30, 40]]), line([[0, 100], [10, 100]])]);
  assert.deepEqual(items.map((i) => i.dashOffset), [0, 30, 0]);
});

test('line ends and joins: defaults round, X\'01\'–X\'03\' as defined; Box corners stay sharp', () => {
  const plain = run([line([[0, 0], [10, 0]])]).items[0];
  assert.deepEqual([plain.lineCap, plain.lineJoin], ['round', 'round']);
  const set = run([attr(0x1a, 0x01), attr(0x1b, 0x01), line([[0, 0], [10, 0], [10, 10]])]).items[0];
  assert.deepEqual([set.lineCap, set.lineJoin], ['butt', 'bevel']);
  const square = run([attr(0x1a, 0x02), attr(0x1b, 0x03), line([[0, 0], [10, 0], [10, 10]])]).items[0];
  assert.deepEqual([square.lineCap, square.lineJoin], ['square', 'miter']);
  const box = run([attr(0x1b, 0x01), { code: 0xc0, data: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 10, 0, 10]) }]).items[0];
  assert.equal(box.lineJoin, 'miter');
});

test('markers: each symbol of the default set, centered, in the default cell of 7/120 inch', () => {
  const at = (symbol) => run([attr(0x29, symbol), pointsOrder(0xc2, [[100, 200]])]).items;
  const cross = at(0x01)[0];
  assert.deepEqual(cross.commands, [['M', 58, 158], ['L', 142, 242], ['M', 58, 242], ['L', 142, 158]]);
  assert.deepEqual([cross.stroke, cross.fill], ['#000000', null]);
  assert.equal(at(0x02)[0].commands.length, 4, 'plus: two lines');
  assert.equal(at(0x05)[0].commands.length, 6, '6-point star: cross and a vertical line');
  assert.equal(at(0x06)[0].commands.length, 8, '8-point star: cross, vertical and horizontal line');
  for (const filled of [0x07, 0x08, 0x09]) assert.ok(at(filled)[0].fill && !at(filled)[0].stroke, `X'0${filled.toString(16)}' is filled`);
  for (const outline of [0x03, 0x04, 0x0a]) assert.ok(at(outline)[0].stroke && !at(outline)[0].fill);
  assert.deepEqual(at(0x40), [], 'blank');
  assert.deepEqual(at(0x00)[0].commands, cross.commands, 'drawing default: cross');
  assert.deepEqual(at(0x33)[0].commands, cross.commands, 'undefined symbol: cross');
});

test('markers: one per point, cell size from GSMC, zero size with NOTDEFLT, current position moves', () => {
  const cell = { code: 0x37, data: new Uint8Array([0x00, 0x14, 0x00, 0x0a]) }; // 20 × 10
  const { items } = run([cell, pointsOrder(0xc2, [[0, 0], [50, 50]]), lineHere([[60, 60]])]);
  assert.equal(items.length, 3);
  assert.deepEqual(items[0].commands[0], ['M', -10, -5]);
  assert.deepEqual(items[2].commands[0], ['M', 50, 50], 'the line starts at the last marker');
  const zero = { code: 0x37, data: new Uint8Array([0, 0, 0, 0, 0x80, 0x00]) };
  assert.deepEqual(run([zero, pointsOrder(0xc2, [[0, 0]])]).items, []);
  const defaultCell = { code: 0x37, data: new Uint8Array([0, 0, 0, 0]) };
  assert.equal(run([defaultCell, pointsOrder(0xc2, [[0, 0]])]).items[0].commands[0][1], -42);
});

test('marker shapes do not depend on line type and width', () => {
  const dashed = run([attr(0x18, 0x02), { code: 0x19, data: new Uint8Array([5]) }, pointsOrder(0xc2, [[0, 0]])]).items[0];
  assert.equal(dashed.dash, undefined);
  assert.deepEqual(dashed, { ...markerItems(0x01, 0, 0, 42, 42, '#000000')[0], sourceField: 0, fileId: 'f' });
});

test('Begin Area flags: boundary lines after the fill; alternate or nonzero winding', () => {
  const area = (flags) => run([{ code: 0x68, data: new Uint8Array([flags]) }, line([[0, 0], [10, 0], [10, 10]]), { code: 0x60, data: new Uint8Array(0) }]).items;
  const plain = area(0x80);
  assert.equal(plain.length, 1);
  assert.equal(plain[0].fillRule, 'evenodd');
  const bounded = area(0xc0);
  assert.equal(bounded.length, 2);
  assert.ok(bounded[0].fill && !bounded[0].stroke, 'fill first');
  assert.ok(bounded[1].stroke && !bounded[1].fill, 'then the boundary');
  assert.equal(area(0xa0)[0].fillRule, 'nonzero');
});

test('fill patterns: X\'0F\' and X\'40\' no fill, X\'10\' and X\'00\' solid, X\'01\'–X\'0E\' patterned', () => {
  const fill = (symbol, set = 0) => run([attr(0x08, set), attr(0x28, symbol), { code: 0x68, data: new Uint8Array([0xc0]) },
    line([[0, 0], [10, 0], [10, 10]]), { code: 0x60, data: new Uint8Array(0) }]);
  assert.equal(fill(0x0f).items.length, 1, 'no fill, only the boundary');
  assert.ok(fill(0x0f).items[0].stroke);
  assert.equal(fill(0x40).items.length, 1);
  assert.equal(fill(0x10).items[0].pattern, undefined);
  assert.equal(fill(0x00).items[0].pattern, undefined);
  assert.equal(fill(0x0b).items[0].pattern, 0x0b);
  const custom = fill(0x05, 0x03); // pattern set X'03' holds no pattern X'05'
  assert.equal(custom.items[0].pattern, undefined, 'undefined custom pattern: solid');
  assert.deepEqual(custom.reports, ["GOCA pattern X'03' X'05' is not defined"]);
});

test('the pattern and color current at Begin Area are used', () => {
  const { items } = run([attr(0x28, 0x09), { code: 0x0a, data: new Uint8Array([0x02]) }, { code: 0x68, data: new Uint8Array([0x80]) },
    attr(0x28, 0x10), { code: 0x0a, data: new Uint8Array([0x04]) }, line([[0, 0], [10, 0], [10, 10]]), { code: 0x60, data: new Uint8Array(0) }]);
  assert.equal(items[0].pattern, 0x09);
  assert.equal(items[0].fill, run([{ code: 0x0a, data: new Uint8Array([0x02]) }, line([[0, 0], [1, 1]])]).items[0].stroke);
});

test('pattern tiles of Figure 19: sizes and densities', () => {
  const density = (t) => {
    let on = 0;
    for (let y = 0; y < t.height; y++) for (let x = 0; x < t.width; x++) on += (t.bits[y * t.rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
    return on / (t.width * t.height);
  };
  assert.deepEqual(Object.keys(PATTERN_TILES).map(Number), Array.from({ length: 14 }, (_, i) => i + 1));
  assert.equal(density(PATTERN_TILES[0x01]), 0.5, 'checkerboard');
  assert.equal(density(PATTERN_TILES[0x02]), 0.25);
  assert.deepEqual([PATTERN_TILES[0x09].width, PATTERN_TILES[0x09].height], [8, 1], 'vertical lines');
  assert.deepEqual([PATTERN_TILES[0x0a].width, PATTERN_TILES[0x0a].height], [1, 16], 'horizontal lines');
  for (const n of [0x0b, 0x0c, 0x0d, 0x0e]) assert.equal(density(PATTERN_TILES[n]), 0.25, `diagonal lines X'0${n.toString(16)}'`);
  assert.deepEqual([0x0f, 0x40, 0x10, 0x00, 0x05].map(patternFill), ['none', 'none', 'solid', 'solid', 'pattern']);
});
