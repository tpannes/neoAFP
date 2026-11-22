/**
 * Filtering and sorting of resources (FR-053, data-model "Filters"):
 * `{ name, types[], contentTypes[], resolutions[], colorModels[], encodings[], sizeClasses[],
 * fileSizes[], fontTypes[], origins[] }`; all active filters must match, a filter matches when any of its
 * chosen values does, empty values are inactive, the name matches case-insensitively anywhere
 * in the name or the internal name.
 * - contentTypes: what an overlay or page segment holds (text, IM image, IOCA image, graphics,
 *   bar codes, object containers, included page segments or objects) or "noText" for an overlay
 *   or page segment without text;
 * - fileSizes: the size ranges of FILE_SIZES;
 * - fontTypes: the type of a font, or of the fonts an overlay or page segment uses (catalog.js:
 *   raster, type1, cid, truetype, opentype, collection);
 * - origins: where a resource comes from — 'inline' (in a document's resource group), 'folder'
 *   (opened folder) or 'file' (opened on its own); a combined resource (groupIdentical) matches
 *   when any of its sources does;
 * - colorModels: 'rgb' or 'cmyk' (color-model.js: images, image files, ICC profiles, and the
 *   images inside overlays and page segments; a resource can be both).
 * Filter options are the values that occur in the given resources.
 */

import { SIZE_CLASSES } from './size-class.js';

/** File size ranges [name, from (inclusive), to (exclusive)] in bytes. */
export const FILE_SIZES = Object.freeze([
  ['under1k', 0, 1024], ['1kTo10k', 1024, 10240], ['10kTo100k', 10240, 102400],
  ['100kTo1m', 102400, 1048576], ['over1m', 1048576, Infinity],
]);

/**
 * Names the size range of a file size.
 * @param {number} bytes Size in bytes.
 * @returns {string} Range name from FILE_SIZES.
 */
export function fileSizeRange(bytes) {
  return FILE_SIZES.find(([, from, to]) => bytes >= from && bytes < to)[0];
}

/** Origins in the order offered. */
export const ORIGINS = Object.freeze(['inline', 'folder', 'file']);

/** Color models in the order offered. */
export const COLOR_MODELS = Object.freeze(['rgb', 'cmyk']);

/** Font types in the order offered (catalog.js sets them). */
export const FONT_TYPES_ORDER = Object.freeze(['raster', 'type1', 'cid', 'truetype', 'opentype', 'collection']);

/** Content kinds in the order offered. */
export const CONTENT_ORDER = Object.freeze(['text', 'noText', 'imImage', 'ioca', 'graphics', 'barcode', 'objectContainer', 'pageSegment', 'includedObject']);

/** Resource types whose content kinds can be filtered with "noText". */
const COMPOSED = new Set(['overlay', 'pageSegment']);

/**
 * Lists the content kinds a resource matches, including "noText".
 * @param {{type: string, contents?: string[]}} r Resource.
 * @returns {string[]} Content kinds.
 */
function contentsOf(r) {
  const kinds = r.contents ?? [];
  return COMPOSED.has(r.type) && !kinds.includes('text') ? [...kinds, 'noText'] : kinds;
}

/**
 * Describes where a resource comes from, as shown in lists and the CSV export.
 * @param {{source: {kind: string, path: string}}} r Resource.
 * @returns {string} "inline: <document file>" or the file's relative path.
 */
export function sourceText(r) {
  return r.source.kind === 'inline' ? `inline: ${r.source.path}` : r.source.path;
}

/**
 * Describes all sources of a (combined) resource, separated by "; ".
 * @param {{source: object, sources?: object[]}} r Resource.
 * @returns {string} Sources.
 */
export function sourcesText(r) {
  return (r.sources ?? [r.source]).map((source) => sourceText({ source })).join('; ');
}

