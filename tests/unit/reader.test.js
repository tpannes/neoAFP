/**
 * Tests for the structured field reader (task T011): field boundaries, extensions, padding,
 * segmentation, separators between records (FR-006) and early end of data (FR-080).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanFields } from '../../src/lib/modca/reader.js';
import { createBufferSource } from '../../src/lib/index.js';
import { bytes, field, documentOf, page, nop, withSeparators, listFields, ID } from '../helpers/afp-builder.js';

/**
 * Reads all fields of a byte array.
 * @param {Uint8Array} data AFP bytes.
 * @param {object} [options] Reader options.
 * @returns {Promise<{fields: object[], summary: object}>} Fields and summary.
 */
async function read(data, options) {
  const fields = [];
  const summary = await scanFields(createBufferSource(data, 't.afp'), (f) => { fields.push(f); }, options);
  return { fields, summary };
}

const DOC = documentOf('DOC1', page('PAGE1', nop('hello')), page('PAGE2'));

test('reads every field with offset, length and identifier', async () => {
  const { fields, summary } = await read(DOC);
  const expected = listFields(DOC);
  assert.equal(fields.length, expected.length);
  fields.forEach((f, i) => {
    assert.equal(f.offset, expected[i].offset);
    assert.equal(f.length, expected[i].length);
    assert.equal(f.id.toString(16).toUpperCase(), expected[i].id);
  });
  assert.equal(summary.truncatedAt, null);
  assert.equal(summary.recordFormat, 'plain');
});

test('data position skips extension and padding; segmented flag is kept', async () => {
  const data = bytes(
    field(ID.NOP, [1, 2, 3], { extension: [9, 9] }),
    field(ID.NOP, [4, 5], { padding: 4 }),
    field(ID.NOP, [6], { padding: 300 }),
    field(ID.NOP, [7, 8], { segmented: true }),
  );
  const { fields } = await read(data);
  const payload = (f) => [...data.subarray(f.dataOffset, f.dataOffset + f.dataLength)];
  assert.deepEqual(payload(fields[0]), [1, 2, 3]);
  assert.deepEqual(payload(fields[1]), [4, 5]);
  assert.deepEqual(payload(fields[2]), [6]);
  assert.deepEqual(payload(fields[3]), [7, 8]);
  assert.ok(fields[3].flags & 0x20);
});

for (const [name, separator, format] of [
  ['CR/LF', [0x0d, 0x0a], 'lineBreaks'],
  ['LF', [0x0a], 'lineBreaks'],
  ['blank padding', [0x40, 0x40, 0x40], 'padded'],
  ['zero padding', [0x00, 0x00], 'padded'],
]) {
  test(`skips ${name} between fields (FR-006)`, async () => {
    const plain = await read(DOC);
    const separated = withSeparators(DOC, separator);
    const { fields, summary } = await read(separated);
    assert.equal(summary.truncatedAt, null);
    assert.equal(summary.recordFormat, format);
    assert.deepEqual(fields.map((f) => f.id), plain.fields.map((f) => f.id));
    // Offsets refer to the file with separators; data is still found correctly.
    fields.forEach((f) => assert.equal(separated[f.offset], 0x5a));
  });
}

test('accepts an end-of-file marker X\'1A\' at the very end (text-mode transfers)', async () => {
  const data = bytes(withSeparators(DOC, [0x0d, 0x0a]), [0x1a]);
  const { fields, summary } = await read(data);
  assert.equal(fields.length, listFields(DOC).length);
  assert.equal(summary.truncatedAt, null);
  assert.equal(summary.sawEndOfFileMarker, true);
});

test('an X\'1A\' followed by more data is still reported', async () => {
  const data = bytes(DOC, [0x1a], DOC);
  const { summary } = await read(data);
  assert.equal(summary.truncatedAt, DOC.length);
});

test('stops at an unexpected byte and keeps earlier fields (FR-080)', async () => {
  const data = bytes(DOC, [0x41, 0x42], DOC);
  const { fields, summary } = await read(data);
  assert.equal(fields.length, listFields(DOC).length);
  assert.equal(summary.truncatedAt, DOC.length);
  assert.equal(summary.truncatedReason, 'unexpectedByte');
});

test('stops when a field extends beyond the end of the file', async () => {
  const data = DOC.subarray(0, DOC.length - 3);
  const { fields, summary } = await read(data);
  assert.equal(fields.length, listFields(DOC).length - 1);
  assert.equal(summary.truncatedReason, 'fieldBeyondEnd');
});

test('stops at an invalid length', async () => {
  const data = bytes(field(ID.NOP, [1]), [0x5a, 0x00, 0x03, 0xd3, 0xee, 0xee, 0, 0, 0]);
  const { fields, summary } = await read(data);
  assert.equal(fields.length, 1);
  assert.equal(summary.truncatedReason, 'invalidLength');
});

test('reads correctly across window boundaries', async () => {
  const many = bytes(...Array.from({ length: 3000 }, (_, i) => nop(`comment ${i}`)));
  const separated = withSeparators(many, [0x0d, 0x0a]);
  const { fields, summary } = await read(separated, { windowSize: 40000 });
  assert.equal(fields.length, 3000);
  assert.equal(summary.truncatedAt, null);
});

test('the visitor can stop reading early', async () => {
  let n = 0;
  const summary = await scanFields(createBufferSource(DOC, 't'), () => ++n < 3);
  assert.equal(n, 3);
  assert.equal(summary.stoppedByVisitor, true);
});
