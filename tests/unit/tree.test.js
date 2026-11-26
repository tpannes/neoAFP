/**
 * Field tree (T102, T194, FR-030, FR-034): every structured field in file order, built lazily;
 * Begin fields are branches with their own triplets first, then the fields inside, then their
 * End field; other fields with triplets hold their triplets; each node has a kind for its icon
 * and its page. locate() maps a field inside a page to that page and to the object a render item
 * points to (sourceField). Checked on synthetic fixtures whose structure is known.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';

/**
 * Loads a fixture into a workspace.
 * @param {string} name Fixture name.
 * @returns {Promise<{ws: object, id: string}>} Workspace and file id.
 */
async function load(name) {
  const { buildBytes } = await import(`../fixtures/synthetic/${name}.fixture.js`);
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(buildBytes(), `${name}.afp`)], 'file');
  return { ws, id: file.id };
}

/**
 * Shortens tree nodes to "id kind name label +" (+ when the node has children, then the page).
 * @param {object[]} nodes Nodes.
 * @returns {string[]} Short forms.
 */
const brief = (nodes) => nodes.map((n) => [n.id, n.kind, n.shortName ?? n.code, n.label, n.hasChildren ? '+' : '-', n.pageNumber ?? ''].join(' ').trim());

test('document → page groups → pages: triplets first, then inner fields, then the End field', async () => {
  const { ws, id } = await load('us2-structure');
  assert.deepEqual(brief(await ws.getTree(id)), ['0 document BDT STRUCDOC +']);
  assert.deepEqual(brief(await ws.getTree(id, '0')), [
    '0.0 triplet 01  -', '1 nop NOP  -', '2 nop NOP  -', '3 pageGroup BNG GROUP001 +', '25 end EDT STRUCDOC -',
  ]);
  assert.deepEqual(brief(await ws.getTree(id, '6')), [
    '7 environmentGroup BAG AEG1 + 1', '11 tle TLE  + 1', '12 data D3EEFE  - 1', '13 end EPG PAGE0001 - 1',
  ]);
  assert.deepEqual(brief(await ws.getTree(id, '7')), ['8 descriptor PGD  - 1', '9 migration PTD  - 1', '10 end EAG AEG1 - 1']);
  const triplets = await ws.getTree(id, '11');
  assert.deepEqual(triplets.map((t) => t.code), ['01', '02', '36', '80']);
  // Triplet offsets point into the file: the first triplet starts right after the TLE's header.
  const tle = (await ws.getTree(id, '6')).find((n) => n.id === '11');
  assert.equal(triplets[0].offset, tle.offset + 9);
  assert.equal(triplets.reduce((n, t) => n + t.length, 0), tle.length - 9);
});

test('resources, font fields, maps and includes get their own kinds', async () => {
  const { ws, id } = await load('us1-overlay-segment');
  assert.deepEqual(brief(await ws.getTree(id)), ['0 resourceGroup BRG RESGRP +', '39 document BDT OVLSEG01 +']);
  assert.deepEqual(brief(await ws.getTree(id, '1')), ['1.0 triplet 21  -', '2 fontCharacterSet BFN C0NEOAF1 +', '11 end ERS C0NEOAF1 -']);
  assert.deepEqual((await ws.getTree(id, '2')).map((n) => n.kind), Array(7).fill('fontData').concat('end'));
  assert.deepEqual(brief(await ws.getTree(id, '40')), [
    '41 environmentGroup BAG AEG1 + 1', '46 text BPT PT000001 + 1', '49 includeSegment IPS S1NEOSEG - 1',
    '50 includeOverlay IPO O1NEOOVL - 1', '51 end EPG PAGE0001 - 1',
  ]);
  assert.deepEqual(brief(await ws.getTree(id, '41')).slice(0, 1), ['42 map MCF  + 1']);
});

