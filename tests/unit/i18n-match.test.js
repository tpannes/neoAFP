/**
 * Tests for choosing the initial interface language from the browser's preferred languages
 * (FR-071, contracts/locale-file.md "Initial language").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchLanguage } from '../../src/viewer/i18n/i18n.js';

const ALL = ['en', 'de', 'fr', 'es', 'it', 'nl', 'zh-Hans', 'ja'];

test('exact and base-language matches', () => {
  assert.equal(matchLanguage(['de-DE', 'en'], ALL), 'de');
  assert.equal(matchLanguage(['de-CH'], ALL), 'de');
  assert.equal(matchLanguage(['fr'], ALL), 'fr');
  assert.equal(matchLanguage(['ja-JP'], ALL), 'ja');
});

test('Simplified Chinese variants map to zh-Hans; Traditional does not', () => {
  for (const tag of ['zh', 'zh-CN', 'zh-SG', 'zh-Hans']) assert.equal(matchLanguage([tag], ALL), 'zh-Hans');
  assert.equal(matchLanguage(['zh-TW', 'en'], ALL), 'en');
  assert.equal(matchLanguage(['zh-Hant'], ALL), null);
});

test('unsupported languages give no match (the viewer then uses English)', () => {
  assert.equal(matchLanguage(['pt-BR', 'ru'], ALL), null);
  assert.equal(matchLanguage(['de'], ['en']), null);
});
