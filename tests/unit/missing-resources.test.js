/**
 * Missing resources that arrive later (FR-021, task T049): a page that references an absent
 * coded font, page segment and overlay is first drawn with a substitute font and placeholders;
 * after a resource file with these resources is added, the workspace reports the document's pages
 * as invalidated and the page renders with the real font, segment and overlay.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { bytes, field, uint, group, resourceGroup, resource, ID } from '../helpers/afp-builder.js';
import { fontCharacterSet, codePage, AMI, AMB, SCFL, TRN } from '../helpers/fixture-text.js';
import { buildBytes } from '../fixtures/synthetic/us1-missing-resources.fixture.js';

/**
 * Builds a resource file with the font, code page, page segment and overlay the page needs.
 * @returns {Uint8Array} AFP bytes.
 */
function resources() {
  const text = (name, ...cs) => group(ID.BPT, name, field(ID.PTX, bytes(...cs)));
  const segment = resource('S1MISSNG', 0xfb, group(ID.BPS, 'S1MISSNG', text('PT000002', SCFL(1), AMB(360), AMI(0), TRN('CAB'))));
  const units = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2));
  const overlay = resource('O1MISSNG', 0xfc, group(ID.BMO, 'O1MISSNG',
    group(ID.BAG, 'AEG1', field(ID.PGD, bytes(units, uint(2880, 3), uint(1440, 3), uint(0, 3)))),
    field('D3EEEE', bytes(0x40))));
  return resourceGroup(fontCharacterSet('C0MISSNG'), codePage('T1MISSNG'), segment, overlay);
}

test('adding the missing resources invalidates the pages and renders them fully', async () => {
  const events = [];
  const ws = createWorkspace({ onPagesInvalidated: (e) => events.push(e) });
  const [doc] = await ws.addFiles([createBufferSource(buildBytes(), 'missing.afp')], 'file');
  const before = await ws.getRenderModel(doc.id, 1);
  assert.equal(before.items[0].font.kind, 'substitute');
  assert.equal(before.items.filter((i) => i.type === 'placeholder').length, 2);

  await ws.addFiles([createBufferSource(resources(), 'resources.afp')], 'file');
  assert.deepEqual(events, [{ documentId: doc.id, pageNumbers: 'all' }]);

  const after = await ws.getRenderModel(doc.id, 1);
  assert.equal(after.items.filter((i) => i.type === 'placeholder').length, 0);
  const [text, segmentText] = after.items.filter((i) => i.type === 'glyphRun');
  assert.equal(text.font.kind, 'raster');
  assert.equal(text.font.name, 'C0MISSNG');
  // Segment included at (1440, 2880), its text at (0, 360) inside.
  assert.deepEqual([segmentText.text, segmentText.x, segmentText.y], ['CAB', 1440, 3240]);
});

test('messages about missing fonts name the document ("{file}: …" is filled)', async () => {
  const { readFileSync } = await import('node:fs');
  const en = JSON.parse(readFileSync(new URL('../../src/viewer/locales/en.json', import.meta.url))).messages;
  const ws = createWorkspace();
  const [doc] = await ws.addFiles([createBufferSource(buildBytes(), 'missing.afp')], 'file');
  await ws.getRenderModel(doc.id, 1);
  const withFile = ws.getDiagnostics({ fileId: doc.id }).filter((d) => (en[d.messageKey] ?? '').includes('{file}'));
  assert.ok(withFile.some((d) => d.code === 'fontSubstituted'));
  for (const d of withFile) assert.equal(d.params.file, 'missing.afp', d.code);
});
