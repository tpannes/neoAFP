/**
 * Resource previews (T133, FR-051, FR-054, FR-058) on the us3-resources fixture: page segment,
 * overlay, image and PDF container render models (sizes from the fixture's object areas and page
 * descriptor), no visual preview for font character sets, code pages, ICC profiles and CMRs, the
 * sample text and character map of a coded font (and a placeholder when its character set is
 * missing), the diagram of a form definition (also duplex tumble and 2-up), the character grid
 * of the fixture font and the fixture code page table.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { buildBytes, DUPLICATE } from '../fixtures/synthetic/us3-resources.fixture.js';
import { bytes, field, group, ebcdic, uint } from '../helpers/afp-builder.js';
import { pageAreas } from '../../src/lib/render/formdef-diagram.js';

/**
 * Loads the fixture.
 * @returns {Promise<{ws: object, byName: (name: string, type?: string) => object}>} Workspace and lookup.
 */
async function load() {
  const ws = createWorkspace();
  await ws.addFiles([createBufferSource(buildBytes(), 'us3-resources.afp'), createBufferSource(DUPLICATE, 'us3-duplicate.psg')], 'file');
  const resources = await ws.getResources();
  return { ws, byName: (name, type) => resources.find((r) => r.name === name && (!type || r.type === type)) };
}

test('render models of page segment, overlay, image and PDF container', async () => {
  const { ws, byName } = await load();
  const seg = await ws.getResourceRenderModel(byName('S1NEOSEG').id);
  assert.deepEqual([seg.widthUnits, seg.heightUnits, seg.items.map((i) => i.type)], [2880, 1440, ['image']]);
  // 64 × 48 pels scaled to fit the 2 × 1 in area and centered (IOCA default mapping).
  assert.deepEqual(seg.items[0].rect, { x: 480, y: 0, width: 1920, height: 1440 });
  const ovl = await ws.getResourceRenderModel(byName('O1NEOOVL').id);
  assert.deepEqual([ovl.widthUnits, ovl.heightUnits], [11906, 16838]);
  const img = await ws.getResourceRenderModel(byName('I1NEOIMG').id);
  assert.deepEqual([img.widthUnits, img.heightUnits, img.items.length], [5760, 2880, 1]);
  const pdf = await ws.getResourceRenderModel(byName('P1NEOPDF').id);
  assert.equal(pdf.items[0].type, 'pdf');
});

test('no visual preview for font character sets, code pages, ICC profiles and CMRs', async () => {
  const { ws, byName } = await load();
  for (const name of ['C0NEOAF1', 'T1NEOAF1', 'R1NEOICC', 'C1NEOCMR']) {
    assert.equal(await ws.getResourceRenderModel(byName(name).id), null, name);
  }
});

test('coded font: name and sample drawn with its character set through its code page', async () => {
  const { ws, byName } = await load();
  const model = await ws.getResourceRenderModel(byName('X0NEOAF1').id);
  // The fixture code page has only A, B, C and space: the other characters are left out.
  assert.deepEqual(model.items.map((i) => [i.type, i.text, i.font.kind, i.codes]), [
    ['glyphRun', 'A', 'raster', [0xc1]], ['glyphRun', 'ABC  ', 'raster', [0xc1, 0xc2, 0xc3, 0x40, 0x40]],
  ]);
});

test('coded font: character map by code point', async () => {
  const { ws, byName } = await load();
  const grid = await ws.getFontCharacterGrid(byName('X0NEOAF1').id);
  assert.deepEqual([grid.kind, grid.characterSet, grid.codePage, grid.found], ['raster', 'C0NEOAF1', 'T1NEOAF1', { characterSet: true, codePage: true }]);
  assert.deepEqual(grid.glyphs.map((g) => [g.codePoint, g.gcgid, g.available]), [
    [0x40, 'SP010000', true], [0xc1, 'LA020000', true], [0xc2, 'LB020000', true], [0xc3, 'LC020000', true],
  ]);
  assert.equal(ws.getGlyphs(grid.fontRef, ['LA020000']).glyphs[0].width, 16);
});

test('coded font with a missing character set: placeholder and no characters', async () => {
  const ws = createWorkspace();
  const coded = group('D3A88A', 'X0MISSNG', field('D3A78A', bytes(0x19, 0x01)),
    field('D38C8A', bytes(ebcdic('C0ABSENT', 8), ebcdic('T1ABSENT', 8), uint(240, 2), uint(0, 2), uint(0, 4), 0x00)));
  await ws.addFiles([createBufferSource(coded, 'X0MISSNG.FON')], 'file');
  const [r] = await ws.getResources();
  const model = await ws.getResourceRenderModel(r.id);
  assert.deepEqual(model.items.map((i) => [i.type, i.resourceName, i.reason]), [['placeholder', 'C0ABSENT + T1ABSENT', 'missing: C0ABSENT, T1ABSENT']]);
  const grid = await ws.getFontCharacterGrid(r.id);
  assert.deepEqual([grid.found, grid.glyphs], [{ characterSet: false, codePage: false }, []]);
});

