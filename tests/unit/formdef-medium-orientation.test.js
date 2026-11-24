/**
 * Medium Orientation triplet X'68' on the Medium Descriptor (MO:DCA Reference AFPC-0004-11,
 * "Medium Orientation Triplet X'68'"): form definitions usually give A4 as 210 × 297 mm and turn
 * the medium presentation space with landscape (X'01'); the sheet is then 297 × 210 mm and the
 * page positions are measured in the turned space (2-up A5 side by side).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { bytes, field, uint, ebcdic, triplet, group, resourceGroup, resource, documentOf, environmentGroup, ID } from '../helpers/afp-builder.js';

const UNITS = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2));

/**
 * Builds a file with a 2-up form definition on A4 and two A5 pages.
 * @param {number|null} orientation MedOrient of triplet X'68', or null for none.
 * @returns {Uint8Array} AFP bytes.
 */
function file(orientation) {
  const mdd = field('D3A688', bytes(UNITS, uint(11906, 3), uint(16838, 3), 0x00, orientation === null ? [] : triplet(0x68, orientation)));
  const mcc = field('D3A288', bytes(uint(1, 2), uint(1, 2), 0x00, 0x01));
  const mmc = field('D3A788', bytes(0x01, 0x00, 0xf4, 0x01, 0xfc, 0x02));
  const pgp = field('D3B1AF', bytes(0x00, 10, uint(0, 3), uint(0, 3), uint(0, 2), 0x00, 0x00, uint(8419, 3), uint(0, 3), uint(0, 2), 0x00, 0x00));
  const formdef = resource('F1TWOUP1', 0xfe, group('D3A8CD', 'F1TWOUP1', group('D3A8C4', 'DEG00001', mdd), group('D3A8CC', 'M1TWOUP1', mcc, mmc, pgp)));
  const a5 = (name) => group(ID.BPG, name, environmentGroup(8419, 11906));
  return bytes(resourceGroup(formdef), documentOf('TWOUPDOC', a5('PAGE0001'), a5('PAGE0002')));
}

/**
 * Opens a file and returns its first sheet.
 * @param {Uint8Array} afp AFP bytes.
 * @returns {Promise<object>} Sheet 1.
 */
async function firstSheet(afp) {
  const ws = createWorkspace();
  const [f] = await ws.addFiles([createBufferSource(afp, 'twoup.afp')], 'file');
  return ws.getSheet(f.id, 1);
}

test('landscape medium orientation turns the A4 sheet: 297 × 210 mm, two A5 pages side by side', async () => {
  const sheet = await firstSheet(file(0x01));
  assert.deepEqual(sheet.mediumSize, { width: 16838, height: 11906 });
  assert.deepEqual(sheet.front.placements.map((p) => [p.pageNumber, p.x, p.y]), [[1, 0, 0], [2, 8419, 0]]);
});

test('reverse landscape turns the sheet as well; portrait and no triplet keep it', async () => {
  assert.deepEqual((await firstSheet(file(0x03))).mediumSize, { width: 16838, height: 11906 });
  assert.deepEqual((await firstSheet(file(0x00))).mediumSize, { width: 11906, height: 16838 });
  assert.deepEqual((await firstSheet(file(null))).mediumSize, { width: 11906, height: 16838 });
});
