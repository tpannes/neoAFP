/**
 * GOCA graphics objects (FR-011, task T069): vector drawings (lines, boxes, arcs, curves, filled
 * areas), character strings and small images, drawn in a graphics coordinate space whose y axis
 * points up.
 *
 * Structure (GOCA Reference): the Graphics Data Descriptor (GDD) gives the resolution and the
 * window of the drawing; the Graphics Data (GAD) fields contain segments (X'70' Begin Segment,
 * 12-byte header) of drawing orders. Order formats: X'00' is one byte; codes X'01'–X'3F' with
 * bit X'08' set, and X'68' Begin Area, are two bytes (code, value); all others are code, length,
 * data (checked against the test sets: all 446 graphics objects parse without unknown orders);
 * X'FE' starts the extended format: qualifier, 2-byte length, data (the order is kept as code
 * X'FExx', e.g. X'FEDC' Linear Gradient). Orders with the
 * high bit of the second nibble pattern "at given position" (X'Cx', X'Ex', X'Dx') start with a
 * point; the corresponding "at current position" forms (X'8x', X'Ax', X'9x') do not.
 *
 * Unknown orders are skipped (their length is known) and reported, never guessed (Principle I).
 */

import { ocaColorSpec, extendedColorSpec, colorSpecField } from '../render/color-spec.js';
import { collectFields, concat } from '../modca/access.js';
import { u, s, toPageUnits } from '../modca/bytes.js';
import { extendedColor, NAMED_COLORS } from '../ptoca/ptoca.js';
import { registerObjectRenderer, readObjectArea, readObjectFonts } from '../render/page-renderer.js';
import { loadCodePage, decode } from '../codepages/index.js';
import { specTable, shortNames } from '../spec-table.js';
import { patternFill } from './patterns.js';
import { readLinearGradient, readRadialGradient } from './gradients.js';

const BGR = 0xd3a8bb;
const GDD = 0xd3a6bb;
const GAD = 0xd3eebb;

/**
 * Drawing orders handled here (GOCA order code table). X'70' and X'71' are the Begin and End
 * Segment commands that may appear in graphics data; X'3F' is skipped without a definition.
 */
export const ORDER_TABLE = specTable('GOCA for AFP Reference (AFPC-0008-03)', 'Drawing Orders', [
  [0x00, 'GNOP1', 'No-Operation'], [0x01, 'GCOMT', 'Comment'], [0x04, 'GSGCH', 'Segment Characteristics'],
  [0x08, 'GSPS', 'Set Pattern Set'], [0x0a, 'GSCOL', 'Set Color'], [0x0c, 'GSMX', 'Set Mix'], [0x0d, 'GSBMX', 'Set Background Mix'],
  [0x11, 'GSFLW', 'Set Fractional Line Width'], [0x18, 'GSLT', 'Set Line Type'], [0x19, 'GSLW', 'Set Line Width'],
  [0x1a, 'GSLE', 'Set Line End'], [0x1b, 'GSLJ', 'Set Line Join'], [0x20, 'GSCLT', 'Set Custom Line Type'],
  [0x21, 'GSCP', 'Set Current Position'],
  [0x22, 'GSAP', 'Set Arc Parameters'], [0x26, 'GSECOL', 'Set Extended Color'], [0x28, 'GSPT', 'Set Pattern Symbol'],
  [0x29, 'GSMT', 'Set Marker Symbol'], [0x33, 'GSCC', 'Set Character Cell'], [0x34, 'GSCA', 'Set Character Angle'], [0x35, 'GSCH', 'Set Character Shear'],
  [0x37, 'GSMC', 'Set Marker Cell'],
  [0x38, 'GSCS', 'Set Character Set'], [0x39, 'GSCR', 'Set Character Precision'], [0x3a, 'GSCD', 'Set Character Direction'],
  [0x3b, 'GSMP', 'Set Marker Precision'], [0x3c, 'GSMS', 'Set Marker Set'], [0x3e, 'GEPROL', 'End Prolog'],
  [0x60, 'GEAR', 'End Area'], [0x68, 'GBAR', 'Begin Area'], [0x70, '', 'Begin Segment'], [0x71, '', 'End Segment'],
  [0x80, 'GCBOX', 'Box at Current Position'], [0xc0, 'GBOX', 'Box at Given Position'],
  [0x81, 'GCLINE', 'Line at Current Position'], [0xc1, 'GLINE', 'Line at Given Position'],
  [0x82, 'GCMRK', 'Marker at Current Position'], [0xc2, 'GMRK', 'Marker at Given Position'],
  [0x83, 'GCCHST', 'Character String at Current Position'], [0xc3, 'GCHST', 'Character String at Given Position'],
  [0x85, 'GCFLT', 'Fillet at Current Position'], [0xc5, 'GFLT', 'Fillet at Given Position'],
  [0x87, 'GCFARC', 'Full Arc at Current Position'], [0xc7, 'GFARC', 'Full Arc at Given Position'],
  [0x91, 'GCBIMG', 'Begin Image at Current Position'], [0xd1, 'GBIMG', 'Begin Image at Given Position'],
  [0x92, 'GIMD', 'Image Data'], [0x93, 'GEIMG', 'End Image'],
  [0xa1, 'GCRLINE', 'Relative Line at Current Position'], [0xe1, 'GRLINE', 'Relative Line at Given Position'],
  [0xa3, 'GCPARC', 'Partial Arc at Current Position'], [0xe3, 'GPARC', 'Partial Arc at Given Position'],
  [0xa5, 'GCCBEZ', 'Cubic Bezier Curve at Current Position'], [0xe5, 'GCBEZ', 'Cubic Bezier Curve at Given Position'],
  [0xb2, 'GSPCOL', 'Set Process Color'],
  [0xa0, 'GSPRP', 'Set Pattern Reference Point'], [0xde, 'GBCP', 'Begin Custom Pattern'], [0x5e, 'GECP', 'End Custom Pattern'],
  [0xdf, 'GDPT', 'Delete Pattern'], [0xfedc, 'GLGD', 'Linear Gradient'], [0xfedd, 'GRGD', 'Radial Gradient'],
]);
/** Order code → short name. */
export const ORDERS = shortNames(ORDER_TABLE);

