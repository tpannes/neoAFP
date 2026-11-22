/**
 * <resource-filters>: filter bar of the Resource-Explorer (FR-053): a name box and dropdowns
 * with multiple choice for resource type, content type (what overlays and page segments hold:
 * text, IM or IOCA images, graphics, bar codes, page segments … or no text), dimensions (the size
 * classes Icon, Small, Medium, Large, A4, Larger than A4, Not applicable), file size (ranges
 * from under 1 KB to over 1 MB), font type (raster, Type 1, CID-keyed, TrueType, OpenType,
 * TrueType collection; each with its own icon), resolution, color profile, encoding and origin
 * (inline in a document, opened folder, file opened on its own). Options
 * come from the loaded resources (dimensions and file sizes: all ranges). The settings are kept as the
 * preference `resourceFilter` and restored when the viewer opens again; chosen values stay
 * listed even while no open resource has them. Also the result count and a reset button.
 * Event: `change` (detail: { filter }).
 */

import { t, onLanguageChange } from '../i18n/i18n.js';
import { typeLabel, sizeClassLabel } from '../render/resource-thumbs.js';
import { icon, iconButton } from '../icons.js';
import { loadPrefs, savePrefs } from '../prefs.js';

const SIZE_CLASSES = ['icon', 'small', 'medium', 'large', 'a4', 'largerThanA4', 'notApplicable'];
const FILE_SIZES = ['under1k', '1kTo10k', '10kTo100k', '100kTo1m', 'over1m'];
const COLOR_MODELS = ['rgb', 'cmyk'];
/** Icons of resource types (as in the structure tree where the kind exists there). */
const TYPE_ICONS = {
  overlay: 'overlay', pageSegment: 'pageSegment', fontCharacterSet: 'font', codePage: 'font', codedFont: 'font',
  truetypeFont: 'font', formDefinition: 'formDefinition', image: 'image', graphics: 'graphics', barcode: 'barcode',
  objectContainer: 'objectContainer', iccProfile: 'palette', colorManagementResource: 'palette', colorAttributeTable: 'table',
};

/** Icons of content kinds. */
const CONTENT_ICONS = {
  text: 'text', noText: 'noText', imImage: 'image', ioca: 'image', graphics: 'graphics', barcode: 'barcode',
  objectContainer: 'objectContainer', pageSegment: 'pageSegment', includedObject: 'include',
};

/** Icons of font types. */
const FONT_TYPE_ICONS = {
  raster: 'fontRaster', type1: 'fontType1', cid: 'fontCid', truetype: 'fontTrueType', opentype: 'fontOpenType',
  collection: 'fontCollection',
};

/** Icons of origins. */
const ORIGIN_ICONS = { inline: 'document', folder: 'folder', file: 'page' };

/** Icons of size classes: growing squares, a page for A4. */
const SIZE_ICONS = {
  icon: 'sizeIcon', small: 'sizeSmall', medium: 'sizeMedium', large: 'sizeLarge', a4: 'page', largerThanA4: 'sizeLarger',
  notApplicable: 'notApplicable',
};

/**
 * Multiple-choice filters: filter key, text key, option label, icon of the filter button, icon
 * of a choice (null: no icon — resolutions and encodings would all show the same one).
 */
const CHOICES = [
  ['types', 'resources.filter.type', typeLabel, 'shapes', (v) => TYPE_ICONS[v] ?? 'resource'],
  ['contentTypes', 'resources.filter.content', (v) => t(`resources.content.${v}`), 'layers', (v) => CONTENT_ICONS[v] ?? 'other'],
  ['sizeClasses', 'resources.filter.sizeClass', sizeClassLabel, 'ruler', (v) => SIZE_ICONS[v]],
  ['fileSizes', 'resources.filter.fileSize', (v) => t(`resources.fileSize.${v}`), 'bars3', (v) => `bars${FILE_SIZES.indexOf(v) + 1}`],
  ['fontTypes', 'resources.filter.fontType', (v) => t(`resources.fontType.${v}`), 'font', (v) => FONT_TYPE_ICONS[v] ?? 'font'],
  ['resolutions', 'resources.filter.resolution', (v) => t('resource.dpi', { value: v }), 'dpi', null],
  // Always both options, like size classes (the RGB/CMYK names are the same in every language).
  ['colorModels', 'resources.filter.colorProfile', (v) => v.toUpperCase(), 'palette', (v) => v],
  ['encodings', 'resources.filter.encoding', String, 'code', null],
  ['origins', 'resources.filter.origin', (v) => t(`resources.origin.${v}`), 'folder', (v) => ORIGIN_ICONS[v] ?? 'other'],
];

