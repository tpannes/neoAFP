/**
 * Color specifications as given in the file, carried by render items for the color picker:
 * standard OCA colors (PTOCA Set Text Color, GOCA Set Color) and extended colors (PTOCA Set
 * Extended Text Color, GOCA Set Process Color; PTOCA Reference AFPC-0009-04 "Set Extended Text
 * Color", GOCA Reference AFPC-0008-03 "Set Process Color"). Items in the default color carry none.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ocaColorSpec, extendedColorSpec, colorSpecField } from '../../src/lib/render/color-spec.js';
import { runPtoca } from '../../src/lib/ptoca/ptoca.js';
import { runGoca } from '../../src/lib/goca/goca.js';
import { bytes } from '../helpers/afp-builder.js';
import { cs, AMB, AMI } from '../helpers/fixture-text.js';

/**
 * Extended color data: reserved, ColSpce, 4 reserved, ColSize1–4, ColValue.
 * @param {number} space Color space.
 * @param {number[]} sizes Bits per component.
 * @param {...number} value Value bytes.
 * @returns {Uint8Array} Data.
 */
const extended = (space, sizes, ...value) => new Uint8Array([0, space, 0, 0, 0, 0, ...sizes, ...value]);

/** A font of the test: every character 10 units wide. */
const FONT = {
  split: (b) => [...b].map((code) => ({ code })),
  glyph: (code) => ({ id: `g${code}`, unicode: String.fromCharCode(code), advance: 10, variableSpace: false }),
  baselineIncrement: 240,
};

test('OCA names and extended colors in their color space', () => {
  assert.deepEqual(ocaColorSpec(0x0001), { space: 'OCA', value: 'Blue' });
  assert.deepEqual(ocaColorSpec(0x1234), { space: 'OCA', value: "X'1234'" });
  assert.deepEqual(extendedColorSpec(extended(0x01, [8, 8, 8, 0], 0, 90, 180)), { space: 'RGB', value: '0 90 180' });
  assert.deepEqual(extendedColorSpec(extended(0x04, [16, 16, 16, 16], 0xff, 0xff, 0x33, 0x33, 0, 0, 0, 0)), { space: 'CMYK', value: '100 20 0 0 %' });
  assert.deepEqual(extendedColorSpec(extended(0x06, [16, 0, 0, 0], 0x00, 0x02, 50)), { space: 'Highlight', value: '#2 · 50 %' });
  assert.equal(extendedColorSpec(new Uint8Array(4)), null);
  assert.deepEqual(colorSpecField(null), {});
});

test('PTOCA text carries the color of STC and SEC; text before them none', () => {
  const run = (...controls) => runPtoca([bytes(AMB(500), AMI(100), ...controls)], { k: 1, font: () => FONT, report: () => {} }).segments
    .filter((s) => s.glyphs?.length).map((s) => s.colorSpec);
  const trn = cs(0xda, 0xc1);
  assert.deepEqual(run(trn, cs(0x74, 0x00, 0x02), trn, cs(0x80, ...extended(0x04, [8, 8, 8, 8], 255, 0, 0, 0)), trn), [
    null, { space: 'OCA', value: 'Red' }, { space: 'CMYK', value: '100 0 0 0 %' },
  ]);
});

test('GOCA lines carry the color of Set Color and Set Process Color', () => {
  const lineTo = { code: 0xc1, data: new Uint8Array([0, 0, 0, 0, 0, 10, 0, 10]) };
  const items = runGoca([
    lineTo,
    { code: 0x0a, data: new Uint8Array([0x04]) },
    lineTo,
    { code: 0xb2, data: extended(0x01, [8, 8, 8, 0], 255, 128, 0) },
    lineTo,
  ], { k: 1, toPage: (x, y) => [x, y], report: () => {}, sourceField: 0, fileId: 'f' });
  assert.deepEqual(items.map((i) => i.colorSpec ?? null), [null, { space: 'OCA', value: 'Green' }, { space: 'RGB', value: '255 128 0' }]);
});

test('pixel color space of images: what the picker can say about the screen color', async () => {
  const { iocaPixelSpace, imagePixelSpace } = await import('../../src/lib/resources/color-model.js');
  assert.equal(iocaPixelSpace({ space: 'ycbcr' }), 'rgb');
  assert.equal(iocaPixelSpace({ space: 'cmyk' }), 'cmyk');
  assert.equal(iocaPixelSpace({ bands: [8, 8, 8, 8] }), 'cmyk');
  assert.equal(iocaPixelSpace({ ideSize: 8 }), 'gray');
  assert.equal(iocaPixelSpace({ ideSize: 1 }), 'bilevel');
  // PNG color type at byte 25 (IHDR): 0 gray, 2 RGB, 3 palette.
  const png = (type) => { const d = new Uint8Array(26); d[25] = type; return d; };
  assert.deepEqual([0, 2, 3].map((type) => imagePixelSpace(png(type), 'png')), ['gray', 'rgb', 'rgb']);
  // JPEG: SOI, then SOF0 with precision, height, width and the component count.
  const jpeg = (n) => new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 1, 0, 1, n, 0, 0]);
  assert.deepEqual([1, 3, 4].map((n) => imagePixelSpace(jpeg(n), 'jpeg')), ['gray', 'rgb', 'cmyk']);
});