/**
 * Splits graphics data into orders.
 * @param {Uint8Array} d Concatenated Graphics Data.
 * @returns {{code: number, data: Uint8Array, pos: number}[]} Orders in order, with the offset of
 *   each order in `d`.
 */
export function splitOrders(d) {
  const out = [];
  let pos = 0;
  while (pos < d.length) {
    const code = d[pos];
    if (code === 0x00) {
      out.push({ code, data: d.subarray(pos + 1, pos + 1), pos });
      pos += 1;
    } else if ((code < 0x40 && (code & 0x08)) || code === 0x68) {
      // two-byte orders: X'01'–X'3F' with bit X'08' set, and Begin Area (code, flags)
      out.push({ code, data: d.subarray(pos + 1, pos + 2), pos });
      pos += 2;
    } else if (code === 0xfe) {
      const len = ((d[pos + 2] ?? 0) << 8) | (d[pos + 3] ?? 0);
      out.push({ code: 0xfe00 | (d[pos + 1] ?? 0), data: d.subarray(pos + 4, pos + 4 + len), pos });
      pos += 4 + len;
    } else if (code === 0x70) {
      const len = d[pos + 1];
      out.push({ code, data: d.subarray(pos + 2, pos + 2 + len), pos });
      pos += 2 + len;
    } else {
      const len = d[pos + 1] ?? 0;
      out.push({ code, data: d.subarray(pos + 2, pos + 2 + len), pos });
      pos += 2 + len;
    }
  }
  return out;
}

/** GOCA color index (Set Color) → RGB; 0 and X'FF07' are the default (black). */
const GOCA_COLORS = { ...NAMED_COLORS, 0x00: '#000000', 0x07: '#ffffff', 0x08: '#000000' };

/**
 * Reads the Graphics Data Descriptor: resolution and window.
 * @param {Uint8Array|undefined} d GDD data.
 * @returns {{unitsPerTenInches: number, base: number, xl: number, xr: number, yb: number, yt: number}}
 *   Units and window (graphics coordinates).
 */
export function readGdd(d) {
  const out = { base: 0, unitsPerTenInches: 0, xl: 0, xr: 0, yb: 0, yt: 0 };
  if (!d) return out;
  let pos = 0;
  while (pos + 2 <= d.length) {
    const code = d[pos];
    const len = d[pos + 1];
    const body = d.subarray(pos + 2, pos + 2 + len);
    if (code === 0xf6 && body.length >= 18) {
      // Window Specification (GOCA, GDD in the MO:DCA environment): FLAGS, reserved, CFORMAT,
      // UBASE, XRESOL, YRESOL, IMXYRES, XLWIND, XRWIND, YBWIND, YTWIND.
      out.base = body[3]; // UBASE (byte 2 is CFORMAT)
      out.unitsPerTenInches = u(body, 4, 2);
      out.xl = s(body, 10, 2);
      out.xr = s(body, 12, 2);
      out.yb = s(body, 14, 2);
      out.yt = s(body, 16, 2);
    }
    pos += 2 + len;
  }
  return out;
}

/**
 * Standard line types (GOCA "Line Type", Set Line Type X'18'): dash and move lengths in units of
 * the line width, a dash of 0 being a dot; null = solid, 'invisible' = nothing drawn. X'00' and
 * undefined values are solid (standard default X'07').
 */
const LINE_TYPES = {
  0x01: [0, 2], 0x02: [3, 3], 0x03: [6, 4, 0, 4], 0x04: [0, 3, 0, 7], 0x05: [8, 3], 0x06: [6, 3, 0, 3, 0, 3],
  0x07: null, 0x08: 'invisible',
};

/** Line end (Set Line End X'1A') and line join (Set Line Join X'1B') → canvas values; default round. */
const LINE_ENDS = { 0x01: 'butt', 0x02: 'square', 0x03: 'round' };
const LINE_JOINS = { 0x01: 'bevel', 0x02: 'round', 0x03: 'miter' };

/** Default marker cell: 7/120 inch in page units (GOCA, Set Marker Cell, recommendation). */
const MARKER_CELL = 84;

/**
 * Length of a path in page units (curves measured along 16 straight pieces each).
 * @param {Array<Array<string|number>>} cmds Path commands.
 * @returns {number} Length.
 */
function pathLength(cmds) {
  let len = 0;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  for (const c of cmds) {
    if (c[0] === 'M') { [x, y] = [c[1], c[2]]; [sx, sy] = [x, y]; continue; }
    const pts = c[0] === 'L' ? [[c[1], c[2]]] : c[0] === 'Z' ? [[sx, sy]] : [];
    if (c[0] === 'Q' || c[0] === 'C') {
      for (let i = 1; i <= 16; i++) {
        const t = i / 16;
        const m = 1 - t;
        pts.push(c[0] === 'Q'
          ? [m * m * x + 2 * m * t * c[1] + t * t * c[3], m * m * y + 2 * m * t * c[2] + t * t * c[4]]
          : [m ** 3 * x + 3 * m * m * t * c[1] + 3 * m * t * t * c[3] + t ** 3 * c[5],
            m ** 3 * y + 3 * m * m * t * c[2] + 3 * m * t * t * c[4] + t ** 3 * c[6]]);
      }
    }
    for (const [px, py] of pts) {
      len += Math.hypot(px - x, py - y);
      [x, y] = [px, py];
    }
  }
  return len;
}

