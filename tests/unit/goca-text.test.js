/**
 * GOCA character strings (task T300; GOCA for AFP Reference AFPC-0008-03, "Character Strings",
 * Set Character Angle X'34', Set Character Cell X'33', Set Character Direction X'3A', Set
 * Character Set X'38'): the character set selects an AFP font through the Map Coded Font
 * (font positioning: the font's advances), without one a substitute font sized by the cell;
 * angles 0°, 90°, 180°, 270° (others rounded to the closest); the four directions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runGoca, splitOrders } from '../../src/lib/goca/goca.js';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { bytes, field, uint, ebcdic, triplet, documentOf, group, resourceGroup, ID } from '../helpers/afp-builder.js';
import { fontCharacterSet, codePage, mapCodedFont } from '../helpers/fixture-text.js';
import { loadCodePage } from '../../src/lib/codepages/index.js';

await loadCodePage('ebcdic-500');

/** A font handle like the font manager's: every code is one glyph of advance 100. */
const FONT = {
  split: (b) => [...b].map((code) => ({ code })),
  glyph: (code) => ({ id: `G${code}`, unicode: String.fromCharCode(code), advance: 100 }),
  baselineIncrement: 240,
  descriptor: { kind: 'raster', name: 'X0TEST01' },
};

const pair = (code, x, y) => {
  const data = new Uint8Array(4);
  new DataView(data.buffer).setInt16(0, x);
  new DataView(data.buffer).setInt16(2, y);
  return { code, data };
};
const string = (text, x = 100, y = 200) => ({ code: 0xc3, data: bytes(uint(x, 2), uint(y, 2), ...[...text].map((c) => c.charCodeAt(0))) });
const attr = (code, value) => ({ code, data: new Uint8Array([value]) });

/**
 * Runs orders with an identity mapping and the test font for character set 1.
 * @param {{code: number, data: Uint8Array}[]} orders Orders.
 * @returns {object[]} Items.
 */
const run = (orders) => runGoca(orders, { k: 1, toPage: (x, y) => [x, y], font: (lid) => (lid === 1 ? FONT : null), report: () => {}, sourceField: 0, fileId: 'f' });

test('order formats: GSCA and GSCC have a length, GSCD and GSCS are two bytes', () => {
  const orders = splitOrders(new Uint8Array([0x34, 0x04, 0, 0, 0, 1, 0x33, 0x08, 0, 10, 0, 20, 0x80, 0, 0, 0, 0x3a, 0x02, 0x38, 0x01]));
  assert.deepEqual(orders.map((o) => [o.code, o.data.length]), [[0x34, 4], [0x33, 8], [0x3a, 1], [0x38, 1]]);
});

test('a mapped character set draws with the AFP font and its advances', () => {
  const [item] = run([attr(0x38, 0x01), string('ABC')]);
  assert.deepEqual(item.font, FONT.descriptor);
  assert.deepEqual(item.ids, ['G65', 'G66', 'G67']);
  assert.deepEqual(item.dx, [0, 100, 200]);
  assert.deepEqual(item.codes, [65, 66, 67]);
  assert.deepEqual([item.x, item.y, item.rotation], [100, 200, 0]);
});

test('without a mapped font: substitute font sized by the cell; a zero cell draws nothing', () => {
  const cell = { code: 0x33, data: bytes(uint(40, 2), uint(80, 2)) };
  const [item] = run([cell, attr(0x38, 0x02), string('ÁÂ')]); // EBCDIC 500 "AB"
  assert.equal(item.font.kind, 'substitute');
  assert.equal(item.font.size, 80);
  assert.deepEqual(item.dx, [0, 40], 'cell width');
  assert.equal(item.text, 'AB');
  const zero = { code: 0x33, data: bytes(uint(0, 2), uint(80, 2)) };
  assert.deepEqual(run([zero, string('Á')]), []);
  const fraction = { code: 0x33, data: bytes(uint(40, 2), uint(80, 2), uint(0x8000, 2), uint(0, 2)) };
  assert.deepEqual(run([fraction, string('ÁÂ')])[0].dx, [0, 40.5], 'fractional cell width');
});

