/**
 * Coded font redirection (spec edge case, decision 2026-11-06): a missing coded font with prefix
 * X1–X9 is replaced by the X0 variant of the same name.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redirectedCodedFont } from '../../src/lib/render/fonts.js';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { bytes, field, uint, ebcdic, triplet, group, documentOf, resourceGroup, resource, ID } from '../helpers/afp-builder.js';
import { fontCharacterSet, codePage, FONT_NAME, CODE_PAGE_NAME, AMB, AMI, SCFL, TRN } from '../helpers/fixture-text.js';

test('X1–X9 names map to X0; other names do not', () => {
  assert.equal(redirectedCodedFont('X1NEOAF1'), 'X0NEOAF1');
  assert.equal(redirectedCodedFont('X4NEOAF'), 'X0NEOAF');
  assert.equal(redirectedCodedFont('X0NEOAF1'), null);
  assert.equal(redirectedCodedFont('XZNEOAF1'), null);
  assert.equal(redirectedCodedFont('C0NEOAF1'), null);
});

/**
 * Builds a file whose page maps the coded font X1NEOAF1, while the resource group holds only
 * X0NEOAF1 (fixture font and code page).
 * @returns {Uint8Array} AFP bytes.
 */
function redirectedFile() {
  const units = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2));
  const codedFont = group(ID.BCF, 'X0NEOAF1', field('D3A78A', bytes(0x19, 0x01)),
    field('D38C8A', bytes(ebcdic(FONT_NAME, 8), ebcdic(CODE_PAGE_NAME, 8), uint(240, 2), uint(0, 2), uint(0, 4), 0x00)));
  const rg = bytes(triplet(0x24, 0x05, 1), triplet(0x02, 0x8e, 0x00, ebcdic('X1NEOAF1', 8)), triplet(0x26, uint(0, 2)));
  const mcf = field('D3AB8A', bytes(uint(rg.length + 2, 2), rg));
  const environment = group(ID.BAG, 'AEG1', mcf,
    field(ID.PGD, bytes(units, uint(11906, 3), uint(16838, 3), uint(0, 3))),
    field(ID.PTD, bytes(units, uint(11906, 3), uint(16838, 3), uint(0, 2))));
  const text = group(ID.BPT, 'PT000001', field(ID.PTX, bytes(SCFL(1), AMB(1440), AMI(1440), TRN('ABC'))));
  return bytes(
    resourceGroup(fontCharacterSet(), codePage(), resource('X0NEOAF1', 0x42, codedFont)),
    documentOf('D1NEOAF1', group(ID.BPG, 'P1NEOAF1', environment, text)),
  );
}

test('a page asking for X1NEOAF1 is drawn with X0NEOAF1', async () => {
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(redirectedFile(), 'redirect.afp')], 'file');
  const model = await ws.getRenderModel(file.id, 1);
  const run = model.items.find((i) => i.type === 'glyphRun');
  assert.notEqual(run.font.kind, 'substitute');
  const redirect = ws.getDiagnostics({ fileId: file.id }).find((d) => d.messageKey === 'diagnostic.fontRedirected');
  // The document's path is added to every message of the document (messages say "{file}: …").
  assert.deepEqual(redirect.params, { file: file.path, name: 'X1NEOAF1', substitute: 'X0NEOAF1' });
});
