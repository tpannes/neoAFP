/**
 * IOCA image objects (FR-011, task T067): reads the image segment in the Image Picture Data
 * fields, decompresses it and places the image on the page.
 *
 * The image segment is a sequence of self-defining fields: a 1-byte code and 1-byte length, or
 * X'FE' + code with a 2-byte length (IOCA Reference, "Image Segment"). Codes used here (layouts
 * checked against sample files): X'70'/X'71' begin/end segment, X'91'/X'93' begin/end image
 * content, X'94' image size (unit base, resolution X/Y, size X/Y), X'95' image encoding
 * (compression, recording, bit order), X'96' IDE size (bits per pel), X'98' band image (number
 * of bands, bits per band), X'9B' IDE structure (flags, format: 1 RGB, 2 YCrCb, 4 CMYK,
 * X'12' YCbCr), X'8C'/X'8D' begin/end tile, X'B5' tile position, X'B6' tile size,
 * X'8E'/X'8F' begin/end transparency mask, X'FE92' image data, X'FE9C' band image data (band
 * number, 2 reserved bytes, data), X'FEBB' tile table of contents.
 *
 * Compressions: X'03' none, X'01' IBM MMR, X'06' RL4, X'82' G4 MMR, X'80' G3 MH, X'81' G3 MR,
 * X'09' TIFF algorithm 2, X'84' JBIG2 (single-part images, drawn by pdf.js), X'0D' TIFF LZW, X'0E' TIFF LZW with Differencing Predictor (8-bit samples),
 * X'0C' TIFF PackBits, X'83' JPEG (decoded by the browser). Others (ABIC X'08' and
 * X'0A', OS/2 Image Support X'0B', …) are reported as not supported (research R6).
 */

import { specTable, shortNames } from '../spec-table.js';
import { collectFields, concat } from '../modca/access.js';
import { u, toPageUnits } from '../modca/bytes.js';
import { decodeCcitt } from './decoders/ccitt.js';
import { decodeLzw } from './decoders/lzw.js';
import { decodePackBits } from './decoders/packbits.js';
import { decodeRl4 } from './decoders/rl4.js';
import { toRgba } from './color.js';
import { registerObjectRenderer, readObjectArea } from '../render/page-renderer.js';
import { jbig2Embedded, jbig2PageSize } from '../objcontainer/image-pdf.js';
import { iocaPixelSpace } from '../resources/color-model.js';

const BIM = 0xd3a8fb;
const IDD = 0xd3a6fb;
const IPD = 0xd3eefb;

/** Compression IDs (Image Encoding parameter X'95', COMPRID). */
export const COMPRESSION_TABLE = specTable('IOCA Reference (AFPC-0003-09)', 'Image Encoding Parameter, COMPRID', [
  [0x01, 'IBM MMR', 'IBM MMR-Modified Modified Read'], [0x03, 'none', 'No compression'], [0x06, 'RL4', 'RL4 (Run Length 4)'],
  [0x08, 'ABIC', 'ABIC (Bilevel Q-Coder)'], [0x09, 'TIFF algorithm 2', 'TIFF algorithm 2'],
  [0x0a, 'concatenated ABIC', 'Concatenated ABIC'], [0x0b, 'OS/2 Image Support', 'Color compression used by OS/2 Image Support'],
  [0x0c, 'TIFF PackBits', 'TIFF PackBits'], [0x0d, 'TIFF LZW', 'TIFF LZW'],
  [0x0e, 'TIFF LZW with predictor', 'TIFF LZW with Differencing Predictor'], [0x20, 'solid fill', 'Solid Fill Rectangle'],
  [0x80, 'G3 MH', 'G3 MH-Modified Huffman'], [0x81, 'G3 MR', 'G3 MH-Modified READ'], [0x82, 'G4 MMR', 'G4 MMR-Modified Modified READ'],
  [0x83, 'JPEG', 'JPEG algorithms'], [0x84, 'JBIG2', 'JBIG2'],
]);
/** Compression code → name. */
export const COMPRESSIONS = shortNames(COMPRESSION_TABLE);

