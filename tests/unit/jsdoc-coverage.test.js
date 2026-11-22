/**
 * Code documentation (T164, constitution rule on code documentation): every top-level function in
 * src/ — `function` declarations (exported or not) and top-level `const name = (…) =>` / `function`
 * expressions — has a JSDoc block right before it with a description, one `@param` per parameter
 * (destructured parameters count as one) and `@returns` when the function returns a value.
 * Generated tables (src/lib/codepages/tables/) and vendored code are excluded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ROOT } from '../conformance/fixtures.js';

/**
 * Lists the JavaScript files below a folder.
 * @param {string} dir Folder.
 * @returns {Promise<string[]>} Paths.
 */
async function sources(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (!p.includes('codepages/tables')) out.push(...await sources(p)); } else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/**
 * Splits a parameter list at top-level commas.
 * @param {string} list Text between the parentheses.
 * @returns {string[]} Parameters.
 */
function splitParams(list) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * Finds the body of a function starting at an opening brace, or the expression of an arrow.
 * @param {string} src Source.
 * @param {number} at Position after the parameter list.
 * @returns {string} Body text.
 */
function bodyAt(src, at) {
  let i = at;
  while (/\s/.test(src[i])) i++;
  if (src.startsWith('=>', i)) {
    i += 2;
    while (/\s/.test(src[i])) i++;
    if (src[i] !== '{') return 'return expression';
  }
  if (src[i] !== '{') return '';
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  return src.slice(i);
}

/**
 * Tells whether a body returns a value at its own level (not inside nested functions).
 * @param {string} body Function body.
 * @returns {boolean} True if a `return <value>` appears outside nested functions.
 */
function returnsValue(body) {
  if (body === 'return expression') return true;
  // Remove nested function bodies (arrows with braces and function expressions) before searching.
  let text = body.slice(1, -1);
  for (let k = 0; k < 20; k++) {
    const next = text.replace(/(=>\s*|function\s*\w*\s*\([^)]*\)\s*)\{[^{}]*\}/g, '$1null');
    if (next === text) break;
    text = next;
  }
  return /\breturn\s+[^;\s]/.test(text);
}

const DECLARATION = /^(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(/gm;
const ARROW = /^(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?(?:function\s*\w*\s*)?\(/gm;

test('every top-level function has a complete JSDoc block', async () => {
  const problems = [];
  for (const file of [...await sources(join(ROOT, 'src/lib')), ...await sources(join(ROOT, 'src/viewer'))]) {
    const src = await readFile(file, 'utf8');
    for (const re of [DECLARATION, ARROW]) {
      for (const m of src.matchAll(re)) {
        const name = m[1];
        const open = m.index + m[0].length - 1;
        let depth = 0;
        let close = open;
        for (; close < src.length; close++) {
          if (src[close] === '(') depth++;
          else if (src[close] === ')' && --depth === 0) break;
        }
        if (re === ARROW && !/^\s*=>/.test(src.slice(close + 1, close + 6))) continue; // not a function
        const params = splitParams(src.slice(open + 1, close));
        const before = src.slice(0, m.index).trimEnd();
        const where = `${relative(ROOT, file)}: ${name}`;
        if (!before.endsWith('*/')) { problems.push(`${where}: no JSDoc`); continue; }
        const doc = before.slice(before.lastIndexOf('/**'));
        const lines = doc.split('\n').map((l) => l.replace(/^\s*\/?\*+\/?\s?/, '').trim()).filter(Boolean);
        if (!lines.length || lines[0].startsWith('@')) problems.push(`${where}: no description`);
        const paramTags = (doc.match(/@param\b/g) ?? []).length;
        const needed = params.length;
        if (paramTags < needed) problems.push(`${where}: ${needed} parameters, ${paramTags} @param`);
        if (returnsValue(bodyAt(src, close + 1)) && !/@returns?\b/.test(doc)) problems.push(`${where}: no @returns`);
      }
    }
  }
  assert.deepEqual(problems, [], `${problems.length} functions without complete JSDoc:\n${problems.join('\n')}`);
});
