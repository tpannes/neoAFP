/**
 * Postal bar codes (T072). Expected values: the four Intelligent Mail Barcode examples of
 * USPS-B-3200 (the fourth is also the BCOCA example "01 234 567094 987654321 01234567891"), the
 * POSTNET digit patterns and check digit, the Royal Mail example "SN34RD1A" with check character
 * K, and the bar counts / widths of BCOCA Table 12. The Japan Postal and Australia Post reference
 * bar strings (including the BCOCA example "56439111ABA 9") are identical to BWIPP's; all postal
 * types were compared bar by bar with BWIPP for several hundred random inputs during development.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { postnet, rm4scc, intelligentMail, japanPost, ausPost, mailmark, POSTAL_GEOMETRY } from '../../src/lib/bcoca/symbologies/postal.js';
import { BarcodeDataError } from '../../src/lib/bcoca/symbologies/linear.js';
import { bytes, field, uint, ebcdic, documentOf, page, group, triplet } from '../helpers/afp-builder.js';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';

test('Intelligent Mail Barcode matches the USPS-B-3200 examples', () => {
  const examples = [
    ['01234567094987654321', 0x00, 'ATTFATTDTTADTAATTDTDTATTDAFDDFADFDFTFFFFFTATFAAAATDFFTDAADFTFDTDT'],
    ['0123456709498765432101234', 0x01, 'DTTAFADDTTFTDTFTFDTDDADADAFADFATDDFTAAAFDTTADFAAATDFDTDFADDDTDFFT'],
    ['01234567094987654321012345678', 0x02, 'ADFTTAFDTTTTFATTADTAAATFTFTATDAAAFDDADATATDTDTTDFDTDATADADTDFFTFA'],
    ['0123456709498765432101234567891', 0x03, 'AADTFFDFTDADTAADAATFDTDDAAADDTDTTDAFADADDDTFFFDDTTTADFAAADFTDAADA'],
  ];
  for (const [data, modifier, bars] of examples) assert.equal(intelligentMail(data, modifier).bars, bars, data);
  assert.equal(intelligentMail('0123456709498765432101234567891', 0x03).hri, '01 234 567094 987654321 01234567891');
  assert.throws(() => intelligentMail('0123456709498765432101234', 0x00), BarcodeDataError); // 25 digits, modifier 0
  assert.throws(() => intelligentMail('05234567094987654321', 0x00), BarcodeDataError); // second digit > 4
});

test('POSTNET and PLANET', () => {
  // 1+2+3+4+5 = 15 → check digit 5; patterns 1 = 00011 … 5 = 01010 between frame bars.
  assert.equal(postnet('12345', 0x00).bars, 'F' + 'SSSFF SSFSF SSFFS SFSSF SFSFS SFSFS'.replace(/ /g, '') + 'F');
  assert.equal(postnet('123456789', 0x01).bars.length, 52);
  assert.equal(postnet('12345678901', 0x02).bars.length, 62);
  const planet = postnet('00123456789', 0x04);
  assert.equal(planet.kind, 'planet');
  assert.equal(planet.bars.slice(1, 6), 'SSFFF'); // PLANET inverts POSTNET (0 = 11000 → 00111)
  assert.throws(() => postnet('1234', 0x00), BarcodeDataError);
  // Optimal ZIP symbol: 32 bars at 22 per inch, 20 mils wide = 1.429 in (Table 12).
  const g = POSTAL_GEOMETRY.postnet;
  assert.ok(Math.abs(31 * g.pitch + g.bar - 1.429) < 0.001);
});

test('RM4SCC and Dutch KIX', () => {
  const s = rm4scc('SN34RD1A', 0x00);
  // Start bar (ascender), 8 characters, check character K, stop bar (full).
  assert.equal(s.bars.length, 2 + 9 * 4);
  assert.equal(s.bars.slice(-5, -1), rm4scc('K', 0x01).bars);
  assert.equal(s.bars[0], 'A');
  assert.equal(s.bars.at(-1), 'F');
  assert.equal(rm4scc('0', 0x01).bars, 'TTFF');
  assert.equal(rm4scc('1', 0x01).bars, 'TDAF');
  // KIX: no start, stop or check; 8 characters = 32 bars = 36.30 mm (Table 12).
  const kix = rm4scc('2500GG30', 0x01);
  assert.equal(kix.bars.length, 32);
  const g = POSTAL_GEOMETRY.kix;
  assert.ok(Math.abs((31 * g.pitch + g.bar) * 25.4 - 36.30) < 0.05);
  assert.throws(() => rm4scc('AB-1', 0x00), BarcodeDataError);
});

test('a postal bar code object is drawn at the fixed bar pitch, with IMb HRI', async () => {
  const bsd = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2), uint(0xffff, 2), uint(0xffff, 2), uint(0, 2),
    0x22, 0x03, 0xff, uint(0xff07, 2), 0xff, uint(0xffff, 2), 1, uint(0xffff, 2));
  const obd = bytes(triplet(0x43, 0x01), triplet(0x4b, 0x00, 0x00, uint(14400, 2), uint(14400, 2)), triplet(0x4c, 0x02, uint(5000, 3), uint(1000, 3)));
  const obp = bytes(0x01, 23, uint(1440, 3), uint(2880, 3), uint(0, 2), uint(0x2d00, 2), 0x00, uint(0, 3), uint(0, 3), uint(0, 2), uint(0x2d00, 2), 0x00);
  const obj = group('D3A8EB', 'BC000001', group('D3A8C7', 'OEG00001', field('D3A66B', obd), field('D3AC6B', obp), field('D3A6EB', bsd)),
    field('D3EEEB', bytes(0x00, uint(0, 2), uint(0, 2), ebcdic('0123456709498765432101234567891'))));
  const ws = createWorkspace();
  await ws.addFiles([createBufferSource(documentOf('DOC00001', page('PAGE0001', obj)), 'imb.afp')], 'file');
  const model = await ws.getRenderModel(ws.listDocuments()[0].id, 1);
  const path = model.items.find((i) => i.type === 'path');
  const moves = path.commands.filter((c) => c[0] === 'M');
  assert.equal(moves.length, 65);
  assert.deepEqual(moves[0], ['M', 1440, 2880]); // first bar 'A' starts at the top
  assert.ok(Math.abs(moves[1][1] - moves[0][1] - 1440 / 22) < 1e-9);
  const ys = path.commands.filter((c) => c[0] !== 'Z').map((c) => c[2]);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 0.145 * 1440) < 1e-9);
  assert.equal(model.items.find((i) => i.type === 'glyphRun').text, '01 234 567094 987654321 01234567891');
});

test('Japan Postal Bar Code', () => {
  // BCOCA example: postal code 154-0023, address 3-16-4, filled with CC4.
  assert.equal(japanPost('154-0023-3-16-4', null, 0x00).bars,
    'FDFFTFTFFADFTTFTTFDADFADFATFTFFTDAFTFTFADTDATDATDATDATDATDATDAFTFDF');
  // The hyphens of the postal code and the one after it are ignored; later hyphens are digits.
  assert.equal(japanPost('15400233-16-4', null, 0x00).bars, japanPost('154-0023-3-16-4', null, 0x00).bars);
  // Start (2) + 20 characters + check + stop (2) bars; letters take a control code and a digit;
  // more than 13 address digits are cut off.
  const s = japanPost('1000001-A1B2C3D4E5F6G7', null, 0x00);
  assert.equal(s.bars.length, 2 + 21 * 3 + 2);
  assert.equal(s.bars, japanPost('1000001A1B2C3D4E', null, 0x00).bars.slice(0, -5) + s.bars.slice(-5));
  // Direct input (modifier X'01'): EBCDIC code points of Table 15, no check digit added.
  const direct = japanPost('', Uint8Array.from([0x4c, 0xf1, 0x60, 0x5a, 0x6e]), 0x01);
  // start 31, "1" 330, hyphen 030, CC1 120, stop 13 (0 timing, 1 lower, 2 upper, 3 full)
  assert.equal(direct.bars, 'FD' + 'FFT' + 'TFT' + 'DAT' + 'DF');
  assert.throws(() => japanPost('', Uint8Array.from([0xc1]), 0x01), BarcodeDataError);
  assert.throws(() => japanPost('12-34', null, 0x00), BarcodeDataError);
});

test('Australia Post Bar Code', () => {
  // BCOCA example: Customer Barcode 2, table C, sorting code 56439111, customer information "ABA 9".
  const s = ausPost('56439111ABA 9', 0x03);
  assert.equal(s.bars, 'ATADTFADDFAAAFTFFAFAFAFFFFFAFFFFFTTDDTTAFADAFFFTTAAT');
  assert.equal(s.hri, '59 56439111 ABA 9');
  assert.equal(s.hriAbove, true);
  assert.equal(ausPost('39987520', 0x01).bars, 'ATFAFAAFTFTFDDDAADFDFFTTFDADATAFTFDAT');
  assert.deepEqual([0x01, 0x02, 0x05, 0x08].map((m) => ausPost('39987520', m).bars.length), [37, 52, 67, 37]);
  // Proprietary encoding: the digits 0–3 are the bars themselves (0 full, 1 ascender, 2 descender, 3 tracker).
  assert.equal(ausPost('399875200123', 0x04).bars.slice(22, 26), 'FADT');
  assert.throws(() => ausPost('39987520123456789', 0x02), BarcodeDataError); // 9 digits > 8
  assert.throws(() => ausPost('3998752', 0x01), BarcodeDataError);
  const g = POSTAL_GEOMETRY.auspost;
  assert.ok(Math.abs((36 * g.pitch + g.bar) * 25.4 - 39.60) < 0.25, 'standard symbol ≈ 39.60 mm (Table 12)');
});

test('Royal Mail Mailmark 4-state (T290): the Royal Mail examples and Zint test vectors', () => {
  // Examples 1 and 2 of the Royal Mail barcode C and L encoding instructions (Example 2 of C is
  // the symbol shown in the BCOCA Reference), and Zint's postcode-type vectors.
  const vectors = [
    ['1100000000000XY11     ', 0, 'TTDTTATTDTAATTDTAATTDTAATTDTTDDAATAADDATAATDDFAFTDDTAADDDTAAFDFAFF'],
    ['21B2254800659JW5O9QA6Y', 0, 'DAATATTTADTAATTFADDDDTTFTFDDDDFFDFDAFTADDTFFTDDATADTTFATTDAFDTFDDA'],
    ['11000000000000000XY11    ', 1, 'TTDTTATDDTTATTDTAATTDTAATDDTTATTDTTDATFTAATDDTAATDDTATATFAADDAATAATDDTAADFTFTA'],
    ['41038422416563762EF61AH8T', 1, 'DTTFATTDDTATTTATFTDFFFTFDFDAFTTTADTTFDTFDDDTDFDDFTFAADTFDTDTDTFAATAFDDTAATTDTT'],
    ['1234567890123C1I2JQ3N ', 0, 'TTDTDFTFDTAAFFDATAATFDDTATTTFDFTDTTFDFTTTFAAFFTDTADDATDDDTFFATFFAF'],
    ['2345678901234KM12JQ3N ', 0, 'TDTFAFADDATATATTAAFAFTFTDADFDTDAAADFFDTTDDTDDFATDDTFDATFDFTFFFDFTA'],
    ['34A6789012345OV123JQ4U', 0, 'TDTTATADDATDADADATTAFATDAADAFTTTAAFDATFAFDDFDATFDTADDTFFAAFDDTTAAD'],
    ['44E9999999999CI1K3JQ4U', 0, 'DADTFDATFAFAFFAADTDFTTAAFFAFFDFATFTFDDAAFDFDDFAFDTDTDDATTDATTAFDAD'],
    ['0418070504030C12JQ3U  ', 0, 'FTAFFDAFTDDFTDTAFAADDDTADFTFAFFFATAAATFTDDDATFATFTTFTFFATADTDAAFTA'],
    ['02D7543219876C123JQ4U ', 0, 'AFTFAFATFDDFFDTTDDFAFDFDAFFTFAAFTTDATDFATATFTDFTFTTTFFTTATDATFDFTA'],
    ['42944444444444444CI1K3JQ4U', 1, 'FTDDTTTTFAFFTATFTTFTDTFTFAADADTAFDADDTFDFDAFDFTTAFATFDFDTTFATFDFDAAAFTFTDFFTAF'],
  ];
  for (const [text, modifier, bars] of vectors) assert.equal(mailmark(text, modifier).bars, bars, text);
  assert.equal(mailmark('1100000000000XY11', 0).bars, vectors[0][2], 'padded with spaces');
  for (const [text, modifier] of [['5100000000000XY11     ', 0], ['1100000000000XY1!     ', 0], ['1100000000000XY11     ', 2], ['110000000', 0]]) {
    assert.throws(() => mailmark(text, modifier), BarcodeDataError, text);
  }
});

test('a Mailmark object uses the BCOCA symbol size', async () => {
  const bsd = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2), uint(0xffff, 2), uint(0xffff, 2), uint(0, 2),
    0x25, 0x00, 0xff, uint(0xff07, 2), 0xff, uint(0xffff, 2), 1, uint(0xffff, 2));
  const obj = group('D3A8EB', 'BC000001', group('D3A8C7', 'OEG00001', field('D3A6EB', bsd)),
    field('D3EEEB', bytes(0x80, uint(0, 2), uint(0, 2), ebcdic('21B2254800659JW5O9QA6Y'))));
  const ws = createWorkspace();
  await ws.addFiles([createBufferSource(documentOf('DOC00001', page('PAGE0001', obj)), 'mailmark.afp')], 'file');
  const model = await ws.getRenderModel(ws.listDocuments()[0].id, 1);
  const pts = model.items.find((i) => i.type === 'path').commands.filter((c) => c[0] !== 'Z');
  const xs = pts.map((c) => c[1]);
  const ys = pts.map((c) => c[2]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - (79.08 / 25.4) * 1440) < 1e-6, 'Barcode C is 79.08 mm wide');
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - (5.10 / 25.4) * 1440) < 1e-6, 'and 5.10 mm high');
  assert.equal(model.items.filter((i) => i.type === 'glyphRun').length, 0, 'no HRI');
});
