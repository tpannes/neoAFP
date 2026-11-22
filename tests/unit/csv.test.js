/**
 * Resource list CSV (T125, FR-055, contracts/csv-export.md): UTF-8 byte order mark, CRLF line
 * ends, RFC 4180 quoting of commas, quotes and line breaks, the column order name, type, widthMm,
 * heightMm, sizeClass, fileSize, resolution, colorProfile, encoding, source; millimeters with one
 * decimal and a dot; empty cells for missing values; type and size class as translated labels;
 * source "inline: <document file>" or the file's relative path (`source.path`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportResourcesCsv } from '../../src/lib/index.js';

const LABELS = {
  name: 'Name', internalName: 'Internal name', type: 'Type', widthMm: 'Width (mm)', heightMm: 'Height (mm)', sizeClass: 'Size class',
  fileSize: 'File size (bytes)', resolution: 'Resolution (dpi)', colorProfile: 'Color profile', encoding: 'Encoding',
  source: 'Source', 'type.overlay': 'Overlay', 'type.fontCharacterSet': 'Font character set',
  'sizeClass.a4': 'A4', 'sizeClass.notApplicable': 'Not applicable',
};

const RESOURCES = [
  { name: 'O1FORM', type: 'overlay', widthMm: 210, heightMm: 297.04, sizeClass: 'a4', fileSize: 1234, resolution: 300,
    colorProfile: null, encoding: 'IOCA, G4 "MMR"', source: { kind: 'inline', path: 'invoices/doc,1.afp' } },
  { name: 'C0LINE\nX', type: 'fontCharacterSet', widthMm: null, heightMm: null, sizeClass: 'notApplicable', fileSize: 99,
    resolution: null, colorProfile: 'sRGB', encoding: null, internalName: 'C0LINEX', source: { kind: 'folder', path: 'fonts/C0LINE.FON' },
    sources: [{ kind: 'folder', path: 'fonts/C0LINE.FON' }, { kind: 'inline', path: 'a.afp' }] },
];

test('BOM, header, CRLF, quoting, numbers and labels', () => {
  const csv = exportResourcesCsv(RESOURCES, LABELS);
  assert.ok(csv.startsWith('﻿'));
  assert.equal(csv.slice(1), [
    'Name,Internal name,Type,Width (mm),Height (mm),Size class,File size (bytes),Resolution (dpi),Color profile,Encoding,Source',
    'O1FORM,,Overlay,210.0,297.0,A4,1234,300,,"IOCA, G4 ""MMR""","inline: invoices/doc,1.afp"',
    // A combined resource lists all its sources.
    '"C0LINE\nX",C0LINEX,Font character set,,,Not applicable,99,,sRGB,,fonts/C0LINE.FON; inline: a.afp',
  ].join('\r\n') + '\r\n');
});

test('no resources gives only the header', () => {
  assert.equal(exportResourcesCsv([], LABELS), '﻿Name,Internal name,Type,Width (mm),Height (mm),Size class,File size (bytes),Resolution (dpi),Color profile,Encoding,Source\r\n');
});

test('tableCsv: any table, quoted where needed, empty cells for null', async () => {
  const { tableCsv } = await import('../../src/lib/export/csv.js');
  assert.equal(tableCsv(['a', 'b'], [['x,y', null], ['say "hi"', 3]]), '﻿a,b\r\n"x,y",\r\n"say ""hi""",3\r\n');
});
