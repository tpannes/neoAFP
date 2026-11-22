/**
 * Resource previews for the resource viewer (FR-051, FR-054, FR-058):
 * - render models of page segments, overlays, images, graphics, bar codes and object containers
 *   (moved so their object areas start at the origin and the model has their size; without an
 *   object area, the extent of the drawn items; overlays keep their page size);
 * - a sample text preview of TrueType/OpenType fonts: the full font name and
 *   "AaBbCc 0123 ÄÖÜ", drawn in the font;
 * - the character grid of a font: every glyph of an AFP font character set with its identifier
 *   and size, or every character of a TrueType/OpenType font with its code point and advance;
 * - the table of a code page: code point, GCGID and whether a Unicode character is known for it;
 * - coded fonts: the name and SAMPLE drawn with the referenced character set through the
 *   referenced code page (a placeholder naming what is missing otherwise), and as character grid
 *   every code point of the code page with its glyph;
 * - form definitions: a diagram of a medium map (see formdef-diagram.js).
 * Font character sets, code pages, ICC profiles and CMRs have no visual preview (null).
 */

import { readEnvironment, renderContent } from './page-renderer.js';
import { readFontCharacterSet, metricsFor } from '../foca/font-character-set.js';
import { readCodePage } from '../foca/code-page.js';
import { gcgidToUnicode, learnFromCodePage, unicodeOfGcgid, isControl } from '../foca/gcgid-unicode.js';
import { readFontMetrics } from '../foca/opentype.js';
import { fontBytesOf } from './fonts.js';
import { contentBox } from '../resources/catalog.js';
import { readCodedFont } from '../foca/coded-font.js';
import { formDefinitionDiagram } from './formdef-diagram.js';

const SAMPLE = 'AaBbCc 0123 ÄÖÜ';
const OBJECT_TYPES = new Set(['image', 'graphics', 'barcode', 'objectContainer']);

/**
 * Bounding box of render items (page units).
 * @param {object[]} items Render items.
 * @returns {{x0: number, y0: number, x1: number, y1: number}|null} Box.
 */
export function itemBounds(items) {
  let box = null;
  const add = (x, y) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    box = box ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) } : { x0: x, y0: y, x1: x, y1: y };
  };
  for (const it of items) {
    if (it.rect) { add(it.rect.x, it.rect.y); add(it.rect.x + it.rect.width, it.rect.y + it.rect.height); }
    if ('x1' in it) { add(it.x1, it.y1); add(it.x2, it.y2); }
    if (it.commands) for (const c of it.commands) for (let i = 1; i + 1 < c.length; i += 2) add(c[i], c[i + 1]);
    if (it.type === 'glyphRun') {
      const size = it.font?.size ?? 240;
      const width = (it.dx?.[it.dx.length - 1] ?? 0) + size * 0.6;
      add(it.x, it.y - size); add(it.x + width, it.y + size * 0.3);
    }
  }
  return box;
}

/**
 * Renders a resource for its preview.
 * @param {object} ctx Render context of the file holding the resource.
 * @param {object} file File record.
 * @param {object} record Internal resource record.
 * @param {(item: object, dx: number, dy: number) => object} translate Moves a render item.
 * @returns {Promise<{widthUnits: number, heightUnits: number, items: object[]}|null>} Model.
 */
export async function resourceRenderModel(ctx, file, record, translate) {
  const row = record._entry.beginRow;
  if (record.type === 'truetypeFont') return fontSample(ctx, record);
  if (row < 0) return null;
  if (record.type === 'codedFont') return codedFontSample(ctx, file, record);
  if (record.type === 'formDefinition') return formDefinitionDiagram(ctx, file, row, null, translate);
  if (record.type === 'overlay') {
    const env = await readEnvironment(file, row);
    const items = await renderContent(ctx, file, row, env, { x: 0, y: 0 });
    return { widthUnits: env.width, heightUnits: env.height, items };
  }
  let items;
  if (record.type === 'pageSegment') items = await renderContent(ctx, file, row, await readEnvironment(file, row), { x: 0, y: 0 });
  else if (OBJECT_TYPES.has(record.type) && record.hasPreview) items = await renderContent(ctx, file, file.index.parent[row], await readEnvironment(file, row), { x: 0, y: 0 });
  else return null;
  // Objects that are rendered from their parent: keep only this object's items.
  if (record.type !== 'pageSegment') items = items.filter((it) => it.sourceField === row || it.sourceField === undefined);
  // The area of the objects (as in the resource list), else the extent of what was drawn.
  const box = (await contentBox(file, row)) ?? itemBounds(items);
  if (!box) return { widthUnits: 1440, heightUnits: 1440, items: [] };
  return {
    widthUnits: Math.max(1, box.x1 - box.x0),
    heightUnits: Math.max(1, box.y1 - box.y0),
    items: items.map((it) => translate(it, -box.x0, -box.y0)),
  };
}

