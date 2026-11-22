/**
 * PTOCA interpreter: turns presentation text data (the content of Presentation Text Data fields)
 * into positioned text segments and rules.
 *
 * Presentation text is a stream of control sequences and characters. A control sequence starts
 * with the escape X'2BD3' (unless it is chained to the previous one), followed by its length
 * (counting length and type bytes), its type and its data. An odd type means "another control
 * sequence follows directly" (chained); an even type ends the chain. Bytes outside control
 * sequences are characters. Spec reference: PTOCA Reference (Presentation Text Object Content
 * Architecture), "Control Sequences".
 *
 * Positions use the text's inline (I) and baseline (B) axes. All values are converted to page
 * units (1/1440 inch) with the factor `k` given by the caller.
 */

import { u, s, orientation } from '../modca/bytes.js';
import { specTable, shortNames } from '../spec-table.js';

/** Control sequence types (unchained, even values) handled here. */
export const CONTROL_SEQUENCE_TABLE = specTable('PTOCA Reference (AFPC-0009-04)', 'Control Sequences', [
  [0xc0, 'SIM', 'Set Inline Margin'], [0xc2, 'SIA', 'Set Intercharacter Adjustment'],
  [0xc4, 'SVI', 'Set Variable Space Character Increment'], [0xc6, 'AMI', 'Absolute Move Inline'],
  [0xc8, 'RMI', 'Relative Move Inline'], [0xd0, 'SBI', 'Set Baseline Increment'], [0xd2, 'AMB', 'Absolute Move Baseline'],
  [0xd4, 'RMB', 'Relative Move Baseline'], [0xd8, 'BLN', 'Begin Line'], [0xda, 'TRN', 'Transparent Data'],
  [0xe4, 'DIR', 'Draw I-axis Rule'], [0xe6, 'DBR', 'Draw B-axis Rule'], [0xee, 'RPS', 'Repeat String'],
  [0xf0, 'SCFL', 'Set Coded Font Local'], [0xf2, 'BSU', 'Begin Suppression'], [0xf4, 'ESU', 'End Suppression'],
  [0xf6, 'STO', 'Set Text Orientation'], [0xf8, 'NOP', 'No Operation'], [0x72, 'OVS', 'Overstrike'],
  [0x74, 'STC', 'Set Text Color'], [0x76, 'USC', 'Underscore'], [0x78, 'TBM', 'Temporary Baseline Move'],
  [0x80, 'SEC', 'Set Extended Text Color'],
]);
/** Control sequence type → short name. */
export const CONTROL_SEQUENCES = shortNames(CONTROL_SEQUENCE_TABLE);

/** Standard OCA named colors (Set Text Color) as RGB hex. */
export const NAMED_COLORS = Object.freeze({
  0x0001: '#0000ff', 0x0002: '#ff0000', 0x0003: '#ff00ff', 0x0004: '#00ff00', 0x0005: '#00ffff',
  0x0006: '#ffff00', 0x0007: '#ffffff', 0x0008: '#000000', 0x0009: '#000080', 0x000a: '#ff8000',
  0x000b: '#800080', 0x000c: '#008000', 0x000d: '#008080', 0x000e: '#808000', 0x000f: '#808080',
  0x0010: '#804000', 0xff00: '#000000', 0xff07: '#000000', 0xff08: '#000000', 0x0000: '#000000',
});

/**
 * @typedef {object} TextFont
 * @property {(bytes: Uint8Array) => {code: number, length: number}[]} split Splits text bytes into
 *   code points (one or two bytes each).
 * @property {(code: number) => {id: string|number, unicode: string, advance: number,
 *   variableSpace: boolean}} glyph Glyph for a code point; advance in page units.
 * @property {number} baselineIncrement Default baseline increment in page units.
 * @property {{position: number, width: number}} underscore Underscore offset below the baseline
 *   and thickness, in page units.
 */

/**
 * @typedef {object} TextSegment
 * @property {'text'} type Segment type.
 * @property {number} i Inline position of the first glyph (page units).
 * @property {number} b Baseline position (page units).
 * @property {number} iDeg Inline direction in degrees.
 * @property {number} bDeg Baseline direction in degrees.
 * @property {number} lid Local font id.
 * @property {string} color RGB color.
 * @property {{id: string|number, unicode: string, code: number, di: number}[]} glyphs Glyphs with
 *   their code points (one or two bytes) and inline offsets.
 */

