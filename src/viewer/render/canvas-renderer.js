/**
 * Canvas renderer: draws a render model (display list in page units of 1/1440 inch, from the
 * library) onto a canvas at a given scale (research R4, data-model "RenderModel").
 *
 * Items: glyph runs (raster AFP fonts as bitmaps, TrueType/OpenType via FontFace, outline and
 * substitute fonts via canvas text), rules, paths, images, PDF areas and placeholders.
 */

import { marked } from '../../lib/render/highlight.js';
import { GlyphCache, outlineOf } from './glyph-cache.js';
import { FontLoader, SUBSTITUTE_FAMILIES } from './font-loader.js';
import { PATTERN_TILES, PATTERN_PEL } from '../../lib/goca/patterns.js';
import { gradientStops, linearRange, radialRange } from '../../lib/goca/gradients.js';

/**
 * Corners of the bounding box of path commands (control points included).
 * @param {any[][]} commands Path commands.
 * @returns {[number, number][]} Four corners.
 */
function boxCorners(commands) {
  const xs = [];
  const ys = [];
  for (const c of commands) for (let i = 1; i + 1 < c.length; i += 2) { xs.push(c[i]); ys.push(c[i + 1]); }
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
}

/** Custom pattern tiles drawn once per tile and scale (GOCA, T301). */
const customTiles = new WeakMap();

/** Fill pattern tiles drawn in a color, by "symbol color" (GOCA default pattern set, T299). */
const patternCanvases = new Map();

/**
 * Makes the canvas pattern of a GOCA fill pattern in a color: the tile's 1 pels in the color, its
 * 0 pels transparent (the background is left alone), one pel = PATTERN_PEL page units.
 * @param {CanvasRenderingContext2D} ctx Context the pattern is used with.
 * @param {number} symbol Pattern symbol.
 * @param {string} color Color.
 * @returns {CanvasPattern|string} Pattern, or the color if the pattern is unknown.
 */
