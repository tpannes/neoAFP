/**
 * Synthetic fixture (task T044): a GOCA graphics object with lines, a box, a fillet, a full
 * arc, a cubic Bézier curve, a filled area and a character string.
 *
 * Graphics Data Descriptor: Set Picture Descriptor (X'F6') with 240 units per inch (2400 per 10
 * inches) and the window x 0–1200, y 0–600 (GOCA Reference, Graphics Data Descriptor). The
 * graphics space has its y axis upwards; with 1440 page units per inch one graphics unit is 6
 * page units, so graphics (gx, gy) lands on page (1440 + 6·gx, 1440 + 6·(600 − gy)) for the
 * object area at (1440, 1440); the Map Graphics Object maps the window with "scale to fit" onto
 * the object area of the same size. Orders (GOCA Reference, drawing orders): GSCOL, GSLW, GLINE,
 * GBOX, GFLT, GSAP + GFARC, GCBEZ, GBAR … GEAR, GSCC + GCHST, inside one Begin Segment.
 *
 * Running this module directly writes us1-graphics.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, uint, ebcdic, triplet, documentOf, page, group } from '../../helpers/afp-builder.js';

/** Signed 16-bit coordinate pair(s). */
const pt = (...coords) => bytes(...coords.map((v) => uint(v & 0xffff, 2)));
/** Order in code-length-data form. */
const order = (code, ...data) => {
  const d = bytes(...data);
  return bytes(code, d.length, d);
};

const ORDERS = bytes(
  0x0a, 0x02, // GSCOL red
  0x19, 0x02, // GSLW 2
  order(0xc1, pt(100, 500, 500, 500, 500, 400)), // GLINE: two connected lines
  0x0a, 0x04, // GSCOL green
  order(0xc0, 0x00, 0x00, pt(600, 550, 800, 400)), // GBOX: corner, opposite corner
  0x0a, 0x01, // GSCOL blue
  order(0xc5, pt(100, 300, 200, 380, 300, 220, 400, 300)), // GFLT
  0x0a, 0x08, // GSCOL black
  order(0x22, pt(50, 50, 0, 0)), // GSAP: circle of radius 50 · multiplier
  order(0xc7, pt(1000, 450), 0x01, 0x00), // GFARC: center, multiplier 1.0
  order(0xe5, pt(500, 100, 600, 300, 800, 0, 900, 200)), // GCBEZ: start + 3 points
  0x0a, 0x03, // GSCOL pink
  0x68, 0x00, // GBAR
  order(0xc1, pt(950, 100, 1150, 100, 1150, 250, 950, 250, 950, 100)), // closed boundary
  order(0x60), // GEAR
  0x0a, 0x08, // GSCOL black
  order(0x33, pt(60, 80)), // GSCC: character cell 60 × 80
  order(0xc3, pt(100, 50), ebcdic('GOCA')), // GCHST
);

/**
 * Builds the graphics object.
 * @returns {Uint8Array} Begin Graphics … End Graphics.
 */
function graphics() {
  const obd = bytes(triplet(0x43, 0x01), triplet(0x4b, 0x00, 0x00, uint(14400, 2), uint(14400, 2)),
    triplet(0x4c, 0x02, uint(7200, 3), uint(3600, 3)));
  const obp = bytes(0x01, 23, uint(1440, 3), uint(1440, 3), uint(0, 2), uint(0x2d00, 2), 0x00,
    uint(0, 3), uint(0, 3), uint(0, 2), uint(0x2d00, 2), 0x01); // RefCSys X'01': standard origin
  // Window Specification (GOCA, GDD in the MO:DCA environment): FLAGS (ABS = absolute picture
  // dimensions), reserved, CFORMAT, UBASE (10 inches), XRESOL, YRESOL, IMXYRES (not specified),
  // XLWIND, XRWIND, YBWIND, YTWIND.
  const gdd = order(0xf6, 0x40, 0x00, 0x00, 0x00, uint(2400, 2), uint(2400, 2), uint(0, 2), pt(0, 1200, 0, 600));
  // Begin Segment: name, flags, data length, predecessor name.
  const segment = bytes(0x70, 0x0c, ebcdic('SEG1', 4), 0x00, 0x00, uint(ORDERS.length, 2), new Uint8Array(4), ORDERS);
  return group('D3A8BB', 'GR000001',
    group('D3A8C7', 'OEG00001', field('D3A66B', obd), field('D3AC6B', obp), field('D3ABBB', bytes(uint(5, 2), triplet(0x04, 0x20)))),
    field('D3A6BB', gdd), field('D3EEBB', segment));
}

/**
 * Builds the file.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  return documentOf('GOCADOC1', page('PAGE0001', graphics()));
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us1-graphics.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us1-graphics.afp', import.meta.url), buildBytes());
}
