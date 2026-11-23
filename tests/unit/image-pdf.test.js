/**
 * JPEG 2000 in object containers and JBIG2 in IOCA images, drawn by pdf.js from a one-page image
 * PDF (task T311; IOCA Reference AFPC-0003-09 compression X'84', ITU-T T.88; ISO/IEC 15444-1):
 * the PDF, the size readers, decoding with the vendored pdf.js, and the way through a file to a
 * `pdf` render item whose bytes come from getEmbeddedObjectBytes.
 *
 * Samples made here: J2K is the codestream of a 24 × 16 RGB image (left third red, middle green,
 * right blue) written by the macOS image tools, its comment marker removed; the JP2 file wraps it
 * in signature, ftyp, jp2h (ihdr, colr sRGB, res/resd 300 dpi) and jp2c boxes. JBIG2 is a page
 * information segment (32 × 8), an immediate generic region coded with MMR (T.6) — rows 2–5
 * black from x 8 to 23 — and an end-of-page segment.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imagePdf, isJpeg2000, jpeg2000Header, jbig2Embedded, jbig2PageSize } from '../../src/lib/objcontainer/image-pdf.js';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { bytes, field, uint, ebcdic, triplet, documentOf, page, group, ID } from '../helpers/afp-builder.js';

const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const J2K = b64(
  '/0//UQAvAAAAAAAYAAAAEAAAAAAAAAAAAAAAGAAAABAAAAAAAAAAAAADBwEBBwEBBwEB/1IADAAAAAEBBQQEAAD/XAAjInce' +
  'dup26na8bwBvAG7iZ0xnTGdkUANQA1BFV9JX0ldh/5AACgAAAAAA3QAB/5PH3gQHLMH3gQAJocPpBARNwPgBCMPvAgHwx94E' +
  'Ca7B8YEAA8PjAgAFw+AEBsH2A4AMvfHpropuw+8IAA3mEdO2oWhJw+8HAAFZOTf1jljD6RgAIhmq7e/DgUbzd7gsx9ggACFt' +
  'qO4VTpwvrgRLdUMJdZ3PvEgX2BW5p+nAprpm3CS2TEGCnZTB8xEANp64JVVEUrwZl3gCVKIC5wnH2CAANfLE81DLIniVwG1P' +
  'GsFT8sfYNgAiGscpAtu5e2cLJPpjP8PlIZP6L+9ZnpTGBe7/2Q==');

const box = (type, ...content) => { const body = bytes(...content); return bytes(uint(body.length + 8, 4), ...[...type].map((c) => c.charCodeAt(0)), body); };
// resd: 11811 pixels per metre = 300 dpi (VR_N, VR_D, HR_N, HR_D, VR_E, HR_E).
const JP2 = bytes(uint(12, 4), 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
  box('ftyp', ...[...'jp2 '].map((c) => c.charCodeAt(0)), uint(0, 4), ...[...'jp2 '].map((c) => c.charCodeAt(0))),
  box('jp2h', box('ihdr', uint(16, 4), uint(24, 4), uint(3, 2), 7, 7, 0, 0), box('colr', 1, 0, 0, uint(16, 4)),
    box('res ', box('resd', uint(11811, 2), uint(1, 2), uint(11811, 2), uint(1, 2), 0, 0))),
  box('jp2c', J2K));

const u32 = (v) => [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const segment = (number, type, data) => bytes(...u32(number), type, 0x00, 0x01, ...u32(data.length), ...data);
const MMR = Uint8Array.from([0xcc, 0xc1, 0x7f, 0xfc, 0x70, 0x01, 0x00, 0x10]);
const JBIG2 = bytes(
  segment(0, 48, [...u32(32), ...u32(8), ...u32(0), ...u32(0), 0, 0, 0]),
  segment(1, 38, [...u32(32), ...u32(8), ...u32(0), ...u32(0), 0, 1, ...MMR]),
  segment(2, 49, []));

/**
 * Opens a PDF with the vendored pdf.js in Node and returns the image of its page.
 * @param {Uint8Array} pdf PDF bytes.
 * @returns {Promise<{op: string, image: object}>} Operator that paints the image, and the image.
 */
