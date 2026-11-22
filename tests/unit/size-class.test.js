/**
 * Size classes (T124, FR-053, data-model "Size class rules"), with L the longer and S the shorter
 * side in mm: icon L ≤ 25; small 25 < L ≤ 75; medium 75 < L ≤ 150; a4 |S − 210| ≤ 5 and
 * |L − 297| ≤ 5; largerThanA4 S > 215 or L > 302; large all other sizes with L > 150; no
 * dimensions → notApplicable; a4 is checked before large.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sizeClass } from '../../src/lib/resources/size-class.js';

const CASES = [
  [25, 10, 'icon'], [25.1, 10, 'small'], [75, 75, 'small'], [75.1, 20, 'medium'], [150, 150, 'medium'],
  [150.1, 100, 'large'], [210, 297, 'a4'], [297, 210, 'a4'], [214, 301, 'a4'], [216, 297, 'largerThanA4'],
  [200, 303, 'largerThanA4'], [null, null, 'notApplicable'], [100, null, 'notApplicable'],
  [215, 302, 'a4'], [204, 297, 'large'], [215, 260, 'large'],
];

for (const [w, h, expected] of CASES) {
  test(`${w} × ${h} mm → ${expected}`, () => assert.equal(sizeClass(w, h), expected));
}
