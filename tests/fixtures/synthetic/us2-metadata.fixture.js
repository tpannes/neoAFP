/**
 * Synthetic fixture (task T099): XMP metadata, a Color Management Resource with an ICC profile,
 * and an image resource with an embedded ICC profile.
 *
 * - Inline resource group:
 *   - C1NEOCMR: object container with object type CMR (OID 1.3.18.0.4.1.1.57, object class
 *     X'40' secondary resource) holding a Color Conversion CMR (CMOCA) with the tags ICC Profile
 *     Subset, ICC Profile Data (an ICC v4.3 display profile, description in 'mluc') and ICC
 *     Profile Filename;
 *   - J1NEOICC: object container with an AFPC JPEG Subset image (8 × 8 pels) carrying an ICC v2.1
 *     profile in an APP2 "ICC_PROFILE" segment (description in 'desc').
 * - Document METADOC1:
 *   - after Begin Document, a Metadata Object (object class X'50', OID 1.3.18.0.4.1.1.67) with
 *     uncompressed XMP: document-level metadata (MO:DCA, "Metadata Objects in AFP");
 *   - page PAGE0001: its active environment group maps the CMR with a Map Data Resource (CMR name
 *     in an FQN type X'DE' triplet, UTF-16BE given by a CCSID 1200 triplet, CMR Descriptor X'91':
 *     instruction CMR, scope page); after the environment group, a second Metadata Object with
 *     GZIP-compressed XMP: page-level metadata.
 *
 * Expected values are written from the specifications (see tests/helpers/fixture-meta.js).
 *
 * Running this module directly writes us2-metadata.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { bytes, field, uint, ebcdic, utf16be, triplet, group, environmentGroup, resourceGroup, resource, MAX_FIELD_DATA, ID } from '../../helpers/afp-builder.js';
import { ccsid, cmr, cmrName, iccProfile, metadataObject, jpegWithIcc } from '../../helpers/fixture-meta.js';

/** Header values of the CMR (CMOCA Table 4; Prop1 device class, Prop4 color space, Prop5 PCS). */
export const CMR_VALUES = { CMRAlias: 'NEOSRGB1', CMRType: 'CC', CMRVersion: '001.000', ManufacturerName: 'NEOAF', Prop1: 'mntr', Prop4: 'RGB', Prop5: 'XYZ' };

export const DOCUMENT_XMP = `<?xpacket begin="\u{feff}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmp:CreatorTool="neoAFP fixture">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Metadata fixture</rdf:li></rdf:Alt></dc:title>
   <dc:subject><rdf:Bag><rdf:li>afp</rdf:li><rdf:li>xmp</rdf:li></rdf:Bag></dc:subject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

export const PAGE_XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:description>Page one</dc:description></rdf:Description>
</rdf:RDF></x:xmpmeta>`;

/** An 8 × 8 JPEG made with Pillow (plain red). */
const JPEG = new Uint8Array(Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDLoooriPpj/9k=',
  'base64'));

/**
 * Object Classification triplet X'10' with a registered object type OID (DER, 16 bytes).
 * @param {number} objClass Object class (X'01' presentation, X'40' secondary resource, X'50' metadata).
 * @param {number} component Last OID component (1.3.18.0.4.1.1.n).
 * @returns {Uint8Array} Triplet.
 */
const objectClass = (objClass, component) =>
  triplet(0x10, 0x00, objClass, 0x00, 0x00, uint(0, 2), bytes(0x06, 0x07, 0x2b, 0x12, 0x00, 0x04, 0x01, 0x01, component, new Uint8Array(7)));

/**
 * Builds an object container (Begin with name and triplets from offset 8, MO:DCA "BOC Syntax";
 * data split over Object Container Data fields).
 * @param {string} name Name.
 * @param {Uint8Array} data Data.
 * @param {Uint8Array} oc Object Classification triplet.
 * @returns {Uint8Array} Begin … End Object Container.
 */
function container(name, data, oc) {
  const parts = [];
  for (let pos = 0; pos < data.length; pos += MAX_FIELD_DATA) parts.push(field(ID.OCD, data.subarray(pos, pos + MAX_FIELD_DATA)));
  return bytes(field(ID.BOC, bytes(ebcdic(name, 8), oc)), ...parts, field(ID.EOC, ebcdic(name, 8)));
}

/** The ICC profile inside the CMR. */
export const CMR_PROFILE = iccProfile({ version: 0x04300000, deviceClass: 'mntr', colorSpace: 'RGB ', pcs: 'XYZ ', intent: 0, description: 'neoAFP sRGB test' });
/** The ICC profile inside the JPEG. */
export const JPEG_PROFILE = iccProfile({ version: 0x02100000, deviceClass: 'prtr', colorSpace: 'CMYK', pcs: 'Lab ', intent: 1, description: 'neoAFP CMYK test' });

/**
 * Builds the file.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  const filename = new Uint8Array(Buffer.from('neoafp-srgb.icc', 'latin1'));
  const cmrBytes = cmr(CMR_VALUES, [
    { id: 0x3011, type: 0x08, count: 1, data: bytes(0x05) }, // subset X'05': three-component matrix-based display
    { id: 0x3015, type: 0x05, count: CMR_PROFILE.length, data: CMR_PROFILE },
    { id: 0x3025, type: 0x06, count: filename.length, data: filename },
  ]);
  const resources = resourceGroup(
    resource('C1NEOCMR', 0x92, container('C1NEOCMR', cmrBytes, objectClass(0x40, 0x39))),
    resource('J1NEOICC', 0x92, container('J1NEOICC', jpegWithIcc(JPEG, JPEG_PROFILE), objectClass(0x01, 0x17))));
  const name = utf16be(cmrName(CMR_VALUES));
  const mdrGroup = bytes(ccsid(1200), triplet(0x02, 0xde, 0x00, name), triplet(0x91, 0x00, 0x02, 0x02));
  const mdr = field('D3ABC3', bytes(uint(mdrGroup.length + 2, 2), mdrGroup));
  const page = group(ID.BPG, 'PAGE0001', environmentGroup(11906, 16838, mdr),
    container('M2NEOXMP', metadataObject(null, { name: 'Page info', compression: 'GZIP', data: new Uint8Array(gzipSync(Buffer.from(PAGE_XMP, 'utf8'))) }), objectClass(0x50, 0x43)));
  return bytes(resources, group(ID.BDT, 'METADOC1',
    container('M1NEOXMP', metadataObject(DOCUMENT_XMP, { name: 'Document info' }), objectClass(0x50, 0x43)),
    page));
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us2-metadata.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us2-metadata.afp', import.meta.url), buildBytes());
}
