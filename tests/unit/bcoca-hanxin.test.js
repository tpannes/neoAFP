/**
 * Han Xin Code (T291). The vectors are Zint's test_hanxin.c encodings (there checked against ISO/IEC
 * 20830:2021 Figure 1 and Annex K, the AIM ITS/04-023:2022 ECI examples and zxing-cpp); a mask is
 * given where Zint was told one, otherwise the penalty evaluation picks it. GB 18030 data either
 * comes with ECI 000029/000032 or is marked as GB 18030 (`gb18030`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hanXin } from '../../src/lib/bcoca/symbologies/hanxin.js';
import { BarcodeDataError } from '../../src/lib/bcoca/symbologies/linear.js';
import { bytes, field, uint, ebcdic, documentOf, page, group } from '../helpers/afp-builder.js';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';

/** Expected modules as hex of "1" followed by the module bits, row by row. */
const VECTORS = [
  { comment: 'Mode nnnn, mask 10', eci: null, gb18030: false, data: '31323334', version: 0, level: 4, mask: null, size: 23,
    modules: '3fd59fe00080df777da05e0b5cedd6b853ad773750080002b70015b16e91892577f88e93812094fc8003da8002e01fdbdd409a3afd5a750a9c0bd5cdf7abf00f5097f' },
  { comment: 'ISO 20830 Figure 1 same', eci: null, gb18030: false, data: '48616e78696e20436f64652073796d626f6c', version: 0, level: 2, mask: null, size: 25,
    modules: '3fd6d7f803d80df72df682ca0b5c6975ae76bad7549d40354002ca28068f9459951dae0037f80c3126d8f24ed1aff8e99922e022a68001f807f125d40b3cebf532750aa482f5725f7aa0803d5897f' },
  { comment: 'ISO 20830 K.2 Figure K.8 (& K.5) same (mask 01)', eci: null, gb18030: false, data: '31323334353637383930', version: 1, level: 1, mask: null, size: 23,
    modules: '3fc41fe03180df157da0ee0b5c85d6bb53ad718750076002a530137d5755552d52f5555555520d50f0194a800d001fcf1d4095bafd54750aca0bd511f7ab580f5147f' },
  { comment: 'ISO 20830 Figure 4, explicit mask 10, same except no alternating filler', eci: null, gb18030: true, data: 'babad0c5c2ebb1ead7bc', version: 0, level: 3, mask: 2, size: 23,
    modules: '3fd0dfe02b80df5c7da0560b5c79d6b85bad77975006a002b770007e7ba661716c0abdfe3ed815c8481ffa800a001fd6dd40bf3afd10750ad80bd4bdf7aa980f5497f' },
  { comment: 'Mask automatic (01)', eci: null, gb18030: true, data: 'c3a9', version: 0, level: 4, mask: null, size: 23,
    modules: '3fd15fe00a00df747da0940b5c7dd6bb4bad73a7500aa002b69002d21d512552b5562d50b5527c6140103a800a601fc41d40b0bafd62750a420bd4a5f7a8900f5557f' },
  { comment: 'AIM ITS/04-023:2022 ECI 3 Example 2 same', eci: 3, gb18030: false, data: '70726963653aa332302e3030', version: 0, level: 2, mask: null, size: 23,
    modules: '3fcd5fe01480df247da09a0b5c69d6bb5bad7047500d4002ad40164d514989caef0ac58c9c196bfae8052a8004e01fc71d40bcbafd12750ac60bd471f7ab400f5547f' },
  { comment: 'AIM ITS/04-023:2022 ECI 26 Example 3 same', eci: 26, gb18030: false, data: 'ebb094ecbd94eb939c', version: 0, level: 2, mask: null, size: 23,
    modules: '3fdedfe02300df017da0ca0b5df1d6ba73ad77375009e002a3a004e0e123621b3883c3a6507f2bea580b2a8008601fdd5d4094bafd29750abe0bd569f7a9a80f5757f' },
  { comment: 'AIM ITS/04-023:2022 ECI 30 Example 2 same with FULL_MULTIBYTE', eci: 30, gb18030: true, data: 'bcadbfef', version: 0, level: 2, mask: null, size: 23,
    modules: '3fcd5fe01180df147da0ee0b5c11d6bb5bad7107500c8002a540177d53d7caafc2d7d5524557e55140054a8005a01fc49d40a5bafd16750af60bd4d1f7ab500f5547f' },
  { comment: 'AIM ITS/04-023:2022 ECI 32 Example 5 same', eci: 32, gb18030: false, data: 'a5d0a960a5b3a960a5c9', version: 0, level: 2, mask: null, size: 23,
    modules: '3fdedfe02c00df017da0e20b5da1d6ba73ad7717500c6002a3a002e8e0761c3acb76a20511f576ca280bea800ca01fd55d409cbafd25750a920bd5a9f7a8580f5757f' },
  { comment: 'AIM ITS/04-023:2022 ECI 32 Example 6 same', eci: 32, gb18030: false, data: '8330f1318334e5398239b633', version: 0, level: 2, mask: null, size: 23,
    modules: '3fdedfe02f00df017da0e20b5db1d6ba73ad773750092002a3a00728e7957a376af99aa1591cb32e780a8a800e601fd35d408dbafd1b750ac60bd5d1f7a9a80f5757f' },
  { comment: 'AIM ITS/04-023:2022 ECI 25 Example 1 same', eci: 25, gb18030: false, data: '67617801', version: 0, level: 2, mask: null, size: 23,
    modules: '3fcd5fe01180df147da0f20b5c71d6bb5bad71e7500fc002a540172552a62d6a42d1fd57bd566d54d0054a8005a01fc91d40a5bafd16750af60bd4d1f7ab500f5547f' },
  { comment: 'AIM ITS/04-023:2022 ECI 899 Example 1 same', eci: 899, gb18030: false, data: '0001025b5c5dfdfeff', version: 0, level: 2, mask: null, size: 23,
    modules: '3fcddfe01680df2c7da0da0b5cd1d6bb5bad716750098002a540155557139552f5130dc173877a420806ea8002e01fc81d40bbbafd28750a920bd429f7aa200f5547f' },
  { comment: 'AIM ITS/04-023:2022 ECI 7 Example 2 same', eci: 7, gb18030: false, data: 'bcdeddd3dedbe3dbe1', version: 0, level: 2, mask: null, size: 23,
    modules: '3fcd5fe01580df147da0ca0b5c61d6bb5bad7147500d4002a540173d526292e51a21a9a1aae3b3ae30052a8003a01fc51d40a8bafd28750ac60bd491f7abd00f5547f' },
];

