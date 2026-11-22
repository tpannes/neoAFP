/**
 * Byte source for a file on disk, for Node.js only (used by tests and development tools).
 *
 * The Node file system module is loaded only when this function is called, so importing the
 * library in a browser never touches it.
 */

/**
 * Opens a file on disk as a byte source.
 * @param {string} filePath Path to the file.
 * @param {string} [path] Path to report as the source's relative path; defaults to filePath.
 * @returns {Promise<import('./byte-source.js').ByteSource & {close: () => Promise<void>}>}
 *   A byte source with an extra `close()` to release the file handle.
 */
export async function createNodeFileSource(filePath, path = filePath) {
  const fs = await import('node:fs/promises');
  const handle = await fs.open(filePath, 'r');
  const { size } = await handle.stat();
  const name = filePath.split(/[\\/]/).pop();
  return {
    name,
    path,
    size,
    async read(offset, length) {
      if (!Number.isFinite(offset) || offset < 0 || !Number.isFinite(length) || length < 0) {
        throw new RangeError(`invalid range: offset ${offset}, length ${length}`);
      }
      const start = Math.min(offset, size);
      const count = Math.min(size, start + length) - start;
      if (count === 0) return new Uint8Array(0);
      const buffer = new Uint8Array(count);
      const { bytesRead } = await handle.read(buffer, 0, count, start);
      return buffer.subarray(0, bytesRead);
    },
    async close() {
      await handle.close();
    },
  };
}