/**
 * Draws one marker of the default marker set (GOCA Figure 32), centered at a point. Arms reach
 * the cell corners (cross, stars) or edges (plus, square); diamond and small circle are about
 * √2 half cells wide, the dot a third of a half cell, as in the figure.
 * @param {number} symbol Marker symbol (Set Marker Symbol X'29').
 * @param {number} cx Center x (page units).
 * @param {number} cy Center y (page units).
 * @param {number} hx Half cell width (page units).
 * @param {number} hy Half cell height (page units).
 * @param {string} color Color.
 * @returns {object[]} Path items without source fields.
 */
export function markerItems(symbol, cx, cy, hx, hy, color) {
  const line = (x0, y0, x1, y1) => [['M', cx + x0, cy + y0], ['L', cx + x1, cy + y1]];
  const poly = (pts) => [...pts.map(([x, y], i) => [i ? 'L' : 'M', cx + x, cy + y]), ['Z']];
  const circle = (rx, ry) => poly(Array.from({ length: 24 }, (_, i) => [rx * Math.cos((i * Math.PI) / 12), ry * Math.sin((i * Math.PI) / 12)]));
  const r = Math.SQRT2;
  const cross = [...line(-hx, -hy, hx, hy), ...line(-hx, hy, hx, -hy)];
  const diamond = poly([[-r * hx, 0], [0, -r * hy], [r * hx, 0], [0, r * hy]]);
  const square = poly([[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]]);
  const shapes = {
    0x01: [cross, false], 0x02: [[...line(-hx, 0, hx, 0), ...line(0, -hy, 0, hy)], false],
    0x03: [diamond, false], 0x04: [square, false],
    0x05: [[...cross, ...line(0, -r * hy, 0, r * hy)], false],
    0x06: [[...cross, ...line(0, -r * hy, 0, r * hy), ...line(-r * hx, 0, r * hx, 0)], false],
    0x07: [diamond, true], 0x08: [square, true],
    0x09: [circle(hx / 3, hy / 3), true], 0x0a: [circle(r * hx, r * hy), false],
  };
  if (symbol === 0x40) return [];
  const [commands, filled] = shapes[symbol] ?? shapes[0x01];
  const lineWidth = Math.max(hx, hy) / 5;
  return [{ type: 'path', commands, stroke: filled ? null : color, fill: filled ? color : null, lineWidth, lineCap: 'round', lineJoin: 'round' }];
}

/**
 * Interprets graphics orders and returns render items (page units, y down).
 * @param {{code: number, data: Uint8Array}[]} orders Orders.
 * @param {object} ctx Context.
 * @param {(gx: number, gy: number) => [number, number]} ctx.toPage Graphics → page coordinates.
 * @param {number} ctx.k Page units per graphics unit.
 * @param {{x: number, y: number}} [ctx.pelK] Page units per image point (GBIMG); defaults to `k`.
 * @param {(lid: number) => object|null} [ctx.font] Font handle of a character set (T300), or null.
 * @param {(reason: string) => void} ctx.report Records a problem.
 * @param {number} ctx.sourceField Row of the graphics object.
 * @param {string} ctx.fileId File id.
 * @returns {object[]} Paths, glyph runs and images.
 */
