/**
 * Document model (T057): document structure (getDocument) and pages without rendering
 * (getPageInfo), checked on the synthetic US1 fixtures whose content is known.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { documentOf, group, field, bytes, ID } from '../helpers/afp-builder.js';

/**
 * Loads a fixture into a workspace.
 * @param {string} name Fixture name.
 * @returns {Promise<{ws: object, id: string}>} Workspace and document id.
 */
async function load(name) {
  const { buildBytes } = await import(`../fixtures/synthetic/${name}.fixture.js`);
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(buildBytes(), `${name}.afp`)], 'file');
  return { ws, id: file.id };
}

test('document: name, nested page group, inline resource group', async () => {
  const { ws, id } = await load('us1-text');
  const doc = await ws.getDocument(id);
  assert.equal(doc.name, 'TEXTDOC1');
  assert.equal(doc.pageGroups.length, 1);
  assert.deepEqual([doc.pageGroups[0].name, doc.pageGroups[0].startPage, doc.pageGroups[0].endPage], ['GROUP001', 1, 1]);
  assert.deepEqual(doc.pageGroups[0].children, []);
  assert.deepEqual(doc.inlineResourceGroup.resources.map((r) => r.name), ['C0NEOAF1', 'T1NEOAF1']);
  assert.deepEqual(doc.mediumMapInvocations, []);
  assert.equal(doc.pages.length, 1);
});

test('page: size, resolution and a text object', async () => {
  const { ws, id } = await load('us1-text');
  const page = await ws.getPageInfo(id, 1);
  assert.deepEqual([page.widthUnits, page.heightUnits, page.xResolution, page.yResolution], [11906, 16838, 1440, 1440]);
  assert.equal(page.name, 'PAGE0001');
  assert.deepEqual(page.objects.map((o) => o.kind), ['text']);
  assert.deepEqual(page.missingResources, []);
});

test('page: included page segment and overlay', async () => {
  const { ws, id } = await load('us1-overlay-segment');
  const page = await ws.getPageInfo(id, 1);
  assert.deepEqual(page.includedSegments.map(({ name, x, y }) => ({ name, x, y })), [{ name: 'S1NEOSEG', x: 1440, y: 2880 }]);
  assert.deepEqual(page.includedOverlays.map(({ name, x, y, rotation }) => ({ name, x, y, rotation })),
    [{ name: 'O1NEOOVL', x: 5760, y: 4320, rotation: 0 }]);
});

test('medium map invocation before page 5', async () => {
  const { ws, id } = await load('us1-formdef-duplex');
  const doc = await ws.getDocument(id);
  assert.deepEqual(doc.mediumMapInvocations.map(({ name, beforePage }) => ({ name, beforePage })), [{ name: 'M2SIMPLX', beforePage: 5 }]);
});

test('objects: bar code areas, container formats, IM image area', async () => {
  const bc = await load('us1-barcodes');
  const bcPage = await bc.ws.getPageInfo(bc.id, 1);
  assert.equal(bcPage.objects.length, 10);
  assert.ok(bcPage.objects.every((o) => o.kind === 'barcode'));
  assert.deepEqual(bcPage.objects[0].area, { x: 1000, y: 1000, width: 4800, height: 2400 });

  const oc = await load('us1-object-containers');
  const ocPage = await oc.ws.getPageInfo(oc.id, 1);
  assert.deepEqual(ocPage.objects.map((o) => o.containerFormat), ['pdf', 'jpeg', 'png', 'gif', 'tiff', 'other']);

  const im = await load('us1-im-image');
  const imPage = await im.ws.getPageInfo(im.id, 1);
  // 64 × 48 pels at 240 dpi, IOC offset (120, 60): 6 page units per pel.
  assert.deepEqual(imPage.objects.map((o) => [o.kind, o.area]), [['imImage', { x: 720, y: 360, width: 384, height: 288 }]]);
});

test('missing resources of a page', async () => {
  const { ws, id } = await load('us1-missing-resources');
  const page = await ws.getPageInfo(id, 1);
  assert.deepEqual(page.missingResources, [
    { type: 'fontCharacterSet', name: 'C0MISSNG' }, { type: 'codePage', name: 'T1MISSNG' },
    { type: 'pageSegment', name: 'S1MISSNG' }, { type: 'overlay', name: 'O1MISSNG' },
  ]);
});

test('a page without Page Descriptor gets 8.5 × 11 in and a diagnostic', async () => {
  const ws = createWorkspace();
  const afp = documentOf('NOPGD001', group(ID.BPG, 'PAGE0001', field(ID.NOP, bytes(0x40))));
  const [file] = await ws.addFiles([createBufferSource(afp, 'nopgd.afp')], 'file');
  const page = await ws.getPageInfo(file.id, 1);
  assert.deepEqual([page.widthUnits, page.heightUnits, page.xResolution], [12240, 15840, 1440]);
  assert.equal(page.nops.length, 1);
  assert.ok(ws.getDiagnostics({ fileId: file.id }).some((d) => /page descriptor missing/.test(d.params.reason ?? '')));
});
