/**
 * Type 1 fonts (T052): eexec/charstring decryption and charstring interpretation, checked with an
 * encryption and a charstring encoding written here from the Adobe Type 1 Font Format
 * specification (section 6.2 charstring number encoding, section 7 encryption: c1 = 52845,
 * c2 = 22719, eexec key 55665, charstring key 4330, lenIV 4).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decrypt, runCharString } from '../../src/lib/foca/type1.js';

/**
 * Encrypts bytes (Type 1 spec section 7.1), with n leading bytes of fixed "random" data.
 * @param {number[]} plain Plain bytes.
 * @param {number} key Initial key.
 * @param {number} n Number of leading bytes.
 * @returns {Uint8Array} Cipher bytes.
 */
function encrypt(plain, key, n) {
  let r = key;
  return Uint8Array.from([...Array(n).fill(0x5a), ...plain], (p) => {
    const c = p ^ (r >> 8);
    r = ((c + r) * 52845 + 22719) & 0xffff;
    return c;
  });
}

/**
 * Encodes a charstring number (Type 1 spec section 6.2).
 * @param {number} v Integer.
 * @returns {number[]} Bytes.
 */
function num(v) {
  if (v >= -107 && v <= 107) return [v + 139];
  if (v >= 108 && v <= 1131) return [((v - 108) >> 8) + 247, (v - 108) & 0xff];
  if (v >= -1131 && v <= -108) return [((-v - 108) >> 8) + 251, (-v - 108) & 0xff];
  return [255, (v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

/** Charstring commands (Type 1 spec table "Charstring commands"). */
const OP = { hsbw: [13], rmoveto: [21], rlineto: [5], hlineto: [6], rrcurveto: [8], closepath: [9], callsubr: [10], return: [11], endchar: [14] };
const cs = (...parts) => parts.flatMap((p) => (typeof p === 'number' ? num(p) : OP[p]));

test('eexec decryption reverses the specified encryption and drops the 4 leading bytes', () => {
  const plain = [...Buffer.from('/Private 8 dict dup begin', 'latin1')];
  assert.deepEqual([...decrypt(encrypt(plain, 55665, 4), 55665, 4)], plain);
});

test('a charstring with all number forms, lines, a curve and a subroutine', () => {
  // Subroutine 4 draws one line and returns (subroutines 0–3 are reserved for hint replacement).
  const subrs = [0, 1, 2, 3].map(() => encrypt(cs('return'), 4330, 4)).concat([encrypt(cs(0, 300, 'rlineto', 'return'), 4330, 4)]);
  const glyph = encrypt(cs(
    50, 1500, 'hsbw', // side bearing 50, width 1500 (5-byte number)
    100, 0, 'rmoveto', // (150, 0)
    1000, 0, 'rlineto', // (1150, 0): 2-byte positive number
    4, 'callsubr', // (1150, 300)
    -1000, 'hlineto', // (150, 300): 2-byte negative number
    'closepath',
    0, 100, 'rmoveto', // (150, 400)
    50, 50, 100, 0, 50, -50, 'rrcurveto', // to (350, 400)
    'closepath', 'endchar',
  ), 4330, 4);
  const out = runCharString(glyph, { subrs, lenIV: 4 });
  assert.equal(out.advance, 1500);
  assert.equal(out.lsb, 50);
  assert.deepEqual(out.path, [
    ['M', 150, 0], ['L', 1150, 0], ['L', 1150, 300], ['L', 150, 300], ['Z'],
    ['M', 150, 400], ['C', 200, 450, 300, 450, 350, 400], ['Z'],
  ]);
});