/** Self-defining fields of the image segment read here (IOCA "Image Segment"). */
export const SELF_DEFINING_FIELD_TABLE = specTable('IOCA Reference (AFPC-0003-09)', 'Image Segment, self-defining fields', [
  [0x70, '', 'Begin Segment'], [0x71, '', 'End Segment'], [0x8c, '', 'Begin Tile'], [0x8d, '', 'End Tile'],
  [0x8e, '', 'Begin Transparency Mask'], [0x8f, '', 'End Transparency Mask'], [0x91, '', 'Begin Image Content'],
  [0x93, '', 'End Image Content'], [0x94, '', 'Image Size'], [0x95, '', 'Image Encoding'], [0x96, '', 'IDE Size'],
  [0x98, '', 'Band Image'], [0x9b, '', 'IDE Structure'], [0xb5, '', 'Tile Position'], [0xb6, '', 'Tile Size'],
  [0xfe92, '', 'Image Data'], [0xfe9c, '', 'Band Image Data'],
]);

/** IDE structure formats → color space. */
const FORMATS = { 0x01: 'rgb', 0x02: 'ycrcb', 0x04: 'cmyk', 0x08: 'lab', 0x12: 'ycbcr' };

/**
 * Splits image segment data into self-defining fields.
 * @param {Uint8Array} d Image segment bytes.
 * @returns {{code: number, body: Uint8Array}[]} Fields; long codes are X'FE00' + second byte.
 */
export function selfDefiningFields(d) {
  const out = [];
  let pos = 0;
  while (pos + 2 <= d.length) {
    if (d[pos] === 0xfe) {
      const len = u(d, pos + 2, 2);
      out.push({ code: 0xfe00 | d[pos + 1], body: d.subarray(pos + 4, pos + 4 + len) });
      pos += 4 + len;
    } else {
      const len = d[pos + 1];
      out.push({ code: d[pos], body: d.subarray(pos + 2, pos + 2 + len) });
      pos += 2 + len;
    }
  }
  return out;
}

/**
 * @typedef {object} IocaPart
 * @property {number} x Position in pels.
 * @property {number} y Position in pels.
 * @property {number} width Width in pels.
 * @property {number} height Height in pels.
 * @property {number} compression Compression code.
 * @property {number} bitOrder 0 = most significant bit first.
 * @property {number} ideSize Bits per pel.
 * @property {number[]|null} bands Bits per band (band images), or null.
 * @property {string|null} space Color space for color images.
 * @property {Uint8Array} data Image data (non-band).
 * @property {Map<number, Uint8Array[]>} bandData Band number → data parts.
 * @property {IocaPart|null} mask Transparency mask (bilevel).
 */

/**
 * Reads an IOCA image segment into its parts (one for simple images, one per tile otherwise).
 * @param {Uint8Array} segment Concatenated Image Picture Data.
 * @returns {{width: number, height: number, xRes: number, yRes: number, parts: IocaPart[]}}
 *   Image size, resolution in dpi, and parts.
 */
