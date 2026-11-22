/**
 * Synthetic fixture (task T104): structured fields that no other fixture or reference document
 * contains, so that their decoders are covered by committed expectations (field coverage rule,
 * T020). Every field is built from its syntax table in the MO:DCA Reference AFPC-0004-11 or the
 * FOCA Reference AFPC-0006-06; the expected parameter values below repeat the values written
 * here.
 *
 * Print file PRTFILE1:
 * - Presentation Fidelity Control (flags X'80': do not reset to defaults);
 * - document index INDEX001 with an Index Element (FQN X'CA' index element name, FQN X'87' page
 *   name, Object Byte Offset X'2D');
 * - resource group: a coded font X0NEOAF1 (Coded Font Control, one Coded Font Index group) and a
 *   form map F1NEOFRM with an (empty) document environment group DEG00001 and medium map M1NEOMAP (Map Media Type, Map Media Destination, Medium
 *   Finishing Control, Page Modification Control, Medium Modification Control with keywords,
 *   Medium Copy Count, Map Medium Overlay, Page Position format 2);
 * - document FIELDDOC (Universal Date and Time Stamp) with page group GROUP001 (Object Count, a
 *   TLE with Attribute Value and Attribute Qualifier) and page PAGE0001: active environment group
 *   with Map Page Segment, Map Page Overlay, Map Coded Font format 2, Map Data Resource with a
 *   Locale Selector, and Presentation Environment Control (Rendering Intent, Device Appearance);
 *   a Link Logical Element (Area Definition, Parameter Value), an Include Object (presentation
 *   space reset and mixing rules, image resolution, object container presentation space size),
 *   an object container with a Map Container Data, and an Include Page.
 * Triplets are placed on fields that the MO:DCA Reference lists for them ("Structured Fields
 * Using Triplet X'nn'").
 *
 * Running this module directly writes us2-fields.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, uint, ebcdic, utf16be, triplet, group, resourceGroup, resource, ID } from '../../helpers/afp-builder.js';

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
  const index = group(ID.BDI, 'INDEX001',
    field('D3B2A7', bytes(fqn(0xca, 'IEL00001'), fqn(0x87, 'PAGE0001'), triplet(0x2d, uint(400, 4)), triplet(0x57, uint(1200, 4)),
      triplet(0x58, uint(12, 4)), triplet(0x59, uint(30, 4)), triplet(0x56, uint(1, 4)), triplet(0x81, 0x01), triplet(0x83, 0x80))));
  const codedFont = resource('X0NEOAF1', 0x42, group(ID.BCF, 'X0NEOAF1',
    field('D3A78A', bytes(0x19, 0x01)),
    field('D38C8A', bytes(ebcdic('C0NEOAF1', 8), ebcdic('T1NEOAF1', 8), uint(240, 2), uint(0, 2), uint(0, 4), 0x00))));
  const mediumMap = bytes(field('D3A8CC', bytes(ebcdic('M1NEOMAP', 8), triplet(0x45, 0x00, 0x01))),
    field('D3AB88', rg2(new Uint8Array(6), triplet(0x02, 0x11, 0x00, ebcdic('PLAIN')))),
    field('D3ABCD', rg2(triplet(0x02, 0x12, 0x00, ebcdic('BIN2')), triplet(0x22, 0x42, uint(2, 4)))),
    field('D3A088', bytes(0x80, 0x00, 0x01, 0x04, triplet(0x85, 0x04, 0x00, 0x00, 0x00, 2, uint(100, 2), uint(1000, 2), uint(5000, 2)),
      triplet(0x8e, 0x01, 0x00, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x11))),
    field('D3A7AF', bytes(0x05, 0x00, triplet(0x6c, 0xdf, ebcdic('O1NEOOVL', 8), uint(1440, 3), uint(0xffffff & -720, 3), uint(0, 2)))),
    field('D3A788', bytes(0x01, 0xff, 0xe0, 0x01, 0xe1, 0x02, 0xf2, 0x01)),
    field('D3A288', bytes(uint(1, 2), uint(2, 2), 0x00, 0x01, uint(3, 2), uint(3, 2), 0x00, 0x01)),
    field('D3B1DF', bytes(0x0c, 0, 0, 0, 0x01, 0x00, 0, 0, ebcdic('O1NEOOVL', 8))),
    field('D3B1AF', bytes(0x01, 0x0c, uint(0, 3), uint(0, 3), uint(0, 2), 0x00, 0x00, 0xff, 0x0c, uint(1440, 3), uint(720, 3), uint(0x2d00, 2), 0x01, 0x00, 0xff)),
    field('D3A9CC', ebcdic('M1NEOMAP', 8)));
  const formMap = resource('F1NEOFRM', 0xfe, group('D3A8CD', 'F1NEOFRM', group('D3A8C4', 'DEG00001', field('D3A688', bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2), uint(11906, 3), uint(16838, 3), 0x00, triplet(0x68, 0x01)))), mediumMap));
  const container = bytes(field(ID.BOC, ebcdic('OC000001', 8)),
    group('D3A8C7', 'OEG00001', field('D3AB92', rg2(triplet(0x04, 0x20)))),
    field(ID.OCD, bytes(0x00, 0x01, 0x02, 0x03)),
    field(ID.EOC, ebcdic('OC000001', 8)));
  const aeg = group(ID.BAG, 'AEG1',
    field('D3B15F', bytes(0x0c, 0, 0, 0, 0, 0, 0, 0, ebcdic('S1NEOSEG', 8))),
    field('D3ABD8', rg2(fqn(0x84, 'O1NEOOVL'), triplet(0x24, 0x02, 0x01), triplet(0x46, 0x01, 0x05), triplet(0x47, 0xff))),
    field('D3AB8A', rg2(fqn(0x8e, 'C0NEOAF1'), triplet(0x24, 0x05, 0x02), triplet(0x25, 0x00), triplet(0x20, uint(697, 2), uint(500, 2)),
      triplet(0x84, 0x01, 0x00, uint(2400, 2)))),
    field('D3ABC3', rg2(triplet(0x02, 0xde, 0x00, ebcdic('ARIAL')), triplet(0x8c, 0x00, 0x00, utf16be('de'.padEnd(4, '\0')), utf16be('Latn'),
      utf16be('DE'.padEnd(4, '\0')), new Uint8Array(8)))),
    field('D3A7A8', bytes(0x00, 0x00, triplet(0x95, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x00, 0x00), triplet(0x97, 0x00, uint(1, 2), 0x00, 0x00))),
    field(ID.PGD, bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2), uint(11906, 3), uint(16838, 3), uint(0, 3))));
  const page = group(ID.BPG, 'PAGE0001', aeg,
    field('D3B490', bytes(0x01, 0x00, rg2(0x01, triplet(0x4d, 0x00, uint(100, 3), uint(200, 3), uint(1440, 3), uint(720, 3)),
      triplet(0x82, 0x00, 0x02, ebcdic('ABC'))), rg2(0x02, fqn(0x87, 'PAGE0001')))),
    field('D3AFC3', bytes(ebcdic('OC000001', 8), 0x00, 0x92, uint(0, 3), uint(0, 3), uint(0, 2), uint(0x2d00, 2), uint(0, 3), uint(0, 3), 0x01,
      triplet(0x70, 0x80), triplet(0x71, 0x70, 0x01), triplet(0x9a, 0x00, 0x00, 0x00, 0x00, uint(3000, 2), uint(3000, 2)),
      triplet(0x9c, 0x00, 0x00, 0x01, 0x00, 0x00, uint(14400, 2), uint(14400, 2), uint(1440, 3), uint(720, 3)))),
    container,
    field('D3AFAF', bytes(ebcdic('PAGE0002', 8), new Uint8Array(8), 0x00)));
  return group(ID.BPF, 'PRTFILE1',
    field('D3B288', bytes(0x00, 0x80, 0x00, 0x00, triplet(0x74, 0x00, 0x01, 0x00, 0x00), triplet(0x75, 0x01, 0x00, 0x02, 0x00, 0x01, 0x00),
      triplet(0x78, 0x02, 0, 0, 0, 0), triplet(0x86, 0x01, 0x00, 0x02, 0, 0), triplet(0x87, 0x02, 0, 0, 0, 0), triplet(0x88, 0x01, 0x00, 0x01, 0, 0),
      triplet(0x96, 0x02, 0x00, 0x02, 0, 0))),
    index,
    resourceGroup(codedFont, formMap),
    bytes(field(ID.BDT, bytes(ebcdic('FIELDDOC', 8), 0x00, 0x00, triplet(0x72, 0x00, uint(2026, 2), 11, 7, 10, 30, 15, 0x01, 1, 0))),
      field(ID.BNG, bytes(ebcdic('GROUP001', 8), triplet(0x5e, 0xaf, 0x00, uint(1, 4)))),
      field('D3A090', bytes(fqn(0x0b, 'TAG'), triplet(0x36, 0x00, 0x00, ebcdic('VALUE')), triplet(0x80, uint(1, 4), uint(0, 4)))), page,
      field(ID.ENG, ebcdic('GROUP001', 8)),
      field('D3A9A8', ebcdic('FIELDDOC', 8))));
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us2-fields.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us2-fields.afp', import.meta.url), buildBytes());
}
