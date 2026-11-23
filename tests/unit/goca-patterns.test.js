/**
 * GOCA custom patterns and gradients (task T301; GOCA for AFP Reference AFPC-0008-03, "Custom
 * Patterns", "Gradients", orders Begin/End Custom Pattern X'DE'/X'5E', Delete Pattern X'DF', Set
 * Pattern Reference Point X'A0', Linear Gradient X'FEDC', Radial Gradient X'FEDD'): the extended
 * order format, gradient colors and stops, the Outside values None/Pad/Repeat/Reflect over a
 * wider range, radial gradients in arc space, custom pattern tiles (bilevel in the area color,
 * full color as defined) placed at the reference point, deleting and undefined patterns.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGoca, splitOrders } from '../../src/lib/goca/goca.js';
import { readLinearGradient, readRadialGradient, gradientStops, linearRange, radialRange, TRANSPARENT } from '../../src/lib/goca/gradients.js';
import { bytes, uint } from '../helpers/afp-builder.js';

const RED = [0xff, 0x00, 0x00];
const BLUE = [0x00, 0x00, 0xff];
const GREEN = [0x00, 0x80, 0x00];
/** Color specification as in Set Process Color: length 13, RGB with 8 bits per component. */
const rgbSpec = (rgb) => bytes(13, 0x00, 0x01, 0, 0, 0, 0, 8, 8, 8, 0, ...rgb);
const xy = (...v) => bytes(...v.map((n) => uint(n & 0xffff, 2)));

/**
 * Builds the data of a gradient order (after its 2-byte length).
 * @param {'linear'|'radial'} kind Kind.
 * @param {number[]} geometry Linear: xs, ys, xe, ye; radial: xs, ys, mh, mfr, xe, ye, mh, mfr.
 * @param {number[]} outside Outside values of the start and end side.
 * @param {[number, number[]][]} [stops] Color stops: offset (0–10000) and RGB.
 * @returns {Uint8Array} Data.
 */
function gradientData(kind, geometry, outside, stops = []) {
  const geo = kind === 'linear' ? xy(...geometry)
    : bytes(xy(geometry[0], geometry[1]), geometry[2], geometry[3], xy(geometry[4], geometry[5]), geometry[6], geometry[7]);
  return bytes(0, 0, 0x01, 0x02, geo, rgbSpec(RED), ...BLUE, ...outside, ...stops.map(([o, c]) => bytes(uint(o, 2), ...c)));
}
const pts = (code, points) => ({ code, data: xy(...points.flat()) });
const attr = (code, value) => ({ code, data: new Uint8Array([value]) });
const area = (flags = 0x80) => [{ code: 0x68, data: new Uint8Array([flags]) }, pts(0xc1, [[0, 0], [100, 0], [100, 100], [0, 100]]), { code: 0x60, data: new Uint8Array(0) }];
const run = (orders) => {
  const reports = [];
  const items = runGoca(orders, { k: 1, toPage: (x, y) => [x, -y], report: (r) => reports.push(r), sourceField: 0, fileId: 'f' });
  return { items, reports };
};

test('extended order format: X\'FE\', qualifier, 2-byte length', () => {
  const d = gradientData('linear', [0, 0, 100, 0], [1, 1]);
  const orders = splitOrders(bytes(0xfe, 0xdc, uint(d.length, 2), d, 0x0a, 0x02));
  assert.deepEqual(orders.map((o) => [o.code, o.data.length]), [[0xfedc, d.length], [0x0a, 1]]);
});

test('linear gradient: start and end colors, Outside values, color stops in order', () => {
  const g = readLinearGradient(gradientData('linear', [0, 0, 100, 50], [0x02, 0x03], [[6000, GREEN], [5000, GREEN]]));
  assert.deepEqual([g.set, g.symbol, g.start, g.end], [1, 2, [0, 0], [100, 50]]);
  assert.deepEqual(g.stops, [{ offset: 0, color: '#ff0000' }, { offset: 0.6, color: '#008000' }, { offset: 1, color: '#0000ff' }], 'the decreasing stop is ignored');
  assert.deepEqual(g.outside, ['repeat', 'reflect']);
  assert.deepEqual(readLinearGradient(gradientData('linear', [0, 0, 1, 1], [7, 1])).outside, ['none', 'pad'], 'invalid Outside: None');
  const bad = gradientData('linear', [0, 0, 1, 1], [1, 1]);
  bad[12] = 20;
  assert.equal(readLinearGradient(bad), null, 'invalid color specification length');
});

test('radial gradient: full arc centers and multipliers', () => {
  const g = readRadialGradient(gradientData('radial', [10, 20, 1, 0x80, 30, 40, 5, 0], [1, 1]));
  assert.deepEqual([g.start, g.m0, g.end, g.m1], [[10, 20], 1.5, [30, 40], 5]);
});

