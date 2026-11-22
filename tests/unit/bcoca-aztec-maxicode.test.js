/**
 * Aztec Code and MaxiCode (T076). The Aztec reference symbol was read back with an independent
 * decoder (zxing-cpp), together with all compact and full-range layer counts, error correction
 * levels, binary data, GS1, ECI, structured append, reader initialization and runes. The MaxiCode
 * reference symbol is module for module identical to BWIPP's; several hundred random messages in
 * modes 4–6 and structured carrier messages in modes 2/3 were compared the same way.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aztec, AZTEC_FNC1 } from '../../src/lib/bcoca/symbologies/aztec.js';
import { maxiCode } from '../../src/lib/bcoca/symbologies/maxicode.js';
import { BarcodeDataError } from '../../src/lib/bcoca/symbologies/linear.js';
import { bytes, field, uint, ebcdic, documentOf, page, group, triplet } from '../helpers/afp-builder.js';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';

const b = (s) => [...Buffer.from(s, 'latin1')];
const rows = (s) => Array.from({ length: s.rows }, (_, r) => Array.from(s.modules.subarray(r * s.cols, (r + 1) * s.cols)).join(''));

test('Aztec reference symbol (BCOCA example "AFP Consortium", compact)', () => {
  const s = aztec(b('AFP Consortium'), { format: 'compact' });
  assert.equal(s.layers, 2);
  assert.deepEqual(rows(s), [
    '0001111100101011110', '0111001111101110001', '0011011101110110011', '0100000111000111100',
    '1100110100110011001', '1011111111111110010', '0011010000000101001', '1000110111110110100',
    '0011110100010111101', '0110010101010100001', '0001010100010101100', '1000010111110100011',
    '0100010000000100101', '1100011111111111110', '0011001111100001011', '1011100000010000001',
    '0001011000010110111', '0110100010100000000', '0111001000111111111',
  ]);
});

test('Aztec symbol sizes, formats and bull\'s eye', () => {
  assert.equal(aztec(b('A'), { format: 'compact' }).rows, 15);
  assert.equal(aztec(b('A'), { format: 'full' }).rows, 19);
  assert.equal(aztec(b('A'), { format: 'full', layers: 32 }).rows, 151); // 14 + 4·32 + 1 + 2·4 grid lines
  assert.equal(aztec(b('A'), { format: 'any' }).compact, true);
  const rune = aztec([123], { format: 'rune' });
  assert.equal(rune.rows, 11);
  // Bull's eye of a full-range symbol: dark rings at distance 0, 2, 4, 6 from the center.
  const f = aztec(b('BULLS EYE'), { format: 'full', layers: 5 });
  const c = (f.rows - 1) / 2;
  for (let d = 0; d <= 6; d++) assert.equal(f.modules[c * f.rows + c + d], d % 2 === 0 ? 1 : 0, `distance ${d}`);
});

test('Aztec options and errors', () => {
  const long = b('X'.repeat(200));
  assert.ok(aztec(long, { format: 'full', layers: 2 }).layers > 2);
  assert.throws(() => aztec(long, { format: 'full', layers: 2, strict: true }), (e) => e.exception === 'EC-0F17');
  assert.throws(() => aztec(b('X'.repeat(200)), { format: 'compact' }), (e) => e instanceof BarcodeDataError && e.exception === 'EC-0C00');
  assert.equal(aztec(b('INIT'), { format: 'compact', readerInit: true }).layers, 1);
  // Higher error correction needs more layers.
  const t = b('ERROR CORRECTION LEVEL TEST 1234567890');
  assert.ok(aztec(t, { format: 'full', ecPercent: 90 }).layers > aztec(t, { format: 'full', ecPercent: 5 }).layers);
  assert.ok(aztec([AZTEC_FNC1, ...b('0104012345123456')], {}).rows >= 15);
});

test('MaxiCode reference symbol (mode 4) and modes', () => {
  const s = maxiCode(b('HELLO WORLD 123'), { mode: 4 });
  let hex = '';
  for (let i = 0; i < s.modules.length; i += 4) {
    hex += ((s.modules[i] << 3) | (s.modules[i + 1] << 2) | ((s.modules[i + 2] ?? 0) << 1) | (s.modules[i + 3] ?? 0)).toString(16);
  }
  assert.equal(hex, '07f5555f8000000027aaaa555555540000000aaaaaaa8555555580000002aaaaaaad56c44540018940aa900faa5480295c0400702aa4006a9540035600800806ac002a856c011580a00700aa2002a9568015400a3480aabd1fa8555551c400000b6aaaaa11c4136ebcbd19a4e3f37e9285e12c95a2070fd41109dc1c');
  assert.equal(s.rows, 33);
  assert.equal(s.cols, 30);
  const carrier = maxiCode(b('[)>\x1e01\x1d96152382802\x1d840\x1d001\x1d1Z00004951\x1dUPSN\x1e\x04'), { mode: 2 });
  assert.equal(carrier.modules.length, 990);
  assert.throws(() => maxiCode(b('NO SEPARATORS'), { mode: 2 }), BarcodeDataError);
  assert.throws(() => maxiCode(b('ABC123\x1d840\x1d001\x1d'), { mode: 2 }), BarcodeDataError); // letters in a mode 2 postal code
  assert.throws(() => maxiCode(b('A'.repeat(100)), { mode: 5 }), BarcodeDataError);
  assert.throws(() => maxiCode(b('A'), { mode: 7 }), (e) => e.exception === 'EC-0F05');
});

/**
 * Renders one bar code object (unit base 10 inches, 1440 units per inch).
 * @param {number} type Bar code type.
 * @param {number} modifier Modifier.
 * @param {Uint8Array} special Special-function parameters.
 * @param {Uint8Array} data Data.
 * @returns {Promise<object>} Render model.
 */