test('Han Xin Code: ISO/IEC 20830 and AIM ECI examples', () => {
  for (const v of VECTORS) {
    const segment = { eci: v.eci, bytes: Uint8Array.from(Buffer.from(v.data, 'hex')), gb18030: v.gb18030 };
    const sym = hanXin([segment], { version: v.version, level: v.level, mask: v.mask ?? undefined });
    assert.equal(sym.rows, v.size, v.comment);
    assert.equal(BigInt('0b1' + Array.from(sym.modules).join('')).toString(16), v.modules, v.comment);
  }
});

test('Han Xin Code: version, level and too much data', () => {
  const seg = [{ eci: null, bytes: Uint8Array.from(Buffer.from('AFP Consortium')) }];
  assert.equal(hanXin(seg).rows, 23);
  assert.equal(hanXin(seg, { version: 5 }).rows, 31, 'a larger version is padded');
  const long = [{ eci: null, bytes: new Uint8Array(200).fill(0x41) }];
  assert.ok(hanXin(long, { version: 2 }).rows > 25, 'too much data: a bigger symbol');
  assert.throws(() => hanXin(long, { version: 2, strict: true }), (e) => e instanceof BarcodeDataError && e.exception === 'EC-0F21');
  assert.throws(() => hanXin(seg, { level: 5 }), (e) => e.exception === 'EC-0F23');
  assert.throws(() => hanXin(seg, { version: 85 }), (e) => e.exception === 'EC-0F22');
});

/**
 * Builds a Han Xin Code object.
 * @param {number[]} special Special-function parameters (BSA bytes 5–11).
 * @param {Uint8Array} data Data.
 * @returns {Uint8Array} Object.
 */
function hanXinObject(special, data) {
  const bsd = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2), uint(0xffff, 2), uint(0xffff, 2), uint(0, 2),
    0x27, 0x00, 0xff, uint(0xff07, 2), 0xff, uint(0xffff, 2), 1, uint(0xffff, 2));
  return group('D3A8EB', 'BC000001', group('D3A8C7', 'OEG00001', field('D3A6EB', bsd)),
    field('D3EEEB', bytes(0x00, uint(0, 2), uint(0, 2), bytes(...special), data)));
}

test('a Han Xin Code object: EBCDIC data, 12-mil modules; FNC1 data types are reported', async () => {
  const ws = createWorkspace();
  const doc = documentOf('DOC00001', page('PAGE0001', hanXinObject([0x80, 0, 0, 1, 0, 0, 0], ebcdic('AFP Consortium'))),
    page('PAGE0002', hanXinObject([0x80, 0, 0, 1, 0x80, 0, 0], ebcdic('0112345678901231'))));
  await ws.addFiles([createBufferSource(doc, 'hanxin.afp')], 'file');
  const id = ws.listDocuments()[0].id;
  const model = await ws.getRenderModel(id, 1);
  const pts = model.items.find((i) => i.type === 'path').commands.filter((c) => c[0] !== 'Z');
  const xs = pts.map((p) => p[1]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 23 * 12 * 1.44) < 1e-6, '23 modules of 12 mils');
  const second = await ws.getRenderModel(id, 2);
  assert.equal(second.items[0].type, 'placeholder');
  assert.ok(ws.getDiagnostics().some((d) => /Han Xin Code with a GS1 or industry FNC1/.test(d.params?.reason ?? '')));
});
