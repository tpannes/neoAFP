/**
 * Color model of resources for the Resource-Explorer's RGB/CMYK filter (FR-053): read from
 * IOCA image segments (IDE Structure, IDE Size, Band Image), JPEG frame headers, PNG color
 * types, GIF, TIFF PhotometricInterpretation and ICC profile headers. Built from small
 * hand-made headers whose meaning is known.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iocaColorModel, imageColorModel, iccColorModel } from '../../src/lib/resources/color-model.js';

/** An IOCA image segment: Begin Segment, the given self-defining fields, End Segment. */
const ioca = (...fields) => Uint8Array.from([0x70, 0x00, ...fields.flat(), 0x71, 0x00]);
const IDE_SIZE = (n) => [0x96, 0x01, n];
const IDE_STRUCTURE = (format) => [0x9b, 0x02, 0x00, format];
const BANDS = (n) => [0x98, n + 1, n, ...Array(n).fill(8)];

test('IOCA: IDE Structure names the color space; else IDE Size or the number of bands', () => {
  assert.equal(iocaColorModel(ioca(IDE_SIZE(24), IDE_STRUCTURE(0x01))), 'rgb');
  assert.equal(iocaColorModel(ioca(IDE_SIZE(32), IDE_STRUCTURE(0x04))), 'cmyk');
  assert.equal(iocaColorModel(ioca(IDE_STRUCTURE(0x12))), 'rgb'); // YCbCr
  assert.equal(iocaColorModel(ioca(IDE_STRUCTURE(0x08))), null); // CIELAB
  assert.equal(iocaColorModel(ioca(IDE_SIZE(32))), 'cmyk');
  assert.equal(iocaColorModel(ioca(IDE_SIZE(24))), 'rgb');
  assert.equal(iocaColorModel(ioca(BANDS(4))), 'cmyk');
  assert.equal(iocaColorModel(ioca(IDE_SIZE(1))), null); // black and white
  assert.equal(iocaColorModel(ioca(IDE_SIZE(8))), null); // grayscale
});

test('JPEG by its component count, PNG by color type, GIF always RGB', () => {
  const jpeg = (components) => Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, components, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0]);
  assert.equal(imageColorModel(jpeg(3), 'jpeg'), 'rgb');
  assert.equal(imageColorModel(jpeg(4), 'jpeg'), 'cmyk');
  assert.equal(imageColorModel(jpeg(1), 'jpeg'), null);
  const png = (colorType) => { const d = new Uint8Array(33); d[25] = colorType; return d; };
  assert.equal(imageColorModel(png(2), 'png'), 'rgb');
  assert.equal(imageColorModel(png(3), 'png'), 'rgb');
  assert.equal(imageColorModel(png(0), 'png'), null);
  assert.equal(imageColorModel(new Uint8Array(10), 'gif'), 'rgb');
  assert.equal(imageColorModel(new Uint8Array(10), 'pdf'), null);
});

test('TIFF by PhotometricInterpretation, in either byte order', () => {
  const tiff = (photometric, little) => {
    const d = new Uint8Array(8 + 2 + 12 + 4);
    const v = new DataView(d.buffer);
    d.set(little ? [0x49, 0x49, 42, 0] : [0x4d, 0x4d, 0, 42]);
    v.setUint32(4, 8, little);
    v.setUint16(8, 1, little);
    v.setUint16(10, 262, little);
    v.setUint16(12, 3, little);
    v.setUint32(14, 1, little);
    v.setUint16(18, photometric, little);
    return d;
  };
  assert.equal(imageColorModel(tiff(2, true), 'tiff'), 'rgb');
  assert.equal(imageColorModel(tiff(5, false), 'tiff'), 'cmyk');
  assert.equal(imageColorModel(tiff(1, true), 'tiff'), null);
});

test('ICC profiles by their data color space', () => {
  assert.equal(iccColorModel('RGB'), 'rgb');
  assert.equal(iccColorModel('CMYK'), 'cmyk');
  assert.equal(iccColorModel('GRAY'), null);
  assert.equal(iccColorModel(null), null);
});
