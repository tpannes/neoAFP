/**
 * <formdef-view>: the medium maps of a form definition in the resource viewer's full view. Each
 * medium map shows a diagram from the library (sheet front, and back for duplex, with numbered
 * page areas and medium overlays) and its settings: printing (simplex/duplex/tumble), pages per
 * side, paper tray, output tray, paper type, copies, sheet size, medium overlays and page
 * positions.
 */

import { t, onLanguageChange, currentLanguage } from '../i18n/i18n.js';

const DIAGRAM_HEIGHT = 220; // CSS pixels
const MM = 25.4 / 1440;

/**
 * Creates an element with text.
 * @param {string} tag Tag name.
 * @param {string} [text] Text.
 * @param {string} [className] Class.
 * @returns {HTMLElement} Element.
 */
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export class FormdefView extends HTMLElement {
  /**
   * Shows the medium maps of a form definition.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   * @param {import('../render/canvas-renderer.js').CanvasRenderer} renderer Renderer.
   * @param {object} resource Form definition resource.
   * @returns {Promise<void>} Resolves when the maps are listed (diagrams follow).
   */
  async show(client, renderer, resource) {
    this.className = 'formdef-view';
    Object.assign(this, { client, renderer, resource });
    this.formdef = await client.call('getFormDefinition', resource.id);
    this.diagrams = new Map();
    this.offLanguage?.();
    this.offLanguage = onLanguageChange(() => this.#render());
    this.#render();
  }

  /** Lists the medium maps (also after a language change). */
  #render() {
    const maps = this.formdef?.mediumMaps ?? [];
    const summary = el('p', maps.length ? t('formdef.count', { count: maps.length }) : t('formdef.none'), 'meta-facts');
    this.replaceChildren(summary, ...maps.map((m) => this.#section(m)));
  }

  /**
   * Builds the section of one medium map.
   * @param {object} m Medium map.
   * @returns {HTMLElement} Section.
   */
  #section(m) {
    const section = el('section', undefined, 'formdef-map');
    const figure = el('figure', undefined, 'formdef-diagram');
    const canvas = el('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `${m.name}: ${t(`print.duplex.${m.duplex}`)}, ${t('formdef.nUpValue', { count: m.nUp })}`);
    const caption = el('figcaption', m.duplex === 'simplex' ? t('formdef.front') : `${t('formdef.front')} · ${t('formdef.back')}`);
    figure.append(canvas, caption);
    this.#drawDiagram(m.name, canvas);
    section.append(el('h3', m.name), figure, this.#settings(m));
    return section;
  }

  /**
   * Draws the diagram of a medium map (cached per map).
   * @param {string} name Medium map name.
   * @param {HTMLCanvasElement} canvas Target.
   * @returns {Promise<void>} Resolves when drawn.
   */
  async #drawDiagram(name, canvas) {
    if (!this.diagrams.has(name)) this.diagrams.set(name, this.client.call('getFormDefinitionDiagram', this.resource.id, name).catch(() => null));
    const model = await this.diagrams.get(name);
    if (!model) return;
    await this.renderer.draw(canvas, model, { scale: DIAGRAM_HEIGHT / model.heightUnits, pixelRatio: window.devicePixelRatio || 1 });
  }

  /**
   * Builds the settings table of a medium map.
   * @param {object} m Medium map.
   * @returns {HTMLTableElement} Table.
   */
  #settings(m) {
    const none = t('print.notSpecified');
    const f = new Intl.NumberFormat(currentLanguage(), { maximumFractionDigits: 1 });
    const size = m.mediumSize
      ? t('resource.dimensions', { width: f.format(m.mediumSize.width * MM), height: f.format(m.mediumSize.height * MM) })
      : t('formdef.sizeAssumed');
    const positions = m.pagePositions.map((p) => t('formdef.position', { x: f.format(p.x * MM), y: f.format(p.y * MM), rotation: p.rotation })).join('; ');
    const rows = [
      [t('print.duplex'), t(`print.duplex.${m.duplex}`)],
      [t('formdef.nUp'), String(m.nUp)],
      [t('print.inputBin'), m.inputBin ?? none],
      [t('print.outputBin'), m.outputBin ?? none],
      [t('print.mediaType'), m.mediaType ?? none],
      [t('formdef.copies'), String(m.copies)],
      [t('formdef.mediumSize'), size],
      [t('formdef.overlays'), m.mediumOverlays.join(', ') || t('formdef.noOverlays')],
      [t('formdef.pagePositions'), positions || none],
    ];
    const table = el('table', undefined, 'param-table');
    for (const [label, value] of rows) {
      const tr = el('tr');
      tr.append(el('th', label), el('td', String(value)));
      table.append(tr);
    }
    return table;
  }
}

customElements.define('formdef-view', FormdefView);
