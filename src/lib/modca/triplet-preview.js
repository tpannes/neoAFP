/**
 * Short previews of triplets for the structure tree, and the triplet texts of the field details
 * read in the right code page (MO:DCA Reference AFPC-0004-11, chapter 6 "Triplets").
 *
 * Character strings in triplets (Fully Qualified Name, Attribute Value, Comment) are in the code
 * page of the last Coded Graphic Character Set Global Identifier X'01' before them in the same
 * field, else in that of the enclosing objects (as for TLEs, see meta/tle.js).
 *
 * A preview is `{key, value, color}`: `key` is a short label shown before the value (null for
 * none), `color` an RGB color for a swatch (null for none). Texts are the specification's English
 * terms, like the field and triplet names in the tree.
 */

import { loadCodePage, decode, listCodePages } from '../codepages/index.js';
import { codePageOf } from '../meta/owner.js';
import { printable, DEFAULT_CODE_PAGE } from '../meta/hex.js';
import { extendedColor } from '../ptoca/ptoca.js';
import { extendedColorSpec } from '../render/color-spec.js';

/** Longest text a preview carries (the row shows less, the details all). */
const PREVIEW_LENGTH = 200;

/** Fully Qualified Name types (FQNType, MO:DCA "Fully Qualified Name Triplet X'02'"). */
const FQN_TYPES = {
  0x01: 'Replace First GID', 0x07: 'Font Family', 0x08: 'Font Typeface', 0x09: 'Resource Hierarchy',
  0x0a: 'Resource Group', 0x0b: 'Attribute GID', 0x0c: 'Process Element GID', 0x0d: 'Page Group',
  0x11: 'Media Type', 0x12: 'Media Destination', 0x41: 'Color Management Resource',
  0x6e: 'Data-object Font Base Font', 0x7e: 'Data-object Font Linked Font', 0x83: 'Document',
  0x84: 'Resource Object', 0x85: 'Code Page', 0x86: 'Font Character Set', 0x87: 'Page',
  0x8d: 'Medium Map', 0x8e: 'Coded Font', 0x98: 'Document Index', 0xb0: 'Overlay',
  0xbe: 'Internal Resource', 0xca: 'Index Element GID', 0xce: 'Other Object Data',
  0xde: 'External Resource',
};

/** Resource object types (ObjType, MO:DCA "Resource Object Type Triplet X'21'"). */
const OBJECT_TYPES = {
  0x03: 'Graphics (GOCA)', 0x05: 'Bar Code (BCOCA)', 0x06: 'Image (IOCA)', 0x40: 'Font Character Set',
  0x41: 'Code Page', 0x42: 'Coded Font', 0x92: 'Object Container', 0xa8: 'Document',
  0xfb: 'Page Segment', 0xfc: 'Overlay', 0xfe: 'Form Map',
};

/** Medium orientations (MedOrient, MO:DCA "Medium Orientation Triplet X'68'"). */
const ORIENTATIONS = ['Portrait', 'Landscape', 'Reverse Portrait', 'Reverse Landscape', 'Portrait 90', 'Landscape 90'];

/** Font weight and width classes (FtWtClass, FtWdClass 1–9, "Font Descriptor Specification X'1F'"). */
const WEIGHTS = [null, 'Ultralight', 'Extralight', 'Light', 'Semilight', null, 'Semibold', 'Bold', 'Extrabold', 'Ultrabold'];
const WIDTHS = [null, 'Ultracondensed', 'Extracondensed', 'Condensed', 'Semicondensed', null, 'Semiexpanded', 'Expanded', 'Extraexpanded', 'Ultraexpanded'];

/**
 * Writes a byte as X'..'.
 * @param {number} v Byte.
 * @returns {string} E.g. "X'0B'".
 */
const hex2 = (v) => `X'${v.toString(16).toUpperCase().padStart(2, '0')}'`;
/**
 * Reads a big-endian 16-bit unsigned number.
 * @param {Uint8Array} d Bytes.
 * @param {number} at Position.
 * @returns {number} Value.
 */
const u16 = (d, at) => (d[at] << 8) | d[at + 1];
/**
 * Cuts a text to PREVIEW_LENGTH characters.
 * @param {string} text Text.
 * @returns {string} Text, with "…" when cut.
 */
const cut = (text) => (text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text);
/**
 * Writes a number with at most one decimal.
 * @param {number} v Number.
 * @returns {string} E.g. "210" or "12.5".
 */
const fmt = (v) => String(Math.round(v * 10) / 10);

/**
 * Reads the character strings of a field's triplets in their code pages.
 * @param {{id: number, raw: Uint8Array, decoded: object|null}[]} triplets Parsed triplets in order.
 * @param {{id: string|null}|null} inherited Code page of the enclosing objects.
 * @param {string|null} [override] Code page chosen by the user for these strings, or null.
 * @returns {Promise<(string|null)[]>} Per triplet: the text of an FQN (character format), an
 *   Attribute Value or a Comment, else null.
 */
