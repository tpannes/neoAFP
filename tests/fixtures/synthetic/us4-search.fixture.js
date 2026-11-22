/**
 * Synthetic fixture (task T145): known words in page text, TLEs, NOPs and a resource name
 * (FR-060–FR-063, SC-008). The search covers page text only (the TLE and NOP browsers filter
 * their own tables), so words that occur only in a TLE, a NOP or a resource name are not found.
 *
 * - Page 1 text "Rechnung für Herrn Müller, Straße 12"; page 2 text "Gutschrift Kunde Zürich".
 *   The pages map a coded font that is not available, so the text is drawn with a substitute and
 *   decoded as EBCDIC 500 (no code page resource): umlauts and ß are written in EBCDIC 500.
 * - TLE "Kunde" = "K4711" on page 1 (EBCDIC 500); TLE "Ort" = "東京都" on page 2 (UTF-16BE,
 *   CCSID 1200) for CJK bigram search.
 * - NOP "Erstellt mit Testgenerator" in ASCII (shown in Windows-1252).
 * - Inline page segment resource S1LOGOXY.
 * `expected.search` lists queries (exact, one and two typos, accents, several words, and words
 * found only outside page text) with the results in rank order.
 *
 * Running this module directly writes us4-search.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, uint, ebcdic, utf16be, triplet, group, resourceGroup, resource, nop, ID } from '../../helpers/afp-builder.js';
import { AMB, AMI, SCFL, cs } from '../../helpers/fixture-text.js';
import { tle, cgcsgid, ccsid, ebcdicCp } from '../../helpers/fixture-meta.js';

const UNITS = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2));
/** Map Coded Font format 2 for a coded font that no file provides. */
const MCF = (() => {
  const rg = bytes(triplet(0x24, 0x05, 1), triplet(0x02, 0x8e, 0x00, ebcdic('X0MISSNG', 8)), triplet(0x26, uint(0, 2)));
  return field('D3AB8A', bytes(uint(rg.length + 2, 2), rg));
})();
const environment = group(ID.BAG, 'AEG1', MCF,
  field(ID.PGD, bytes(UNITS, uint(11906, 3), uint(16838, 3), uint(0, 3))),
  field(ID.PTD, bytes(UNITS, uint(11906, 3), uint(16838, 3), uint(0, 2))));
/** Presentation text with one Transparent Data sequence in EBCDIC 500. */
const text = (name, words) => group(ID.BPT, name, field(ID.PTX, bytes(SCFL(1), AMB(1440), AMI(1440), cs(0xda, ebcdicCp(words, 500)))));

/**
 * Builds the file.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  const page1 = group(ID.BPG, 'PAGE0001', environment, text('PT000001', 'Rechnung für Herrn Müller, Straße 12'),
    tle(ebcdicCp('Kunde', 500), ebcdicCp('K4711', 500), { before: [cgcsgid(500)] }));
  const page2 = group(ID.BPG, 'PAGE0002', environment, text('PT000002', 'Gutschrift Kunde Zürich'),
    tle(utf16be('Ort'), utf16be('東京都'), { before: [ccsid(1200)] }));
  return bytes(
    resourceGroup(resource('S1LOGOXY', 0xfb, group(ID.BPS, 'S1LOGOXY'))),
    group(ID.BDT, 'SEARCH01', nop(new Uint8Array(Buffer.from('Erstellt mit Testgenerator', 'latin1'))), page1, page2));
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us4-search.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us4-search.afp', import.meta.url), buildBytes());
}
