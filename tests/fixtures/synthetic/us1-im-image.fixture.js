/**
 * Synthetic fixture (task T043): IM image objects (bilevel raster, IM Image structured fields).
 *
 * - Page 1: an IM image of 64 × 48 pels at 240 dpi as one raster (IID without cells), placed by
 *   the IM Image Output Control offset (120, 60) in the image's units.
 * - Page 2: an Include Page Segment of S1NEOIMG, which holds an IM image of 96 × 64 pels at 300
 *   dpi made of 3 cells (IM Image Cell Position): a 32 × 32 cell at (0, 0), a 32 × 16 cell at
 *   (64, 0) and an 8 × 8 cell at (0, 40) whose pattern is repeated over a 96 × 24 fill area.
 *
 * Field layouts (MO:DCA Reference AFPC-0004-11, appendix "IM Image Object"): IOC X/Y offset
 * (3 + 3), X/Y orientation (2 + 2), ConData1 (8 × X'00'), X/Y mapping (2 + 2), ConData2 X'FFFF';
 * IID ConData1 X'000009600960000000000000', X/Y unit base (1 + 1), X/Y units per base (2 + 2), X/Y
 * size (2 + 2), ConData2 X'000000002D00', default cell size (2 + 2), ConData3 X'0001', color
 * X'FFFF' (presentation process default); ICP cell offset (2 + 2), cell size (2 + 2), fill size
 * (2 + 2); IRD rows padded to whole bytes, 1 = black.
 * The expected pixel checksums were checked against an independent composition of the same
 * bitmaps in the generator script before they were recorded.
 *
 * Running this module directly writes us1-im-image.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, uint, ebcdic, documentOf, page, group, resourceGroup, resource, ID } from '../../helpers/afp-builder.js';

/**
 * Builds a bitmap (rows padded to bytes) from a pixel function.
 * @param {number} w Width.
 * @param {number} h Height.
 * @param {(x: number, y: number) => boolean} black Pixel function.
 * @returns {Uint8Array} Bits.
 */
export function bitmap(w, h, black) {
  const rowBytes = Math.ceil(w / 8);
  const out = new Uint8Array(rowBytes * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (black(x, y)) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  return out;
}

/** Bitmaps of the fixture (exported for the generator's independent check). */
export const PATTERNS = {
  single: [64, 48, (x, y) => x === 0 || y === 0 || x === 63 || y === 47 || x === y || ((x >> 3) + (y >> 3)) % 2 === 0 && x > 40],
  cell1: [32, 32, (x, y) => (x + y) % 4 === 0],
  cell2: [32, 16, (x, y) => y < 2 || x % 8 < 2],
  cell3: [8, 8, (x, y) => x === y || x === 7 - y],
};

/**
 * Builds an IM image object.
 * @param {string} name Object name.
 * @param {number} dpi Resolution.
 * @param {number} w Width in pels.
 * @param {number} h Height in pels.
 * @param {[number, number]} offset IOC offset in pels.
 * @param {Uint8Array[]} parts ICP and IRD fields in order.
 * @returns {Uint8Array} Begin IM Image … End IM Image.
 */
function imImage(name, dpi, w, h, offset, parts) {
  const ioc = bytes(uint(offset[0], 3), uint(offset[1], 3), uint(0x0000, 2), uint(0x2d00, 2), new Uint8Array(8),
    uint(0x03e8, 2), uint(0x03e8, 2), uint(0xffff, 2));
  const iid = bytes(0x00, 0x00, 0x09, 0x60, 0x09, 0x60, new Uint8Array(6), 0x00, 0x00, uint(dpi * 10, 2), uint(dpi * 10, 2),
    uint(w, 2), uint(h, 2), 0x00, 0x00, 0x00, 0x00, 0x2d, 0x00, uint(0, 2), uint(0, 2), uint(0x0001, 2), uint(0xffff, 2));
  return group('D3A87B', name, field('D3A77B', ioc), field('D3A67B', iid), ...parts);
}

const ird = (data) => field('D3EE7B', data);
const icp = (x, y, cw, ch, fw, fh) => field('D3AC7B', bytes(uint(x, 2), uint(y, 2), uint(cw, 2), uint(ch, 2), uint(fw, 2), uint(fh, 2)));
const bits = (key) => bitmap(...PATTERNS[key]);

/**
 * Builds the file.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  const single = imImage('IM000001', 240, 64, 48, [120, 60], [ird(bits('single'))]);
  const celled = imImage('IM000002', 300, 96, 64, [0, 0], [
    icp(0, 0, 32, 32, 32, 32), ird(bits('cell1')),
    icp(64, 0, 32, 16, 32, 16), ird(bits('cell2')),
    icp(0, 40, 8, 8, 96, 24), ird(bits('cell3')),
  ]);
  const segment = resource('S1NEOIMG', 0xfb, group(ID.BPS, 'S1NEOIMG', celled));
  return bytes(resourceGroup(segment), documentOf('IMDOC001',
    page('PAGE0001', single),
    page('PAGE0002', field('D3AF5F', bytes(ebcdic('S1NEOIMG', 8), uint(1440, 3), uint(2880, 3))))));
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us1-im-image.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us1-im-image.afp', import.meta.url), buildBytes());
}
