/**
 * Hit testing for "click on the page to inspect" (FR-034, src/lib/render/hit-test.js): items are
 * hit in their own shape (text along its rotation, lines by distance, images turned around their
 * corner, clipped objects only inside the clip); the smallest item under the point wins; items
 * without a source field and hidden test print marks are not hit. pageAt finds the page of an
 * N-up sheet under a point.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitTest, itemBox, pageAt } from '../../src/lib/render/hit-test.js';

const run = (o) => ({ type: 'glyphRun', x: 1000, y: 2000, rotation: 0, font: { size: 200 }, dx: [0, 100, 200], text: 'abc', sourceField: 5, ...o });

test('text is hit inside its line box, along its rotation', () => {
  const model = { items: [run()] };
  assert.equal(hitTest(model, 1100, 1950), 0); // on the line
  assert.equal(hitTest(model, 1100, 1700), -1); // above it
  assert.equal(hitTest(model, 1450, 1950), -1); // past the last character
  // Turned by 90°: the line runs downwards from its origin.
  const turned = { items: [run({ rotation: 90 })] };
  assert.equal(hitTest(turned, 1050, 2150), 0);
  assert.equal(hitTest(turned, 1150, 1950), -1);
  const box = itemBox(turned.items[0]);
  assert.ok(Math.abs(box.height - 320) < 1e-6 && Math.abs(box.width - 260) < 1e-6);
});

test('lines by distance, images by their turned rectangle, clipped objects only inside the clip', () => {
  const rule = { type: 'rule', x1: 0, y1: 500, x2: 3000, y2: 500, thickness: 10, sourceField: 1 };
  assert.equal(hitTest({ items: [rule] }, 1500, 503), 0);
  assert.equal(hitTest({ items: [rule] }, 1500, 530), -1);
  assert.equal(hitTest({ items: [rule] }, 1500, 530, { tolerance: 40 }), 0);
  const image = { type: 'image', rect: { x: 1000, y: 1000, width: 400, height: 200 }, rotation: 90, sourceField: 2 };
  assert.equal(hitTest({ items: [image] }, 900, 1300), 0); // turned around its top-left corner
  assert.equal(hitTest({ items: [image] }, 1300, 1100), -1);
  const clipped = { ...image, rotation: 0, clip: { x: 1000, y: 1000, width: 100, height: 100 } };
  assert.equal(hitTest({ items: [clipped] }, 1050, 1050), 0);
  assert.equal(hitTest({ items: [clipped] }, 1300, 1100), -1);
});

test('the smallest item under the point wins; unrelated items are skipped', () => {
  const background = { type: 'image', rect: { x: 0, y: 0, width: 12240, height: 15840 }, sourceField: 9 };
  const model = { items: [run(), background, { ...run(), sourceField: undefined }] };
  assert.equal(hitTest(model, 1100, 1950), 0); // the text, although the image is drawn later
  assert.equal(hitTest(model, 5000, 5000), 1);
  // A run of blanks draws nothing: the text behind it is hit, not the (smaller) blank run.
  assert.equal(hitTest({ items: [run({ dx: [0, 100, 200, 300] }), run({ text: '  ', dx: [0, 100] })] }, 1050, 1950), 0);
  const mark = { ...run(), testPrint: true };
  assert.equal(hitTest({ items: [mark] }, 1100, 1950, { hideTestPrint: true }), -1);
  assert.equal(hitTest({ items: [mark] }, 1100, 1950), 0);
});

test('pageAt finds the page of an N-up sheet', () => {
  const model = { pageAreas: [{ pageNumber: 1, x: 0, y: 0, width: 6000, height: 8000 }, { pageNumber: 2, x: 6000, y: 0, width: 6000, height: 8000 }] };
  assert.equal(pageAt(model, 7000, 100).pageNumber, 2);
  assert.equal(pageAt(model, 100, 9000), null);
});

test('render models name the page area and units, and items from includes their Include field', async () => {
  const { createWorkspace, createBufferSource } = await import('../../src/lib/index.js');
  const { buildBytes } = await import('../fixtures/synthetic/us1-overlay-segment.fixture.js');
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(buildBytes(), 'ovl.afp')], 'file');
  const model = await ws.getRenderModel(file.id, 1);
  assert.deepEqual(model.pageAreas.map((a) => [a.pageNumber, a.x, a.y, a.width, a.height]), [[1, 0, 0, model.widthUnits, model.heightUnits]]);
  assert.ok(model.pageAreas[0].unitsPerInch.x > 0);
  // The page includes a page segment (IPS) and an overlay (IPO), both in its resource group.
  const tags = new Set(model.items.filter((i) => i.via).map((i) => `${i.via[0].type}:${i.via[0].name}:${i.via[0].fileId === file.id}`));
  assert.deepEqual([...tags].sort(), ['overlay:O1NEOOVL:true', 'pageSegment:S1NEOSEG:true']);
  // The page's own text has no Include field.
  assert.ok(model.items.some((i) => i.type === 'glyphRun' && !i.via));
});

test('text runs name their Presentation Text Data field', async () => {
  const { createWorkspace, createBufferSource } = await import('../../src/lib/index.js');
  const { buildBytes } = await import('../fixtures/synthetic/us1-text.fixture.js');
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(buildBytes(), 'text.afp')], 'file');
  const model = await ws.getRenderModel(file.id, 1);
  const runs = model.items.filter((i) => i.type === 'glyphRun');
  assert.ok(runs.length);
  for (const r of runs) {
    const field = await ws.getField(file.id, r.textField);
    assert.ok(['PTX', 'BPT'].includes(field.shortName ?? field.name), `run "${r.text}" points to ${field.shortName}`);
  }
  assert.ok(runs.some((r) => r.textField !== r.sourceField));
});