/**
 * Converts an extended color (Set Extended Text Color) to RGB.
 * @param {Uint8Array} d Control sequence data.
 * @returns {string|null} RGB color, or null if the color space is not supported.
 */
export function extendedColor(d) {
  const space = d[1];
  const value = d.subarray(10);
  const bits = d[6] || 8;
  const scale = (v) => Math.round((v / (2 ** bits - 1)) * 255);
  const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
  switch (space) {
    case 0x01: return hex(scale(value[0]), scale(value[1]), scale(value[2])); // RGB
    case 0x04: { // CMYK
      const [c, m, y, k] = [0, 1, 2, 3].map((i) => value[i] / 255);
      return hex(255 * (1 - c) * (1 - k), 255 * (1 - m) * (1 - k), 255 * (1 - y) * (1 - k));
    }
    case 0x06: return value[0] === 0 && value[1] === 0 ? '#000000' : '#808080'; // highlight color
    case 0x08: return labToRgb(value[0] * 100 / 255, s(value, 1, 1), s(value, 2, 1)); // CIELab
    case 0x40: return NAMED_COLORS[u(value, 0, 2)] ?? '#000000'; // standard OCA
    default: return null;
  }
}

/**
 * Converts CIELab (D65) to RGB.
 * @param {number} l Lightness 0–100.
 * @param {number} a a* value.
 * @param {number} b b* value.
 * @returns {string} RGB hex color.
 */
