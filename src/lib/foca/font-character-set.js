/**
 * AFP font character sets: the glyphs of a font and their measurements.
 *
 * A font character set contains, per glyph (named by its GCGID): how far the text position moves
 * after it (character increment), its position relative to the baseline, and either a raster
 * bitmap (raster fonts) or a reference into an outline font program (Type 1 / CID-keyed fonts).
 *
 * Fields (FOCA Reference):
 * - FND Font Descriptor: typeface name (32 bytes EBCDIC), weight/width class, maximum, nominal
 *   and minimum point size (in 1/10 point), …
 * - FNC Font Control: pattern technology (X'05' raster, X'1E' CID-keyed outline, X'1F' Type 1
 *   outline), unit base and units per base (resolution), maximum box size, repeating group
 *   lengths of FNO, FNI, FNP and FNM.
 * - FNO Font Orientation: one repeating group per character rotation (0°, 90°, 180°, 270°) with
 *   space increment, default baseline increment, …
 * - FNP Font Position: per orientation: lowercase/cap height, max ascender/descender,
 *   underscore width and position.
 * - FNI Font Index: one per orientation (may be split into segments); repeating groups of GCGID,
 *   character increment, ascender height, descender depth, pattern map index, A-space, B-space,
 *   C-space and baseline offset.
 * - FNM Font Patterns Map: per pattern: box width − 1, box height − 1, offset into FNG data.
 * - FNG Font Patterns: raster bitmaps (rows padded to whole bytes) or the outline font program.
 * - FNN Font Name Map: outline fonts: GCGID → glyph name (Type 1) or CID.
 */

import { collectFields, fieldData, joinSegments, concat } from '../modca/access.js';
import { u, s, ebcdicName, orientation } from '../modca/bytes.js';

const FND = 0xd3a689;
const FNC = 0xd3a789;
const FNM = 0xd3a289;
const FNO = 0xd3ae89;
const FNP = 0xd3ac89;
const FNI = 0xd38c89;
const FNN = 0xd3ab89;
const FNG = 0xd3ee89;

/** Pattern technology codes from the Font Control field. */
const TECHNOLOGY = new Map([[0x05, 'raster'], [0x1e, 'cid'], [0x1f, 'type1']]);

/**
 * @typedef {object} GlyphMetrics
 * @property {number} inc Character increment (advance) in font units.
 * @property {number} asc Ascender height.
 * @property {number} desc Descender depth.
 * @property {number} a A-space (space before the glyph box; may be negative).
 * @property {number} b B-space (glyph box width along the baseline).
 * @property {number} c C-space (space after the glyph box).
 * @property {number} baseOffset Distance from the top of the box to the baseline.
 * @property {number} pattern Index into the pattern map.
 */

/**
 * @typedef {object} FontCharacterSet
 * @property {string} name Resource name, e.g. "C0H20000".
 * @property {string} typeface Typeface name from the descriptor.
 * @property {'raster'|'type1'|'cid'|'other'} technology Glyph technology.
 * @property {number} unitsPerInch Font units per inch for raster fonts (= resolution in dpi;
 *   metrics given in relative units are converted to pels at this resolution).
 * @property {number} unitsPerEm Relative units per em for outline fonts (from Font Control).
 * @property {number} nominalPointSize Nominal size in 1/10 point (0 if not given).
 * @property {{rotation: number, spaceInc: number, baselineInc: number, emInc: number}[]} orientations
 *   Per character rotation: space increment, default baseline increment and em-space increment.
 * @property {Map<string, GlyphMetrics>[]} metrics Per orientation: GCGID → metrics.
 * @property {{width: number, height: number, offset: number}[]} patterns Pattern map.
 * @property {Uint8Array} patternData Concatenated pattern (FNG) data.
 * @property {{underscoreWidth: number, underscorePosition: number, maxAscender: number,
 *   maxDescender: number}[]} positions Per orientation: font position values.
 * @property {Map<string, string|number>} nameMap Outline fonts: GCGID → glyph name or CID.
 */

/**
 * Reads a font character set resource.
 * @param {import('../modca/access.js').FileRecord} file File containing the font.
 * @param {number} beginRow Row of its Begin Font field.
 * @returns {Promise<FontCharacterSet>} The font.
 */
