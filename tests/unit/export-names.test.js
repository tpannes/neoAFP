/**
 * File names of the TLE and NOP exports (T209): the AFP file's name without a ".afp" extension,
 * then "_TLE" or "_NOP" and ".csv" or ".json". Only ".afp" is removed (any case): AFP files are
 * recognized by content, and mainframe names contain dots that are not extensions.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableFileName } from '../../src/viewer/download.js';

test('removes a .afp extension in any case', () => {
  assert.equal(tableFileName('statement.afp', '_TLE', 'csv'), 'statement_TLE.csv');
  assert.equal(tableFileName('STATEMENT.AFP', '_NOP', 'json'), 'STATEMENT_NOP.json');
});

test('keeps names without a .afp extension whole', () => {
  assert.equal(tableFileName('BT01234.Q01.000012345600001', '_NOP', 'csv'), 'BT01234.Q01.000012345600001_NOP.csv');
  assert.equal(tableFileName('letters.prn', '_TLE', 'json'), 'letters.prn_TLE.json');
});

test('uses the file name of a folder path, and "file" when there is no name', () => {
  assert.equal(tableFileName('batch/2026/run.afp', '_TLE', 'csv'), 'run_TLE.csv');
  assert.equal(tableFileName('', '_NOP', 'csv'), 'file_NOP.csv');
  assert.equal(tableFileName(undefined, '_NOP', 'json'), 'file_NOP.json');
});
