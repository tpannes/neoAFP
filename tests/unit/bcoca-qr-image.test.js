/**
 * QR Code with Image (T288; BCOCA Table 33): the images of the Image Information Blocks are
 * mapped by MDRs in the bar code object's OEG and placed in the Xqr,Yqr system of the symbol.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytes, field, uint, documentOf, page, group, triplet, resourceGroup, resource, objectContainer, ebcdic } from '../helpers/afp-builder.js';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';

/** A PNG header for a 100 × 50 pel image (enough for the size). */
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, uint(13, 4), 0x49, 0x48, 0x44, 0x52, uint(100, 4), uint(50, 4), 8, 6, 0, 0, 0, uint(0, 4));

/**
 * Builds one Image Information Block.
 * @param {object} o Values.
 * @returns {Uint8Array} Block.
 */
function imageBlock({ id = 1, offBase = 0x64, upub = 1, x = 40, y = 40, turn = 0, extBase = 0x64, w = 20, h = 20, mapping = 0x60 }) {
  return bytes(0x16, uint(0, 2), uint(id, 2), offBase, uint(upub, 2), uint(x & 0xffff, 2), uint(y & 0xffff, 2), uint(turn, 2), 0xf0,
    extBase, uint(upub, 2), uint(w, 2), uint(h, 2), mapping);
}

/**
 * Builds a document with one QR Code with Image object and the image resource LOGO1.
 * @param {Uint8Array[]} blocks Image Information Blocks.
 * @param {number} [qrFlags] Byte 14 (presentation order, only images).
 * @param {boolean} [mapped] Whether the MDR maps local ID 1.
 * @returns {Uint8Array} AFP bytes.
 */
function qrWithImage(blocks, qrFlags = 0, mapped = true) {
  const bsd = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2), uint(0xffff, 2), uint(0xffff, 2), uint(0, 2),
    0x20, 0x12, 0xff, uint(0xff07, 2), 0xff, uint(0xffff, 2), 1, uint(0xffff, 2));
  const groupTriplets = bytes(triplet(0x02, 0xbe, 0x00, uint(1, 2)), triplet(0x02, 0xce, 0x00, ebcdic('LOGO1', 8)));
  const mdr = field('D3ABC3', bytes(uint(2 + groupTriplets.length, 2), groupTriplets));
  const rg = bytes(...blocks);
  const special = bytes(0x00, 0x00, 0x00, 0x01, 0, 0, 0, 0x00, 0x00, qrFlags, uint(rg.length, 2), rg);
  const obj = group('D3A8EB', 'BC000001', group('D3A8C7', 'OEG00001', ...(mapped ? [mdr] : []), field('D3A6EB', bsd)),
    field('D3EEEB', bytes(0x00, uint(0, 2), uint(0, 2), special, ...[...'AFP'].map((c) => c.charCodeAt(0)))));
  return bytes(resourceGroup(resource('LOGO1', 0x92, objectContainer('LOGO1', PNG))), documentOf('DOC00001', page('PAGE0001', obj)));
}

/**
 * Renders the first page.
 * @param {Uint8Array} afp AFP bytes.
 * @returns {Promise<{items: object[], diagnostics: object[]}>} Items and diagnostics.
 */
async function render(afp) {
  const ws = createWorkspace();
  await ws.addFiles([createBufferSource(afp, 'qrimage.afp')], 'file');
  const model = await ws.getRenderModel(ws.listDocuments()[0].id, 1);
  return { items: model.items, diagnostics: ws.getDiagnostics() };
}

/** QR Code version 1 (21 modules) at the default 12 mils: LRqr in page units. */
const LR = 21 * 12 * 1.44;

test('the image fills 20 % of the symbol at 40 %/40 % (scale to fill), after the symbol', async () => {
  const { items } = await render(qrWithImage([imageBlock({})]));
  assert.deepEqual(items.map((i) => i.type), ['path', 'image']);
  const { rect } = items[1];
  for (const [got, want] of [[rect.x, 0.4 * LR], [rect.y, 0.4 * LR], [rect.width, 0.2 * LR], [rect.height, 0.2 * LR]]) {
    assert.ok(Math.abs(got - want) < 1e-6, `${got} ≈ ${want}`);
  }
});

test('turned by 90° about the image area origin; images first; L-unit offsets and extents', async () => {
  const block = imageBlock({ x: 60, y: 40, turn: 0x2d00 });
  const { items } = await render(qrWithImage([block], 0x80));
  assert.deepEqual(items.map((i) => i.type), ['image', 'path']);
  assert.equal(items[0].rotation, 90);
  assert.ok(Math.abs(items[0].rect.x - 0.6 * LR) < 1e-6);
  const inches = imageBlock({ offBase: 0x00, upub: 14400, x: 144, y: 0, extBase: 0x00, w: 288, h: 144 }); // 1/1440 inch
  const { items: second } = await render(qrWithImage([inches]));
  assert.ok(Math.abs(second[1].rect.x - 144) < 1e-6);
  assert.ok(Math.abs(second[1].rect.width - 288) < 1e-6);
});

test('only images, and an unmapped local ID is reported', async () => {
  const { items } = await render(qrWithImage([imageBlock({})], 0x40));
  assert.deepEqual(items.map((i) => i.type), ['image']);
  const { items: unmapped, diagnostics } = await render(qrWithImage([imageBlock({})], 0, false));
  assert.deepEqual(unmapped.map((i) => i.type), ['path', 'placeholder']);
  assert.ok(diagnostics.some((d) => /local ID 1 is not mapped/.test(d.params?.reason ?? '')));
});
