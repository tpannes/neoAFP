/**
 * Color conversion of PTOCA/GOCA extended colors: results are always valid "#rrggbb" values
 * (regression: CMYK gave fractional components, e.g. "#e38f.5252…", which browsers ignore).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extendedColor } from '../../src/lib/ptoca/ptoca.js';

/**
 * Builds Set Extended Color data: reserved, color space, 4 reserved, bits per component, values.
 * @param {number} space Color space code.
 * @param {number[]} values Component values.
 * @returns {Uint8Array} Data.
 */
const sec = (space, values) => Uint8Array.of(0, space, 0, 0, 0, 0, 8, 8, 8, 8, ...values);

test('RGB, CMYK and CIELab give valid hex colors', () => {
  assert.equal(extendedColor(sec(0x01, [0x50, 0xbe, 0x00])), '#50be00');
  assert.equal(extendedColor(sec(0x04, [0, 0, 0, 0])), '#ffffff');
  assert.equal(extendedColor(sec(0x04, [0, 0, 0, 255])), '#000000');
  for (const c of [sec(0x04, [0x6b, 0x24, 0x00, 0x66]), sec(0x08, [128, 10, 200])]) {
    assert.match(extendedColor(c), /^#[0-9a-f]{6}$/);
  }
});
