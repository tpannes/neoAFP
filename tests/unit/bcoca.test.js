/**
 * BCOCA framework (T070): BSD/BSA parsing, units, placement, rotation, color, HRI and the
 * placeholder for bar code types without a symbology module. Field layouts follow BCOCA Tables 8
 * and 20 and Appendix B (MO:DCA environment).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytes, field, uint, ebcdic, documentOf, page, group, triplet } from '../helpers/afp-builder.js';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { readBsd, readBsa, wideToNarrow } from '../../src/lib/bcoca/bcoca.js';

/**
 * Builds a BSD (23 bytes, unit base 10 inches, 1440 units per inch).
 * @param {object} o Fields.
 * @returns {Uint8Array} BSD.
 */
function bsd({ type, modifier, color = 0xff07, module = 0xff, height = 0xffff, mult = 1, ratio = 0xffff }) {
  return bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2), uint(0xffff, 2), uint(0xffff, 2), uint(0, 2),
    type, modifier, 0xff, uint(color, 2), module, uint(height, 2), mult, uint(ratio, 2));
}

/**
 * Builds a bar code object with one symbol.
 * @param {Uint8Array} descriptor BDD data.
 * @param {number} flags BSA flags.
 * @param {string|Uint8Array} data EBCDIC data text, or raw data bytes.
 * @param {number} [rotation] Object area rotation in degrees.
 * @param {Uint8Array} [special] Special-function parameters (BSA bytes 5 …).
 * @returns {Uint8Array} Begin Bar Code Object … End Bar Code Object.
 */
function barcodeObject(descriptor, flags, data, rotation = 0, special = bytes()) {
  const obd = bytes(triplet(0x43, 0x01), triplet(0x4b, 0x00, 0x00, uint(14400, 2), uint(14400, 2)),
    triplet(0x4c, 0x02, uint(4000, 3), uint(2000, 3)));
  const rot = uint((rotation / 90) * 0x2d00, 2);
  const yRot = uint(((rotation / 90 + 1) % 4) * 0x2d00, 2);
  const obp = bytes(0x01, 23, uint(1440, 3), uint(2880, 3), rot, yRot, 0x00, uint(0, 3), uint(0, 3), uint(0, 2), uint(0x2d00, 2), 0x00);
  return group('D3A8EB', 'BC000001',
    group('D3A8C7', 'OEG00001', field('D3A66B', obd), field('D3AC6B', obp), field('D3A6EB', descriptor)),
    field('D3EEEB', bytes(flags, uint(100, 2), uint(200, 2), special, typeof data === 'string' ? ebcdic(data) : data)));
}

/**
 * Renders a one-page document and returns its items and diagnostics.
 * @param {Uint8Array} content Page content.
 * @returns {Promise<{items: object[], diagnostics: object[]}>} Result.
 */
async function render(content) {
  const ws = createWorkspace();
  const [f] = await ws.addFiles([createBufferSource(documentOf('DOC00001', page('PAGE0001', content)), 'bc.afp')], 'file');
  const doc = ws.listDocuments().find((d) => d.fileId === f.id) ?? ws.listDocuments()[0];
  const model = await ws.getRenderModel(doc.id, 1);
  return { items: model.items, diagnostics: ws.getDiagnostics({ fileId: f.id }) };
}

test('WE:NE values are decimals with the point after the first digit', () => {
  assert.equal(wideToNarrow(0x0002), 2);
  assert.equal(wideToNarrow(0x00e1), 2.25);
  for (const v of [0x0015, 0x00d2, 0x0834, 0x5208]) assert.equal(wideToNarrow(v), 2.1);
  assert.equal(wideToNarrow(0xffff), null);
});

test('BSD and BSA fields are read at their offsets', () => {
  const d = readBsd(bsd({ type: 0x01, modifier: 0x02, color: 0x0002, module: 20, height: 720, mult: 2, ratio: 0x00e1 }));
  assert.equal(d.type, 0x01);
  assert.equal(d.modifier, 0x02);
  assert.equal(d.color, '#ff0000');
  assert.equal(d.moduleMils, 20);
  assert.equal(d.height, 1440);
  assert.equal(d.ratio, 2.25);
  const a = readBsa(bytes(0b0101_0000, uint(10, 2), uint(20, 2), ebcdic('AB')), d);
  assert.equal(a.noHri, false);
  assert.equal(a.position, 2); // B'10' = above
  assert.equal(a.asterisks, true);
  assert.equal(a.x, 10);
  assert.equal(a.y, 20);
  assert.deepEqual([...a.data], [0xc1, 0xc2]);
});

test('a Color Specification triplet in the BDD overrides the BSD color', () => {
  const rgb = triplet(0x4e, 0x00, 0x01, 0, 0, 0, 0, 8, 8, 8, 0, 0x00, 0x80, 0x00);
  assert.equal(readBsd(bytes(bsd({ type: 0x01, modifier: 0x01 }), rgb)).color, '#008000');
});

