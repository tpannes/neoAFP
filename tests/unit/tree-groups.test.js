/**
 * Groups of like items in the structure tree (FR-030): runs of three or more items with the same
 * identifier (fields or triplets) become one group; shorter runs, and fields beside triplets with
 * the same code, stay as they are.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupNodes, MIN_GROUP } from '../../src/viewer/tree-groups.js';

const field = (row, code) => ({ id: String(row), type: 'field', row, code, kind: 'tle', shortName: 'TLE', fullName: 'Tag Logical Element', offset: row * 10, length: 10, pageNumber: null });
const triplet = (row, i, code) => ({ id: `${row}.${i}`, type: 'triplet', row, tripletIndex: i, code, kind: 'triplet', offset: 1000 + i, length: 1 });

test('runs of like fields become groups; shorter runs stay', () => {
  const nodes = [field(1, 'D3A8AD'), field(2, 'D3A090'), field(3, 'D3A090'), field(4, 'D3A090'), field(5, 'D3A090'), field(6, 'D3EEEE'), field(7, 'D3EEEE')];
  const out = groupNodes(nodes);
  assert.equal(MIN_GROUP, 3);
  assert.deepEqual(out.map((n) => n.id), ['1', 'g:2', '6', '7']);
  const g = out[1];
  assert.deepEqual([g.type, g.count, g.row, g.offset, g.length, g.hasChildren], ['group', 4, 2, 20, 40, true]);
  assert.deepEqual(g.members.map((m) => m.id), ['2', '3', '4', '5']);
  assert.ok(g.memberIds.has('4'));
});

test('triplets group by identifier, never together with fields', () => {
  const nodes = [triplet(9, 0, '02'), triplet(9, 1, '02'), triplet(9, 2, '02'), field(10, '02'), triplet(9, 3, '36')];
  const out = groupNodes(nodes);
  assert.deepEqual(out.map((n) => n.id), ['g:9.0', '10', '9.3']);
  assert.equal(out[0].memberType, 'triplet');
  assert.equal(out[0].tripletIndex, 0);
});