async function render(type, modifier, special, data) {
  const bsd = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2), uint(0xffff, 2), uint(0xffff, 2), uint(0, 2),
    type, modifier, 0xff, uint(0xff07, 2), 0xff, uint(0xffff, 2), 1, uint(0xffff, 2));
  const obd = bytes(triplet(0x43, 0x01), triplet(0x4b, 0x00, 0x00, uint(14400, 2), uint(14400, 2)), triplet(0x4c, 0x02, uint(4000, 3), uint(4000, 3)));
  const obp = bytes(0x01, 23, uint(1440, 3), uint(1440, 3), uint(0, 2), uint(0x2d00, 2), 0x00, uint(0, 3), uint(0, 3), uint(0, 2), uint(0x2d00, 2), 0x00);
  const obj = group('D3A8EB', 'BC000001', group('D3A8C7', 'OEG00001', field('D3A66B', obd), field('D3AC6B', obp), field('D3A6EB', bsd)),
    field('D3EEEB', bytes(0x00, uint(0, 2), uint(0, 2), special, data)));
  const ws = createWorkspace();
  await ws.addFiles([createBufferSource(documentOf('DOC00001', page('PAGE0001', obj)), 'x.afp')], 'file');
  return ws.getRenderModel(ws.listDocuments()[0].id, 1);
}

const extent = (item) => {
  const pts = item.commands.filter((c) => c[0] !== 'Z');
  const xs = pts.map((c) => c[1]);
  const ys = pts.map((c) => c[2]);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};

test('an Aztec object: special functions with a structured append ID, default module width', async () => {
  // Table 21: EBCDIC, reserved, smallest, default EC, no flags, AI, sequence 1 of 2, ID "AB", no additional parameters.
  const special = bytes(0x80, 0x00, 0xff, 0xff, 0x00, 0x00, 1, 2, 2, ebcdic('AB'), 0x00);
  const model = await render(0x26, 0x01, special, ebcdic('AFP Consortium'));
  const [w, h] = extent(model.items.find((i) => i.type === 'path'));
  const modules = Math.round(w / (14 * 1.44));
  assert.ok(modules === 15 || modules === 19, `compact symbol, ${modules} modules of 14 mils`);
  assert.ok(Math.abs(w - h) < 1e-6);
});

test('a MaxiCode object has the fixed size of BCOCA Table 12', async () => {
  const model = await render(0x1d, 0x00, bytes(0x00, 4, 0, 0, 0), ebcdic('HELLO'));
  const commands = model.items.find((i) => i.type === 'path').commands;
  // The finder rings are the subpaths with 72 points; the outermost has a radius of 4.3814
  // module widths, and a module is 25.5 mm / 30.5 wide.
  const subpaths = [];
  for (const c of commands) if (c[0] === 'M') subpaths.push([c]); else if (c[0] === 'L') subpaths.at(-1).push(c);
  const rings = subpaths.filter((sp) => sp.length === 72);
  assert.equal(rings.length, 6);
  const xs = rings.flat().map((c) => c[1]);
  const W = (25.5 / 25.4) * 1440 / 30.5;
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 2 * 4.3814 * W) < 1e-6);
  // Ring center at 14.5 module widths from the left edge of the symbol (area at 1440).
  assert.ok(Math.abs((Math.max(...xs) + Math.min(...xs)) / 2 - 1440 - 14.5 * W) < 1e-6);
});
