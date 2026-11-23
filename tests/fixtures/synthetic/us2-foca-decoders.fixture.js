/**
 * Synthetic fixture (field coverage rule, T020; task T309): the decoders of Page Position format 1
 * (MO:DCA Reference AFPC-0004-11, PGP-1), Code Page Index and Font Name Map (FOCA), whose groups
 * can only be read with an earlier field of the same object (Code Page Control, Font Control).
 * The expected values repeat the values written here.
 *
 * Resource group:
 * - code page T1NEOAF1 of the text fixture (single-byte: CPI groups of 10 bytes);
 * - double-byte code page T1NEODB1: CPC with CPIRGLen X'0B', CPI of ten groups of 11 bytes
 *   (110 bytes, a whole number of 10-byte groups too: only the CPC tells them apart), GCGIDs
 *   JPNEO000–JPNEO009 at code points X'4281'–X'428A';
 * - Type 1 outline font C0NEOTY1: Font Control with technology X'1F', FNNRGLen 12 and FNNMapCnt 2,
 *   Font Name Map with groups LA010000 → "a" and LB010000 → "b" (offsets 24 and 26);
 * - form map F1NEOPG1 with medium map M1NEOPG1 and a Page Position format 1 at 100/200.
 *
 * Running this module directly writes us2-foca-decoders.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, uint, ebcdic, group, resourceGroup, resource, ID } from '../../helpers/afp-builder.js';
import { codePage } from '../../helpers/fixture-text.js';

/**
 * Builds the file.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  const groups = Array.from({ length: 10 }, (_, i) => bytes(ebcdic(`JPNEO00${i}`, 8), 0x00, 0x42, 0x81 + i));
  const doubleByte = resource('T1NEODB1', 0x41, group(ID.BCP, 'T1NEODB1',
    field('D3A687', bytes(ebcdic('NEOAFP DOUBLE-BYTE CODE PAGE', 32), uint(8, 2), uint(10, 4), uint(0, 2), uint(0, 2))),
    field('D3A787', bytes(ebcdic('JPNEO000', 8), 0x00, 0x0b, 0x00, 0x40, 0x00)),
    field('D38C87', bytes(...groups))));
  // FNC (42 bytes): retired X'01', technology X'1F' (Type 1), …, FNNRGLen (byte 35) 12,
  // FNNDCnt (36–39) 28, FNNMapCnt (40–41) 2.
  const fnc = bytes(0x01, 0x1f, new Uint8Array(33), 12, uint(28, 4), uint(2, 2));
  // FNN: two groups (GCGID, offset of the name), then the names (length byte counting itself).
  const fnn = bytes(ebcdic('LA010000', 8), uint(24, 4), ebcdic('LB010000', 8), uint(26, 4), 0x02, 0x61, 0x02, 0x62);
  const font = resource('C0NEOTY1', 0x40, group(ID.BFN, 'C0NEOTY1',
    field('D3A689', bytes(ebcdic('NEOAFP TYPE 1', 32), new Uint8Array(48))), field('D3A789', fnc), field('D3AB89', fnn)));
  const formMap = resource('F1NEOPG1', 0xfe, group('D3A8CD', 'F1NEOPG1',
    group('D3A8C4', 'DEG00001', field('D3A688', bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2), uint(11906, 3), uint(16838, 3), 0x00))),
    group('D3A8CC', 'M1NEOPG1', field('D3ACAF', bytes(uint(100, 3), uint(200, 3))))));
  return resourceGroup(codePage(), doubleByte, font, formMap);
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us2-foca-decoders.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us2-foca-decoders.afp', import.meta.url), buildBytes());
}
