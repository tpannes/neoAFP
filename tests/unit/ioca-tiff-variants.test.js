/**
 * IOCA compressions TIFF algorithm 2 (X'09') and TIFF LZW with Differencing Predictor (X'0E')
 * (IOCA Reference AFPC-0003-09, "Compression Algorithms"; TIFF 6.0 section 14), and readable names
 * for the codes that stay unsupported (OS/2 Image Support X'0B').
 *
 * TIFF algorithm 2 is G3 MH with every row starting on a byte boundary and no end-of-line codes;
 * the sample is coded here from the T.4 code tables: row 1 white 8 ('10011'), row 2 white 4
 * ('1011') and black 4 ('011'). The predictor sample is LZW-coded literally (clear code, one
 * 9-bit code per byte, end code), which every LZW decoder reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePart, undoPredictor, COMPRESSIONS } from '../../src/lib/ioca/ioca.js';

/**
 * Codes bytes as LZW with 9-bit literal codes only (clear code first, end code last).
 * @param {number[]} values Bytes.
 * @returns {Uint8Array} LZW data.
 */
function lzwLiteral(values) {
  const codes = [256, ...values, 257];
  const bits = codes.map((c) => c.toString(2).padStart(9, '0')).join('');
  const out = new Uint8Array(Math.ceil(bits.length / 8));
  for (let i = 0; i < bits.length; i++) if (bits[i] === '1') out[i >> 3] |= 0x80 >> (i & 7);
  return out;
}

test('TIFF algorithm 2: G3 MH rows on byte boundaries without end-of-line codes', () => {
  const data = Uint8Array.of(0b10011000, 0b10110110);
  const out = decodePart({ compression: 0x09, ideSize: 1, width: 8, height: 2, x: 0, y: 0, data });
  assert.equal(out.error, null);
  assert.deepEqual([...out.bilevel.bits], [0x00, 0x0f]);
});

test('the differencing predictor adds each sample to the same component on its left', () => {
  // RGB, two pixels per row: (10, 20, 30) (13, 25, 37); differences (10, 20, 30) (3, 5, 7).
  assert.deepEqual([...undoPredictor(Uint8Array.of(10, 20, 30, 3, 5, 7, 250, 0, 1, 10, 0, 0), 2, 2, 3)],
    [10, 20, 30, 13, 25, 37, 250, 0, 1, 4, 0, 1], 'modulo 256, each row on its own');
});

test('TIFF LZW with Differencing Predictor: interleaved RGB', () => {
  const diffs = [255, 0, 0, 1, 1, 1, 0, 0, 255, 0, 255, 0];
  const out = decodePart({ compression: 0x0e, ideSize: 24, width: 2, height: 2, x: 0, y: 0, data: lzwLiteral(diffs) });
  assert.equal(out.error, null);
  assert.deepEqual([...out.rgba], [255, 0, 0, 255, 0, 1, 1, 255, 0, 0, 255, 255, 0, 255, 255, 255]);
});

test('TIFF LZW with Differencing Predictor: one band per component', () => {
  const band = (values) => [lzwLiteral(values)];
  const p = { compression: 0x0e, ideSize: 24, width: 2, height: 1, x: 0, y: 0, bands: [8, 8, 8],
    bandData: new Map([[1, band([100, 10])], [2, band([50, 5])], [3, band([0, 0])]]) };
  const out = decodePart(p);
  assert.equal(out.error, null);
  assert.deepEqual([...out.rgba], [100, 50, 0, 255, 110, 55, 0, 255]);
});

test('the predictor is not defined for bilevel images; unsupported codes have names', () => {
  const out = decodePart({ compression: 0x0e, ideSize: 1, width: 8, height: 1, x: 0, y: 0, data: lzwLiteral([0]) });
  assert.match(out.error, /not defined for bilevel/);
  assert.equal(COMPRESSIONS[0x0b], 'OS/2 Image Support');
  assert.equal(COMPRESSIONS[0x09], 'TIFF algorithm 2');
  assert.equal(COMPRESSIONS[0x0e], 'TIFF LZW with predictor');
});