test('form definition: medium maps and the diagram of the first one', async () => {
  const { ws, byName } = await load();
  const id = byName('F1NEOFRM').id;
  const fd = await ws.getFormDefinition(id);
  assert.deepEqual(fd.mediumMaps.map((m) => [m.name, m.duplex, m.nUp]), [['M1NEOMAP', 'simplex', 1]]);
  // One A4 sheet (no medium size given): background, page area, number 1, border.
  const model = await ws.getResourceRenderModel(id);
  assert.deepEqual([model.widthUnits, model.heightUnits], [11906, 16838]);
  assert.deepEqual(model.items.map((i) => i.text ?? i.type), ['path', 'path', '1', 'path']);
});

test('form definition diagram: tumble duplex 2-up shows the back upside down, numbered on', async () => {
  // Medium Modification Control: duplex X'F4' = 3 (tumble), N-up X'FC' = 2.
  const form = group('D3A8CD', 'F1TUMBLE', group('D3A8CC', 'M1TUMBLE', field('D3A788', bytes(0x01, 0x00, 0xf4, 0x03, 0xfc, 0x02))));
  const ws = createWorkspace();
  await ws.addFiles([createBufferSource(form, 'F1TUMBLE.FDF')], 'file');
  const [r] = await ws.getResources();
  const model = await ws.getFormDefinitionDiagram(r.id, 'M1TUMBLE');
  const labels = model.items.filter((i) => i.type === 'glyphRun').map((i) => [i.text, i.rotation]);
  assert.deepEqual(labels, [['1', 0], ['2', 0], ['3', 180], ['4', 180]]);
  assert.ok(model.widthUnits > 2 * 11906, 'front and back side by side');
});

test('page areas: one page from its position, N-up as equal partitions', () => {
  const sheet = { width: 1000, height: 2000 };
  assert.deepEqual(pageAreas(1, [{ x: 100, y: 200, rotation: 90 }], sheet), [{ x: 100, y: 200, width: 900, height: 1800, rotation: 90 }]);
  assert.deepEqual(pageAreas(2, [{ x: 0, y: 0, rotation: 90 }], sheet).map((a) => [a.x, a.y, a.width, a.height, a.rotation]),
    [[0, 0, 1000, 1000, 90], [0, 1000, 1000, 1000, 90]]);
  assert.deepEqual(pageAreas(4, [], sheet).map((a) => [a.x, a.y]), [[0, 0], [500, 0], [0, 1000], [500, 1000]]);
});

test('character grid of the fixture font and its glyph bitmaps', async () => {
  const { ws, byName } = await load();
  const grid = await ws.getFontCharacterGrid(byName('C0NEOAF1').id);
  assert.equal(grid.kind, 'raster');
  assert.equal(grid.resolution, 240);
  assert.deepEqual(grid.glyphs.map((g) => [g.gcgid, g.width, g.height, g.increment]), [
    ['LA020000', 16, 20, 24], ['LB020000', 16, 20, 24], ['LC020000', 16, 20, 24], ['SP010000', 16, 20, 24],
  ]);
  const { glyphs } = ws.getGlyphs(grid.fontRef, ['LA020000']);
  assert.equal(glyphs[0].width, 16);
  assert.equal(await ws.getFontCharacterGrid(byName('T1NEOAF1').id), null);
});

test('code page table: code points, GCGIDs, known characters', async () => {
  const { ws, byName } = await load();
  assert.deepEqual(await ws.getCodePageTable(byName('T1NEOAF1').id), [
    { codePoint: 0x40, gcgid: 'SP010000', unicode: ' ', glyphAvailable: true, kind: 'space', unicodeCodePoint: 0x20 },
    { codePoint: 0xc1, gcgid: 'LA020000', unicode: 'A', glyphAvailable: true, kind: 'char', unicodeCodePoint: 0x41 },
    { codePoint: 0xc2, gcgid: 'LB020000', unicode: 'B', glyphAvailable: true, kind: 'char', unicodeCodePoint: 0x42 },
    { codePoint: 0xc3, gcgid: 'LC020000', unicode: 'C', glyphAvailable: true, kind: 'char', unicodeCodePoint: 0x43 },
  ]);
});

test('Unicode-based GCGIDs (UNICxxxx) name their character; control characters are no text', async () => {
  const { gcgidToUnicode, unicodeOfGcgid } = await import('../../src/lib/foca/gcgid-unicode.js');
  assert.equal(gcgidToUnicode('UNIC2022'), '\u2022');
  assert.equal(gcgidToUnicode('UNIC00E2'), '\u00e2');
  assert.equal(gcgidToUnicode('UNIC0006'), null);
  assert.equal(unicodeOfGcgid('UNIC0006'), 6);
  assert.equal(unicodeOfGcgid('LA010000'), null);
});
