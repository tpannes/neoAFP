/**
 * Triplet previews for the structure tree and triplet texts in their code pages (MO:DCA Reference
 * AFPC-0004-11, chapter 6). Byte values follow the triplet syntax tables; expected texts follow
 * from them (EBCDIC 500 X'C1' 'A', UTF-16BE for CCSID 1200, 1440 units per inch, …).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTriplets } from '../../src/lib/modca/registry/triplets.js';
import { tripletPreviews, tripletTexts } from '../../src/lib/modca/triplet-preview.js';
import { bytes, triplet, uint, ebcdic, utf16be } from '../helpers/afp-builder.js';

/**
 * Previews of triplet bytes, without an inherited code page.
 * @param {...Uint8Array} parts Triplets.
 * @returns {Promise<object[]>} Previews.
 */
const previews = async (...parts) => tripletPreviews(parseTriplets(bytes(...parts)), null);

test('FQN: type and name in the code page of the CGCSGID before it', async () => {
  const [cp, fqn] = await previews(triplet(0x01, uint(0, 2), uint(1200, 2)), triplet(0x02, 0x0b, 0x00, utf16be('Kundennummer')));
  assert.equal(cp.value, 'CCSID 1200 · UTF-16 big-endian');
  assert.deepEqual(fqn, { key: 'Attribute GID', value: 'Kundennummer', color: null });
  const [font] = await previews(triplet(0x02, 0x8e, 0x00, ebcdic('X0NOTR00')));
  assert.deepEqual(font, { key: 'Coded Font', value: 'X0NOTR00', color: null });
});

test('the attribute value is read in the TLE code page (details fix), an override wins', async () => {
  const t = parseTriplets(bytes(triplet(0x01, uint(0, 2), uint(1200, 2)), triplet(0x36, 0x00, 0x00, utf16be('Petra Schröder'))));
  assert.deepEqual(await tripletTexts(t, null), [null, 'Petra Schröder']);
  const e = parseTriplets(bytes(triplet(0x36, 0x00, 0x00, ebcdic('ABC'))));
  assert.deepEqual(await tripletTexts(e, { id: 'ebcdic-500' }), ['ABC']);
  // EBCDIC 500 X'4A' is '[', EBCDIC 037 X'4A' is '¢'.
  const b = parseTriplets(bytes(triplet(0x36, 0x00, 0x00, 0x4a)));
  assert.deepEqual(await tripletTexts(b, { id: 'ebcdic-500' }), ['[']);
  assert.deepEqual(await tripletTexts(b, { id: 'ebcdic-500' }, 'ebcdic-037'), ['¢']);
});

test('units, area size in millimeters, orientation, object type', async () => {
  const [mu, oas, mo, rot] = await previews(
    triplet(0x4b, 0x00, 0x00, uint(14400, 2), uint(14400, 2)),
    triplet(0x4c, 0x02, uint(11906, 3), uint(16838, 3)),
    triplet(0x68, 0x01),
    triplet(0x21, 0xfc),
  );
  assert.equal(mu.value, '1440 / in');
  assert.equal(oas.value, '210 × 297 mm');
  assert.equal(mo.value, 'Landscape');
  assert.equal(rot.value, 'Overlay');
});

test('colors with a swatch: RGB, CMYK, CIELab, OCA; highlight without', async () => {
  // Color Specification: reserved, ColSpce, 4 reserved, ColSize1–4, ColValue.
  const cs = (space, sizes, ...value) => triplet(0x4e, 0x00, space, 0, 0, 0, 0, ...sizes, ...value);
  const [rgb, cmyk, lab, oca, hl] = await previews(
    cs(0x01, [8, 8, 8, 0], 0, 90, 180),
    cs(0x04, [8, 8, 8, 8], 255, 0, 0, 0),
    cs(0x08, [8, 8, 8, 0], 255, 0, 0),
    cs(0x40, [16, 0, 0, 0], 0x00, 0x02),
    cs(0x06, [16, 0, 0, 0], 0x00, 0x01),
  );
  assert.deepEqual(rgb, { key: 'RGB', value: '0 90 180', color: '#005ab4' });
  assert.deepEqual(cmyk, { key: 'CMYK', value: '100 0 0 0 %', color: '#00ffff' });
  assert.equal(lab.key, 'CIELab');
  assert.equal(lab.value, '100 0 0');
  assert.deepEqual(oca, { key: 'OCA', value: 'Red', color: '#ff0000' });
  assert.deepEqual(hl, { key: 'Highlight', value: '#1', color: null });
});

test('time stamp, comment, font descriptor', async () => {
  // Local Date and Time Stamp: type, THunYear X'F0' (20xx), TenYear "26", Day "330", time 14:03:12.00.
  const [ldts, comment, fds] = await previews(
    triplet(0x62, 0x00, 0xf0, ebcdic('26330140312' + '00')),
    triplet(0x65, ebcdic('Erzeugt von neoAFP')),
    triplet(0x1f, 0x07, 0x05, uint(240, 2), uint(0, 2), 0x80, ...Array(12).fill(0)),
  );
  assert.deepEqual(ldts, { key: 'Created', value: '2026-11-26 14:03:12', color: null });
  assert.equal(comment.value, 'Erzeugt von neoAFP');
  assert.equal(fds.value, '12 pt · Bold · Italic');
});

test('triplets without a preview give null', async () => {
  assert.deepEqual(await previews(triplet(0x80, uint(1, 4), uint(1, 4))), [null]);
});
