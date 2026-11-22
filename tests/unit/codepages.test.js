/**
 * Tests for code page decoding (task T014): EBCDIC single-byte, double-byte and mixed code pages,
 * ASCII-based and Unicode encodings, and the list of selectable code pages (research R9).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listCodePages, decodeText, codePageIdFromCcsid } from '../../src/lib/codepages/index.js';

test('EBCDIC single-byte code pages', async () => {
  assert.equal(await decodeText('ebcdic-037', Uint8Array.of(0xc1, 0xc2, 0x40, 0xf1)), 'AB 1');
  assert.equal(await decodeText('ebcdic-273', Uint8Array.of(0x4a)), 'Ä');
  assert.equal(await decodeText('ebcdic-1140', Uint8Array.of(0x9f)), '€');
  assert.equal(await decodeText('ebcdic-500', Uint8Array.of(0x5a)), ']');
});

test('mixed EBCDIC: shift-out/shift-in switch between one- and two-byte characters', async () => {
  const bytes = Uint8Array.of(0xc1, 0x0e, 0x45, 0x62, 0x45, 0x66, 0x0f, 0xc1);
  assert.equal(await decodeText('ebcdic-939', bytes), 'A日本A');
  assert.equal(await decodeText('ebcdic-930', Uint8Array.of(0x0e, 0x40, 0x40, 0x0f)), '　');
});

test('double-byte EBCDIC including characters outside the basic plane', async () => {
  assert.equal(await decodeText('ebcdic-300', Uint8Array.of(0x45, 0x62)), '日');
  assert.equal(await decodeText('ebcdic-1390', Uint8Array.of(0x0e, 0xb3, 0x8d, 0x0f)), '\u{20B9F}');
});

test('unmapped bytes become U+FFFD', async () => {
  assert.equal(await decodeText('ebcdic-939', Uint8Array.of(0x0e, 0xff, 0xff, 0x0f)), '�');
});

test('ASCII-based and Unicode encodings', async () => {
  assert.equal(await decodeText('windows-1252', Uint8Array.of(0x80)), '€');
  assert.equal(await decodeText('iso-8859-1', Uint8Array.of(0x80, 0xe4)), '\u0080ä');
  assert.equal(await decodeText('shift-jis', Uint8Array.of(0x93, 0xfa)), '日');
  assert.equal(await decodeText('gb18030', Uint8Array.of(0xd6, 0xd0)), '中');
  assert.equal(await decodeText('utf-16be', Uint8Array.of(0x00, 0x41, 0x65, 0xe5)), 'A日');
  assert.equal(await decodeText('utf-16le', Uint8Array.of(0x41, 0x00)), 'A');
  assert.equal(await decodeText('utf-8', Uint8Array.of(0xc3, 0xa4)), 'ä');
});

test('every code page from research R9 can be selected', () => {
  const ids = listCodePages().map((cp) => cp.id);
  const expected = [37, 273, 277, 278, 280, 284, 285, 297, 500, 871, 1047, 1140, 1141, 1142, 1143,
    1144, 1145, 1146, 1147, 1148, 1149, 300, 930, 939, 1390, 1399, 935, 1388]
    .map((n) => `ebcdic-${String(n).padStart(3, '0')}`)
    .concat(['iso-8859-1', 'iso-8859-15', 'windows-1252', 'shift-jis', 'gbk', 'gb18030', 'utf-8', 'utf-16be']);
  for (const id of expected) assert.ok(ids.includes(id), `missing ${id}`);
  for (const cp of listCodePages()) assert.ok(['ebcdic', 'ascii', 'unicode'].includes(cp.kind));
});

test('CCSIDs from AFP files map to code pages', () => {
  assert.equal(codePageIdFromCcsid(500), 'ebcdic-500');
  assert.equal(codePageIdFromCcsid(1200), 'utf-16be');
  assert.equal(codePageIdFromCcsid(819), 'iso-8859-1');
  assert.equal(codePageIdFromCcsid(99999), null);
});

test('all generated tables load', async () => {
  for (const { id } of listCodePages()) await decodeText(id, Uint8Array.of(0x41));
});