export function parseIoca(segment) {
  const image = { width: 0, height: 0, xRes: 0, yRes: 0, parts: [] };
  const defaults = { compression: 0x03, bitOrder: 0, ideSize: 1, bands: null, space: null };
  const newPart = (base) => ({ x: 0, y: 0, width: image.width, height: image.height, ...base, data: [], bandData: new Map(), mask: null });
  let current = null;
  let mask = null;
  let state = { ...defaults };
  for (const { code, body } of selfDefiningFields(segment)) {
    const target = mask ?? current;
    switch (code) {
      case 0x94: {
        const size = { base: body[0], xRes: u(body, 1, 2), yRes: u(body, 3, 2), width: u(body, 5, 2), height: u(body, 7, 2) };
        if (mask) Object.assign(mask, { width: size.width, height: size.height });
        else {
          image.width = size.width;
          image.height = size.height;
          image.xRes = size.base === 0 ? size.xRes / 10 : size.xRes / 10 * 2.54;
          image.yRes = size.base === 0 ? size.yRes / 10 : size.yRes / 10 * 2.54;
        }
        break;
      }
      case 0x95: {
        const enc = { compression: body[0], bitOrder: body[2] ?? 0 };
        if (target) Object.assign(target, enc);
        else Object.assign(state, enc);
        break;
      }
      case 0x96: if (target) target.ideSize = body[0]; else state.ideSize = body[0]; break;
      case 0x98: { const bands = [...body.subarray(1, 1 + body[0])]; if (target) target.bands = bands; else state.bands = bands; break; }
      case 0x9b: { const space = FORMATS[body[1]] ?? null; if (target) target.space = space; else state.space = space; break; }
      case 0x8c: current = newPart(state); break;
      case 0x8d: if (current) image.parts.push(current); current = null; break;
      case 0xb5: if (current) { current.x = u(body, 0, 4); current.y = u(body, 4, 4); } break;
      case 0xb6: if (current) { current.width = u(body, 0, 4); current.height = u(body, 4, 4); } break;
      case 0x8e: mask = { ...newPart({ compression: 0x03, bitOrder: 0, ideSize: 1, bands: null, space: null }) }; break;
      case 0x8f: if (current) current.mask = mask; else image.mask = mask; mask = null; break;
      case 0xfe92: {
        if (mask) mask.data.push(body);
        else {
          if (!current) current = newPart(state);
          current.data.push(body);
        }
        break;
      }
      case 0xfe9c: {
        if (!current) current = newPart(state);
        const band = body[0];
        if (!current.bandData.has(band)) current.bandData.set(band, []);
        current.bandData.get(band).push(body.subarray(3));
        break;
      }
      case 0x93: if (current && !image.parts.includes(current)) image.parts.push(current); current = null; break;
      default: break;
    }
  }
  if (current && !image.parts.includes(current)) image.parts.push(current);
  for (const p of image.parts) {
    p.data = concat(p.data);
    if (p.mask) p.mask.data = concat(p.mask.data);
    if (!p.width) p.width = image.width;
    if (!p.height) p.height = image.height;
  }
  if (image.mask) image.mask.data = concat(image.mask.data);
  return image;
}

/**
 * Undoes the TIFF horizontal differencing predictor (TIFF 6.0, section 14; IOCA X'0E'): in each
 * row, every 8-bit sample is stored as the difference to the same component of the pixel on its
 * left, modulo 256.
 * @param {Uint8Array} data Decompressed rows (changed in place).
 * @param {number} width Pixels per row.
 * @param {number} height Rows.
 * @param {number} samples Samples (bytes) per pixel.
 * @returns {Uint8Array} The same array.
 */
export function undoPredictor(data, width, height, samples) {
  const rowLength = width * samples;
  for (let y = 0; y < height; y++) {
    const row = y * rowLength;
    for (let i = samples; i < rowLength && row + i < data.length; i++) data[row + i] = (data[row + i] + data[row + i - samples]) & 0xff;
  }
  return data;
}

/**
 * Decompresses bilevel data.
 * @param {Uint8Array} data Compressed data.
 * @param {number} width Width.
 * @param {number} height Height.
 * @param {number} compression Compression code.
 * @returns {{bits: Uint8Array, rowBytes: number, error: string|null}} Bitmap (1 = black).
 */
function bilevel(data, width, height, compression) {
  const rowBytes = Math.ceil(width / 8);
  if (compression === 0x03) return { bits: data.subarray(0, rowBytes * height), rowBytes, error: data.length < rowBytes * height ? 'image data too short' : null };
  if (compression === 0x82 || compression === 0x80 || compression === 0x81 || compression === 0x01) {
    const scheme = { 0x82: 'G4', 0x80: 'G3-1D', 0x81: 'G3-2D', 0x01: 'IBM-MMR' }[compression];
    const r = decodeCcitt(data, width, height, scheme);
    return { bits: r.bits, rowBytes, error: r.error };
  }
  if (compression === 0x09) {
    // TIFF algorithm 2: G3 MH, each row starting on a byte boundary, without end-of-line codes.
    const r = decodeCcitt(data, width, height, 'G3-1D', { byteAlignRows: true });
    return { bits: r.bits, rowBytes, error: r.error };
  }
  if (compression === 0x06) return decodeRl4(data, width, height);
  if (compression === 0x0d) return { bits: decodeLzw(data, rowBytes * height), rowBytes, error: null };
  if (compression === 0x0c) return { bits: decodePackBits(data, rowBytes * height), rowBytes, error: null };
  if (compression === 0x0e) {
    // The predictor works on samples of 8 bits or more (TIFF 6.0, section 14), not on 1-bit images.
    return { bits: null, rowBytes, error: 'TIFF LZW with Differencing Predictor is not defined for bilevel images' };
  }
  return { bits: null, rowBytes, error: `compression ${COMPRESSIONS[compression] ?? `X'${compression.toString(16)}'`} not supported` };
}

