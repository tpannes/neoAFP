/**
 * TrueType/OpenType font reading (FR-012, FR-058): font names for matching AFP references,
 * metrics for text layout, and the characters a font maps for the character grid.
 *
 * Works on font files (.ttf, .otf, .ttc) and on font bytes from AFP object containers. Only the
 * tables needed here are read (OpenType specification, "Font file", tables `name`, `head`,
 * `hhea`, `hmtx`, `cmap`). The viewer draws the glyphs itself with the browser's FontFace API.
 */

/**
 * Reads an unsigned big-endian number.
 * @param {Uint8Array} d Bytes.
 * @param {number} at Position.
 * @param {number} n Byte count (1–4).
 * @returns {number} Value (0 past the end).
 */
function u(d, at, n) {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + (d[at + i] ?? 0);
  return v;
}

/**
 * Reads a signed 16-bit big-endian number.
 * @param {Uint8Array} d Bytes.
 * @param {number} at Position.
 * @returns {number} Value.
 */
function i16(d, at) {
  const v = u(d, at, 2);
  return v >= 0x8000 ? v - 0x10000 : v;
}

/**
 * Tells whether bytes start like a TrueType/OpenType font or font collection.
 * @param {Uint8Array} d Bytes.
 * @returns {boolean} True for X'00010000', "true", "OTTO" or "ttcf".
 */
export function isFontFile(d) {
  const tag = String.fromCharCode(d[0], d[1], d[2], d[3]);
  return (d[0] === 0 && d[1] === 1 && d[2] === 0 && d[3] === 0) || tag === 'true' || tag === 'OTTO' || tag === 'ttcf';
}

/**
 * Lists the start offsets of the fonts in a file (one for single fonts, several for collections).
 * @param {Uint8Array} d Font file bytes.
 * @returns {number[]} Offsets of the font table directories.
 */
export function fontOffsets(d) {
  if (String.fromCharCode(d[0], d[1], d[2], d[3]) !== 'ttcf') return [0];
  const count = u(d, 8, 4);
  return Array.from({ length: Math.min(count, 256) }, (_, i) => u(d, 12 + 4 * i, 4));
}

/**
 * Reads the table directory of one font.
 * @param {Uint8Array} d Font file bytes.
 * @param {number} base Offset of the font's table directory.
 * @returns {Map<string, {offset: number, length: number}>} Table tag → location.
 */
export function tableDirectory(d, base = 0) {
  const tables = new Map();
  const count = u(d, base + 4, 2);
  for (let i = 0; i < count; i++) {
    const rec = base + 12 + 16 * i;
    if (rec + 16 > d.length) break;
    tables.set(String.fromCharCode(d[rec], d[rec + 1], d[rec + 2], d[rec + 3]), { offset: u(d, rec + 8, 4), length: u(d, rec + 12, 4) });
  }
  return tables;
}

/**
 * Decodes a `name` table string.
 * @param {Uint8Array} d Bytes of the string.
 * @param {number} platform Platform id (0 Unicode, 1 Macintosh, 3 Windows).
 * @returns {string} Text.
 */
function nameString(d, platform) {
  let out = '';
  if (platform === 0 || platform === 3) {
    for (let i = 0; i + 1 < d.length; i += 2) out += String.fromCharCode((d[i] << 8) | d[i + 1]);
  } else {
    for (const b of d) out += String.fromCharCode(b); // Mac Roman: ASCII part is identical
  }
  return out;
}

/**
 * Reads the names of every font in a font file.
 * @param {Uint8Array} d Font file bytes.
 * @returns {{index: number, fullName: string, family: string, subfamily: string, postScriptName: string}[]}
 *   One entry per font (several for collections).
 */
export function readFontNames(d) {
  return fontOffsets(d).map((base, index) => {
    const names = { index, fullName: '', family: '', subfamily: '', postScriptName: '' };
    const table = tableDirectory(d, base).get('name');
    if (!table) return names;
    const t = table.offset;
    const count = u(d, t + 2, 2);
    const strings = t + u(d, t + 4, 2);
    const best = {};
    for (let i = 0; i < count; i++) {
      const r = t + 6 + 12 * i;
      const [platform, , language, nameId, length, offset] = [0, 2, 4, 6, 8, 10].map((o) => u(d, r + o, 2));
      if (![1, 2, 4, 6].includes(nameId)) continue;
      // Prefer Windows US English, then any Windows/Unicode entry, then Macintosh.
      const score = platform === 3 && language === 0x409 ? 3 : platform === 3 || platform === 0 ? 2 : 1;
      if ((best[nameId]?.score ?? 0) >= score) continue;
      best[nameId] = { score, text: nameString(d.subarray(strings + offset, strings + offset + length), platform) };
    }
    names.family = best[1]?.text ?? '';
    names.subfamily = best[2]?.text ?? '';
    names.fullName = best[4]?.text ?? `${names.family} ${names.subfamily}`.trim();
    names.postScriptName = best[6]?.text ?? '';
    return names;
  });
}

