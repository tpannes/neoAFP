/**
 * TLE browser table (T192, FR-035): one row per owner (page group, page, document) with its
 * first and last page, one column per attribute name in first-seen order, repeated names joined.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tleTable, pagesWithin } from '../../src/lib/meta/tle-table.js';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';

test('rows per owner, columns per name, repeated names joined', () => {
  const t = (index, name, value, ownerType, ownerRef, pageNumber = null) => ({ index, name, value, ownerType, ownerRef, ownerName: `N${ownerRef}`, pageNumber });
  const table = tleTable([
    t(1, 'Name', 'Ann', 'pageGroup', 0), t(2, 'Zip', '1', 'pageGroup', 0), t(3, 'Zip', '2', 'pageGroup', 0),
    t(9, 'Name', 'Bob', 'pageGroup', 8), t(12, 'Tag', 'x', 'page', 11, 3), t(20, 'Doc', 'd', 'document', null),
  ], (ref) => ({ 0: [1, 2], 8: [3, 3], 11: [3, 3] })[ref] ?? null);
  assert.deepEqual(table.columns, ['Name', 'Zip', 'Tag', 'Doc']);
  assert.deepEqual(table.rows.map((r) => [r.ownerType, r.ownerName, r.firstPage, r.lastPage, r.fieldIndex, r.values]), [
    ['pageGroup', 'N0', 1, 2, 1, { Name: 'Ann', Zip: '1; 2' }],
    ['pageGroup', 'N8', 3, 3, 9, { Name: 'Bob' }],
    ['page', 'N11', 3, 3, 12, { Tag: 'x' }],
    ['document', 'Nnull', null, null, 20, { Doc: 'd' }],
  ]);
});

test('pagesWithin finds the pages between a Begin field and its End', () => {
  const index = { pages: [3, 10, 20], end: Object.assign(new Array(30).fill(-1), { 0: 25, 2: 15, 16: 18 }) };
  assert.deepEqual(pagesWithin(index, 0), [1, 3]);
  assert.deepEqual(pagesWithin(index, 2), [1, 2]);
  assert.equal(pagesWithin(index, 16), null);
});

test('workspace: page groups and pages of a document', async () => {
  const { buildBytes } = await import('../fixtures/synthetic/us2-structure.fixture.js');
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(buildBytes(), 'us2.afp')], 'file');
  const table = await ws.getTleTable(file.id);
  assert.deepEqual(table.columns, ['Straße', 'ACCOUNT', 'PAGETAG', 'REGION', 'LANG']);
  assert.deepEqual(table.rows.map((r) => `${r.ownerType} ${r.ownerName} ${r.firstPage}-${r.lastPage}`), [
    'pageGroup GROUP001 1-2', 'page PAGE0001 1-1', 'pageGroup GROUP002 2-2', 'page PAGE0002 2-2',
  ]);
  assert.equal(table.rows[2].values.REGION, 'NORD');
});