/**
 * Applies a filter.
 * @param {object[]} resources Resources.
 * @param {{name?: string, types?: string[], contentTypes?: string[], resolutions?: number[],
 *   colorModels?: string[], encodings?: string[], sizeClasses?: string[], fileSizes?: string[],
 *   fontTypes?: string[], origins?: string[]}} [filter] Filter.
 * @returns {object[]} Matching resources in their order.
 */
export function filterResources(resources, filter = {}) {
  const name = (filter.name ?? '').trim().toLowerCase();
  const sets = ['types:type', 'resolutions:resolution', 'encodings:encoding', 'sizeClasses:sizeClass']
    .map((s) => s.split(':'))
    .filter(([key]) => filter[key]?.length)
    .map(([key, field]) => [new Set(filter[key]), field]);
  const any = (values, list) => !values?.length || list.some((v) => values.includes(v));
  return resources.filter((r) => (!name || r.name.toLowerCase().includes(name) || (r.internalName ?? '').toLowerCase().includes(name)) && sets.every(([set, field]) => set.has(r[field]))
    && any(filter.contentTypes, contentsOf(r)) && any(filter.fontTypes, r.fontTypes ?? [])
    && any(filter.fileSizes, [fileSizeRange(r.fileSize ?? 0)]) && any(filter.colorModels, r.colorModels ?? [])
    && any(filter.origins, (r.sources ?? [r.source]).map((s) => s.kind)));
}

/**
 * Lists the values each filter can offer.
 * @param {object[]} resources Resources.
 * @returns {{types: string[], contentTypes: string[], resolutions: number[], colorModels: string[],
 *   encodings: string[], sizeClasses: string[], fileSizes: string[], fontTypes: string[], origins: string[]}}
 *   Distinct values without null, sorted (content kinds, color models, size classes, file sizes
 *   and font types in their fixed order).
 */
export function filterOptions(resources) {
  const values = (field) => [...new Set(resources.map((r) => r[field]).filter((v) => v !== null && v !== undefined))];
  const text = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });
  return {
    types: values('type').sort(text),
    resolutions: values('resolution').sort((a, b) => a - b),
    colorModels: COLOR_MODELS.filter((m) => resources.some((r) => (r.colorModels ?? []).includes(m))),
    encodings: values('encoding').sort(text),
    sizeClasses: values('sizeClass').sort((a, b) => SIZE_CLASSES.indexOf(a) - SIZE_CLASSES.indexOf(b)),
    contentTypes: CONTENT_ORDER.filter((k) => resources.some((r) => contentsOf(r).includes(k))),
    fileSizes: FILE_SIZES.map(([n]) => n).filter((n) => resources.some((r) => fileSizeRange(r.fileSize ?? 0) === n)),
    fontTypes: FONT_TYPES_ORDER.filter((k) => resources.some((r) => (r.fontTypes ?? []).includes(k))),
    origins: ORIGINS.filter((o) => resources.some((r) => (r.sources ?? [r.source]).some((s) => s.kind === o))),
  };
}

/**
 * Sorts resources by a column: text ignoring case, numbers numerically, size classes by size;
 * missing values last in both directions; equal values keep their order.
 * @param {object[]} resources Resources.
 * @param {{by: string, direction?: 'asc'|'desc'}} sort Column (a Resource field or 'source') and direction.
 * @returns {object[]} A new, sorted array.
 */
export function sortResources(resources, sort) {
  const { by, direction = 'asc' } = sort;
  const sign = direction === 'desc' ? -1 : 1;
  const key = (r) => (by === 'source' ? sourceText(r) : by === 'sizeClass' ? SIZE_CLASSES.indexOf(r.sizeClass) : r[by]);
  return resources.map((r, i) => ({ r, i, k: key(r) })).sort((a, b) => {
    const am = a.k === null || a.k === undefined;
    const bm = b.k === null || b.k === undefined;
    if (am || bm) return am === bm ? a.i - b.i : am ? 1 : -1;
    const c = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : String(a.k).localeCompare(String(b.k), 'en', { sensitivity: 'base' });
    return c * sign || a.i - b.i;
  }).map((x) => x.r);
}
