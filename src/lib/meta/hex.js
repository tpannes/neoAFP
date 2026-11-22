/**
 * Hex display (FR-032) and shared text helpers for the structure and metadata views: rows of 16
 * bytes with offset, hexadecimal and a text column decoded in a code page; bytes that are not
 * printable text (control characters, bytes without a mapping) are shown as "·".
 */

import { loadCodePage, decode, isSingleByte } from '../codepages/index.js';

/** Placeholder for bytes that are not printable text. */
export const PLACEHOLDER = '·';

/** Default code page for text whose code page the file does not give (maintainer choice: German EBCDIC). */
export const DEFAULT_CODE_PAGE = 'ebcdic-273';

/**
 * Replaces characters that cannot be shown (C0/C1 controls, DEL, U+FFFD) with the placeholder.
 * @param {string} text Decoded text.
 * @returns {string} Printable text.
 */
export function printable(text) {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f-\u009f�]/g, PLACEHOLDER);
}

/**
 * Writes bytes as hexadecimal pairs separated by spaces, e.g. "5A 00 18".
 * @param {Uint8Array} bytes Bytes.
 * @returns {string} Hex text.
 */
export function toHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += (i ? ' ' : '') + bytes[i].toString(16).toUpperCase().padStart(2, '0');
  return s;
}

/**
 * Decodes text bytes in a code page and makes the result printable.
 * @param {string} codePage Code page id.
 * @param {Uint8Array} bytes Text bytes.
 * @returns {Promise<string>} Printable text.
 */
export async function decodePrintable(codePage, bytes) {
  await loadCodePage(codePage);
  return printable(decode(codePage, bytes));
}

/**
 * Builds hex rows of 16 bytes.
 * @param {Uint8Array} bytes Bytes to show.
 * @param {number} offset File offset of the first byte.
 * @param {string} codePage Code page of the text column.
 * @returns {Promise<{offset: number, hex: string, text: string}[]>} Rows.
 */
export async function hexRows(bytes, offset, codePage) {
  await loadCodePage(codePage);
  const single = isSingleByte(codePage);
  const rows = [];
  for (let at = 0; at < bytes.length; at += 16) {
    const row = bytes.subarray(at, Math.min(at + 16, bytes.length));
    // Single-byte code pages are decoded byte by byte, so every column has one character;
    // multi-byte code pages are decoded per row.
    const text = single
      ? Array.from(row, (b) => printable(decode(codePage, Uint8Array.of(b))) || PLACEHOLDER).join('')
      : printable(decode(codePage, row));
    rows.push({ offset: offset + at, hex: toHex(row), text });
  }
  return rows;
}