/**
 * Decodes one image part into displayable pixels.
 * @param {IocaPart} p Part.
 * @param {{samples?: boolean}} [options] samples: also keep the decoded pixel values in their own
 *   color space (`samples`: {space, planes, interleaved}; for the color picker, not for drawing).
 * @returns {{x: number, y: number, width: number, height: number, bilevel?: object, rgba?: Uint8ClampedArray,
 *   encodedBytes?: Uint8Array, encodedPlanes?: Uint8Array[], space?: string, mimeType?: string,
 *   mask?: object, error: string|null}} Pixels (encodedPlanes: one encoded image per color band).
 */
export function decodePart(p, { samples = false } = {}) {
  const out = { x: p.x, y: p.y, width: p.width, height: p.height, error: null };
  if (p.mask) {
    const m = bilevel(p.mask.data, p.mask.width || p.width, p.mask.height || p.height, p.mask.compression);
    if (m.bits) out.mask = { width: p.mask.width || p.width, height: p.mask.height || p.height, rowBytes: m.rowBytes, bits: m.bits };
    if (m.error) out.error = `transparency mask: ${m.error}`;
  }
  if (p.compression === 0x83) {
    // Band images may hold one complete JPEG per band (e.g. CMYK as four grayscale JPEGs); the viewer decodes them one by one and combines the color planes.
    const bands = [...p.bandData.keys()].sort((a, b) => a - b).map((k) => concat(p.bandData.get(k)));
    if (bands.length > 1 && bands.every((b) => b[0] === 0xff && b[1] === 0xd8)) {
      out.encodedPlanes = bands;
      out.space = p.space ?? (bands.length === 4 ? 'cmyk' : 'rgb');
      out.mimeType = 'image/jpeg';
      return out;
    }
    const parts = p.bandData.size ? [...p.bandData.values()].flat() : [p.data];
    out.encodedBytes = concat(parts);
    out.mimeType = 'image/jpeg';
    return out;
  }
  if (p.ideSize === 1 && !p.bands) {
    const b = bilevel(p.data, p.width, p.height, p.compression);
    out.error = b.error ?? out.error;
    if (b.bits) out.bilevel = { rowBytes: b.rowBytes, bits: b.bits };
    return out;
  }
  const n = p.width * p.height;
  const decompress = (data, size, samples) => {
    if (p.compression === 0x03) return data;
    if (p.compression === 0x0d) return decodeLzw(data, size);
    if (p.compression === 0x0e) return undoPredictor(decodeLzw(data, size), p.width, p.height, samples);
    if (p.compression === 0x0c) return decodePackBits(data, size);
    return null;
  };
  const space = p.space ?? (p.ideSize === 8 ? 'gray' : p.ideSize === 32 ? 'cmyk' : 'rgb');
  let planes;
  let interleaved = false;
  if (p.bands) {
    planes = [...p.bandData.keys()].sort((a, b) => a - b).map((k) => decompress(concat(p.bandData.get(k)), n, 1));
  } else {
    planes = [decompress(p.data, n * Math.ceil(p.ideSize / 8), Math.ceil(p.ideSize / 8))];
    interleaved = true;
  }
  if (planes.some((pl) => !pl)) {
    out.error = `compression ${COMPRESSIONS[p.compression] ?? `X'${p.compression.toString(16)}'`} not supported for color images`;
    return out;
  }
  const own = p.bands && p.bands.length === 1 ? 'gray' : space;
  out.rgba = toRgba({ width: p.width, height: p.height, space: own, planes, interleaved });
  if (samples) out.samples = { space: own, planes, interleaved };
  return out;
}

