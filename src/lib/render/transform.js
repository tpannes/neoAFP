/**
 * Placing render items: moves items by an offset after turning them clockwise by 0, 90, 180 or
 * 270 degrees about the origin (page units, y down). MO:DCA turns included presentation spaces
 * this way — an overlay about its origin (IPO OvlyOrent, PMC Resource Object Include ObOrent), a
 * page on the medium about its origin (PGP PGorient): the X axis turns clockwise by the angle and
 * the Y axis is always 90° further. A point (x, y) of the turned space lies at
 * (dx + x·cos θ − y·sin θ, dy + x·sin θ + y·cos θ).
 *
 * Items: glyph runs (start point; their own rotation grows by the angle), rules (both ends),
 * paths (every point), images and PDF pages (rectangle origin; they turn about it by their own
 * rotation, which grows by the angle), placeholders and clip rectangles (axis-parallel boxes:
 * turned by a multiple of 90° they stay axis-parallel, so the turned box is exact).
 */

/**
 * Turns a point and moves it.
 * @param {number} x X.
 * @param {number} y Y.
 * @param {{dx: number, dy: number, cos: number, sin: number}} t Transform.
 * @returns {[number, number]} Point.
 */
function point(x, y, t) {
  return [t.dx + x * t.cos - y * t.sin, t.dy + x * t.sin + y * t.cos];
}

/**
 * Turns an axis-parallel box and moves it.
 * @param {{x: number, y: number, width: number, height: number}} r Box.
 * @param {object} t Transform.
 * @returns {{x: number, y: number, width: number, height: number}} Box.
 */
function box(r, t) {
  const [ax, ay] = point(r.x, r.y, t);
  const [bx, by] = point(r.x + r.width, r.y + r.height, t);
  return { ...r, x: Math.min(ax, bx), y: Math.min(ay, by), width: Math.abs(bx - ax), height: Math.abs(by - ay) };
}

/**
 * Places one render item.
 * @param {object} item Render item.
 * @param {{dx?: number, dy?: number, rotation?: number}} place Offset (page units) and clockwise
 *   rotation (0, 90, 180 or 270 degrees) applied before the offset.
 * @returns {object} A placed copy (the item itself when nothing changes).
 */
export function placeItem(item, { dx = 0, dy = 0, rotation = 0 } = {}) {
  const turn = ((rotation % 360) + 360) % 360;
  if (!dx && !dy && !turn) return item;
  const rad = (turn * Math.PI) / 180;
  const t = { dx, dy, cos: Math.round(Math.cos(rad)), sin: Math.round(Math.sin(rad)) };
  const out = { ...item };
  if (item.type === 'glyphRun' || ('x' in item && 'y' in item && !item.rect)) {
    [out.x, out.y] = point(item.x, item.y, t);
    if (turn) out.rotation = ((item.rotation ?? 0) + turn) % 360;
  }
  if ('x1' in item) {
    [out.x1, out.y1] = point(item.x1, item.y1, t);
    [out.x2, out.y2] = point(item.x2, item.y2, t);
  }
  if (item.commands) {
    out.commands = item.commands.map((c) => {
      if (c[0] === 'Z') return c;
      const next = [c[0]];
      for (let i = 1; i + 1 < c.length; i += 2) next.push(...point(c[i], c[i + 1], t));
      return next;
    });
  }
  if (item.rect) {
    if (item.type === 'image' || item.type === 'pdf') {
      // Images and PDF pages turn about their rectangle origin by their own rotation.
      const [x, y] = point(item.rect.x, item.rect.y, t);
      out.rect = { ...item.rect, x, y };
      if (turn) out.rotation = ((item.rotation ?? 0) + turn) % 360;
    } else {
      out.rect = box(item.rect, t);
    }
  }
  if (item.clip) out.clip = box(item.clip, t);
  return out;
}

/**
 * Places render items.
 * @param {object[]} items Items.
 * @param {{dx?: number, dy?: number, rotation?: number}} place Offset and rotation.
 * @returns {object[]} Placed copies.
 */
export function placeItems(items, place) {
  return items.map((item) => placeItem(item, place));
}
