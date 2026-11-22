/**
 * Content outside the page (FR-097): finds drawn items of a render model that reach beyond the
 * page edges — text, images, lines and graphics placed partly off the page are cut off in print,
 * a classic error that is easy to miss on screen.
 *
 * Bounds per item (page units, y down): images and placeholders by their rectangle (the clip
 * rectangle when there is one); rules by their end points and thickness; paths by all their
 * points (control points of curves included, so curves are judged generously); rules are thick
 * only across their direction; glyph runs by
 * their start point, length along the inline direction and ascent/descent across it (`extent`
 * from page-renderer.js; else an estimate from the font size). Overflow below TOLERANCE is
 * ignored (rounding, glyphs that touch the edge).
 */

/** Overflow ignored, in page units (1/1440 inch): 0.5 mm. */
export const TOLERANCE = 28;

/** Item type → content kind reported. */
const KINDS = { glyphRun: 'text', image: 'image', rule: 'line', path: 'graphics', placeholder: 'object' };

/**
 * Bounding box of a glyph run.
 * @param {object} item Glyph run.
 * @returns {{x0: number, y0: number, x1: number, y1: number}} Box.
 */
function runBounds(item) {
  const em = item.font?.size || 240;
  const dx = item.dx ?? [];
  const e = item.extent ?? { inline: (dx[dx.length - 1] ?? 0) + em * 0.6, ascent: em * 0.75, descent: em * 0.25 };
  const a = ((item.rotation ?? 0) * Math.PI) / 180;
  const ix = Math.cos(a);
  const iy = Math.sin(a);
  // Baseline progression: the inline direction turned by 90° (y down); ascent points against it.
  const bx = -iy;
  const by = ix;
  const xs = [];
  const ys = [];
  for (const along of [0, e.inline]) {
    for (const across of [-e.ascent, e.descent]) {
      xs.push(item.x + ix * along + bx * across);
      ys.push(item.y + iy * along + by * across);
    }
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * Bounding box of one render item.
 * @param {object} item Render item.
 * @returns {{x0: number, y0: number, x1: number, y1: number}|null} Box in page units, or null.
 */
export function itemBounds(item) {
  if (item.type === 'glyphRun') return runBounds(item);
  if (item.type === 'rule') {
    // A rule is thick only across its direction: a frame drawn exactly to the page edge must not
    // count as sticking out at its ends.
    const h = (item.thickness ?? 0) / 2;
    const hx = item.x1 === item.x2 || item.y1 !== item.y2 ? h : 0;
    const hy = item.y1 === item.y2 || item.x1 !== item.x2 ? h : 0;
    return { x0: Math.min(item.x1, item.x2) - hx, y0: Math.min(item.y1, item.y2) - hy, x1: Math.max(item.x1, item.x2) + hx, y1: Math.max(item.y1, item.y2) + hy };
  }
  if (item.type === 'path') {
    let box = null;
    for (const c of item.commands ?? []) {
      for (let i = 1; i + 1 < c.length; i += 2) {
        const [x, y] = [c[i], c[i + 1]];
        box = box ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) } : { x0: x, y0: y, x1: x, y1: y };
      }
    }
    if (box && item.stroke && item.lineWidth) {
      const h = item.lineWidth / 2;
      box = { x0: box.x0 - h, y0: box.y0 - h, x1: box.x1 + h, y1: box.y1 + h };
    }
    return box;
  }
  const r = item.clip ?? item.rect;
  if (!r || !(r.width > 0) || !(r.height > 0)) return null;
  if (!item.clip && item.rotation && (item.type === 'image' || item.type === 'pdf')) {
    // Images turn about their rectangle origin by their own rotation.
    const rad = (item.rotation * Math.PI) / 180;
    const [c, s] = [Math.round(Math.cos(rad)), Math.round(Math.sin(rad))];
    const xs = [0, r.width].flatMap((w) => [0, r.height].map((h) => r.x + w * c - h * s));
    const ys = [0, r.width].flatMap((w) => [0, r.height].map((h) => r.y + w * s + h * c));
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }
  return { x0: r.x, y0: r.y, x1: r.x + r.width, y1: r.y + r.height };
}

/**
 * Finds content beyond the page edges.
 * @param {{widthUnits: number, heightUnits: number, items: object[]}} model Render model of a page.
 * @returns {{left: number, right: number, top: number, bottom: number, kinds: string[], count: number}|null}
 *   Largest overflow per edge in page units (0 where nothing sticks out), the kinds of content
 *   affected (text, image, line, graphics, object) and the number of items; null if all fits.
 */
export function pageOverflow(model) {
  const out = { left: 0, right: 0, top: 0, bottom: 0, kinds: new Set(), count: 0 };
  for (const item of model.items) {
    if (item.testPrint) continue;
    const b = itemBounds(item);
    if (!b) continue;
    const over = { left: -b.x0, right: b.x1 - model.widthUnits, top: -b.y0, bottom: b.y1 - model.heightUnits };
    let hit = false;
    for (const [edge, v] of Object.entries(over)) {
      if (v > TOLERANCE) {
        out[edge] = Math.max(out[edge], v);
        hit = true;
      }
    }
    if (hit) {
      out.count++;
      out.kinds.add(KINDS[item.type] ?? 'object');
    }
  }
  return out.count ? { ...out, kinds: [...out.kinds] } : null;
}

/**
 * Tells how far a page placed on a sheet reaches beyond the medium (N-up positions, a page larger
 * than the paper). The page turns clockwise about its origin by the placement's rotation (PGP
 * PGorient), as on the sheet side (render/transform.js).
 * @param {{x: number, y: number, rotation: number}} placement Page position on the medium.
 * @param {{width: number, height: number}} page Page size (page units).
 * @param {{width: number, height: number}|null} medium Medium size, if the form definition gives one.
 * @returns {{left: number, right: number, top: number, bottom: number}|null} Overflow per paper
 *   edge, or null if it fits or the medium size is unknown.
 */
export function placementOverflow(placement, page, medium) {
  if (!medium?.width || !medium?.height) return null;
  const rad = ((placement.rotation ?? 0) * Math.PI) / 180;
  const [c, s] = [Math.round(Math.cos(rad)), Math.round(Math.sin(rad))];
  const xs = [0, page.width].flatMap((w) => [0, page.height].map((h) => placement.x + w * c - h * s));
  const ys = [0, page.width].flatMap((w) => [0, page.height].map((h) => placement.y + w * s + h * c));
  const out = {
    left: Math.max(0, -Math.min(...xs)), top: Math.max(0, -Math.min(...ys)),
    right: Math.max(0, Math.max(...xs) - medium.width), bottom: Math.max(0, Math.max(...ys) - medium.height),
  };
  return Object.values(out).some((v) => v > TOLERANCE) ? out : null;
}
