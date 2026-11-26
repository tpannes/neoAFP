/**
 * Page renderer: turns a page (or overlay, or page segment) into a render model — a display list
 * of positioned items in page units (1/1440 inch) that the viewer draws (research R4,
 * data-model "RenderModel").
 *
 * A page has an active environment group (page size, measurement units, font mappings) followed
 * by objects: presentation text, images, graphics, bar codes, object containers, and includes of
 * page segments (which use the page's environment) and overlays (which have their own). Objects
 * that cannot be shown become placeholders with a diagnostic; one failing object never stops the
 * page (FR-040, FR-080).
 */

import { fieldData, childRows } from '../modca/access.js';
import {
  decodePGD, decodePTD, decodeMCF1, decodeMCF2, decodeMDR, decodeInclude, decodeOBP, decodeOBD,
} from '../modca/structures.js';
import { toPageUnits } from '../modca/bytes.js';
import { runPtoca, extendedColor } from '../ptoca/ptoca.js';
import { extendedColorSpec, colorSpecField } from './color-spec.js';
import { findTestPrint } from './test-print.js';
import { placeItems } from './transform.js';
import { decodeIncludePage, findIncludedPage } from './include-page.js';

const ID = {
  BAG: 0xd3a8c9, PGD: 0xd3a6af, PTD1: 0xd3a69b, PTD2: 0xd3b19b, MCF1: 0xd3b18a, MCF2: 0xd3ab8a,
  MDR: 0xd3abc3, BPT: 0xd3a89b, PTX: 0xd3ee9b, IPS: 0xd3af5f, IPO: 0xd3afd8, BII: 0xd3a87b,
  BIM: 0xd3a8fb, BGR: 0xd3a8bb, BBC: 0xd3a8eb, BOC: 0xd3a892, IOB: 0xd3afc3, BOG: 0xd3a8c7,
  OBD: 0xd3a66b, OBP: 0xd3ac6b, IPG: 0xd3afaf,
};

/** Object types whose renderers are added by later tasks; registered with registerObjectRenderer. */
const objectRenderers = new Map();

/**
 * Registers a renderer for an object type (e.g. IM image, IOCA image, graphics).
 * @param {number} beginId Begin field identifier of the object.
 * @param {(r: object, file: object, row: number, env: object, origin: object, area?: object) => Promise<object[]>} renderer
 *   Returns render items in page units; `area` (optional) replaces the object's own object area
 *   when the object is included with Include Object.
 * @returns {void}
 */
export function registerObjectRenderer(beginId, renderer) {
  objectRenderers.set(beginId, renderer);
}

/**
 * Returns the renderer registered for an object type.
 * @param {number} beginId Begin field identifier.
 * @returns {Function|null} Renderer, or null.
 */
export function objectRendererFor(beginId) {
  return objectRenderers.get(beginId) ?? null;
}

/**
 * @typedef {object} Environment
 * @property {number} width Presentation space width in page units.
 * @property {number} height Presentation space height in page units.
 * @property {number} kx Page units per X measurement unit of this page/overlay.
 * @property {number} ky Page units per Y measurement unit.
 * @property {Map<number, object>} fonts Local font id → font spec.
 * @property {object|null} ptd Text descriptor (for presentation text).
 */

/**
 * Reads the active environment group of a page or overlay.
 * @param {object} file File record.
 * @param {number} groupRow Row of Begin Page or Begin Overlay.
 * @param {Environment|null} inherit Environment to start from (for page segments).
 * @returns {Promise<Environment>} Environment.
 */
