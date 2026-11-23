/**
 * IOCA RL4 (Run Length 4, compression X'06'; IOCA Reference AFPC-0003-09, Table 27; task T306).
 * The samples are coded here from the table: a line is a 2-byte line number, a 2-byte length,
 * runs alternating white and black (first white), and an end-of-line code to the byte boundary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeRl4 } from '../../src/lib/ioca/decoders/rl4.js';
import { decodePart } from '../../src/lib/ioca/ioca.js';

/**
 * Joins hex strings into bytes.
 * @param {...string} parts Hex.
 * @returns {Uint8Array} Bytes.
 */
const hex = (...parts) => Uint8Array.from(parts.join('').match(/../g).map((h) => parseInt(h, 16)));

test('4-bit and 8-bit runs, a line that starts black, both end-of-line codes, a skipped line', () => {
  const data = hex(
    '0001', '0002', '24', 'ff', // line 1: white 3 (0010), black 5 (0100), EOL 8 bits; rest white
    '0002', '0003', '00', '0f', 'ff', // line 2: white 1, black 1, white 1 (0000 ×3), EOL 12 bits
    // line 3 left out: all white
    '0004', '0003', 'fe', '81', 'ff', // line 4: white 0 (1111 1110), black 10 (10 000001), EOL
  );
  const r = decodeRl4(data, 16, 4);
  assert.equal(r.error, null);
  assert.deepEqual([...r.bits], [0x1f, 0x00, 0x40, 0x00, 0x00, 0x00, 0xff, 0xc0]);
});

test('12-bit and 16-bit runs; line numbers counting from 0', () => {
  // Line 0: white 100 (110 0 0001 1011), black 600 (1110 0000 0000 1111), EOL 8 + 4 bits.
  const r = decodeRl4(hex('0000', '0005', 'c1be00ffff'), 800, 1);
  assert.equal(r.error, null);
  const black = [...r.bits].flatMap((b) => [...b.toString(2).padStart(8, '0')]).map(Number);
  assert.equal(black.indexOf(1), 100);
  assert.equal(black.lastIndexOf(1), 699);
  assert.equal(black.filter(Boolean).length, 600);
});

test('20-bit runs', () => {
  // White 4681 + 2 (1111 0 000 0000 0000 0010), black 1 (0000), EOL 8 bits: F0 00 20 FF.
  const r = decodeRl4(hex('0001', '0004', 'f00020ff'), 4700, 1);
  assert.equal(r.error, null);
  const black = [...r.bits].flatMap((b) => [...b.toString(2).padStart(8, '0')]).map(Number);
  assert.equal(black.indexOf(1), 4683);
  assert.equal(black.filter(Boolean).length, 1);
});

test('an IOCA image with RL4 is decoded', () => {
  const out = decodePart({ compression: 0x06, ideSize: 1, width: 16, height: 1, x: 0, y: 0, data: hex('0001', '0002', '24', 'ff') });
  assert.equal(out.error, null);
  assert.deepEqual([...out.bilevel.bits], [0x1f, 0x00]);
});
