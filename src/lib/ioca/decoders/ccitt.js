/**
 * CCITT fax decoders for bilevel images (task T064): Group 3 one-dimensional (Modified Huffman,
 * ITU-T T.4), Group 3 two-dimensional (Modified READ, T.4) and Group 4 (MMR, ITU-T T.6).
 * IOCA compression codes X'80' (G3 MH), X'81' (G3 MR) and X'82' (G4 MMR) use them; IBM MMR
 * (X'01') is T.4 two-dimensional coding with K infinite (see decodeCcitt); G4 was verified on
 * 82 sample images.
 *
 * Output: rows of bits, each row padded to whole bytes, most significant bit = leftmost pel,
 * 1 = black.
 */

/** Terminating and make-up codes for white runs: [run length, code bits]. */
const WHITE = [
  [0, '00110101'], [1, '000111'], [2, '0111'], [3, '1000'], [4, '1011'], [5, '1100'], [6, '1110'], [7, '1111'],
  [8, '10011'], [9, '10100'], [10, '00111'], [11, '01000'], [12, '001000'], [13, '000011'], [14, '110100'],
  [15, '110101'], [16, '101010'], [17, '101011'], [18, '0100111'], [19, '0001100'], [20, '0001000'],
  [21, '0010111'], [22, '0000011'], [23, '0000100'], [24, '0101000'], [25, '0101011'], [26, '0010011'],
  [27, '0100100'], [28, '0011000'], [29, '00000010'], [30, '00000011'], [31, '00011010'], [32, '00011011'],
  [33, '00010010'], [34, '00010011'], [35, '00010100'], [36, '00010101'], [37, '00010110'], [38, '00010111'],
  [39, '00101000'], [40, '00101001'], [41, '00101010'], [42, '00101011'], [43, '00101100'], [44, '00101101'],
  [45, '00000100'], [46, '00000101'], [47, '00001010'], [48, '00001011'], [49, '01010010'], [50, '01010011'],
  [51, '01010100'], [52, '01010101'], [53, '00100100'], [54, '00100101'], [55, '01011000'], [56, '01011001'],
  [57, '01011010'], [58, '01011011'], [59, '01001010'], [60, '01001011'], [61, '00110010'], [62, '00110011'],
  [63, '00110100'],
  [64, '11011'], [128, '10010'], [192, '010111'], [256, '0110111'], [320, '00110110'], [384, '00110111'],
  [448, '01100100'], [512, '01100101'], [576, '01101000'], [640, '01100111'], [704, '011001100'],
  [768, '011001101'], [832, '011010010'], [896, '011010011'], [960, '011010100'], [1024, '011010101'],
  [1088, '011010110'], [1152, '011010111'], [1216, '011011000'], [1280, '011011001'], [1344, '011011010'],
  [1408, '011011011'], [1472, '010011000'], [1536, '010011001'], [1600, '010011010'], [1664, '011000'],
  [1728, '010011011'],
];

/** Terminating and make-up codes for black runs. */
const BLACK = [
  [0, '0000110111'], [1, '010'], [2, '11'], [3, '10'], [4, '011'], [5, '0011'], [6, '0010'], [7, '00011'],
  [8, '000101'], [9, '000100'], [10, '0000100'], [11, '0000101'], [12, '0000111'], [13, '00000100'],
  [14, '00000111'], [15, '000011000'], [16, '0000010111'], [17, '0000011000'], [18, '0000001000'],
  [19, '00001100111'], [20, '00001101000'], [21, '00001101100'], [22, '00000110111'], [23, '00000101000'],
  [24, '00000010111'], [25, '00000011000'], [26, '000011001010'], [27, '000011001011'], [28, '000011001100'],
  [29, '000011001101'], [30, '000001101000'], [31, '000001101001'], [32, '000001101010'], [33, '000001101011'],
  [34, '000011010010'], [35, '000011010011'], [36, '000011010100'], [37, '000011010101'], [38, '000011010110'],
  [39, '000011010111'], [40, '000001101100'], [41, '000001101101'], [42, '000011011010'], [43, '000011011011'],
  [44, '000001010100'], [45, '000001010101'], [46, '000001010110'], [47, '000001010111'], [48, '000001100100'],
  [49, '000001100101'], [50, '000001010010'], [51, '000001010011'], [52, '000000100100'], [53, '000000110111'],
  [54, '000000111000'], [55, '000000100111'], [56, '000000101000'], [57, '000001011000'], [58, '000001011001'],
  [59, '000000101011'], [60, '000000101100'], [61, '000001011010'], [62, '000001100110'], [63, '000001100111'],
  [64, '0000001111'], [128, '000011001000'], [192, '000011001001'], [256, '000001011011'], [320, '000000110011'],
  [384, '000000110100'], [448, '000000110101'], [512, '0000001101100'], [576, '0000001101101'],
  [640, '0000001001010'], [704, '0000001001011'], [768, '0000001001100'], [832, '0000001001101'],
  [896, '0000001110010'], [960, '0000001110011'], [1024, '0000001110100'], [1088, '0000001110101'],
  [1152, '0000001110110'], [1216, '0000001110111'], [1280, '0000001010010'], [1344, '0000001010011'],
  [1408, '0000001010100'], [1472, '0000001010101'], [1536, '0000001011010'], [1600, '0000001011011'],
  [1664, '0000001100100'], [1728, '0000001100101'],
];