/**
 * Sample text of a TrueType/OpenType font: its full name and SAMPLE.
 * @param {object} ctx Render context.
 * @param {object} record Resource record.
 * @returns {Promise<object>} Render model.
 */
async function fontSample(ctx, record) {
  const em = 480; // 24 pt
  const font = await ctx.fonts.resolve({ dataObject: { name: record.name, height: em } });
  const lines = [record.name, SAMPLE];
  let width = 0;
  const items = lines.map((text, i) => {
    const codes = [...text].map((ch) => ch.charCodeAt(0));
    const glyphs = codes.map((c) => font.glyph(c));
    const dx = [];
    let x = 0;
    for (const g of glyphs) { dx.push(x); x += g.advance; }
    width = Math.max(width, x);
    return {
      type: 'glyphRun', x: 240, y: 240 + em * (i + 1) * 1.3, rotation: 0, color: '#000000', font: font.descriptor,
      ids: glyphs.map((g) => g.id), dx, chars: glyphs.map((g) => g.unicode), text, codes, sourceField: record._entry.beginRow, fileId: record.source.fileId,
    };
  });
  return { widthUnits: width + 480, heightUnits: em * 1.3 * lines.length + 480, items };
}

/**
 * Resolves the character set and code page of a coded font (its first section).
 * @param {object} ctx Render context.
 * @param {object} file File record of the coded font.
 * @param {object} record Resource record.
 * @returns {Promise<{characterSet: string, codePage: string, found: {characterSet: boolean,
 *   codePage: boolean}, font: object|null}>} Names, which of them were found, and the font (null
 *   if a part is missing).
 */
async function resolveCodedFont(ctx, file, record) {
  const cf = await readCodedFont(file, record._entry.beginRow);
  const part = cf.parts[0] ?? { fcsName: '', cpName: '', verticalSize: 0 };
  const found = {
    characterSet: Boolean(part.fcsName && await ctx.catalog.lookup('fontCharacterSet', part.fcsName, ctx.lookupContext)),
    codePage: Boolean(part.cpName && await ctx.catalog.lookup('codePage', part.cpName, ctx.lookupContext)),
  };
  const font = found.characterSet && found.codePage
    ? await ctx.fonts.resolve({ characterSet: part.fcsName, codePage: part.cpName, height: part.verticalSize ? part.verticalSize * 2 : null })
    : null;
  return { characterSet: part.fcsName, codePage: part.cpName, found, font };
}

/**
 * Sample text of a coded font: its name and SAMPLE, drawn with its character set through its
 * code page; characters the code page does not have are left out.
 * @param {object} ctx Render context.
 * @param {object} file File record.
 * @param {object} record Resource record.
 * @returns {Promise<object>} Render model (a placeholder naming the missing parts if the
 *   character set or code page is not available).
 */
