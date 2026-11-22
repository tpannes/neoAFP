/**
 * IM image objects (FR-011, research R6a): bilevel raster images, used in many older documents,
 * mostly inside page segments.
 *
 * Fields (IM Image structured fields; layouts checked against sample page segments):
 * - IOC IM Image Output Control: X/Y offset (3 + 3, in the image's units from IID), X/Y
 *   orientation (2 + 2), 8 reserved,
 *   X/Y mapping (2 + 2), 2 reserved.
 * - IID IM Image Input Descriptor: 12 constant bytes, X/Y unit base (1 + 1), X/Y units per base
 *   (2 + 2, e.g. 3000 = 300 dpi), X/Y size in pels (2 + 2), 6 constant bytes, default cell X/Y
 *   size (2 + 2), 2 constant bytes, image color (2: a standard OCA named color for the 1 bits,
 *   X'FF07' = printer default, black). Charts built from several overlapping IM images, one per
 *   color, rely on it (e.g. a pie chart in blue, red, green and turquoise).
 * - ICP IM Image Cell Position: cell X/Y offset in pels (2 + 2), cell X/Y size (2 + 2), fill
 *   area X/Y size (2 + 2; the cell pattern is repeated to fill it).
 * - IRD IM Image Raster Data: rows of bits, each row padded to a whole byte; 1 = black.
 *   Some producers write the rows without padding (e.g. 2340 pels per row, rows one after the
 *   other); for widths that are not a multiple of 8 the layout is detected from
 *   the data (see rowStride).
 * Without ICP fields, the raster data covers the whole image.
 */

import { collectFields } from '../modca/access.js';
import { u, s, orientation, toPageUnits } from '../modca/bytes.js';
import { registerObjectRenderer } from '../render/page-renderer.js';
import { NAMED_COLORS } from '../ptoca/ptoca.js';

const BII = 0xd3a87b;
const IOC = 0xd3a77b;
const IID = 0xd3a67b;
const ICP = 0xd3ac7b;
const IRD = 0xd3ee7b;

/**
 * @typedef {object} Bilevel
 * @property {number} width Width in pels.
 * @property {number} height Height in pels.
 * @property {number} rowBytes Bytes per row.
 * @property {Uint8Array} bits Rows of bits, most significant bit = leftmost pel, 1 = black.
 */

/**
 * Finds the distance in bits from one row of a cell to the next: rows padded to whole bytes
 * (as specified) or rows without padding. Neighbouring rows of a picture are much alike, so the
 * layout under which they match better is the right one.
 * @param {Uint8Array} cell Cell bits.
 * @param {number} width Cell width in pels.
 * @param {number} height Cell height in rows.
 * @returns {number} Row stride in bits.
 */
export function rowStride(cell, width, height) {
  const padded = Math.ceil(width / 8) * 8;
  if (padded === width || height < 3) return padded;
  const bits = cell.length * 8;
  const bit = (i) => (cell[i >> 3] >> (7 - (i & 7))) & 1;
  const match = (stride) => {
    let same = 0;
    let inked = 0;
    // About 200,000 samples spread over the cell.
    const step = Math.max(1, Math.floor(Math.min(bits, stride * height) / 200000));
    for (let i = 0; i + stride < Math.min(bits, stride * height); i += step) {
      const a = bit(i);
      const b = bit(i + stride);
      if (a || b) {
        inked++;
        if (a === b) same++;
      }
    }
    return inked ? same / inked : 0;
  };
  // Packed rows only when they match clearly better (padded rows are the specified layout).
  return match(width) > 1.3 * match(padded) + 0.02 ? width : padded;
}

/**
 * Copies a cell bitmap into the image, repeating it over the fill area.
 * @param {Bilevel} image Target image.
 * @param {Uint8Array} cell Cell bits.
 * @param {{x: number, y: number, cw: number, ch: number, fw: number, fh: number}} c Cell placement.
 * @param {number} stride Bits from one cell row to the next.
 * @returns {void}
 */
function placeCell(image, cell, c, stride) {
  for (let y = 0; y < c.fh; y++) {
    const ty = c.y + y;
    if (ty < 0 || ty >= image.height) continue;
    const sy = y % c.ch;
    for (let x = 0; x < c.fw; x++) {
      const tx = c.x + x;
      if (tx < 0 || tx >= image.width) continue;
      const at = sy * stride + (x % c.cw);
      if ((cell[at >> 3] >> (7 - (at & 7))) & 1) {
        image.bits[ty * image.rowBytes + (tx >> 3)] |= 0x80 >> (tx & 7);
      }
    }
  }
}

