/**
 * TIFF LZW decoder (task T065), used by IOCA compression X'0D' and by TIFF images in object
 * containers. Codes are read most significant bit first, starting with 9 bits; code 256 clears
 * the table, 257 ends the data, and the code width grows one code early (TIFF 6.0, section 13).
 */

/**
 * Decodes TIFF LZW data.
 * @param {Uint8Array} data Compressed bytes.
 * @param {number} [expected] Expected output size (stops early when reached; also sizes the buffer).
 * @returns {Uint8Array} Decompressed bytes.
 */
export function decodeLzw(data, expected = 0) {
  let out = new Uint8Array(Math.max(expected, data.length * 3, 1024));
  let outLen = 0;
  const push = (seq) => {
    if (outLen + seq.length > out.length) {
      const bigger = new Uint8Array(Math.max(out.length * 2, outLen + seq.length));
      bigger.set(out.subarray(0, outLen));
      out = bigger;
    }
    out.set(seq, outLen);
    outLen += seq.length;
  };
  let dict = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < 256; i++) dict.push(Uint8Array.of(i));
    dict.push(null, null); // 256 clear, 257 end
  };
  reset();
  let width = 9;
  let bitPos = 0;
  const totalBits = data.length * 8;
  let prev = null;
  while (bitPos + width <= totalBits) {
    let code = 0;
    for (let i = 0; i < width; i++) {
      const b = (data[(bitPos + i) >> 3] >> (7 - ((bitPos + i) & 7))) & 1;
      code = (code << 1) | b;
    }
    bitPos += width;
    if (code === 257) break;
    if (code === 256) {
      reset();
      width = 9;
      prev = null;
      continue;
    }
    let entry;
    if (code < dict.length && dict[code]) {
      entry = dict[code];
      if (prev) {
        const add = new Uint8Array(prev.length + 1);
        add.set(prev);
        add[prev.length] = entry[0];
        dict.push(add);
      }
    } else if (prev && code === dict.length) {
      entry = new Uint8Array(prev.length + 1);
      entry.set(prev);
      entry[prev.length] = prev[0];
      dict.push(entry);
    } else {
      break; // invalid code: stop with what was decoded
    }
    push(entry);
    prev = entry;
    if (dict.length + 1 >= (1 << width) && width < 12) width++;
    if (expected && outLen >= expected) break;
  }
  return out.subarray(0, outLen);
}
