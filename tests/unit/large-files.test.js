/**
 * Large-file paths (T230): the pieces that keep 2 GB of mass output (880,000 pages, 1.3 million
 * TLEs) workable give the same answers as the plain ones on small files: sequential field
 * reading, the TLE table kept in the library (window, filter, sort, page lookup, export), the
 * page's TLEs in getPageDetails, NOP counts without decoding, the compact sheet model, and the
 * search index with its memory limit and hits resolved on demand.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { fieldData, sequentialReader } from '../../src/lib/modca/access.js';
import { buildSheetModel, buildSheets } from '../../src/lib/formdef/sheets.js';

const fixture = async (name) => (await import(`../fixtures/synthetic/${name}.fixture.js`)).buildBytes();

/**
 * Opens a fixture in a new workspace.
 * @param {string} name Fixture name.
 * @param {object} [options] Workspace options.
 * @returns {Promise<{ws: object, file: object}>} Workspace and file summary.
 */
async function open(name, options = {}) {
  const ws = createWorkspace(options);
  const [file] = await ws.addFiles([createBufferSource(await fixture(name), `${name}.afp`)], 'file');
  return { ws, file };
}

test('sequential reading gives every field the bytes of a single read, across small windows', async () => {
  const { ws, file } = await open('us2-structure');
  const record = ws.getFileRecord(file.id);
  const read = sequentialReader(record, 64);
  for (let row = 0; row < record.index.count; row++) {
    assert.deepEqual([...await read(row)], [...await fieldData(record, row)], `row ${row}`);
  }
});

test('page details list the TLEs of the page and of its page groups, outermost first', async () => {
  const { ws, file } = await open('us2-structure');
  assert.deepEqual((await ws.getPageDetails(file.id, 2)).tles, ['Straße = Größe Ä!', 'ACCOUNT = A-100 [7]', 'REGION = NORD', 'LANG = EN!']);
  assert.deepEqual((await ws.getPageDetails(file.id, 1)).tles, ['Straße = Größe Ä!', 'ACCOUNT = A-100 [7]', 'PAGETAG = P1 [X]']);
});

test('TLE table queries: window, filter, sort, row of a page, export', async () => {
  const { ws, file } = await open('us2-structure');
  const all = await ws.queryTleTable(file.id, { start: 1, count: 2 });
  assert.equal(all.total, 4);
  assert.equal(all.shown, 4);
  assert.deepEqual(all.rows.map((r) => r.ownerName), ['PAGE0001', 'GROUP002']);
  assert.equal((await ws.queryTleTable(file.id, { filter: 'nord', count: 0 })).shown, 1);
  const sorted = await ws.queryTleTable(file.id, { sort: { key: 'owner', direction: 'desc' } });
  assert.deepEqual(sorted.rows.map((r) => r.ownerName), ['PAGE0002', 'PAGE0001', 'GROUP002', 'GROUP001']);
  // Page 2: its innermost page group GROUP002, at position 2 in the descending view.
  assert.equal(await ws.findTleRowOfPage(file.id, { sort: { key: 'owner', direction: 'desc' } }, 2), 2);
  const columns = [{ key: 'owner', label: 'Owner' }, { key: 'level', label: 'Level' }, { key: 'pages', label: 'Pages' }, { key: 'tle:REGION', label: 'REGION' }];
  const csv = await ws.exportTleTable(file.id, { filter: 'nord' }, 'csv', columns, { pageGroup: 'Group' });
  assert.deepEqual(csv.trim().split(/\r?\n/), ['Owner,Level,Pages,REGION', 'GROUP002,Group,2,NORD']);
  const json = JSON.parse(await ws.exportTleTable(file.id, { filter: 'nord' }, 'json', columns));
  assert.deepEqual(json, [{ owner: 'GROUP002', level: 'pageGroup', firstPage: 2, lastPage: 2, values: { REGION: 'NORD' } }]);
  // The full table (public getTleTable) still lists every row in file order.
  assert.deepEqual((await ws.getTleTable(file.id)).rows.map((r) => r.ownerName), ['GROUP001', 'PAGE0001', 'GROUP002', 'PAGE0002']);
});

test('NOP counts without decoding match the NOP list', async () => {
  const { ws, file } = await open('us2-structure');
  const nops = await ws.getNops(file.id);
  const details = await ws.getFileDetails(file.id);
  assert.equal(details.nopCount, nops.length);
  assert.equal(details.isisTagCount, nops.filter((n) => n.isisTag).length);
});

test('the compact sheet model builds the same sheets and a layout for the viewer', () => {
  const duplex = {
    name: 'M1', duplex: 'normal', inputBin: null, outputBin: null, mediaType: null, nUp: 1,
    pagePositions: [{ x: 0, y: 0, rotation: 0 }], mediumOverlays: [], mediumSize: null,
  };
  const formdef = { mediumMaps: new Map([['M1', duplex]]), first: duplex };
  const model = buildSheetModel(3, [null, null, null], new Set(), formdef);
  assert.equal(model.count, 2);
  assert.deepEqual([...model.layout().firstPage], [1, 3, 4]);
  assert.deepEqual([...model.layout().hasBack], [1, 0]);
  assert.deepEqual(model.sheet(2), buildSheets(3, [null, null, null], new Set(), formdef).sheets[1]);
  assert.equal(model.sheet(3), null);
});

test('search: indexing stops at the memory limit; hits beyond the first come resolved on demand', async () => {
  const { ws, file } = await open('us4-search', { searchEntryLimit: 1 });
  let state;
  do state = await ws.buildSearchIndex({ budgetMs: 1000 }); while (!state.done);
  assert.deepEqual(state.limited, { pages: 1, totalPages: state.progress.total });
  const limited = await ws.search({ text: 'Zürich' });
  assert.equal(limited.results.length, 0, 'page 2 is not indexed');
  assert.equal(limited.indexing, false);
  assert.deepEqual(limited.limited, state.limited);

  const full = await open('us4-search');
  while (!(await full.ws.buildSearchIndex({ budgetMs: 1000 })).done);
  const [hit] = (await full.ws.search({ text: 'Müller', fileId: full.file.id })).results;
  assert.equal(hit.resolved, true);
  const light = { ...hit, resolved: false, excerpt: null, highlight: null, match: null, location: { ...hit.location, itemIndex: undefined } };
  delete light.location.itemIndex;
  assert.deepEqual(await full.ws.resolveSearchHit(light), hit);
});

test('Blob sources serve small reads from cached windows, as copies, and large reads directly', async () => {
  const { createBlobSource } = await import('../../src/lib/io/byte-source.js');
  const bytes = new Uint8Array(1_000_000).map((_, i) => (i * 7) & 0xff);
  let slices = 0;
  const blob = new Blob([bytes]);
  const counting = { size: blob.size, slice: (a, b) => { slices++; return blob.slice(a, b); } };
  const source = createBlobSource(counting, 'x.afp');
  for (let at = 1000; at < 200_000; at += 2500) assert.deepEqual([...await source.read(at, 100)], [...bytes.subarray(at, at + 100)]);
  assert.equal(slices, 1, 'consecutive small reads share one window');
  const a = await source.read(5000, 10);
  a[0] ^= 0xff;
  assert.equal((await source.read(5000, 10))[0], bytes[5000], 'reads are copies');
  assert.deepEqual([...await source.read(900_000, 99_999)], [...bytes.subarray(900_000, 999_999)]);
  assert.deepEqual([...await source.read(999_990, 100)], [...bytes.subarray(999_990)]);
});
