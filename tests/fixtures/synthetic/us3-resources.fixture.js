/**
 * Synthetic fixture (task T127): a resource group file with one resource of every type, and a
 * second file with a page segment of the same name (duplicate, FR-081).
 *
 * Resource group (file us3-resources.afp):
 * - S1NEOSEG page segment with an IOCA image whose object area is 2 × 1 in (50.8 × 25.4 mm,
 *   size class small; image resolution 240 dpi);
 * - O1NEOOVL overlay with an A4 page descriptor (11906 × 16838 / 1440 in = 210.0 × 297.0 mm, a4);
 * - C0NEOAF1 font character set (the fixture raster font, 240 dpi) and T1NEOAF1 code page;
 * - X0NEOAF1 coded font; F1NEOFRM form definition with one medium map;
 * - I1NEOIMG IOCA image resource, object area 4 × 2 in (101.6 × 50.8 mm, medium), uncompressed;
 * - P1NEOPDF object container with a one-page PDF of 72 × 36 pt (25.4 × 12.7 mm, small);
 * - R1NEOICC object container holding an ICC profile (no registered object type);
 * - C1NEOCMR object container with a Color Conversion CMR (object type OID 1.3.18.0.4.1.1.57)
 *   carrying an ICC profile.
 * Second file (us3-duplicate.psg): page segment S1NEOSEG with a text object only (no area).
 *
 * `EXTRACTED` lists the exact bytes each resource extracts to (the Begin … End object for inline
 * resources, the data for object containers, the whole file for a resource file), from which the
 * expected lengths and SHA-256 hashes are written.
 *
 * Running this module directly writes us3-resources.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, uint, ebcdic, triplet, group, resourceGroup, resource, ID, MAX_FIELD_DATA } from '../../helpers/afp-builder.js';
import { fontCharacterSet, codePage, SCFL, AMB, AMI, TRN } from '../../helpers/fixture-text.js';
import { cmr, iccProfile } from '../../helpers/fixture-meta.js';
import { PDF } from './us1-object-containers.fixture.js';

const UNITS = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2));

/**
 * IOCA image object: object area of w × h page units at (0, 0), 64 × 48 pels at 240 dpi,
 * uncompressed (IOCA FS10).
 * @param {string} name Object name.
 * @param {number} w Area width (1/1440 in).
 * @param {number} h Area height (1/1440 in).
 * @returns {Uint8Array} Begin … End Image Object.
 */
function image(name, w, h) {
  const sdf = (code, ...data) => {
    const d = bytes(...data);
    return code > 0xff ? bytes(0xfe, code & 0xff, uint(d.length, 2), d) : bytes(code, d.length, d);
  };
  const obd = bytes(triplet(0x43, 0x01), triplet(0x4b, 0x00, 0x00, uint(14400, 2), uint(14400, 2)), triplet(0x4c, 0x02, uint(w, 3), uint(h, 3)));
  const obp = bytes(0x01, 23, uint(0, 3), uint(0, 3), uint(0, 2), uint(0x2d00, 2), 0x00, uint(0, 3), uint(0, 3), uint(0, 2), uint(0x2d00, 2), 0x01);
  const segment = bytes(0x70, 0x00, 0x91, 0x01, 0xff, sdf(0x94, 0x00, uint(2400, 2), uint(2400, 2), uint(64, 2), uint(48, 2)),
    sdf(0x95, 0x03, 0x01, 0x00), sdf(0x96, 0x01), sdf(0xfe92, new Uint8Array(8 * 48)), 0x93, 0x00, 0x71, 0x00);
  return group('D3A8FB', name, group('D3A8C7', 'OEG00001', field('D3A66B', obd), field('D3AC6B', obp)),
    field('D3A6FB', bytes(0x00, uint(2400, 2), uint(2400, 2), uint(64, 2), uint(48, 2))), field('D3EEFB', segment));
}

/**
 * Object container with data and an optional Object Classification triplet.
 * @param {string} name Name.
 * @param {Uint8Array} data Data.
 * @param {number|null} component Last component of the registered OID 1.3.18.0.4.1.1.n, or null.
 * @returns {Uint8Array} Begin … End Object Container.
 */
