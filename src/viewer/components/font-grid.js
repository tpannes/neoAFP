/**
 * <font-grid>: the characters of a font (FR-058). AFP font character sets: each glyph (bitmap or
 * outline) with its identifier and width × height. TrueType/OpenType fonts: every mapped
 * character drawn in the font itself (loaded with FontFace from getFontBytes) with its Unicode
 * code point (U+XXXX) and advance width. Coded fonts: every code point of the code page
 * (X'C1') with the glyph of the character set it selects; code points without a glyph stay
 * empty. Rows are virtualized; clicking a cell shows it enlarged above the grid and marks that
 * cell (never its whole row); the close button of the enlarged view, or clicking the marked
 * cell again, returns to the hint.
 *
 * All characters of a font are drawn at one scale on one baseline, like a type specimen:
 * raster fonts by the font's common box (extent from the worker, whole-number pixel scale so
 * pels stay even), outline fonts in a band from 0.25 em below to 0.95 em above the baseline,
 * TrueType fonts at one font size on an alphabetic baseline. Glyphs are centered by their
 * advance (outlines) or bitmap width (raster).
 */

import './virtual-list.js';
import { t, onLanguageChange } from '../i18n/i18n.js';
import { GlyphCache, outlineOf } from '../render/glyph-cache.js';
import { FontLoader } from '../render/font-loader.js';
import { iconButton } from '../icons.js';

/** Cell size (square, CSS pixels) and glyph area inside it. */
const CELL = 84;
const GLYPH = 56;

export class FontGrid extends HTMLElement {
  /**
   * Shows the characters of a font resource.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   * @param {object} resource Resource (fontCharacterSet, codedFont or truetypeFont).
   * @returns {Promise<void>} Resolves when the grid is laid out.
   */
  async show(client, resource) {
    this.className = 'font-grid';
    this.client = client;
    this.grid = await client.call('getFontCharacterGrid', resource.id);
    this.glyphCache = new GlyphCache(client);
    if (this.grid?.kind === 'truetype') this.family = await new FontLoader(client).family(resource.id);
    this.big = document.createElement('div');
    this.big.className = 'font-grid-enlarged';
    this.current = null;
    this.#closeEnlarged();
    this.summary = document.createElement('p');
    this.summary.className = 'meta-facts';
    const summary = () => { this.summary.textContent = this.#summaryText(); };
    summary();
    this.offLanguage?.();
    this.offLanguage = onLanguageChange(() => { summary(); this.list.refresh(); });
    this.list = document.createElement('virtual-list');
    this.list.setAttribute('role', 'list');
    this.list.dataset.rowRole = 'listitem';
    this.list.renderRow = (row, el) => this.#renderRow(row, el);
    this.replaceChildren(this.summary, this.big, this.list);
    this.list.rowHeight = CELL + 8;
    this.list.style.setProperty('--row-height', `${CELL + 8}px`);
    this.#layout();
    new ResizeObserver(() => this.#layout()).observe(this);
    // Glyphs are drawn in the theme's text color: draw them again when the theme changes.
    this.themeQuery ??= window.matchMedia('(prefers-color-scheme: dark)');
    this.themeQuery.onchange = () => { this.list.refresh(); this.big.querySelector('canvas') && this.#closeEnlarged(); };
  }

  /**
   * Text above the grid: number of characters; for coded fonts also the character set and code
   * page, and which of them are missing.
   * @returns {string} Text.
   */
  #summaryText() {
    const g = this.grid;
    if (!g) return t('fontGrid.none');
    if (!('characterSet' in g)) return t('fontGrid.count', { count: g.glyphs.length });
    const parts = t('fontGrid.codedFont', { characterSet: g.characterSet || '?', codePage: g.codePage || '?' });
    const missing = [!g.found.characterSet && (g.characterSet || '?'), !g.found.codePage && (g.codePage || '?')].filter(Boolean);
    if (missing.length) return `${parts} · ${t('fontGrid.missing', { names: missing.join(', ') })}`;
    return `${parts} · ${t('fontGrid.codePoints', { count: g.glyphs.length, available: g.glyphs.filter((x) => x.available).length })}`;
  }

  /** Shows the hint instead of an enlarged character and unmarks the cell. */
  #closeEnlarged() {
    this.current = null;
    for (const c of this.querySelectorAll('.font-cell.current')) c.classList.remove('current');
    const hint = document.createElement('span');
    hint.dataset.i18n = 'fontGrid.clickToEnlarge';
    hint.textContent = t('fontGrid.clickToEnlarge');
    this.big.classList.remove('open');
    this.big.replaceChildren(hint);
  }

  /**
   * Shows one character enlarged, with its details and a close button, and marks its cell.
   * @param {object} g Glyph entry.
   * @param {HTMLElement} cell Its cell.
   * @returns {Promise<void>} Resolves when drawn.
   */
  async #enlarge(g, cell) {
    if (this.current === g) { this.#closeEnlarged(); return; }
    this.current = g;
    for (const c of this.querySelectorAll('.font-cell.current')) c.classList.remove('current');
    cell.classList.add('current');
    const big = await this.#draw(g, 200);
    if (this.current !== g) return;
    const caption = document.createElement('div');
    caption.textContent = this.#label(g);
    const close = iconButton('close', 'fontGrid.closeEnlarged', { iconOnly: true, className: 'font-grid-close' });
    close.title = t('fontGrid.closeEnlarged');
    close.setAttribute('aria-label', t('fontGrid.closeEnlarged'));
    close.addEventListener('click', () => this.#closeEnlarged());
    this.big.classList.add('open');
    this.big.replaceChildren(big, caption, close);
  }

  /** Splits the glyphs into rows. */
  #layout() {
    if (!this.grid) return;
    const perRow = Math.max(1, Math.floor((this.clientWidth || 600) / (CELL + 8)));
    const rows = [];
    for (let i = 0; i < this.grid.glyphs.length; i += perRow) rows.push(this.grid.glyphs.slice(i, i + perRow));
    this.list.items = rows;
  }

  /**
   * Draws one glyph into a canvas.
   * @param {object} g Glyph entry.
   * @param {number} size Canvas size in CSS pixels.
   * @returns {Promise<HTMLCanvasElement>} Canvas.
   */
  async #draw(g, size) {
    const ratio = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.round(size * ratio);
    canvas.style.width = canvas.style.height = `${size}px`;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.fillStyle = getComputedStyle(this).color || '#000';
    if (this.grid.kind === 'truetype') {
      if (!this.family) return canvas;
      ctx.font = `${size * 0.62}px "${this.family}"`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(String.fromCodePoint(g.codePoint), size / 2, size * 0.72);
      return canvas;
    }
    if (g.available === false) return canvas;
    const id = g.id ?? g.gcgid;
    await this.glyphCache.load(this.grid.fontRef, [id]);
    if (this.grid.kind === 'outline') {
      const o = outlineOf(this.glyphCache, this.grid.fontRef, id);
      if (!o) return canvas;
      // Band from 0.25 em below to 0.95 em above the baseline (accented capitals, descenders).
      const em = o.unitsPerEm;
      const k = (size * 0.88) / (1.2 * em);
      const advance = (g.increment || em / 2) * (em / (this.grid.unitsPerEm || em));
      ctx.translate((size - advance * k) / 2, (size - 1.2 * em * k) / 2 + 0.95 * em * k);
      ctx.scale(k, -k);
      ctx.fill(o.path);
      return canvas;
    }
    // Raster glyphs in the text color too (they were black, nearly invisible in the dark theme).
    const glyph = this.glyphCache.get(this.grid.fontRef, id, this.#inkHex());
    if (!glyph) return canvas;
    const { width, height, baseOffset } = glyph.data;
    ctx.imageSmoothingEnabled = false;
    const e = this.grid.extent;
    if (!e) {
      const k = Math.min((size * 0.8) / width, (size * 0.8) / height, 4);
      ctx.drawImage(glyph.image, (size - width * k) / 2, (size - height * k) / 2, width * k, height * k);
      return canvas;
    }
    // One scale for the whole font; whole pixels when enlarging so every pel has the same size.
    const fit = Math.min((size * 0.88) / (e.ascent + e.descent), (size * 0.88) / Math.max(e.width, 1));
    const k = fit >= 1 ? Math.floor(fit) : fit;
    const baseline = (size - (e.ascent + e.descent) * k) / 2 + e.ascent * k;
    const top = baseline - (baseOffset ?? height) * k;
    ctx.drawImage(glyph.image, Math.round((size - width * k) / 2), Math.round(top), width * k, height * k);
    return canvas;
  }

  /**
   * The text color of the grid as "#rrggbb" (the glyph cache colors bitmaps with it).
   * @returns {string} Color.
   */
  #inkHex() {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(this).color || '');
    return m ? `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}` : '#000000';
  }