async function codedFontSample(ctx, file, record) {
  const { characterSet, codePage, found, font } = await resolveCodedFont(ctx, file, record);
  const src = { sourceField: record._entry.beginRow, fileId: record.source.fileId };
  if (!font || !font.cp) {
    const missing = [!found.characterSet && characterSet, !found.codePage && codePage].filter(Boolean).join(', ');
    return { widthUnits: 4800, heightUnits: 1440, items: [{ type: 'placeholder', rect: { x: 0, y: 0, width: 4800, height: 1440 },
      reason: `missing: ${missing || 'character set and code page'}`, resourceName: `${characterSet || '?'} + ${codePage || '?'}`, ...src }] };
  }
  // Unicode → code point of the code page (first code point wins).
  const codeOf = new Map();
  for (const [code, { gcgid }] of [...font.cp.map.entries()].sort((a, b) => a[0] - b[0])) {
    const ch = gcgidToUnicode(gcgid);
    if (ch && !codeOf.has(ch)) codeOf.set(ch, code);
  }
  const lineHeight = Math.max(font.baselineIncrement, 240);
  const margin = lineHeight * 0.5;
  let width = 0;
  const items = [record.name, SAMPLE].map((text, i) => {
    const codes = [...text].map((ch) => codeOf.get(ch)).filter((c) => c !== undefined);
    const glyphs = codes.map((c) => font.glyph(c));
    const dx = [];
    let x = 0;
    for (const g of glyphs) { dx.push(x); x += g.advance; }
    width = Math.max(width, x);
    return {
      type: 'glyphRun', x: margin, y: margin + lineHeight * (i + 0.8), rotation: 0, color: '#000000', font: font.descriptor,
      ids: glyphs.map((g) => g.id), dx, chars: glyphs.map((g) => g.unicode), text: glyphs.map((g) => g.unicode).join(''), codes, ...src,
    };
  });
  return { widthUnits: width + 2 * margin, heightUnits: lineHeight * 2.2 + 2 * margin, items };
}

/**
 * Common box of the raster glyphs of a font, so a character grid can draw them all at one
 * scale on one baseline (scaling each glyph to its cell made "a" as tall as "A").
 * @param {object} fcs Font character set.
 * @param {Iterable<{pattern: number, baseOffset?: number}>} metrics Glyph metrics.
 * @returns {{ascent: number, descent: number, width: number}|null} Pels above and below the
 *   baseline and widest glyph; null for outline fonts or without glyphs.
 */
function rasterExtent(fcs, metrics) {
  if (fcs.technology !== 'raster') return null;
  let ascent = 0;
  let descent = 0;
  let width = 0;
  for (const m of metrics) {
    const p = fcs.patterns[m.pattern];
    if (!p?.height) continue;
    const base = m.baseOffset ?? p.height;
    ascent = Math.max(ascent, base);
    descent = Math.max(descent, p.height - base);
    width = Math.max(width, p.width);
  }
  return ascent + descent > 0 ? { ascent, descent, width } : null;
}

/**
 * Character map of a coded font: every code point of its code page with the glyph of its
 * character set.
 * @param {object} ctx Render context.
 * @param {object} file File record.
 * @param {object} record Resource record of a coded font.
 * @returns {Promise<object>} `{ kind: 'raster'|'outline'|null, fontRef, resolution, unitsPerEm,
 *   characterSet, codePage, found: {characterSet, codePage}, doubleByte, glyphs: [{ codePoint,
 *   gcgid, id (glyph id for getGlyphs), width, height, increment, available }] }` (no glyphs if a
 *   part is missing).
 */
export async function codedFontGrid(ctx, file, record) {
  const { characterSet, codePage, found, font } = await resolveCodedFont(ctx, file, record);
  const base = { characterSet, codePage, found, kind: null, fontRef: null, resolution: null, unitsPerEm: null, glyphs: [] };
  if (!font?.cp || !font.fcs) return base;
  const glyphs = [...font.cp.map.entries()].sort((a, b) => a[0] - b[0]).map(([codePoint, { gcgid }]) => {
    const m = font.metrics.get(gcgid);
    const p = m ? font.fcs.patterns[m.pattern] : null;
    return { codePoint, gcgid, id: font.glyph(codePoint).id, width: p?.width ?? 0, height: p?.height ?? 0, increment: m?.inc ?? 0, available: Boolean(m) };
  });
  return { ...base, kind: font.kind, fontRef: font.ref, resolution: font.fcs.unitsPerInch || null,
    extent: rasterExtent(font.fcs, font.metrics.values()),
    unitsPerEm: font.kind === 'outline' ? font.fcs.unitsPerEm : null, doubleByte: Boolean(font.cp.doubleByte), glyphs };
}

