/**
 * Local tests: tests for your own sample documents, which stay outside the repository. When the
 * environment variable AFP_SAMPLES names a folder with a subfolder tests/, every *.test.js file
 * in it is loaded here, so `node --test tests/` runs them with the others. Without it nothing
 * is loaded.
 *
 * A local test imports repository modules through NEOAFP_ROOT, which is set here to the
 * repository root, e.g.
 *   const root = pathToFileURL(`${process.env.NEOAFP_ROOT}/`);
 *   const { createWorkspace } = await import(new URL('src/lib/index.js', root).href);
 * The same folder may hold reference fixtures in tests/reference/ (see fixtures.js).
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, LOCAL_TESTS, exists } from './fixtures.js';

if (LOCAL_TESTS && await exists(LOCAL_TESTS)) {
  process.env.NEOAFP_ROOT ??= ROOT;
  const names = (await readdir(LOCAL_TESTS)).filter((n) => n.endsWith('.test.js')).sort();
  for (const name of names) await import(pathToFileURL(join(LOCAL_TESTS, name)).href);
}
