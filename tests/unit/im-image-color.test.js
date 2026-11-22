/**
 * IM image color (MO:DCA IM Image Input Descriptor, image color at bytes 34–35, a standard OCA
 * named color): the 1 bits are drawn in that color, the 0 bits stay transparent. Bug: every IM
 * image was black, so charts built from overlapping IM images, one per color (e.g. a pie chart
 * in blue, red, green and turquoise), were solid black. X'FF07'
 * (printer default) and X'FFFF' stay black.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { bytes, field, group, uint, page, documentOf } from '../helpers/afp-builder.js';

/**
 * Builds an 8 × 8 IM image of one color, all pels set.
 * @param {string} name Object name.
 * @param {number} color Named color value.
 * @returns {Uint8Array} Begin IM Image … End IM Image.
 */
function imImage(name, color) {
  const ioc = bytes(uint(0, 3), uint(0, 3), uint(0x0000, 2), uint(0x2d00, 2), new Uint8Array(8), uint(0x03e8, 2), uint(0x03e8, 2), uint(0xffff, 2));
  const iid = bytes(0x00, 0x00, 0x09, 0x60, 0x09, 0x60, new Uint8Array(6), 0x00, 0x00, uint(2400, 2), uint(2400, 2),
    uint(8, 2), uint(8, 2), 0x00, 0x00, 0x00, 0x00, 0x2d, 0x00, uint(0, 2), uint(0, 2), uint(0x0001, 2), uint(color, 2));
  return group('D3A87B', name, field('D3A77B', ioc), field('D3A67B', iid), field('D3EE7B', new Uint8Array(8).fill(0xff)));
}

test('IM images are drawn in their IID color; the printer default stays black', async () => {
  const doc = documentOf('IMCOLOR1', page('PAGE0001', imImage('IMBLUE01', 0x0001), imImage('IMRED001', 0x0002), imImage('IMDEFLT1', 0xff07), imImage('IMDEFLT2', 0xffff)));
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(doc, 'im-color.afp')], 'file');
  const model = await ws.getRenderModel(file.id, 1);
  const images = model.items.filter((i) => i.type === 'image');
  assert.deepEqual(images.map((i) => i.color), ['#0000ff', '#ff0000', '#000000', '#000000']);
  const colors = await Promise.all(images.map(async (i) => (await ws.getImagePixels(i.imageRef)).color));
  assert.deepEqual(colors, [[0, 0, 255], [255, 0, 0], [0, 0, 0], [0, 0, 0]]);
});
