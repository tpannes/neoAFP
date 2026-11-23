/**
 * Image PDFs (task T311): wraps image data that only pdf.js can decode — JPEG 2000 (JPXDecode)
 * in object containers and JBIG2 (JBIG2Decode) in IOCA images — into a one-page PDF, so the
 * viewer draws it like any embedded PDF page. The page has the image's size in pixels (as points);
 * the viewer scales it into the object area. A JBIG2 image is an image mask: its 1 pels are
 * painted in the image color, its 0 pels stay transparent, as for other bilevel IOCA images.
 * JPEG 2000 and JBIG2 headers are read here for the image size.
 */

import { u } from '../modca/bytes.js';

/**
 * Builds a one-page PDF that shows one image filling the page.
 * @param {{data: Uint8Array, width: number, height: number, filter: 'JPXDecode'|'JBIG2Decode',
 *   imageMask?: boolean, color?: [number, number, number]}} image Image data, size in pixels,
 *   filter, and for image masks the RGB color (0–1) of the painted pels (default black).
 * @returns {Uint8Array} PDF bytes.
 */
export function imagePdf({ data, width, height, filter, imageMask = false, color = [0, 0, 0] }) {
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n, ...chunks) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    chunks.forEach(push);
    push('\nendobj\n');
  };
  const content = `q ${imageMask ? `${color.join(' ')} rg ` : ''}${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
  const dict = imageMask
    ? `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ImageMask true /BitsPerComponent 1`
    : `/Type /XObject /Subtype /Image /Width ${width} /Height ${height}`;
  push('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
  object(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  object(5, `<< ${dict} /Filter /${filter} /Length ${data.length} >>\nstream\n`, data, '\nendstream');
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/**
 * Tells whether data is JPEG 2000: a JP2 file (signature box) or a bare codestream (SOC, SIZ).
 * @param {Uint8Array} d Data.
 * @returns {boolean} True for JPEG 2000.
 */
export function isJpeg2000(d) {
  const jp2 = [0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a];
  return jp2.every((b, i) => d[i] === b) || (d[0] === 0xff && d[1] === 0x4f && d[2] === 0xff && d[3] === 0x51);
}

/**
 * Reads the size and resolution of a JPEG 2000 image: from the JP2 header box (ihdr; resolution
 * from resd or resc, in pixels per metre) or from the SIZ marker of a bare codestream.
 * @param {Uint8Array} d JPEG 2000 data.
 * @returns {{width: number, height: number, xRes: number, yRes: number}|null} Size in pixels and
 *   resolution in dpi (96 when none is given), or null.
 */
export function jpeg2000Header(d) {
  if (d[0] === 0xff && d[1] === 0x4f) {
    // SIZ: marker, Lsiz, Rsiz, Xsiz, Ysiz, XOsiz, YOsiz.
    if (d.length < 26) return null;
    return { width: u(d, 8, 4) - u(d, 16, 4), height: u(d, 12, 4) - u(d, 20, 4), xRes: 96, yRes: 96 };
  }
  let size = null;
  let res = null;
  const walk = (from, to) => {
    for (let pos = from; pos + 8 <= to;) {
      let len = u(d, pos, 4);
      const type = String.fromCharCode(...d.subarray(pos + 4, pos + 8));
      let head = 8;
      if (len === 1) { len = Number((BigInt(u(d, pos + 8, 4)) << 32n) | BigInt(u(d, pos + 12, 4))); head = 16; }
      if (len === 0) len = to - pos;
      if (len < head) return;
      const body = pos + head;
      if (type === 'jp2h' || type === 'res ') walk(body, pos + len);
      else if (type === 'ihdr') size = { height: u(d, body, 4), width: u(d, body + 4, 4) };
      else if ((type === 'resd' || (type === 'resc' && !res)) && body + 10 <= d.length) {
        // VR_N, VR_D, HR_N, HR_D (2 bytes each), VR_E, HR_E (signed exponents): pixels per metre.
        const exp = (b) => (b > 127 ? b - 256 : b);
        const vr = (u(d, body, 2) / u(d, body + 2, 2)) * 10 ** exp(d[body + 8]);
        const hr = (u(d, body + 4, 2) / u(d, body + 6, 2)) * 10 ** exp(d[body + 9]);
        if (Number.isFinite(vr) && Number.isFinite(hr) && vr > 0 && hr > 0) res = { xRes: hr * 0.0254, yRes: vr * 0.0254 };
      }
      if (type === 'jp2c') return;
      pos += len;
    }
  };
  walk(0, d.length);
  return size ? { ...size, xRes: res?.xRes ?? 96, yRes: res?.yRes ?? 96 } : null;
}

/** JBIG2 file header ID string (ITU-T T.88, Annex D.4). */
const JBIG2_ID = [0x97, 0x4a, 0x42, 0x32, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Prepares JBIG2 data for a PDF: the embedded stream format (segments one after another, as PDF
 * expects). A JBIG2 file header is removed when the file is in sequential organization; a file in
 * random-access organization cannot be passed on (null).
 * @param {Uint8Array} d JBIG2 data.
 * @returns {Uint8Array|null} Embedded stream, or null.
 */
export function jbig2Embedded(d) {
  if (!JBIG2_ID.every((b, i) => d[i] === b)) return d;
  const flags = d[8];
  if (!(flags & 0x01)) return null; // random-access organization
  return d.subarray(flags & 0x02 ? 9 : 13);
}

/**
 * Reads the page size from the first page information segment (type 48) of a JBIG2 embedded
 * stream (ITU-T T.88, 7.2 segment header, 7.4.8 page information).
 * @param {Uint8Array} d JBIG2 embedded stream.
 * @returns {{width: number, height: number}|null} Page size in pixels, or null.
 */
export function jbig2PageSize(d) {
  for (let pos = 0; pos + 11 <= d.length;) {
    const number = u(d, pos, 4);
    const flags = d[pos + 4];
    let at = pos + 5;
    // Referred-to segments: a count in the top 3 bits, or (7) a 4-byte long form with a bit field.
    let count = d[at] >> 5;
    if (count === 7) { count = u(d, at, 4) & 0x1fffffff; at += 4 + Math.ceil((count + 1) / 8); } else at += 1;
    at += count * (number <= 256 ? 1 : number <= 65536 ? 2 : 4);
    at += flags & 0x40 ? 4 : 1; // page association
    const length = u(d, at, 4);
    at += 4;
    if ((flags & 0x3f) === 48 && at + 8 <= d.length) return { width: u(d, at, 4), height: u(d, at + 4, 4) };
    if (length === 0xffffffff) return null; // unknown length: cannot skip
    pos = at + length;
  }
  return null;
}
