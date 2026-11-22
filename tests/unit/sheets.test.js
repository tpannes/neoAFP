/**
 * Sheet model (T053, data-model "Sheet"): default medium map without form definition (simplex,
 * 1-up), duplex with an odd page count (back side without placements), tumble orientation of the
 * back side, N-up placements with partitions, page ↔ sheet mapping, and a new sheet at every
 * Invoke Medium Map.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSheets, printInfoOf } from '../../src/lib/formdef/sheets.js';

/**
 * Builds a medium map.
 * @param {object} o Settings.
 * @returns {object} Medium map.
 */
const map = (o) => ({
  name: 'M1', duplex: 'simplex', inputBin: null, outputBin: null, mediaType: null, nUp: 1,
  pagePositions: [{ x: 0, y: 0, rotation: 0, side: 'front' }], mediumOverlays: [], mediumSize: null, copies: 1, ...o,
});
const formdef = (...maps) => ({ mediumMaps: new Map(maps.map((m) => [m.name, m])), first: maps[0] });
const pagesOf = (side) => side?.placements.map((p) => p.pageNumber) ?? null;

test('without a form definition: simplex, one page per sheet, print information not specified', () => {
  const { sheets, sheetOfPage } = buildSheets(3, [null, null, null], new Set(), null);
  assert.equal(sheets.length, 3);
  assert.deepEqual(sheets.map((s) => [pagesOf(s.front), s.back]), [[[1], null], [[2], null], [[3], null]]);
  assert.deepEqual(sheetOfPage.slice(1), [1, 2, 3]);
  assert.deepEqual(printInfoOf(sheets[0]), { duplex: 'simplex', inputBin: null, outputBin: null, mediaType: null, mediumMap: null });
});

test('duplex with an odd page count leaves the last back side empty', () => {
  const { sheets, sheetOfPage } = buildSheets(3, [null, null, null], new Set(), formdef(map({ duplex: 'normal' })));
  assert.deepEqual(sheets.map((s) => [pagesOf(s.front), pagesOf(s.back)]), [[[1], [2]], [[3], []]]);
  assert.deepEqual(sheetOfPage.slice(1), [1, 1, 2]);
});

test('tumble duplex turns the back side upside down, normal duplex does not', () => {
  const [tumble] = buildSheets(2, [null, null], new Set(), formdef(map({ duplex: 'tumble' }))).sheets;
  assert.deepEqual([tumble.front.orientation, tumble.back.orientation], [0, 180]);
  const [normal] = buildSheets(2, [null, null], new Set(), formdef(map({ duplex: 'normal' }))).sheets;
  assert.deepEqual([normal.front.orientation, normal.back.orientation], [0, 0]);
});

test('2-up duplex places pages at the positions with their partition numbers', () => {
  const positions = [{ x: 0, y: 0, rotation: 0 }, { x: 8419, y: 0, rotation: 90 }];
  const { sheets } = buildSheets(5, Array(5).fill(null), new Set(), formdef(map({ duplex: 'normal', nUp: 2, pagePositions: positions })));
  assert.equal(sheets.length, 2);
  assert.deepEqual(sheets[0].front.placements, [
    { pageNumber: 1, x: 0, y: 0, rotation: 0, partition: 1, flags: 0, pmcId: null },
    { pageNumber: 2, x: 8419, y: 0, rotation: 90, partition: 2, flags: 0, pmcId: null },
  ]);
  assert.deepEqual(pagesOf(sheets[0].back), [3, 4]);
  assert.deepEqual([pagesOf(sheets[1].front), pagesOf(sheets[1].back)], [[5], []]);
});

test('an Invoke Medium Map starts a new sheet with the new settings', () => {
  const fd = formdef(map({ name: 'M1', duplex: 'normal', inputBin: 2 }), map({ name: 'M2', inputBin: 1 }));
  // IMM M2 before page 2: page 1 keeps its sheet alone (its back stays empty).
  const { sheets, sheetOfPage } = buildSheets(3, [null, 'M2', 'M2'], new Set([2]), fd);
  assert.deepEqual(sheets.map((s) => [s.mediumMap, s.duplex, s.inputBin, pagesOf(s.front), pagesOf(s.back)]), [
    ['M1', 'normal', 2, [1], []], ['M2', 'simplex', 1, [2], null], ['M2', 'simplex', 1, [3], null],
  ]);
  assert.deepEqual(sheetOfPage.slice(1), [1, 2, 3]);
});

test('forced duplex pairs the pages of simplex maps in order, also across Invoke Medium Map', () => {
  const fd = formdef(map({ name: 'M1', inputBin: 1, mediumOverlays: ['O1'] }), map({ name: 'M2', inputBin: 2, mediumOverlays: ['O2'] }));
  // IMM M2 before page 2 and before page 3: the real model has one sheet per page.
  const real = buildSheets(3, ['M1', 'M2', 'M2'], new Set([2, 3]), fd);
  assert.deepEqual(real.sheets.map((s) => [pagesOf(s.front), s.back]), [[[1], null], [[2], null], [[3], null]]);
  const { sheets, sheetOfPage } = buildSheets(3, ['M1', 'M2', 'M2'], new Set([2, 3]), fd, { forceDuplex: true });
  assert.deepEqual(sheets.map((s) => [pagesOf(s.front), pagesOf(s.back), s.duplex, s.forced]), [
    [[1], [2], 'simplex', true],
    [[3], [], 'simplex', true],
  ]);
  assert.deepEqual(sheetOfPage.slice(1), [1, 1, 2]);
  // The back side shows the overlays of its own page's map.
  assert.deepEqual([sheets[0].mediumOverlays, sheets[0].back.mediumOverlays, sheets[0].back.orientation], [['O1'], ['O2'], 0]);
});

test('forced duplex leaves sheets of duplex maps as the form definition defines them', () => {
  const fd = formdef(map({ name: 'D', duplex: 'tumble' }), map({ name: 'S' }));
  const pages = ['D', 'D', 'S', 'S', 'D'];
  const { sheets } = buildSheets(5, pages, new Set([1, 3, 5]), fd, { forceDuplex: true });
  assert.deepEqual(sheets.map((s) => [pagesOf(s.front), pagesOf(s.back), s.duplex, s.forced, s.back.orientation]), [
    [[1], [2], 'tumble', false, 180],
    [[3], [4], 'simplex', true, 0],
    [[5], [], 'tumble', false, 180],
  ]);
});