/** Extended make-up codes shared by both colors. */
const EXTENDED = [
  [1792, '00000001000'], [1856, '00000001100'], [1920, '00000001101'], [1984, '000000010010'],
  [2048, '000000010011'], [2112, '000000010100'], [2176, '000000010101'], [2240, '000000010110'],
  [2304, '000000010111'], [2368, '000000011100'], [2432, '000000011101'], [2496, '000000011110'],
  [2560, '000000011111'],
];

/** Two-dimensional mode codes. */
const MODES = [['P', '0001'], ['H', '001'], ['V0', '1'], ['VR1', '011'], ['VR2', '000011'], ['VR3', '0000011'],
  ['VL1', '010'], ['VL2', '000010'], ['VL3', '0000010'], ['EXT', '0000001'], ['EOL', '000000000001']];

/**
 * Builds a lookup table: key = (length << 16) | code value → entry.
 * @param {[any, string][]} codes Entries with bit strings.
 * @returns {{map: Map<number, any>, maxLen: number}} Lookup table.
 */
function table(codes) {
  const map = new Map();
  let maxLen = 0;
  for (const [value, bits] of codes) {
    map.set((bits.length << 16) | parseInt(bits, 2), value);
    maxLen = Math.max(maxLen, bits.length);
  }
  return { map, maxLen };
}

const WHITE_TABLE = table([...WHITE, ...EXTENDED, ['EOL', '000000000001']]);
const BLACK_TABLE = table([...BLACK, ...EXTENDED, ['EOL', '000000000001']]);
const MODE_TABLE = table(MODES);

/**
 * Reads bits from a byte array, most significant bit first.
 */
class BitReader {
  /**
   * @param {Uint8Array} data Compressed data.
   * @param {boolean} [lsbFirst] Bits within each byte are stored least significant first.
   */
  constructor(data, lsbFirst = false) {
    this.data = data;
    this.pos = 0;
    this.lsbFirst = lsbFirst;
  }

  /** @returns {number} Next bit (0 or 1), or −1 at the end. */
  bit() {
    const byte = this.pos >> 3;
    if (byte >= this.data.length) return -1;
    const shift = this.lsbFirst ? (this.pos & 7) : 7 - (this.pos & 7);
    this.pos++;
    return (this.data[byte] >> shift) & 1;
  }

