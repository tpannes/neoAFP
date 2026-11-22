/**
 * TIFF writer (T197, FR-099, FR-056): header, image file directory, resolution, and the
 * Deflate strip decompressing to RGB pixels on white.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { encodeTiff, rgbOnWhite } from '../../src/lib/export/tiff.js';

/**
 * Reads the directory entries of a little-endian TIFF.
 * @param {Uint8Array} bytes File.
 * @returns {Map<number, {type: number, count: number, value: number}>} Tag → entry.
 */
function directory(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset);
  const at = v.getUint32(4, true);
  const out = new Map();
  for (let i = 0; i < v.getUint16(at, true); i++) {
    const e = at + 2 + i * 12;
    const type = v.getUint16(e + 2, true);
    const count = v.getUint32(e + 4, true);
    out.set(v.getUint16(e, true), { type, count, value: type === 3 && count === 1 ? v.getUint16(e + 8, true) : v.getUint32(e + 8, true) });
  }
  return out;
}

test('a 2 × 1 image: red and a transparent pixel (white), 300 dpi', async () => {
  const tiff = await encodeTiff({ width: 2, height: 1, rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0]), dpi: 300 });
  assert.deepEqual([...tiff.subarray(0, 4)], [0x49, 0x49, 42, 0]);
  const d = directory(tiff);
  assert.equal(d.get(256).value, 2);
  assert.equal(d.get(257).value, 1);
  assert.equal(d.get(259).value, 8);
  assert.equal(d.get(262).value, 2);
  assert.equal(d.get(277).value, 3);
  const v = new DataView(tiff.buffer);
  assert.equal(v.getUint32(d.get(282).value, true) / v.getUint32(d.get(282).value + 4, true), 300);
  const strip = tiff.subarray(d.get(273).value, d.get(273).value + d.get(279).value);
  assert.deepEqual([...inflateSync(strip)], [255, 0, 0, 255, 255, 255]);
});

test('half transparent pixels are mixed with white', () => {
  assert.deepEqual([...rgbOnWhite(new Uint8Array([0, 0, 0, 128]))], [127, 127, 127]);
});
