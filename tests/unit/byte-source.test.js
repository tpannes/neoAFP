/**
 * Tests for byte sources (task T010): reading parts of in-memory data and files on disk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBufferSource, createNodeFileSource } from '../../src/lib/index.js';

const DATA = Uint8Array.from({ length: 100 }, (_, i) => i);

/**
 * Checks reads at the start, middle, end and past the end of a source.
 * @param {import('../../src/lib/io/byte-source.js').ByteSource} source Source over DATA.
 * @returns {Promise<void>} Resolves when all checks passed.
 */
async function checkReads(source) {
  assert.equal(source.size, 100);
  assert.deepEqual([...await source.read(0, 3)], [0, 1, 2]);
  assert.deepEqual([...await source.read(50, 2)], [50, 51]);
  assert.deepEqual([...await source.read(98, 10)], [98, 99]);
  assert.equal((await source.read(100, 5)).length, 0);
  assert.equal((await source.read(500, 5)).length, 0);
  await assert.rejects(() => source.read(-1, 2), RangeError);
}

test('buffer source reads parts of the data', async () => {
  const source = createBufferSource(DATA, 'data.bin');
  assert.equal(source.name, 'data.bin');
  assert.equal(source.path, 'data.bin');
  await checkReads(source);
});

test('node file source reads parts of a file on disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'neoafp-'));
  const file = join(dir, 'data.bin');
  await writeFile(file, DATA);
  const source = await createNodeFileSource(file);
  try {
    assert.equal(source.name, 'data.bin');
    await checkReads(source);
  } finally {
    await source.close();
    await rm(dir, { recursive: true });
  }
});
