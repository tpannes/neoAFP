/**
 * GOCA gradients (GOCA for AFP Reference AFPC-0008-03, "Gradients", Linear Gradient X'FEDC',
 * Radial Gradient X'FEDD'; task T301): reading the orders, and the color stops a drawing surface
 * needs to show a gradient over a parameter range wider than 0…1, with the Outside values of both
 * sides (None, Pad, Repeat, Reflect).
 *
 * A gradient is parameterized by t: 0 at the start (point or full arc), 1 at the end. Canvas
 * gradients pad beyond their ends, so the other Outside values are drawn by giving the canvas
 * gradient a range [tmin, tmax] that covers the area and stops that repeat, mirror or end there.
 * Colors are interpolated by the drawing surface in RGB (the reference asks for the gradient's
 * own color space; CMYK and CIELAB gradients are converted to RGB at each stop).
 */

import { extendedColor } from '../ptoca/ptoca.js';
import { u, s } from '../modca/bytes.js';

/** Outside values: X'00' None, X'01' Pad, X'02' Repeat, X'03' Reflect (invalid: None, EC-DC04). */
const OUTSIDE = ['none', 'pad', 'repeat', 'reflect'];

/** Transparent color for areas a gradient leaves unfilled. */
export const TRANSPARENT = 'rgba(0,0,0,0)';

/**
 * Reads the colors, Outside values and color stops that follow the geometry of a gradient order.
 * @param {Uint8Array} d Order data.
 * @param {number} at Offset of COLSPEC_S.
 * @returns {{stops: {offset: number, color: string}[], outside: [string, string]}|null} Colors,
 *   or null when the order is to be ignored (invalid color specification).
 */
function readColors(d, at) {
  const len = d[at];
  if (len < 12 || len > 14 || at + 1 + len > d.length) return null; // EC-DC06
  const header = d.subarray(at + 1, at + 11); // RES1, COLSPCE, RES2, COLSIZE1–4
  const size = len - 10;
  const color = (pos) => extendedColor(new Uint8Array([...header, ...d.subarray(pos, pos + size)]));
  const start = color(at + 11);
  let pos = at + 1 + len;
  const end = color(pos);
  pos += size;
  if (!start || !end || pos + 2 > d.length) return null; // EC-0E02/0E03
  const outside = [OUTSIDE[d[pos]] ?? 'none', OUTSIDE[d[pos + 1]] ?? 'none'];
  pos += 2;
  const stops = [{ offset: 0, color: start }];
  let last = 0;
  for (; pos + 2 + size <= d.length; pos += 2 + size) {
    const offset = u(d, pos, 2);
    if (offset > 10000 || offset / 10000 < last) continue; // EC-DC05: ignore the stop
    last = offset / 10000;
    stops.push({ offset: last, color: color(pos + 2) ?? end });
  }
  stops.push({ offset: 1, color: end });
  return { stops, outside };
}

/**
 * Reads a Linear Gradient order (data after the 2-byte length).
 * @param {Uint8Array} d Order data.
 * @returns {{kind: 'linear', set: number, symbol: number, start: [number, number], end: [number, number],
 *   stops: {offset: number, color: string}[], outside: [string, string]}|null} Gradient (GPS units), or null.
 */
export function readLinearGradient(d) {
  if (d.length < 29) return null;
  const colors = readColors(d, 12);
  if (!colors) return null;
  return { kind: 'linear', set: d[2], symbol: d[3], start: [s(d, 4, 2), s(d, 6, 2)], end: [s(d, 8, 2), s(d, 10, 2)], ...colors };
}

/**
 * Reads a Radial Gradient order (data after the 2-byte length).
 * @param {Uint8Array} d Order data.
 * @returns {{kind: 'radial', set: number, symbol: number, start: [number, number], end: [number, number],
 *   m0: number, m1: number, stops: {offset: number, color: string}[], outside: [string, string]}|null}
 *   Gradient: full arc centers (GPS units) and multipliers, or null.
 */
export function readRadialGradient(d) {
  if (d.length < 33) return null;
  const colors = readColors(d, 16);
  if (!colors) return null;
  return {
    kind: 'radial', set: d[2], symbol: d[3], start: [s(d, 4, 2), s(d, 6, 2)], m0: d[8] + d[9] / 256,
    end: [s(d, 10, 2), s(d, 12, 2)], m1: d[14] + d[15] / 256, ...colors,
  };
}

/**
 * Parses a color as RGBA components.
 * @param {string} c '#rrggbb' or TRANSPARENT.
 * @returns {number[]} [r, g, b, a].
 */
function rgba(c) {
  if (c === TRANSPARENT) return [0, 0, 0, 0];
  return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)).concat(1);
}

/**
 * Mixes two colors.
 * @param {string} a First color.
 * @param {string} b Second color.
 * @param {number} f Share of the second (0…1).
 * @returns {string} Color (hex when opaque).
 */
