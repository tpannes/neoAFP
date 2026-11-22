/**
 * Names and specification references of the structured fields neoAFP knows.
 *
 * Covers MO:DCA-P documents, resources and form definitions, FOCA fonts and code pages, and IM
 * image objects. Specification references name the defining document and the structured
 * field's title, under which it is listed in that document. Parameter decoders are added by the
 * format modules per user story (tasks T056, T104).
 *
 * Identifiers not listed here are reported as "unknown field" (diagnostic `unknownField`) and
 * shown as raw bytes, never guessed (Principle I).
 *
 * Retired structured fields (MO:DCA Reference, retired structured fields) are listed by name so
 * they are not reported as unknown: older generators still write them, and receivers ignore
 * them. They have no parameter decoder (shown as raw bytes) and no effect on the output.
 * Found in the test sets: CTC in 150 files (always X'00000000 00000000 2D00'), the Form
 * Environment Group BFG/FGD/EFG in 25 documents.
 */

import { fieldRegistry } from './index.js';

const MODCA = 'MO:DCA Reference (AFPC-0004)';
const FOCA = 'FOCA Reference (Font Object Content Architecture)';
const IM = 'MO:DCA Reference (AFPC-0004), appendix "IM Image Object"';
const PAGEDEF = 'AFP Line Data Reference (page definitions)';
const RETIRED = 'MO:DCA Reference (AFPC-0004), retired structured fields';

