/**
 * Synthetic fixture (task T046): a page that includes a page segment (Include Page Segment) and
 * a page overlay (Include Page Overlay) at offsets, both resources inline.
 *
 * - The page segment holds presentation text and uses the page's environment (its coded font
 *   mapping, MO:DCA "Page Segment").
 * - The overlay has its own active environment group (Map Coded Font, Page Descriptor,
 *   Presentation Text Data Descriptor) and is positioned by the X/Y offset of the IPO.
 * Text uses the fixture font of tests/helpers/fixture-text.js. Expected positions: the include
 * offset plus the text position inside the segment or overlay (1440 page units per inch).
 *
 * Running this module directly writes us1-overlay-segment.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, uint, ebcdic, documentOf, group, resourceGroup, resource, ID } from '../../helpers/afp-builder.js';
import { fontCharacterSet, codePage, mapCodedFont, AMI, AMB, SCFL, TRN, STC } from '../../helpers/fixture-text.js';

const UNITS = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2));

/**
 * Builds an active environment group.
 * @param {number} width Width in 1/1440 inch.
 * @param {number} height Height in 1/1440 inch.
 * @returns {Uint8Array} Begin/End Active Environment Group.
 */
function environment(width, height) {
  return group(ID.BAG, 'AEG1', mapCodedFont(),
    field(ID.PGD, bytes(UNITS, uint(width, 3), uint(height, 3), uint(0, 3))),
    field(ID.PTD, bytes(UNITS, uint(width, 3), uint(height, 3), uint(0, 2))));
}

/**
 * Builds a presentation text object.
 * @param {string} name Object name.
 * @param {...Uint8Array} sequences Control sequences.
 * @returns {Uint8Array} Begin/End Presentation Text Object.
 */
const text = (name, ...sequences) => group(ID.BPT, name, field(ID.PTX, bytes(...sequences)));

/**
 * Builds an include field: name, X and Y offset (3 bytes each); the overlay include adds the
 * orientation (MO:DCA Include Page Segment / Include Page Overlay).
 * @param {string} id Field identifier.
 * @param {string} name Resource name.
 * @param {number} x X offset.
 * @param {number} y Y offset.
 * @param {boolean} overlay Add the orientation field.
 * @returns {Uint8Array} Field.
 */
const include = (id, name, x, y, overlay) => field(id, bytes(ebcdic(name, 8), uint(x, 3), uint(y, 3), overlay ? uint(0, 2) : []));

/**
 * Builds the file.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  const segment = resource('S1NEOSEG', 0xfb, group(ID.BPS, 'S1NEOSEG',
    text('PT000002', SCFL(1), AMB(360), AMI(0), TRN('ABC'))));
  const overlay = resource('O1NEOOVL', 0xfc, group(ID.BMO, 'O1NEOOVL', environment(5760, 2880),
    text('PT000003', SCFL(1), AMB(720), AMI(360), STC(0x0002), TRN('CAB'))));
  const pageContent = bytes(
    environment(11906, 16838),
    text('PT000001', SCFL(1), AMB(1440), AMI(1440), TRN('ABBA')),
    include('D3AF5F', 'S1NEOSEG', 1440, 2880, false),
    include('D3AFD8', 'O1NEOOVL', 5760, 4320, true),
  );
  return bytes(resourceGroup(fontCharacterSet(), codePage(), segment, overlay),
    documentOf('OVLSEG01', group(ID.BPG, 'PAGE0001', pageContent)));
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us1-overlay-segment.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us1-overlay-segment.afp', import.meta.url), buildBytes());
}
