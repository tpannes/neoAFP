/**
 * Byte sources: a small common interface for reading parts of a file, whether the file is a
 * browser File/Blob, a byte array in memory or (in tests) a file on disk.
 *
 * Reading in parts matters because AFP print files can be hundreds of megabytes; the library
 * never needs the whole file in memory at once (research R3).
 *
 * A ByteSource is a plain object: `{ name, path, size, read(offset, length) }`, where `read`
 * returns a Promise of a Uint8Array with at most `length` bytes (fewer at the end of the file,
 * empty past the end).
 */

/**
 * @typedef {object} ByteSource
 * @property {string} name File name shown to the user.
 * @property {string} path Path relative to the opened folder (equals name for single files).
 * @property {number} size Total number of bytes.
 * @property {(offset: number, length: number) => Promise<Uint8Array>} read Reads bytes.
 */

/** Window size of a Blob source's read cache. */
const BLOB_WINDOW = 256 * 1024;
/** Number of cached windows (the page in view, thumbnails and background work read in different places). */
const BLOB_WINDOWS = 4;
/** Reads up to this size go through the cache; larger ones (images, fonts) read directly. */
const BLOB_SMALL_READ = 64 * 1024;

/**
 * Limits a requested range to the bytes that exist.
 * @param {number} size Total size of the source.
 * @param {number} offset Requested start.
 * @param {number} length Requested number of bytes.
 * @returns {[number, number]} Start and end (exclusive) inside the source.
 */
function clampRange(size, offset, length) {
  if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(length) || length < 0) {
    throw new RangeError(`invalid range: offset ${offset}, length ${length}`);
  }
  const start = Math.min(offset, size);
  return [start, Math.min(size, start + length)];
}

/**
 * Creates a byte source for a browser Blob or File (also usable in Web Workers).
 * @param {Blob} blob The file or blob.
 * @param {string} name File name.
 * @param {string} [path] Relative path inside an opened folder; defaults to the name.
 * @returns {ByteSource} A byte source reading from the blob.
 */
export function createBlobSource(blob, name, path = name) {
  // Small reads are served from a few cached windows (T230): every Blob read has a fixed cost
  // that is far higher than a file read in Node.js, and rendering a page reads each of its
  // fields separately (20 or more per page), so indexing the text of 880,000 pages took hours
  // with one Blob read per field. Consecutive pages lie in the same window. Reads return copies,
  // so a kept field never pins a whole window.
  const windows = []; // { start, bytes }, most recently used first
  return {
    name,
    path,
    size: blob.size,
    async read(offset, length) {
      const [start, end] = clampRange(blob.size, offset, length);
      if (start === end) return new Uint8Array(0);
      if (end - start > BLOB_SMALL_READ) return new Uint8Array(await blob.slice(start, end).arrayBuffer());
      let hit = windows.findIndex((w) => start >= w.start && end <= w.start + w.bytes.length);
      if (hit < 0) {
        const bytes = new Uint8Array(await blob.slice(start, Math.min(blob.size, start + BLOB_WINDOW)).arrayBuffer());
        windows.unshift({ start, bytes });
        if (windows.length > BLOB_WINDOWS) windows.pop();
        hit = 0;
      } else if (hit > 0) {
        windows.unshift(windows.splice(hit, 1)[0]);
        hit = 0;
      }
      const w = windows[hit];
      return w.bytes.slice(start - w.start, end - w.start);
    },
  };
}

/**
 * Creates a byte source for bytes already in memory (tests, extracted data).
 * @param {Uint8Array} bytes The data.
 * @param {string} name Name shown to the user.
 * @param {string} [path] Relative path; defaults to the name.
 * @returns {ByteSource} A byte source reading from the array.
 */
export function createBufferSource(bytes, name, path = name) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('bytes must be a Uint8Array');
  return {
    name,
    path,
    size: bytes.length,
    async read(offset, length) {
      const [start, end] = clampRange(bytes.length, offset, length);
      return bytes.subarray(start, end);
    },
  };
}
