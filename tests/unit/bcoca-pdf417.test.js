/**
 * PDF417 (T075). The pattern table is checked against the structural rules of ISO/IEC 15438
 * (17 modules, 4 bars and 4 spaces of 1–6 modules, cluster number from the bar widths); the
 * error correction against its defining property; the text compaction of "PDF417" against the
 * well-known codewords 453 178 121 239. The full set of levels, column counts and compaction
 * modes was read back with an independent decoder (zxing-cpp) during development.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDF417_PATTERNS } from '../../src/lib/bcoca/symbologies/pdf417-patterns.js';
import { pdf417, pdf417Tokens, pdf417DataCodewords, pdf417Ecc, macroControlBlock } from '../../src/lib/bcoca/symbologies/pdf417.js';
import { BarcodeDataError } from '../../src/lib/bcoca/symbologies/linear.js';
import { bytes, field, uint, ebcdic, documentOf, page, group, triplet } from '../helpers/afp-builder.js';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';

const b = (s) => Uint8Array.from(Buffer.from(s, 'latin1'));

test('pattern table follows the PDF417 codeword structure', () => {
  assert.equal(PDF417_PATTERNS.length, 3);
  PDF417_PATTERNS.forEach((cluster, k) => {
    assert.equal(cluster.length, 929);
    assert.equal(new Set(cluster).size, 929);
    for (const v of cluster) {
      const bits = v.toString(2);
      assert.equal(bits.length, 17);
      const runs = bits.match(/1+|0+/g).map((r) => r.length);
      assert.equal(runs.length, 8, 'four bars and four spaces');
      assert.ok(runs.every((w) => w <= 6));
      assert.equal(bits[0], '1');
      assert.equal((runs[0] - runs[2] + runs[4] - runs[6] + 9) % 9, 3 * k, 'cluster number');
    }
  });
});

test('text compaction of "PDF417" and compaction modes', () => {
  assert.deepEqual(pdf417DataCodewords(pdf417Tokens(b('PDF417'), true)), [453, 178, 121, 239]);
  const numeric = pdf417DataCodewords(pdf417Tokens(b('1234567890123'), true));
  assert.equal(numeric[0], 902);
  const bin = pdf417DataCodewords(pdf417Tokens(b('\x80\x81\x82\x83\x84\x85'), true));
  assert.equal(bin[0], 924);
  assert.equal(bin.length, 6);
  // Escape sequences insert codewords; "\\" is a backslash.
  assert.deepEqual(pdf417Tokens(b('\\927\\026A\\\\'), true), [{ cw: 927 }, { cw: 26 }, { bytes: [0x41, 0x5c] }]);
  assert.throws(() => pdf417Tokens(b('A\\928'), true), BarcodeDataError);
  assert.throws(() => pdf417Tokens(b('A\\921'), true), BarcodeDataError);
});

test('error correction makes the codeword polynomial vanish at 3^1 … 3^k', () => {
  const data = [8, 453, 178, 121, 239, 900, 900, 900];
  for (const level of [0, 1, 2, 5]) {
    const ecc = pdf417Ecc(data, level);
    const all = [...data, ...ecc];
    const k = ecc.length;
    for (let i = 1, root = 3; i <= k; i++, root = (root * 3) % 929) {
      const v = all.reduce((acc, c) => (acc * root + c) % 929, 0);
      assert.equal(v, 0, `level ${level}, root 3^${i}`);
    }
  }
});

test('rows, row indicators, start and stop patterns', () => {
  const s = pdf417(pdf417Tokens(b('PDF417'), true), { cols: 2, level: 1 });
  // 1 length descriptor + 4 data + 4 EC = 9 codewords → 5 rows of 2.
  assert.equal(s.rows, 5);
  assert.equal(s.cols, 17 * 5 + 18);
  for (let r = 0; r < s.rows; r++) {
    const row = Array.from(s.modules.subarray(r * s.cols, (r + 1) * s.cols)).join('');
    assert.equal(row.slice(0, 17), '11111111010101000');
    assert.equal(row.slice(-18), '111111101000101001');
  }
  const t = pdf417(pdf417Tokens(b('PDF417'), true), { cols: 2, level: 1, truncated: true });
  assert.equal(t.cols, 17 * 4 + 1);
  assert.equal(pdf417(pdf417Tokens(b('A'), true), { cols: 3, rows: 20 }).rows, 20);
  assert.throws(() => pdf417(pdf417Tokens(b('A'), true), { cols: 31 }), (e) => e.exception === 'EC-0F06');
  assert.throws(() => pdf417(pdf417Tokens(b('A'.repeat(2000)), true), { cols: 2, level: 8 }), (e) => e.exception === 'EC-0F08');
});

test('a PDF417 object: special functions, module width and row height', async () => {
  const bsd = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2), uint(0xffff, 2), uint(0xffff, 2), uint(0, 2),
    0x1e, 0x00, 0xff, uint(0xff07, 2), 10, uint(60, 2), 1, uint(0xffff, 2));
  const obd = bytes(triplet(0x43, 0x01), triplet(0x4b, 0x00, 0x00, uint(14400, 2), uint(14400, 2)), triplet(0x4c, 0x02, uint(8000, 3), uint(4000, 3)));
  const obp = bytes(0x01, 23, uint(1440, 3), uint(2880, 3), uint(0, 2), uint(0x2d00, 2), 0x00, uint(0, 3), uint(0, 3), uint(0, 2), uint(0x2d00, 2), 0x00);
  // Table 30: EBCDIC, 2 data columns, minimum rows, security level 1, no macro.
  const special = bytes(0x80, 2, 0xff, 1, uint(0, 2));
  const obj = group('D3A8EB', 'BC000001', group('D3A8C7', 'OEG00001', field('D3A66B', obd), field('D3AC6B', obp), field('D3A6EB', bsd)),
    field('D3EEEB', bytes(0x00, uint(0, 2), uint(0, 2), special, ebcdic('PDF417'))));
  const ws = createWorkspace();
  await ws.addFiles([createBufferSource(documentOf('DOC00001', page('PAGE0001', obj)), 'pdf417.afp')], 'file');
  const model = await ws.getRenderModel(ws.listDocuments()[0].id, 1);
  const pts = model.items.find((i) => i.type === 'path').commands.filter((c) => c[0] !== 'Z');
  const xs = pts.map((c) => c[1]);
  const ys = pts.map((c) => c[2]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 103 * 14.4) < 1e-6, '103 modules of 10 mils');
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 5 * 60) < 1e-6, '5 rows of 60 L-units');
});

test('Macro PDF417 Control Block (T287): codewords as in ISO/IEC 15438 Annex H', () => {
  // Segment 1 of 2 with file ID 001 002 — the same codewords Zint writes for structured append
  // (index − 1 and count each as "1" + five digits in base 900).
  assert.deepEqual(macroControlBlock(b('\\928' + '1' + '\\001\\002' + '\\923\\001' + '2')), [928, 111, 100, 1, 2, 923, 1, 111, 102]);
  // Last segment, a file name in text compaction ("AB" = 0·30 + 1) and a time stamp.
  assert.deepEqual(macroControlBlock(b('\\9282\\017\\923\\000AB\\923\\002123\\922')), [928, 111, 101, 17, 923, 0, 1, 923, 2, 1, 223, 922]);
  assert.deepEqual(macroControlBlock(b('\\922')), [922]);
  for (const bad of ['1\\001', '\\928\\001', '\\928' + '1x', '\\928' + '1\\923\\009', '\\928' + '1\\950']) {
    assert.throws(() => macroControlBlock(b(bad)), (e) => e instanceof BarcodeDataError && e.exception === 'EC-0F0D', bad);
  }
});

test('Macro PDF417: the control block follows the padding and is counted in the length', () => {
  const macro = macroControlBlock(b('\\9281\\001'));
  const sym = pdf417(pdf417Tokens(b('PDF417'), true), { cols: 5, level: 0, macro });
  const plain = pdf417(pdf417Tokens(b('PDF417'), true), { cols: 5, level: 0 });
  assert.equal(sym.rows, plain.rows);
  assert.notDeepEqual(sym.modules, plain.modules);
});