export async function tripletTexts(triplets, inherited, override = null) {
  let current = inherited?.id ?? null;
  const out = [];
  for (const t of triplets) {
    const body = t.raw.subarray(2);
    let bytes = null;
    if (t.id === 0x01 && t.decoded) current = codePageOf(t.decoded).id ?? current;
    else if (t.id === 0x02 && body[1] === 0x00) bytes = body.subarray(2);
    else if (t.id === 0x36) bytes = body.subarray(2);
    else if (t.id === 0x65) bytes = body;
    if (!bytes) { out.push(null); continue; }
    const cp = override ?? current ?? DEFAULT_CODE_PAGE;
    await loadCodePage(cp);
    out.push(printable(decode(cp, bytes)));
  }
  return out;
}

/**
 * Builds the previews of a field's triplets.
 * @param {{id: number, raw: Uint8Array, decoded: object|null}[]} triplets Parsed triplets in order.
 * @param {{id: string|null}|null} inherited Code page of the enclosing objects.
 * @param {string|null} [override] Code page chosen by the user for the strings, or null.
 * @returns {Promise<({key: string|null, value: string, color: string|null}|null)[]>} One preview
 *   per triplet, null where there is none.
 */
export async function tripletPreviews(triplets, inherited, override = null) {
  const texts = await tripletTexts(triplets, inherited, override);
  // Object Area Size is given in the units of the Measurement Units triplet of the same field.
  const units = triplets.find((t) => t.id === 0x4b)?.decoded ?? null;
  return triplets.map((t, i) => {
    try {
      return preview(t, texts[i], units);
    } catch {
      return null;
    }
  });
}

/**
 * Builds the preview of one triplet.
 * @param {{id: number, raw: Uint8Array, decoded: object|null}} t Triplet.
 * @param {string|null} text Its character string, if it has one.
 * @param {object|null} units Decoded Measurement Units of the field.
 * @returns {{key: string|null, value: string, color: string|null}|null} Preview.
 */
function preview(t, text, units) {
  const d = t.raw.subarray(2);
  const v = t.decoded;
  const item = (key, value, color = null) => ({ key, value: cut(value), color });
  switch (t.id) {
    case 0x01: {
      const number = v.ccsid ?? v.cpgid;
      const id = codePageOf(v).id;
      const label = listCodePages().find((c) => c.id === id)?.label.replace(/^EBCDIC \d+ – /, '') ?? null;
      const head = v.ccsid !== undefined ? `CCSID ${number}` : `GCSGID ${v.gcsgid} / CPGID ${number}`;
      return item(null, label ? `${head} · ${label}` : head);
    }
    case 0x02: {
      const key = FQN_TYPES[d[0]] ?? `Type ${hex2(d[0])}`;
      if (d[1] === 0x10) return item(key, v.oid ?? v.nameHex);
      if (d[1] === 0x20) return item(key, String.fromCharCode(...d.subarray(2)));
      return item(key, text ?? '');
    }
    case 0x36:
      return item(null, text ?? '');
    case 0x65:
      return item(null, text ?? '');
    case 0x21:
      return item(null, OBJECT_TYPES[d[0]] ?? `Type ${hex2(d[0])}`);
    case 0x68:
      return item(null, ORIENTATIONS[d[0]] ?? hex2(d[0]));
    case 0x4b: {
      const unit = (base, n) => `${fmt(n / 10)} / ${base === 0 ? 'in' : base === 1 ? 'cm' : hex2(base)}`;
      const x = unit(v.xUnitBase, v.xUnitsPerBase);
      const y = unit(v.yUnitBase, v.yUnitsPerBase);
      return item(null, x === y ? x : `${x} × ${y}`);
    }
    case 0x4c: {
      if (units && units.xUnitsPerBase && units.yUnitsPerBase && units.xUnitBase <= 1 && units.yUnitBase <= 1) {
        // Units per 10 inches or 10 centimeters → millimeters.
        const mm = (n, base, per) => (n * (base === 0 ? 254 : 100)) / per;
        return item(null, `${fmt(mm(v.xSize, units.xUnitBase, units.xUnitsPerBase))} × ${fmt(mm(v.ySize, units.yUnitBase, units.yUnitsPerBase))} mm`);
      }
      return item(null, `${v.xSize} × ${v.ySize}`);
    }
    case 0x4e: {
      const spec = extendedColorSpec(d);
      return spec ? item(spec.space, spec.value, d[1] === 0x06 ? null : extendedColor(d)) : null;
    }
    case 0x62: {
      const kind = { 0x00: 'Created', 0x01: 'Retired', 0x03: 'Revised' }[v.stampType] ?? null;
      const date = new Date(Date.UTC(v.year, 0, Number(v.dayOfYear) || 1));
      const time = v.time.slice(0, 8);
      const when = `${date.toISOString().slice(0, 10)}${time.includes('?') ? '' : ` ${time}`}`;
      return item(kind, when);
    }
    case 0x1f: {
      const parts = [];
      const height = u16(d, 2);
      if (height) parts.push(`${fmt(height / 20)} pt`);
      if (WEIGHTS[d[0]]) parts.push(WEIGHTS[d[0]]);
      if (WIDTHS[d[1]]) parts.push(WIDTHS[d[1]]);
      const flags = d[6] ?? 0;
      if (flags & 0x80) parts.push('Italic');
      if (flags & 0x40) parts.push('Underscored');
      if (flags & 0x10) parts.push('Hollow');
      if (flags & 0x08) parts.push('Overstruck');
      return parts.length ? item(null, parts.join(' · ')) : null;
    }
    default:
      return null;
  }
}
