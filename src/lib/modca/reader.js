/**
 * Structured field reader: walks through an AFP file record by record.
 *
 * An AFP (MO:DCA) file is a sequence of "structured fields". Each starts with the introducer
 * byte X'5A', a 2-byte length (counting everything after the X'5A'), a 3-byte identifier, a
 * flag byte and two reserved/sequence bytes, followed by the field's data.
 * Spec reference: MO:DCA Reference (AFPC-0004), "Structured Field Introducer".
 *
 * The reader reads the file in windows (1 MB by default) so that large print files never have
 * to be fully in memory (research R3). Between fields it skips line breaks (CR, LF) and padding
 * (X'40' blanks, X'00' zeros) that files transferred from mainframes often contain (FR-006,
 * research R3a), and an end-of-file marker X'1A' at the very end of the file. Any other byte
 * where a field should start ends reading: everything before it is kept and the position is
 * reported as `truncatedAt` (FR-080).
 */

/** Flag bit: the field has an extension after the 8-byte introducer. */
export const FLAG_EXTENSION = 0x80;
/** Flag bit: the field's data continues in the next field (segmented). */
export const FLAG_SEGMENTED = 0x20;
/** Flag bit: the field's data ends with padding bytes. */
export const FLAG_PADDING = 0x08;

/** Default number of bytes read at once. */
export const DEFAULT_WINDOW = 1024 * 1024;

/** End-of-file marker (Ctrl-Z) that some text-mode transfers append to a file. */
const EOF_MARKER = 0x1a;
/** Largest trailer of end-of-file markers and separators accepted at the end of a file. */
const MAX_TRAILER = 4096;

/**
 * @typedef {object} FieldRecord
 * @property {number} offset Byte offset of the X'5A' introducer.
 * @property {number} length Total length in bytes including the X'5A'.
 * @property {number} id 3-byte identifier as a number, e.g. 0xD3A8AF (Begin Page).
 * @property {number} flags Flag byte of the introducer.
 * @property {number} dataOffset Byte offset where the field's data starts.
 * @property {number} dataLength Number of data bytes (without extension and padding).
 */

/**
 * @typedef {object} ScanSummary
 * @property {number} fieldCount Number of complete fields read.
 * @property {'plain'|'lineBreaks'|'padded'} recordFormat Separators found between fields.
 * @property {number|null} truncatedAt Offset where reading stopped early, or null.
 * @property {string|null} truncatedReason Why reading stopped early, or null.
 * @property {boolean} stoppedByVisitor True when the visitor asked to stop.
 */

/**
 * Reads all structured fields of a byte source in order and calls `visit` for each.
 * @param {import('../io/byte-source.js').ByteSource} source File to read.
 * @param {(field: FieldRecord) => (boolean|void)} visit Called per field; return `false` to stop.
 * @param {{windowSize?: number, onProgress?: (done: number, total: number) => void}} [options]
 *   Window size in bytes and an optional progress callback (called once per window).
 * @returns {Promise<ScanSummary>} What was read and whether the file ended early.
 */