async function pdfImage(pdf) {
  globalThis.DOMMatrix ??= class { constructor(m) { [this.a, this.b, this.c, this.d, this.e, this.f] = m ?? [1, 0, 0, 1, 0, 0]; } };
  globalThis.Path2D ??= class {};
  globalThis.ImageData ??= class {};
  const pdfjs = await import('../../vendor/pdfjs/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: pdf, isEvalSupported: false, wasmUrl: new URL('../../vendor/pdfjs/wasm/', import.meta.url).pathname }).promise;
  const p = await doc.getPage(1);
  const ops = await p.getOperatorList();
  for (const [op, code] of [['mask', pdfjs.OPS.paintImageMaskXObject], ['image', pdfjs.OPS.paintImageXObject]]) {
    const i = ops.fnArray.indexOf(code);
    if (i < 0) continue;
    const arg = ops.argsArray[i][0];
    const image = typeof arg === 'string' ? await new Promise((resolve) => p.objs.get(arg, resolve))
      : typeof arg.data === 'string' ? await new Promise((resolve) => p.objs.get(arg.data, resolve)) : arg;
    await doc.destroy();
    return { op, image };
  }
  await doc.destroy();
  return { op: null, image: null };
}

test('image PDF: one page with the image, cross-reference offsets point to the objects', () => {
  const pdf = imagePdf({ data: J2K, width: 24, height: 16, filter: 'JPXDecode' });
  const text = new TextDecoder('latin1').decode(pdf);
  assert.ok(text.startsWith('%PDF-1.7'));
  const xref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(xref, xref + 4), 'xref');
  const offsets = [...text.matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
  assert.deepEqual(offsets.map((o, i) => text.slice(o, o + 7)), [1, 2, 3, 4, 5].map((n) => `${n} 0 obj`));
  assert.match(text, /\/MediaBox \[0 0 24 16\]/);
  assert.match(imagePdf({ data: JBIG2, width: 32, height: 8, filter: 'JBIG2Decode', imageMask: true }).reduce((s, b) => s + String.fromCharCode(b), ''), /\/ImageMask true \/BitsPerComponent 1 \/Filter \/JBIG2Decode/);
});

test('JPEG 2000: signature of a JP2 file and a codestream; size and resolution', () => {
  assert.ok(isJpeg2000(JP2) && isJpeg2000(J2K));
  assert.ok(!isJpeg2000(MMR));
  assert.deepEqual(jpeg2000Header(J2K), { width: 24, height: 16, xRes: 96, yRes: 96 });
  const h = jpeg2000Header(JP2);
  assert.deepEqual([h.width, h.height, Math.round(h.xRes), Math.round(h.yRes)], [24, 16, 300, 300]);
});

test('JBIG2: page size from the page information; a file header is removed or refused', () => {
  assert.deepEqual(jbig2PageSize(JBIG2), { width: 32, height: 8 });
  const id = [0x97, 0x4a, 0x42, 0x32, 0x0d, 0x0a, 0x1a, 0x0a];
  assert.deepEqual(jbig2Embedded(bytes(...id, 0x01, ...u32(1), JBIG2)), JBIG2, 'sequential, page count given');
  assert.deepEqual(jbig2Embedded(bytes(...id, 0x03, JBIG2)), JBIG2, 'sequential, page count unknown');
  assert.equal(jbig2Embedded(bytes(...id, 0x00, ...u32(1), JBIG2)), null, 'random-access organization');
  assert.equal(jbig2Embedded(JBIG2), JBIG2, 'embedded stream unchanged');
});

test('pdf.js decodes the JPEG 2000 image', async () => {
  const { op, image } = await pdfImage(imagePdf({ data: J2K, width: 24, height: 16, filter: 'JPXDecode' }));
  assert.equal(op, 'image');
  assert.deepEqual([image.width, image.height], [24, 16]);
  const px = (x, y) => [...image.data.subarray((y * 24 + x) * 4, (y * 24 + x) * 4 + 3)];
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 12);
  assert.ok(near(px(2, 8), [220, 40, 50]), `red: ${px(2, 8)}`);
  assert.ok(near(px(12, 8), [30, 160, 50]), `green: ${px(12, 8)}`);
  assert.ok(near(px(21, 8), [30, 40, 200]), `blue: ${px(21, 8)}`);
});

