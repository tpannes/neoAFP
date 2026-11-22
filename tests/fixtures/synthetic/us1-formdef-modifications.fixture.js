/**
 * Synthetic fixture (tasks T278, T280, T282–T284; MO:DCA Reference AFPC-0004-11 and PTOCA
 * Reference AFPC-0009-04): page modifications from the form definition, a rotated page overlay
 * and Include Page.
 *
 * Resource group:
 * - the fixture font and code page (glyphs A, B, C); overlays O1ROTATE ("A" near its origin) and
 *   O1PMCOVL ("B");
 * - form definition F1MODIFY, medium map M1MODIFY: Medium Copy Count (1 copy, MMC 1), Medium
 *   Modification Control 1 with text suppression local ID 5 (keyword X'F3'), Map Suppression
 *   (SUPPRES1 → 5), Map Page Overlay of O1PMCOVL, Page Modification Control 1 with a Resource
 *   Object Include triplet X'6C' (overlay O1PMCOVL at 720/1440, unrotated; MDD units 1440/inch);
 * - document D1SAVED with page P1SAVED ("C"), for Include Page. Its page lies in the resource
 *   group, so it is no page of the file's own page sequence.
 * Document D1MODIFY:
 * - page 1: text "A", then Begin Suppression 5, "BBB", End Suppression 5, then "C" (the
 *   suppressed text is not drawn, but "C" stands where it would after "BBB"); Include Page
 *   Overlay O1ROTATE at 2000/3000 turned by 90° (X'2D00'); Include Page of P1SAVED in D1SAVED
 *   (page state: drawn into page 1);
 * - an Include Page between page 1 and page 2 (document state: reported, not drawn);
 * - page 2: text "C".
 *
 * Running this module directly writes us1-formdef-modifications.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, uint, ebcdic, triplet, documentOf, group, resourceGroup, resource, ID } from '../../helpers/afp-builder.js';
import { fontCharacterSet, codePage, mapCodedFont, AMI, AMB, SCFL, TRN, cs } from '../../helpers/fixture-text.js';

const UNITS = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2));
const A4 = [11906, 16838];

/**
 * Builds an environment group with the fixture font.
 * @param {number} w Width.
 * @param {number} h Height.
 * @returns {Uint8Array} Active Environment Group.
 */
const environment = (w, h) => group(ID.BAG, 'AEG1', mapCodedFont(),
  field(ID.PGD, bytes(UNITS, uint(w, 3), uint(h, 3), uint(0, 3))),
  field(ID.PTD, bytes(UNITS, uint(w, 3), uint(h, 3), uint(0, 2))));

/**
 * Builds a text object.
 * @param {...Uint8Array} sequences Control sequences.
 * @returns {Uint8Array} Begin … End Presentation Text Object.
 */
const text = (...sequences) => group(ID.BPT, 'PT000001', field(ID.PTX, bytes(SCFL(1), ...sequences)));

/**
 * Builds an overlay with one text.
 * @param {string} name Overlay name.
 * @param {string} letters Text.
 * @returns {Uint8Array} Resource.
 */
const overlay = (name, letters) => resource(name, 0xfc, group(ID.BMO, name, environment(...A4), text(AMB(400), AMI(100), TRN(letters))));

/**
 * Builds an Include Page: page name, 8 reserved bytes, flags (bit 0 set), FQN type X'83'.
 * @param {string} page Page name.
 * @param {string} doc Document name.
 * @returns {Uint8Array} IPG field.
 */
const includePage = (page, doc) => field('D3AFAF', bytes(ebcdic(page, 8), new Uint8Array(8), 0x80, triplet(0x02, 0x83, 0x00, ebcdic(doc, 8))));

/**
 * Builds the form definition.
 * @returns {Uint8Array} Resource.
 */
function formDefinition() {
  const mdd = field('D3A688', bytes(UNITS, uint(A4[0], 3), uint(A4[1], 3), 0x00));
  const mcc = field('D3A288', bytes(uint(1, 2), uint(1, 2), 0x00, 0x01));
  const mmc = field('D3A788', bytes(0x01, 0xff, 0xf3, 0x05));
  const msu = field('D3ABEA', bytes(ebcdic('SUPPRES1', 8), 0x00, 0x05));
  const mpo = field('D3ABD8', bytes(uint(18, 2), triplet(0x02, 0x84, 0x00, ebcdic('O1PMCOVL', 8)), triplet(0x24, 0x02, 0x01)));
  const roi = triplet(0x6c, 0xdf, ebcdic('O1PMCOVL', 8), uint(720, 3), uint(1440, 3), uint(0, 2));
  const pmc = field('D3A7AF', bytes(0x01, 0x00, roi));
  return resource('F1MODIFY', 0xfe, group('D3A8CD', 'F1MODIFY', group('D3A8C4', 'DEG00001', mdd),
    group('D3A8CC', 'M1MODIFY', mcc, mmc, msu, mpo, pmc)));
}

/**
 * Builds the file.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  const saved = resource('D1SAVED', 0xa8, documentOf('D1SAVED',
    group(ID.BPG, 'P1SAVED', environment(...A4), text(AMB(5000), AMI(1440), TRN('C')))));
  // Include Page Overlay: name, X/Y offset (3 + 3), rotation X'2D00' = 90°.
  const ipo = field('D3AFD8', bytes(ebcdic('O1ROTATE', 8), uint(2000, 3), uint(3000, 3), uint(0x2d00, 2)));
  const page1 = group(ID.BPG, 'PAGE0001', environment(...A4),
    text(AMB(1440), AMI(1440), TRN('A'), cs(0xf2, 0x05), TRN('BBB'), cs(0xf4, 0x05), TRN('C')),
    ipo, includePage('P1SAVED', 'D1SAVED'));
  const page2 = group(ID.BPG, 'PAGE0002', environment(...A4), text(AMB(1440), AMI(1440), TRN('C')));
  return bytes(
    resourceGroup(fontCharacterSet(), codePage(), overlay('O1ROTATE', 'A'), overlay('O1PMCOVL', 'B'), formDefinition(), saved),
    documentOf('D1MODIFY', page1, includePage('P1SAVED', 'D1SAVED'), page2),
  );
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us1-formdef-modifications.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us1-formdef-modifications.afp', import.meta.url), buildBytes());
}