/**
 * Lists the characters of a font.
 * @param {object} file File record.
 * @param {object} record Resource record (font character set or TrueType/OpenType font).
 * @param {(fcs: object) => string} registerAfp Registers a glyph handle for an AFP font and
 *   returns its reference (for getGlyphs).
 * @returns {Promise<object|null>} `{ kind: 'raster'|'outline', fontRef, resolution, unitsPerEm,
 *   extent, glyphs: [{ gcgid, id, width, height, increment }] }` for AFP fonts (`extent`: see
 *   rasterExtent) (`id` is what getGlyphs
 *   takes: the GCGID of raster fonts, the glyph name or CID of outline fonts, as on pages), `{ kind: 'truetype',
 *   unitsPerEm, glyphs: [{ codePoint, advance }] }` for TrueType/OpenType fonts, else null.
 */
export async function fontCharacterGrid(file, record, registerAfp) {
  if (record.type === 'truetypeFont') {
    const bytes = await fontBytesOf(file, record._entry);
    const m = readFontMetrics(bytes, record._entry.fontIndex ?? 0);
    const glyphs = [...m.cmap.entries()].filter(([cp, g]) => g !== 0 && cp >= 0x20).sort((a, b) => a[0] - b[0])
      .map(([codePoint, g]) => ({ codePoint, advance: m.advance(g) }));
    return { kind: 'truetype', unitsPerEm: m.unitsPerEm, glyphs };
  }
  if (record.type !== 'fontCharacterSet') return null;
  const fcs = await readFontCharacterSet(file, record._entry.beginRow);
  const kind = fcs.technology === 'raster' ? 'raster' : 'outline';
  const glyphs = [...metricsFor(fcs, 0).entries()].map(([gcgid, m]) => {
    const p = fcs.patterns[m.pattern];
    // Outline fonts keep their glyphs under the names the character set maps GCGIDs to (as in
    // page rendering, fonts.js); asking by GCGID finds nothing and left every cell empty.
    const id = kind === 'outline' ? (fcs.nameMap?.get(gcgid) ?? gcgid) : gcgid;
    return { gcgid, id, width: p?.width ?? 0, height: p?.height ?? 0, increment: m.inc };
  });
  return { kind, fontRef: registerAfp(fcs, kind), resolution: fcs.unitsPerInch || null, extent: rasterExtent(fcs, metricsFor(fcs, 0).values()), unitsPerEm: kind === 'outline' ? fcs.unitsPerEm : null, glyphs };
}

/**
 * Builds a glyph handle for an AFP font character set (used by getGlyphs).
 * @param {object} fcs Font character set.
 * @param {'raster'|'outline'} kind Technology.
 * @returns {object} Handle without reference.
 */
export function afpGlyphHandle(fcs, kind) {
  return { kind, fcs, metrics: metricsFor(fcs, 0), descriptor: { kind, name: fcs.name } };
}

/**
 * Lists the code points of a code page.
 * @param {object} file File record.
 * @param {object} record Resource record.
 * @returns {Promise<{codePoint: number, gcgid: string, unicode: string|null, glyphAvailable: boolean,
 *   kind: 'char'|'space'|'control'|'unknown', unicodeCodePoint: number|null}[]|null>} Entries by
 *   code point; `glyphAvailable` tells whether the character can be shown, `kind` how.
 */
export async function codePageTable(file, record) {
  if (record.type !== 'codePage') return null;
  const cp = await readCodePage(file, record._entry.beginRow);
  await learnFromCodePage(cp);
  return [...cp.map.entries()].sort((a, b) => a[0] - b[0]).map(([codePoint, { gcgid }]) => {
    const unicode = gcgidToUnicode(gcgid) ?? null;
    const named = unicodeOfGcgid(gcgid);
    const scalar = unicode ? unicode.codePointAt(0) : named;
    // What the character column shows: the character, a space (invisible), a control
    // character (by its code point) or "unknown".
    let kind = 'unknown';
    if (unicode) kind = unicode.trim() === '' ? 'space' : 'char';
    else if (named !== null && isControl(named)) kind = 'control';
    return { codePoint, gcgid, unicode, glyphAvailable: Boolean(unicode), kind, unicodeCodePoint: scalar ?? null };
  });
}