test('pdf.js decodes the JBIG2 image as a mask: the black pels are painted', async () => {
  const { op, image } = await pdfImage(imagePdf({ data: JBIG2, width: 32, height: 8, filter: 'JBIG2Decode', imageMask: true }));
  assert.equal(op, 'mask');
  const rows = Array.from({ length: 8 }, (_, y) => [...image.data.subarray(y * 4, y * 4 + 4)].map((b) => b.toString(2).padStart(8, '0')).join(''));
  const bar = `${'1'.repeat(8)}${'0'.repeat(16)}${'1'.repeat(8)}`;
  assert.deepEqual(rows, ['1'.repeat(32), '1'.repeat(32), bar, bar, bar, bar, '1'.repeat(32), '1'.repeat(32)]);
});

/**
 * Builds the object environment group of an object at 1440/1440 with the given area.
 * @param {number} w Width in 1/1440 inch.
 * @param {number} h Height in 1/1440 inch.
 * @returns {Uint8Array} Begin … End Object Environment Group.
 */
function oeg(w, h) {
  const obd = bytes(triplet(0x43, 0x01), triplet(0x4b, 0x00, 0x00, uint(14400, 2), uint(14400, 2)), triplet(0x4c, 0x02, uint(w, 3), uint(h, 3)));
  const obp = bytes(0x01, 23, uint(1440, 3), uint(1440, 3), uint(0, 2), uint(0x2d00, 2), 0x00, uint(0, 3), uint(0, 3), uint(0, 2), uint(0x2d00, 2), 0x01);
  return group('D3A8C7', 'OEG00001', field('D3A66B', obd), field('D3AC6B', obp));
}

test('a JPEG 2000 object container becomes a pdf item; its bytes are an image PDF', async () => {
  const name = ebcdic('OC000001', 8);
  const container = bytes(field(ID.BOC, name), oeg(1440, 960), field('D3A692', new Uint8Array(12)), field(ID.OCD, JP2), field(ID.EOC, name));
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(documentOf('JP2DOC01', page('PAGE0001', container)), 'jp2.afp')], 'file');
  const item = (await ws.getRenderModel(file.id, 1)).items.find((i) => i.type === 'pdf');
  assert.ok(item, 'pdf item');
  assert.deepEqual(ws.getDiagnostics({ fileId: file.id }), []);
  const { format, bytes: pdf } = await ws.getEmbeddedObjectBytes(item.objectRef);
  assert.equal(format, 'pdf');
  assert.match(new TextDecoder('latin1').decode(pdf), /\/Filter \/JPXDecode/);
});

test('a JBIG2 IOCA image becomes a transparent pdf item; its bytes are an image-mask PDF', async () => {
  const sdf = (code, ...d) => { const b = bytes(...d); return code > 0xff ? bytes(0xfe, code & 0xff, uint(b.length, 2), b) : bytes(code, b.length, b); };
  // Image size 0 × 0: JBIG2 gives the size itself (IOCA Reference, JBIG2 note).
  const segmentData = bytes(0x70, 0x00, 0x91, 0x01, 0xff, sdf(0x94, 0x00, uint(2400, 2), uint(2400, 2), uint(0, 2), uint(0, 2)),
    sdf(0x95, 0x84, 0x01, 0x00), sdf(0x96, 0x01), sdf(0xfe92, JBIG2), 0x93, 0x00, 0x71, 0x00);
  const image = group('D3A8FB', 'IM000001', oeg(1920, 480), field('D3A6FB', bytes(0x00, uint(2400, 2), uint(2400, 2), uint(0, 2), uint(0, 2))), field('D3EEFB', segmentData));
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(documentOf('JB2DOC01', page('PAGE0001', image)), 'jbig2.afp')], 'file');
  const item = (await ws.getRenderModel(file.id, 1)).items.find((i) => i.type === 'pdf');
  assert.ok(item?.transparent, 'transparent pdf item');
  assert.deepEqual(ws.getDiagnostics({ fileId: file.id }), []);
  const text = new TextDecoder('latin1').decode((await ws.getEmbeddedObjectBytes(item.objectRef)).bytes);
  assert.match(text, /\/Width 32 \/Height 8 \/ImageMask true/);
  assert.match(text, /\/Filter \/JBIG2Decode/);
});
