import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { VERSION } from '../../src/version.js';

// package.json is a local development file (git-ignored); without it only the format is checked.
const PACKAGE = new URL('../../package.json', import.meta.url);

test('src/version.js is a semantic version (FR-100)', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
});

test('src/version.js matches package.json (FR-100)', { skip: existsSync(PACKAGE) ? false : 'package.json not present (local only)' }, () => {
  const { version } = JSON.parse(readFileSync(PACKAGE, 'utf8'));
  assert.equal(VERSION, version);
});
