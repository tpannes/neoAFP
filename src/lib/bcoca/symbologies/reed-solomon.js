/**
 * Reed–Solomon error correction over GF(2^m). QR Code (ISO/IEC 18004) uses the field polynomial
 * X'11D' with generator roots α^0 … α^(n−1); Data Matrix ECC 200 (ISO/IEC 16022) uses X'12D'
 * with roots α^1 … α^n; the 4-state Royal Mail Mailmark uses GF(32) with X'25' and roots
 * α^1 … α^n.
 */

/** Cached fields by polynomial. */
const fields = new Map();

/**
 * Builds exponent and logarithm tables for GF(2^m) with generator α = 2.
 * @param {number} poly Field polynomial (its highest bit gives the field size 2^m).
 * @returns {{exp: Uint8Array, log: Uint8Array, order: number}} Tables (exp has 2·(2^m − 1)
 *   entries to skip a modulo) and the multiplicative order 2^m − 1.
 */
function field(poly) {
  let f = fields.get(poly);
  if (f) return f;
  const size = 2 ** Math.floor(Math.log2(poly));
  const order = size - 1;
  const exp = new Uint8Array(2 * order);
  const log = new Uint8Array(size);
  let x = 1;
  for (let i = 0; i < order; i++) {
    exp[i] = x;
    log[x] = i;
    x <<= 1;
    if (x & size) x ^= poly;
  }
  for (let i = order; i < 2 * order; i++) exp[i] = exp[i - order];
  f = { exp, log, order };
  fields.set(poly, f);
  return f;
}

/**
 * Computes the error correction codewords for one block.
 * @param {ArrayLike<number>} data Data codewords.
 * @param {number} count Number of error correction codewords.
 * @param {{poly: number, first: number}} code Field polynomial and exponent of the first root.
 * @returns {number[]} Error correction codewords, highest-order first.
 */
export function rsEncode(data, count, { poly, first }) {
  const { exp, log, order } = field(poly);
  const mul = (a, b) => (a && b ? exp[log[a] + log[b]] : 0);
  // Generator polynomial Π (x − α^(first+i)), coefficients highest-order first, leading 1 dropped.
  let gen = [1];
  for (let i = 0; i < count; i++) {
    const root = exp[(first + i) % order];
    const next = new Array(gen.length + 1).fill(0);
    gen.forEach((c, j) => { next[j] ^= c; next[j + 1] ^= mul(c, root); });
    gen = next;
  }
  gen = gen.slice(1);
  const rem = new Array(count).fill(0);
  for (const d of data) {
    const factor = d ^ rem.shift();
    rem.push(0);
    for (let j = 0; j < count; j++) rem[j] ^= mul(gen[j], factor);
  }
  return rem;
}

export const QR_RS = Object.freeze({ poly: 0x11d, first: 0 });
export const DATA_MATRIX_RS = Object.freeze({ poly: 0x12d, first: 1 });
export const MAILMARK_RS = Object.freeze({ poly: 0x25, first: 1 });
