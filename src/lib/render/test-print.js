/**
 * Test print detection: finds the word "TEST" drawn from strokes on a page (rules, graphics
 * lines and filled polygons; letters outlined or solid) so the viewer can hide it.
 *
 * How it works, independent of position, size and stroke width:
 * 1. Every rule and every straight path segment becomes a stroke.
 * 2. Touching strokes are joined into connected shapes (candidate letters).
 * 3. Each shape is drawn into a small grid scaled to its own size; areas enclosed by an outline
 *    are filled, so outlined and solid letters look the same.
 * 4. Each row of the grid is classified (full bar, left part, right part, centered part). The
 *    sequence of rows identifies the letters: T = bar, center; E = bar, left, bar, left, bar;
 *    S = bar, left, bar, right, bar.
 * 5. Four shapes T, E, S, T of similar height, side by side on one line and in this order form
 *    the word. The letters always run in the reading direction of the page (left to right,
 *    upright), so only this direction is checked.
 *
 * Only the complete word counts; single letters or other words are left alone.
 */

const MAX_STROKES = 20000;
const MAX_LETTER_STROKES = 200;
const LETTERS = { T: 'FC', E: 'FLFLF', S: 'FLFRF' };
const WORD = ['T', 'E', 'S', 'T'];

/**
 * Collects the straight strokes of the drawable items.
 * @param {object[]} items Render model items.
 * @returns {{x1: number, y1: number, x2: number, y2: number, hw: number, item: number}[]} Strokes
 *   (hw = half the stroke width).
 */
function strokes(items) {
  const out = [];
  for (const [item, it] of items.entries()) {
    if (it.type === 'rule') {
      out.push({ x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, hw: Math.abs(it.thickness ?? 0) / 2, item });
    } else if (it.type === 'path' && Array.isArray(it.commands)) {
      // Only straight paths: lines, polylines and polygons.
      if (it.commands.some((c) => c[0] !== 'M' && c[0] !== 'L' && c[0] !== 'Z')) continue;
      const hw = it.stroke ? Math.max(it.lineWidth ?? 0, 0) / 2 : 0;
      let start = null;
      let last = null;
      for (const c of it.commands) {
        if (c[0] === 'M') start = last = [c[1], c[2]];
        else if (c[0] === 'L' && last) {
          out.push({ x1: last[0], y1: last[1], x2: c[1], y2: c[2], hw, item });
          last = [c[1], c[2]];
        } else if (c[0] === 'Z' && last && start) {
          if (last[0] !== start[0] || last[1] !== start[1]) out.push({ x1: last[0], y1: last[1], x2: start[0], y2: start[1], hw, item });
          last = start;
        }
      }
    }
  }
  return out;
}

/**
 * Distance from a point to a stroke drawn as a rectangle with square (butt) ends.
 * @param {number} px Point x.
 * @param {number} py Point y.
 * @param {{x1: number, y1: number, x2: number, y2: number, hw: number}} s Stroke.
 * @returns {number} Distance (0 inside).
 */
function rectDistance(px, py, s) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len = Math.hypot(dx, dy);
  if (!len) return Math.max(0, Math.hypot(px - s.x1, py - s.y1) - s.hw);
  const u = ((px - s.x1) * dx + (py - s.y1) * dy) / len;
  const v = ((px - s.x1) * dy - (py - s.y1) * dx) / len;
  return Math.hypot(Math.max(0, -u, u - len), Math.max(0, Math.abs(v) - s.hw));
}

/**
 * Corners of a stroke rectangle.
 * @param {{x1: number, y1: number, x2: number, y2: number, hw: number}} s Stroke.
 * @returns {number[][]} Four corners (two when the stroke has no width).
 */
function corners(s) {
  const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1;
  const nx = (-(s.y2 - s.y1) / len) * s.hw;
  const ny = ((s.x2 - s.x1) / len) * s.hw;
  return [[s.x1 + nx, s.y1 + ny], [s.x2 + nx, s.y2 + ny], [s.x2 - nx, s.y2 - ny], [s.x1 - nx, s.y1 - ny]];
}

/**
 * Distance between two stroke rectangles.
 * @param {object} a Stroke.
 * @param {object} b Stroke.
 * @returns {number} Shortest distance (0 when they overlap).
 */
