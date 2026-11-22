/**
 * Locale file tests (task T018, SC-010): every listed language has a complete file with the
 * same placeholders as English.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../conformance/fixtures.js';

const DIR = join(ROOT, 'src/viewer/locales');

/**
 * Reads a JSON file.
 * @param {string} name File name in the locales folder.
 * @returns {Promise<object>} Parsed content.
 */
async function json(name) {
  return JSON.parse(await readFile(join(DIR, name), 'utf8'));
}

/**
 * Lists the {placeholders} of a message.
 * @param {string} text Message.
 * @returns {string[]} Sorted placeholder names.
 */
function placeholders(text) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

const index = await json('index.json');
const en = await json('en.json');

test('English is complete', () => {
  assert.ok(index.languages.includes('en'));
  assert.equal(index.fallback, 'en');
  for (const [key, value] of Object.entries(en.messages)) {
    assert.ok(typeof value === 'string' && value.trim() !== '', `en.json: empty value for ${key}`);
  }
});

for (const tag of index.languages) {
  test(`${tag}.json has every key with the same placeholders`, async () => {
    const locale = await json(`${tag}.json`);
    assert.equal(locale.meta.tag, tag);
    assert.ok(locale.meta.name);
    for (const [key, value] of Object.entries(en.messages)) {
      assert.ok(key in locale.messages, `${tag}: missing ${key}`);
      assert.deepEqual(placeholders(locale.messages[key]), placeholders(value), `${tag}: placeholders of ${key}`);
    }
  });
}