export class ResourceFilters extends HTMLElement {
  /** Builds the bar. */
  connectedCallback() {
    if (this.nameInput) return;
    this.className = 'resource-filters';
    const saved = loadPrefs().resourceFilter ?? {};
    this.selected = Object.fromEntries(CHOICES.map(([key]) => [key, new Set(Array.isArray(saved[key]) ? saved[key] : [])]));
    this.options = Object.fromEntries(CHOICES.map(([key]) => [key, []]));
    this.options.sizeClasses = SIZE_CLASSES;
    this.options.fileSizes = FILE_SIZES;
    this.options.colorModels = COLOR_MODELS;
    this.nameInput = document.createElement('input');
    this.nameInput.type = 'search';
    this.nameInput.dataset.i18nAttr = 'placeholder:resources.filter.name,aria-label:resources.filter.name';
    this.nameInput.placeholder = t('resources.filter.name');
    this.nameInput.setAttribute('aria-label', t('resources.filter.name'));
    this.nameInput.value = typeof saved.name === 'string' ? saved.name : '';
    let timer = null;
    this.nameInput.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => this.#changed(), 200); });
    this.menus = document.createElement('div');
    this.menus.className = 'filter-menus';
    this.count = document.createElement('span');
    this.count.className = 'filter-count';
    this.count.setAttribute('role', 'status');
    const reset = iconButton('filterReset', 'resources.filter.reset');
    reset.dataset.i18nAttr = 'title:resources.filter.reset,aria-label:resources.filter.reset';
    reset.addEventListener('click', () => {
      this.nameInput.value = '';
      for (const set of Object.values(this.selected)) set.clear();
      this.#renderMenus();
      this.#changed();
    });
    const nameBox = document.createElement('div');
    nameBox.className = 'search-box';
    nameBox.append(icon('search'), this.nameInput);
    this.append(nameBox, this.menus, reset, this.count);
    this.#renderMenus();
    onLanguageChange(() => { this.#renderMenus(); this.showCount(this.shown, this.total); });
  }

  /**
   * Sets the choices offered (from getFilterOptions); size classes, file sizes and color models
   * are always all offered, chosen values are kept.
   * @param {object} options Options per filter.
   * @returns {void}
   */
  setOptions(options) {
    this.options = { ...options, sizeClasses: SIZE_CLASSES, fileSizes: FILE_SIZES, colorModels: COLOR_MODELS };
    for (const [key] of CHOICES) {
      const extra = [...this.selected[key]].filter((v) => !this.options[key].includes(v));
      if (extra.length) this.options[key] = [...this.options[key], ...extra];
    }
    this.#renderMenus();
  }

  /** @returns {object} The current filter. */
  get filter() {
    const out = { name: this.nameInput.value.trim() };
    for (const [key] of CHOICES) out[key] = [...this.selected[key]];
    return out;
  }

  /**
   * Shows the number of results.
   * @param {number} shown Resources shown.
   * @param {number} total All resources.
   * @returns {void}
   */
  showCount(shown, total) {
    this.shown = shown;
    this.total = total;
    if (shown === undefined) return;
    this.count.textContent = t('resources.filter.count', { shown, total });
  }

  /** Draws the multiple-choice menus. */
  #renderMenus() {
    this.menus.replaceChildren(...CHOICES.map(([key, label, format, buttonIcon, choiceIcon]) => {
      const details = document.createElement('details');
      details.className = 'filter-menu';
      const summary = document.createElement('summary');
      const title = document.createElement('span');
      summary.append(icon(buttonIcon), title);
      const n = this.selected[key].size;
      title.textContent = n ? `${t(label)} (${n})` : t(label);
      details.classList.toggle('active', n > 0);
      const box = document.createElement('div');
      box.className = 'filter-options';
      const values = this.options[key] ?? [];
      if (!values.length) box.textContent = t('resources.filter.noOptions');
      for (const value of values) {
        const l = document.createElement('label');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = this.selected[key].has(value);
        cb.addEventListener('change', () => {
          if (cb.checked) this.selected[key].add(value); else this.selected[key].delete(value);
          const count = this.selected[key].size;
          title.textContent = count ? `${t(label)} (${count})` : t(label);
          details.classList.toggle('active', count > 0);
          this.#changed();
        });
        l.append(cb, ...(choiceIcon ? [icon(choiceIcon(value))] : []), Object.assign(document.createElement('span'), { textContent: format(value) }));
        box.append(l);
      }
      details.append(summary, box);
      return details;
    }));
  }

  /** Stores the filter and announces the change. */
  #changed() {
    savePrefs({ resourceFilter: this.filter });
    this.dispatchEvent(new CustomEvent('change', { detail: { filter: this.filter } }));
  }
}

customElements.define('resource-filters', ResourceFilters);
