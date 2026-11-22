/**
 * TIFF reader color spaces (src/lib/objcontainer/tiff.js): the color space comes from
 * PhotometricInterpretation, not from the number of samples. A CMYK TIFF (5, four samples)
 * keeps K: CMYK 0,0,0,0 is white, not black (bug: it was read as RGB + alpha, so white became
 * black). Palette images use their ColorMap. RGB with alpha drops the alpha; grayscale with alpha drops the alpha; WhiteIsZero
 * grayscale is inverted. Built from small uncompressed TIFFs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTiff } from '../../src/lib/objcontainer/tiff.js';

/**
 * Builds a little-endian, uncompressed TIFF of one strip.
 * @param {number} width Width in pels.
 * @param {number} height Height in pels.
 * @param {number} photometric PhotometricInterpretation.
 * @param {number} spp Samples per pel.
 * @param {number[]} samples Sample bytes, interleaved.
 * @returns {Uint8Array} TIFF bytes.
 */
function tiff(width, height, photometric, spp, samples, colorMap = null) {
  const tags = [[256, 3, width], [257, 3, height], [258, 3, 8], [259, 3, 1], [262, 3, photometric], [273, 4, 0], [277, 3, spp], [278, 3, height], [279, 4, samples.length]];
  if (colorMap) tags.push([320, 3, -1]);
  const ifdSize = 2 + tags.length * 12 + 4;
  const mapAt = 8 + ifdSize;
  const dataAt = mapAt + (colorMap ? colorMap.length * 2 : 0);
  const d = new Uint8Array(dataAt + samples.length);
  const v = new DataView(d.buffer);
  d.set([0x49, 0x49, 42, 0]);
  v.setUint32(4, 8, true);
  v.setUint16(8, tags.length, true);
  tags.forEach(([tag, type, value], i) => {
    const e = 10 + i * 12;
    v.setUint16(e, tag, true);
    v.setUint16(e + 2, type, true);
    v.setUint32(e + 4, tag === 320 ? colorMap.length : 1, true);
    if (tag === 320) v.setUint32(e + 8, mapAt, true);
    else if (type === 3) v.setUint16(e + 8, value, true); else v.setUint32(e + 8, tag === 273 ? dataAt : value, true);
  });
  colorMap?.forEach((c, i) => v.setUint16(mapAt + i * 2, c, true));
  d.set(samples, dataAt);
  return d;
}
const pels = (rgba) => [...rgba].reduce((out, v, i) => (i % 4 === 0 ? [...out, [v]] : (out.at(-1).push(v), out)), []);

test('CMYK keeps black as K: 0,0,0,0 is white', () => {
  const r = readTiff(tiff(3, 1, 5, 4, [0, 0, 0, 0, 0, 0, 0, 255, 0, 255, 255, 0]));
  assert.equal(r.error, null);
  assert.deepEqual(pels(r.rgba), [[255, 255, 255, 255], [0, 0, 0, 255], [255, 0, 0, 255]]);
});

test('RGB with alpha and grayscale with alpha drop the alpha; WhiteIsZero is inverted', () => {
  assert.deepEqual(pels(readTiff(tiff(1, 1, 2, 4, [10, 20, 30, 0])).rgba), [[10, 20, 30, 255]]);
  assert.deepEqual(pels(readTiff(tiff(2, 1, 1, 2, [200, 0, 50, 255])).rgba), [[200, 200, 200, 255], [50, 50, 50, 255]]);
  assert.deepEqual(pels(readTiff(tiff(1, 1, 0, 1, [0])).rgba), [[255, 255, 255, 255]]);
});

test('unsupported photometric interpretations fail with a reason instead of wrong colors', () => {
  assert.match(readTiff(tiff(1, 1, 8, 3, [0, 0, 0])).error, /PhotometricInterpretation 8/);
});

test('palette images use their ColorMap', () => {
  const map = new Array(768).fill(0);
  map[1] = 0xff00; // index 1: red
  map[256 + 2] = 0xff00; // index 2: green
  assert.deepEqual(pels(readTiff(tiff(3, 1, 3, 1, [0, 1, 2], map)).rgba), [[0, 0, 0, 255], [255, 0, 0, 255], [0, 255, 0, 255]]);
});