function fillPattern(ctx, symbol, color) {
  const tile = PATTERN_TILES[symbol];
  if (!tile) return color;
  const key = `${symbol} ${color}`;
  let canvas = patternCanvases.get(key);
  if (!canvas) {
    canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(tile.width, tile.height)
      : Object.assign(document.createElement('canvas'), { width: tile.width, height: tile.height });
    const tctx = canvas.getContext('2d');
    tctx.fillStyle = color;
    for (let y = 0; y < tile.height; y++) {
      for (let x = 0; x < tile.width; x++) {
        if ((tile.bits[y * tile.rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1) tctx.fillRect(x, y, 1, 1);
      }
    }
    patternCanvases.set(key, canvas);
  }
  const pattern = ctx.createPattern(canvas, 'repeat');
  pattern.setTransform(new DOMMatrix().scaleSelf(PATTERN_PEL, PATTERN_PEL));
  return pattern;
}

/** Item renderers added by later tasks (images, paths, PDF), keyed by item type. */
const itemRenderers = new Map();

/**
 * Registers how to draw an item type.
 * @param {string} type Item type, e.g. 'image'.
 * @param {(ctx: CanvasRenderingContext2D, item: object, renderer: CanvasRenderer) => (void|Promise<void>)} draw
 *   Drawing function (page units).
 * @returns {void}
 */
export function registerItemRenderer(type, draw) {
  itemRenderers.set(type, draw);
}

/**
 * Draws render models onto canvases.
 */
export class CanvasRenderer {
  /**
   * Creates a renderer.
   * @param {import('../worker-client.js').WorkerClient} client Worker client (for glyphs and fonts).
   */
  constructor(client) {
    this.client = client;
    this.glyphs = new GlyphCache(client);
    this.fonts = new FontLoader(client);
    /** When true, items marked as test print (the word "TEST" drawn from strokes) are not drawn. */
    this.hideTestPrint = false;
  }

  /**
   * Draws a model onto a canvas, resizing the canvas to the model at the given scale.
   * @param {HTMLCanvasElement|OffscreenCanvas} canvas Target canvas.
   * @param {{widthUnits: number, heightUnits: number, items: object[]}} model Render model.
   * @param {{scale: number, pixelRatio?: number, highlight?: Set<number>, highlightFile?: string|null,
   *   highlightRuns?: Map<number, [number, number, boolean][]>}} options CSS pixels per page unit, device pixel
   *   ratio, field rows of the file `highlightFile` to highlight (see #marked), and character
   *   ranges of glyph runs (by item index).
   * @returns {Promise<void>} Resolves when drawn.
   */
  async draw(canvas, model, { scale, pixelRatio = 1, highlight = null, highlightFile = null, highlightRuns = null }) {
    await this.#prepare(model);
    const px = scale * pixelRatio;
    canvas.width = Math.max(1, Math.round(model.widthUnits * px));
    canvas.height = Math.max(1, Math.round(model.heightUnits * px));
    if (canvas.style) {
      canvas.style.width = `${Math.round(model.widthUnits * scale)}px`;
      canvas.style.height = `${Math.round(model.heightUnits * scale)}px`;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(px, 0, 0, px, 0, 0);
    ctx.imageSmoothingEnabled = px < 0.4;
    for (const [index, item] of model.items.entries()) {
      if (item.testPrint && this.hideTestPrint) continue;
      // Items of an object mapped with "… and trim" carry the object area as clip rectangle.
      const { clip } = item;
      if (clip) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(clip.x, clip.y, clip.width, clip.height);
        ctx.clip();
      }
      try {
        if (item.type === 'glyphRun') await this.#glyphRun(ctx, item);
        else if (item.type === 'rule') this.#rule(ctx, item);
        else if (item.type === 'path') await this.#path(ctx, item);
        else if (item.type === 'placeholder') this.#placeholder(ctx, item);
        else if (itemRenderers.has(item.type)) await itemRenderers.get(item.type)(ctx, item, this);
      } catch {
        // One broken item must not stop the page.
      }
      if (clip) ctx.restore();
      if (highlight && marked(item, highlight, highlightFile)) this.#highlight(ctx, item);
      for (const range of highlightRuns?.get(index) ?? []) this.#highlight(ctx, item, range);
    }
  }

  /**
   * Loads what the model's glyph runs need (raster bitmaps, TrueType fonts) in batches.
   * @param {object} model Render model.
   * @returns {Promise<void>} Resolves when loaded.
   */
  async #prepare(model) {
    const raster = new Map();
    const truetype = new Set();
    for (const item of model.items) {
      if (item.type !== 'glyphRun') continue;
      if (item.font.kind === 'raster' || item.font.kind === 'outline') {
        if (!raster.has(item.font.ref)) raster.set(item.font.ref, []);
        raster.get(item.font.ref).push(...item.ids);
      } else if (item.font.kind === 'truetype') {
        truetype.add(item.font.ref);
      }
    }
    await Promise.all([
      ...[...raster].map(([ref, ids]) => this.glyphs.load(ref, ids)),
      ...[...truetype].map((ref) => this.fonts.family(ref)),
    ]);
  }

  /**
   * Draws a glyph run.
   * @param {CanvasRenderingContext2D} ctx Context in page units.
   * @param {object} run Glyph run item.
   * @returns {Promise<void>} Resolves when drawn.
   */
  async #glyphRun(ctx, run) {
    ctx.save();
    ctx.translate(run.x, run.y);
    if (run.rotation) ctx.rotate((run.rotation * Math.PI) / 180);
    ctx.fillStyle = run.color;
    const { font } = run;
    if (font.kind === 'raster') {
      run.ids.forEach((id, i) => {
        const g = this.glyphs.get(font.ref, id, run.color);
        if (!g) return;
        const s = g.scale;
        ctx.drawImage(g.image, run.dx[i] + g.data.a * s, -g.data.baseOffset * s, g.data.width * s, g.data.height * s);
      });
    } else if (font.kind === 'outline' && this.glyphs.unitsPerEm.has(font.ref)) {
      run.ids.forEach((id, i) => {
        const o = outlineOf(this.glyphs, font.ref, id);
        if (!o) return;
        const k = font.size / o.unitsPerEm;
        ctx.save();
        ctx.translate(run.dx[i], 0);
        ctx.scale(k, -k);
        ctx.fill(o.path);
        ctx.restore();
      });
    } else {
      let family = SUBSTITUTE_FAMILIES[font.family] ?? SUBSTITUTE_FAMILIES['sans-serif'];
      if (font.kind === 'truetype') {
        const loaded = await this.fonts.family(font.ref);
        if (loaded) family = `"${loaded}"`;
      }
      ctx.font = `${font.size}px ${family}`;
      ctx.textBaseline = 'alphabetic';
      const chars = run.chars ?? [...run.text];
      if (font.kind === 'substitute') this.#substituteWords(ctx, run, chars, font.size);
      else chars.forEach((ch, i) => { if (ch && ch !== ' ') ctx.fillText(ch, run.dx[i], 0); });
    }
    ctx.restore();
  }

  /**
   * Draws text in a substitute font word by word. The library knows no character widths for a
   * missing font and lays characters out with a fixed advance; drawing each character there makes
   * proportional system fonts look torn apart. Each word therefore starts where the document puts
   * its first character, with the system font's own spacing, and is narrowed only when it would
   * run into the next word (or past the end of the run).
   * @param {CanvasRenderingContext2D} ctx Context.
   * @param {object} run Glyph run.
   * @param {string[]} chars Characters.
   * @param {number} size Font size in page units.
   * @returns {void}
   */
  #substituteWords(ctx, run, chars, size) {
    const words = [];
    let start = -1;
    chars.forEach((ch, i) => {
      const blank = !ch || ch === ' ';
      if (!blank && start < 0) start = i;
      if (blank && start >= 0) { words.push([start, i]); start = -1; }
    });
    if (start >= 0) words.push([start, chars.length]);
    const end = (run.dx[chars.length - 1] ?? 0) + size * 0.5;
    words.forEach(([from, to], w) => {
      const text = chars.slice(from, to).join('');
      const x = run.dx[from];
      const room = (w + 1 < words.length ? run.dx[words[w + 1][0]] - size * 0.25 : end) - x;
      const width = ctx.measureText(text).width;
      if (width > room && room > 0) {
        ctx.save();
        ctx.translate(x, 0);
        ctx.scale(room / width, 1);
        ctx.fillText(text, 0, 0);
        ctx.restore();
      } else {
        ctx.fillText(text, x, 0);
      }
    });
  }

  /**
   * Draws a rule (line with thickness).
   * @param {CanvasRenderingContext2D} ctx Context.
   * @param {{x1: number, y1: number, x2: number, y2: number, thickness: number, color: string}} r Rule.
   * @returns {void}
   */
  #rule(ctx, r) {
    ctx.save();
    ctx.strokeStyle = r.color;
    ctx.lineWidth = Math.max(r.thickness, 1);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(r.x1, r.y1);
    ctx.lineTo(r.x2, r.y2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draws a path (graphics: lines, filled areas, curves). Optional: `fillRule` (default even-odd),
   * `pattern` (GOCA fill pattern symbol), `gradient` or `tile` (GOCA gradient or custom pattern,
   * T301), `dash` and `dashOffset` (page units), `lineCap` (default butt) and `lineJoin` (default
   * round).
   * @param {CanvasRenderingContext2D} ctx Context.
   * @param {{commands: any[][], stroke: string|null, fill: string|null, lineWidth: number,
   *   fillRule?: CanvasFillRule, pattern?: number, dash?: number[], dashOffset?: number,
   *   lineCap?: CanvasLineCap, lineJoin?: CanvasLineJoin}} p Path.
   * @returns {Promise<void>} Resolves when drawn.
   */
  async #path(ctx, p) {
    const path = new Path2D();
    for (const c of p.commands) {
      if (c[0] === 'M') path.moveTo(c[1], c[2]);
      else if (c[0] === 'L') path.lineTo(c[1], c[2]);
      else if (c[0] === 'Q') path.quadraticCurveTo(c[1], c[2], c[3], c[4]);
      else if (c[0] === 'C') path.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]);
      else if (c[0] === 'Z') path.closePath();
    }
    ctx.save();
    const rule = p.fillRule ?? 'evenodd';
    if (p.fill && p.gradient) this.#gradient(ctx, path, rule, p);
    else if (p.fill && p.tile) {
      ctx.fillStyle = await this.#tilePattern(ctx, p.tile);
      ctx.fill(path, rule);
    } else if (p.fill) {
      ctx.fillStyle = p.pattern ? fillPattern(ctx, p.pattern, p.fill) : p.fill;
      ctx.fill(path, rule);
    }
    if (p.stroke) {
      ctx.strokeStyle = p.stroke;
      ctx.lineWidth = Math.max(p.lineWidth, 1);
      ctx.lineJoin = p.lineJoin ?? 'round';
      ctx.lineCap = p.lineCap ?? 'butt';
      if (p.dash) {
        ctx.setLineDash(p.dash);
        ctx.lineDashOffset = p.dashOffset ?? 0;
      }
      ctx.stroke(path);
    }
    ctx.restore();
  }

  /**
   * Fills a path with a GOCA gradient (T301). The canvas gradient spans the parameter range that
   * covers the path, with stops that follow the Outside values (gradients.js). A radial gradient
   * is drawn in its arc space (where its full arcs are circles), clipped to the path.
   * @param {CanvasRenderingContext2D} ctx Context.
   * @param {Path2D} path Path.
   * @param {CanvasFillRule} rule Fill rule.
   * @param {{commands: any[][], gradient: object}} p Path item.
   * @returns {void}
   */
  #gradient(ctx, path, rule, p) {
    const g = p.gradient;
    const corners = boxCorners(p.commands);
    if (g.kind === 'linear') {
      const [tmin, tmax] = linearRange(g.p0, g.p1, corners);
      const at = (t) => [g.p0[0] + t * (g.p1[0] - g.p0[0]), g.p0[1] + t * (g.p1[1] - g.p0[1])];
      const grad = ctx.createLinearGradient(...at(tmin), ...at(tmax));
      for (const stop of gradientStops(g.stops, g.outside, tmin, tmax)) grad.addColorStop(stop.offset, stop.color);
      ctx.fillStyle = grad;
      ctx.fill(path, rule);
      return;
    }
    const [a, b, c, d, e, f] = g.matrix;
    const det = a * d - b * c;
    const toArc = ([x, y]) => [(d * (x - e) - c * (y - f)) / det, (-b * (x - e) + a * (y - f)) / det];
    const arcCorners = corners.map(toArc);
    const [tmin, tmax] = radialRange(g.c0, g.r0, g.c1, g.r1, arcCorners);
    const circle = (t) => [g.c0[0] + t * (g.c1[0] - g.c0[0]), g.c0[1] + t * (g.c1[1] - g.c0[1]), Math.max(0, g.r0 + t * (g.r1 - g.r0))];
    ctx.clip(path, rule);
    ctx.transform(a, b, c, d, e, f);
    const grad = ctx.createRadialGradient(...circle(tmin), ...circle(tmax));
    for (const stop of gradientStops(g.stops, g.outside, tmin, tmax)) grad.addColorStop(stop.offset, stop.color);
    ctx.fillStyle = grad;
    const xs = arcCorners.map((pt) => pt[0]);
    const ys = arcCorners.map((pt) => pt[1]);
    ctx.fillRect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  }

  /**
   * Makes the canvas pattern of a GOCA custom pattern (T301): its tile drawn at the context's
   * scale (at most 2048 pixels a side), repeated through the tile's placement matrix.
   * @param {CanvasRenderingContext2D} ctx Context the pattern is used with.
   * @param {{width: number, height: number, items: object[], matrix: number[]}} tile Tile.
   * @returns {Promise<CanvasPattern|string>} Pattern (transparent if the tile is empty).
   */
  async #tilePattern(ctx, tile) {
    const t = ctx.getTransform();
    let scale = Math.hypot(t.a, t.b) * Math.hypot(tile.matrix[0], tile.matrix[1]) || 1;
    scale = Math.min(scale, 2048 / Math.max(tile.width, tile.height, 1));
    const w = Math.max(1, Math.ceil(tile.width * scale));
    const h = Math.max(1, Math.ceil(tile.height * scale));
    let cached = customTiles.get(tile);
    if (!cached || cached.w !== w || cached.h !== h) {
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h });
      const tctx = canvas.getContext('2d');
      tctx.scale(w / tile.width, h / tile.height);
      for (const item of tile.items) {
        if (item.type === 'path') await this.#path(tctx, item);
        else if (itemRenderers.has(item.type)) await itemRenderers.get(item.type)(tctx, item, this);
      }
      cached = { w, h, canvas };
      customTiles.set(tile, cached);
    }
    const pattern = ctx.createPattern(cached.canvas, 'repeat');
    if (!pattern) return 'rgba(0,0,0,0)';
    pattern.setTransform(new DOMMatrix(tile.matrix).scaleSelf(tile.width / w, tile.height / h));
    return pattern;
  }

  /**
   * Draws a placeholder: a hatched box for an object that is not shown.
   * @param {CanvasRenderingContext2D} ctx Context.
   * @param {{rect: {x: number, y: number, width: number, height: number}, reason: string,
   *   resourceName?: string}} p Placeholder.
   * @returns {void}
   */
  #placeholder(ctx, p) {
    const { x, y, width, height } = p.rect;
    ctx.save();
    ctx.strokeStyle = '#d97706';
    ctx.fillStyle = 'rgba(217, 119, 6, 0.08)';
    ctx.lineWidth = 10;
    ctx.fillRect(x, y, width, height);
    ctx.strokeRect(x, y, width, height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.beginPath();
    for (let d = -height; d < width; d += 180) {
      ctx.moveTo(x + d, y + height);
      ctx.lineTo(x + d + height, y);
    }
    ctx.globalAlpha = 0.25;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#92400e';
    ctx.font = '120px sans-serif';
    ctx.fillText(p.resourceName ?? p.reason, x + 40, y + 160, Math.max(width - 80, 200));
    ctx.restore();
  }

  /**
   * Marks an item (linked from the structure view) or part of a glyph run (a search match).
   * @param {CanvasRenderingContext2D} ctx Context.
   * @param {object} item Item.
   * @param {[number, number, boolean]|null} [range] Character range of a glyph run; false in the
   *   third place for a search hit other than the current one.
   * @returns {void}
   */
  #highlight(ctx, item, range = null) {
    ctx.save();
    // Search hits yellow, the current one orange; marked fields blue.
    ctx.fillStyle = range ? (range[2] === false ? 'rgba(250, 204, 21, 0.45)' : 'rgba(249, 115, 22, 0.45)') : 'rgba(37, 99, 235, 0.25)';
    if (item.type === 'glyphRun') {
      const size = item.font.size ?? 240;
      const [from, to] = range ?? [0, item.dx.length];
      const x0 = item.dx[from] ?? 0;
      const x1 = to < item.dx.length ? item.dx[to] : (item.dx.at(-1) ?? 0) + size * 0.6;
      ctx.translate(item.x, item.y);
      if (item.rotation) ctx.rotate((item.rotation * Math.PI) / 180);
      ctx.fillRect(x0, -size, x1 - x0, size * 1.3);
    } else if (item.rect) {
      ctx.fillRect(item.rect.x, item.rect.y, item.rect.width, item.rect.height);
    }
    ctx.restore();
  }
}
