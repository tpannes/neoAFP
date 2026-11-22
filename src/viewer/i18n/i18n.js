/**
 * Interface languages (FR-070–FR-073, contracts/locale-file.md).
 *
 * Texts live in src/viewer/locales/<tag>.json; locales/index.json lists the languages. Elements
 * carry `data-i18n="key"` (text content) or `data-i18n-attr="attribute:key,…"`; switching the
 * language re-applies all texts in place, so open files and positions are kept. Missing texts
 * fall back to English.
 */

import { loadPrefs, savePrefs } from '../prefs.js';

const LOCALES_URL = new URL('../locales/', import.meta.url);

let languages = ['en'];
let fallback = 'en';
let current = 'en';
/** @type {Record<string,string>} */ let messages = {};
/** @type {Record<string,string>} */ let fallbackMessages = {};
/** @type {Record<string, object>} */ const meta = {};
const listeners = new Set();

/**
 * Loads one locale file.
 * @param {string} tag Language tag, e.g. "de".
 * @returns {Promise<{meta: object, messages: Record<string,string>}>} Parsed locale.
 */
async function fetchLocale(tag) {
  const response = await fetch(new URL(`${tag}.json`, LOCALES_URL));
  if (!response.ok) throw new Error(`locale ${tag}: HTTP ${response.status}`);
  return response.json();
}

/**
 * Picks the first supported language from the browser's preferred languages.
 * @param {readonly string[]} preferred Browser language tags, e.g. navigator.languages.
 * @param {string[]} available Supported tags.
 * @returns {string|null} Supported tag, or null.
 */
export function matchLanguage(preferred, available) {
  for (const raw of preferred) {
    const tag = raw.toLowerCase();
    if (tag.startsWith('zh') && !tag.includes('hant') && !['zh-tw', 'zh-hk', 'zh-mo'].includes(tag)) {
      if (available.includes('zh-Hans')) return 'zh-Hans';
      continue;
    }
    const exact = available.find((a) => a.toLowerCase() === tag);
    if (exact) return exact;
    const base = available.find((a) => a.toLowerCase() === tag.split('-')[0]);
    if (base) return base;
  }
  return null;
}

/**
 * Loads the language list and the initial language: the saved choice, else the browser's
 * preferred language if supported, else English.
 * @returns {Promise<string>} The active language tag.
 */
export async function initI18n() {
  try {
    const index = await (await fetch(new URL('index.json', LOCALES_URL))).json();
    languages = index.languages;
    fallback = index.fallback ?? 'en';
  } catch {
    languages = ['en'];
  }
  const fb = await fetchLocale(fallback);
  fallbackMessages = fb.messages;
  meta[fallback] = fb.meta;
  const saved = loadPrefs().language;
  const tag = (saved && languages.includes(saved)) ? saved
    : matchLanguage(navigator.languages ?? [navigator.language], languages) ?? fallback;
  await setLanguage(tag, { save: false });
  return current;
}

/**
 * Switches the interface language and re-applies all texts in the page.
 * @param {string} tag Language tag from availableLanguages().
 * @param {{save?: boolean}} [options] Whether to remember the choice (default true).
 * @returns {Promise<void>} Resolves when texts are updated.
 */
export async function setLanguage(tag, options = {}) {
  if (!languages.includes(tag)) throw new RangeError(`unsupported language: ${tag}`);
  if (tag === fallback) {
    messages = fallbackMessages;
  } else {
    const locale = await fetchLocale(tag);
    messages = locale.messages;
    meta[tag] = locale.meta;
  }
  current = tag;
  document.documentElement.lang = tag;
  document.documentElement.dir = meta[tag]?.direction ?? 'ltr';
  if (options.save !== false) savePrefs({ language: tag });
  applyTranslations(document);
  for (const listener of listeners) listener(tag);
}

/**
 * Lists the available languages with their display names (names load when a language is used;
 * until then the tag is shown).
 * @returns {Promise<{tag: string, name: string}[]>} Languages.
 */
export async function availableLanguages() {
  const out = [];
  for (const tag of languages) {
    if (!meta[tag]) {
      try {
        meta[tag] = (await fetchLocale(tag)).meta;
      } catch {
        meta[tag] = { name: tag };
      }
    }
    out.push({ tag, name: meta[tag].name ?? tag });
  }
  return out;
}

/**
 * Returns the active language tag.
 * @returns {string} Tag, e.g. "en".
 */
export function currentLanguage() {
  return current;
}

/**
 * Translates a text key, inserting `{placeholder}` values. Numbers are formatted for the
 * active language.
 * @param {string} key Text key, e.g. "toolbar.open".
 * @param {Record<string, string|number>} [params] Placeholder values.
 * @returns {string} The translated text (the key itself if no language has it).
 */
export function t(key, params = {}) {
  const template = messages[key] ?? fallbackMessages[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    if (!(name in params)) return match;
    const value = params[name];
    return typeof value === 'number' ? new Intl.NumberFormat(current).format(value) : String(value ?? '');
  });
}

/**
 * Applies translations to all elements with data-i18n attributes below a root.
 * @param {ParentNode} root Element or document.
 * @returns {void}
 */
export function applyTranslations(root) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of el.dataset.i18nAttr.split(',')) {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr.trim(), t(key.trim()));
    }
  }
}

/**
 * Registers a function called after every language change (for texts built in code).
 * @param {(tag: string) => void} listener Callback.
 * @returns {() => void} Function that removes the listener.
 */
export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
