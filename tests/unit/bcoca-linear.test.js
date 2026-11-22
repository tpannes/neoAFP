/**
 * Linear bar code symbologies (T071). Expected values come from the BCOCA Reference examples
 * (EAN-8 "2468 1230", EAN-13 "0 412345 678903", UPC-A "0 12345 67890 5", ITF-14
 * "15400141288763", Interleaved 2-of-5 "1234567895", Codabar HRI "34698735"), from GS1/AIM
 * published examples, or are worked out by hand in the comments. During development every
 * symbology was also compared element by element with BWIPP for several thousand random inputs
 * (Code 128 may pick a different but equally short code set sequence).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TABLES, code39, msi, retail, interleaved2of5, code2of5, codabar, code93, code128, code128Values, upcEDigits,
  mod10Upc, mod10Ibm, BarcodeDataError, FNC1,
} from '../../src/lib/bcoca/symbologies/linear.js';

const sum = (a) => a.reduce((x, y) => x + y, 0);
const hri = (s) => s.hri.map((h) => h.text).join(' ');

test('pattern tables have the structure their symbologies require', () => {
  const { C39, C93, CODABAR, C128, EAN_A, TWO_OF_FIVE } = TABLES;
  assert.equal(C39.length, 43);
  for (const p of C39) assert.equal([...p].filter((c) => c === 'w').length, 3, `Code 39 ${p}: 3 wide of 9`);
  assert.equal(new Set(C39).size, 43);
  assert.equal(C93.length, 47);
  for (const p of C93) assert.equal(sum([...p].map(Number)), 9, `Code 93 ${p}: 9 modules`);
  assert.equal(new Set(C93).size, 47);
  assert.equal(C128.length, 107);
  C128.forEach((p, v) => {
    const w = [...p].map(Number);
    assert.equal(sum(w), v === 106 ? 13 : 11, `Code 128 value ${v}: module count`);
    assert.equal(sum(w.filter((_, i) => i % 2 === 0)) % 2, 0, `Code 128 value ${v}: even bar modules`);
  });
  assert.equal(new Set(C128).size, 107);
  for (const p of CODABAR) assert.equal(p.length, 7);
  assert.equal(new Set(CODABAR).size, 20);
  // EAN set A: 7 modules, odd number of bar modules (bars are elements 2 and 4).
  for (const p of EAN_A) {
    const w = [...p].map(Number);
    assert.equal(sum(w), 7);
    assert.equal((w[1] + w[3]) % 2, 1);
  }
  for (const p of TWO_OF_FIVE) assert.equal([...p].filter((c) => c === 'w').length, 2);
});

test('UPC/EAN check digits and HRI match published examples', () => {
  assert.equal(mod10Upc('400638133393'), 1); // EAN-13 4006381333931 (GS1 example)
  assert.equal(mod10Upc('03600029145'), 2); // UPC-A 036000291452 (GS1 example)
  assert.equal(hri(retail(0x08, '2468123', 0)), '2468 1230');
  assert.equal(hri(retail(0x09, '041234567890', 0)), '0 412345 678903');
  assert.equal(hri(retail(0x03, '01234567890', 0)), '0 12345 67890 5');
  assert.equal(retail(0x09, '041234567890', 0).parts[0].elements.reduce((a, b) => a + b), 95);
  assert.equal(retail(0x08, '2468123', 0).parts[0].elements.reduce((a, b) => a + b), 67);
});

test('UPC-E zero suppression and parity', () => {
  // UPC-A 0 42100 00526 4 → UPC-E 425261 (manufacturer ends in 100, product starts with 00)
  assert.equal(upcEDigits('4210000526'), '425261');
  assert.equal(upcEDigits('1230000045'), '123453'); // manufacturer ends in 00, product 00045
  assert.equal(upcEDigits('1234000005'), '123454'); // manufacturer ends in 0, product 00005
  assert.equal(upcEDigits('1234500007'), '123457'); // product 0000 + 5..9
  assert.throws(() => upcEDigits('1234512345'), BarcodeDataError);
  const s = retail(0x05, '4210000526', 0);
  assert.equal(hri(s), '0 425261 4');
  assert.equal(sum(s.parts[0].elements), 51);
});

test('supplements follow the main symbol after a gap', () => {
  const s = retail(0x17, '04123456789054321', 0x01);
  assert.equal(s.parts.length, 2);
  assert.equal(s.parts[1].role, 'supplement');
  assert.equal(sum(s.parts[1].elements), 47); // 4 start + 5 × 7 + 4 × 2 separators
  assert.equal(sum(retail(0x16, '99', 0).parts[0].elements), 20);
});

test('Code 39 check character and asterisks', () => {
  // C=12 O=24 D=13 E=14 3=3 9=9 → 75 mod 43 = 32 → W
  assert.equal(hri(code39('CODE39', 0x02, { ratio: 2.5, asterisks: false })), 'CODE39W');
  assert.equal(hri(code39('AB', 0x01, { ratio: 3, asterisks: true })), '*AB*');
  assert.throws(() => code39('abc', 0x01, { ratio: 3, asterisks: false }), BarcodeDataError);
});

test('MSI check digits', () => {
  assert.equal(mod10Ibm('1234567'), 4); // worked example: 5+6+1+4+6+2+2 = 26 → 4
  const s = msi('1234567', 0x02, { ratio: 2 });
  // start (2) + 8 digits × 4 bits × 2 elements + stop (3)
  assert.equal(s.parts[0].elements.length, 2 + 8 * 8 + 3);
  assert.equal(hri(s), '1234567'); // check digits are not in the HRI (Table 19)
});

test('Interleaved 2-of-5 check digit, padding and Bearer Bars', () => {
  assert.equal(hri(interleaved2of5('1540014128876', 0x03, { ratio: 2.5 })), '15400141288763');
  assert.equal(interleaved2of5('1540014128876', 0x03, { ratio: 2.5 }).bearer, 'box');
  assert.equal(hri(interleaved2of5('123456789', 0x04, { ratio: 2.5 })), '1234567895');
  assert.equal(hri(interleaved2of5('123', 0x01, { ratio: 2.5 })), '0123');
});

test('Codabar HRI and check character', () => {
  assert.equal(hri(codabar('A34698735B', 0x01, { ratio: 2.5 })), '34698735');
  assert.throws(() => codabar('34698735', 0x01, { ratio: 2.5 }), BarcodeDataError);
});

test('Code 93 check characters', () => {
  // TEST93: C = 464 mod 47 = 41 ("+"), K = 617 mod 47 = 6 (worked out by hand)
  const s = code93('TEST93');
  // start (6) + 8 characters × 6 + stop (6) + termination bar (1)
  assert.equal(s.parts[0].elements.length, 6 + 8 * 6 + 6 + 1);
  const widths = s.parts[0].elements;
  const charAt = (k) => widths.slice(6 + k * 6, 12 + k * 6).join('');
  assert.equal(charAt(6), TABLES.C93[41]);
  assert.equal(charAt(7), TABLES.C93[6]);
});

test('Code 128 code set choice and GS1-128', () => {
  // GS1-128 example from the BCOCA Reference: FNC1 019061414100768715001230 → Start C, FNC1, pairs
  const ds = '019061414100768715001230';
  const values = code128Values([FNC1, ...[...ds].map((c) => c.charCodeAt(0))], true);
  assert.deepEqual(values, [105, 102, 1, 90, 61, 41, 41, 0, 76, 87, 15, 0, 12, 30]);
  // Mixed data: letters in set B, a long digit run in set C.
  const mixed = code128Values([...'AB123456'].map((c) => c.charCodeAt(0)), false);
  assert.deepEqual(mixed, [104, 33, 34, 99, 12, 34, 56]);
  // A control character selects set A.
  assert.equal(code128Values([0x09, 0x41], false)[0], 103);
  const s = code128([...'Wikipedia'].map((c) => c.charCodeAt(0)), 0x02);
  assert.equal(hri(s), 'Wikipedia');
  assert.throws(() => code128([0x41], 0x03), BarcodeDataError); // GS1 needs a leading FNC1
});

test('Industrial and Matrix 2-of-5 (BCOCA example 54321068)', () => {
  // Check digit: 3·(8+0+2+4) + (6+1+3+5) = 57 → 3. Element widths identical to BWIPP (wide = 3).
  const ind = code2of5('54321068', 0x02, { ratio: 3, matrix: false });
  assert.equal(hri(ind), '543210683');
  assert.equal(ind.parts[0].elements.join(''),
    '31311131113111111111311131313111111111311111313111111131111131311111313111113111113111313111111131113');
  const mat = code2of5('54321068', 0x02, { ratio: 3, matrix: true });
  assert.equal(mat.parts[0].elements.join(''), '31111131311111313133111113113131113111331113311131131133111131111');
  assert.equal(hri(code2of5('54321068', 0x01, { ratio: 3, matrix: true })), '54321068');
  assert.throws(() => code2of5('12A', 0x01, { ratio: 3, matrix: false }), BarcodeDataError);
});

test('GS1-128 HRI with application identifiers in parentheses (modifier X\'04\')', () => {
  const chars = (s) => [...s].map((c) => c.charCodeAt(0));
  assert.equal(hri(code128([FNC1, ...chars('019061414100768715001230')], 0x04)), '(01)90614141007687(15)001230');
  assert.equal(hri(code128([FNC1, ...chars('019061414100768715001230')], 0x03)), '019061414100768715001230');
  // A variable-length AI ends at FNC1.
  assert.equal(hri(code128([FNC1, ...chars('10ABC'), FNC1, ...chars('21XY')], 0x04)), '(10)ABC(21)XY');
});
