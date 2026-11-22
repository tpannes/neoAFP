/**
 * Object areas (MO:DCA Object Area Position and Descriptor) in graphics objects:
 * - a turned area (X axis at 90°) turns the picture around the area's origin, as images do
 *   (bug: GOCA ignored it, so pie charts on landscape pages were drawn unturned, off their
 *   place and across the table);
 * - a Color Specification triplet on the Object Area Descriptor fills the whole area with that
 *   color before the object (bug: ignored, so table row shading made of empty image objects
 *   that only color their area was missing).
 * Graphics window 1200 × 600 at 240 dpi on an area of the same size at (1440, 1440): one graphics
 * unit is 6 page units.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { bytes, field, uint, ebcdic, triplet, documentOf, page, group } from '../helpers/afp-builder.js';

const pt = (...coords) => bytes(...coords.map((v) => uint(v & 0xffff, 2)));
const order = (code, ...data) => {
  const d = bytes(...data);
  return bytes(code, d.length, d);
};

/**
 * Builds a page with one graphics object: a line from (0, 600) to (100, 600), the window's top
 * left corner, 100 units to the right.
 * @param {{turned?: boolean, color?: number[]}} options Area turned by 90°; area color (RGB).
 * @returns {Uint8Array} AFP bytes.
 */
function documentWith({ turned = false, color = null } = {}) {
  const obd = bytes(triplet(0x43, 0x01), triplet(0x4b, 0x00, 0x00, uint(14400, 2), uint(14400, 2)),
    triplet(0x4c, 0x02, uint(7200, 3), uint(3600, 3)),
    ...(color ? [triplet(0x4e, 0x00, 0x01, 0, 0, 0, 0, 8, 8, 8, 0, ...color)] : []));
  const [xAxis, yAxis] = turned ? [0x2d00, 0x5a00] : [0x0000, 0x2d00];
  const obp = bytes(0x01, 23, uint(1440, 3), uint(1440, 3), uint(xAxis, 2), uint(yAxis, 2), 0x00,
    uint(0, 3), uint(0, 3), uint(0, 2), uint(0x2d00, 2), 0x01);
  const gdd = order(0xf6, 0x40, 0x00, 0x00, 0x00, uint(2400, 2), uint(2400, 2), uint(0, 2), pt(0, 1200, 0, 600));
  const orders = order(0xc1, pt(0, 600, 100, 600));
  const segment = bytes(0x70, 0x0c, ebcdic('SEG1', 4), 0x00, 0x00, uint(orders.length, 2), new Uint8Array(4), orders);
  const graphics = group('D3A8BB', 'GR000001',
    group('D3A8C7', 'OEG00001', field('D3A66B', obd), field('D3AC6B', obp), field('D3ABBB', bytes(uint(5, 2), triplet(0x04, 0x20)))),
    field('D3A6BB', gdd), field('D3EEBB', segment));
  return documentOf('AREADOC1', page('PAGE0001', graphics));
}

/**
 * Renders page 1 of a document.
 * @param {Uint8Array} doc AFP bytes.
 * @returns {Promise<object[]>} Render items.
 */
async function items(doc) {
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(doc, 'area.afp')], 'file');
  return (await ws.getRenderModel(file.id, 1)).items;
}

const points = (path) => path.commands.filter((c) => c.length > 1).map((c) => c.slice(1).map((v) => Math.round(v)));

test('a graphics area turned by 90° turns the picture around the area origin', async () => {
  const [plain] = (await items(documentWith())).filter((i) => i.type === 'path');
  assert.deepEqual(points(plain), [[1440, 1440], [2040, 1440]]);
  const [turned] = (await items(documentWith({ turned: true }))).filter((i) => i.type === 'path');
  // The area's X axis points down the page: the line runs downwards from the area origin.
  assert.deepEqual(points(turned), [[1440, 1440], [1440, 2040]]);
});

test('an area color fills the object area before the object, turned with it', async () => {
  const list = await items(documentWith({ color: [0xcf, 0xff, 0xcf] }));
  assert.equal(list[0].fill, '#cfffcf');
  assert.deepEqual(points(list[0]), [[1440, 1440], [8640, 1440], [8640, 5040], [1440, 5040]]);
  assert.equal(list[1].stroke !== null, true); // the line comes after the fill
  const turned = await items(documentWith({ turned: true, color: [0xcf, 0xff, 0xcf] }));
  assert.deepEqual(points(turned[0]), [[1440, 1440], [1440, 8640], [-2160, 8640], [-2160, 1440]]);
  // Without a color nothing is added.
  assert.equal((await items(documentWith())).filter((i) => i.fill).length, 0);
});
