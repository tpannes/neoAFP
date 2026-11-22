/**
 * Resource resolution (T054 for T081, FR-020, data-model "ResourceCatalog"):
 * - lookup order: the document's inline resource group, then files from the opened folder, then
 *   individually opened files;
 * - among same-named resources outside the inline group: the document's resolution first, then
 *   the closest higher, then the closest lower;
 * - several candidates give one `duplicateResource` diagnostic naming the chosen file;
 * - adding a missing resource re-resolves (pagesInvalidated, see missing-resources.test.js).
 * Which copy of a raster font was used shows in the glyph run's font resolution.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { bytes, field, uint, documentOf, group, resourceGroup, ID } from '../helpers/afp-builder.js';
import { fontCharacterSet, codePage, mapCodedFont, AMI, AMB, SCFL, TRN, FONT_NAME } from '../helpers/fixture-text.js';

/**
 * Builds a one-page document at a resolution that uses the fixture font name.
 * @param {number} dpi Page resolution (240, 300 or 600).
 * @param {boolean} inlineFont Put a 240-dpi copy of the font in the inline resource group.
 * @returns {Uint8Array} AFP bytes.
 */
function documentAt(dpi, inlineFont = false) {
  const units = bytes(0x00, 0x00, uint(dpi * 10, 2), uint(dpi * 10, 2));
  const w = Math.round(8.27 * dpi);
  const h = Math.round(11.69 * dpi);
  const page = group(ID.BPG, 'PAGE0001',
    group(ID.BAG, 'AEG1', mapCodedFont(), field(ID.PGD, bytes(units, uint(w, 3), uint(h, 3), uint(0, 3))),
      field(ID.PTD, bytes(units, uint(w, 3), uint(h, 3), uint(0, 2)))),
    group(ID.BPT, 'PT000001', field(ID.PTX, bytes(SCFL(1), AMB(dpi), AMI(dpi), TRN('ABC')))));
  return bytes(resourceGroup(codePage(), ...(inlineFont ? [fontCharacterSet(FONT_NAME, { resolution: 240 })] : [])),
    documentOf('RESOLVE1', page));
}

/** A font file of the fixture font at a resolution. */
const fontFile = (dpi) => createBufferSource(fontCharacterSet(FONT_NAME, { resolution: dpi, bare: true }), `fonts${dpi}/${FONT_NAME}.FON`);

/**
 * Opens files and returns the resolution of the font the page's text uses.
 * @param {{folder?: object[], file?: object[]}} sources Sources by origin; the document first in folder or file.
 * @returns {Promise<{resolution: number, ws: object, docId: string}>} Chosen font resolution.
 */
async function chosen({ folder = [], file = [] }) {
  const ws = createWorkspace();
  const added = [];
  if (folder.length) added.push(...await ws.addFiles(folder, 'folder'));
  if (file.length) added.push(...await ws.addFiles(file, 'file'));
  const docId = added.find((f) => f.kind === 'document').id;
  const model = await ws.getRenderModel(docId, 1);
  const run = model.items.find((i) => i.type === 'glyphRun');
  return { resolution: run.font.resolution, ws, docId };
}

const doc = (dpi, inline = false) => createBufferSource(documentAt(dpi, inline), `doc${dpi}.afp`);

test('the inline resource group wins over folder and individually opened files', async () => {
  const { resolution } = await chosen({ folder: [doc(300, true), fontFile(300)], file: [fontFile(600)] });
  assert.equal(resolution, 240);
});

test('folder files win over individually opened files', async () => {
  const { resolution } = await chosen({ folder: [doc(300), fontFile(600)], file: [fontFile(300)] });
  assert.equal(resolution, 600);
});

test('equal resolution first, then closest higher, then closest lower', async () => {
  assert.equal((await chosen({ folder: [doc(300), fontFile(240), fontFile(300), fontFile(600)] })).resolution, 300);
  assert.equal((await chosen({ folder: [doc(240), fontFile(300), fontFile(600)] })).resolution, 300);
  assert.equal((await chosen({ folder: [doc(600), fontFile(240), fontFile(300)] })).resolution, 300);
});

test('several candidates give one duplicateResource diagnostic naming the chosen file', async () => {
  const { ws, docId } = await chosen({ folder: [doc(300), fontFile(240), fontFile(300), fontFile(600)] });
  await ws.getRenderModel(docId, 1); // rendering again must not repeat it
  const dups = ws.getDiagnostics({ fileId: docId }).filter((d) => d.code === 'duplicateResource');
  assert.equal(dups.length, 1);
  assert.deepEqual([dups[0].params.name, dups[0].params.chosen, dups[0].params.count], [FONT_NAME, `fonts300/${FONT_NAME}.FON`, 3]);
});

test('a resource file is found by its file name, and by a different internal name too', async () => {
  // Resource libraries are searched by member (file) name; the name in the Begin field may differ
  // (e.g. a file C0ABC123.CHS that contains Begin Font C0ABC12I).
  const renamed = createBufferSource(fontCharacterSet('C0OTHER1', { resolution: 300, bare: true }), `fonts300/${FONT_NAME}.CHS`);
  const { resolution, ws } = await chosen({ folder: [doc(300), renamed] });
  assert.equal(resolution, 300);
  const [font] = (await ws.getResources()).filter((r) => r.type === 'fontCharacterSet');
  assert.equal(font.name, FONT_NAME);
  assert.ok(await ws.catalog.lookup('fontCharacterSet', 'C0OTHER1'), 'internal name still found');
});