test('locate: a field in a page gives the page and the page-level object', async () => {
  const { ws, id } = await load('us1-overlay-segment');
  // PTX inside BPT: the object, and the PTX itself, whose own glyph runs alone are its text.
  assert.deepEqual(await ws.locate(id, 47), { pageNumber: 1, sourceField: 46, textField: 47, dataField: null });
  assert.deepEqual(await ws.locate(id, 50), { pageNumber: 1, sourceField: 50, textField: null, dataField: null }); // IPO itself
  assert.deepEqual(await ws.locate(id, 40), { pageNumber: 1, sourceField: null, textField: null, dataField: null }); // Begin Page
  assert.deepEqual(await ws.locate(id, 22), { pageNumber: null, sourceField: null, textField: null, dataField: null }); // inside a resource
  // The text item of page 1 points to the located object and to its PTX field.
  const model = await ws.getRenderModel(id, 1);
  assert.ok(model.items.some((i) => i.sourceField === 46 && i.textField === 47));
  // An End field means the object of its Begin field (EPT 48 closes BPT 46).
  assert.deepEqual(await ws.locate(id, 48), { pageNumber: 1, sourceField: 46, textField: null, dataField: null });
});

test('marking: graphics by their GAD field, included items by the include, never by a bare row of another file', async () => {
  const { marked } = await import('../../src/lib/render/highlight.js');
  const { ws, id } = await load('us1-graphics');
  assert.deepEqual(await ws.locate(id, 13), { pageNumber: 1, sourceField: 6, textField: null, dataField: 13 });
  const items = (await ws.getRenderModel(id, 1)).items;
  assert.ok(items.length && items.every((i) => i.dataField === 13 && marked(i, new Set([13]), id)));
  // Included items: by the document's include field (via), not by their own rows.
  const included = { sourceField: 21, fileId: 'res', via: [{ fileId: 'doc', row: 49 }] };
  assert.equal(marked(included, new Set([49]), 'doc'), true);
  assert.equal(marked(included, new Set([21]), 'doc'), false);
  // An item of another file whose row number happens to be marked in the document.
  assert.equal(marked({ sourceField: 7, fileId: 'res' }, new Set([7]), 'doc'), false);
  assert.equal(marked({ sourceField: 7, fileId: 'doc' }, new Set([7]), 'doc'), true);
});

test('tree path: node ids from the top level down to a field; End fields lie below their Begin', async () => {
  const { ws, id } = await load('us2-structure');
  assert.deepEqual(await ws.getTreePath(id, { pageNumber: 2 }), ['0', '3', '14', '16']);
  assert.deepEqual(await ws.getTreePath(id, { row: 21 }), ['0', '3', '14', '16', '21']); // TLE in PAGE0002
  assert.deepEqual(await ws.getTreePath(id, { row: 8 }), ['0', '3', '6', '7', '8']); // PGD in the environment group
  assert.deepEqual(await ws.getTreePath(id, { row: 13 }), ['0', '3', '6', '13']); // End Page
  assert.deepEqual(await ws.getTreePath(id, { row: 25 }), ['0', '25']); // End Document
});

test('TLE nodes carry name and value for the row preview, decoded like the TLE browser', async () => {
  const { ws, id } = await load('us2-structure');
  const tles = async (parent) => (await ws.getTree(id, parent)).filter((n) => n.kind === 'tle').map((n) => n.tle);
  const tles3 = await tles('3');
  assert.ok(tles3.some((t) => t.name === 'ACCOUNT' && t.value === 'A-100 [7]'));
  assert.deepEqual(await tles('6'), [{ name: 'PAGETAG', value: 'P1 [X]' }]);
  // Other fields have none; the TLE code page override applies.
  assert.ok((await ws.getTree(id, '6')).filter((n) => n.kind !== 'tle').every((n) => n.tle === null));
  ws.setCodePageOverride('tle', 'ebcdic-037');
  assert.deepEqual(await tles('6'), [{ name: 'PAGETAG', value: 'P1 ¢X!' }]);
});