  /**
   * Reads the next code from a table.
   * @param {{map: Map<number, any>, maxLen: number}} t Table.
   * @returns {any} The entry, or undefined if no code matches.
   */
  code(t) {
    let value = 0;
    for (let len = 1; len <= t.maxLen; len++) {
      const b = this.bit();
      if (b < 0) return undefined;
      value = (value << 1) | b;
      const hit = t.map.get((len << 16) | value);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }

  /**
   * Tells whether an end of line code comes next: at least 11 zeros (more are fill bits) and a 1.
   * Nothing is consumed.
   * @returns {boolean} True at an end of line code.
   */
  eolAhead() {
    const save = this.pos;
    let zeros = 0;
    let b;
    while ((b = this.bit()) === 0) zeros++;
    this.pos = save;
    return zeros >= 11 && b === 1;
  }

  /** Skips to the next byte boundary. */
  align() {
    this.pos = (this.pos + 7) & ~7;
  }
}

/**
 * Reads one run length (make-up codes plus a terminating code).
 * @param {BitReader} r Bit reader.
 * @param {boolean} black True for a black run.
 * @returns {number} Run length, −1 on error, or −2 at an end of line code (the reader is then
 *   back at the start of that code).
 */
function readRun(r, black) {
  let total = 0;
  for (;;) {
    if (r.eolAhead()) return -2;
    const v = r.code(black ? BLACK_TABLE : WHITE_TABLE);
    if (v === undefined || v === 'EOL') return -1;
    total += v;
    if (v < 64) return total;
  }
}

/**
 * Writes a row of changing elements into the bitmap.
 * @param {Uint8Array} out Output bitmap.
 * @param {number} rowStart Byte offset of the row.
 * @param {number[]} changes Positions where the color changes (starting with white).
 * @param {number} width Image width.
 * @returns {void}
 */
function paintRow(out, rowStart, changes, width) {
  for (let i = 0; i + 1 < changes.length; i += 2) {
    const from = Math.max(0, changes[i]);
    const to = Math.min(width, changes[i + 1]);
    for (let x = from; x < to; x++) out[rowStart + (x >> 3)] |= 0x80 >> (x & 7);
  }
  if (changes.length % 2 === 1) {
    for (let x = Math.max(0, changes[changes.length - 1]); x < width; x++) out[rowStart + (x >> 3)] |= 0x80 >> (x & 7);
  }
}

/**
 * Decodes one two-dimensional coded row relative to the reference row.
 * @param {BitReader} r Bit reader.
 * @param {number[]} ref Changing elements of the reference row (black starts at odd indices).
 * @param {number} width Image width.
 * @returns {number[]|null} Changing elements of the decoded row, or null on error (also for an
 *   end of line code where the row should start). An end of line code inside the row ends it early (the rest of the row keeps the current color, as
 *   common decoders do); the reader is left at that code, so the next row starts with it.
 */
function decode2DRow(r, ref, width) {
  const cur = [];
  let a0 = -1;
  let color = 0; // 0 white, 1 black
  // b1: first changing element on the reference row to the right of a0 whose new color is the
  // opposite of a0's color (even indexes change to black, odd indexes change to white).
  const b1Index = (pos, col) => {
    let i = 0;
    while (i < ref.length && (ref[i] <= pos || (i % 2) !== col)) i++;
    return i;
  };
  while (a0 < width) {
    if (r.eolAhead()) return a0 < 0 ? null : cur;
    const mode = r.code(MODE_TABLE);
    if (mode === undefined) return null;
    const i = b1Index(a0, color);
    const b1 = i < ref.length ? ref[i] : width;
    const b2 = i + 1 < ref.length ? ref[i + 1] : width;
    if (mode === 'P') {
      a0 = b2;
    } else if (mode === 'H') {
      const start = Math.max(a0, 0);
      const r1 = readRun(r, color === 1);
      const r2 = r1 < 0 ? -1 : readRun(r, color === 0);
      if (r1 < 0 || r2 < 0) return null;
      cur.push(start + r1, start + r1 + r2);
      a0 = start + r1 + r2;
    } else if (mode[0] === 'V') {
      const d = mode === 'V0' ? 0 : (mode[1] === 'R' ? 1 : -1) * Number(mode[2]);
      const a1 = b1 + d;
      cur.push(a1);
      a0 = a1;
      color ^= 1;
    } else {
      return null; // extension (uncompressed modes are not supported) or a broken end of line
    }
  }
  return cur;
}

/**
 * Decodes CCITT-compressed bilevel image data.
 *
 * Some encoders code each row up to the next byte boundary (a 2316-pel image as 2320 pels). Such
 * data shows up as rows that run past the image width; it is then decoded again at the padded
 * width, and that result is used if it is cleaner (the bitmap layout is the same).
 * @param {Uint8Array} data Compressed data.
 * @param {number} width Image width in pels.
 * @param {number} height Image height in pels.
 * @param {'G4'|'G3-1D'|'G3-2D'|'IBM-MMR'} scheme Compression scheme.
 * @param {{lsbFirst?: boolean, blackIs1?: boolean, byteAlignRows?: boolean}} [options] Bit order,
 *   meaning of 1 bits in the output (default true: 1 = black), byte-aligned rows (G3).
 * @returns {{bits: Uint8Array, rowBytes: number, rowsDecoded: number, error: string|null}} Bitmap
 *   and how many rows decoded cleanly.
 */
export function decodeCcitt(data, width, height, scheme, options = {}) {
  const exact = decodeAt(data, width, height, scheme, options);
  const padded = Math.ceil(width / 8) * 8;
  if (padded === width || (!exact.overshoots && !exact.error)) return exact.result;
  const wide = decodeAt(data, padded, height, scheme, options);
  const worse = (a) => (a.error ? 1e9 - a.result.rowsDecoded : 0) + a.overshoots;
  if (worse(wide) >= worse(exact)) return exact.result;
  // Clear the pels beyond the image width in each row.
  const { bits, rowBytes } = wide.result;
  const keep = (0xff00 >> (width & 7)) & 0xff;
  for (let row = 0; row < height; row++) bits[row * rowBytes + rowBytes - 1] &= keep;
  return wide.result;
}

/**
 * Decodes CCITT data with a given coded row width.
 * @param {Uint8Array} data Compressed data.
 * @param {number} width Coded row width in pels.
 * @param {number} height Image height in pels.
 * @param {'G4'|'G3-1D'|'G3-2D'|'IBM-MMR'} scheme Compression scheme.
 * @param {{lsbFirst?: boolean, blackIs1?: boolean, byteAlignRows?: boolean}} options Options.
 * @returns {{result: {bits: Uint8Array, rowBytes: number, rowsDecoded: number, error: string|null},
 *   overshoots: number, error: boolean}} Bitmap, and the number of rows that ran past the width.
 */
function decodeAt(data, width, height, scheme, options) {
  const rowBytes = Math.ceil(width / 8);
  const out = new Uint8Array(rowBytes * height);
  const r = new BitReader(data, options.lsbFirst);
  let ref = [];
  let row = 0;
  let error = null;
  let overshoots = 0;
  for (; row < height; row++) {
    const rowStart = r.pos;
    let cur;
    if (scheme === 'G4') {
      cur = decode2DRow(r, ref, width);
    } else {
      // Group 3: optional EOL before each row; for 2D, a tag bit says 1D (1) or 2D (0).
      // IBM MMR (IOCA X'01'): K is infinite — the first row is 1D, all others 2D; an EOL with
      // its tag bit appears only where the mode switches (and in the end-of-page sequence).
      const save = r.pos;
      let zeros = 0;
      let b;
      while ((b = r.bit()) === 0) zeros++;
      const eol = zeros >= 11 && b === 1;
      if (!eol) r.pos = save;
      if (options.byteAlignRows) r.align();
      let twoD = false;
      if (scheme === 'G3-2D') twoD = r.bit() === 0;
      else if (scheme === 'IBM-MMR') twoD = eol ? r.bit() === 0 : row > 0;
      if (twoD) cur = decode2DRow(r, ref, width);
      else {
        cur = [];
        let x = 0;
        let black = false;
        while (x < width) {
          const run = readRun(r, black);
          if (run === -2) break; // end of line inside the row: the row ends here
          if (run < 0) { cur = null; break; }
          x += run;
          cur.push(x);
          black = !black;
        }
      }
    }
    if (!cur) {
      error = `row ${row} (starting at bit ${rowStart}): invalid code`;
      break;
    }
    if (cur.some((v) => v > width)) overshoots++;
    paintRow(out, row * rowBytes, cur, width);
    // Reference row for the next row: positions limited to the image width and never decreasing.
    // (Dropping a position instead would swap black and white for the rest of the image.)
    ref = [];
    for (const v of cur) ref.push(Math.min(width, Math.max(v, ref.at(-1) ?? 0)));
  }
  if (options.blackIs1 === false) for (let i = 0; i < out.length; i++) out[i] = ~out[i];
  return { result: { bits: out, rowBytes, rowsDecoded: row, error }, overshoots, error: Boolean(error) };
}