export async function readEnvironment(file, groupRow, inherit = null) {
  const env = inherit ? { ...inherit, fonts: new Map(inherit.fonts) }
    : { width: 12240, height: 15840, kx: 1, ky: 1, fonts: new Map(), ptd: null, missingDescriptor: true };
  const { index } = file;
  const bag = childRows(index, groupRow).find((r) => index.id[r] === ID.BAG);
  if (bag === undefined) return env;
  for (const row of childRows(index, bag)) {
    const id = index.id[row];
    if (![ID.PGD, ID.PTD1, ID.PTD2, ID.MCF1, ID.MCF2, ID.MDR].includes(id)) continue;
    const d = await fieldData(file, row);
    if (id === ID.PGD) {
      const pgd = decodePGD(d);
      env.kx = toPageUnits(pgd.xBase, pgd.xUnits);
      env.ky = toPageUnits(pgd.yBase, pgd.yUnits);
      env.width = pgd.width * env.kx;
      env.height = pgd.height * env.ky;
      env.missingDescriptor = !(pgd.width && pgd.height);
    } else if (id === ID.PTD1 || id === ID.PTD2) {
      env.ptd = decodePTD(d, id === ID.PTD1 ? 1 : 2);
    } else if (id === ID.MCF1 || id === ID.MCF2) {
      for (const m of id === ID.MCF1 ? decodeMCF1(d) : decodeMCF2(d)) {
        env.fonts.set(m.localId, { codedFont: m.codedFont, characterSet: m.characterSet, codePage: m.codePage,
          rotation: m.rotation, height: m.height ?? null });
      }
    } else if (id === ID.MDR) {
      for (const m of decodeMDR(d)) {
        if (m.font && m.localId !== null) {
          env.fonts.set(m.localId, { dataObject: { name: m.name, height: m.font.height || null }, rotation: m.font.rotation });
        }
      }
    }
  }
  return env;
}

/**
 * Font mapping of an object (T300): the including environment's fonts, overridden by Map Coded
 * Font fields in the object's environment group (MO:DCA allows them for graphics objects).
 * @param {object} file File record.
 * @param {number} objectRow Row of the object's Begin field.
 * @param {Environment} env Environment of the including page.
 * @returns {Promise<Map<number, object>>} Local font id → font spec.
 */
export async function readObjectFonts(file, objectRow, env) {
  const fonts = new Map(env.fonts);
  const { index } = file;
  const oeg = childRows(index, objectRow).find((r) => index.id[r] === ID.BOG);
  if (oeg === undefined) return fonts;
  for (const row of childRows(index, oeg)) {
    const id = index.id[row];
    if (id !== ID.MCF1 && id !== ID.MCF2) continue;
    const d = await fieldData(file, row);
    for (const m of id === ID.MCF1 ? decodeMCF1(d) : decodeMCF2(d)) {
      fonts.set(m.localId, { codedFont: m.codedFont, characterSet: m.characterSet, codePage: m.codePage, rotation: m.rotation, height: m.height ?? null });
    }
  }
  return fonts;
}

/**
 * Reads the object area (Object Area Descriptor/Position in the object environment group).
 * @param {object} file File record.
 * @param {number} objectRow Row of the object's Begin field.
 * @param {Environment} env Environment of the including page.
 * @param {object|null} [override] Area given by an Include Object field, which replaces the
 *   object's own area.
 * @returns {Promise<{x: number, y: number, width: number|null, height: number|null, rotation: number,
 *   contentX: number, contentY: number, mappingOption: number|null, unitX?: number, unitY?: number}|null>}
 *   Area in page units (unitX/unitY: page units per area unit), or null.
 */
