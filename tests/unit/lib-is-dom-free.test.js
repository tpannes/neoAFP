/**
 * Principle II check (task T019): the library in src/lib/ must not use the browser page (DOM)
 * or import viewer code, so it runs in workers and Node.js.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT } from '../conformance/fixtures.js';

/**
 * Lists all JavaScript files below a folder.
 * @param {string} dir Absolute folder path.
 * @returns {Promise<string[]>} Absolute file paths.
 */
async function jsFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await jsFiles(path));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

const FORBIDDEN = [/\bwindow\b/, /\bdocument\./, /\bDOMParser\b/, /\bHTMLElement\b/, /from\s+['"][^'"]*viewer\//];

test('src/lib does not use the DOM or import viewer code', async () => {
  const offenders = [];
  for (const file of await jsFiles(join(ROOT, 'src/lib'))) {
    if (file.includes('/codepages/tables/')) continue; // generated data
    const code = (await readFile(file, 'utf8'))
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/\/\/.*$/gm, ''); // line comments
    for (const pattern of FORBIDDEN) {
      if (pattern.test(code)) offenders.push(`${file.slice(ROOT.length + 1)}: ${pattern}`);
    }
  }
  assert.deepEqual(offenders, []);
});