function strokeDistance(a, b) {
  const ca = corners(a);
  const cb = corners(b);
  // Overlap: no separating axis along or across either stroke.
  let separated = false;
  for (const s of [a, b]) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    for (const [ex, ey] of [[dx, dy], [-dy, dx]]) {
      if (separated || (!ex && !ey)) continue;
      const proj = (p) => p[0] * ex + p[1] * ey;
      const pa = ca.map(proj);
      const pb = cb.map(proj);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) separated = true;
    }
  }
  if (!separated) return 0;
  // For separate convex shapes the closest points include a corner of one of them.
  const edge = (p, poly) => Math.min(...poly.map((q, i) => pointDistance(p[0], p[1], [...q, ...poly[(i + 1) % poly.length]])));
  return Math.min(...ca.map((p) => edge(p, cb)), ...cb.map((p) => edge(p, ca)));
}

/**
 * Distance from a point to a line segment.
 * @param {number} px Point x.
 * @param {number} py Point y.
 * @param {number[]} s Segment [x1, y1, x2, y2].
 * @returns {number} Distance.
 */
function pointDistance(px, py, s) {
  const dx = s[2] - s[0];
  const dy = s[3] - s[1];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / len)) : 0;
  return Math.hypot(px - (s[0] + t * dx), py - (s[1] + t * dy));
}

/**
 * Joins touching strokes into connected shapes.
 * @param {object[]} list Strokes.
 * @returns {object[][]} Shapes (lists of strokes).
 */
function shapes(list) {
  const parent = list.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const box = list.map((s) => bounds([s]));
  // Strokes touch when their edges are closer than a tenth of the wider stroke (at least 1 unit).
  const reach = (a, b) => Math.max(1, 0.1 * Math.max(a.hw, b.hw) * 2);
  const order = list.map((_, i) => i).sort((a, b) => box[a].minX - box[b].minX);
  const active = [];
  for (const i of order) {
    const bi = box[i];
    for (let k = active.length - 1; k >= 0; k--) {
      const j = active[k];
      const bj = box[j];
      const r = reach(list[i], list[j]);
      if (bj.maxX + r < bi.minX) { active.splice(k, 1); continue; }
      if (bj.minY - r > bi.maxY || bj.maxY + r < bi.minY || find(i) === find(j)) continue;
      const a = list[i];
      const b = list[j];
      if (strokeDistance(a, b) <= r) parent[find(i)] = find(j);
    }
    active.push(i);
  }
  const groups = new Map();
  for (const [i, s] of list.entries()) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(s);
  }
  return [...groups.values()];
}

/**
 * Bounding box of strokes including their widths.
 * @param {object[]} shape Strokes.
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}} Box.
 */
function bounds(shape) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const s of shape) {
    for (const [x, y] of corners(s)) {
      b.minX = Math.min(b.minX, x);
      b.maxX = Math.max(b.maxX, x);
      b.minY = Math.min(b.minY, y);
      b.maxY = Math.max(b.maxY, y);
    }
  }
  return b;
}

/**
 * Identifies a shape as one of the letters T, E or S (upright, reading left to right).
 * @param {object[]} shape Strokes.
 * @param {{minX: number, minY: number, maxX: number, maxY: number}} b Bounding box.
 * @returns {string|null} 'T', 'E', 'S' or null.
 */
