/**
 * Hit testing on a render model ("click on the page to inspect", FR-034): which drawn item lies
 * under a point, and where its box is. Coordinates are page units (1/1440 inch) of the model.
 *
 * Each item is tested in its own shape, the way the canvas renderer draws it:
 * - glyph runs: the line box from the start of the first to the end of the last character, one
 *   font size above the baseline and 0.3 below, turned by the run's rotation;
 * - rules: the distance to the line, at least half the thickness;
 * - paths: the box of their points (filled areas and lines alike);
 * - images and PDF areas: their rectangle, turned around its top-left corner by the rotation;
 * - placeholders: their rectangle.
 * An item mapped with "… and trim" is hit only inside its clip rectangle. Items without a source
 * field, glyph runs of blanks only (they draw nothing), and test print marks when hidden, are not
 * hit.
 *
 * Several items can lie under one point (text on a background image, a box around a table);
 * the smallest one wins, as it is the one a click most likely aims at; on equal size the one
 * drawn last.
 */

/** Line box of a glyph run relative to its baseline, in font sizes. */
const ASCENT = 1;
const DESCENT = 0.3;
/** Width given to the last character of a run, in font sizes (the library knows no widths). */
const LAST_ADVANCE = 0.6;
/** Font size assumed when a run has none. */
const DEFAULT_SIZE = 240;

/**
 * Turns a point into an item's own coordinates (translated to its origin, rotation undone).
 * @param {number} x Point x.
 * @param {number} y Point y.
 * @param {number} ox Origin x.
 * @param {number} oy Origin y.
 * @param {number} rotation Rotation in degrees (clockwise, as drawn).
 * @returns {[number, number]} Local coordinates.
 */
function toLocal(x, y, ox, oy, rotation) {
  const dx = x - ox;
  const dy = y - oy;
  if (!rotation) return [dx, dy];
  const a = (-rotation * Math.PI) / 180;
  return [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)];
}

/**
 * Box of a rectangle turned around a corner, as an axis-aligned box.
 * @param {number} ox Corner x.
 * @param {number} oy Corner y.
 * @param {number} x0 Local left.
 * @param {number} y0 Local top.
 * @param {number} x1 Local right.
 * @param {number} y1 Local bottom.
 * @param {number} rotation Rotation in degrees.
 * @returns {{x: number, y: number, width: number, height: number}} Box in page units.
 */
function turnedBox(ox, oy, x0, y0, x1, y1, rotation) {
  const a = ((rotation ?? 0) * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([px, py]) => [ox + px * cos - py * sin, oy + px * sin + py * cos]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/**
 * Local extent of a glyph run.
 * @param {object} run Glyph run.
 * @returns {{x0: number, y0: number, x1: number, y1: number}} Extent relative to the run's origin.
 */
function runExtent(run) {
  const size = run.font?.size ?? DEFAULT_SIZE;
  const dx = run.dx ?? [];
  return { x0: Math.min(0, dx[0] ?? 0), y0: -size * ASCENT, x1: (dx.at(-1) ?? 0) + size * LAST_ADVANCE, y1: size * DESCENT };
}

/**
 * Box of the points of a path.
 * @param {any[][]} commands Path commands ('M', 'L', 'Q', 'C' with coordinates, 'Z').
 * @returns {{x: number, y: number, width: number, height: number}|null} Box, or null without points.
 */
function pathBox(commands) {
  const xs = [];
  const ys = [];
  for (const c of commands) {
    for (let i = 1; i + 1 < c.length; i += 2) {
      xs.push(c[i]);
      ys.push(c[i + 1]);
    }
  }
  if (!xs.length) return null;
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The axis-aligned box an item covers (for outlining it).
 * @param {object} item Render item.
 * @returns {{x: number, y: number, width: number, height: number}|null} Box in page units, or null.
 */
export function itemBox(item) {
  let box = null;
  if (item.type === 'glyphRun') {
    const e = runExtent(item);
    box = turnedBox(item.x, item.y, e.x0, e.y0, e.x1, e.y1, item.rotation);
  } else if (item.type === 'rule') {
    const half = Math.max(item.thickness ?? 0, 1) / 2;
    const x = Math.min(item.x1, item.x2) - half;
    const y = Math.min(item.y1, item.y2) - half;
    box = { x, y, width: Math.abs(item.x2 - item.x1) + 2 * half, height: Math.abs(item.y2 - item.y1) + 2 * half };
  } else if (item.type === 'path') {
    box = pathBox(item.commands ?? []);
    const half = (item.lineWidth ?? 0) / 2;
    if (box && half) box = { x: box.x - half, y: box.y - half, width: box.width + 2 * half, height: box.height + 2 * half };
  } else if (item.rect && (item.type === 'image' || item.type === 'pdf')) {
    box = turnedBox(item.rect.x, item.rect.y, 0, 0, item.rect.width, item.rect.height, item.rotation);
  } else if (item.rect) {
    box = { ...item.rect };
  }
  if (box && item.clip) box = intersect(box, item.clip);
  return box;
}

/**
 * Intersection of two boxes.
 * @param {{x: number, y: number, width: number, height: number}} a Box.
 * @param {{x: number, y: number, width: number, height: number}} b Box.
 * @returns {{x: number, y: number, width: number, height: number}|null} Overlap, or null.
 */
function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const btm = Math.min(a.y + a.height, b.y + b.height);
  return r >= x && btm >= y ? { x, y, width: r - x, height: btm - y } : null;
}

/**
 * Tests one item at a point.
 * @param {object} item Render item.
 * @param {number} x Point x.
 * @param {number} y Point y.
 * @param {number} tolerance Extra margin in page units (thin lines, small text).
 * @returns {number|null} The item's area when hit (smaller wins), else null.
 */
function hitArea(item, x, y, tolerance) {
  const c = item.clip;
  if (c && (x < c.x - tolerance || y < c.y - tolerance || x > c.x + c.width + tolerance || y > c.y + c.height + tolerance)) return null;
  const inside = (lx, ly, x0, y0, x1, y1) => lx >= x0 - tolerance && lx <= x1 + tolerance && ly >= y0 - tolerance && ly <= y1 + tolerance;
  if (item.type === 'glyphRun') {
    const e = runExtent(item);
    const [lx, ly] = toLocal(x, y, item.x, item.y, item.rotation);
    return inside(lx, ly, e.x0, e.y0, e.x1, e.y1) ? (e.x1 - e.x0) * (e.y1 - e.y0) : null;
  }
  if (item.type === 'rule') {
    const half = Math.max(item.thickness ?? 0, 1) / 2;
    const vx = item.x2 - item.x1;
    const vy = item.y2 - item.y1;
    const len2 = vx * vx + vy * vy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - item.x1) * vx + (y - item.y1) * vy) / len2)) : 0;
    const dist = Math.hypot(x - (item.x1 + t * vx), y - (item.y1 + t * vy));
    return dist <= half + tolerance ? Math.sqrt(len2) * 2 * half : null;
  }
  if ((item.type === 'image' || item.type === 'pdf') && item.rect) {
    const [lx, ly] = toLocal(x, y, item.rect.x, item.rect.y, item.rotation);
    return inside(lx, ly, 0, 0, item.rect.width, item.rect.height) ? item.rect.width * item.rect.height : null;
  }
  const box = itemBox(item);
  if (!box) return null;
  return inside(x, y, box.x, box.y, box.x + box.width, box.y + box.height) ? Math.max(box.width, 1) * Math.max(box.height, 1) : null;
}

