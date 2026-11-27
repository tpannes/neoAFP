/**
 * Image pixels for the color picker (render/image-pixel.js): read from the pixel data neoAFP
 * decodes itself, with the value in the image's own color space (IOCA Reference AFPC-0003: IDE
 * size 32 without IDE Structure is CMYK), bilevel pels set or not, transparency masks, tiles;
 * images the browser decodes (JPEG) give null.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePart } from '../../src/lib/ioca/ioca.js';
import { pixelOf } from '../../src/lib/render/image-pixel.js';

/**
 * An uncompressed IOCA image part.
 * @param {object} p Part fields (width, height, ideSize, data …).
 * @returns {object} Part as parseIoca gives it.
 */
const part = (p) => ({ x: 0, y: 0, compression: 0x03, bitOrder: 0, bands: null, space: null, bandData: new Map(), ...p });

test('CMYK pels give their CMYK values and the RGB drawn; samples only when asked for', () => {
  // Two pels: 100 % black only, and C 60 M 40 Y 40 K 100 (153 102 102 255).
  const p = part({ width: 2, height: 1, ideSize: 32, data: new Uint8Array([0, 0, 0, 255, 153, 102, 102, 255]) });
  assert.equal(decodePart(p).samples, undefined);
  const image = { width: 2, height: 1, parts: [decodePart(p, { samples: true })] };
  assert.deepEqual(pixelOf(image, 0.1, 0.5), { rgb: '#000000', spec: { space: 'CMYK', value: '0 0 0 100 %' } });
  assert.deepEqual(pixelOf(image, 0.9, 0.5), { rgb: '#000000', spec: { space: 'CMYK', value: '60 40 40 100 %' } });
});

test('RGB and gray pels, tiles placed at their offsets', () => {
  const rgb = decodePart(part({ width: 1, height: 1, ideSize: 24, data: new Uint8Array([16, 185, 129]) }), { samples: true });
  const gray = decodePart(part({ x: 1, width: 1, height: 1, ideSize: 8, data: new Uint8Array([96]) }), { samples: true });
  const image = { width: 2, height: 1, parts: [rgb, gray] };
  assert.deepEqual(pixelOf(image, 0.2, 0), { rgb: '#10b981', spec: { space: 'RGB', value: '16 185 129' } });
  assert.deepEqual(pixelOf(image, 0.7, 0), { rgb: '#606060', spec: { space: 'Gray', value: '96' } });
});

test('bilevel pels, transparency masks and JPEG parts', () => {
  // Row of 8 pels: X'A0' sets pels 0 and 2.
  const bilevel = { width: 8, height: 1, bilevel: { rowBytes: 1, bits: new Uint8Array([0xa0]) } };
  assert.deepEqual([0, 1, 2].map((x) => pixelOf(bilevel, (x + 0.5) / 8, 0).ink), [true, false, true]);
  const masked = decodePart(part({ width: 2, height: 1, ideSize: 8, data: new Uint8Array([10, 20]) }), { samples: true });
  masked.mask = { width: 2, height: 1, rowBytes: 1, bits: new Uint8Array([0x80]) };
  const image = { width: 2, height: 1, parts: [masked] };
  assert.equal(pixelOf(image, 0.1, 0).spec.value, '10');
  assert.deepEqual(pixelOf(image, 0.9, 0), { ink: false });
  assert.equal(pixelOf({ width: 1, height: 1, parts: [{ x: 0, y: 0, width: 1, height: 1, encodedBytes: new Uint8Array(4) }] }, 0, 0), null);
});
