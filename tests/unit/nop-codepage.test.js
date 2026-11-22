/**
 * NOP code page without a user choice (T109 follow-up, FR-036/FR-037): NOP data has no code page
 * in the file, and generators write comments in EBCDIC or ASCII — even mixed in one file. Each
 * NOP is shown in EBCDIC 273 or Windows-1252, whichever reads better; ties go to EBCDIC 273; NOPs
 * that are text in neither (under half their bytes readable) stay EBCDIC 273; a chosen NOP code
 * page applies to all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { bytes, documentOf, page, nop } from '../helpers/afp-builder.js';

const ascii = (s) => new Uint8Array(Buffer.from(s, 'latin1'));

test('each NOP gets the code page it reads best in; an override applies to all', async () => {
  const afp = documentOf('NOPDOC01', nop('Created by neoAFP (EBCDIC)'), nop(ascii('Created by neoAFP (ASCII), 2026-11-07')),
    nop(bytes(0x00, 0x01, 0xff)), page('PAGE0001'));
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(afp, 'nops.afp')], 'file');
  const nops = await ws.getNops(file.id);
  assert.deepEqual(nops.map((n) => [n.codePage, n.text]), [
    ['ebcdic-273', 'Created by neoAFP (EBCDIC)'],
    ['windows-1252', 'Created by neoAFP (ASCII), 2026-11-07'],
    ['ebcdic-273', '···'],
  ]);
  ws.setCodePageOverride('nop', 'windows-1252');
  assert.ok((await ws.getNops(file.id)).every((n) => n.codePage === 'windows-1252'));
});

test('a NOP that is text in neither code page stays EBCDIC 273, even if Windows-1252 reads a little better', async () => {
  // Like the binary tables of font resources: an ASCII label followed by binary data.
  const table = new Uint8Array([...ascii('Increm1 $'), ...Array.from({ length: 15 }, (_, i) => i)]);
  const afp = documentOf('NOPDOC02', nop(table), page('PAGE0001'));
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(afp, 'binary-nop.afp')], 'file');
  const [n] = await ws.getNops(file.id);
  assert.equal(n.codePage, 'ebcdic-273');
  assert.equal('hex' in n, false);
});

test('ISIS Papyrus tagging NOPs are marked in ASCII and EBCDIC; NOPs on a page know the page', async () => {
  // " $ISIS_TAG" in EBCDIC 273: blank X'40', "$" X'5B', I S I S X'C9E2C9E2', "_" X'6D', T A G X'E3C1C7'.
  const ebcdicTag = bytes(0x40, 0x5b, 0xc9, 0xe2, 0xc9, 0xe2, 0x6d, 0xe3, 0xc1, 0xc7);
  const afp = documentOf('NOPDOC03', nop(ascii('$ISIS_TAG <P>')), nop(ebcdicTag), nop(ascii('Not $ISIS_TAG')),
    page('PAGE0001', nop(ascii('  $ISIS_TAG </P>'))));
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(afp, 'isis.afp')], 'file');
  const nops = await ws.getNops(file.id);
  assert.deepEqual(nops.map((n) => [n.isisTag, n.pageNumber]), [[true, null], [true, null], [false, null], [true, 1]]);
  // The flag does not depend on the code page chosen for NOPs.
  ws.setCodePageOverride('nop', 'ebcdic-037');
  assert.deepEqual((await ws.getNops(file.id)).map((n) => n.isisTag), [true, true, false, true]);
});

test('ASCII-like NOP text with valid multi-byte UTF-8 sequences is read as UTF-8', async () => {
  const utf8 = new Uint8Array(Buffer.from('$ISIS_TAG Alt Grüße aus Köln', 'utf8'));
  const afp = documentOf('NOPDOC04', nop(utf8), nop(ascii('Müller in Windows-1252')), page('PAGE0001'));
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(afp, 'utf8.afp')], 'file');
  assert.deepEqual((await ws.getNops(file.id)).map((n) => [n.codePage, n.text]), [
    ['utf-8', '$ISIS_TAG Alt Grüße aus Köln'],
    ['windows-1252', 'Müller in Windows-1252'],
  ]);
});
