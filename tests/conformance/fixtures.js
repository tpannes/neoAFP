/**
 * Shared loading of test fixtures for the conformance tests.
 *
 * Two kinds of fixtures exist:
 * - synthetic fixtures `tests/fixtures/synthetic/*.fixture.js`, which export `build(files)`
 *   returning `{ bytes, expected }` and optionally `inputs` (files to load and pass to build);
 * - local reference fixtures `<AFP_SAMPLES>/tests/reference/<name>/expected.json`, kept with
 *   your own sample documents outside the repository; they name their input file(s) relative
 *   to the samples folder. Without AFP_SAMPLES there are none.
 */
import { readdir, readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Repository root. */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Optional folder with your own sample documents (environment variable AFP_SAMPLES), or null.
 * Its subfolder tests/ may hold local tests (see local-tests.test.js) and reference fixtures.
 */
export const SAMPLES = process.env.AFP_SAMPLES || null;

/** The local tests folder `<AFP_SAMPLES>/tests`, or null. */
export const LOCAL_TESTS = SAMPLES ? join(SAMPLES, 'tests') : null;

/**
 * Tells whether a path exists.
 * @param {string} path Absolute path.
 * @returns {Promise<boolean>} True if it exists.
 */
export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Loads all synthetic fixtures.
 * @returns {Promise<{name: string, bytes: Uint8Array, expected: object}[]>} Built fixtures.
 */
export async function loadSyntheticFixtures() {
  const dir = join(ROOT, 'tests/fixtures/synthetic');
  const names = (await readdir(dir)).filter((n) => n.endsWith('.fixture.js')).sort();
  const out = [];
  for (const name of names) {
    const mod = await import(pathToFileURL(join(dir, name)).href);
    const files = {};
    for (const [key, rel] of Object.entries(mod.inputs ?? {})) {
      files[key] = new Uint8Array(await readFile(join(ROOT, rel)));
    }
    const { bytes, expected, extra } = await mod.build(files);
    out.push({ name, bytes, expected, extra });
  }
  return out;
}

/**
 * Lists all files below a folder (without .DS_Store), sorted.
 * @param {string} dir Absolute folder path.
 * @returns {Promise<string[]>} Absolute file paths.
 */
async function listFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(path));
    else if (entry.name !== '.DS_Store') out.push(path);
  }
  return out.sort();
}

/**
 * Loads all reference fixture expectations (without their input files).
 * @returns {Promise<{name: string, expected: object, inputs: string[], available: boolean}[]>}
 *   Expectations, their input paths (absolute) and whether all inputs exist on this machine.
 */
export async function loadReferenceFixtures() {
  const out = [];
  if (!LOCAL_TESTS) return out;
  const dir = join(LOCAL_TESTS, 'reference');
  if (!await exists(dir)) return out;
  for (const entry of (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory())) {
    const expected = JSON.parse(await readFile(join(dir, entry.name, 'expected.json'), 'utf8'));
    const named = [expected.input, ...(expected.additionalInputs ?? [])].filter(Boolean);
    const available = (await Promise.all(named.map((p) => exists(join(SAMPLES, p))))).every(Boolean);
    // Entries ending in "/" are folders: all their files (recursively) are loaded, like a folder
    // opened in the viewer; the main input comes first and is not loaded twice.
    const inputs = [];
    if (available) {
      for (const p of named) {
        const files = p.endsWith('/') ? await listFiles(join(SAMPLES, p)) : [join(SAMPLES, p)];
        for (const f of files) if (!inputs.includes(f)) inputs.push(f);
      }
    }
    out.push({ name: entry.name, expected, inputs, available });
  }
  return out;
}

/**
 * Hashes every byte array inside a value (depth first, object keys in insertion order).
 * @param {*} value Pixels returned by getImagePixels.
 * @returns {string} SHA-256 hex digest.
 */
export function pixelHash(value) {
  const hash = createHash('sha256');
  const walk = (v) => {
    if (v instanceof Uint8Array || v instanceof Uint8ClampedArray) hash.update(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return hash.digest('hex');
}