function mix(a, b, f) {
  const [x, y] = [rgba(a), rgba(b)];
  const v = x.map((c, i) => c + (y[i] - c) * f);
  if (v[3] === 1) return `#${v.slice(0, 3).map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
  return `rgba(${v.slice(0, 3).map(Math.round).join(',')},${Math.round(v[3] * 1000) / 1000})`;
}

/**
 * Stops of one period [n, n + 1] of the gradient, as absolute t values.
 * @param {{offset: number, color: string}[]} stops Gradient stops (0…1).
 * @param {number} n Period (0 is the gradient itself; negative: start side; positive: end side).
 * @param {[string, string]} outside Outside values of the start and the end side.
 * @returns {{t: number, color: string}[]} Stops.
 */
function period(stops, n, outside) {
  if (n === 0) return stops.map((p) => ({ t: p.offset, color: p.color }));
  const mode = outside[n < 0 ? 0 : 1];
  if (mode === 'none') return [{ t: n, color: TRANSPARENT }, { t: n + 1, color: TRANSPARENT }];
  if (mode === 'pad') {
    const c = n < 0 ? stops[0].color : stops[stops.length - 1].color;
    return [{ t: n, color: c }, { t: n + 1, color: c }];
  }
  // Repeat: the gradient again; Reflect: mirrored in every other period next to the gradient.
  const mirrored = mode === 'reflect' && Math.abs(n) % 2 === 1;
  return mirrored
    ? [...stops].reverse().map((p) => ({ t: n + 1 - p.offset, color: p.color }))
    : stops.map((p) => ({ t: n + p.offset, color: p.color }));
}

/**
 * The color stops of a gradient drawn over the range [tmin, tmax]: canvas offsets 0…1 map to
 * tmin…tmax. Outside the gradient (t < 0 or t > 1) they follow the Outside values; at most 64
 * periods on each side are repeated, beyond that the last color is padded.
 * @param {{offset: number, color: string}[]} stops Gradient stops (0…1, increasing).
 * @param {[string, string]} outside Outside values of the start and the end side.
 * @param {number} tmin Start of the range (≤ 0).
 * @param {number} tmax End of the range (≥ 1).
 * @returns {{offset: number, color: string}[]} Stops for the drawing surface.
 */
export function gradientStops(stops, outside, tmin, tmax) {
  const lo = Math.max(Math.floor(tmin), -64);
  const hi = Math.min(Math.ceil(tmax), 65);
  const all = [];
  for (let n = lo; n < hi; n++) all.push(...period(stops, n, outside));
  // The color at t, from the sorted stop list (a jump uses the later stop at its offset).
  const at = (t) => {
    if (t <= all[0].t) return all[0].color;
    for (let i = 1; i < all.length; i++) {
      if (t <= all[i].t) {
        const [a, b] = [all[i - 1], all[i]];
        return b.t === a.t ? b.color : mix(a.color, b.color, (t - a.t) / (b.t - a.t));
      }
    }
    return all[all.length - 1].color;
  };
  const span = tmax - tmin;
  const out = [{ offset: 0, color: at(tmin) }];
  for (const p of all) if (p.t > tmin && p.t < tmax) out.push({ offset: (p.t - tmin) / span, color: p.color });
  out.push({ offset: 1, color: at(tmax) });
  return out;
}

/**
 * The parameter range of a linear gradient that covers the given points (with 0…1).
 * @param {[number, number]} p0 Start point.
 * @param {[number, number]} p1 End point.
 * @param {[number, number][]} points Points to cover (same coordinates).
 * @returns {[number, number]} [tmin, tmax].
 */
export function linearRange(p0, p1, points) {
  const d = [p1[0] - p0[0], p1[1] - p0[1]];
  const len2 = d[0] * d[0] + d[1] * d[1];
  let [tmin, tmax] = [0, 1];
  for (const [x, y] of points) {
    const t = ((x - p0[0]) * d[0] + (y - p0[1]) * d[1]) / len2;
    tmin = Math.min(tmin, t);
    tmax = Math.max(tmax, t);
  }
  return [tmin, tmax];
}

/**
 * The parameter range of a radial gradient (circles c0/r0 → c1/r1) that covers the given points:
 * for each point the circles through it, keeping radii ≥ 0. The canvas draws every circle of the
 * range, the later ones over the earlier ones, so the range only needs the extreme values.
 * @param {[number, number]} c0 Start center.
 * @param {number} r0 Start radius.
 * @param {[number, number]} c1 End center.
 * @param {number} r1 End radius.
 * @param {[number, number][]} points Points to cover (same coordinates).
 * @returns {[number, number]} [tmin, tmax].
 */
export function radialRange(c0, r0, c1, r1, points) {
  const dc = [c1[0] - c0[0], c1[1] - c0[1]];
  const dr = r1 - r0;
  // Radius zero bounds t on the side where the circles shrink.
  const tZero = dr !== 0 ? -r0 / dr : null;
  let [tmin, tmax] = [0, 1];
  const a = dc[0] * dc[0] + dc[1] * dc[1] - dr * dr;
  for (const [x, y] of points) {
    const d = [x - c0[0], y - c0[1]];
    const b = -2 * (d[0] * dc[0] + d[1] * dc[1] + r0 * dr);
    const c = d[0] * d[0] + d[1] * d[1] - r0 * r0;
    const roots = Math.abs(a) < 1e-9 ? (b !== 0 ? [-c / b] : [])
      : (b * b - 4 * a * c >= 0 ? [(-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a), (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a)] : []);
    for (const t of roots) {
      if (r0 + t * dr < 0) continue;
      tmin = Math.min(tmin, t);
      tmax = Math.max(tmax, t);
    }
  }
  if (tZero !== null && dr > 0) tmin = Math.max(tmin, tZero);
  if (tZero !== null && dr < 0) tmax = Math.min(tmax, tZero);
  return [tmin, tmax];
}