export async function readFontCharacterSet(file, beginRow) {
  const name = ebcdicName(await fieldData(file, beginRow));
  const fields = await collectFields(file, beginRow, new Set([FND, FNC, FNM, FNO, FNP, FNI, FNN, FNG]));
  const byId = (id) => fields.filter((f) => f.id === id);
  const font = {
    name,
    typeface: '',
    technology: 'other',
    unitsPerInch: 0,
    unitsPerEm: 1000,
    nominalPointSize: 0,
    orientations: [],
    metrics: [],
    patterns: [],
    patternData: new Uint8Array(0),
    positions: [],
    nameMap: new Map(),
  };
  let rg = { fno: 26, fni: 28, fnp: 22, fnm: 8, fnn: 12 };
  let nameMapCount = 0;
  const [fnd] = byId(FND);
  if (fnd) {
    font.typeface = ebcdicName(fnd.data, 0, 32);
    font.nominalPointSize = u(fnd.data, 36, 2);
  }
  const [fnc] = byId(FNC);
  /** Raster fonts with relative metrics: units per em (else 0). */
  let relativeUnits = 0;
  if (fnc) {
    const d = fnc.data;
    font.technology = TECHNOLOGY.get(d[1]) ?? 'other';
    const xBase = d[4];
    const xUnits = u(d, 6, 2);
    if (font.technology === 'raster' && xBase === 2) {
      // Relative metrics (FOCA Font Control: unit base X'02'): increments, A-space, baseline
      // offset … are in 1/xUnits em; the bitmaps have their own resolution (Shape Resolution,
      // bytes 24–25, in units per 10 inches). Converted to pels below.
      relativeUnits = xUnits || 1000;
      font.unitsPerInch = d.length >= 26 && u(d, 24, 2) ? u(d, 24, 2) / 10 : 300;
    } else if (font.technology === 'raster') font.unitsPerInch = xBase === 0 ? xUnits / 10 : xUnits / 10 * 2.54;
    else font.unitsPerEm = xUnits || 1000;
    rg = { fno: d[14] || 26, fni: d[15] || 28, fnp: d[20] || 22, fnm: d[21] || 8, fnn: d[35] || 12 };
    nameMapCount = d.length >= 42 ? u(d, 40, 2) : 0;
  }
  for (const { data } of byId(FNO)) {
    for (let pos = 0; pos + 26 <= data.length; pos += rg.fno) {
      font.orientations.push({
        rotation: orientation(u(data, pos + 2, 2)),
        spaceInc: u(data, pos + 8, 2),
        baselineInc: u(data, pos + 22, 2),
        emInc: u(data, pos + 14, 2),
      });
    }
  }
  for (const { data } of byId(FNP)) {
    for (let pos = 0; pos + 22 <= data.length; pos += rg.fnp) {
      font.positions.push({
        maxAscender: u(data, pos + 6, 2),
        maxDescender: u(data, pos + 8, 2),
        underscoreWidth: u(data, pos + 17, 2),
        underscorePosition: u(data, pos + 20, 2),
      });
    }
  }
  for (const data of joinSegments(byId(FNI), file.index)) {
    const map = new Map();
    for (let pos = 0; pos + 28 <= data.length; pos += rg.fni) {
      map.set(ebcdicName(data, pos, 8), {
        inc: u(data, pos + 8, 2),
        asc: s(data, pos + 10, 2),
        desc: s(data, pos + 12, 2),
        pattern: u(data, pos + 16, 2),
        a: s(data, pos + 18, 2),
        b: u(data, pos + 20, 2),
        c: s(data, pos + 22, 2),
        baseOffset: s(data, pos + 26, 2),
      });
    }
    font.metrics.push(map);
  }
  for (const { data } of byId(FNM)) {
    for (let pos = 0; pos + 8 <= data.length; pos += rg.fnm) {
      font.patterns.push({ width: u(data, pos, 2) + 1, height: u(data, pos + 2, 2) + 1, offset: u(data, pos + 4, 4) });
    }
  }
  font.patternData = concat(byId(FNG).map((f) => f.data));
  if (relativeUnits) toPels(font, relativeUnits);
  // The name map can be split over several FNN fields without the segmentation flag (seen in
  // outline fonts whose offsets point into the second field), so all FNN data is joined.
  readNameMap(font, [concat(byId(FNN).map((f) => f.data))], rg.fnn, nameMapCount);
  return font;
}

