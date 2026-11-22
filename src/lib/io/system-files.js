/**
 * Files that operating systems write into folders for their own use (view settings, thumbnail
 * caches, file metadata). They are never AFP data, so files read from an opened folder skip
 * them without a message; a file opened on its own is always read.
 *
 * - `.DS_Store`: macOS Finder folder view settings.
 * - `._name`: macOS AppleDouble metadata written next to files on drives that are not
 *   formatted for macOS (USB sticks, network shares).
 * - `Thumbs.db`, `desktop.ini`: Windows Explorer thumbnail cache and folder settings.
 */

const MAC = new Set(['.DS_Store']);
const WINDOWS = new Set(['thumbs.db', 'desktop.ini']);

/**
 * Tells whether a file is operating system metadata rather than user data.
 * @param {string} path File name or path inside the opened folder ("/" or "\" separated).
 * @returns {boolean} True for metadata files that folder imports skip.
 */
export function isSystemFile(path) {
  const name = String(path).split(/[\\/]/).pop();
  return MAC.has(name) || name.startsWith('._') || WINDOWS.has(name.toLowerCase());
}