export async function readObjectArea(file, objectRow, env, override = null) {
  if (override) return override;
  const { index } = file;
  const oeg = childRows(index, objectRow).find((r) => index.id[r] === ID.BOG);
  if (oeg === undefined) return null;
  // mappingOption stays null when no Map … Object field gives one; each object type then uses
  // its architected default (MO:DCA MIO, MGO, MCD: scale to fit; MBC: position).
  const area = { x: 0, y: 0, width: null, height: null, rotation: 0, contentX: 0, contentY: 0, mappingOption: null, color: null };
  for (const row of childRows(index, oeg)) {
    const id = index.id[row];
    if (id === ID.OBP) {
      const p = decodeOBP(await fieldData(file, row));
      Object.assign(area, { x: p.x * env.kx, y: p.y * env.ky, rotation: p.rotation, contentX: p.contentX * env.kx, contentY: p.contentY * env.ky });
    } else if (id === ID.OBD) {
      const data = await fieldData(file, row);
      const o = decodeOBD(data);
      const found = areaColor(data);
      area.color = found?.color ?? null;
      area.colorSpec = found?.spec ?? null;
      if (o.areaSize) {
        const fx = o.units ? toPageUnits(o.units.xBase, o.units.xUnits) : env.kx;
        const fy = o.units ? toPageUnits(o.units.yBase, o.units.yUnits) : env.ky;
        area.width = o.areaSize.width * fx;
        area.height = o.areaSize.height * fy;
        area.unitX = fx;
        area.unitY = fy;
      }
    } else if ((index.id[row] & 0xffff00) === 0xd3ab00) {
      // Map Image/Graphics/Bar Code Object, Map Container Data: mapping option triplet.
      const d = await fieldData(file, row);
      for (let p = 2; p + 2 < d.length;) {
        const len = d[p];
        if (len < 2) break;
        if (d[p + 1] === 0x04) area.mappingOption = d[p + 2];
        p += len;
      }
    }
  }
  return area;
}

/**
 * Reads the object area color: a Color Specification triplet (X'4E') on the Object Area
 * Descriptor colors the whole object area before the object is presented (MO:DCA, Object Area
 * Descriptor). Its layout after length and identifier matches Set Extended Text Color.
 * @param {Uint8Array} d Object Area Descriptor data (triplets only).
 * @returns {{color: string, spec: object|null}|null} Color as #rrggbb and as given, or null without one.
 */
function areaColor(d) {
  for (let p = 0; p + 2 <= d.length;) {
    const len = d[p];
    if (len < 2 || p + len > d.length) break;
    if (d[p + 1] === 0x4e && len >= 13) {
      const color = extendedColor(d.subarray(p + 2, p + len));
      return color && { color, spec: extendedColorSpec(d.subarray(p + 2, p + len)) };
    }
    p += len;
  }
  return null;
}

/**
 * Fills an object's area with its area color (see areaColor), turned with the area.
 * @param {object} file File record.
 * @param {number} row Begin row of the object.
 * @param {object} env Environment of the including page.
 * @param {{x: number, y: number}} origin Origin in page units.
 * @returns {Promise<object[]>} A filled path, or nothing.
 */
async function areaBackground(file, row, env, origin) {
  const area = await readObjectArea(file, row, env);
  if (!area?.color || !area.width || !area.height) return [];
  const rad = ((area.rotation ?? 0) * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad) * 1e12) / 1e12;
  const sin = Math.round(Math.sin(rad) * 1e12) / 1e12;
  const x0 = origin.x + area.x;
  const y0 = origin.y + area.y;
  const [a, b, c, d] = [[0, 0], [area.width, 0], [area.width, area.height], [0, area.height]]
    .map(([x, y]) => [x0 + x * cos - y * sin, y0 + x * sin + y * cos]);
  return [{
    type: 'path', commands: [['M', ...a], ['L', ...b], ['L', ...c], ['L', ...d], ['Z']],
    fill: area.color, ...colorSpecField(area.colorSpec), stroke: null, lineWidth: 0, sourceField: row, fileId: file.id,
  }];
}

/**
 * Unit vector of a direction in degrees (y grows downwards).
 * @param {number} deg Direction.
 * @returns {[number, number]} x and y component.
 */
const dir = (deg) => [Math.round(Math.cos((deg * Math.PI) / 180) * 1e9) / 1e9, Math.round(Math.sin((deg * Math.PI) / 180) * 1e9) / 1e9];

/**
 * Maps a text position (inline i, baseline b) to page coordinates.
 * @param {number} i Inline coordinate (page units).
 * @param {number} b Baseline coordinate (page units).
 * @param {number} iDeg Inline direction.
 * @param {number} bDeg Baseline direction.
 * @param {{x: number, y: number, width: number, height: number}} space Text presentation space.
 * @returns {[number, number]} Page x and y.
 */
