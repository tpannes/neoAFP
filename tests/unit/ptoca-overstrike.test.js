/**
 * PTOCA Overstrike (OVS X'72'; PTOCA Reference AFPC-0009-04, "Overstrike (OVS)"; task T307): the
 * text between a beginning OVS (bypass bits 4–7 non-zero) and an ending OVS (zero) or the end of
 * the object is overstruck with OVERCHAR, placed side by side over each overstrike area, as many
 * as fit (rounded down, at least one). Bypass bit 4 skips white space of relative moves, bit 5 of
 * absolute moves, bit 6 of space characters; bit 7 (X'01') overstrikes everything. Baseline moves
 * and backward moves end an area.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPtoca } from '../../src/lib/ptoca/ptoca.js';
import { bytes, uint } from '../helpers/afp-builder.js';
import { cs, AMB, AMI, RMI, BLN, SBI } from '../helpers/fixture-text.js';

/** A font of the test: every character 10 units wide, "~" (X'7E') 7 units, X'40' a space. */
const FONT = {
  split: (b) => [...b].map((code) => ({ code })),
  glyph: (code) => ({ id: `g${code}`, unicode: code === 0x40 ? ' ' : String.fromCharCode(code), advance: code === 0x7e ? 7 : 10, variableSpace: code === 0x40 }),
  baselineIncrement: 240,
  underscore: { position: 2, width: 1 },
};
const OVS = (flags, char) => cs(0x72, flags, uint(char, 2));
const text = (s) => cs(0xda, ...[...s].map((c) => (c === ' ' ? 0x40 : c.charCodeAt(0))));

/**
 * Runs text controls and returns the overstrike runs as [start, count, baseline].
 * @param {...Uint8Array} controls Control sequences.
 * @returns {number[][]} One entry per overstrike area.
 */
function overstrikes(...controls) {
  const { segments } = runPtoca([bytes(AMB(500), AMI(100), ...controls)], { k: 1, font: () => FONT, report: () => {} });
  return segments.filter((s) => s.overstrike).map((s) => [s.i, s.glyphs.length, s.b, s.glyphs[0].code]);
}

test('the overstrike character covers the text side by side', () => {
  assert.deepEqual(overstrikes(OVS(0x01, 0x60), text('ABC'), OVS(0x00, 0)), [[100, 3, 500, 0x60]]);
});

test('as many characters as fit, rounded down, and at least one', () => {
  assert.deepEqual(overstrikes(OVS(0x01, 0x7e), text('ABC'), OVS(0x00, 0)), [[100, 4, 500, 0x7e]], '30 / 7');
  // A variable space of 5 units (SVI X'C4'): shorter than one overstrike character.
  assert.deepEqual(overstrikes(cs(0xc4, uint(5, 2)), OVS(0x01, 0x7e), text(' '), OVS(0x00, 0)), [[100, 1, 500, 0x7e]], '5 / 7');
});

test('bypass bit 6 skips spaces; without bypass they are overstruck', () => {
  assert.deepEqual(overstrikes(OVS(0x02, 0x60), text('AB CD'), OVS(0x00, 0)), [[100, 2, 500, 0x60], [130, 2, 500, 0x60]]);
  assert.deepEqual(overstrikes(OVS(0x01, 0x60), text('AB CD'), OVS(0x00, 0)), [[100, 5, 500, 0x60]]);
});

test('bypass bits 4 and 5 skip the white space of relative and absolute moves', () => {
  assert.deepEqual(overstrikes(OVS(0x01, 0x60), text('A'), RMI(20), text('B'), OVS(0x00, 0)), [[100, 4, 500, 0x60]], 'no bypass');
  assert.deepEqual(overstrikes(OVS(0x08, 0x60), text('A'), RMI(20), text('B'), OVS(0x00, 0)), [[100, 1, 500, 0x60], [130, 1, 500, 0x60]]);
  assert.deepEqual(overstrikes(OVS(0x04, 0x60), text('A'), AMI(200), text('B'), OVS(0x00, 0)), [[100, 1, 500, 0x60], [200, 1, 500, 0x60]]);
  assert.deepEqual(overstrikes(OVS(0x08, 0x60), text('A'), AMI(200), text('B'), OVS(0x00, 0)), [[100, 11, 500, 0x60]], 'AMI not bypassed');
});

test('backward moves, new lines and the end of the object end an area', () => {
  assert.deepEqual(overstrikes(OVS(0x01, 0x60), text('AB'), AMI(100), text('C'), OVS(0x00, 0)), [[100, 2, 500, 0x60], [100, 1, 500, 0x60]]);
  assert.deepEqual(overstrikes(SBI(240), OVS(0x01, 0x60), text('AB'), BLN(), AMI(100), text('C')), [[100, 2, 500, 0x60], [100, 1, 740, 0x60]]);
});

test('no overstrike without OVS, or after an ending OVS', () => {
  assert.deepEqual(overstrikes(text('AB')), []);
  assert.deepEqual(overstrikes(OVS(0x01, 0x60), OVS(0x00, 0), text('AB')), []);
});
