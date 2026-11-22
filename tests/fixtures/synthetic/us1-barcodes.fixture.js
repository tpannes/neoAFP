/**
 * Synthetic fixture (task T045): one BCOCA bar code object per supported symbology, on three A4
 * pages (ten objects each, two columns), plus one Royal Mail RED TAG object (deprecated, its
 * encoding was never published), for the placeholder and its diagnostic. GS1 DataBar, Royal Mail
 * Mailmark and Han Xin Code (T289–T291) have their own unit tests.
 *
 * Data are the examples of the BCOCA Reference where it has one (EAN-8 "2468 1230", Industrial
 * and Matrix 2-of-5 "54321068", Code 128 "ABC123abc@456", GS1-128 "(01)90614141007687(15)001230",
 * RM4SCC "SN34RD1A", Japan Postal "154-0023-3-16-4", Australia Post "56439111ABA 9", Intelligent
 * Mail "01 234 567094 987654321 01234567891", Data Matrix "A1B2C3D4E5F6G7H8I9J0K1L2", Aztec
 * "AFP Consortium"), otherwise made-up values; no customer data.
 *
 * The expectations (us1-barcodes.expected.json) record, for every item, the first and last path
 * point and the HRI text and position. They were taken from the implementation after its
 * symbols had been checked against independent references (BWIPP bar for bar or module for
 * module, zxing-cpp decoding of every 2D symbol); a change in these values means the bar code
 * geometry changed and has to be checked again in the same way.
 *
 * Running this module directly (node tests/fixtures/synthetic/us1-barcodes.fixture.js) writes
 * us1-barcodes.afp next to it, a file to open in the viewer.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, uint, ebcdic, documentOf, page, group, triplet } from '../../helpers/afp-builder.js';

const ascii = (s) => Uint8Array.from(Buffer.from(s, 'latin1'));

/**
 * Bar code objects: [type, modifier, special-function bytes, data, rotation].
 * Special functions follow BCOCA Tables 21–31; text data is EBCDIC (code page 500) unless given
 * as bytes.
 */
const OBJECTS = [
  // Page 1: Code 39, MSI, UPC/EAN
  [0x01, 0x02, [], 'NEOAFP-39'],
  [0x02, 0x02, [], '80523'],
  [0x03, 0x00, [], '01234567890'],
  [0x05, 0x00, [], '4210000526'],
  [0x06, 0x00, [], '12'],
  [0x07, 0x00, [], '54321'],
  [0x08, 0x00, [], '2468123'],
  [0x09, 0x00, [], '400638133393'],
  [0x16, 0x00, [], '05'],
  [0x17, 0x00, [], '52495'],
  // Page 2: 2-of-5, Codabar, Code 128, Code 93, postal
  [0x0a, 0x02, [], '54321068'],
  [0x0b, 0x02, [], '54321068'],
  [0x0c, 0x03, [], '1540014128876'],
  [0x0d, 0x01, [], 'A34698735B'],
  [0x11, 0x02, [], 'ABC123abc@456'],
  [0x11, 0x04, [], bytes(0x8f, ebcdic('019061414100768715001230'))],
  [0x21, 0x00, [], 'TEST93'],
  [0x18, 0x00, [], '12345'],
  [0x1a, 0x00, [], 'SN34RD1A'],
  [0x1b, 0x00, [], '154-0023-3-16-4'],
  // Page 3: postal and 2D, one rotated object of each matrix kind, one unsupported type (RED TAG)
  [0x1f, 0x03, [], '56439111ABA 9'],
  [0x22, 0x03, [], '0123456709498765432101234567891'],
  [0x1c, 0x00, [0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'A1B2C3D4E5F6G7H8I9J0K1L2'],
  [0x20, 0x02, [0x80, 0x01, 0, 1, 0, 0, 0, 0, 0], 'HTTPS://WWW.AFPCONSORTIUM.ORG', 90],
  [0x1e, 0x00, [0x80, 3, 0xff, 2, 0, 0], 'PDF417 neoAFP'],
  [0x1d, 0x00, [0x80, 4, 0, 0, 0], 'MAXICODE MODE 4'],
  [0x26, 0x01, [0x80, 0, 0xff, 0xff, 0, 0, 0, 0, 0, 0], 'AFP Consortium'],
  [0x26, 0x02, [0x00, 0, 0, 0xff, 0, 0, 0, 0, 0, 0], ascii('{'), 180],
  [0x20, 0x02, [0x00, 0, 0, 2, 0, 0, 0, 0, 0], ascii('Quartile level'), 270],
  [0x23, 0x00, [], '012345672250513234567'],
];

/**
 * Builds one bar code object: area 4800 × 2400 L-units (1440 per inch), symbol at (300, 300).
 * @param {number} n Object number.
 * @param {Array} def Object definition from OBJECTS.
 * @param {number} x Area x on the page.
 * @param {number} y Area y on the page.
 * @returns {Uint8Array} Begin Bar Code Object … End Bar Code Object.
 */
function barcode(n, [type, modifier, special, data, rotation = 0], x, y) {
  const bsd = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2), uint(0xffff, 2), uint(0xffff, 2), uint(0, 2),
    type, modifier, 0xff, uint(0xff07, 2), 0xff, uint(0xffff, 2), 1, uint(0xffff, 2));
  const obd = bytes(triplet(0x43, 0x01), triplet(0x4b, 0x00, 0x00, uint(14400, 2), uint(14400, 2)),
    triplet(0x4c, 0x02, uint(4800, 3), uint(2400, 3)));
  const q = rotation / 90;
  const obp = bytes(0x01, 23, uint(x, 3), uint(y, 3), uint(q * 0x2d00, 2), uint(((q + 1) % 4) * 0x2d00, 2), 0x00,
    uint(0, 3), uint(0, 3), uint(0, 2), uint(0x2d00, 2), 0x01); // RefCSys X'01': standard origin
  const payload = typeof data === 'string' ? ebcdic(data) : data;
  return group('D3A8EB', `BC${String(n).padStart(6, '0')}`,
    group('D3A8C7', 'OEG00001', field('D3A66B', obd), field('D3AC6B', obp), field('D3ABEB', bytes(uint(5, 2), triplet(0x04, 0x00))),
      field('D3A6EB', bsd)),
    field('D3EEEB', bytes(0x00, uint(300, 2), uint(300, 2), bytes(...special), payload)));
}

/**
 * Builds the document: ten objects per page in two columns.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  const pages = [];
  for (let p = 0; p * 10 < OBJECTS.length; p++) {
    const content = OBJECTS.slice(p * 10, p * 10 + 10).map((def, i) => {
      const rotated = def[4] === 90 ? 4800 : def[4] === 180 ? 4800 : 0;
      const x = (i % 2 === 0 ? 1000 : 6200) + rotated;
      const y = 1000 + Math.floor(i / 2) * 3000 + (def[4] === 180 || def[4] === 270 ? 2400 : 0);
      return barcode(p * 10 + i + 1, def, x, y);
    });
    pages.push(page(`PAGE${String(p + 1).padStart(4, '0')}`, ...content));
  }
  return documentOf('BARCODES', ...pages);
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us1-barcodes.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us1-barcodes.afp', import.meta.url), buildBytes());
}