export function runGoca(orders, ctx) {
  const items = [];
  const st = {
    x: 0, y: 0, color: '#000000', colorSpec: null, lineWidth: 1, area: null, arc: { p: 1, q: 1, r: 0, s: 0 }, cell: 0, image: null,
    // Line attributes (T296): type (null solid, 'invisible' or dash/move lengths in line widths),
    // end, join, and the position in the dash sequence (page units), reset by Move Type orders.
    lineType: null, lineEnd: 'round', lineJoin: 'round', phase: 0,
    patternSet: 0, pattern: 0x10, marker: 0x01, markerCell: null, // T299, T297
    // Character attributes (T300): angle in degrees counterclockwise in GPS (0, 90, 180, 270),
    // direction (1 left to right, 2 top to bottom, 3 right to left, 4 bottom to top), character set.
    charAngle: 0, charDir: 1, charSet: 0, cellW: null,
    // Custom patterns and gradients by "set:symbol" (T301), and the pattern reference point.
    patterns: new Map(), patternRef: [0, 0],
  };
  /** Custom pattern being defined (Begin … End Custom Pattern): its parameters and orders. */
  let capture = null;
  /**
   * Ends a custom pattern definition: draws its orders into a tile of the pattern window (page
   * units, top left at the window's top left) and stores it, unless the definition is invalid.
   * @returns {void}
   */
  const endCapture = () => {
    const c = capture;
    capture = null;
    if (!c.valid) return;
    const [xl, xr, yb, yt] = c.box;
    const items = runGoca(c.orders, {
      ...ctx, inPattern: true, pelK: { x: ctx.k, y: ctx.k }, toPage: (gx, gy) => [(gx - xl) * ctx.k, (yt - gy) * ctx.k],
    });
    st.patterns.set(c.key, { kind: 'custom', fullColor: c.fullColor, width: (xr - xl) * ctx.k, height: (yt - yb) * ctx.k, windowHeight: yt - yb, items });
  };
  /**
   * Gives an area item its custom pattern or gradient fill (T301).
   * @param {object} item Fill item (changed).
   * @param {object} def Pattern definition.
   * @param {object} area Area (color, reference point).
   * @returns {boolean} False if the area stays unfilled.
   */
  const patternedFill = (item, def, area) => {
    if (def.kind === 'linear') {
      const p0 = P(...def.start);
      const p1 = P(...def.end);
      if (p0[0] === p1[0] && p0[1] === p1[1]) return false; // start and end point equal: no fill
      item.gradient = { kind: 'linear', p0, p1, stops: def.stops, outside: def.outside };
      return true;
    }
    if (def.kind === 'radial') {
      // Both full arcs have the shape of the arc parameters current at the definition: in arc
      // space (where those parameters are the unit circle) they are circles of radius m.
      const { p, q, r, s: ss } = def.arc;
      const det = p * q - r * ss;
      if (!det || (def.m0 === 0 && def.m1 === 0) || (def.m0 === def.m1 && def.start[0] === def.end[0] && def.start[1] === def.end[1])) return false;
      const inv = ([x, y]) => [(q * x - r * y) / det, (-ss * x + p * y) / det];
      const o = P(0, 0);
      const e1 = P(p, ss);
      const e2 = P(r, q);
      item.gradient = {
        kind: 'radial', c0: inv(def.start), r0: def.m0, c1: inv(def.end), r1: def.m1, stops: def.stops, outside: def.outside,
        matrix: [e1[0] - o[0], e1[1] - o[1], e2[0] - o[0], e2[1] - o[1], o[0], o[1]],
      };
      return true;
    }
    // Custom pattern: tiled from the reference point (the window's lower left corner there);
    // a bilevel pattern takes the area color.
    const [rx, ry] = area.ref;
    const top = ry + def.windowHeight;
    const o = P(rx, top);
    const e1 = P(rx + 1, top);
    const e2 = P(rx, top - 1);
    const recolor = (it) => (def.fullColor ? it : {
      ...it, ...(it.stroke ? { stroke: area.color } : {}), ...(it.fill ? { fill: area.color } : {}), ...('color' in it ? { color: area.color } : {}),
      ...colorSpecField(area.colorSpec),
      ...(it.inline ? { inline: { ...it.inline, color: area.color } } : {}),
    });
    item.tile = {
      width: def.width, height: def.height, items: def.items.map(recolor),
      matrix: [(e1[0] - o[0]) / ctx.k, (e1[1] - o[1]) / ctx.k, (e2[0] - o[0]) / ctx.k, (e2[1] - o[1]) / ctx.k, o[0], o[1]],
    };
    return true;
  };
  const unknown = new Set();
  const lineWidthUnits = () => Math.max(1, st.lineWidth * 14.4); // normal line width ≈ 0.01 inch
  const point = (d, at) => [s(d, at, 2), s(d, at + 2, 2)];
  /**
   * Makes a stroked path item with the current line attributes, or null for an invisible line.
   * @param {Array<Array<string|number>>} cmds Path commands (page units).
   * @param {string} [join] Join instead of the current one (Box corners are sharp).
   * @returns {object|null} Item.
   */
  const stroke = (cmds, join = st.lineJoin) => {
    const length = pathLength(cmds);
    const offset = st.phase;
    st.phase += length;
    if (st.lineType === 'invisible') return null;
    const item = { type: 'path', commands: cmds, stroke: st.color, ...colorSpecField(st.colorSpec), fill: null, lineWidth: lineWidthUnits(), lineCap: st.lineEnd, lineJoin: join, sourceField: ctx.sourceField, fileId: ctx.fileId };
    if (st.lineType) {
      item.dash = st.lineType.map((v) => v * item.lineWidth);
      item.dashOffset = offset;
    }
    return item;
  };
  const path = (cmds) => {
    if (st.area) {
      // Inside an area, a line that starts where the previous one ended continues the same
      // boundary; only a jump starts a new (implicitly closed) figure. Without this every line
      // would be its own empty subpath and nothing would be filled (bar and area charts).
      const last = st.area.commands[st.area.commands.length - 1];
      const end = last && last[0] !== 'Z' ? last.slice(-2) : null;
      if (end && cmds[0]?.[0] === 'M' && Math.abs(end[0] - cmds[0][1]) < 0.01 && Math.abs(end[1] - cmds[0][2]) < 0.01) {
        st.area.commands.push(...cmds.slice(1));
      } else {
        st.area.commands.push(...cmds);
      }
      // Boundary lines (Begin Area flag) are drawn after the fill, with the line attributes of now.
      const line = st.area.boundary ? stroke(cmds) : null;
      if (line) st.area.boundaryItems.push(line);
    } else {
      const line = stroke(cmds);
      if (line) items.push(line);
    }
  };
  const P = (gx, gy) => ctx.toPage(gx, gy);
  const polyline = (points) => {
    if (points.length < 2) return;
    const cmds = [['M', ...P(...points[0])]];
    for (const p of points.slice(1)) cmds.push(['L', ...P(...p)]);
    path(cmds);
  };
  /**
   * Draws a character string (T300): with the AFP font mapped to the current character set
   * (font positioning method: the font's metrics, the cell is ignored), else with a substitute
   * font sized by the character cell (cell positioning method; a cell of zero draws nothing).
   * The character angle turns the baseline; the direction places the characters left to right,
   * right to left (the first character ends at the position) or one below or above the other.
   * @param {Uint8Array} bytes Code points.
   * @param {[number, number]} at Position in page units.
   * @returns {object[]} Glyph runs.
   */
  const characterString = (bytes, [x, y]) => {
    const font = st.charSet >= 0x01 && st.charSet <= 0xfe ? ctx.font?.(st.charSet) ?? null : null;
    let glyphs;
    let lineStep;
    let descriptor;
    if (font) {
      glyphs = font.split(bytes).map(({ code }) => ({ code, ...font.glyph(code) }));
      lineStep = font.baselineIncrement || 240;
      descriptor = font.descriptor;
    } else {
      if (st.cell === 0 || st.cellW === 0) return [];
      const size = Math.max(60, (st.cell || 20) * ctx.k);
      const advance = st.cellW ? st.cellW * ctx.k : size * 0.55;
      glyphs = [...decode('ebcdic-500', bytes)].map((ch) => ({ id: ch, unicode: ch, advance }));
      lineStep = size;
      descriptor = { kind: 'substitute', family: 'sans-serif', size, name: 'GOCA' };
    }
    // Page rotation is clockwise with y down; the GPS angle is counterclockwise with y up.
    const rotation = (360 - st.charAngle) % 360;
    const rad = (rotation * Math.PI) / 180;
    const along = [Math.round(Math.cos(rad) * 1e12) / 1e12, Math.round(Math.sin(rad) * 1e12) / 1e12];
    const down = [-along[1], along[0]];
    const run = (px, py, list, dx) => ({
      type: 'glyphRun', x: px, y: py, rotation, color: st.color, ...colorSpecField(st.colorSpec), font: descriptor,
      ids: list.map((g) => g.id), dx, chars: list.map((g) => g.unicode), text: list.map((g) => g.unicode).join(''),
      ...(font ? { codes: list.map((g) => g.code) } : {}), sourceField: ctx.sourceField, fileId: ctx.fileId,
    });
    if (st.charDir === 1 || st.charDir === 3) {
      let pos = 0;
      const dx = glyphs.map((g) => {
        if (st.charDir === 1) { const v = pos; pos += g.advance; return v; }
        pos += g.advance;
        return -pos;
      });
      return glyphs.length ? [run(x, y, glyphs, dx)] : [];
    }
    // Top to bottom: the first character's top (about 0.8 line below its baseline) at the
    // position, the next ones below; bottom to top: its baseline at the position, the next above.
    return glyphs.map((g, i) => {
      const off = st.charDir === 2 ? (i + 0.8) * lineStep : -i * lineStep;
      return run(x + down[0] * off, y + down[1] * off, [g], [0]);
    });
  };
  const ellipse = (cx, cy, mult, start = 0, sweep = 360) => {
    const { p, q, r, s: ss } = st.arc;
    const cmds = [];
    const steps = Math.max(8, Math.ceil(Math.abs(sweep) / 6));
    for (let i = 0; i <= steps; i++) {
      const a = ((start + (sweep * i) / steps) * Math.PI) / 180;
      const gx = cx + mult * (p * Math.cos(a) + r * Math.sin(a));
      const gy = cy + mult * (ss * Math.cos(a) + q * Math.sin(a));
      cmds.push([i === 0 ? 'M' : 'L', ...P(gx, gy)]);
    }
    return cmds;
  };

  // First Graphics Data field of an area or image that is still open: its item is made by the
  // closing order (GEAR, GEIMG), but its orders and data lie in all fields from the opening one.
  let openedIn = null;
  for (const order of orders) {
    const { code, data: d, field } = order;
    if (capture) {
      // In a custom pattern definition every order belongs to the pattern; a second Begin
      // Custom Pattern ends the first one (EC-DE00).
      if (code !== 0x5e && code !== 0xde) { capture.orders.push(order); continue; }
      endCapture();
      if (code === 0x5e) continue;
    }
    const made = items.length;
    if (code === 0x68 || code === 0xd1 || code === 0x91) openedIn ??= field;
    const given = (code & 0x40) !== 0 && code >= 0x80;
    // Move Type orders (a given start point, or Set Current Position) restart the dash sequence.
    if (given || code === 0x21) st.phase = 0;
    switch (code) {
      case 0x00: case 0x01: case 0x04: case 0x0c: case 0x0d: case 0x35: case 0x39:
      case 0x3b: case 0x3c: case 0x3e: case 0x3f: case 0x70: case 0x71: break; // no visible effect here (GSCH is a No-Op in AFP GOCA)
      case 0x34: { // GSCA: baseline direction (x, y); AFP GOCA supports 0°, 90°, 180°, 270° (closest is used)
        const x = s(d, 0, 2);
        const y = s(d, 2, 2);
        st.charAngle = x || y ? ((Math.round(Math.atan2(y, x) / (Math.PI / 2)) * 90) + 360) % 360 : 0;
        break;
      }
      case 0x3a: st.charDir = d[0] >= 1 && d[0] <= 4 ? d[0] : 1; break; // GSCD
      case 0x38: st.charSet = d[0]; break; // GSCS
      case 0x18: st.lineType = d[0] in LINE_TYPES ? LINE_TYPES[d[0]] : null; break; // GSLT
      case 0x20: { // GSCLT: pairs of dash and move lengths (8.8 fixed point); all zero = solid
        const seq = [];
        for (let at = 0; at + 2 <= d.length; at += 2) seq.push(d[at] + d[at + 1] / 256);
        st.lineType = seq.length >= 2 && seq.some((v) => v > 0) ? seq.slice(0, seq.length & ~1) : null;
        break;
      }
      case 0x1a: st.lineEnd = LINE_ENDS[d[0]] ?? 'round'; break; // GSLE
      case 0x1b: st.lineJoin = LINE_JOINS[d[0]] ?? 'round'; break; // GSLJ
      case 0x08: st.patternSet = d[0]; break; // GSPS
      case 0x28: st.pattern = d[0]; break; // GSPT
      case 0x29: st.marker = d[0]; break; // GSMT
      case 0x37: { // GSMC: cell width and height in GPS units; zero = default, or zero size (NOTDEFLT)
        const w = s(d, 0, 2);
        const h = s(d, 2, 2);
        st.markerCell = w && h ? [Math.abs(w), Math.abs(h)] : (d[4] & 0x80) ? [0, 0] : null;
        break;
      }
      case 0xc2: case 0x82: { // GMRK, GCMRK: a marker at each point (current position first for GCMRK)
        const pts = code === 0x82 ? [[st.x, st.y]] : [];
        for (let at = 0; at + 4 <= d.length; at += 4) pts.push(point(d, at));
        const [hx, hy] = st.markerCell ? [st.markerCell[0] * ctx.k / 2, st.markerCell[1] * ctx.k / 2] : [MARKER_CELL / 2, MARKER_CELL / 2];
        if (hx > 0 && hy > 0) {
          for (const pt of pts) {
            for (const item of markerItems(st.marker, ...P(...pt), hx, hy, st.color)) items.push({ ...item, ...colorSpecField(st.colorSpec), sourceField: ctx.sourceField, fileId: ctx.fileId });
          }
        }
        if (pts.length) [st.x, st.y] = pts[pts.length - 1];
        break;
      }
      case 0x0a: st.color = GOCA_COLORS[d[0]] ?? st.color; st.colorSpec = ocaColorSpec(d[0]); break; // GSCOL
      case 0x26: st.color = GOCA_COLORS[u(d, 0, 2)] ?? st.color; st.colorSpec = ocaColorSpec(u(d, 0, 2)); break; // GSECOL
      case 0xb2: st.color = extendedColor(d) ?? st.color; st.colorSpec = extendedColorSpec(d) ?? st.colorSpec; break; // GSPCOL (process color)
      case 0x19: st.lineWidth = d[0] || 1; break; // GSLW
      case 0x11: st.lineWidth = d[0] + (d[1] ?? 0) / 256; break; // GSFLW
      case 0x21: [st.x, st.y] = point(d, 0); break; // GSCP
      case 0x22: st.arc = { p: s(d, 0, 2), q: s(d, 2, 2), r: s(d, 4, 2), s: s(d, 6, 2) }; break; // GSAP
      case 0x33: { // GSCC: character cell width and height in GPS units (8-byte form with fractions)
        const frac = (at) => (d.length >= 8 ? u(d, at, 2) / 65536 : 0);
        st.cellW = Math.abs(s(d, 0, 2) + frac(4));
        st.cell = Math.abs(s(d, 2, 2) + frac(6));
        break;
      }
      case 0x68: // GBAR: flags bit 1 draw the boundary, bit 2 nonzero winding (else alternate)
        st.area = {
          commands: [], color: st.color, colorSpec: st.colorSpec, boundary: (d[0] & 0x40) !== 0, nonzero: (d[0] & 0x20) !== 0,
          patternSet: st.patternSet, pattern: st.pattern, ref: st.patternRef, boundaryItems: [],
        };
        break;
      case 0x60: { // GEAR: fill the area (pattern and color of Begin Area), then its boundary
        const area = st.area;
        st.area = null;
        if (!area) break;
        // Pattern sets X'01'–X'FD' hold custom patterns and gradients of this segment (T301); a
        // pattern that is not defined fills solid (EC-6803/6804, standard default pattern).
        const hex = (v) => v.toString(16).toUpperCase().padStart(2, '0');
        const def = area.patternSet !== 0 && area.pattern !== 0 ? st.patterns.get(`${area.patternSet}:${area.pattern}`) : null;
        if (area.patternSet !== 0 && area.pattern !== 0 && !def) ctx.report(`GOCA pattern X'${hex(area.patternSet)}' X'${hex(area.pattern)}' is not defined`);
        const fill = area.patternSet !== 0 ? 'solid' : patternFill(area.pattern);
        if (area.commands.length && fill !== 'none') {
          const item = { type: 'path', commands: [...area.commands, ['Z']], stroke: null, fill: area.color, ...colorSpecField(area.colorSpec), lineWidth: 0,
            fillRule: area.nonzero ? 'nonzero' : 'evenodd', sourceField: ctx.sourceField, fileId: ctx.fileId };
          if (fill === 'pattern') item.pattern = area.pattern;
          if (!def || patternedFill(item, def, area)) items.push(item);
        }
        items.push(...area.boundaryItems);
        break;
      }
      case 0xc1: case 0x81: { // GLINE
        const pts = [];
        let at = 0;
        if (code === 0x81) pts.push([st.x, st.y]);
        for (; at + 4 <= d.length; at += 4) pts.push(point(d, at));
        polyline(pts);
        [st.x, st.y] = pts[pts.length - 1] ?? [st.x, st.y];
        break;
      }
      case 0xe1: case 0xa1: { // GRLINE: start point (given) then 1-byte relative offsets
        let at = 0;
        let cur = [st.x, st.y];
        if (code === 0xe1) { cur = point(d, 0); at = 4; }
        const pts = [cur];
        for (; at + 2 <= d.length; at += 2) {
          cur = [cur[0] + s(d, at, 1), cur[1] + s(d, at + 1, 1)];
          pts.push(cur);
        }
        polyline(pts);
        [st.x, st.y] = cur;
        break;
      }
      case 0xc0: case 0x80: { // GBOX: flags, reserved, [x0,y0], x1,y1
        const filled = (d[0] & 0x40) !== 0;
        let at = 2;
        let p0 = [st.x, st.y];
        if (code === 0xc0) { p0 = point(d, 2); at = 6; }
        const p1 = point(d, at);
        const [x0, y0] = P(...p0);
        const [x1, y1] = P(...p1);
        const cmds = [['M', x0, y0], ['L', x1, y0], ['L', x1, y1], ['L', x0, y1], ['Z']];
        if (st.area) {
          st.area.commands.push(...cmds);
          const line = st.area.boundary ? stroke(cmds, 'miter') : null;
          if (line) st.area.boundaryItems.push(line);
        } else if (filled) {
          items.push({ type: 'path', commands: cmds, stroke: null, fill: st.color, ...colorSpecField(st.colorSpec), lineWidth: lineWidthUnits(), sourceField: ctx.sourceField, fileId: ctx.fileId });
        } else {
          // Line joins do not apply to the corners of a Box: they stay sharp.
          const line = stroke(cmds, 'miter');
          if (line) items.push(line);
        }
        [st.x, st.y] = p0;
        break;
      }
      case 0xc5: case 0x85: { // GFLT: smooth curve through the control polygon (quadratic B-spline)
        const pts = code === 0x85 ? [[st.x, st.y]] : [];
        for (let at = 0; at + 4 <= d.length; at += 4) pts.push(point(d, at));
        if (pts.length >= 2) {
          const cmds = [['M', ...P(...pts[0])]];
          for (let i = 1; i < pts.length - 1; i++) {
            const mid = [(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2];
            const end = i === pts.length - 2 ? pts[i + 1] : mid;
            const [cx, cy] = P(...pts[i]);
            const [ex, ey] = P(...end);
            cmds.push(['Q', cx, cy, ex, ey]);
          }
          if (pts.length === 2) cmds.push(['L', ...P(...pts[1])]);
          path(cmds);
          [st.x, st.y] = pts[pts.length - 1];
        }
        break;
      }
      case 0xc7: case 0x87: { // GFARC: [center], multiplier (integer, fraction)
        let at = 0;
        let c = [st.x, st.y];
        if (code === 0xc7) { c = point(d, 0); at = 4; }
        const mult = d[at] + (d[at + 1] ?? 0) / 256;
        path(ellipse(c[0], c[1], mult));
        [st.x, st.y] = c;
        break;
      }
      case 0xe3: case 0xa3: { // GPARC: [start point], center, multiplier, start angle, sweep angle
        let at = 0;
        if (code === 0xe3) { [st.x, st.y] = point(d, 0); at = 4; }
        const c = point(d, at);
        const mult = (u(d, at + 4, 2) + (u(d, at + 6, 2) / 65536));
        const start = s(d, at + 8, 2) + u(d, at + 10, 2) / 65536;
        const sweep = s(d, at + 12, 2) + u(d, at + 14, 2) / 65536;
        const cmds = ellipse(c[0], c[1], mult, start, sweep);
        cmds.unshift(['M', ...P(st.x, st.y)]);
        cmds[1][0] = 'L';
        path(cmds);
        break;
      }
      case 0xe5: case 0xa5: { // GCBEZ: [start], then groups of 3 points
        let at = 0;
        let cur = [st.x, st.y];
        if (code === 0xe5) { cur = point(d, 0); at = 4; }
        const cmds = [['M', ...P(...cur)]];
        for (; at + 12 <= d.length; at += 12) {
          const [a, b, c] = [point(d, at), point(d, at + 4), point(d, at + 8)];
          cmds.push(['C', ...P(...a), ...P(...b), ...P(...c)]);
          cur = c;
        }
        path(cmds);
        [st.x, st.y] = cur;
        break;
      }
      case 0xc3: case 0x83: { // GCHST: [point] then characters
        let at = 0;
        if (code === 0xc3) { [st.x, st.y] = point(d, 0); at = 4; }
        items.push(...characterString(d.subarray(at), P(st.x, st.y)));
        break;
      }
      case 0xd1: case 0x91: { // GBIMG: [point], format, reserved, width, height
        let at = 0;
        if (code === 0xd1) { [st.x, st.y] = point(d, 0); at = 4; }
        const width = u(d, at + 2, 2);
        const height = u(d, at + 4, 2);
        st.image = { width, height, rowBytes: Math.ceil(width / 8), rows: [], x: st.x, y: st.y, color: st.color, colorSpec: st.colorSpec };
        break;
      }
      case 0x92: if (st.image) st.image.rows.push(d); break; // GIMD: one row of image data
      case 0x93: { // GEIMG
        const img = st.image;
        st.image = null;
        if (!img || !img.width || !img.height) break;
        const bits = new Uint8Array(img.rowBytes * img.height);
        img.rows.slice(0, img.height).forEach((row, i) => bits.set(row.subarray(0, img.rowBytes), i * img.rowBytes));
        const [x, y] = P(img.x, img.y);
        const pel = ctx.pelK ?? { x: ctx.k, y: ctx.k };
        items.push({ type: 'image', rect: { x, y, width: img.width * pel.x, height: img.height * pel.y }, rotation: 0,
          inline: { width: img.width, height: img.height, bilevel: { rowBytes: img.rowBytes, bits }, color: img.color },
          colorSpace: 'bilevel', pixelSpace: 'bilevel', ...colorSpecField(img.colorSpec), sourceField: ctx.sourceField, fileId: ctx.fileId });
        break;
      }
      case 0xa0: st.patternRef = d[0] & 0x80 ? [0, 0] : point(d, 2); break; // GSPRP
      case 0xde: { // GBCP: flags, pattern set and symbol, window (x left, right, y bottom, top)
        if (ctx.inPattern) break; // EC-DE00 inside a custom pattern definition (not reached: ended above)
        const [xl, xr, yb, yt] = [s(d, 5, 2), s(d, 7, 2), s(d, 9, 2), s(d, 11, 2)];
        const key = `${d[3]}:${d[4]}`;
        const valid = d.length >= 13 && d[3] >= 0x01 && d[3] <= 0xfd && d[4] >= 0x01 && xl < xr && yb < yt && !st.patterns.has(key);
        capture = { key, valid, fullColor: (d[2] & 0x80) !== 0, box: [xl, xr, yb, yt], orders: [] };
        break;
      }
      case 0x5e: break; // GECP without a Begin Custom Pattern (EC-5E00): ignored
      case 0xdf: { // GDPT: delete one pattern, or all of a pattern set
        if (ctx.inPattern || d.length < 3) break;
        if (d.length >= 4) st.patterns.delete(`${d[2]}:${d[3]}`);
        else for (const key of [...st.patterns.keys()]) if (key.startsWith(`${d[2]}:`)) st.patterns.delete(key);
        break;
      }
      case 0xfedc: case 0xfedd: { // GLGD, GRGD: define a gradient (ignored inside a custom pattern)
        if (ctx.inPattern) break;
        const g = code === 0xfedc ? readLinearGradient(d) : readRadialGradient(d);
        const key = g && `${g.set}:${g.symbol}`;
        if (g && g.set >= 0x01 && g.set <= 0xfd && g.symbol >= 0x01 && !st.patterns.has(key)) {
          st.patterns.set(key, { ...g, arc: { ...st.arc } });
        } else if (!g) {
          ctx.report(`GOCA ${code === 0xfedc ? 'linear' : 'radial'} gradient with an invalid color specification`);
        }
        break;
      }
      default:
        unknown.add(code);
    }
    // The Graphics Data fields an item comes from (marking a GAD on the page): from the field that
    // opened its area or image (else its own) to the field of the order that completed it.
    if (field !== undefined) {
      for (let i = made; i < items.length; i++) {
        items[i].dataField = field;
        items[i].dataFieldFrom = openedIn ?? field;
      }
    }
    if (code === 0x60 || code === 0x93) openedIn = null;
  }
  if (capture) endCapture(); // EC-DE01: the segment ended inside a custom pattern definition
  for (const code of unknown) ctx.report(`GOCA order X'${code.toString(16).toUpperCase().padStart(2, '0')}'`);
  return items;
}

/**
 * Renders a graphics object.
 * @param {object} r Render context.
 * @param {object} file File record.
 * @param {number} row Row of Begin Graphics Object.
 * @param {object} env Environment of the including page.
 * @param {{x: number, y: number}} origin Origin in page units.
 * @param {object|null} [areaOverride] Object area from an Include Object field.
 * @returns {Promise<object[]>} Render items.
 */
async function renderGoca(r, file, row, env, origin, areaOverride = null) {
  await loadCodePage('ebcdic-500');
  const fields = await collectFields(file, row, new Set([GDD, GAD]));
  const gdd = readGdd(fields.find((f) => f.id === GDD)?.data);
  const gads = fields.filter((f) => f.id === GAD);
  const orders = splitOrders(concat(gads.map((f) => f.data)));
  // Which Graphics Data field each order starts in: items carry it as `dataField`, so "Show on
  // page" for one GAD marks only what its orders draw, not the whole graphics object.
  const starts = [];
  let at = 0;
  for (const f of gads) { starts.push([at, f.row]); at += f.data.length; }
  for (const o of orders) {
    let k = starts.length - 1;
    while (k > 0 && starts[k][0] > o.pos) k--;
    o.field = starts[k]?.[1];
  }
  const area = (await readObjectArea(file, row, env, areaOverride)) ?? { x: 0, y: 0, width: null, height: null, contentX: 0, contentY: 0, mappingOption: null };
  let k = gdd.unitsPerTenInches ? toPageUnits(gdd.base === 1 ? 1 : 0, gdd.unitsPerTenInches) : env.kx;
  // Image points (GBIMG) are pels in the object area's units, not graphics window units, e.g. a
  // window of 1416 × 536 at 300 dpi with area and image 1128 × 429 at 300 dpi, or a window of
  // 808 × 286 at 240 dpi with area and image 808 × 286 at 300 dpi.
  const pelK = { x: area.unitX ?? k, y: area.unitY ?? k };
  // Mapping of the GPS window onto the object area (MO:DCA Mapping Option triplet X'04', GOCA
  // "Mapping Control Options"): X'10' position and trim (also X'00' position) puts the window's
  // upper left corner at the content offset, to scale; X'20' scale to fit (the default without
  // a Map Graphics Object, MO:DCA MGO semantics) and X'60' scale to fill center or stretch the
  // window over the area; X'30' center and trim centers it to scale. "… and trim" clips at the
  // object area.
  const winW = gdd.xr - gdd.xl;
  const winH = gdd.yt - gdd.yb;
  const mapping = area.mappingOption ?? 0x20;
  let kx = k;
  let ky = k;
  // Offsets of the window inside the object area, in the area's own (unrotated) frame.
  let lx = area.contentX ?? 0;
  let ly = area.contentY ?? 0;
  let trim = false;
  const aw = area.width;
  const ah = area.height;
  if (aw && ah && winW > 0 && winH > 0) {
    if (mapping === 0x20) {
      kx = ky = Math.min(aw / winW, ah / winH);
      lx = (aw - winW * kx) / 2;
      ly = (ah - winH * ky) / 2;
    } else if (mapping === 0x60) {
      kx = aw / winW;
      ky = ah / winH;
      lx = 0;
      ly = 0;
    } else if (mapping === 0x30) {
      lx = (aw - winW * k) / 2;
      ly = (ah - winH * k) / 2;
    }
    trim = mapping === 0x10 || mapping === 0x30;
    k = Math.min(kx, ky);
  }
  // The object area may be turned (Object Area Position, orientation of its X axis: 0, 90, 180
  // or 270 degrees clockwise) around its origin; the picture turns with it, as images do (e.g.
  // pie charts on landscape pages in areas turned by 90 degrees).
  const ax = origin.x + area.x;
  const ay = origin.y + area.y;
  const rotation = area.rotation ?? 0;
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad) * 1e12) / 1e12;
  const sin = Math.round(Math.sin(rad) * 1e12) / 1e12;
  const turn = (x, y) => [ax + x * cos - y * sin, ay + x * sin + y * cos];
  const reported = new Set();
  // Fonts of character strings (T300): the character sets the orders select, mapped by the
  // object's or the page's Map Coded Font.
  const sets = new Set(orders.filter((o) => o.code === 0x38 && o.data[0] >= 0x01 && o.data[0] <= 0xfe).map((o) => o.data[0]));
  const fonts = new Map();
  if (sets.size) {
    const specs = await readObjectFonts(file, row, env);
    for (const lid of sets) if (specs.has(lid)) fonts.set(lid, await r.fonts.resolve(specs.get(lid)));
  }
  const items = runGoca(orders, {
    k,
    pelK,
    font: (lid) => fonts.get(lid) ?? null,
    toPage: (gx, gy) => turn(lx + (gx - gdd.xl) * kx, ly + (gdd.yt - gy) * ky),
    sourceField: row,
    fileId: file.id,
    report: (reason) => {
      if (reported.has(reason)) return;
      reported.add(reason);
      r.report({ severity: 'warning', code: 'unsupportedObject', fileId: file.id, offset: file.index.offset[row], params: { file: file.path, reason } });
    },
  });
  // Text and images keep their own direction on top of the area's.
  if (rotation) for (const item of items) if ('rotation' in item) item.rotation = ((item.rotation ?? 0) + rotation) % 360;
  if (!trim) return items;
  // "… and trim": the turned area (a whole number of quarter turns, so its box is exact).
  const corners = [[0, 0], [aw, 0], [aw, ah], [0, ah]].map(([x, y]) => turn(x, y));
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const clip = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
  return items.map((item) => ({ ...item, clip }));
}

registerObjectRenderer(BGR, renderGoca);
