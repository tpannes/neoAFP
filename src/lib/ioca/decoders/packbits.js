/**
 * PackBits decoder (task T065), used by IOCA compression X'0C' (TIFF PackBits) and by TIFF
 * images in object containers (TIFF 6.0, section 9): a header byte n means copy the next n + 1
 * bytes (0–127), repeat the next byte 1 − n times (−1 to −127), or nothing (−128).
 */

/**
 * Decodes PackBits data.
 * @param {Uint8Array} data Compressed bytes.
 * @param {number} [expected] Expected output size (stops when reached).
 * @returns {Uint8Array} Decompressed bytes.
 */
export function decodePackBits(data, expected = 0) {
  const out = [];
  let i = 0;
  while (i < data.length && (!expected || out.length < expected)) {
    const n = data[i] > 127 ? data[i] - 256 : data[i];
    i++;
    if (n >= 0) {
      for (let k = 0; k <= n && i < data.length; k++) out.push(data[i++]);
    } else if (n !== -128) {
      const v = data[i++];
      for (let k = 0; k < 1 - n; k++) out.push(v);
    }
  }
  return Uint8Array.from(expected ? out.slice(0, expected) : out);
}
