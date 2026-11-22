/**
 * PNG resolution (FR-056/FR-059 exports): withPngDpi adds a pHYs chunk right after IHDR with
 * pixels per meter for the given dpi and a valid CRC; the rest of the file is unchanged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { withPngDpi } from '../../src/viewer/download.js';

test('pHYs chunk after IHDR with the resolution and a valid CRC', () => {
  // Signature, IHDR (13 bytes of data) and IEND; enough structure for the insertion.
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 1, 2, 3, 4];
  const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
  const png = new Uint8Array([...sig, ...ihdr, ...iend]);
  const out = withPngDpi(png, 300);
  assert.equal(out.length, png.length + 21);
  assert.deepEqual([...out.subarray(0, 33)], [...png.subarray(0, 33)]);
  const view = new DataView(out.buffer, 33, 21);
  assert.equal(view.getUint32(0), 9);
  assert.equal(String.fromCharCode(...out.subarray(37, 41)), 'pHYs');
  assert.equal(view.getUint32(8), 11811); // 300 dpi = 11811 pixels per meter
  assert.equal(view.getUint32(12), 11811);
  assert.equal(out[49], 1);
  assert.equal(view.getUint32(17), crc32(out.subarray(37, 50)));
  assert.deepEqual([...out.subarray(54)], iend);
});