/**
 * Turns the relative metrics of a raster font into pels at its bitmap resolution, so it can be
 * used like any raster font: one em is the nominal size (Font Descriptor, 1/10 point; 10 point
 * when not given). Checked on raster fonts with relative metrics: the converted black width and
 * baseline offset of each character match its bitmap.
 * @param {FontCharacterSet} font Raster font with relative metrics (changed in place).
 * @param {number} unitsPerEm Relative units per em.
 * @returns {void}
 */
function toPels(font, unitsPerEm) {
  const emPels = ((font.nominalPointSize || 100) / 10 / 72) * font.unitsPerInch;
  const k = emPels / unitsPerEm;
  const scale = (o, keys) => { for (const key of keys) if (typeof o[key] === 'number') o[key] *= k; };
  for (const o of font.orientations) scale(o, ['spaceInc', 'baselineInc', 'emInc']);
  for (const p of font.positions) scale(p, ['maxAscender', 'maxDescender', 'underscoreWidth', 'underscorePosition']);
  for (const map of font.metrics) for (const m of map.values()) scale(m, ['inc', 'asc', 'desc', 'a', 'b', 'c', 'baseOffset']);
}

/**
 * Reads the Font Name Map of an outline font: GCGID → glyph name (Type 1) or CID (CID-keyed).
 * Layout found in practice: a 2-byte header, then repeating groups of GCGID (8) and
 * offset (4) into the name area that follows them; each name is a length byte (counting itself)
 * followed by the name (ASCII for Type 1, a 2-byte CID for CID-keyed fonts). The header length is derived from
 * the first offset, which must point just past the last repeating group.
 * @param {FontCharacterSet} font Font to fill.
 * @param {Uint8Array[]} parts FNN data (one per logical field).
 * @param {number} rgLen Repeating group length.
 * @param {number} mapCount Number of repeating groups from Font Control (0 if unknown).
 * @returns {void}
 */
function readNameMap(font, parts, rgLen, mapCount) {
  for (const data of parts) {
    let header = -1;
    for (const h of [0, 2, 4]) {
      const first = u(data, h + 8, 4);
      const count = (first - h) / rgLen;
      if (Number.isInteger(count) && count > 0 && first <= data.length && (!mapCount || count === mapCount)) {
        header = h;
        break;
      }
    }
    if (header < 0) continue;
    const groups = (u(data, header + 8, 4) - header) / rgLen;
    for (let i = 0; i < groups; i++) {
      const pos = header + i * rgLen;
      const gcgid = ebcdicName(data, pos, 8);
      const off = u(data, pos + 8, 4);
      const len = data[off]; // counts itself
      if (len < 2 || off + len > data.length) continue;
      const nameBytes = data.subarray(off + 1, off + len);
      font.nameMap.set(gcgid, font.technology === 'cid' ? u(nameBytes, 0, nameBytes.length)
        : String.fromCharCode(...nameBytes));
    }
  }
}

/**
 * Returns the raster bitmap of a glyph.
 * @param {FontCharacterSet} font Raster font.
 * @param {number} patternIndex Index from the glyph metrics.
 * @returns {{width: number, height: number, rowBytes: number, bits: Uint8Array}|null} Bitmap with
 *   rows of `rowBytes` bytes, most significant bit = leftmost pixel; null if missing.
 */
export function glyphBitmap(font, patternIndex) {
  const p = font.patterns[patternIndex];
  if (!p) return null;
  const rowBytes = Math.ceil(p.width / 8);
  const end = p.offset + rowBytes * p.height;
  if (end > font.patternData.length) return null;
  return { width: p.width, height: p.height, rowBytes, bits: font.patternData.subarray(p.offset, end) };
}

/**
 * Finds the metrics table for a character rotation.
 * @param {FontCharacterSet} font Font.
 * @param {number} rotation Character rotation in degrees.
 * @returns {Map<string, GlyphMetrics>} Metrics (the first orientation if none matches).
 */
export function metricsFor(font, rotation) {
  const i = font.orientations.findIndex((o) => o.rotation === rotation);
  return font.metrics[i >= 0 ? i : 0] ?? new Map();
}