export function textToPage(i, b, iDeg, bDeg, space) {
  const [ix, iy] = dir(iDeg);
  const [bx, by] = dir(bDeg);
  const cornerX = ix < 0 || bx < 0 ? space.width : 0;
  const cornerY = iy < 0 || by < 0 ? space.height : 0;
  return [space.x + cornerX + i * ix + b * bx, space.y + cornerY + i * iy + b * by];
}

/**
 * Renders a presentation text object.
 * @param {object} r Render context.
 * @param {object} file File record.
 * @param {number} row Row of Begin Presentation Text Object.
 * @param {Environment} env Environment.
 * @param {{x: number, y: number}} origin Origin of the including page/segment in page units.
 * @returns {Promise<object[]>} Glyph runs and rules.
 */
async function renderText(r, file, row, env, origin) {
  const { index } = file;
  const ptd = env.ptd;
  const kx = ptd ? toPageUnits(ptd.xBase, ptd.xUnits) : env.kx;
  const area = await readObjectArea(file, row, env);
  const space = {
    x: origin.x + (area?.x ?? 0),
    y: origin.y + (area?.y ?? 0),
    width: area?.width ?? (ptd ? ptd.width * kx : env.width),
    height: area?.height ?? (ptd ? ptd.height * toPageUnits(ptd.yBase, ptd.yUnits) : env.height),
  };
  const parts = [];
  /** Field row of each part (the Presentation Text Data field; the descriptor for initial text). */
  const partRows = [];
  if (ptd?.initialText?.length) { parts.push(ptd.initialText); partRows.push(row); }
  for (const child of childRows(index, row)) {
    if (index.id[child] === ID.PTX) { parts.push(await fieldData(file, child)); partRows.push(child); }
  }
  const fonts = new Map();
  for (const [lid, spec] of env.fonts) fonts.set(lid, await r.fonts.resolve(spec));
  if (fonts.size === 0) fonts.set(0, await r.fonts.resolve({ codedFont: '' }));
  const defaultFont = fonts.values().next().value;
  const { segments, rules } = runPtoca(parts, {
    k: kx,
    suppressed: env.suppressed ?? null,
    font: (lid) => fonts.get(lid) ?? defaultFont,
    report: (code, params) => r.report({ severity: 'warning', code, fileId: file.id, offset: index.offset[row], params: { file: file.path, ...params } }),
  });
  const items = [];
  for (const seg of segments) {
    const font = fonts.get(seg.lid) ?? defaultFont;
    const [x, y] = textToPage(seg.i, seg.b, seg.iDeg, seg.bDeg, space);
    // Extent of the run (for the "content outside the page" check, content-bounds.js): length
    // along the inline direction to the end of the last glyph, and an estimate of ascent and
    // descent from the font's baseline increment.
    const last = seg.glyphs[seg.glyphs.length - 1];
    const lineHeight = font.baselineIncrement || 240;
    const extent = { inline: last ? last.di + (font.glyph(last.code)?.advance ?? 0) : 0, ascent: lineHeight * 0.7, descent: lineHeight * 0.2 };
    items.push({
      type: 'glyphRun', x, y, rotation: seg.iDeg, color: seg.color, ...colorSpecField(seg.colorSpec), font: font.descriptor, extent,
      ids: seg.glyphs.map((g) => g.id), dx: seg.glyphs.map((g) => g.di),
      chars: seg.glyphs.map((g) => g.unicode), text: seg.glyphs.map((g) => g.unicode).join(''), codes: seg.glyphs.map((g) => g.code),
      sourceField: row, textField: partRows[seg.part] ?? row, fileId: file.id,
    });
  }
  for (const rule of rules) {
    const half = rule.width / 2;
    const [ia, ib, ja, jb] = rule.axis === 'I'
      ? [rule.i, rule.b + half, rule.i + rule.length, rule.b + half]
      : [rule.i + half, rule.b, rule.i + half, rule.b + rule.length];
    const [x1, y1] = textToPage(ia, ib, rule.iDeg, rule.bDeg, space);
    const [x2, y2] = textToPage(ja, jb, rule.iDeg, rule.bDeg, space);
    // Like glyph runs, rules (underscores, DIR/DBR lines) know the PTX field that drew them.
    items.push({ type: 'rule', x1, y1, x2, y2, thickness: Math.abs(rule.width), color: rule.color, ...colorSpecField(rule.colorSpec), sourceField: row,
      textField: partRows[rule.part] ?? row, fileId: file.id });
  }
  return items;
}

