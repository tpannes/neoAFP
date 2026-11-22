/**
 * Details panel data (T259, FR-096/FR-097): file statistics (sheets with copies, medium map
 * changes, page sizes and orientations, color, resources used by origin), page details (copies
 * and finishing of the medium map, content beyond the page edges, byte range for the page's
 * messages), the Medium Finishing Control reader and the bounds checks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { bytes, field, group, ebcdic, uint, triplet, environmentGroup, documentOf, ID } from '../helpers/afp-builder.js';
import { AMI, AMB, TRN, STC, mapCodedFont } from '../helpers/fixture-text.js';
import { readFinishing, copiesOf } from '../../src/lib/formdef/formdef.js';
import { pageOverflow, placementOverflow } from '../../src/lib/render/content-bounds.js';
import { isColor, formatName } from '../../src/lib/meta/file-stats.js';

/** Medium Finishing Control: flags, reserved, media collection, scope, then a Finishing Operation. */
const MFC = bytes(0x00, 0x00, 0x00, 0x02, triplet(0x85, 0x01, 0x00, 0x00, 0x02, 0x02, uint(0, 2)));

/** Form definition: medium map M1 with two copy groups (copy 1, copies 2–3) and corner stapling. */
const FORM = group(ID.BFM, 'F1DETAIL', group('D3A8CC', 'M1',
  field('D3A288', bytes(uint(1, 2), uint(1, 2), 0x00, 0x01, uint(2, 2), uint(3, 2), 0x00, 0x01)),
  field('D3A788', bytes(0x01, 0x00, 0xf4, 0x01)),
  field('D3A088', MFC)));

/**
 * Builds a page with text.
 * @param {string} name Page name.
 * @param {number} width Width (1/1440 in).
 * @param {number} height Height.
 * @param {Uint8Array} text Presentation text control sequences.
 * @param {...Uint8Array} more Further fields.
 * @returns {Uint8Array} Page.
 */
const textPage = (name, width, height, text, ...more) => group(ID.BPG, name, environmentGroup(width, height, mapCodedFont()),
  group(ID.BPT, 'PT000001', field(ID.PTX, text)), ...more);

const DOC = documentOf('D1DETAIL',
  field('D3ABCC', ebcdic('M1', 8)),
  textPage('P1', 11906, 16838, bytes(AMB(1440), AMI(1440), STC(0x0001), TRN('BLUE'))),
  textPage('P2', 16838, 11906, bytes(AMB(1440), AMI(16000), TRN('OVERFLOWING TEXT')),
    field('D3AF5F', bytes(ebcdic('S1MISSNG', 8), uint(0, 3), uint(0, 3)))));

/**
 * Opens the form definition and the document.
 * @returns {Promise<{ws: object, id: string}>} Workspace and document id.
 */
async function open() {
  const ws = createWorkspace();
  await ws.addFiles([createBufferSource(FORM, 'F1DETAIL.FDF'), createBufferSource(DOC, 'detail.afp')], 'file');
  return { ws, id: ws.listDocuments()[0].id };
}

test('Medium Finishing Control: operation, reference edge and count', () => {
  assert.deepEqual(readFinishing(MFC), [{ operation: 'cornerStaple', edge: 'top', count: 2 }]);
  assert.deepEqual(readFinishing(bytes(0, 0, 0, 0, triplet(0x85, 0x7f, 0, 0, 0x03, 0))), [{ operation: "X'7F'", edge: 'left', count: 0 }]);
});

test('file statistics: sheets with copies, medium maps, page sizes, color, resources', async () => {
  const { ws, id } = await open();
  const s = await ws.getFileStatistics(id);
  assert.equal(s.sheets, 2);
  assert.equal(s.printedSheets, 6, 'three copies of each sheet (all copy groups)');
  assert.equal(s.mediumMaps.invocations, 1);
  assert.deepEqual(s.mediumMaps.used, [{ name: 'M1', pages: 2, sheets: 2 }]);
  assert.deepEqual(s.pageSizes.map((z) => [z.format, z.orientation, z.pages]), [['A4', 'portrait', 1], ['A4', 'landscape', 1]]);
  assert.deepEqual(s.color, { colored: true, sources: ['text'], models: ['oca'] });
  assert.equal(s.resources.pageSegments.missing, 1);
  assert.equal(s.resources.fonts.missing, 1);
  assert.deepEqual(s.resources.overlays, { inline: 0, external: 0, missing: 0 });
});

