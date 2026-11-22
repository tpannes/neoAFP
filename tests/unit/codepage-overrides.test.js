/**
 * Code page overrides (T103, FR-037, spec US2 scenario 7): the `tle` override re-decodes only TLE
 * text, `nop` only NOP text, `text` only other text (the text of glyph runs, used for search and
 * copying, and the default text column of the hex view; the glyphs drawn stay the same), and
 * null restores the code pages given in the file.
 *
 * Expected strings follow from the byte values in the fixtures and the code page charts:
 * EBCDIC 500 X'4A' '[' and X'5A' ']' are '¢' and '!' in EBCDIC 037; EBCDIC letters read as
 * ISO 8859-1 give Latin-1 letters (X'C1' 'Á', X'D5' 'Õ', X'40' '@').
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';

/**
 * Loads the structure fixture (TLEs, NOPs) and the text fixture (glyph runs) into one workspace.
 * @returns {Promise<{ws: object, structure: string, text: string}>} Workspace and file ids.
 */
async function load() {
  const ws = createWorkspace();
  const files = [];
  for (const name of ['us2-structure', 'us1-text']) {
    const { buildBytes } = await import(`../fixtures/synthetic/${name}.fixture.js`);
    files.push(createBufferSource(buildBytes(), `${name}.afp`));
  }
  const [structure, text] = await ws.addFiles(files, 'file');
  return { ws, structure: structure.id, text: text.id };
}

/**
 * Collects the texts of all three categories.
 * @param {object} ws Workspace.
 * @param {{structure: string, text: string}} ids File ids.
 * @returns {Promise<{tles: string[], nops: string[], runs: string[], ids: Array[]}>} Texts.
 */
async function texts(ws, { structure, text }) {
  const model = await ws.getRenderModel(text, 1);
  const runs = model.items.filter((i) => i.type === 'glyphRun');
  return {
    tles: (await ws.getTles(structure)).map((t) => `${t.name}=${t.value}`),
    nops: (await ws.getNops(structure)).map((n) => n.text),
    runs: runs.map((r) => r.text),
    ids: runs.map((r) => r.ids),
  };
}

test('each override changes only its own category, null restores the file code pages', async () => {
  const { ws, structure, text } = await load();
  const base = await texts(ws, { structure, text });
  assert.deepEqual(base.tles, ['Straße=Größe Ä!', 'ACCOUNT=A-100 [7]', 'PAGETAG=P1 [X]', 'REGION=NORD', 'LANG=EN!']);
  assert.equal(base.runs[0], 'ABC CAB');

  ws.setCodePageOverride('tle', 'ebcdic-037');
  const tle = await texts(ws, { structure, text });
  assert.equal(tle.tles[1], 'ACCOUNT=A-100 ¢7!');
  assert.ok((await ws.getTles(structure)).every((t) => t.codePage === 'ebcdic-037'));
  assert.deepEqual([tle.nops, tle.runs, tle.ids], [base.nops, base.runs, base.ids]);
  ws.setCodePageOverride('tle', null);

  ws.setCodePageOverride('nop', 'iso-8859-1');
  const nop = await texts(ws, { structure, text });
  assert.equal(nop.nops[0], 'ÕÅÖÁÆ×@ÆÉçãäÙÅ@ñ');
  assert.deepEqual([nop.tles, nop.runs], [base.tles, base.runs]);
  ws.setCodePageOverride('nop', null);

  ws.setCodePageOverride('text', 'iso-8859-1');
  const other = await texts(ws, { structure, text });
  assert.equal(other.runs[0], 'ÁÂÃ@ÃÁÂ');
  assert.deepEqual(other.ids, base.ids, 'the glyphs drawn do not change');
  assert.deepEqual([other.tles, other.nops], [base.tles, base.nops]);
  const { rows } = await ws.getHex(structure, 25, 25);
  // NOP introducer X'5A 0018 D3EEEE 00 0000', then the data, read as ISO 8859-1.
  assert.equal(rows[0].text, 'Z··Óîî···ÕÅÖÁÆ×@');
  ws.setCodePageOverride('text', null);

  assert.deepEqual(await texts(ws, { structure, text }), base);
});

test('hex rows: 16 bytes per row with offsets, text in a given code page', async () => {
  const { ws, structure } = await load();
  const { rows } = await ws.getHex(structure, 25, 25, 'ebcdic-037');
  assert.deepEqual(rows.map((r) => r.offset), [25, 41]);
  assert.equal(rows[0].hex, '5A 00 18 D3 EE EE 00 00 00 D5 C5 D6 C1 C6 D7 40');
  assert.equal(rows[0].text, '!··LÓÓ···NEOAFP ');
  assert.equal(rows[1].hex, 'C6 C9 E7 E3 E4 D9 C5 40 F1');
  assert.equal(rows[1].text, 'FIXTURE 1');
});
