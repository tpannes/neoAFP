/**
 * Form definition diagrams for the resource viewer: one medium map drawn as a sheet of paper
 * (front, and back next to it for duplex), with
 * - the page areas of the map, numbered in the order pages fill the sheet (front 1…n, back
 *   n+1…2n, as in the sheet model, formdef/sheets.js): for N-up the equal partitions of the
 *   sheet (2 and 3 across the long side, 4 as 2 × 2; page positions are offsets inside a
 *   partition), otherwise the area from the page position to the sheet edge; each number is
 *   turned by the page's orientation, and upside down on the back of a tumble duplex sheet;
 * - the medium overlays of the map, drawn in place on every side.
 * Words are left to the viewer (translated captions and settings table); the drawing has only
 * numbers. Without a medium size, the sheet is A4 portrait.
 */

import { readFormDefinition } from '../formdef/formdef.js';
import { readEnvironment, renderContent } from './page-renderer.js';

const A4 = { width: 11906, height: 16838 };
const ACCENT = '#2563eb';

/**
 * Lists the medium maps of a form definition with their settings.
 * @param {object} file File record.
 * @param {number} row Row of Begin Form Map.
 * @returns {Promise<{name: string, mediumMaps: object[]}>} Form definition (medium sizes and
 *   page positions in page units, 1/1440 inch).
 */
export async function formDefinitionSummary(file, row) {
  const fd = await readFormDefinition(file, row);
  return { name: fd.name, mediumMaps: [...fd.mediumMaps.values()].map((m) => ({ ...m, pagePositions: m.pagePositions.map((p) => ({ ...p })) })) };
}

/**
 * Page areas on one side of a sheet.
 * @param {number} nUp Pages per side (1–4).
 * @param {{x: number, y: number, rotation: number}[]} positions Page positions of the map.
 * @param {{width: number, height: number}} sheet Sheet size.
 * @returns {{x: number, y: number, width: number, height: number, rotation: number}[]} One area
 *   per page, in page order.
 */
export function pageAreas(nUp, positions, sheet) {
  const rotationOf = (i) => (positions[i] ?? positions[0])?.rotation ?? 0;
  if (nUp <= 1) {
    const p = positions[0] ?? { x: 0, y: 0 };
    const x = Math.min(Math.max(0, p.x), sheet.width - 1);
    const y = Math.min(Math.max(0, p.y), sheet.height - 1);
    return [{ x, y, width: sheet.width - x, height: sheet.height - y, rotation: rotationOf(0) }];
  }
  const portrait = sheet.height >= sheet.width;
  const [cols, rows] = nUp === 4 ? [2, 2] : portrait ? [1, nUp] : [nUp, 1];
  const w = sheet.width / cols;
  const h = sheet.height / rows;
  return Array.from({ length: nUp }, (_, i) => ({ x: (i % cols) * w, y: Math.floor(i / cols) * h, width: w, height: h, rotation: rotationOf(i) }));
}

/**
 * A number drawn as text (substitute font, so no font resource is needed).
 * @param {string} text Digits.
 * @param {number} cx Center x.
 * @param {number} cy Center y.
 * @param {number} size Font size in page units.
 * @param {number} rotation Rotation in degrees (clockwise).
 * @returns {object} Glyph run.
 */
function label(text, cx, cy, size, rotation) {
  const chars = [...text];
  const advance = size * 0.6;
  const half = (advance * chars.length) / 2;
  // Start point of the baseline, turned around the center.
  const rad = (rotation * Math.PI) / 180;
  const ox = -half;
  const oy = size * 0.35;
  return {
    type: 'glyphRun', x: cx + ox * Math.cos(rad) - oy * Math.sin(rad), y: cy + ox * Math.sin(rad) + oy * Math.cos(rad),
    rotation, color: ACCENT, font: { kind: 'substitute', family: 'sans-serif', size, charRotation: 0, name: 'diagram' },
    ids: chars, dx: chars.map((_, i) => i * advance), chars, text, codes: [],
  };
}

/**
 * A rectangle as a path item.
 * @param {number} x Left.
 * @param {number} y Top.
 * @param {number} w Width.
 * @param {number} h Height.
 * @param {string|null} fill Fill color.
 * @param {string|null} stroke Stroke color.
 * @param {number} lineWidth Line width.
 * @returns {object} Path item.
 */
function rect(x, y, w, h, fill, stroke, lineWidth) {
  return { type: 'path', commands: [['M', x, y], ['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h], ['Z']], fill, stroke, lineWidth };
}

/**
 * Draws one medium map of a form definition.
 * @param {object} ctx Render context (catalog, files, fonts) of the form definition's file.
 * @param {object} file File record.
 * @param {number} row Row of Begin Form Map.
 * @param {string|null} mapName Medium map name; null for the first one.
 * @param {(item: object, dx: number, dy: number) => object} translate Moves a render item.
 * @returns {Promise<{widthUnits: number, heightUnits: number, items: object[]}>} Render model.
 */
export async function formDefinitionDiagram(ctx, file, row, mapName, translate) {
  const fd = await readFormDefinition(file, row);
  const map = (mapName && fd.mediumMaps.get(mapName)) || fd.first;
  const sheet = map?.mediumSize ?? A4;
  const src = { sourceField: row, fileId: file.id };
  if (!map) return { widthUnits: sheet.width, heightUnits: sheet.height, items: [{ ...rect(0, 0, sheet.width, sheet.height, '#ffffff', '#5b6470', sheet.width * 0.006), ...src }] };
  const sides = map.duplex === 'simplex' ? 1 : 2;
  const gap = sheet.width * 0.08;
  const perSide = Math.max(1, map.nUp);
  const areas = pageAreas(perSide, map.pagePositions, sheet);
  const overlays = [];
  for (const name of map.mediumOverlays) {
    const entry = await ctx.catalog.lookup('overlay', name, ctx.lookupContext);
    if (!entry) continue;
    const ov = ctx.getFile(entry.fileId);
    overlays.push(await renderContent(ctx, ov, entry.beginRow, await readEnvironment(ov, entry.beginRow), { x: 0, y: 0 }));
  }
  const items = [];
  for (let side = 0; side < sides; side++) {
    const ox = side * (sheet.width + gap);
    const back = side === 1;
    const tumble = back && map.duplex === 'tumble';
    items.push({ ...rect(ox, 0, sheet.width, sheet.height, back ? '#f4f6f9' : '#ffffff', null, 0), ...src });
    for (const ov of overlays) for (const it of ov) items.push(translate(it, ox, 0));
    areas.forEach((a, i) => {
      // Tumble: the back is turned upside down, so its areas and numbers are too.
      const x = tumble ? sheet.width - a.x - a.width : a.x;
      const y = tumble ? sheet.height - a.y - a.height : a.y;
      const inset = Math.min(a.width, a.height) * 0.03;
      items.push({ ...rect(ox + x + inset, y + inset, a.width - 2 * inset, a.height - 2 * inset, 'rgba(37, 99, 235, 0.07)', ACCENT, sheet.width * 0.004), ...src });
      const size = Math.min(a.width, a.height) * 0.3;
      items.push({ ...label(String(side * perSide + i + 1), ox + x + a.width / 2, y + a.height / 2, size, (a.rotation + (tumble ? 180 : 0)) % 360), ...src });
    });
    items.push({ ...rect(ox, 0, sheet.width, sheet.height, null, '#5b6470', sheet.width * 0.006), ...src });
  }
  return { widthUnits: sides * sheet.width + (sides - 1) * gap, heightUnits: sheet.height, items };
}
