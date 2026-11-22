/**
 * Page text export (T196, FR-099): text runs grouped into lines by baseline, top to bottom, left
 * to right, with a space only where runs do not touch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageTextLines } from '../../src/lib/export/page-text.js';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';

const run = (x, y, text, advance = 100) => ({ type: 'glyphRun', x, y, text, dx: [...text].map((_, i) => i * advance) });

test('lines by baseline, runs by position, spaces only at gaps', () => {
  const lines = pageTextLines({ items: [
    run(2000, 1000, 'World'), run(1000, 1010, 'Hello'), // same line, out of order
    run(1500, 1010, '!'), // touches "Hello" (1000 + 5 × 100)
    { type: 'rule', x: 0, y: 1500 },
    run(1000, 2000, 'Second  '),
  ] });
  assert.deepEqual(lines, ['Hello! World', 'Second']);
});

test('workspace: text of a document page', async () => {
  const { buildBytes } = await import('../fixtures/synthetic/us4-search.fixture.js');
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(buildBytes(), 'us4.afp')], 'file');
  assert.equal(await ws.getPageText(file.id, 2), 'Gutschrift Kunde Zürich');
});