  /**
   * Label of a glyph entry.
   * @param {object} g Glyph entry.
   * @returns {string} Text.
   */
  #label(g) {
    if (this.grid.kind === 'truetype') {
      return `U+${g.codePoint.toString(16).toUpperCase().padStart(4, '0')} · ${t('fontGrid.advance', { value: g.advance })}`;
    }
    if (g.codePoint !== undefined) {
      const code = `X'${g.codePoint.toString(16).toUpperCase().padStart(this.grid.doubleByte ? 4 : 2, '0')}'`;
      return g.available ? `${code} · ${g.gcgid}` : `${code} · ${g.gcgid} · ${t('fontGrid.noGlyph')}`;
    }
    // Outline glyphs have no pel size: show the glyph name instead.
    if (this.grid.kind === 'outline') return g.id && g.id !== g.gcgid ? `${g.gcgid} · ${g.id}` : g.gcgid;
    return `${g.gcgid} · ${g.width} × ${g.height}`;
  }

  /**
   * Fills one row of cells.
   * @param {object[]} row Glyph entries.
   * @param {HTMLElement} el Row element.
   * @returns {void}
   */
  #renderRow(row, el) {
    el.classList.add('font-grid-row');
    el.replaceChildren(...row.map((g) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'font-cell';
      // The cell shows only the identifier (GCGID, U+XXXX or X'..'); the rest is in the tooltip
      // and the enlarged view, as it does not fit the cell width.
      const label = document.createElement('span');
      label.textContent = this.#label(g).split(' · ')[0];
      cell.title = this.#label(g);
      this.#draw(g, GLYPH).then((canvas) => cell.prepend(canvas));
      cell.append(label);
      cell.classList.toggle('current', g === this.current);
      cell.addEventListener('click', () => this.#enlarge(g, cell));
      return cell;
    }));
  }
}

customElements.define('font-grid', FontGrid);
