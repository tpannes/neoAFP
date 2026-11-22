/**
 * Synthetic fixture (field coverage rule, T020): structured fields and triplets whose decoders no
 * other synthetic fixture covers. Every field is built from its syntax table in the MO:DCA
 * Reference AFPC-0004-11; the expected values repeat the values written here.
 *
 * Document DECODDOC with MO:DCA Interchange Set X'18' (IS/3, X'0D00') and Local Date and Time
 * Stamp X'62' (creation, 2026, day 320, 14:30:05.00) on Begin Document; page PAGE0001 whose
 * active environment group holds:
 * - Map Coded Font format 1 (X'D3B18A'): one repeating group of 30 bytes, local ID 1, coded font
 *   X0NEOAF1, code page T1NEOAF1, character set C0NEOAF1, character rotation 0;
 * - Map Coded Font format 2 with a Font Descriptor Specification X'1F' (weight class 5, width
 *   class 5, height 120, width 100, design flags X'00', usage flags X'00') and a Font Horizontal
 *   Scale Factor X'5D' (1200);
 * - Map Data Resource with a Data-Object Font Descriptor X'8B' (TrueType/OpenType X'20',
 *   vertical size 240, horizontal size 0, rotation 0, encoding environment Microsoft X'0003',
 *   encoding Unicode X'0001');
 * - Presentation Text Descriptor format 1 (X'D3A69B'): 10 inches, 1440 units, 11906 × 16838.
 * On the page an object container OC000001 with an Object Classification X'10' (class X'01',
 * structure flags X'0000', OID 1.3.18.0.4.1.1.14) and, in its object environment group, an
 * Object Area Descriptor with a Color Specification X'4E' (RGB, 8/8/8 bits, X'FF8000').
 *
 * Running this module directly writes us2-decoders.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, uint, ebcdic, triplet, group, ID } from '../../helpers/afp-builder.js';

const fqn = (type, name) => triplet(0x02, type, 0x00, ebcdic(name, 8));
const rg2 = (...parts) => {
  const body = bytes(...parts);
  return bytes(uint(body.length + 2, 2), body);
};

/**
 * Builds the file.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  const mis = triplet(0x18, 0x01, uint(0x0d00, 2));
  // StampType X'00' creation, THunYear X'F0' (20xx), then EBCDIC digits: year 26, day 320,
  // 14:30:05.00.
  const ldts = triplet(0x62, 0x00, 0xf0, ebcdic('26'), ebcdic('320'), ebcdic('14'), ebcdic('30'), ebcdic('05'), ebcdic('00'));
  const mcf1 = field('D3B18A', bytes(0x1e, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, ebcdic('X0NEOAF1', 8), ebcdic('T1NEOAF1', 8), ebcdic('C0NEOAF1', 8), uint(0, 2)));
  const fds = triplet(0x1f, 0x05, 0x05, uint(120, 2), uint(100, 2), 0x00, new Uint8Array(10), 0x00);
  const fhsf = triplet(0x5d, uint(1200, 2));
  const mcf2 = field('D3AB8A', rg2(fqn(0x86, 'C0NEOAF1'), fqn(0x85, 'T1NEOAF1'), triplet(0x24, 0x05, 0x02), fds, fhsf));
  const dofd = triplet(0x8b, 0x00, 0x20, uint(240, 2), uint(0, 2), uint(0, 2), uint(0x0003, 2), uint(0x0001, 2), uint(0, 2));
  const mdr = field('D3ABC3', rg2(triplet(0x02, 0xde, 0x00, ebcdic('NEOFONT1')), dofd));
  const ptd1 = field('D3A69B', bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2), uint(11906, 2), uint(16838, 2), 0x00, 0x00));
  const aeg = group(ID.BAG, 'AEG1', mcf1, mcf2, mdr,
    field(ID.PGD, bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2), uint(11906, 3), uint(16838, 3), uint(0, 3))), ptd1);
  // Object Classification: reserved, ObjClass X'01', reserved (2), StrucFlgs X'0000', then the
  // 16-byte registered object identifier (DER: X'06', length 7, 1.3.18.0.4.1.1.14).
  const oc = triplet(0x10, 0x00, 0x01, 0x00, 0x00, uint(0, 2), bytes(0x06, 0x07, 0x2b, 0x12, 0x00, 0x04, 0x01, 0x01, 0x0e, new Uint8Array(7)));
  // Color Specification: reserved, ColSpce X'01' (RGB), reserved (4), ColSize1–4, ColValue.
  const cs = triplet(0x4e, 0x00, 0x01, new Uint8Array(4), 8, 8, 8, 0, 0xff, 0x80, 0x00);
  const obd = field('D3A66B', bytes(triplet(0x43, 0x01), triplet(0x4b, 0x00, 0x00, uint(14400, 2), uint(14400, 2)),
    triplet(0x4c, 0x02, uint(1440, 3), uint(720, 3)), cs));
  const container = bytes(field(ID.BOC, bytes(ebcdic('OC000001', 8), oc)),
    group('D3A8C7', 'OEG00001', obd),
    field(ID.OCD, bytes(0x00, 0x01, 0x02, 0x03)),
    field(ID.EOC, ebcdic('OC000001', 8)));
  return bytes(field(ID.BDT, bytes(ebcdic('DECODDOC', 8), 0x00, 0x00, mis, ldts)),
    group(ID.BPG, 'PAGE0001', aeg, container),
    field(ID.EDT, ebcdic('DECODDOC', 8)));
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us2-decoders.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us2-decoders.afp', import.meta.url), buildBytes());
}