export async function scanFields(source, visit, options = {}) {
  const windowSize = Math.max(options.windowSize ?? DEFAULT_WINDOW, 32 * 1024 + 16);
  const size = source.size;
  let buf = new Uint8Array(0);
  let bufStart = 0;
  let pos = 0;
  let fieldCount = 0;
  let sawLineBreak = false;
  let sawPadding = false;
  let truncatedAt = null;
  let truncatedReason = null;
  let stoppedByVisitor = false;
  let sawEndOfFileMarker = false;

  /**
   * Makes sure bytes [from, from + count) are in the buffer, as far as the file has them.
   * @param {number} from First byte needed.
   * @param {number} count Number of bytes needed.
   * @returns {Promise<void>} Resolves when the buffer covers the range.
   */
  async function ensure(from, count) {
    if (from >= bufStart && from + count <= bufStart + buf.length) return;
    buf = await source.read(from, Math.max(windowSize, count));
    bufStart = from;
    options.onProgress?.(Math.min(from + buf.length, size), size);
  }

  while (pos < size) {
    await ensure(pos, 1);
    // Skip separators quickly inside the current buffer.
    let i = pos - bufStart;
    while (i < buf.length) {
      const b = buf[i];
      if (b === 0x0d || b === 0x0a) sawLineBreak = true;
      else if (b === 0x40 || b === 0x00) sawPadding = true;
      else break;
      i++;
    }
    pos = bufStart + i;
    if (i >= buf.length) continue; // need the next window
    if (buf[i] !== 0x5a) {
      if (buf[i] === EOF_MARKER && await onlyTrailingMarkers(source, pos, size)) {
        sawEndOfFileMarker = true;
        break;
      }
      truncatedAt = pos;
      truncatedReason = 'unexpectedByte';
      break;
    }
    await ensure(pos, 9);
    if (pos + 9 > size) {
      truncatedAt = pos;
      truncatedReason = 'incompleteIntroducer';
      break;
    }
    let j = pos - bufStart;
    const len = (buf[j + 1] << 8) | buf[j + 2];
    if (len < 8) {
      truncatedAt = pos;
      truncatedReason = 'invalidLength';
      break;
    }
    const total = len + 1;
    if (pos + total > size) {
      truncatedAt = pos;
      truncatedReason = 'fieldBeyondEnd';
      break;
    }
    await ensure(pos, total);
    j = pos - bufStart;
    const id = (buf[j + 3] << 16) | (buf[j + 4] << 8) | buf[j + 5];
    const flags = buf[j + 6];
    let header = 9;
    if (flags & FLAG_EXTENSION) {
      const extLen = buf[j + 9];
      header += Math.max(extLen, 1);
    }
    let pad = 0;
    if (flags & FLAG_PADDING) {
      const last = buf[j + total - 1];
      pad = last !== 0 ? last : (buf[j + total - 3] << 8) | buf[j + total - 2];
    }
    header = Math.min(header, total);
    const dataLength = Math.max(0, total - header - pad);
    fieldCount++;
    const keepGoing = visit({ offset: pos, length: total, id, flags, dataOffset: pos + header, dataLength });
    pos += total;
    if (keepGoing === false) {
      stoppedByVisitor = true;
      break;
    }
  }

  const recordFormat = sawLineBreak ? 'lineBreaks' : sawPadding ? 'padded' : 'plain';
  return { fieldCount, recordFormat, truncatedAt, truncatedReason, stoppedByVisitor, sawEndOfFileMarker };
}

/**
 * Checks whether everything from a position to the end of the file is an end-of-file marker
 * (X'1A', added by some text-mode transfers) or a separator. Only the last few kilobytes are
 * accepted, so real data after a stray X'1A' is still reported as damage.
 * @param {import('../io/byte-source.js').ByteSource} source File.
 * @param {number} from Position of the first X'1A'.
 * @param {number} size File size.
 * @returns {Promise<boolean>} True if only markers and separators follow.
 */
async function onlyTrailingMarkers(source, from, size) {
  if (size - from > MAX_TRAILER) return false;
  const rest = await source.read(from, size - from);
  return rest.every((b) => b === EOF_MARKER || b === 0x0d || b === 0x0a || b === 0x40 || b === 0x00);
}

/**
 * Reads the data bytes of one field.
 * @param {import('../io/byte-source.js').ByteSource} source File the field belongs to.
 * @param {{dataOffset: number, dataLength: number}} field Field position from the reader or index.
 * @returns {Promise<Uint8Array>} The field's data (without introducer, extension and padding).
 */
export async function readFieldData(source, field) {
  return source.read(field.dataOffset, field.dataLength);
}

/**
 * Formats a numeric field identifier as 6 upper-case hex digits, e.g. 0xD3A8AF → "D3A8AF".
 * @param {number} id Identifier.
 * @returns {string} Hex text.
 */
export function idToHex(id) {
  return id.toString(16).toUpperCase().padStart(6, '0');
}