/**
 * Reads and decodes an IOCA image object.
 * @param {object} file File record.
 * @param {number} row Row of Begin Image Object.
 * @param {{samples?: boolean}} [options] samples: keep the pixel values of color parts (decodePart).
 * @returns {Promise<{width: number, height: number, xRes: number, yRes: number, parts: object[],
 *   errors: string[]}>} Decoded image.
 */
export async function readIocaImage(file, row, options = {}) {
  const fields = await collectFields(file, row, new Set([IDD, IPD]));
  const idd = fields.find((f) => f.id === IDD)?.data;
  const image = parseIoca(concat(fields.filter((f) => f.id === IPD).map((f) => f.data)));
  if (idd && (!image.xRes || !image.width)) {
    const k = toPageUnits(idd[0], u(idd, 1, 2));
    image.xRes ||= 1440 / k;
    image.yRes ||= 1440 / toPageUnits(idd[0], u(idd, 3, 2));
    image.width ||= u(idd, 5, 2);
    image.height ||= u(idd, 7, 2);
  }
  image.xRes ||= 240;
  image.yRes ||= 240;
  const parts = image.parts.map((p) => decodePart(p, options));
  return { width: image.width, height: image.height, xRes: image.xRes, yRes: image.yRes, parts, errors: [...new Set(parts.map((p) => p.error).filter(Boolean))] };
}

/**
 * Reads the JBIG2 data of an IOCA image (compression X'84', T311) as an embedded stream with its
 * size: an image of one part only (tiled JBIG2 images are not supported), size from the image or,
 * when IOCA gives none, from the JBIG2 page information.
 * @param {object} file File record.
 * @param {number} row Row of Begin Image Object.
 * @returns {Promise<{data: Uint8Array, width: number, height: number}|{error: string}>} Data, or
 *   why it cannot be shown.
 */
export async function readJbig2Image(file, row) {
  const fields = await collectFields(file, row, new Set([IDD, IPD]));
  const image = parseIoca(concat(fields.filter((f) => f.id === IPD).map((f) => f.data)));
  if (image.parts.length !== 1 || image.parts[0].compression !== 0x84) return { error: 'IOCA compression JBIG2 in tiled images not supported' };
  const part = image.parts[0];
  const data = jbig2Embedded(part.data);
  if (!data) return { error: 'JBIG2 file in random-access organization not supported' };
  const page = part.width && part.height ? null : jbig2PageSize(data);
  const width = part.width || page?.width || 0;
  const height = part.height || page?.height || 0;
  if (!width || !height) return { error: 'JBIG2 image without a size' };
  return { data, width, height };
}

/**
 * Mapping options of the object area (MO:DCA Reference AFPC-0004-11, Mapping Option triplet
 * X'04': X'00' position, X'10' position and trim, X'20' scale to fit, X'30' center and trim,
 * X'60' scale to fill; X'41', X'42', X'50' are migration mappings, presented here as position).
 */
const MAPPING = { position: 0x00, positionAndTrim: 0x10, scaleToFit: 0x20, centerAndTrim: 0x30, scaleToFill: 0x60 };

/**
 * Computes where an image is drawn inside its object area.
 * @param {{x: number, y: number, width: number|null, height: number|null, contentX: number,
 *   contentY: number, mappingOption: number|null}} area Object area (page units).
 * @param {number} w Image width in page units.
 * @param {number} h Image height in page units.
 * @returns {{rect: object, clip: object|null}} Destination rectangle and clip rectangle.
 */