/**
 * Marks items that an Include field brought in with that field: `via` lists the Include fields
 * from the outermost file inward (with the kind and name of the overlay or page segment), so the
 * viewer can say where an element comes from and a click on an element from a resource file can
 * lead to a field of the shown document. Objects with included data (Include Object) are marked
 * only when their items come from another file.
 * @param {object[]} items Render items.
 * @param {object} file File holding the Include field.
 * @param {number} row Include field row (or the row of an object with an included resource).
 * @param {{type: string, name: string}} [included] Kind and name of the included resource.
 * @returns {object[]} The same items.
 */
function throughInclude(items, file, row, included = null) {
  for (const item of items) {
    if (included || (item.fileId !== undefined && item.fileId !== file.id)) item.via = [{ fileId: file.id, row, ...included }, ...(item.via ?? [])];
  }
  return items;
}

/**
 * Renders the objects inside a page, overlay or page segment.
 * @param {object} r Render context.
 * @param {object} file File record.
 * @param {number} groupRow Row of Begin Page, Begin Overlay or Begin Page Segment.
 * @param {Environment} env Environment to use.
 * @param {{x: number, y: number}} origin Offset in page units.
 * @param {number} depth Include depth (stops runaway recursion).
 * @returns {Promise<object[]>} Render items.
 */
export async function renderContent(r, file, groupRow, env, origin, depth = 0) {
  const { index } = file;
  const items = [];
  for (const row of childRows(index, groupRow)) {
    const id = index.id[row];
    try {
      if (id === ID.BPT) {
        items.push(...await renderText(r, file, row, env, origin));
      } else if (id === ID.IPS || id === ID.IPO) {
        if (depth > 4) continue;
        const inc = decodeInclude(await fieldData(file, row));
        const type = id === ID.IPS ? 'pageSegment' : 'overlay';
        const entry = await r.catalog.lookup(type, inc.name, r.lookupContext);
        const at = { x: origin.x + inc.x * env.kx, y: origin.y + inc.y * env.ky };
        if (!entry) {
          r.missing(type, inc.name, file);
          items.push({ type: 'placeholder', rect: { x: at.x, y: at.y, width: 1440, height: 720 }, reason: 'missingResource', resourceName: inc.name, resourceType: type, sourceField: row, fileId: file.id });
          continue;
        }
        const rf = r.getFile(entry.fileId);
        const subEnv = type === 'overlay' ? { ...await readEnvironment(rf, entry.beginRow), suppressed: env.suppressed } : env;
        // A page overlay may be turned about its origin (IPO OvlyOrent, T278): draw it at the
        // origin, then turn and move it. Page segments are never turned.
        const turn = id === ID.IPO ? (inc.rotation ?? 0) : 0;
        const drawn = turn
          ? placeItems(await renderContent(r, rf, entry.beginRow, subEnv, { x: 0, y: 0 }, depth + 1), { dx: at.x, dy: at.y, rotation: turn })
          : await renderContent(r, rf, entry.beginRow, subEnv, at, depth + 1);
        items.push(...throughInclude(drawn, file, row, { type, name: inc.name }));
      } else if (id === ID.IPG) {
        // Include Page in page state (T280): the included page becomes part of this page.
        if (depth > 4) continue;
        const ipg = decodeIncludePage(await fieldData(file, row));
        const pageRow = await findIncludedPage(file, ipg);
        if (pageRow === null) {
          r.missing('page', ipg.document ? `${ipg.document}/${ipg.name}` : ipg.name, file);
          items.push({ type: 'placeholder', rect: { x: origin.x, y: origin.y, width: 1440, height: 720 }, reason: 'missingResource', resourceName: ipg.name, resourceType: 'page', sourceField: row, fileId: file.id });
          continue;
        }
        const pageEnv = { ...await readEnvironment(file, pageRow), suppressed: env.suppressed };
        items.push(...throughInclude(await renderContent(r, file, pageRow, pageEnv, origin, depth + 1), file, row, { type: 'page', name: ipg.name }));
      } else if (objectRenderers.has(id)) {
        const background = await areaBackground(file, row, env, origin);
        items.push(...throughInclude([...background, ...await objectRenderers.get(id)(r, file, row, env, origin)], file, row));
      } else if ([ID.BII, ID.BIM, ID.BGR, ID.BBC, ID.BOC, ID.IOB].includes(id)) {
        // Object types without a renderer yet (registered by later tasks).
        items.push(await placeholderFor(r, file, row, env, origin, 'notYetSupported'));
      }
    } catch (error) {
      r.report({ severity: 'error', code: 'decodeFailed', fileId: file.id, offset: index.offset[row], params: { file: file.path, reason: String(error?.message ?? error) } });
      items.push(await placeholderFor(r, file, row, env, origin, 'decodeFailed').catch(() => ({ type: 'placeholder', rect: { x: origin.x, y: origin.y, width: 720, height: 720 }, reason: 'decodeFailed', sourceField: row, fileId: file.id })));
    }
  }
  return items;
}