function container(name, data, component) {
  const oc = component === null ? [] : [triplet(0x10, 0x00, 0x40, 0x00, 0x00, uint(0, 2),
    bytes(0x06, 0x07, 0x2b, 0x12, 0x00, 0x04, 0x01, 0x01, component, new Uint8Array(7)))];
  const parts = [];
  for (let pos = 0; pos < data.length; pos += MAX_FIELD_DATA) parts.push(field(ID.OCD, data.subarray(pos, pos + MAX_FIELD_DATA)));
  return bytes(field(ID.BOC, bytes(ebcdic(name, 8), ...oc)), ...parts, field(ID.EOC, ebcdic(name, 8)));
}

export const ICC = iccProfile({ version: 0x04300000, deviceClass: 'mntr', colorSpace: 'RGB ', pcs: 'XYZ ', intent: 0, description: 'neoAFP resource RGB' });
export const CMR_ICC = iccProfile({ version: 0x02100000, deviceClass: 'prtr', colorSpace: 'CMYK', pcs: 'Lab ', intent: 0, description: 'neoAFP CMR CMYK' });
export const CMR = cmr({ CMRAlias: 'NEOCMYK1', CMRType: 'CC', CMRVersion: '001.000', Prop1: 'prtr', Prop4: 'CMYK', Prop5: 'Lab' },
  [{ id: 0x3015, type: 0x05, count: CMR_ICC.length, data: CMR_ICC }]);

const SEGMENT = group(ID.BPS, 'S1NEOSEG', image('IM000001', 2880, 1440));
const OVERLAY = group(ID.BMO, 'O1NEOOVL', group(ID.BAG, 'AEG1',
  field(ID.PGD, bytes(UNITS, uint(11906, 3), uint(16838, 3), uint(0, 3)))));
const FONT = fontCharacterSet(undefined, { bare: true });
const CODE_PAGE_RESOURCE = codePage();
const CODED_FONT = group(ID.BCF, 'X0NEOAF1', field('D3A78A', bytes(0x19, 0x01)),
  field('D38C8A', bytes(ebcdic('C0NEOAF1', 8), ebcdic('T1NEOAF1', 8), uint(240, 2), uint(0, 2), uint(0, 4), 0x00)));
const FORM = group('D3A8CD', 'F1NEOFRM', group('D3A8CC', 'M1NEOMAP', field('D3A788', bytes(0x01, 0xff, 0xe0, 0x01))));
const IMAGE = image('I1NEOIMG', 5760, 2880);
/** The second file: a page segment with only a text object. */
export const DUPLICATE = group(ID.BPS, 'S1NEOSEG', group(ID.BPT, 'PT000001', field(ID.PTX, bytes(SCFL(1), AMB(360), AMI(0), TRN('ABC')))));

/** Exact bytes each resource extracts to, by name. */
export const EXTRACTED = {
  S1NEOSEG: SEGMENT, O1NEOOVL: OVERLAY, C0NEOAF1: FONT, X0NEOAF1: CODED_FONT, F1NEOFRM: FORM, I1NEOIMG: IMAGE,
  P1NEOPDF: PDF, R1NEOICC: ICC, C1NEOCMR: CMR,
};

/**
 * Builds the resource group file.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  // Resource Object Type X'21' values (MO:DCA): page segment X'FB', overlay X'FC', font character
  // set X'40', coded font X'42', form map X'FE', image X'06', object container X'92'. The code page
  // helper wraps its object itself (X'41').
  return resourceGroup(
    resource('S1NEOSEG', 0xfb, SEGMENT),
    resource('O1NEOOVL', 0xfc, OVERLAY),
    resource('C0NEOAF1', 0x40, FONT),
    CODE_PAGE_RESOURCE,
    resource('X0NEOAF1', 0x42, CODED_FONT),
    resource('F1NEOFRM', 0xfe, FORM),
    resource('I1NEOIMG', 0x06, IMAGE),
    resource('P1NEOPDF', 0x92, container('P1NEOPDF', PDF, null)),
    resource('R1NEOICC', 0x92, container('R1NEOICC', ICC, null)),
    resource('C1NEOCMR', 0x92, container('C1NEOCMR', CMR, 0x39)));
}

/**
 * Builds the fixture: the resource group file plus the duplicate page segment file.
 * @returns {Promise<{bytes: Uint8Array, expected: object, extra: {name: string, bytes: Uint8Array}[]}>}
 *   Bytes, expectations and additional files.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us3-resources.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected, extra: [{ name: 'us3-duplicate.psg', bytes: DUPLICATE }] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us3-resources.afp', import.meta.url), buildBytes());
}
