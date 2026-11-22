/**
 * Synthetic fixture (task T047): a 5-page document with an inline form definition.
 *
 * Form definition F1NEOFDF (MO:DCA Form Map):
 * - document environment group: Medium Descriptor (A4 landscape, 16838 × 11906 at 1440/inch);
 * - medium map M1DUPLEX: Medium Copy Count (1 copy, MMC 1), Medium Modification Control with
 *   keywords in ascending order (MO:DCA "MMC"): output bin 1 (X'90'/X'91'), input bin 2 (X'E1'),
 *   media type local ID 1 (X'E8'/X'E9'), medium overlay local ID 1 (X'F2'), duplex tumble
 *   (X'F4' = 3), 2-up (X'FC'); Map Medium Overlay (1 → O1NEOOVL); Map Media Type (repeating group:
 *   length, 6 reserved bytes, FQN type X'11' "PLAIN", Extended Resource Local ID X'22' type X'40'
 *   = 1); Page Position format 2 with two positions on the front and two on the back. (Before
 *   T282 the overlay was given as X'D1' — which is offset stack/edge mark change — and the MMT
 *   without its repeating group header.)
 * - medium map M2SIMPLX: simplex (X'F4' = 1), input bin 1, one page position.
 * Pages 1–4 use the first medium map (no Invoke Medium Map yet); an IMM selects M2SIMPLX before
 * page 5. The pages are A5 portrait (8419 × 11906).
 *
 * Expected: sheet 1 holds pages 1–2 (front) and 3–4 (back), sheet 2 holds page 5 on the front
 * only (the IMM starts a new sheet); print information per page as set in the medium maps
 * (SC-005).
 *
 * Running this module directly writes us1-formdef-duplex.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, uint, ebcdic, triplet, documentOf, group, resourceGroup, resource, ID } from '../../helpers/afp-builder.js';
import { fontCharacterSet, codePage, mapCodedFont, AMI, AMB, SCFL, TRN } from '../../helpers/fixture-text.js';

const UNITS = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2));
const A5 = [8419, 11906];

/**
 * Medium Modification Control: id, reserved, keyword pairs.
 * @param {number} id MMC id.
 * @param {number[][]} keywords [keyword, value] pairs.
 * @returns {Uint8Array} Field.
 */
const mmc = (id, keywords) => field('D3A788', bytes(id, 0x00, ...keywords.map(([k, v]) => bytes(k, v))));

/**
 * Builds the form definition.
 * @returns {Uint8Array} Begin Form Map … End Form Map.
 */
function formDefinition() {
  const mdd = field('D3A688', bytes(UNITS, uint(16838, 3), uint(11906, 3), 0x00));
  const mcc = field('D3A288', bytes(uint(1, 2), uint(1, 2), 0x00, 0x01));
  // Page Position format 2: constant, repeating group length 10, groups of X, Y (3 + 3),
  // orientation (2), sheet side (0 front, 1 back), flags.
  const pgp2 = field('D3B1AF', bytes(0x00, 10,
    uint(0, 3), uint(0, 3), uint(0, 2), 0x00, 0x00,
    uint(8419, 3), uint(0, 3), uint(0, 2), 0x00, 0x00,
    uint(0, 3), uint(0, 3), uint(0, 2), 0x01, 0x00,
    uint(8419, 3), uint(0, 3), uint(0, 2), 0x01, 0x00));
  // Map Medium Overlay: repeating group length, reserved, then local id, reserved (3), name.
  const mmo = field('D3B1DF', bytes(12, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, ebcdic('O1NEOOVL', 8)));
  const mmtTriplets = bytes(triplet(0x02, 0x11, 0x00, ebcdic('PLAIN', 8)), triplet(0x22, 0x40, uint(1, 4)));
  const mmt = field('D3AB88', bytes(uint(8 + mmtTriplets.length, 2), 0, 0, 0, 0, 0, 0, mmtTriplets));
  const map1 = group('D3A8CC', 'M1DUPLEX', mcc,
    mmc(1, [[0x90, 0x00], [0x91, 0x01], [0xe1, 0x02], [0xe8, 0x00], [0xe9, 0x01], [0xf2, 0x01], [0xf4, 0x03], [0xfc, 0x02]]), mmo, mmt, pgp2);
  const map2 = group('D3A8CC', 'M2SIMPLX', mcc, mmc(1, [[0xf4, 0x01], [0xe1, 0x01]]),
    field('D3ACAF', bytes(uint(0, 3), uint(0, 3))));
  return resource('F1NEOFDF', 0xfe, group('D3A8CD', 'F1NEOFDF', group('D3A8C4', 'DEG00001', mdd), map1, map2));
}

/**
 * Builds a page with the page number as text ("A" … "AAAAA" with the fixture font).
 * @param {number} n Page number.
 * @returns {Uint8Array} Begin Page … End Page.
 */
function numberedPage(n) {
  const [w, h] = A5;
  return group(ID.BPG, `PAGE000${n}`,
    group(ID.BAG, 'AEG1', mapCodedFont(),
      field(ID.PGD, bytes(UNITS, uint(w, 3), uint(h, 3), uint(0, 3))),
      field(ID.PTD, bytes(UNITS, uint(w, 3), uint(h, 3), uint(0, 2)))),
    group(ID.BPT, 'PT000001', field(ID.PTX, bytes(SCFL(1), AMB(1440), AMI(1440), TRN('A'.repeat(n))))));
}

/**
 * Builds the file.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  const overlay = resource('O1NEOOVL', 0xfc, group(ID.BMO, 'O1NEOOVL',
    group(ID.BAG, 'AEG1', mapCodedFont(),
      field(ID.PGD, bytes(UNITS, uint(16838, 3), uint(11906, 3), uint(0, 3))),
      field(ID.PTD, bytes(UNITS, uint(16838, 3), uint(11906, 3), uint(0, 2)))),
    group(ID.BPT, 'PT000009', field(ID.PTX, bytes(SCFL(1), AMB(11000), AMI(8000), TRN('CCC'))))));
  return bytes(
    resourceGroup(fontCharacterSet(), codePage(), overlay, formDefinition()),
    documentOf('FORMDOC1', numberedPage(1), numberedPage(2), numberedPage(3), numberedPage(4),
      field('D3ABCC', ebcdic('M2SIMPLX', 8)), numberedPage(5)),
  );
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us1-formdef-duplex.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us1-formdef-duplex.afp', import.meta.url), buildBytes());
}
