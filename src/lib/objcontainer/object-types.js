/**
 * Registered object type OIDs neoAFP interprets (MO:DCA Reference AFPC-0004-11, Table 47
 * "Registered Object Types Sorted by Component ID"). Other containers are recognized from their
 * data (PDF, JPEG, PNG, GIF, TIFF signatures).
 */

import { specTable } from '../spec-table.js';

export const OID_TRUETYPE = '1.3.18.0.4.1.1.51';
export const OID_TRUETYPE_COLLECTION = '1.3.18.0.4.1.1.53';
export const OID_CMR = '1.3.18.0.4.1.1.57';
export const OID_METADATA = '1.3.18.0.4.1.1.67';

/** The OIDs with their names and references. */
export const OBJECT_TYPE_TABLE = specTable('MO:DCA Reference (AFPC-0004-11)', 'Table 47 "Registered Object Types"', [
  [OID_TRUETYPE, '', 'TrueType/OpenType Font'],
  [OID_TRUETYPE_COLLECTION, '', 'TrueType/OpenType Font Collection'],
  [OID_CMR, 'CMR', 'Color Management Resource'],
  [OID_METADATA, 'MO', 'Metadata Object'],
]);

/**
 * Tells whether an object type OID is a TrueType/OpenType font or font collection.
 * @param {string|null|undefined} oid OID.
 * @returns {boolean} True for fonts.
 */
export const isFontOid = (oid) => oid === OID_TRUETYPE || oid === OID_TRUETYPE_COLLECTION;
