/**
 * Page text search life cycle (T148, FR-060, FR-037): indexing in slices reports progress and
 * `indexing` until done; files added later are indexed on the next build; a search can be
 * limited to one document, whose results come in page order; changing the code page for text
 * re-indexes the page text with the new decoding. TLEs and NOPs are not indexed (the TLE and NOP
 * browsers filter their own tables).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';

const fixture = async (name) => (await import(`../fixtures/synthetic/${name}.fixture.js`)).buildBytes();
const buildAll = async (ws) => { while (!(await ws.buildSearchIndex({ budgetMs: 1000 })).done); };

test('slices, later files, one document, and re-indexing after a code page change', async () => {
  const progress = [];
  const ws = createWorkspace({ onProgress: (p) => p.phase === 'search' && progress.push(p) });
  const [search] = await ws.addFiles([createBufferSource(await fixture('us4-search'), 'us4-search.afp')], 'file');
  assert.equal((await ws.search({ text: 'Müller' })).indexing, true);
  const first = await ws.buildSearchIndex({ budgetMs: 0 });
  assert.equal(first.done, false);
  await buildAll(ws);
  assert.ok(progress.at(-1).done === progress.at(-1).total);
  assert.equal((await ws.search({ text: 'Müller' })).results.length, 1);
  // TLE values and NOP text are not searched.
  assert.equal((await ws.search({ text: 'K4711' })).results.length, 0);

  // A second copy added later is indexed on the next build; fileId keeps the first one only.
  const [copy] = await ws.addFiles([createBufferSource(await fixture('us4-search'), 'copy.afp')], 'file');
  assert.equal((await ws.search({ text: 'Müller' })).indexing, true);
  await buildAll(ws);
  assert.equal((await ws.search({ text: 'Müller' })).results.length, 2);
  assert.deepEqual((await ws.search({ text: 'Müller', fileId: copy.id })).results.map((r) => r.location.fileId), [copy.id]);
  assert.deepEqual((await ws.search({ text: 'Zürich', fileId: search.id })).results.map((r) => r.location.pageNumber), [2]);

  // The page text is EBCDIC 500; read as 273 the "ü" becomes another character, so "Müller"
  // is no longer found.
  const before = (await ws.search({ text: 'Müller', fileId: search.id })).results[0];
  assert.equal(before.distance, 0);
  ws.setCodePageOverride('text', 'ebcdic-273');
  assert.equal((await ws.search({ text: 'Müller' })).indexing, true);
  await buildAll(ws);
  assert.deepEqual((await ws.search({ text: 'Müller', fileId: search.id })).results, []);
});

test('indexing reads the text only; hit positions refer to the full page (2D bar codes included)', async () => {
  const ws = createWorkspace();
  const [f] = await ws.addFiles([createBufferSource(await fixture('us4-search'), 'us4-search.afp')], 'file');
  await buildAll(ws);
  for (const r of (await ws.search({ text: 'Müller', fileId: f.id })).results) {
    const model = await ws.getRenderModel(f.id, r.location.pageNumber);
    const run = model.items[r.location.itemIndex];
    assert.equal(run.type, 'glyphRun');
    assert.equal(run.text.slice(r.location.charStart, r.location.charEnd), 'Müller');
  }
});
