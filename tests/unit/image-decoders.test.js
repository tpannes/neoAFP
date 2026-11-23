/**
 * Image decoders and color conversion (T051): TIFF LZW and PackBits data written by libtiff from
 * a known bitmap; ABIC is not supported (research R6, T281) and must be reported; YCbCr against Pillow,
 * CIELab (D65) against the standard sRGB values, CMYK with the simple subtractive conversion of
 * the spec assumptions (no ICC color management).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeLzw } from '../../src/lib/ioca/decoders/lzw.js';
import { decodePackBits } from '../../src/lib/ioca/decoders/packbits.js';
import { toRgba, labPixel } from '../../src/lib/ioca/color.js';
import { decodePart } from '../../src/lib/ioca/ioca.js';
import { H, LZW, PACKBITS, YCBCR_REFERENCE, expectedBits } from '../helpers/codec-samples.js';

test('TIFF LZW and PackBits decode to the source bitmap', () => {
  assert.deepEqual([...decodeLzw(LZW, 12 * H)], [...expectedBits()]);
  assert.deepEqual([...decodePackBits(PACKBITS, 12 * H)], [...expectedBits()]);
});

test('ABIC is reported as not supported', () => {
  const part = { x: 0, y: 0, width: 8, height: 1, compression: 0x08, bitOrder: 0, ideSize: 1, bands: null, space: null, data: new Uint8Array(4), bandData: new Map(), mask: null };
  assert.match(decodePart(part).error, /ABIC not supported/);
});

const close = (actual, expected, tolerance, label) => actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= tolerance, `${label}: ${actual} vs ${expected}`));

test('YCbCr matches Pillow within one step', () => {
  for (const [ycc, rgb] of YCBCR_REFERENCE) {
    const out = toRgba({ width: 1, height: 1, space: 'ycbcr', planes: [Uint8Array.from(ycc)], interleaved: true });
    close([...out.subarray(0, 3)], rgb, 1, `YCbCr ${ycc}`);
    assert.equal(out[3], 255);
  }
});

test('CIELab (D65) gives the standard sRGB values', () => {
  close(labPixel(100, 0, 0), [255, 255, 255], 1, 'white');
  close(labPixel(0, 0, 0), [0, 0, 0], 1, 'black');
  close(labPixel(53.24, 80.09, 67.2), [255, 0, 0], 2, 'sRGB red');
  close(labPixel(32.3, 79.19, -107.86), [0, 0, 255], 2, 'sRGB blue');
});

test('CMYK uses the simple subtractive conversion', () => {
  const out = toRgba({ width: 3, height: 1, space: 'cmyk', planes: [Uint8Array.from([0, 255, 255, 0, 0, 0, 0, 255, 0, 0, 0, 128])], interleaved: true });
  assert.deepEqual([...out], [255, 0, 0, 255, 0, 0, 0, 255, 127, 127, 127, 255]);
});

test('IOCA band images with one JPEG per band are passed on as color planes', async () => {
  const { parseIoca } = await import('../../src/lib/ioca/ioca.js');
  // Begin Segment, Begin Image Content, Image Size (300 dpi, 4 × 2), Begin Tile, Image Encoding
  // (JPEG), IDE Size 32, Band Image (4 × 8 bits), IDE Structure (CMYK), four bands of image data
  // (each a JPEG start marker and a byte as stand-in), End Tile, End Image Content, End Segment.
  const jpeg = (n) => [0xff, 0xd8, n];
  const band = (n) => [0xfe, 0x9c, 0x00, 6, n, 0, 0, ...jpeg(n)];
  const seg = Uint8Array.from([0x70, 0x00, 0x91, 0x01, 0xff, 0x94, 0x09, 0x00, 0x0b, 0xb8, 0x0b, 0xb8, 0x00, 0x04, 0x00, 0x02,
    0x8c, 0x00, 0x95, 0x03, 0x83, 0x01, 0x00, 0x96, 0x01, 0x20, 0x98, 0x05, 0x04, 8, 8, 8, 8,
    0x9b, 0x09, 0x00, 0x04, 0, 0, 0, 8, 8, 8, 8, ...band(1), ...band(2), ...band(3), ...band(4), 0x8d, 0x00, 0x93, 0x00, 0x71, 0x00]);
  const [part] = parseIoca(seg).parts.map(decodePart);
  assert.equal(part.space, 'cmyk');
  assert.deepEqual(part.encodedPlanes.map((p) => [...p]), [jpeg(1), jpeg(2), jpeg(3), jpeg(4)]);
  assert.equal(part.encodedBytes, undefined);
});

test('IM image rows: padded to bytes as specified, rows without padding detected from the data', async () => {
  const { rowStride } = await import('../../src/lib/im/im-image.js');
  // A 13-pel wide cell, 60 rows, with two vertical bars and a diagonal; written once with rows
  // padded to 16 bits and once with rows of 13 bits one after the other.
  const width = 13;
  const height = 60;
  const ink = (x, y) => x === 2 || x === 9 || x === (y % width);
  const write = (stride) => {
    const out = new Uint8Array(Math.ceil((stride * height) / 8));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (ink(x, y)) { const i = y * stride + x; out[i >> 3] |= 0x80 >> (i & 7); }
    return out;
  };
  assert.equal(rowStride(write(16), width, height), 16);
  assert.equal(rowStride(write(13), width, height), 13);
  assert.equal(rowStride(write(16), 16, height), 16);
});