test('a Code 39 object becomes bars at the object area and symbol offset, with HRI below', async () => {
  const { items } = await render(barcodeObject(bsd({ type: 0x01, modifier: 0x01, module: 10, height: 720 }), 0x00, 'AB'));
  const bars = items.find((i) => i.type === 'path');
  const text = items.find((i) => i.type === 'glyphRun');
  assert.ok(bars && text);
  // Area at (1440, 2880), symbol offset (100, 200): the first bar starts there.
  assert.deepEqual(bars.commands[0], ['M', 1540, 3080]);
  const ys = bars.commands.filter((c) => c[0] !== 'Z').map((c) => c[2]);
  assert.equal(Math.max(...ys) - Math.min(...ys), 720);
  assert.equal(text.text, 'AB');
  assert.ok(text.y > 3080 + 720, 'HRI below the bars');
  assert.equal(bars.fill, '#000000');
});

test('the object area rotation turns the symbol', async () => {
  const { items } = await render(barcodeObject(bsd({ type: 0x01, modifier: 0x01, module: 10, height: 720 }), 0x80, 'AB', 90));
  const bars = items.find((i) => i.type === 'path');
  assert.equal(items.filter((i) => i.type === 'glyphRun').length, 0, 'HRI flag off');
  // 90°: presentation space (x, y) → page (areaX − y, areaY + x)
  assert.deepEqual(bars.commands[0], ['M', 1440 - 200, 2880 + 100]);
});

test('unsupported bar code types become a placeholder with a diagnostic', async () => {
  const { items, diagnostics } = await render(barcodeObject(bsd({ type: 0x23, modifier: 0x00 }), 0x00, '012345672250513234567'));
  assert.equal(items[0].type, 'placeholder');
  assert.ok(diagnostics.some((d) => d.code === 'unsupportedObject' && /RED TAG/.test(d.params.reason)));
});

test('invalid data is reported and replaced by a placeholder', async () => {
  const { items, diagnostics } = await render(barcodeObject(bsd({ type: 0x09, modifier: 0x00 }), 0x00, '12AB'));
  assert.equal(items[0].type, 'placeholder');
  assert.ok(diagnostics.some((d) => d.code === 'decodeFailed' && /EAN-13/.test(d.params.reason)));
});

/**
 * Bounding box of path commands.
 * @param {object} path Path item.
 * @returns {{x0: number, y0: number, x1: number, y1: number}} Box.
 */
function box(path) {
  const pts = path.commands.filter((c) => c[0] !== 'Z');
  const xs = pts.map((c) => c[1]);
  const ys = pts.map((c) => c[2]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

test('a QR Code object: special functions, default module width, ASCII data', async () => {
  // Table 31: flags, conversion, version 2, level M, no structured append, no FNC1.
  const special = bytes(0x00, 0x00, 0x02, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00);
  const data = Uint8Array.from([...'HELLO'].map((c) => c.charCodeAt(0)));
  const { items, diagnostics } = await render(barcodeObject(bsd({ type: 0x20, modifier: 0x02 }), 0x00, data, 0, special));
  assert.equal(diagnostics.length, 0);
  const b = box(items.find((i) => i.type === 'path'));
  // Version 2 = 25 modules of 12 mils (Table 13) = 25 × 17.28 page units, from (1540, 3080).
  assert.deepEqual([b.x0, b.y0], [1540, 3080]);
  assert.ok(Math.abs(b.x1 - b.x0 - 25 * 17.28) < 1e-6);
  assert.equal(items.filter((i) => i.type === 'glyphRun').length, 0, '2D symbols have no HRI');
});

test('a QR Code object with EBCDIC conversion from code page 500', async () => {
  const special = bytes(0x80, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
  const { items } = await render(barcodeObject(bsd({ type: 0x20, modifier: 0x02, module: 10 }), 0x00, 'HELLO', 0, special));
  const b = box(items.find((i) => i.type === 'path'));
  assert.ok(Math.abs(b.x1 - b.x0 - 21 * 14.4) < 1e-6, 'version 1, 10 mils');
});

test('a Data Matrix object: size request and rotation', async () => {
  // Table 23: flags (EBCDIC), row size 32, 8 rows, no structured append, ASCII scheme.
  const special = bytes(0x80, uint(32, 2), uint(8, 2), 0x00, 0x00, 0x00, 0x00, 0x01);
  const { items, diagnostics } = await render(barcodeObject(bsd({ type: 0x1c, modifier: 0x00, module: 20 }), 0x00, 'AB12', 90, special));
  assert.equal(diagnostics.length, 0);
  const b = box(items.find((i) => i.type === 'path'));
  // 90°: 32 columns run down the page, 8 rows to the left of the area origin.
  assert.ok(Math.abs(b.y1 - b.y0 - 32 * 28.8) < 1e-6);
  assert.ok(Math.abs(b.x1 - b.x0 - 8 * 28.8) < 1e-6);
  assert.equal(b.x1, 1440 - 200);
});

test('Data Matrix data that does not fit the requested size is reported when asked for', async () => {
  const special = bytes(0xa0, uint(10, 2), uint(10, 2), 0x00, 0x00, 0x00, 0x00, 0x00);
  const { items, diagnostics } = await render(barcodeObject(bsd({ type: 0x1c, modifier: 0x00 }), 0x00, 'TOO MUCH DATA FOR TEN BY TEN', 0, special));
  assert.equal(items[0].type, 'placeholder');
  assert.ok(diagnostics.some((d) => d.code === 'decodeFailed' && /EC-0F20/.test(d.params.reason)));
});