/**
 * Reads an IM image object.
 * @param {object} file File record.
 * @param {number} row Row of Begin IM Image.
 * @returns {Promise<{image: Bilevel, resolutionX: number, resolutionY: number, offsetX: number,
 *   offsetY: number, rotation: number, color: string, problems: string[]}>} Decoded image,
 *   placement (offsets in the including page's units) and the color of its 1 bits (#rrggbb).
 */
export async function readImImage(file, row) {
  const fields = await collectFields(file, row, new Set([IOC, IID, ICP, IRD]));
  const out = { resolutionX: 240, resolutionY: 240, offsetX: 0, offsetY: 0, rotation: 0, color: '#000000', problems: [] };
  let width = 0;
  let height = 0;
  let cellW = 0;
  let cellH = 0;
  for (const { id, data } of fields) {
    if (id === IOC) {
      out.offsetX = s(data, 0, 3);
      out.offsetY = s(data, 3, 3);
      out.rotation = orientation(u(data, 6, 2));
    } else if (id === IID) {
      const unitX = toPageUnits(data[12], u(data, 14, 2));
      const unitY = toPageUnits(data[13], u(data, 16, 2));
      out.resolutionX = 1440 / unitX;
      out.resolutionY = 1440 / unitY;
      width = u(data, 18, 2);
      height = u(data, 20, 2);
      cellW = u(data, 28, 2);
      cellH = u(data, 30, 2);
      if (data.length >= 36) out.color = NAMED_COLORS[u(data, 34, 2)] ?? '#000000';
    }
  }
  const image = { width, height, rowBytes: Math.ceil(width / 8), bits: new Uint8Array(Math.ceil(width / 8) * height) };
  const cells = [];
  let current = null;
  for (const { id, data } of fields) {
    if (id === ICP) {
      current = { x: u(data, 0, 2), y: u(data, 2, 2), cw: u(data, 4, 2), ch: u(data, 6, 2), fw: u(data, 8, 2), fh: u(data, 10, 2), parts: [] };
      cells.push(current);
    } else if (id === IRD) {
      if (!current) {
        current = { x: 0, y: 0, cw: width, ch: height, fw: width, fh: height, parts: [] };
        cells.push(current);
      }
      current.parts.push(data);
    }
  }
  for (const c of cells) {
    const total = c.parts.reduce((n, p) => n + p.length, 0);
    const cell = new Uint8Array(total);
    let pos = 0;
    for (const p of c.parts) {
      cell.set(p, pos);
      pos += p.length;
    }
    if (!c.cw || !c.ch) {
      c.cw = c.cw || cellW || width;
      c.ch = c.ch || cellH || height;
    }
    c.fw ||= c.cw;
    c.fh ||= c.ch;
    const stride = rowStride(cell, c.cw, c.ch);
    if (cell.length * 8 < stride * (c.ch - 1) + c.cw) out.problems.push('raster data shorter than the cell');
    placeCell(image, cell, c, stride);
  }
  out.image = image;
  return out;
}

/**
 * Renders an IM image object as an image item.
 * @param {object} r Render context.
 * @param {object} file File record.
 * @param {number} row Row of Begin IM Image.
 * @param {object} env Environment of the including page.
 * @param {{x: number, y: number}} origin Origin in page units.
 * @returns {Promise<object[]>} One image item (or a placeholder).
 */
async function renderImImage(r, file, row, env, origin) {
  const im = await readImImage(file, row);
  for (const problem of im.problems) {
    r.report({ severity: 'warning', code: 'decodeFailed', fileId: file.id, offset: file.index.offset[row], params: { file: file.path, reason: `IM image: ${problem}` } });
  }
  const width = im.image.width * 1440 / im.resolutionX;
  const height = im.image.height * 1440 / im.resolutionY;
  return [{
    type: 'image',
    // IOC offsets are in the image's own units (resolution from IID), verified against a sample
    // document and its PDF rendering (barcode positions match).
    rect: { x: origin.x + im.offsetX * 1440 / im.resolutionX, y: origin.y + im.offsetY * 1440 / im.resolutionY, width, height },
    rotation: im.rotation,
    imageRef: `${file.id}:${row}`,
    colorSpace: 'bilevel',
    color: im.color,
    sourceField: row,
    fileId: file.id,
  }];
}

registerObjectRenderer(BII, renderImImage);

/**
 * Returns the pixels of an IM image for the viewer.
 * @param {object} file File record.
 * @param {number} row Row of Begin IM Image.
 * @returns {Promise<{width: number, height: number, bilevel: Bilevel, color: [number, number, number]}>}
 *   Bilevel pixels and the color of the 1 bits (the 0 bits are transparent).
 */
export async function imImagePixels(file, row) {
  const { image, color } = await readImImage(file, row);
  const rgb = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
  return { width: image.width, height: image.height, bilevel: image, color: rgb };
}

export { BII as BEGIN_IM_IMAGE };
