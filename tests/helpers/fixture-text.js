/**
 * Text building blocks for synthetic fixtures: a small 240-dpi raster font character set with
 * the glyphs A, B, C and space (drawn for the fixtures), a code page mapping EBCDIC X'C1'–X'C3'
 * and X'40' to them, a Map Coded Font (format 2) for local id 1, and PTOCA control sequences in
 * unchained form (X'2BD3').
 *
 * Field layouts follow the FOCA Reference (Font Descriptor, Font Control, Font Orientation, Font
 * Position, Font Index, Font Patterns Map, Font Patterns, Code Page Descriptor/Control/Index) and
 * the PTOCA Reference. Every glyph advances 24 font units = 24/240 inch = 144 page units.
 */
import { bytes, field, uint, ebcdic, triplet, group, resource, ID } from './afp-builder.js';

export const FONT_NAME = 'C0NEOAF1';
export const CODE_PAGE_NAME = 'T1NEOAF1';

/** Glyphs: GCGID, code point, 16 × 20 bitmap rows (as strings, '#' = black). */
const GLYPHS = [
  ['LA020000', 0xc1, [
    '......####......', '.....######.....', '....###..###....', '...###....###...', '..###......###..',
    '..###......###..', '..###......###..', '..############..', '..############..', '..###......###..',
    '..###......###..', '..###......###..', '..###......###..', '..###......###..', '..###......###..',
    '..###......###..', '..###......###..', '..###......###..', '..###......###..', '................',
  ]],
  ['LB020000', 0xc2, [
    '..##########....', '..###.....###...', '..###......###..', '..###......###..', '..###.....###...',
    '..##########....', '..##########....', '..###.....###...', '..###......###..', '..###......###..',
    '..###......###..', '..###......###..', '..###.....###...', '..##########....', '..#########.....',
    '................', '................', '................', '................', '................',
  ]],
  ['LC020000', 0xc3, [
    '.....######.....', '...###....###...', '..###......###..', '..###...........', '..###...........',
    '..###...........', '..###...........', '..###...........', '..###...........', '..###...........',
    '..###...........', '..###...........', '..###......###..', '...###....###...', '.....######.....',
    '................', '................', '................', '................', '................',
  ]],
  ['SP010000', 0x40, Array.from({ length: 20 }, () => '................')],
];

const RESOLUTION = 240;
const INCREMENT_PELS = 24; // font units (1/240 inch)
const ASCENDER_PELS = 18;

/**
 * Builds the raster font character set.
 * @param {string} [name] Resource name.
 * @param {{resolution?: number, bare?: boolean, relative?: boolean}} [options] Font Control
 *   resolution in dpi (the metrics stay in 1/240 inch units, which only matters for resolution
 *   choice tests), whether to leave out the Begin/End Resource envelope (a font resource file
 *   of its own), and whether to give the metrics in relative units (1000 per em, unit base
 *   X'02', bitmaps at 240 dpi in Shape Resolution): the same font, as 10 pt at 240 dpi is
 *   33⅓ pels per em, so each value is the pel value × 30.
 * @returns {Uint8Array} Begin Font … End Font (in Begin/End Resource unless bare).
 */
