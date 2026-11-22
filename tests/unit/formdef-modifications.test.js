/**
 * Page modifications from the form definition, rotated overlays and Include Page (T278, T280,
 * T282–T284) on the synthetic fixture us1-formdef-modifications (see its header for the values).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { buildBytes } from '../fixtures/synthetic/us1-formdef-modifications.fixture.js';
import { readMmc, readPmc } from '../../src/lib/formdef/formdef.js';

/**
 * Opens the fixture and renders page 1.
 * @returns {Promise<{ws: object, id: string, runs: object[]}>} Workspace, document and glyph runs.
 */
async function page1() {
  const ws = createWorkspace();
  await ws.addFiles([createBufferSource(buildBytes(), 'mods.afp')], 'file');
  const id = ws.listDocuments()[0].id;
  const runs = (await ws.getRenderModel(id, 1)).items.filter((i) => i.type === 'glyphRun');
  return { ws, id, runs };
}

test('pages of a document kept in a resource group are no pages of the file', async () => {
  const { ws, id } = await page1();
  assert.equal(ws.getPageCount(id), 2);
});

test('text suppression: BSU/ESU text with an active ID is not drawn, the position moves on', async () => {
  const { runs } = await page1();
  const own = runs.filter((r) => !r.via && !r.pmcOverlay);
  assert.deepEqual(own.map((r) => [r.text, r.x]), [['A', 1440], ['C', 1440 + 4 * 144]]);
});

test('rotated page overlay: turned 90° clockwise about its origin', async () => {
  const { runs } = await page1();
  const r = runs.find((x) => x.via?.[0]?.name === 'O1ROTATE');
  // Overlay text at (100, 400) → (2000 − 400, 3000 + 100), turned by 90°.
  assert.deepEqual([r.x, r.y, r.rotation], [1600, 3100, 90]);
});

test('Include Page in page state draws the saved page; between pages it is reported', async () => {
  const { ws, runs } = await page1();
  const included = runs.find((x) => x.via?.[0]?.type === 'page');
  assert.deepEqual([included.text, included.x, included.y], ['C', 1440, 5000]);
  const reported = ws.getDiagnostics({}).filter((d) => d.code === 'unsupportedObject');
  assert.equal(reported.length, 1);
  assert.match(reported[0].params.reason, /Include Page D1SAVED\/P1SAVED between pages/);
});

test('PMC overlay: Resource Object Include at its offset on the page', async () => {
  const { runs } = await page1();
  const pmc = runs.find((x) => x.pmcOverlay === 'O1PMCOVL');
  assert.deepEqual([pmc.text, pmc.x, pmc.y], ['B', 720 + 100, 1440 + 400]);
});

test('MMC keywords as defined: X\'F2\' overlays (up to eight), X\'F3\' suppressions, X\'D1\' is jog', () => {
  const m = readMmc(Uint8Array.of(0x01, 0xff, 0xd1, 0x01, 0xe8, 0x00, 0xe9, 0x07, 0xf2, 0x03, 0xf2, 0x04, 0xf3, 0x05, 0xf4, 0x02, 0xf9, 0x01));
  assert.deepEqual(m.overlayIds, [3, 4]);
  assert.deepEqual(m.suppressionIds, [5]);
  assert.equal(m.jog, true);
  assert.equal(m.mediaTypeId, 7);
  assert.equal(m.duplex, 2);
  assert.equal(m.constantForms, true);
});

test('PMC: overlay and preprinted form overlay with units and rotation', () => {
  const name = [0xd6, 0xf1, 0xc6, 0xd6, 0xd9, 0xd4, 0x40, 0x40];
  const pmc = readPmc(Uint8Array.of(0x02, 0x00,
    0x08, 0x4b, 0x00, 0x00, 0x09, 0x60, 0x09, 0x60, // 240 per inch
    19, 0x6c, 0xdf, ...name, 0, 0, 10, 0, 0, 20, 0x2d, 0x00,
    17, 0x6c, 0xdc, ...name, 0, 0, 1, 0, 0, 2), { kx: 1, ky: 1 });
  assert.equal(pmc.id, 2);
  assert.deepEqual(pmc.overlays, [
    { name: 'O1FORM', x: 60, y: 120, rotation: 90, form: false },
    { name: 'O1FORM', x: 6, y: 12, rotation: 0, form: true },
  ]);
});
