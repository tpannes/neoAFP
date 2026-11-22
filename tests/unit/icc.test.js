/**
 * ICC profiles (T101, FR-039): header fields (ICC.1:2010 section 7.2: size, version, profile/
 * device class, color space, PCS, rendering intent) and the profile description from an ICC v2
 * 'desc' (textDescriptionType) or v4 'mluc' (multiLocalizedUnicodeType) tag, read from minimal
 * profiles built in tests/helpers/fixture-meta.js; also the CMR header and tags (CMOCA).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIccProfile } from '../../src/lib/meta/icc.js';
import { parseCmr } from '../../src/lib/meta/cmr.js';
import { iccProfile, cmr, cmrName } from '../helpers/fixture-meta.js';

test('v4 display profile with mluc description', () => {
  const bytes = iccProfile({ version: 0x04300000, deviceClass: 'mntr', colorSpace: 'RGB ', pcs: 'XYZ ', intent: 0, description: 'Display ✓' });
  assert.deepEqual(parseIccProfile(bytes), {
    size: bytes.length, version: '4.3.0', deviceClass: 'mntr', colorSpace: 'RGB', pcs: 'XYZ',
    renderingIntent: 'perceptual', description: 'Display ✓',
  });
});

test('v2 output profile with desc description and every rendering intent', () => {
  const intents = ['perceptual', 'relativeColorimetric', 'saturation', 'absoluteColorimetric'];
  intents.forEach((name, intent) => {
    const bytes = iccProfile({ version: 0x02100000, deviceClass: 'prtr', colorSpace: 'CMYK', pcs: 'Lab ', intent, description: 'Press' });
    const p = parseIccProfile(bytes);
    assert.deepEqual([p.version, p.deviceClass, p.colorSpace, p.pcs, p.renderingIntent, p.description], ['2.1.0', 'prtr', 'CMYK', 'Lab', name, 'Press']);
  });
});

test('data that is not an ICC profile gives null', () => {
  assert.equal(parseIccProfile(new Uint8Array(200)), null);
  assert.equal(parseIccProfile(new Uint8Array(20)), null);
});

test('CMR header fields, name and ICC profile tags', () => {
  const profile = iccProfile({ version: 0x04300000, deviceClass: 'mntr', colorSpace: 'RGB ', pcs: 'XYZ ', intent: 0, description: 'sRGB' });
  const values = { CMRAlias: 'ALIAS001', CMRType: 'CC', CMRVersion: '001.200', MediaColor: 'wht', Prop1: 'mntr', Prop4: 'RGB', Prop5: 'XYZ' };
  const name = new Uint8Array(Buffer.from('profile.icc', 'latin1'));
  const c = parseCmr(cmr(values, [
    { id: 0x0004, type: 0x06, count: 7, data: new Uint8Array(Buffer.from('comment', 'latin1')) },
    { id: 0x3015, type: 0x05, count: profile.length, data: profile },
    { id: 0x3025, type: 0x06, count: name.length, data: name },
  ]));
  assert.equal(c.name, cmrName(values));
  assert.deepEqual([c.alias, c.cmrType, c.version, c.comment, c.profileFilename], ['ALIAS001', 'CC', '001.200', 'comment', 'profile.icc']);
  assert.deepEqual(c.fields.find((f) => f.name === 'MediaColor'), { name: 'MediaColor', value: 'wht' });
  assert.equal(c.iccProfile.description, 'sRGB');
  assert.equal(parseCmr(new Uint8Array(100)), null);
});