export function labToRgb(l, a, b) {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const f = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const [x, y, z] = [0.95047 * f(fx), 1 * f(fy), 1.08883 * f(fz)];
  const lin = [3.2406 * x - 1.5372 * y - 0.4986 * z, -0.9689 * x + 1.8758 * y + 0.0415 * z, 0.0557 * x - 0.204 * y + 1.057 * z];
  const gamma = (c) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  return `#${lin.map((c) => Math.round(Math.max(0, Math.min(255, gamma(c)))).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Runs presentation text and returns its text segments and rules.
 * @param {Uint8Array[]} parts Data of the object's Presentation Text Data fields, in order
 *   (the initial text conditions from the text descriptor may come first).
 * @param {object} ctx Context.
 * @param {number} ctx.k Factor from text units to page units.
 * @param {(lid: number) => TextFont} ctx.font Returns the font for a local id.
 * @param {(code: string, params: object) => void} ctx.report Records a problem.
 * @param {Set<number>} [ctx.suppressed] Active text suppression local IDs (MMC X'F3'): text between
 *   BSU and ESU with such an ID is not drawn but moves the position as if it were (PTOCA "BSU").
 * @returns {{segments: TextSegment[], rules: object[]}} Text segments and rules (page units,
 *   in the text's I/B coordinate system).
 */
export function runPtoca(parts, ctx) {
  const { k } = ctx;
  const st = {
    i: 0, b: 0, margin: 0, baselineInc: null, sia: 0, svi: null, lid: 0, color: '#000000',
    iDeg: 0, bDeg: 90, underscore: false, tbm: 0,
    // Local ID of the open text suppression (BSU … ESU) whose ID is active, else null.
    suppressing: null,
  };
  const segments = [];
  const rules = [];
  const unknown = new Set();
  /** Index of the part being run (each segment records the part its characters come from). */
  let part = 0;

  /** Current font. */
  const font = () => ctx.font(st.lid);

  /**
   * Places characters at the current position.
   * @param {Uint8Array} bytes Character bytes.
   * @returns {void}
   */
  const text = (bytes) => {
    if (bytes.length === 0) return;
    const f = font();
    const seg = { type: 'text', i: st.i, b: st.b + st.tbm, iDeg: st.iDeg, bDeg: st.bDeg, lid: st.lid, color: st.color, part, glyphs: [] };
    for (const { code } of f.split(bytes)) {
      const g = f.glyph(code);
      seg.glyphs.push({ id: g.id, unicode: g.unicode, code, di: st.i - seg.i });
      const advance = g.variableSpace && st.svi !== null ? st.svi : g.advance;
      st.i += advance + st.sia;
    }
    // Suppressed text (BSU/ESU, T284): positions move on as if it were there, nothing is drawn.
    if (st.suppressing !== null) return;
    segments.push(seg);
    if (st.underscore) {
      const us = f.underscore;
      rules.push({ axis: 'I', i: seg.i, b: seg.b + us.position, length: st.i - seg.i, width: us.width,
        iDeg: st.iDeg, bDeg: st.bDeg, color: st.color, part });
    }
  };

  /**
   * Executes one control sequence.
   * @param {number} type Type with the chaining bit cleared.
   * @param {Uint8Array} d Data.
   * @returns {void}
   */
  const control = (type, d) => {
    switch (type) {
      case 0xc0: st.margin = u(d, 0, 2) * k; break; // SIM
      case 0xc2: st.sia = (d[2] === 1 ? -1 : 1) * u(d, 0, 2) * k; break; // SIA
      case 0xc4: st.svi = u(d, 0, 2) * k; break; // SVI
      case 0xc6: st.i = u(d, 0, 2) * k; break; // AMI
      case 0xc8: st.i += s(d, 0, 2) * k; break; // RMI
      case 0xd0: st.baselineInc = u(d, 0, 2) * k; break; // SBI
      case 0xd2: st.b = u(d, 0, 2) * k; break; // AMB
      case 0xd4: st.b += s(d, 0, 2) * k; break; // RMB
      case 0xd8: st.i = st.margin; st.b += st.baselineInc ?? font().baselineIncrement; break; // BLN
      case 0xda: text(d); break; // TRN
      case 0xe4: case 0xe6: { // DIR, DBR
        const length = s(d, 0, 2) * k;
        const width = d.length >= 4 ? (s(d, 2, 2) + (d[4] ?? 0) / 256) * k : 0;
        if (st.suppressing === null) rules.push({ axis: type === 0xe4 ? 'I' : 'B', i: st.i, b: st.b, length, width, iDeg: st.iDeg, bDeg: st.bDeg, color: st.color, part });
        break;
      }
      case 0xee: { // RPS: repeat a string until the given byte length is filled
        const total = u(d, 0, 2);
        const pattern = d.subarray(2);
        if (pattern.length) {
          const out = new Uint8Array(total);
          for (let n = 0; n < total; n++) out[n] = pattern[n % pattern.length];
          text(out);
        }
        break;
      }
      case 0xf0: st.lid = d[0]; break; // SCFL
      case 0xf6: st.iDeg = orientation(u(d, 0, 2)); st.bDeg = orientation(u(d, 2, 2)); break; // STO
      case 0x74: st.color = NAMED_COLORS[u(d, 0, 2)] ?? st.color; break; // STC
      case 0x80: st.color = extendedColor(d) ?? st.color; break; // SEC
      case 0x76: st.underscore = d[0] !== 0; break; // USC (bypass flags; 0 = off)
      case 0x78: { // TBM
        const dir = d[0];
        const inc = d.length >= 4 ? u(d, 2, 2) * k : 0;
        st.tbm = dir === 1 ? 0 : dir === 2 ? st.tbm - inc : dir === 3 ? st.tbm + inc : st.tbm;
        break;
      }
      // BSU: suppression starts if its local ID is active (no nesting: a second BSU is ignored).
      case 0xf2: if (st.suppressing === null && ctx.suppressed?.has(d[0])) st.suppressing = d[0]; break;
      // ESU: ends the suppression with the same local ID (another ID is ignored).
      case 0xf4: if (st.suppressing === d[0]) st.suppressing = null; break;
      case 0xf8: case 0x72: break; // NOP, OVS: no visible effect here
      default: unknown.add(type);
    }
  };

  for (const [n, data] of parts.entries()) {
    part = n;
    let pos = 0;
    let chained = false;
    let textStart = 0;
    while (pos < data.length) {
      if (!chained) {
        if (data[pos] === 0x2b && data[pos + 1] === 0xd3) {
          text(data.subarray(textStart, pos));
          pos += 2;
          chained = true;
        } else {
          pos++;
          continue;
        }
      }
      const len = data[pos];
      const type = data[pos + 1];
      if (len < 2 || pos + len > data.length) break;
      control(type & 0xfe, data.subarray(pos + 2, pos + len));
      pos += len;
      chained = (type & 0x01) === 1;
      textStart = pos;
    }
    if (!chained) text(data.subarray(textStart, data.length));
  }
  for (const type of unknown) ctx.report('unsupportedObject', { reason: `PTOCA control sequence X'${type.toString(16).toUpperCase()}'` });
  return { segments, rules };
}