test('stops over a wider range: Pad, None, Repeat and Reflect', () => {
  const stops = [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }];
  assert.deepEqual(gradientStops(stops, ['pad', 'pad'], 0, 1), stops);
  assert.deepEqual(gradientStops(stops, ['pad', 'pad'], -1, 2), [
    { offset: 0, color: '#ff0000' }, { offset: 1 / 3, color: '#ff0000' }, { offset: 1 / 3, color: '#ff0000' },
    { offset: 2 / 3, color: '#0000ff' }, { offset: 2 / 3, color: '#0000ff' }, { offset: 1, color: '#0000ff' }]);
  const none = gradientStops(stops, ['none', 'none'], -1, 2);
  assert.equal(none[0].color, TRANSPARENT);
  assert.equal(none[none.length - 1].color, TRANSPARENT);
  const repeat = gradientStops(stops, ['pad', 'repeat'], 0, 2);
  assert.deepEqual(repeat.map((s) => s.color), ['#ff0000', '#0000ff', '#ff0000', '#0000ff']);
  const reflect = gradientStops(stops, ['pad', 'reflect'], 0, 3);
  assert.deepEqual(reflect.map((s) => s.color), ['#ff0000', '#0000ff', '#0000ff', '#ff0000', '#ff0000', '#0000ff']);
  const half = gradientStops(stops, ['pad', 'pad'], -0.5, 1);
  assert.deepEqual(half[0], { offset: 0, color: '#ff0000' }, 'a range starting inside a period');
});

test('parameter ranges that cover the area', () => {
  assert.deepEqual(linearRange([0, 0], [10, 0], [[-5, 0], [20, 3]]), [-0.5, 2]);
  assert.deepEqual(linearRange([0, 0], [10, 0], [[2, 0], [8, 0]]), [0, 1]);
  const [lo, hi] = radialRange([0, 0], 0, [0, 0], 10, [[30, 0], [0, -20]]);
  assert.deepEqual([lo, hi], [0, 3], 'concentric: out to the farthest point');
  assert.deepEqual(radialRange([0, 0], 5, [0, 0], 10, [[0, 0]]), [-1, 1], 'not below radius zero');
});

test('an area filled with a linear gradient', () => {
  const d = gradientData('linear', [0, 0, 100, 0], [1, 1]);
  const { items, reports } = run([{ code: 0xfedc, data: d }, attr(0x08, 0x01), attr(0x28, 0x02), ...area()]);
  assert.deepEqual(reports, []);
  assert.deepEqual(items[0].gradient, { kind: 'linear', p0: [0, -0], p1: [100, -0], stops: readLinearGradient(d).stops, outside: ['pad', 'pad'] });
  const same = gradientData('linear', [5, 5, 5, 5], [1, 1]);
  assert.deepEqual(run([{ code: 0xfedc, data: same }, attr(0x08, 0x01), attr(0x28, 0x02), ...area()]).items, [], 'start = end: no fill');
});

test('an area filled with a radial gradient: circles in arc space and the placement matrix', () => {
  const arcs = { code: 0x22, data: xy(2, 1, 0, 0) }; // ellipse: x radius 2, y radius 1
  const d = gradientData('radial', [10, 20, 1, 0, 10, 20, 3, 0], [1, 1]);
  const { items } = run([arcs, { code: 0xfedd, data: d }, attr(0x08, 0x01), attr(0x28, 0x02), ...area()]);
  const g = items[0].gradient;
  assert.deepEqual([g.c0, g.r0, g.c1, g.r1], [[5, 20], 1, [5, 20], 3]);
  assert.deepEqual(g.matrix, [2, 0, 0, -1, 0, -0]);
  const zero = gradientData('radial', [0, 0, 0, 0, 10, 10, 0, 0], [1, 1]);
  assert.deepEqual(run([{ code: 0xfedd, data: zero }, attr(0x08, 0x01), attr(0x28, 0x02), ...area()]).items, [], 'both multipliers zero: no fill');
});