/**
 * Reads the character map: Unicode code point → glyph index (formats 4 and 12).
 * @param {Uint8Array} d Font file bytes.
 * @param {{offset: number}} table Location of the `cmap` table.
 * @returns {Map<number, number>} Mapping.
 */
function readCmap(d, table) {
  const t = table.offset;
  const count = u(d, t + 2, 2);
  let best = null;
  for (let i = 0; i < count; i++) {
    const r = t + 4 + 8 * i;
    const platform = u(d, r, 2);
    const encoding = u(d, r + 2, 2);
    const sub = t + u(d, r + 4, 4);
    const format = u(d, sub, 2);
    const score = format === 12 ? 3 : format === 4 && (platform === 3 || platform === 0) ? 2 : 0;
    if (score && (!best || score > best.score)) best = { sub, format, score, encoding };
  }
  const map = new Map();
  if (!best) return map;
  const { sub, format } = best;
  if (format === 12) {
    const groups = u(d, sub + 12, 4);
    for (let g = 0; g < groups; g++) {
      const r = sub + 16 + 12 * g;
      const start = u(d, r, 4);
      const end = Math.min(u(d, r + 4, 4), start + 0xffff);
      const glyph = u(d, r + 8, 4);
      for (let c = start; c <= end; c++) map.set(c, glyph + c - start);
    }
  } else {
    const segs = u(d, sub + 6, 2) / 2;
    const ends = sub + 14;
    const starts = ends + 2 * segs + 2;
    const deltas = starts + 2 * segs;
    const ranges = deltas + 2 * segs;
    for (let i = 0; i < segs; i++) {
      const end = u(d, ends + 2 * i, 2);
      const start = u(d, starts + 2 * i, 2);
      const delta = u(d, deltas + 2 * i, 2);
      const rangeOffset = u(d, ranges + 2 * i, 2);
      for (let c = start; c <= end && c !== 0xffff; c++) {
        let glyph;
        if (rangeOffset === 0) glyph = (c + delta) & 0xffff;
        else {
          const at = ranges + 2 * i + rangeOffset + 2 * (c - start);
          glyph = u(d, at, 2);
          if (glyph) glyph = (glyph + delta) & 0xffff;
        }
        if (glyph) map.set(c, glyph);
      }
    }
  }
  return map;
}

/**
 * Reads the metrics of one font: units per em, ascender/descender, advance widths and cmap.
 * @param {Uint8Array} d Font file bytes.
 * @param {number} [fontIndex] Font in a collection.
 * @returns {{unitsPerEm: number, ascender: number, descender: number,
 *   cmap: Map<number, number>, advance: (glyph: number) => number}} Metrics in font units.
 */
export function readFontMetrics(d, fontIndex = 0) {
  const base = fontOffsets(d)[fontIndex] ?? 0;
  const tables = tableDirectory(d, base);
  const head = tables.get('head');
  const hhea = tables.get('hhea');
  const hmtx = tables.get('hmtx');
  const cmapTable = tables.get('cmap');
  const unitsPerEm = head ? u(d, head.offset + 18, 2) : 1000;
  const ascender = hhea ? i16(d, hhea.offset + 4) : unitsPerEm * 0.8;
  const descender = hhea ? i16(d, hhea.offset + 6) : -unitsPerEm * 0.2;
  const hMetrics = hhea ? u(d, hhea.offset + 34, 2) : 0;
  const advance = (glyph) => {
    if (!hmtx || hMetrics === 0) return unitsPerEm / 2;
    return u(d, hmtx.offset + 4 * Math.min(glyph, hMetrics - 1), 2);
  };
  return { unitsPerEm, ascender, descender, cmap: cmapTable ? readCmap(d, cmapTable) : new Map(), advance };
}