test('character angle: 0°, 90°, 180°, 270° counterclockwise; other angles rounded; (0,0) default', () => {
  const angle = (x, y) => run([pair(0x34, x, y), attr(0x38, 0x01), string('A')])[0].rotation;
  assert.deepEqual([angle(1, 0), angle(0, 1), angle(-1, 0), angle(0, -1)], [0, 270, 180, 90], 'page rotation is clockwise');
  assert.equal(angle(10, 3), 0, 'closest: 0°');
  assert.equal(angle(3, 10), 270, 'closest: 90°');
  assert.equal(angle(0, 0), 0);
});

test('character direction: right to left ends the first character at the position', () => {
  const [item] = run([attr(0x3a, 0x03), attr(0x38, 0x01), string('AB')]);
  assert.deepEqual(item.dx, [-100, -200]);
});

test('character direction: top to bottom and bottom to top stack the characters', () => {
  const down = run([attr(0x3a, 0x02), attr(0x38, 0x01), string('AB')]);
  assert.deepEqual(down.map((i) => [i.x, i.y, i.ids[0]]), [[100, 200 + 0.8 * 240, 'G65'], [100, 200 + 1.8 * 240, 'G66']]);
  const up = run([attr(0x3a, 0x04), attr(0x38, 0x01), string('AB')]);
  assert.deepEqual(up.map((i) => [i.x, i.y]), [[100, 200], [100, 200 - 240]]);
  assert.equal(run([attr(0x3a, 0x07), attr(0x38, 0x01), string('AB')]).length, 1, 'invalid direction: left to right');
});

test('a graphics object uses the font that the page maps to its character set', async () => {
  const orders = bytes(0x38, 0x01, 0xc3, 7, uint(100, 2), uint(100, 2), ebcdic('ABC'));
  const segment = bytes(0x70, 0x0c, ebcdic('SEG1', 4), 0x00, 0x00, uint(orders.length, 2), new Uint8Array(4), orders);
  const gdd = bytes(0xf6, 18, 0x40, 0x00, 0x00, 0x00, uint(2400, 2), uint(2400, 2), uint(0, 2), uint(0, 2), uint(1200, 2), uint(0, 2), uint(600, 2));
  const obd = bytes(triplet(0x43, 0x01), triplet(0x4b, 0x00, 0x00, uint(14400, 2), uint(14400, 2)), triplet(0x4c, 0x02, uint(7200, 3), uint(3600, 3)));
  const obp = bytes(0x01, 23, uint(1440, 3), uint(1440, 3), uint(0, 2), uint(0x2d00, 2), 0x00, uint(0, 3), uint(0, 3), uint(0, 2), uint(0x2d00, 2), 0x01);
  const graphics = group('D3A8BB', 'GR000001', group('D3A8C7', 'OEG00001', field('D3A66B', obd), field('D3AC6B', obp)),
    field('D3A6BB', gdd), field('D3EEBB', segment));
  const units = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2));
  const page = group(ID.BPG, 'PAGE0001', group(ID.BAG, 'AEG1', mapCodedFont(),
    field(ID.PGD, bytes(units, uint(11906, 3), uint(16838, 3), uint(0, 3)))), graphics);
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(bytes(resourceGroup(fontCharacterSet(), codePage()), documentOf('GOCATEXT', page)), 'goca-text.afp')], 'file');
  const run1 = (await ws.getRenderModel(file.id, 1)).items.find((i) => i.type === 'glyphRun');
  assert.notEqual(run1.font.kind, 'substitute');
  assert.equal(run1.text, 'ABC');
  assert.deepEqual(ws.getDiagnostics({ fileId: file.id }).map((d) => d.code), []);
});
