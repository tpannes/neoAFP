/**
 * Synthetic fixture (task T098): document structure with Tag Logical Elements and NOPs.
 *
 * Document STRUCDOC (Begin Document with a CGCSGID triplet for code page 037):
 * - two NOPs at document level: text "NEOAFP FIXTURE 1" and binary bytes;
 * - page group GROUP001 with two TLEs — one in code page 273 (German characters), one in 500 —,
 *   then page PAGE0001 (a TLE with attribute qualifier after the active environment group, and a
 *   structured field with an unregistered identifier), then the nested page group GROUP002:
 *   a TLE with an unregistered triplet X'FE' and page PAGE0002 with a TLE without CGCSGID,
 *   which takes code page 037 from the Begin Document (MO:DCA, TLE semantics: "If not present,
 *   the including object specifies the code page").
 *
 * TLE owners (MO:DCA, TLE): embedded in a page after the active environment group → page;
 * embedded in a page group after Begin Named Page Group → page group.
 * NOP data is undefined (UNDF), so NOPs have no file code page; without an override they are
 * shown in EBCDIC 500 (the default), so their text uses only characters that 037 and 500 share.
 * The expected values below are written by hand from the encodings; offsets come from
 * listFields of the built bytes.
 *
 * Running this module directly writes us2-structure.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, ebcdic, triplet, group, environmentGroup, nop, ID } from '../../helpers/afp-builder.js';
import { tle, cgcsgid, ebcdicCp } from '../../helpers/fixture-meta.js';

/** An identifier that no AFP architecture registers (used to check the unknownField diagnostic). */
export const UNKNOWN_FIELD = 'D3EEFE';

/**
 * Builds the file.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  const page1 = group(ID.BPG, 'PAGE0001', environmentGroup(),
    tle(ebcdicCp('PAGETAG', 500), ebcdicCp('P1 [X]', 500), { before: [cgcsgid(500)], qualifier: [1, 2] }),
    field(UNKNOWN_FIELD, bytes(0x01, 0x02, 0x03)));
  const page2 = group(ID.BPG, 'PAGE0002', environmentGroup(),
    tle(ebcdicCp('LANG', 37), ebcdicCp('EN!', 37)));
  const group2 = group(ID.BNG, 'GROUP002',
    tle(ebcdicCp('REGION', 500), ebcdicCp('NORD', 500), { before: [cgcsgid(500)], extra: [triplet(0xfe, 0x12, 0x34)] }),
    page2);
  const group1 = group(ID.BNG, 'GROUP001',
    tle(ebcdicCp('Straße', 273), ebcdicCp('Größe Ä!', 273), { before: [cgcsgid(273)] }),
    tle(ebcdicCp('ACCOUNT', 500), ebcdicCp('A-100 [7]', 500), { before: [cgcsgid(500)] }),
    page1, group2);
  const bdt = bytes(field(ID.BDT, bytes(ebcdic('STRUCDOC', 8), 0x00, 0x00, cgcsgid(37))));
  return bytes(bdt,
    nop('NEOAFP FIXTURE 1'),
    nop(bytes(0x00, 0x01, 0xc1, 0xff, 0x0d, 0x25, 0xc2)),
    group1,
    field(ID.EDT, ebcdic('STRUCDOC', 8)));
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us2-structure.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us2-structure.afp', import.meta.url), buildBytes());
}
