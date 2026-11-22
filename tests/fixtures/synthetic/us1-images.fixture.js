/**
 * Synthetic fixture (task T042): IOCA image objects with different encodings, one page.
 *
 * Images (IOCA Reference, image segment self-defining fields X'94' size, X'95' encoding, X'96'
 * IDE size, X'9B' IDE structure, X'8C'/X'8D' tile, X'B5'/X'B6' tile position/size, X'8E'/X'8F'
 * transparency mask, X'FE92' image data):
 * 1. bilevel 64 × 48 at 240 dpi, uncompressed (X'03'), Map Image Object "position and trim";
 * 2. the same bitmap, G4 MMR (X'82');
 * 3. the same bitmap, TIFF LZW (X'0D');
 * 4. RL4 (X'06'), which neoAFP does not support (research R6): placeholder + diagnostic;
 * 5. a 32 × 24 JPEG (X'83'), passed on encoded;
 * 6. grayscale 32 × 32, 8 bits per pel, uncompressed;
 * 7. tiled 64 × 32: a bilevel tile with a transparency mask and an 8-bit grayscale tile.
 *
 * The G4, LZW and JPEG data were made with Pillow (libtiff, libjpeg) from the synthetic bitmap
 * and gradient defined here; the G4 and LZW data decode bit for bit to the bitmap of image 1.
 *
 * Running this module directly writes us1-images.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, uint, triplet, documentOf, page, group } from '../../helpers/afp-builder.js';
import { bitmap, PATTERNS } from './us1-im-image.fixture.js';

const G4 = Buffer.from(
  'JqB4bzgpF/RHX7KLfsos+yiv7KKvsop+yhsjn2UNfZQH9lAX2UY+ykn2UT+ylf2UNEX+ygP7KAvsox9lJPson9lK/spR9lVE' +
  'c+ytfsrT7KD+yiPspH2Uf7Kp9lakX+ytPsoP7KI+ykfZR/sqn2VP7Is+//////EYAIAI', 'base64');
const LZW = Buffer.from(
  'gD/gUDgTAAEHg7/AKghEJAKQhoAhSIiMKQkVAKCjCBjCAQEIP8SQBAkEiEElf6ACEoQAIlgElgClgBlgAj8Oj8knAAk87lc7' +
  'l07mE7mU7mk7mwAkMpg8kpc3k9Pg8rqQAl1VmFVmVVmlVpMKm4AklghEnslTiQBsMus4AmFtmVtmltiUihtepV2mt7g94pcE' +
  'gkBA', 'base64');
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQ' +
  'ERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU' +
  'FBQUFBQUFBQUFBQUFBT/wAARCAAYACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA' +
  'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6' +
  'Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
  'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA' +
  'AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5' +
  'OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPE' +
  'xcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD4e0nwT0/d/pXZ6T4J+7+7/SvStJ8E9P3f' +
  '6V2ek+Cen7v9K/TcZn2+p8/w3xN8PvHmuk+Cfu/u/wBK7PSfBX3f3f6V6VpPgrp+7/Suz0nwV0/d/pXw2Mz7fU/qvhvib4fe' +
  'MPSfBP3f3f6V2ek+Cfu/u/0oor4HGYytrqf5e8N5hiPd1Oz0nwV9393+ldnpPgr7v7v9KKK+GxmMra6n9V8N5hiPd1P/2Q==', 'base64');

/** Self-defining field (short form, or X'FE' long form for image data). */
const sdf = (code, ...data) => {
  const d = bytes(...data);
  return code > 0xff ? bytes(0xfe, code & 0xff, uint(d.length, 2), d) : bytes(code, d.length, d);
};
const size = (w, h) => sdf(0x94, 0x00, uint(2400, 2), uint(2400, 2), uint(w, 2), uint(h, 2));
const encoding = (compression) => sdf(0x95, compression, 0x01, 0x00);
const ide = (bits) => sdf(0x96, bits);
const data = (d) => sdf(0xfe92, d);

/**
 * Builds an image object with an object area at a page position.
 * @param {number} n Object number.
 * @param {number} x Area x.
 * @param {number} y Area y.
 * @param {number} w Image width in pels (240 dpi).
 * @param {number} h Image height.
 * @param {Uint8Array} content Image content fields (between Begin and End Image Content).
 * @param {number|null} [mapping] Mapping option for a Map Image Object, or null for none.
 * @returns {Uint8Array} Begin Image Object … End Image Object.
 */
function image(n, x, y, w, h, content, mapping = null) {
  const obd = bytes(triplet(0x43, 0x01), triplet(0x4b, 0x00, 0x00, uint(14400, 2), uint(14400, 2)),
    triplet(0x4c, 0x02, uint(w * 6, 3), uint(h * 6, 3)));
  const obp = bytes(0x01, 23, uint(x, 3), uint(y, 3), uint(0, 2), uint(0x2d00, 2), 0x00,
    uint(0, 3), uint(0, 3), uint(0, 2), uint(0x2d00, 2), 0x01); // RefCSys X'01': standard origin
  const idd = bytes(0x00, uint(2400, 2), uint(2400, 2), uint(w, 2), uint(h, 2));
  const segment = bytes(0x70, 0x00, 0x91, 0x01, 0xff, size(w, h), content, 0x93, 0x00, 0x71, 0x00);
  return group('D3A8FB', `IM${String(n).padStart(6, '0')}`,
    group('D3A8C7', 'OEG00001', field('D3A66B', obd), field('D3AC6B', obp),
      ...(mapping === null ? [] : [field('D3ABFB', bytes(uint(5, 2), triplet(0x04, mapping)))])),
    field('D3A6FB', idd), field('D3EEFB', segment));
}

/**
 * Builds the file.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  const bits = bitmap(...PATTERNS.single);
  const gray = Uint8Array.from({ length: 32 * 32 }, (_, i) => ((i % 32) * 8) ^ (Math.floor(i / 32) * 4));
  const maskBits = bitmap(32, 32, (x, y) => (x - 16) ** 2 + (y - 16) ** 2 < 196);
  const tileBits = bitmap(32, 32, (x, y) => (x + y) % 6 < 3);
  const tile = (x, y, ...content) => bytes(sdf(0x8c), sdf(0xb5, uint(x, 4), uint(y, 4)), sdf(0xb6, uint(32, 4), uint(32, 4), 0x01), ...content, sdf(0x8d));
  const tiled = bytes(
    tile(0, 0, encoding(0x03), ide(1), sdf(0x8e), size(32, 32), data(maskBits), sdf(0x8f), data(tileBits)),
    tile(32, 0, encoding(0x03), ide(8), data(gray)),
  );
  return documentOf('IOCADOC1', page('PAGE0001',
    image(1, 1440, 1440, 64, 48, bytes(encoding(0x03), ide(1), data(bits)), 0x10),
    image(2, 4320, 1440, 64, 48, bytes(encoding(0x82), ide(1), data(G4))),
    image(3, 7200, 1440, 64, 48, bytes(encoding(0x0d), ide(1), data(LZW))),
    image(4, 1440, 4320, 64, 48, bytes(encoding(0x06), ide(1), data(new Uint8Array(16)))),
    image(5, 4320, 4320, 32, 24, bytes(encoding(0x83), ide(24), sdf(0x9b, 0x00, 0x12, 0, 0, 0, 8, 8, 8), data(JPEG))),
    image(6, 7200, 4320, 32, 32, bytes(encoding(0x03), ide(8), data(gray))),
    image(7, 1440, 7200, 64, 32, tiled),
  ));
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us1-images.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us1-images.afp', import.meta.url), buildBytes());
}
