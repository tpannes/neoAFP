/**
 * Tests for the structured field index (task T012): typed-array columns, Begin/End pairing,
 * page positions and lookup by byte offset.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFieldIndex } from '../../src/lib/modca/field-index.js';
import { createBufferSource } from '../../src/lib/index.js';
import { bytes, field, documentOf, page, pageGroup, nop, listFields, ID } from '../helpers/afp-builder.js';

const DOC = documentOf('DOC1', pageGroup('GRP1', page('PAGE1', nop('x'))), page('PAGE2'));

test('columns use the planned typed arrays', async () => {
  const index = await buildFieldIndex(createBufferSource(DOC, 't'));
  assert.ok(index.offset instanceof Float64Array);
  assert.ok(index.length instanceof Uint16Array);
  assert.ok(index.id instanceof Uint32Array);
  assert.ok(index.parent instanceof Int32Array);
  assert.ok(index.flags instanceof Uint8Array);
  assert.equal(index.count, listFields(DOC).length);
});

test('Begin/End pairing gives every field its enclosing group', async () => {
  const index = await buildFieldIndex(createBufferSource(DOC, 't'));
  const rows = [...Array(index.count).keys()].map((r) => index.get(r));
  const byId = (hex) => rows.filter((r) => r.idHex === hex);
  const [bdt] = byId(ID.BDT);
  const [edt] = byId(ID.EDT);
  const [bng] = byId(ID.BNG);
  const [bpg1, bpg2] = byId(ID.BPG);
  const [nopRow] = byId(ID.NOP);
  assert.equal(bdt.parent, -1);
  assert.equal(bdt.end, edt.index);
  assert.equal(edt.parent, -1);
  assert.equal(bng.parent, bdt.index);
  assert.equal(bpg1.parent, bng.index);
  assert.equal(bpg2.parent, bdt.index);
  assert.equal(nopRow.parent, bpg1.index);
  assert.deepEqual(index.pages, [bpg1.index, bpg2.index]);
  assert.deepEqual(index.pairingProblems, []);
  assert.deepEqual(index.children(-1), [bdt.index, edt.index]);
});

test('finds the field at a byte offset', async () => {
  const index = await buildFieldIndex(createBufferSource(DOC, 't'));
  const fields = listFields(DOC);
  assert.equal(index.findAtOffset(fields[3].offset + 2), 3);
  assert.equal(index.findAtOffset(DOC.length + 10), null);
});

test('reports End fields without Begin and Begins that are never closed', async () => {
  const data = bytes(field(ID.BDT, []), field(ID.BPG, []), field(ID.EDT, []), field(ID.EPG, []));
  const index = await buildFieldIndex(createBufferSource(data, 't'));
  const problems = index.pairingProblems.map((p) => p.problem).sort();
  assert.deepEqual(problems, ['endWithoutBegin', 'notClosed']);
});

test('grows beyond the initial capacity', async () => {
  const many = bytes(...Array.from({ length: 5000 }, () => nop('n')));
  const index = await buildFieldIndex(createBufferSource(many, 't'));
  assert.equal(index.count, 5000);
  assert.equal(index.get(4999).idHex, ID.NOP);
});
