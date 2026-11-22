/**
 * Downloads from the viewer (FR-055–FR-057): the resource list as CSV named
 * `neoafp-resources-YYYYMMDD-HHMMSS.csv` (local time), a resource preview as PNG, the exact
 * bytes of an extracted resource, and the TLE and NOP tables named after the AFP file
 * (`<name>_TLE.csv`, `<name>_NOP.json` …, see tableFileName). Everything is saved through a Blob and an `<a download>` link;
 * nothing leaves the device.
 */

/**
 * Saves data as a file.
 * @param {Blob} blob Content.
 * @param {string} fileName File name.
 * @returns {void}
 */
export function saveBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Builds the file name of a table export: the AFP file's name without a ".afp" extension (any
 * case), then the postfix and extension. Other extensions are kept: AFP files are recognized by
 * their content, and mainframe names such as "JOB1234.Q01.000012345600001" contain dots that are
 * not extensions.
 * @param {string} afpName Name of the AFP file (a folder path is reduced to the file name).
 * @param {string} postfix E.g. "_TLE".
 * @param {string} extension E.g. "csv".
 * @returns {string} E.g. "statement_TLE.csv" for "statement.afp".
 */
export function tableFileName(afpName, postfix, extension) {
  const name = (afpName || 'file').split('/').pop().replace(/\.afp$/i, '');
  return `${name}${postfix}.${extension}`;
}

/**
 * Builds the CSV file name for a moment (local time).
 * @param {Date} [date] Moment.
 * @returns {string} E.g. "neoafp-resources-20261107-143005.csv".
 */
export function csvFileName(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `neoafp-resources-${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.csv`;
}

/**
 * Saves the resource list as CSV.
 * @param {string} csv CSV text (with byte order mark) from exportResourcesCsv.
 * @returns {void}
 */
export function downloadCsv(csv) {
  saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), csvFileName());
}

/**
 * Saves a canvas as PNG.
 * @param {HTMLCanvasElement} canvas Drawn preview.
 * @param {string} name Base name.
 * @param {number|null} [dpi] Resolution written into the file (pHYs).
 * @returns {Promise<void>} Resolves when saved.
 */
export async function downloadPng(canvas, name, dpi = null) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return;
  saveBlob(dpi ? new Blob([withPngDpi(new Uint8Array(await blob.arrayBuffer()), dpi)], { type: 'image/png' }) : blob, `${name}.png`);
}

let crcTable = null;

/**
 * CRC-32 of PNG chunks (ISO 3309, as in the PNG specification).
 * @param {Uint8Array} bytes Chunk type and data.
 * @returns {number} CRC.
 */
function crc32(bytes) {
  crcTable ??= Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Adds the resolution to a PNG (pHYs chunk after IHDR), so viewers and print tools show it at
 * its real size; browsers write PNGs without one, which most programs read as 72 dpi.
 * @param {Uint8Array} png PNG file from canvas.toBlob.
 * @param {number} dpi Resolution in dots per inch.
 * @returns {Uint8Array} PNG with pHYs.
 */
export function withPngDpi(png, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const chunk = new Uint8Array(21);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, 9);
  chunk.set([0x70, 0x48, 0x59, 0x73], 4); // "pHYs"
  view.setUint32(8, ppm);
  view.setUint32(12, ppm);
  chunk[16] = 1; // unit: meter
  view.setUint32(17, crc32(chunk.subarray(4, 17)));
  const ihdrEnd = 8 + 8 + 13 + 4; // signature, IHDR length/type, data, CRC
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd));
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

/**
 * Saves extracted resource bytes.
 * @param {{fileName: string, bytes: Uint8Array, mimeType: string}} extracted Result of extractResource.
 * @returns {void}
 */
export function downloadResource(extracted) {
  saveBlob(new Blob([extracted.bytes], { type: extracted.mimeType }), extracted.fileName);
}