test('custom pattern: drawn into a tile, not into the picture; bilevel takes the area color', () => {
  const begin = (flags) => ({ code: 0xde, data: bytes(0, 0, flags, 0x03, 0x04, xy(0, 20, 0, 10)) });
  const def = [begin(0x00), attr(0x0a, 0x02), pts(0xc1, [[0, 0], [20, 10]]), { code: 0x5e, data: new Uint8Array(0) }];
  const { items } = run([...def, attr(0x0a, 0x01), attr(0x08, 0x03), attr(0x28, 0x04), ...area()]);
  assert.equal(items.length, 1, 'the definition draws nothing itself');
  const { tile } = items[0];
  assert.deepEqual([tile.width, tile.height], [20, 10]);
  assert.equal(tile.items[0].stroke, items[0].fill, 'bilevel: area color');
  assert.deepEqual(tile.items[0].commands, [['M', 0, 10], ['L', 20, 0]], 'tile coordinates from the window top left');
  assert.deepEqual(tile.matrix, [1, 0, 0, 1, 0, -10], 'default reference point (0, 0): tile top left at window height');
  // Reference point (5, 7): the window's lower left corner lies there.
  const moved = run([...def, { code: 0xa0, data: bytes(0, 0, xy(5, 7)) }, attr(0x08, 0x03), attr(0x28, 0x04), ...area()]).items[0].tile;
  assert.deepEqual(moved.matrix.slice(4), [5, -17]);
  const full = run([begin(0x80), attr(0x0a, 0x02), pts(0xc1, [[0, 0], [20, 10]]), { code: 0x5e, data: new Uint8Array(0) },
    attr(0x0a, 0x01), attr(0x08, 0x03), attr(0x28, 0x04), ...area()]).items[0];
  assert.notEqual(full.tile.items[0].stroke, full.fill, 'full color: colors as defined');
});

test('the current state is kept across a custom pattern definition', () => {
  const def = [{ code: 0xde, data: bytes(0, 0, 0, 0x03, 0x04, xy(0, 20, 0, 10)) }, attr(0x18, 0x08), pts(0xc1, [[0, 0], [5, 5]]), { code: 0x5e, data: new Uint8Array(0) }];
  const { items } = run([pts(0xc1, [[50, 50], [60, 60]]), ...def, pts(0x81, [[70, 70]])]);
  assert.equal(items.length, 2);
  assert.deepEqual(items[1].commands[0], ['M', 60, -60], 'current position unchanged; line type of the definition not taken over');
});

test('Delete Pattern removes one pattern or a whole set; undefined patterns fill solid and are reported', () => {
  const d = gradientData('linear', [0, 0, 100, 0], [1, 1]);
  const one = run([{ code: 0xfedc, data: d }, { code: 0xdf, data: bytes(0, 0, 0x01, 0x02) }, attr(0x08, 0x01), attr(0x28, 0x02), ...area()]);
  assert.equal(one.items[0].gradient, undefined);
  assert.deepEqual(one.reports, ["GOCA pattern X'01' X'02' is not defined"]);
  const set = run([{ code: 0xfedc, data: d }, { code: 0xdf, data: bytes(0, 0, 0x01) }, attr(0x08, 0x01), attr(0x28, 0x02), ...area()]);
  assert.equal(set.items[0].gradient, undefined);
  const twice = run([{ code: 0xfedc, data: d }, { code: 0xfedc, data: gradientData('linear', [0, 0, 1, 0], [0, 0]) }, attr(0x08, 0x01), attr(0x28, 0x02), ...area()]);
  assert.deepEqual(twice.items[0].gradient.p1, [100, -0], 'a pattern is not replaced without deleting it');
});

test('a segment that ends inside a custom pattern definition ends the definition', () => {
  const { items } = run([{ code: 0xde, data: bytes(0, 0, 0, 0x03, 0x04, xy(0, 20, 0, 10)) }, pts(0xc1, [[0, 0], [5, 5]])]);
  assert.deepEqual(items, []);
});

test('CMYK and CIELAB gradients are interpolated in their own color space (T310)', async () => {
  const { extendedColor } = await import('../../src/lib/ptoca/ptoca.js');
  const spec = (space, value) => bytes(10 + value.length, 0x00, space, 0, 0, 0, 0, ...value.map(() => 8), ...Array(4 - value.length).fill(0), ...value);
  const color = (space, value) => extendedColor(new Uint8Array([0x00, space, 0, 0, 0, 0, ...value.map(() => 8), ...Array(4 - value.length).fill(0), ...value]));
  const order = (space, start, end) => bytes(0, 0, 0x01, 0x02, xy(0, 0, 100, 0), spec(space, start), ...end, 1, 1);
  const cmyk = readLinearGradient(order(0x04, [255, 0, 0, 0], [0, 0, 255, 0]));
  assert.equal(cmyk.stops.length, 17, 'start, 15 steps, end');
  assert.deepEqual(cmyk.stops[8], { offset: 0.5, color: color(0x04, [128, 0, 128, 0]) }, 'the middle is mixed in CMYK');
  // CIELAB: a from −100 to +100 (signed bytes X'9C' and X'64'): the middle has a = 0, not −128.
  const lab = readLinearGradient(order(0x08, [128, 0x9c, 0], [128, 0x64, 0]));
  assert.deepEqual(lab.stops[8].color, color(0x08, [128, 0, 0]));
  const rgb = readLinearGradient(gradientData('linear', [0, 0, 100, 0], [1, 1]));
  assert.equal(rgb.stops.length, 2, 'RGB gradients keep their stops');
});