export function placeInArea(area, w, h) {
  const aw = area.width ?? w;
  const ah = area.height ?? h;
  const clipRect = { x: area.x, y: area.y, width: aw, height: ah };
  // No Map Image Object: the architected default is scale to fit (MO:DCA, MIO semantics).
  switch (area.mappingOption ?? MAPPING.scaleToFit) {
    case MAPPING.scaleToFit: {
      const s = Math.min(aw / w, ah / h);
      return { rect: { x: area.x + (aw - w * s) / 2, y: area.y + (ah - h * s) / 2, width: w * s, height: h * s }, clip: null };
    }
    case MAPPING.scaleToFill:
      return { rect: { x: area.x, y: area.y, width: aw, height: ah }, clip: null };
    case MAPPING.centerAndTrim:
      return { rect: { x: area.x + (aw - w) / 2, y: area.y + (ah - h) / 2, width: w, height: h }, clip: clipRect };
    case MAPPING.positionAndTrim:
      return { rect: { x: area.x + area.contentX, y: area.y + area.contentY, width: w, height: h }, clip: clipRect };
    default:
      return { rect: { x: area.x + area.contentX, y: area.y + area.contentY, width: w, height: h }, clip: null };
  }
}

/**
 * Renders an IOCA image object as an image item.
 * @param {object} r Render context.
 * @param {object} file File record.
 * @param {number} row Row of Begin Image Object.
 * @param {object} env Environment of the including page.
 * @param {{x: number, y: number}} origin Origin in page units.
 * @param {object|null} [areaOverride] Object area from an Include Object field.
 * @returns {Promise<object[]>} Image item, or placeholder if the image cannot be decoded.
 */
async function renderIoca(r, file, row, env, origin, areaOverride = null) {
  const fields = await collectFields(file, row, new Set([IDD, IPD]));
  const image = parseIoca(concat(fields.filter((f) => f.id === IPD).map((f) => f.data)));
  const idd = fields.find((f) => f.id === IDD)?.data;
  const xRes = image.xRes || (idd ? 1440 / toPageUnits(idd[0], u(idd, 1, 2)) : 240);
  const yRes = image.yRes || (idd ? 1440 / toPageUnits(idd[0], u(idd, 3, 2)) : 240);
  const width = image.width || (idd ? u(idd, 5, 2) : 0);
  const height = image.height || (idd ? u(idd, 7, 2) : 0);
  const area = (await readObjectArea(file, row, env, areaOverride)) ?? { x: 0, y: 0, width: null, height: null, contentX: 0, contentY: 0, rotation: 0, mappingOption: null };
  const unsupported = [...new Set(image.parts.map((p) => p.compression))]
    .filter((c) => ![0x03, 0x01, 0x06, 0x82, 0x80, 0x81, 0x09, 0x0d, 0x0e, 0x0c, 0x83, 0x84].includes(c));
  const place = placeInArea({ ...area, x: origin.x + area.x, y: origin.y + area.y }, width * 1440 / xRes, height * 1440 / yRes);
  if (!unsupported.length && image.parts.some((p) => p.compression === 0x84)) {
    // JBIG2 (T311): drawn by pdf.js from a one-page PDF with the image as a mask, so its 0 pels
    // stay transparent (workspace getEmbeddedObjectBytes builds it).
    const jbig2 = await readJbig2Image(file, row);
    if (jbig2.error) unsupported.push(jbig2.error);
    else {
      return [{ type: 'pdf', rect: place.rect, clip: place.clip, rotation: area.rotation ?? 0, pageNumber: 1, transparent: true,
        objectRef: `${file.id}:${row}`, sourceField: row, fileId: file.id }];
    }
  }
  if (unsupported.length) {
    const reason = typeof unsupported[0] === 'string' ? unsupported[0]
      : `IOCA compression ${unsupported.map((c) => COMPRESSIONS[c] ?? `X'${c.toString(16)}'`).join(', ')} not supported`;
    r.report({ severity: 'warning', code: 'unsupportedObject', fileId: file.id, offset: file.index.offset[row], params: { file: file.path, reason } });
    return [{ type: 'placeholder', rect: place.rect, reason, sourceField: row, fileId: file.id }];
  }
  return [{ type: 'image', rect: place.rect, clip: place.clip, rotation: area.rotation, imageRef: `${file.id}:${row}`,
    colorSpace: image.parts[0]?.space ?? (image.parts[0]?.ideSize === 1 ? 'bilevel' : 'color'), pixelSpace: iocaPixelSpace(image.parts[0]),
    sourceField: row, fileId: file.id }];
}

registerObjectRenderer(BIM, renderIoca);

export { BIM as BEGIN_IMAGE_OBJECT };