/**
 * Finds the item under a point.
 * @param {{items: object[]}} model Render model.
 * @param {number} x Point x in page units.
 * @param {number} y Point y in page units.
 * @param {{tolerance?: number, hideTestPrint?: boolean}} [options] Margin in page units around
 *   thin items (about 4 screen pixels), and whether test print marks are hidden.
 * @returns {number} Index of the item in `model.items`, or −1.
 */
export function hitTest(model, x, y, { tolerance = 0, hideTestPrint = false } = {}) {
  return hitAll(model, x, y, { tolerance, hideTestPrint })[0] ?? -1;
}

/**
 * Finds every item under a point, the one a click most likely aims at first: smallest first, on
 * equal size the one drawn last (the color picker steps through them for stacked elements).
 * @param {{items: object[]}} model Render model.
 * @param {number} x Point x in page units.
 * @param {number} y Point y in page units.
 * @param {{tolerance?: number, hideTestPrint?: boolean, withoutSource?: boolean}} [options]
 *   tolerance: extra distance in page units for thin items; hideTestPrint: skip test print marks;
 *   withoutSource: also items without a source field (resource previews).
 * @returns {number[]} Item indexes.
 */
export function hitAll(model, x, y, { tolerance = 0, hideTestPrint = false, withoutSource = false } = {}) {
  const hits = [];
  model.items.forEach((item, i) => {
    if (!withoutSource && (item.sourceField === undefined || item.sourceField === null)) return;
    if (item.testPrint && hideTestPrint) return;
    if (item.type === 'glyphRun' && !(item.text ?? (item.chars ?? []).join('')).trim()) return;
    const area = hitArea(item, x, y, tolerance);
    if (area !== null) hits.push([i, area]);
  });
  return hits.sort((a, b) => a[1] - b[1] || b[0] - a[0]).map(([i]) => i);
}

/**
 * Finds the page a point lies on (a sheet side can hold several pages, N-up).
 * @param {{pageAreas?: {pageNumber: number, x: number, y: number, width: number, height: number}[]}} model
 *   Render model.
 * @param {number} x Point x in page units.
 * @param {number} y Point y in page units.
 * @returns {object|null} Page area, or null outside every page.
 */
export function pageAt(model, x, y) {
  return (model.pageAreas ?? []).find((a) => x >= a.x && y >= a.y && x <= a.x + a.width && y <= a.y + a.height) ?? null;
}
