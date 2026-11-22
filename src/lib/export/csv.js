/**
 * Resource list CSV export (FR-055, contracts/csv-export.md): UTF-8 with byte order mark,
 * RFC 4180 (comma separator, CRLF, quotes around fields with comma, quote, CR or LF, inner quotes
 * doubled), one header row and one row per resource in the given order. Numbers are not
 * localized: millimeters with one decimal and a dot, integers for sizes and resolutions. The
 * source column lists every source of a combined resource, separated by "; ".
 */

import { sourcesText } from '../resources/filter.js';

/** Columns in order. */
export const CSV_COLUMNS = Object.freeze(['name', 'internalName', 'type', 'widthMm', 'heightMm', 'sizeClass', 'fileSize', 'resolution', 'colorProfile', 'encoding', 'source']);

/**
 * Quotes a field if needed (RFC 4180).
 * @param {string} value Field text.
 * @returns {string} CSV field.
 */
function quote(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Writes the CSV text.
 * @param {object[]} resources Resources (data-model "Resource") in display order.
 * @param {Record<string, string>} labels Translated texts: one per column key (header), and
 *   `type.<type>` and `sizeClass.<class>` for the type and size class cells.
 * @returns {string} CSV text starting with a byte order mark.
 */
export function exportResourcesCsv(resources, labels) {
  const mm = (v) => (typeof v === 'number' ? v.toFixed(1) : '');
  const int = (v) => (typeof v === 'number' ? String(Math.round(v)) : '');
  const cells = (r) => [
    r.name, r.internalName ?? '', labels[`type.${r.type}`] ?? r.type, mm(r.widthMm), mm(r.heightMm), labels[`sizeClass.${r.sizeClass}`] ?? r.sizeClass,
    int(r.fileSize), int(r.resolution), r.colorProfile ?? '', r.encoding ?? '', sourcesText(r),
  ];
  const rows = [CSV_COLUMNS.map((c) => labels[c] ?? c), ...resources.map(cells)];
  return `﻿${rows.map((row) => row.map((v) => quote(String(v))).join(',')).join('\r\n')}\r\n`;
}

/**
 * Writes any table as CSV with the same rules (TLE and NOP browser exports, FR-035, FR-036).
 * @param {string[]} header Column titles.
 * @param {(string|number|null)[][]} rows Cells; null becomes an empty field.
 * @returns {string} CSV text starting with a byte order mark.
 */
export function tableCsv(header, rows) {
  const lines = [header, ...rows].map((row) => row.map((v) => quote(v === null || v === undefined ? '' : String(v))).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
