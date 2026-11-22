/**
 * Robustness tests (task T016, SC-006): damaged, truncated and non-AFP input never makes the
 * library throw; earlier content is kept and at least one diagnostic explains the problem.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { bytes, documentOf, page, nop, listFields } from '../helpers/afp-builder.js';

const DOC = documentOf('DOC1', page('PAGE1', nop('first')), page('PAGE2'));

/**
 * Pseudo-random bytes with a fixed seed, so the test is repeatable.
 * @param {number} n Number of bytes.
 * @param {number} seed Start value.
 * @returns {Uint8Array} Bytes.
 */
function randomBytes(n, seed) {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

const corruptedLength = DOC.slice();
corruptedLength[listFields(DOC)[3].offset + 1] = 0x7f; // field 4 claims to be far too long

const CASES = [
  ['truncated AFP', DOC.subarray(0, DOC.length - 10), { keepsFields: listFields(DOC).length - 1 }],
  ['random bytes', randomBytes(5000, 7), {}],
  ['random bytes starting with X\'5A\'', bytes(0x5a, randomBytes(5000, 11)), {}],
  ['a PDF file', new TextEncoder().encode('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n'), {}],
  ['an empty file', new Uint8Array(0), {}],
  ['a corrupted length field', corruptedLength, { keepsFields: 3 }],
];

for (const [name, data, { keepsFields }] of CASES) {
  test(`${name}: no exception, earlier content kept, explained by a diagnostic`, async () => {
    const ws = createWorkspace();
    const [file] = await ws.addFiles([createBufferSource(data, 'x.afp')], 'file');
    assert.notEqual(file.state, 'failed');
    if (keepsFields !== undefined) assert.equal(file.fieldCount, keepsFields);
    assert.ok(ws.getDiagnostics({ fileId: file.id }).length >= 1, 'at least one diagnostic');
  });
}
