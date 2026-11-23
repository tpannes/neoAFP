/**
 * IOCA RL4 (Run Length 4) decoder, compression X'06' (IOCA Reference AFPC-0003-09, "Run Length 4
 * (RL4) Compression Algorithm", Table 27; task T306).
 *
 * Each scan line is a two-byte line number, a two-byte length, then run lengths that alternate
 * white and black, starting with white, and an end-of-line code that brings the line to a byte
 * boundary. Code words (bits, most significant first):
 * - B'0xxx' runs 1–8, B'10xx xxxx' 9–72, B'110x xxxx xxxx' 73–584,
 *   B'1110 xxxx xxxx xxxx' 585–4680, B'1111 0xxx xxxx xxxx xxxx' 4681–32767 (each the value
 *   plus the first run of its range);
 * - B'1111 1110' a run of 0 (a line that starts black);
 * - B'1111 1111' end of line, followed by B'1111' when the line has not yet reached a byte boundary.
 * A final white run may be left out. Lines that are entirely white may be left out too; the line
 * numbers say where each line belongs. The reference does not say whether they count from 0 or
 * 1: lines count from 0 when any line has number 0, else from 1.
 */

/**
 * Decodes RL4 data into a bitmap.
 * @param {Uint8Array} data Compressed data.
 * @param {number} width Width in pels.
 * @param {number} height Height in pels.
 * @returns {{bits: Uint8Array, rowBytes: number, error: string|null}} Bitmap (1 = black).
 */
export function decodeRl4(data, width, height) {
  const rowBytes = Math.ceil(width / 8);
  const bits = new Uint8Array(rowBytes * height);
  let pos = 0; // in bits
  const total = data.length * 8;
  const read = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++, pos++) v = (v << 1) | ((data[pos >> 3] >> (7 - (pos & 7))) & 1);
    return v;
  };
  const lines = [];
  let error = null;
  while (pos + 32 <= total) {
    const number = read(16);
    read(16); // length of the line in bytes; lines are read code by code instead
    const runs = [];
    let ended = false;
    while (pos + 4 <= total) {
      const head = read(4);
      if (head < 8) { runs.push((head & 7) + 1); continue; }
      if (head >> 2 === 0b10) { runs.push((((head & 3) << 4) | read(4)) + 9); continue; }
      if (head >> 1 === 0b110) { runs.push((((head & 1) << 8) | read(8)) + 73); continue; }
      if (head === 0b1110) { runs.push(read(12) + 585); continue; }
      const next = read(4);
      if (next === 0b1110) { runs.push(0); continue; }
      if (next === 0b1111) {
        if (pos & 7) read(4); // the 12-bit end of line reaches the byte boundary
        ended = true;
        break;
      }
      if (next >> 3 === 0) { runs.push((((next & 7) << 12) | read(12)) + 4681); continue; }
      error = `line ${number}: invalid code at bit ${pos - 8}`;
      break;
    }
    if (error) break;
    lines.push({ number, runs });
    if (!ended) break;
  }
  const base = lines.some((l) => l.number === 0) ? 0 : 1;
  for (const { number, runs } of lines) {
    const y = number - base;
    if (y < 0 || y >= height) continue;
    let x = 0;
    runs.forEach((run, i) => {
      const end = Math.min(width, x + run);
      if (i % 2 === 1) for (let p = x; p < end; p++) bits[y * rowBytes + (p >> 3)] |= 0x80 >> (p & 7);
      x = end;
    });
  }
  return { bits, rowBytes, error };
}
