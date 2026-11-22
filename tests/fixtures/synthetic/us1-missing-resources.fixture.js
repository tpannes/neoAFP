/**
 * Synthetic fixture (task T049): a page that references resources the file does not contain —
 * a coded font (font character set C0MISSNG with code page T1MISSNG, mapped as local id 1), a
 * page segment S1MISSNG and an overlay O1MISSNG.
 *
 * Expected (FR-021): the text is drawn with a substitute font (`fontSubstituted`), the page
 * segment and overlay become placeholders at their include positions, and each absent resource
 * is reported once (`missingResource`).
 *
 * That adding the resources afterwards invalidates and fully renders the page
 * (`pagesInvalidated`) is tested in tests/unit/missing-resources.test.js.
 *
 * Running this module directly writes us1-missing-resources.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, uint, ebcdic, triplet, documentOf, group, ID } from '../../helpers/afp-builder.js';
import { AMI, AMB, SCFL, TRN } from '../../helpers/fixture-text.js';

const UNITS = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2));

/**
 * Map Coded Font (format 2) for the absent font.
 * @returns {Uint8Array} Field.
 */
function mapMissingFont() {
  const fqn = (type, name) => triplet(0x02, type, 0x00, ebcdic(name, 8));
  const rg = bytes(triplet(0x24, 0x05, 1), fqn(0x86, 'C0MISSNG'), fqn(0x85, 'T1MISSNG'), triplet(0x26, uint(0, 2)));
  return field('D3AB8A', bytes(uint(rg.length + 2, 2), rg));
}

/**
 * Builds the file.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  const pageContent = bytes(
    group(ID.BAG, 'AEG1', mapMissingFont(),
      field(ID.PGD, bytes(UNITS, uint(11906, 3), uint(16838, 3), uint(0, 3))),
      field(ID.PTD, bytes(UNITS, uint(11906, 3), uint(16838, 3), uint(0, 2)))),
    group(ID.BPT, 'PT000001', field(ID.PTX, bytes(SCFL(1), AMB(1440), AMI(1440), TRN('ABC')))),
    field('D3AF5F', bytes(ebcdic('S1MISSNG', 8), uint(1440, 3), uint(2880, 3))),
    field('D3AFD8', bytes(ebcdic('O1MISSNG', 8), uint(5760, 3), uint(4320, 3), uint(0, 2))),
  );
  return documentOf('MISSING1', group(ID.BPG, 'PAGE0001', pageContent));
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us1-missing-resources.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us1-missing-resources.afp', import.meta.url), buildBytes());
}