export function fontCharacterSet(name = FONT_NAME, { resolution = RESOLUTION, bare = false, relative = false } = {}) {
  const r = relative ? 30 : 1;
  const INCREMENT = INCREMENT_PELS * r;
  const ASCENDER = ASCENDER_PELS * r;
  // FND (80 bytes): description, weight and width class, point sizes 10 pt, horizontal sizes,
  // design class, reserved, design flags, reserved, GCSGID and FGID 0.
  const fnd = bytes(ebcdic('NEOAFP FIXTURE', 32), 0x05, 0x05, uint(100, 2), uint(100, 2), uint(100, 2), new Uint8Array(40));
  const fnc = relative
    ? bytes(0x01, 0x05, 0x00, 0x00, 0x02, 0x02, uint(1000, 2), uint(1000, 2),
      uint(16, 2), uint(20, 2), 26, 28, 0x00, uint(GLYPHS.length * 40, 3), 22, 8, new Uint8Array(2), uint(2400, 2), uint(2400, 2), new Uint8Array(14))
    : bytes(0x01, 0x05, 0x00, 0x00, 0x00, 0x00, uint(resolution * 10, 2), uint(resolution * 10, 2),
      uint(16, 2), uint(20, 2), 26, 28, 0x00, uint(GLYPHS.length * 40, 3), 22, 8, new Uint8Array(20));
  // One FNO repeating group of 26 bytes (0°): reserved, rotation, maximum baseline offset,
  // maximum character increment, space increment, maximum baseline extent, flags, reserved,
  // em-space increment, reserved, figure-space and nominal increment, default baseline
  // increment, minimum A-space.
  const fno = bytes(uint(0, 2), uint(0x0000, 2), uint(ASCENDER, 2), uint(INCREMENT, 2), uint(INCREMENT, 2),
    uint((ASCENDER_PELS + 2) * r, 2), 0x00, 0x00, uint(INCREMENT, 2), uint(0, 2), uint(INCREMENT, 2), uint(INCREMENT, 2),
    uint((INCREMENT_PELS + 6) * r, 2), uint(0, 2));
  // FNP (22 bytes): reserved, lowercase height, cap-M height, maximum ascender, maximum
  // descender, reserved, retired X'01', reserved, underscore width and position.
  const fnp = bytes(uint(0, 2), uint(14 * r, 2), uint(0, 2), uint(ASCENDER, 2), uint(2 * r, 2), new Uint8Array(5), 0x01, 0x00,
    uint(1 * r, 2), 0x00, uint(3 * r, 2));
  const fni = bytes(...GLYPHS.map(([gcgid], i) => bytes(ebcdic(gcgid, 8), uint(INCREMENT, 2), uint(ASCENDER, 2),
    uint(2 * r, 2), uint(0, 2), uint(i, 2), uint(4 * r, 2), uint(16 * r, 2), uint(4 * r, 2), uint(0, 2), uint(ASCENDER, 2))));
  const fnm = bytes(...GLYPHS.map((_, i) => bytes(uint(15, 2), uint(19, 2), uint(i * 40, 4))));
  const fng = bytes(...GLYPHS.map(([, , rows]) => bytes(...rows.map((r) => uint(Number.parseInt(r.replace(/#/g, '1').replace(/\./g, '0'), 2), 2)))));
  const font = group(ID.BFN, name,
    field('D3A689', fnd), field('D3A789', fnc), field('D3AE89', fno), field('D3AC89', fnp),
    field('D38C89', fni), field('D3A289', fnm), field('D3EE89', fng));
  return bare ? font : resource(name, 0x40, font);
}

/**
 * Builds the code page.
 * @param {string} [name] Resource name.
 * @returns {Uint8Array} Begin Code Page … End Code Page.
 */
export function codePage(name = CODE_PAGE_NAME) {
  const cpd = bytes(ebcdic('NEOAFP FIXTURE CODE PAGE', 32), uint(8, 2), uint(GLYPHS.length, 4), uint(0, 2), uint(0, 2));
  const cpc = bytes(ebcdic('SP010000', 8), 0x00, 10, 0x00, 0x40, 0x00);
  const cpi = bytes(...GLYPHS.map(([gcgid, cp]) => bytes(ebcdic(gcgid, 8), 0x00, cp)));
  return resource(name, 0x41, group(ID.BCP, name, field('D3A687', cpd), field('D3A787', cpc), field('D38C87', cpi)));
}

/**
 * Map Coded Font (format 2): local id 1 → font character set + code page.
 * @returns {Uint8Array} Field.
 */
export function mapCodedFont() {
  const fqn = (type, name) => triplet(0x02, type, 0x00, ebcdic(name, 8));
  const rg = bytes(triplet(0x24, 0x05, 1), fqn(0x86, FONT_NAME), fqn(0x85, CODE_PAGE_NAME), triplet(0x26, uint(0, 2)));
  return field('D3AB8A', bytes(uint(rg.length + 2, 2), rg));
}

/** PTOCA control sequence in unchained form. */
export const cs = (type, ...params) => {
  const p = bytes(...params);
  return bytes(0x2b, 0xd3, p.length + 2, type, p);
};
export const AMI = (v) => cs(0xc6, uint(v, 2));
export const AMB = (v) => cs(0xd2, uint(v, 2));
export const RMI = (v) => cs(0xc8, uint(v & 0xffff, 2));
export const RMB = (v) => cs(0xd4, uint(v & 0xffff, 2));
export const SBI = (v) => cs(0xd0, uint(v, 2));
export const SIM = (v) => cs(0xc0, uint(v, 2));
export const BLN = () => cs(0xd8);
export const SCFL = (id) => cs(0xf0, id);
export const TRN = (text) => cs(0xda, ebcdic(text));
export const STC = (color) => cs(0x74, uint(color, 2));
export const STO = (deg) => cs(0xf6, uint((deg / 90) * 0x2d00, 2), uint(((deg / 90 + 1) % 4) * 0x2d00, 2));
export const SEC_RGB = (r, g, b) => cs(0x80, 0x00, 0x01, 0, 0, 0, 0, 8, 8, 8, 0, r, g, b);