/** [identifier, short name, full name, defining document]. */
const FIELDS = [
  // Print file, documents, page groups, pages
  ['D3A8A5', 'BPF', 'Begin Print File', MODCA], ['D3A9A5', 'EPF', 'End Print File', MODCA],
  ['D3A8A8', 'BDT', 'Begin Document', MODCA], ['D3A9A8', 'EDT', 'End Document', MODCA],
  ['D3A8AD', 'BNG', 'Begin Named Page Group', MODCA], ['D3A9AD', 'ENG', 'End Named Page Group', MODCA],
  ['D3A8AF', 'BPG', 'Begin Page', MODCA], ['D3A9AF', 'EPG', 'End Page', MODCA],
  ['D3A8C9', 'BAG', 'Begin Active Environment Group', MODCA], ['D3A9C9', 'EAG', 'End Active Environment Group', MODCA],
  ['D3A8C7', 'BOG', 'Begin Object Environment Group', MODCA], ['D3A9C7', 'EOG', 'End Object Environment Group', MODCA],
  ['D3A8C4', 'BDG', 'Begin Document Environment Group', MODCA], ['D3A9C4', 'EDG', 'End Document Environment Group', MODCA],
  ['D3A8A7', 'BDI', 'Begin Document Index', MODCA], ['D3A9A7', 'EDI', 'End Document Index', MODCA],
  ['D3B2A7', 'IEL', 'Index Element', MODCA], ['D3B490', 'LLE', 'Link Logical Element', MODCA],
  ['D3A090', 'TLE', 'Tag Logical Element', MODCA], ['D3EEEE', 'NOP', 'No Operation', MODCA],
  ['D3A7A8', 'PEC', 'Presentation Environment Control', MODCA],
  ['D3B288', 'PFC', 'Presentation Fidelity Control', MODCA],
  // Resources
  ['D3A8C6', 'BRG', 'Begin Resource Group', MODCA], ['D3A9C6', 'ERG', 'End Resource Group', MODCA],
  ['D3A8CE', 'BRS', 'Begin Resource', MODCA], ['D3A9CE', 'ERS', 'End Resource', MODCA],
  ['D3A85F', 'BPS', 'Begin Page Segment', MODCA], ['D3A95F', 'EPS', 'End Page Segment', MODCA],
  ['D3A8DF', 'BMO', 'Begin Overlay', MODCA], ['D3A9DF', 'EMO', 'End Overlay', MODCA],
  ['D3A877', 'BCA', 'Begin Color Attribute Table', MODCA], ['D3A977', 'ECA', 'End Color Attribute Table', MODCA],
  ['D3B077', 'CAT', 'Color Attribute Table', MODCA],
  // Page descriptors, maps and includes
  ['D3A6AF', 'PGD', 'Page Descriptor', MODCA],
  ['D3A69B', 'PTD', 'Presentation Text Data Descriptor (format 1)', MODCA],
  ['D3B19B', 'PTD', 'Presentation Text Data Descriptor (format 2)', MODCA],
  ['D3B18A', 'MCF', 'Map Coded Font (format 1)', MODCA], ['D3AB8A', 'MCF', 'Map Coded Font (format 2)', MODCA],
  ['D3ABC3', 'MDR', 'Map Data Resource', MODCA], ['D3ABD8', 'MPO', 'Map Page Overlay', MODCA],
  ['D3B15F', 'MPS', 'Map Page Segment', MODCA], ['D3ABFB', 'MIO', 'Map Image Object', MODCA],
  ['D3ABBB', 'MGO', 'Map Graphics Object', MODCA], ['D3ABEB', 'MBC', 'Map Bar Code Object', MODCA],
  ['D3AB92', 'MCD', 'Map Container Data', MODCA], ['D3AB77', 'MCA', 'Map Color Attribute Table', MODCA],
  ['D3AF5F', 'IPS', 'Include Page Segment', MODCA], ['D3AFD8', 'IPO', 'Include Page Overlay', MODCA],
  ['D3AFC3', 'IOB', 'Include Object', MODCA], ['D3AFAF', 'IPG', 'Include Page', MODCA],
  ['D3ABCC', 'IMM', 'Invoke Medium Map', MODCA],
  ['D3A66B', 'OBD', 'Object Area Descriptor', MODCA], ['D3AC6B', 'OBP', 'Object Area Position', MODCA],
  // Presentation text
  ['D3A89B', 'BPT', 'Begin Presentation Text Object', MODCA], ['D3A99B', 'EPT', 'End Presentation Text Object', MODCA],
  ['D3EE9B', 'PTX', 'Presentation Text Data', MODCA],
  ['D3A79B', 'CTC', 'Composed Text Control', RETIRED],
  // Image (IOCA)
  ['D3A8FB', 'BIM', 'Begin Image Object', MODCA], ['D3A9FB', 'EIM', 'End Image Object', MODCA],
  ['D3A6FB', 'IDD', 'Image Data Descriptor', MODCA], ['D3EEFB', 'IPD', 'Image Picture Data', MODCA],
  // IM image
  ['D3A87B', 'BII', 'Begin IM Image', IM], ['D3A97B', 'EII', 'End IM Image', IM],
  ['D3A77B', 'IOC', 'IM Image Output Control', IM], ['D3A67B', 'IID', 'IM Image Input Descriptor', IM],
  ['D3AC7B', 'ICP', 'IM Image Cell Position', IM], ['D3EE7B', 'IRD', 'IM Image Raster Data', IM],
  // Graphics (GOCA)
  ['D3A8BB', 'BGR', 'Begin Graphics Object', MODCA], ['D3A9BB', 'EGR', 'End Graphics Object', MODCA],
  ['D3A6BB', 'GDD', 'Graphics Data Descriptor', MODCA], ['D3EEBB', 'GAD', 'Graphics Data', MODCA],
  // Bar code (BCOCA)
  ['D3A8EB', 'BBC', 'Begin Bar Code Object', MODCA], ['D3A9EB', 'EBC', 'End Bar Code Object', MODCA],
  ['D3A6EB', 'BDD', 'Bar Code Data Descriptor', MODCA], ['D3EEEB', 'BDA', 'Bar Code Data', MODCA],
  // Object containers
  ['D3A892', 'BOC', 'Begin Object Container', MODCA], ['D3A992', 'EOC', 'End Object Container', MODCA],
  ['D3EE92', 'OCD', 'Object Container Data', MODCA],
  ['D3A692', 'CDD', 'Container Data Descriptor', MODCA],
  // Form definitions and medium maps
  ['D3A8CD', 'BFM', 'Begin Form Map', MODCA], ['D3A9CD', 'EFM', 'End Form Map', MODCA],
  ['D3A8CC', 'BMM', 'Begin Medium Map', MODCA], ['D3A9CC', 'EMM', 'End Medium Map', MODCA],
  ['D3A688', 'MDD', 'Medium Descriptor', MODCA], ['D3A288', 'MCC', 'Medium Copy Count', MODCA],
  ['D3A788', 'MMC', 'Medium Modification Control', MODCA], ['D3B1DF', 'MMO', 'Map Medium Overlay', MODCA],
  ['D3AB88', 'MMT', 'Map Media Type', MODCA], ['D3ABEA', 'MSU', 'Map Suppression', MODCA], ['D3ABCD', 'MMD', 'Map Media Destination', MODCA],
  ['D3A088', 'MFC', 'Medium Finishing Control', MODCA],
  ['D3ACAF', 'PGP', 'Page Position (format 1)', MODCA], ['D3B1AF', 'PGP', 'Page Position (format 2)', MODCA],
  ['D3A7AF', 'PMC', 'Page Modification Control', MODCA],
  ['D3A8C5', 'BFG', 'Begin Form Environment Group', RETIRED], ['D3A9C5', 'EFG', 'End Form Environment Group', RETIRED],
  ['D3A6C5', 'FGD', 'Form Environment Group Descriptor', RETIRED],
  // Fonts (FOCA)
  ['D3A889', 'BFN', 'Begin Font', FOCA], ['D3A989', 'EFN', 'End Font', FOCA],
  ['D3A689', 'FND', 'Font Descriptor', FOCA], ['D3A789', 'FNC', 'Font Control', FOCA],
  ['D3A289', 'FNM', 'Font Patterns Map', FOCA], ['D3AE89', 'FNO', 'Font Orientation', FOCA],
  ['D3AC89', 'FNP', 'Font Position', FOCA], ['D38C89', 'FNI', 'Font Index', FOCA],
  ['D3AB89', 'FNN', 'Font Name Map', FOCA], ['D3EE89', 'FNG', 'Font Patterns', FOCA],
  ['D3A887', 'BCP', 'Begin Code Page', FOCA], ['D3A987', 'ECP', 'End Code Page', FOCA],
  ['D3A687', 'CPD', 'Code Page Descriptor', FOCA], ['D3A787', 'CPC', 'Code Page Control', FOCA],
  ['D38C87', 'CPI', 'Code Page Index', FOCA],
  ['D3A88A', 'BCF', 'Begin Coded Font', FOCA], ['D3A98A', 'ECF', 'End Coded Font', FOCA],
  ['D3A78A', 'CFC', 'Coded Font Control', FOCA], ['D38C8A', 'CFI', 'Coded Font Index', FOCA],
  // Page definitions (recognized only to report them as unsupported)
  ['D3A8CB', 'BPM', 'Begin Page Map', PAGEDEF], ['D3A9CB', 'EPM', 'End Page Map', PAGEDEF],
  ['D3A8CA', 'BDM', 'Begin Data Map', PAGEDEF], ['D3A9CA', 'EDM', 'End Data Map', PAGEDEF],
];

fieldRegistry.register(FIELDS.map(([hex, shortName, fullName, doc]) => ({
  id: parseInt(hex, 16),
  shortName,
  fullName,
  specRef: `${doc}, "${fullName}" (${shortName}, X'${hex}')`,
})));

/** Number of known structured field types (for tests and reports). */
export const FIELD_COUNT = FIELDS.length;