test('page details: copies, finishing, content beyond the edge, byte range', async () => {
  const { ws, id } = await open();
  const p1 = await ws.getPageDetails(id, 1);
  assert.equal(p1.copies, 3);
  assert.deepEqual(p1.finishing, [{ operation: 'cornerStaple', edge: 'top', count: 2 }]);
  assert.equal(p1.overflow, null);
  assert.equal(p1.placement, null, 'one page per side: no N-up position');
  const p2 = await ws.getPageDetails(id, 2);
  assert.deepEqual(p2.overflow.kinds, ['text']);
  assert.ok(p2.overflow.right > 0 && p2.overflow.left === 0);
  assert.ok(p2.byteRange[0] > p1.byteRange[1] - 1 && p2.byteRange[1] > p2.byteRange[0]);
});

test('bounds: a frame on the page edge fits, content beyond it does not', () => {
  const frame = [[0, 54, 11906, 54], [54, 0, 54, 16838]].map(([x1, y1, x2, y2]) => ({ type: 'rule', x1, y1, x2, y2, thickness: 108 }));
  assert.equal(pageOverflow({ widthUnits: 11906, heightUnits: 16838, items: frame }), null);
  const out = pageOverflow({ widthUnits: 11906, heightUnits: 16838, items: [
    { type: 'image', rect: { x: -720, y: 100, width: 2000, height: 2000 } },
    { type: 'rule', x1: 100, y1: 17000, x2: 900, y2: 17000, thickness: 20 },
  ] });
  assert.deepEqual(out.kinds, ['image', 'line']);
  assert.equal(out.left, 720);
  assert.equal(out.bottom, 17010 - 16838);
  assert.deepEqual(placementOverflow({ x: 8419, y: 0, rotation: 0 }, { width: 8419, height: 11906 }, { width: 16838, height: 11906 }), null);
  assert.equal(placementOverflow({ x: 9000, y: 0, rotation: 0 }, { width: 8419, height: 11906 }, { width: 16838, height: 11906 }).right, 581);
  // A landscape page turned by 90° onto portrait paper: its origin at the right edge, it reaches to the left.
  assert.equal(placementOverflow({ x: 11906, y: 0, rotation: 90 }, { width: 16838, height: 11906 }, { width: 11906, height: 16838 }), null);
  assert.equal(placementOverflow({ x: 9000, y: 0, rotation: 90 }, { width: 16838, height: 11906 }, { width: 11906, height: 16838 }).left, 2906);
});

test('colors and paper formats', () => {
  assert.equal(isColor('#000000'), false);
  assert.equal(isColor('#808080'), false);
  assert.equal(isColor('#0000ff'), true);
  assert.equal(formatName(210, 297), 'A4');
  assert.equal(formatName(297.5, 210), 'A4');
  assert.equal(formatName(215.9, 279.4), 'Letter');
  assert.equal(formatName(143, 203), null);
});

test('copies: simplex counts every copy subgroup, duplex one per front/back pair', () => {
  assert.equal(copiesOf([1, 2], 'simplex'), 3);
  // Duplex (1–1, 2–2) is one duplex copy, not two.
  assert.equal(copiesOf([1, 1], 'normal'), 1);
  // Ten subgroups of one copy, duplex = five copies.
  assert.equal(copiesOf(Array(10).fill(1), 'normal'), 5);
  assert.equal(copiesOf([3, 3, 1], 'tumble'), 4);
  assert.equal(copiesOf([], 'simplex'), 1);
});
