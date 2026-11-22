/**
 * CCITT decoding (T050): Group 3 1D (MH), Group 3 2D (MR) and Group 4 (MMR) data written by
 * libtiff from a known 96 × 40 bitmap decode bit for bit to that bitmap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeCcitt } from '../../src/lib/ioca/decoders/ccitt.js';
import { W, H, G3_1D, G3_2D, G4, expectedBits } from '../helpers/codec-samples.js';

for (const [name, data, scheme] of [['G3 1D (MH)', G3_1D, 'G3-1D'], ['G3 2D (MR)', G3_2D, 'G3-2D'], ['G4 (MMR)', G4, 'G4']]) {
  test(`${name} decodes to the source bitmap`, () => {
    const r = decodeCcitt(data, W, H, scheme);
    assert.equal(r.error, null);
    assert.equal(r.rowsDecoded, H);
    assert.deepEqual([...r.bits], [...expectedBits()]);
  });
}

test('truncated G4 data reports an error and keeps the rows decoded so far', () => {
  const r = decodeCcitt(G4.subarray(0, 400), W, H, 'G4');
  assert.ok(r.error);
  assert.ok(r.rowsDecoded > 0 && r.rowsDecoded < H);
  const rows = r.rowsDecoded * 12;
  assert.deepEqual([...r.bits.subarray(0, rows)], [...expectedBits().subarray(0, rows)]);
});

test('IBM MMR (IOCA X\'01\'): first row 1D after EOL + 1, then 2D rows without EOLs, EOP at the end', () => {
  // Hand-coded from the IOCA Reference ("IBM MMR-Modified Modified Read": K infinite, EOLs only
  // when switching to 2D and in the EOP) and the ITU-T T.4 code tables, 16 × 3 pels:
  // row 0 (1D): white 4 '1011', black 8 '000101', white 4 '1011';
  // row 1 (2D): V0 V0 V0 '111' (same as row 0);
  // row 2 (2D): pass '0001', V0 '1' (all white);
  // end of page: six times EOL + 1.
  const EOL = '000000000001';
  const bits = `${EOL}1` + '1011' + '000101' + '1011' + '111' + '0001' + '1' + `${EOL}1`.repeat(6);
  const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, '0');
  const data = Uint8Array.from(padded.match(/.{8}/g), (b) => Number.parseInt(b, 2));
  const r = decodeCcitt(data, 16, 3, 'IBM-MMR');
  assert.equal(r.error, null);
  assert.deepEqual([...r.bits], [0x0f, 0xf0, 0x0f, 0xf0, 0x00, 0x00]);
});

/**
 * Packs a bit string into bytes (padded with zeros).
 * @param {string} bits Bits.
 * @returns {Uint8Array} Bytes.
 */
const pack = (bits) => Uint8Array.from(bits.padEnd(Math.ceil(bits.length / 8) * 8, '0').match(/.{8}/g), (b) => Number.parseInt(b, 2));
const EOL = '000000000001';

test('an end of line code inside a row (with extra fill zeros) ends that row', () => {
  // Pattern as written by IBM MMR encoders for transparency masks, 12 × 3 pels:
  // row 0 (1D): white 0 '00110101', black 12 '0000111';
  // row 1 (2D): V0 '1', then fill zeros and EOL + 0 (2D follows): the row ends, still black;
  // row 2 (2D): V0 V0 '11'.
  const data = pack(`${EOL}1` + '00110101' + '0000111' + '1' + `00${EOL}0` + '11' + `${EOL}1`.repeat(6));
  const r = decodeCcitt(data, 12, 3, 'IBM-MMR');
  assert.equal(r.error, null);
  assert.deepEqual([...r.bits], [0xff, 0xf0, 0xff, 0xf0, 0xff, 0xf0]);
});

test('rows coded up to the byte boundary (12 pels coded as 16) are decoded at the padded width', () => {
  // row 0 (1D): white 4 '1011', black 12 '0000111' (ends at 16);
  // row 1 (2D): V0 V0 '11';
  // row 2 (2D): horizontal '001', white 2 '0111', black 14 '00000111' (ends at 16).
  const data = pack(`${EOL}1` + '1011' + '0000111' + '11' + '001' + '0111' + '00000111' + `${EOL}1`.repeat(6));
  const r = decodeCcitt(data, 12, 3, 'IBM-MMR');
  assert.equal(r.error, null);
  assert.deepEqual([...r.bits], [0x0f, 0xf0, 0x0f, 0xf0, 0x3f, 0xf0]);
});

test('rows coded at the exact width are not decoded at the padded width', () => {
  // row 0 (1D): white 4 '1011', black 8 '000101' (ends at 12); row 1 (2D): V0 V0 '11'.
  const data = pack(`${EOL}1` + '1011' + '000101' + '11' + `${EOL}1`.repeat(6));
  const r = decodeCcitt(data, 12, 2, 'IBM-MMR');
  assert.equal(r.error, null);
  assert.deepEqual([...r.bits], [0x0f, 0xf0, 0x0f, 0xf0]);
});
