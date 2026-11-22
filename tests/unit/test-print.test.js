/**
 * Test print detection (feature request 2026-11-08): the word "TEST" drawn from strokes (rules or
 * graphics lines, outlined or solid) is found on a page whatever its position and size, in the
 * reading direction of the page, and only when the complete word is there. The reference shape is an
 * outlined "TEST" of 40 PTOCA rules (coordinates relative to the word's top-left corner).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findTestPrint } from '../../src/lib/render/test-print.js';

/** The 40 rules of the reference "TEST" (x1, y1, x2, y2), thickness 22. */
const REFERENCE = [
  [0, 11, 832, 11], [821, 0, 821, 184], [486, 173, 832, 173], [497, 162, 497, 1156], [324, 1145, 508, 1145],
  [335, 162, 335, 1156], [0, 173, 346, 173], [11, 0, 11, 184],
  [972, 11, 1642, 11], [1631, 0, 1631, 184], [1134, 173, 1642, 173], [1145, 162, 1145, 508], [1134, 497, 1480, 497],
  [1469, 486, 1469, 670], [1134, 659, 1480, 659], [1145, 648, 1145, 994], [1134, 983, 1642, 983], [1631, 972, 1631, 1156],
  [972, 1145, 1642, 1145], [983, 0, 983, 1156],
  [1782, 11, 2452, 11], [2441, 0, 2441, 184], [1944, 173, 2452, 173], [1955, 162, 1955, 508], [1944, 497, 2452, 497],
  [2441, 486, 2441, 1156], [1782, 1145, 2452, 1145], [1793, 972, 1793, 1156], [1782, 983, 2290, 983], [2279, 648, 2279, 994],
  [1782, 659, 2290, 659], [1793, 0, 1793, 670],
  [2592, 11, 3424, 11], [3413, 0, 3413, 184], [3078, 173, 3424, 173], [3089, 162, 3089, 1156], [2916, 1145, 3100, 1145],
  [2927, 162, 2927, 1156], [2592, 173, 2938, 173], [2603, 0, 2603, 184],
];

/**
 * Builds rule items.
 * @param {number[][]} lines Lines.
 * @param {{dx?: number, dy?: number, scale?: number, thickness?: number, rotate?: number}} [o] Transform.
 * @returns {object[]} Rule items.
 */
function rules(lines, o = {}) {
  const { dx = 0, dy = 0, scale = 1, thickness = 22, rotate = 0 } = o;
  const tf = (x, y) => (rotate === 90 ? [-y, x] : rotate === 180 ? [-x, -y] : rotate === 270 ? [y, -x] : [x, y]);
  return lines.map(([x1, y1, x2, y2]) => {
    const [a, b] = tf(x1 * scale, y1 * scale);
    const [c, d] = tf(x2 * scale, y2 * scale);
    return { type: 'rule', x1: a + dx, y1: b + dy, x2: c + dx, y2: d + dy, thickness: thickness * scale, color: '#000000', sourceField: 7 };
  });
}

/** Unrelated page content: text, a table grid and a box. */
function pageContent() {
  const grid = [];
  for (let i = 0; i <= 6; i++) grid.push([1000, 6000 + i * 400, 10000, 6000 + i * 400], [1000 + i * 1500, 6000, 1000 + i * 1500, 8400]);
  return [
    { type: 'glyphRun', x: 1000, y: 3000, text: 'Hello', font: { size: 240 }, dx: [0, 100, 200, 300, 400] },
    ...rules(grid, { thickness: 10 }),
    ...rules([[1000, 10000, 4000, 10000], [4000, 10000, 4000, 11000], [4000, 11000, 1000, 11000], [1000, 11000, 1000, 10000]], { thickness: 30 }),
  ];
}

/**
 * Indexes of the test print items in a list.
 * @param {object[]} items Items.
 * @returns {number[]} Sorted indexes.
 */
const found = (items) => [...findTestPrint(items)].sort((a, b) => a - b);
const range = (from, n) => Array.from({ length: n }, (_, i) => from + i);

test('the reference outline "TEST" among other content', () => {
  const content = pageContent();
  const items = [...content, ...rules(REFERENCE, { dx: 4802, dy: 1199 })];
  assert.deepEqual(found(items), range(content.length, 40));
});

test('other positions and sizes', () => {
  for (const [scale, dx, dy] of [[0.4, 300, 15000], [2.5, 1000, 12000], [0.15, 9000, 200]]) {
    const items = [...rules(REFERENCE, { dx, dy, scale }), ...pageContent()];
    assert.deepEqual(found(items), range(0, 40), `scale ${scale}`);
  }
});

test('only in the reading direction of the page', () => {
  for (const rotate of [90, 180, 270]) {
    const items = [...pageContent(), ...rules(REFERENCE, { dx: 12000, dy: 12000, rotate })];
    assert.deepEqual(found(items), [], `rotate ${rotate}`);
  }
});

test('solid letters from thick strokes and from graphics paths', () => {
  // Block letters drawn as thick strokes (bar width ~ 0.15 of the height).
  const h = 1000;
  const w = 15 * h / 100;
  const bars = (x) => ({
    T: [[x, w / 2, x + 700, w / 2], [x + 350, 0, x + 350, h]],
    E: [[x + w / 2, 0, x + w / 2, h], [x, w / 2, x + 600, w / 2], [x, h / 2, x + 450, h / 2], [x, h - w / 2, x + 600, h - w / 2]],
    S: [[x, w / 2, x + 600, w / 2], [x + w / 2, 0, x + w / 2, h / 2], [x, h / 2, x + 600, h / 2], [x + 600 - w / 2, h / 2, x + 600 - w / 2, h], [x, h - w / 2, x + 600, h - w / 2]],
  });
  const word = [...bars(0).T, ...bars(850).E, ...bars(1600).S, ...bars(2350).T];
  const solid = rules(word, { dx: 2000, dy: 2000, thickness: w });
  assert.equal(found([...pageContent(), ...solid]).length, word.length);
  // The same as stroked graphics paths.
  const paths = word.map(([x1, y1, x2, y2]) => ({ type: 'path', commands: [['M', x1 + 2000, y1 + 2000], ['L', x2 + 2000, y2 + 2000]], stroke: '#000000', fill: null, lineWidth: w, sourceField: 9 }));
  assert.equal(found(paths).length, paths.length);
});

test('only the complete word: partial words, other words and plain content are kept', () => {
  const letters = [REFERENCE.slice(0, 8), REFERENCE.slice(8, 20), REFERENCE.slice(20, 32), REFERENCE.slice(32)];
  assert.deepEqual(found(rules([...letters[0], ...letters[1], ...letters[2]], { dx: 500, dy: 500 })), [], 'TES');
  assert.deepEqual(found(rules([...letters[1], ...letters[2], ...letters[3]], { dx: 500, dy: 500 })), [], 'EST');
  // "TETS": letters present but not in the right order.
  const tets = [...letters[0], ...letters[1], ...letters[3].map(([a, b, c, d]) => [a - 810, b, c - 810, d]), ...letters[2].map(([a, b, c, d]) => [a + 810, b, c + 810, d])];
  assert.deepEqual(found(rules(tets, { dx: 500, dy: 500 })), [], 'TETS');
  assert.deepEqual(found(pageContent()), []);
  assert.deepEqual(found([]), []);
});
