/**
 * QR Code (T074) and Data Matrix ECC 200 (T073). Expected values come from published examples
 * (ISO/IEC 18004 Annex I "01234567" version 1-M, the Data Matrix "123456" example), from the
 * capacity tables of the standards, or are structural rules of the symbologies. The two reference
 * matrices were read back with an independent decoder (zxing-cpp) when they were recorded; the
 * full set of sizes, levels, masks and encodation schemes was checked the same way.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rsEncode, QR_RS, DATA_MATRIX_RS } from '../../src/lib/bcoca/symbologies/reed-solomon.js';
import { qrCode, qrDataCodewords, dataCapacity } from '../../src/lib/bcoca/symbologies/qrcode.js';
import { dataMatrix, DATA_MATRIX_SIZES } from '../../src/lib/bcoca/symbologies/datamatrix.js';
import { BarcodeDataError } from '../../src/lib/bcoca/symbologies/linear.js';
import { eciSegments } from '../../src/lib/bcoca/bcoca.js';

const seg = (s, eci = null) => ({ eci, bytes: Uint8Array.from([...s].map((c) => c.charCodeAt(0))) });
const rows = (s) => Array.from({ length: s.rows }, (_, r) => Array.from(s.modules.subarray(r * s.cols, (r + 1) * s.cols)).join(''));

test('Reed–Solomon codewords match the published examples', () => {
  // ISO/IEC 18004 Annex I: "01234567", version 1-M.
  const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsEncode(data, 10, QR_RS), [165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
  // Data Matrix "123456": digit pairs 142 164 186.
  assert.deepEqual(rsEncode([142, 164, 186], 5, DATA_MATRIX_RS), [114, 25, 5, 88, 102]);
});

test('QR Code data codewords and capacities', () => {
  assert.deepEqual(qrDataCodewords([seg('01234567')], {}, 1, 1), [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17]);
  assert.deepEqual([0, 1, 2, 3].map((l) => dataCapacity(1, l)), [19, 16, 13, 9]);
  assert.deepEqual([0, 1, 2, 3].map((l) => dataCapacity(40, l)), [2956, 2334, 1666, 1276]);
});

test('QR Code reference symbol (HELLO WORLD, level Q)', () => {
  const q = qrCode([seg('HELLO WORLD')], { level: 2 });
  assert.equal(q.version, 1);
  assert.deepEqual(rows(q), [
    '111111101100001111111', '100000101001001000001', '101110101001101011101', '101110101000001011101',
    '101110101010001011101', '100000100010001000001', '111111101010101111111', '000000001000000000000',
    '011010110000101011111', '010000001111000010001', '001101110110001011000', '011011010011010101110',
    '100010101011101110101', '000000001101001000101', '111111101010000101100', '100000100101101101000',
    '101110101010001111111', '101110100101010100010', '101110101001011101001', '100000101011110001011',
    '111111100001011100001',
  ]);
});

test('QR Code format information names the level and mask', () => {
  for (const level of [0, 1, 2, 3]) {
    const q = qrCode([seg('FORMAT')], { level, version: 3 });
    const at = (x, y) => q.modules[y * q.rows + x];
    // First copy: (8, 0..5), (8, 7), (8, 8), (7, 8), (5..0, 8) carry bits 0..14.
    const cells = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
    const bits = cells.reduce((v, [x, y], i) => v | (at(x, y) << i), 0) ^ 0x5412;
    assert.equal(bits >> 13, [1, 0, 3, 2][level]);
    assert.equal((bits >> 10) & 7, q.mask);
    assert.equal(q.rows, 29);
  }
});

test('QR Code version choice and too much data', () => {
  const long = seg('X'.repeat(30));
  assert.equal(qrCode([long], { level: 0 }).version, 2); // 30 bytes > 17 of version 1-L
  assert.equal(qrCode([long], { level: 0, version: 1 }).version, 2);
  assert.throws(() => qrCode([long], { level: 0, version: 1, strict: true }), (e) => e instanceof BarcodeDataError && e.exception === 'EC-0F16');
  assert.equal(qrCode([seg('A')], { version: 5 }).rows, 37);
});

test('Data Matrix size table is consistent', () => {
  assert.equal(DATA_MATRIX_SIZES.length, 24 + 6 + 18);
  for (const s of DATA_MATRIX_SIZES) {
    const regions = Math.round(s.rows / (s.rh + 2)) * Math.round(s.cols / (s.rw + 2));
    assert.equal(Math.floor((regions * s.rh * s.rw) / 8), s.data + s.ecc, `${s.rows}x${s.cols}`);
    assert.equal(s.ecc % s.blocks, 0);
  }
});

test('Data Matrix reference symbol (123456) and finder pattern', () => {
  const d = dataMatrix([seg('123456')]);
  assert.deepEqual(rows(d), [
    '1010101010', '1100101101', '1100000100', '1100011101', '1100001000',
    '1000001111', '1110110000', '1111011001', '1001110100', '1111111111',
  ]);
  const big = dataMatrix([seg('A'.repeat(100))], { scheme: 1 }); // ASCII: 100 codewords
  assert.equal(big.rows, 40);
  const at = (r, c) => big.modules[r * big.cols + c];
  for (let k = 0; k < 40; k++) {
    assert.equal(at(k, 0), 1, 'solid left edge');
    assert.equal(at(39, k), 1, 'solid bottom edge');
    assert.equal(at(0, k), k % 2 === 0 ? 1 : 0, 'alternating top edge');
  }
});

test('Data Matrix size requests, DMRE and errors', () => {
  assert.deepEqual([dataMatrix([seg('ABC')], { rows: 8, cols: 32 })].map((d) => [d.rows, d.cols])[0], [8, 32]);
  assert.throws(() => dataMatrix([seg('ABC')], { rows: 8, cols: 48 }), (e) => e.exception === 'EC-0F00'); // DMRE only with X'01'
  assert.equal(dataMatrix([seg('ABC')], { rows: 8, cols: 48, dmre: true }).cols, 48);
  const text = seg('THIS DOES NOT FIT INTO A SMALL SYMBOL');
  assert.throws(() => dataMatrix([text], { rows: 10, cols: 10, strict: true }), (e) => e.exception === 'EC-0F20');
  assert.ok(dataMatrix([text], { rows: 10, cols: 10 }).rows > 10);
  assert.throws(() => dataMatrix([seg('abc')], { scheme: 4 }), (e) => e.exception === 'EC-1201'); // X12: no lower case
});

test('Data Matrix encodation schemes', () => {
  const upper = seg('ABCDEFGHIJKLMNOPQRSTUVWX'); // 24 letters
  assert.equal(dataMatrix([upper], { scheme: 1 }).rows, 22); // ASCII: 24 codewords → 22x22
  assert.equal(dataMatrix([upper], { scheme: 2 }).rows, 18); // C40: latch + 16 → 18x18
  assert.equal(dataMatrix([upper]).rows, 18); // automatic: the shortest scheme
});

test('ECI escape sequences', () => {
  const b = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
  assert.deepEqual(eciSegments(b('A\\\\B'), true).map((s) => [s.eci, [...s.bytes]]), [[null, [0x41, 0x5c, 0x42]]]);
  assert.deepEqual(eciSegments(b('\\000026AB'), true).map((s) => [s.eci, s.bytes.length]), [[26, 2]]);
  assert.deepEqual(eciSegments(b('A\\000026B'), true).map((s) => s.eci), [null, 26]);
  assert.equal(eciSegments(b('A\\B'), false)[0].bytes.length, 3);
  assert.throws(() => eciSegments(b('A\\12'), true), BarcodeDataError);
});
