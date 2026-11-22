/**
 * Shared helpers of the resource viewer: translated labels and formatted values of resources,
 * type symbols for resources without a preview, and preview images drawn from the library's
 * resource render models (cached per resource and size, drawn at low priority).
 */

import { t, currentLanguage } from '../i18n/i18n.js';

/** Symbols per resource type (shown when there is no visual preview). */
export const TYPE_SYMBOLS = {
  pageSegment: '◧', overlay: '◨', fontCharacterSet: 'F', codePage: 'C', codedFont: 'Ƒ', truetypeFont: 'Tt',
  formDefinition: '▥', image: '▨', graphics: '◭', barcode: '‖', objectContainer: '◰',
  colorManagementResource: '◑', iccProfile: '◐', colorAttributeTable: '▦',
};

/**
 * Translated label of a resource type.
 * @param {string} type Resource type.
 * @returns {string} Label.
 */
export const typeLabel = (type) => t(`resource.type.${type}`);
/**
 * Translated label of a size class.
 * @param {string} c Size class.
 * @returns {string} Label.
 */
export const sizeClassLabel = (c) => t(`sizeClass.${c}`);
/**
 * Source of a resource as text: "inline: <document>" or the relative path.
 * @param {object} r Resource.
 * @returns {string} Text.
 */
export const sourceText = (r) => (r.source.kind === 'inline' ? t('resource.inlineIn', { path: r.source.path }) : r.source.path);

/**
 * Lists every source of a resource (identical copies are combined into one resource).
 * @param {{source: object, sources?: object[]}} r Resource.
 * @returns {string[]} Source texts.
 */
export const sourceTexts = (r) => (r.sources ?? [r.source]).map((source) => sourceText({ source }));

/**
 * Formats the dimensions.
 * @param {object} r Resource.
 * @returns {string} "W × H mm", or an empty string.
 */
export function dimensionsText(r) {
  if (typeof r.widthMm !== 'number') return '';
  const f = new Intl.NumberFormat(currentLanguage(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return t('resource.dimensions', { width: f.format(r.widthMm), height: f.format(r.heightMm) });
}

/**
 * Formats a byte count.
 * @param {number} bytes Bytes.
 * @returns {string} E.g. "12.3 KB".
 */
export function fileSizeText(bytes) {
  const f = (v) => new Intl.NumberFormat(currentLanguage(), { maximumFractionDigits: 1 }).format(v);
  if (bytes < 1024) return t('resource.bytes', { value: f(bytes) });
  if (bytes < 1024 * 1024) return t('resource.kilobytes', { value: f(bytes / 1024) });
  return t('resource.megabytes', { value: f(bytes / 1024 / 1024) });
}

/**
 * Draws and caches preview images of resources.
 */
export class ResourceThumbs {
  /**
   * Creates the cache.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   * @param {import('./canvas-renderer.js').CanvasRenderer} renderer Renderer.
   */
  constructor(client, renderer) {
    this.client = client;
    this.renderer = renderer;
    /** @type {Map<string, Promise<HTMLCanvasElement|null>>} */
    this.cache = new Map();
    /** @type {Map<string, Promise<object|null>>} resource id → render model */
    this.models = new Map();
  }

  /**
   * Returns the render model of a resource (cached).
   * @param {string} id Resource id.
   * @param {'high'|'normal'|'low'} [priority] Request priority.
   * @returns {Promise<object|null>} Model, or null.
   */
  model(id, priority = 'low') {
    if (!this.models.has(id)) {
      this.models.set(id, this.client.request({ method: 'getResourceRenderModel', args: [id], priority }).catch(() => null));
    }
    return this.models.get(id);
  }

  /**
   * Returns a preview canvas that fits a square of the given size.
   * @param {object} r Resource.
   * @param {number} size Box size in CSS pixels.
   * @returns {Promise<HTMLCanvasElement|null>} Canvas, or null without a preview.
   */
  get(r, size) {
    const key = `${r.id}|${size}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, (async () => {
        if (!r.hasPreview) return null;
        const model = await this.model(r.id);
        if (!model) return null;
        const canvas = document.createElement('canvas');
        canvas.className = 'resource-thumb';
        const scale = Math.min(size / model.widthUnits, size / model.heightUnits);
        await this.renderer.draw(canvas, model, { scale, pixelRatio: window.devicePixelRatio || 1 });
        return canvas;
      })().catch(() => null));
    }
    return this.cache.get(key);
  }

  /** Forgets everything (after files were added). */
  clear() {
    this.cache.clear();
    this.models.clear();
  }
}

/**
 * Builds the type symbol shown instead of a preview.
 * @param {string} type Resource type.
 * @returns {HTMLElement} Element.
 */
export function typeIcon(type) {
  const icon = document.createElement('div');
  icon.className = 'resource-icon';
  icon.textContent = TYPE_SYMBOLS[type] ?? '◻';
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}