function letter(shape, b) {
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  if (!(w > 0 && h > 0) || w > 2 * h || h > 5 * w) return null;
  // Grid cells: at most 1/40 of the height, smaller for thin strokes (so every bar spans at least
  // two rows), but never more than 120 rows.
  const thin = Math.min(...shape.map((s) => s.hw * 2).filter((x) => x > 0), Infinity);
  const cell = Math.max(h / 120, Math.min(h / 40, thin / 1.2));
  const cols = Math.max(1, Math.ceil(w / cell));
  const rows = Math.max(1, Math.ceil(h / cell));
  const grid = new Uint8Array(cols * rows);
  for (const s of shape) {
    const limit = s.hw + cell * 0.55;
    const c0 = Math.max(0, Math.floor((Math.min(s.x1, s.x2) - limit - b.minX) / cell));
    const c1 = Math.min(cols - 1, Math.floor((Math.max(s.x1, s.x2) + limit - b.minX) / cell));
    const r0 = Math.max(0, Math.floor((Math.min(s.y1, s.y2) - limit - b.minY) / cell));
    const r1 = Math.min(rows - 1, Math.floor((Math.max(s.y1, s.y2) + limit - b.minY) / cell));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (rectDistance(b.minX + (c + 0.5) * cell, b.minY + (r + 0.5) * cell, s) <= cell * 0.55) grid[r * cols + c] = 1;
      }
    }
  }
  // Fill enclosed areas: everything empty that cannot be reached from the border.
  const outside = new Uint8Array(cols * rows);
  const stack = [];
  for (let c = 0; c < cols; c++) stack.push(c, (rows - 1) * cols + c);
  for (let r = 0; r < rows; r++) stack.push(r * cols, r * cols + cols - 1);
  while (stack.length) {
    const i = stack.pop();
    if (grid[i] || outside[i]) continue;
    outside[i] = 1;
    const r = Math.floor(i / cols);
    const c = i % cols;
    if (c > 0) stack.push(i - 1);
    if (c < cols - 1) stack.push(i + 1);
    if (r > 0) stack.push(i - cols);
    if (r < rows - 1) stack.push(i + cols);
  }
  // Classify the rows.
  const kinds = [];
  for (let r = 0; r < rows; r++) {
    const runs = [];
    let start = -1;
    for (let c = 0; c <= cols; c++) {
      const on = c < cols && !outside[r * cols + c];
      if (on && start < 0) start = c;
      if (!on && start >= 0) {
        if (c - start >= Math.max(1, 0.05 * cols)) runs.push([start / cols, c / cols]);
        start = -1;
      }
    }
    if (!runs.length) continue;
    if (runs.length > 1) { kinds.push('M'); continue; }
    const [from, to] = runs[0];
    if (to - from >= 0.5) kinds.push('F');
    else if (from <= 0.15) kinds.push('L');
    else if (to >= 0.85) kinds.push('R');
    else kinds.push('C');
  }
  // Row kinds that last at least two rows, without repeats.
  let signature = '';
  for (let i = 0; i < kinds.length;) {
    let j = i;
    while (j < kinds.length && kinds[j] === kinds[i]) j++;
    if (j - i >= 2 && signature.at(-1) !== kinds[i]) signature += kinds[i];
    i = j;
  }
  for (const [name, sig] of Object.entries(LETTERS)) if (signature === sig) return name;
  return null;
}

/**
 * Finds the strokes that draw the word "TEST" on a page.
 * @param {object[]} items Render model items (rules, paths and others; others are ignored).
 * @returns {Set<number>} Indexes of the items that belong to the word (empty if there is none).
 */
export function findTestPrint(items) {
  const found = new Set();
  const list = strokes(items ?? []);
  if (list.length < 8 || list.length > MAX_STROKES) return found;
  // A letter has at least two strokes; a single line can be neither T, E nor S.
  const groups = shapes(list).filter((g) => g.length >= 2 && g.length <= MAX_LETTER_STROKES)
    .map((g) => {
      const b = bounds(g);
      return { g, w: b.maxX - b.minX, h: b.maxY - b.minY };
    });
  if (groups.length < 4) return found;
  // Cheap checks before drawing a shape: letter proportions, and at least three other shapes of
  // about the same height (the rest of the word).
  const fit = groups.filter((x) => x.h > 0 && x.w <= 2 * x.h && x.h <= 5 * x.w);
  const heights = fit.map((x) => x.h).sort((a, b) => a - b);
  const similar = (h) => heights.filter((x) => x >= h * 0.75 && x <= h * 1.25).length;
  const letters = [];
  for (const { g } of fit.filter((x) => similar(x.h) >= 4)) {
    const b = bounds(g);
    const name = letter(g, b);
    if (name) letters.push({ name, b, g, h: b.maxY - b.minY, cy: (b.minY + b.maxY) / 2 });
  }
  // Every T starts a possible word; the next letter is the nearest letter of similar height on
  // the same line to its right, which must be the expected one.
  const words = [];
  for (const first of letters.filter((l) => l.name === 'T')) {
    const word = [first];
    for (let k = 1; k < WORD.length; k++) {
      const prev = word.at(-1);
      const gap = (l) => l.b.minX - prev.b.maxX;
      const next = letters
        .filter((l) => !word.includes(l) && l.b.minX > prev.b.minX && Math.abs(l.cy - first.cy) <= 0.3 * first.h
          && Math.abs(l.h - first.h) <= 0.25 * first.h && gap(l) <= first.h && gap(l) >= -0.1 * first.h)
        .sort((a, b) => a.b.minX - b.b.minX)[0];
      if (!next || next.name !== WORD[k]) break;
      word.push(next);
    }
    if (word.length === WORD.length) words.push(word);
  }
  if (!words.length) return found;
  // Items whose strokes all belong to a word.
  const inWord = new Set(words.flat().flatMap((l) => l.g));
  const partly = new Set();
  for (const s of list) if (!inWord.has(s)) partly.add(s.item);
  for (const s of inWord) if (!partly.has(s.item)) found.add(s.item);
  return found;
}
