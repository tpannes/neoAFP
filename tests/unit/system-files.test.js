/**
 * Operating system metadata in opened folders (.DS_Store, AppleDouble "._" files, Thumbs.db,
 * desktop.ini) is skipped without a message; the same names opened as single files are read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { isSystemFile } from '../../src/lib/io/system-files.js';
import { documentOf, page } from '../helpers/afp-builder.js';

test('system metadata names are recognized, other names are not', () => {
  for (const p of ['.DS_Store', 'afp/.DS_Store', '._O1BOOK.OVL', 'fonts\\Thumbs.db', 'THUMBS.DB', 'desktop.ini']) {
    assert.equal(isSystemFile(p), true, p);
  }
  for (const p of ['DS_Store', 'my.DS_Store.afp', 'doc._afp', 'thumbs.db.afp', 'O1BOOK.OVL']) {
    assert.equal(isSystemFile(p), false, p);
  }
});

test('a folder import skips system metadata files without a diagnostic', async () => {
  const junk = new Uint8Array([0, 0, 0, 1, 0x42, 0x75, 0x64, 0x31]);
  const sources = [
    createBufferSource(documentOf('DOC00001', page('PAGE0001')), 'doc.afp', 'afp/doc.afp'),
    createBufferSource(junk, '.DS_Store', '.DS_Store'),
    createBufferSource(junk, '.DS_Store', 'afp/.DS_Store'),
    createBufferSource(junk, '._doc.afp', 'afp/._doc.afp'),
    createBufferSource(junk, 'Thumbs.db', 'afp/Thumbs.db'),
  ];
  const ws = createWorkspace();
  const added = await ws.addFiles(sources, 'folder');
  assert.deepEqual(added.map((f) => f.path), ['afp/doc.afp']);
  assert.deepEqual(ws.getDiagnostics(), []);
});

test('a .DS_Store opened as a single file is still read (and reported as not AFP)', async () => {
  const ws = createWorkspace();
  const added = await ws.addFiles([createBufferSource(new Uint8Array([0, 0, 0, 1]), '.DS_Store')], 'file');
  assert.equal(added.length, 1);
  assert.equal(added[0].kind, 'notRecognized');
});