/**
 * Builds a placeholder for an object that is not (yet) shown, sized by its object area.
 * @param {object} r Render context.
 * @param {object} file File record.
 * @param {number} row Begin row of the object.
 * @param {Environment} env Environment.
 * @param {{x: number, y: number}} origin Offset in page units.
 * @param {string} reason Why the object is replaced.
 * @returns {Promise<object>} Placeholder item.
 */
export async function placeholderFor(r, file, row, env, origin, reason) {
  const area = await readObjectArea(file, row, env);
  const rect = { x: origin.x + (area?.x ?? 0), y: origin.y + (area?.y ?? 0), width: area?.width ?? 1440, height: area?.height ?? 1440 };
  return { type: 'placeholder', rect, reason, sourceField: row, fileId: file.id, objectId: file.index.id[row] };
}

/**
 * Renders one page.
 * @param {object} r Render context (fonts, catalog, report, getFile, lookupContext, missing).
 * @param {object} file Document file record.
 * @param {number} pageRow Row of Begin Page.
 * @param {{suppressed?: Set<number>|null, textOnly?: boolean}} [options] Active text suppression
 *   local IDs; `textOnly`: only the text matters (search index), so the word "TEST" drawn from
 *   strokes is not looked for and 2D bar codes, which have no text, are left out (env.textOnly).
 * @returns {Promise<{widthUnits: number, heightUnits: number, items: object[], unitsPerInch: {x: number, y: number}}>}
 *   Render model; `unitsPerInch`: the page's own measurement units (Page Descriptor).
 */
export async function renderPage(r, file, pageRow, { suppressed = null, textOnly = false } = {}) {
  const env = await readEnvironment(file, pageRow);
  // Active text suppressions of the sheet-side the page is printed on (MMC X'F3', T284).
  env.suppressed = suppressed;
  env.textOnly = textOnly;
  if (env.missingDescriptor) {
    r.report({ severity: 'warning', code: 'decodeFailed', fileId: file.id, offset: file.index.offset[pageRow], params: { file: file.path, reason: 'page descriptor missing; using 8.5 × 11 in' } });
  }
  const items = await renderContent(r, file, pageRow, env, { x: 0, y: 0 });
  // The word "TEST" drawn from strokes is marked so the viewer can hide it.
  if (!textOnly) for (const i of findTestPrint(items)) items[i].testPrint = true;
  return { widthUnits: env.width, heightUnits: env.height, items, unitsPerInch: { x: 1440 / env.kx, y: 1440 / env.ky } };
}
