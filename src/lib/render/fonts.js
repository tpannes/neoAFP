/**
 * Font manager: turns the font mappings of a page (Map Coded Font, Map Data Resource) into
 * fonts the text interpreter can use, loading AFP fonts and TrueType/OpenType fonts through the
 * resource catalog and falling back to substitute fonts when something is missing (FR-012,
 * FR-021).
 *
 * Every resolved font gets a reference (`ref`) that the viewer uses to ask for glyph bitmaps
 * (raster fonts) or font bytes (TrueType/OpenType).
 */

import { readCodedFont } from '../foca/coded-font.js';
import { readCodePage } from '../foca/code-page.js';
import { readFontCharacterSet, metricsFor, glyphBitmap } from '../foca/font-character-set.js';
import { gcgidToUnicode, learnFromCodePage, substituteFamily } from '../foca/gcgid-unicode.js';
import { readFontMetrics } from '../foca/opentype.js';
import { loadCodePage, decode } from '../codepages/index.js';
import { collectFields, concat } from '../modca/access.js';

/** Default size for substitute fonts when nothing else is known: 10 point in 1/1440 inch. */
const DEFAULT_SIZE = 200;

/**
 * @typedef {object} FontSpec
 * @property {string} [codedFont] Coded font name.
 * @property {string} [characterSet] Font character set name.
 * @property {string} [codePage] Code page name.
 * @property {number} [rotation] Character rotation in degrees.
 * @property {number|null} [height] Font size in 1/1440 inch (outline fonts).
 * @property {{name: string, height: number|null}} [dataObject] TrueType/OpenType font reference.
 */

/**
 * Loads and caches fonts for one document.
 */
export class FontManager {
  /**
   * Creates a font manager.
   * @param {object} options Options.
   * @param {import('../resources/resolver.js').ResourceCatalog} options.catalog Resource catalog.
   * @param {(fileId: string) => object} options.getFile Returns a file record.
   * @param {Map<string, Promise<object>>} options.resourceCache Shared cache of parsed resources.
   * @param {Map<string, object>} options.handles Shared registry of font handles by ref.
   * @param {string} options.documentFileId Requesting document.
   * @param {number|null} options.resolution Document resolution for resource selection.
   * @param {(d: object) => void} options.report Records a diagnostic.
   */
  constructor(options) {
    Object.assign(this, options);
    /** @type {Map<string, Promise<object>>} spec key → handle */
    this.bySpec = new Map();
    this.reported = new Set();
  }

  /**
   * Loads a parsed resource once (shared across documents).
   * @param {object} entry Resource catalog entry.
   * @param {(file: object, row: number) => Promise<object>} reader Parser.
   * @returns {Promise<object>} Parsed resource.
   */
  #cached(entry, reader) {
    if (!this.resourceCache.has(entry.id)) this.resourceCache.set(entry.id, reader(this.getFile(entry.fileId), entry.beginRow));
    return this.resourceCache.get(entry.id);
  }

  /**
   * Looks up and parses a named AFP resource.
   * @param {string} type Resource type.
   * @param {string} name Resource name.
   * @param {(file: object, row: number) => Promise<object>} reader Parser.
   * @returns {Promise<object|null>} Parsed resource, or null if missing.
   */
  async #load(type, name, reader) {
    if (!name) return null;
    const entry = await this.catalog.lookup(type, name, { documentFileId: this.documentFileId, resolution: this.resolution });
    return entry ? this.#cached(entry, reader) : null;
  }

  /**
   * Reports a missing font once per name.
   * @param {string} name Font name.
   * @param {string} kind What is missing.
   * @param {{type: string, name: string}[]} list Collects it for the font's descriptor.
   * @returns {void}
   */
  #missing(name, kind, list) {
    list.push({ type: kind, name });
    const key = `${kind}:${name}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.report({ severity: 'warning', code: 'missingResource', fileId: this.documentFileId, params: { name, type: kind } });
    this.report({ severity: 'warning', code: 'fontSubstituted', fileId: this.documentFileId, params: { name } });
  }

  /**
   * Reports once that a coded font was replaced by its X0 variant.
   * @param {string} name Requested coded font, e.g. "X1NEOAF1".
   * @param {string} alias Coded font used instead, e.g. "X0NEOAF1".
   * @returns {void}
   */
  #redirected(name, alias) {
    const key = `redirect:${name}`;
    if (this.reported.has(key)) return;
    this.reported.add(key);
    this.report({ severity: 'info', code: 'fontSubstituted', messageKey: 'diagnostic.fontRedirected',
      fileId: this.documentFileId, params: { name, substitute: alias } });
  }

  /**
   * Returns the font for a mapping.
   * @param {FontSpec} spec Font mapping.
   * @returns {Promise<import('../ptoca/ptoca.js').TextFont & {ref: string, descriptor: object}>} Font.
   */
  resolve(spec) {
    const key = JSON.stringify(spec);
    if (!this.bySpec.has(key)) this.bySpec.set(key, this.#create(spec));
    return this.bySpec.get(key);
  }

  /**
   * Creates a font handle.
   * @param {FontSpec} spec Font mapping.
   * @returns {Promise<object>} Font handle.
   */
  async #create(spec) {
    const missing = [];
    const handle = await this.#build(spec, missing);
    // Which font resources were missing, on the descriptor that every glyph run carries: the
    // Resource-Explorer's preview lists them (FR-054), also after the warning was logged once.
    if (missing.length) handle.descriptor.missing = missing;
    return handle;
  }

  /**
   * Builds a font handle (see #create).
   * @param {FontSpec} spec Font mapping.
   * @param {{type: string, name: string}[]} missing Collects the missing font resources.
   * @returns {Promise<object>} Font handle.
   */
  async #build(spec, missing) {
    if (spec.dataObject) return this.#trueType(spec, missing);
    let { characterSet, codePage } = spec;
    let size = spec.height ?? null;
    const label = spec.codedFont || characterSet || '?';
    if (spec.codedFont) {
      let cf = await this.#load('codedFont', spec.codedFont, readCodedFont);
      const alias = redirectedCodedFont(spec.codedFont);
      if (!cf && alias) {
        cf = await this.#load('codedFont', alias, readCodedFont);
        if (cf) this.#redirected(spec.codedFont, alias);
      }
      if (cf?.parts[0]) {
        characterSet ||= cf.parts[0].fcsName;
        codePage ||= cf.parts[0].cpName;
        if (!size && cf.parts[0].verticalSize) size = cf.parts[0].verticalSize * 2; // 1/10 pt → 1/1440 in
      } else if (!cf) {
        this.#missing(spec.codedFont, 'codedFont', missing);
      }
    }
    const cp = await this.#load('codePage', codePage, readCodePage);
    if (cp) await learnFromCodePage(cp);
    const fcs = await this.#load('fontCharacterSet', characterSet, readFontCharacterSet);
    if (!cp && codePage) this.#missing(codePage, 'codePage', missing);
    if (!fcs && characterSet) this.#missing(characterSet, 'fontCharacterSet', missing);
    if (!fcs || !cp) return this.#substitute(spec, cp, fcs, size, label);
    if (fcs.technology === 'raster') return this.#afpFont(spec, cp, fcs, 1440 / (fcs.unitsPerInch || 240), 'raster', null);
    const em = size ?? (fcs.nominalPointSize ? fcs.nominalPointSize * 2 : DEFAULT_SIZE);
    return this.#afpFont(spec, cp, fcs, em / fcs.unitsPerEm, 'outline', em);
  }

  /**
   * Registers a handle so the viewer can ask for its glyphs.
   * @param {object} handle Font handle.
   * @returns {object} The handle.
   */
  #register(handle) {
    handle.ref = `font${this.handles.size + 1}`;
    handle.descriptor.ref = handle.ref;
    this.handles.set(handle.ref, handle);
    return handle;
  }

  /**
   * Builds a handle for an AFP font with code page and character set.
   * @param {FontSpec} spec Mapping.
   * @param {object} cp Code page.
   * @param {object} fcs Font character set.
   * @param {number} scale Page units per font unit.
   * @param {'raster'|'outline'} kind Font kind.
   * @param {number|null} size Em size in page units (outline fonts).
   * @returns {object} Font handle.
   */
  #afpFont(spec, cp, fcs, scale, kind, size) {
    const rotation = spec.rotation ?? 0;
    const metrics = metricsFor(fcs, rotation);
    const orient = fcs.orientations.find((o) => o.rotation === rotation) ?? fcs.orientations[0] ?? {};
    const position = fcs.positions[Math.max(0, fcs.orientations.indexOf(orient))] ?? {};
    const fallback = metrics.get(cp.defaultGcgid) ?? metrics.get('SP010000') ?? null;
    return this.#register({
      kind,
      fcs,
      cp,
      metrics,
      scale,
      descriptor: { kind, resolution: fcs.unitsPerInch || null, size, charRotation: rotation, name: fcs.name,
        typeface: fcs.typeface, technology: fcs.technology },
      baselineIncrement: (orient.baselineInc || (fcs.positions[0]?.maxAscender ?? 0) * 1.2) * scale,
      underscore: { position: (position.underscorePosition ?? 2) * scale, width: Math.max(1, (position.underscoreWidth ?? 1)) * scale },
      split: (bytes) => splitCodes(bytes, cp.doubleByte ? 2 : 1),
      glyph(code) {
        const entry = cp.map.get(code);
        const gcgid = entry?.gcgid ?? cp.defaultGcgid;
        const m = metrics.get(gcgid) ?? fallback;
        const advance = m ? m.inc * scale : (orient.spaceInc ?? 0) * scale;
        const id = kind === 'outline' ? (fcs.nameMap.get(gcgid) ?? gcgid) : gcgid;
        return { id, gcgid, unicode: gcgidToUnicode(gcgid) ?? '', advance, variableSpace: code === cp.variableSpace };
      },
    });
  }

  /**
   * Builds a substitute font for a missing AFP font: text is decoded to Unicode (via the code
   * page's GCGIDs, or EBCDIC 500 without a code page) and drawn with a system font.
   * @param {FontSpec} spec Mapping.
   * @param {object|null} cp Code page, if available.
   * @param {object|null} fcs Character set, if available (for metrics and typeface).
   * @param {number|null} size Size in page units, if known.
   * @param {string} label Font name for the family choice.
   * @returns {Promise<object>} Font handle.
   */
  async #substitute(spec, cp, fcs, size, label) {
    const em = size ?? (fcs?.nominalPointSize ? fcs.nominalPointSize * 2 : DEFAULT_SIZE);
    const family = substituteFamily(`${fcs?.typeface ?? ''} ${label}`);
    await loadCodePage('ebcdic-500');
    const widthFactor = family === 'monospace' ? 0.6 : 0.5;
    return this.#register({
      kind: 'substitute',
      descriptor: { kind: 'substitute', family, size: em, charRotation: spec.rotation ?? 0, name: label },
      baselineIncrement: em * 1.2,
      underscore: { position: em * 0.12, width: Math.max(1, em * 0.05) },
      split: (bytes) => splitCodes(bytes, cp?.doubleByte ? 2 : 1),
      glyph(code) {
        const gcgid = cp?.map.get(code)?.gcgid;
        const unicode = gcgid ? (gcgidToUnicode(gcgid) ?? '') : decode('ebcdic-500', Uint8Array.of(code));
        return { id: unicode, gcgid: gcgid ?? null, unicode, advance: em * widthFactor, variableSpace: cp ? code === cp.variableSpace : code === 0x40 };
      },
    });
  }

  /**
   * Builds a handle for a TrueType/OpenType font referenced by full name (Map Data Resource).
   * Text is UTF-16BE; glyph advances come from the font's metrics.
   * @param {FontSpec} spec Mapping with `dataObject`.
   * @param {{type: string, name: string}[]} missing Collects the font if it is missing.
   * @returns {Promise<object>} Font handle (substitute if the font is missing).
   */
  async #trueType(spec, missing) {
    const { name, height } = spec.dataObject;
    const em = height || DEFAULT_SIZE;
    const entry = await this.catalog.lookup('truetypeFont', name, { documentFileId: this.documentFileId });
    if (!entry) {
      this.#missing(name, 'truetypeFont', missing);
      const family = substituteFamily(name);
      return this.#register({
        kind: 'substitute',
        descriptor: { kind: 'substitute', family, size: em, charRotation: spec.rotation ?? 0, name },
        baselineIncrement: em * 1.2,
        underscore: { position: em * 0.12, width: Math.max(1, em * 0.05) },
        split: (bytes) => splitCodes(bytes, 2),
        glyph: (code) => ({ id: code, unicode: String.fromCharCode(code), advance: em * (family === 'monospace' ? 0.6 : 0.5), variableSpace: false }),
      });
    }
    const bytes = await this.#cached(entry, () => fontBytesOf(this.getFile(entry.fileId), entry));
    const metrics = readFontMetrics(bytes, entry.fontIndex ?? 0);
    const scale = em / metrics.unitsPerEm;
    return this.#register({
      kind: 'truetype',
      entry,
      descriptor: { kind: 'truetype', size: em, charRotation: spec.rotation ?? 0, name, fontIndex: entry.fontIndex ?? 0 },
      baselineIncrement: (metrics.ascender - metrics.descender) * scale * 1.2,
      underscore: { position: em * 0.1, width: Math.max(1, em * 0.05) },
      split: (b) => splitCodes(b, 2),
      glyph(code) {
        const glyph = metrics.cmap.get(code) ?? 0;
        return { id: code, unicode: String.fromCharCode(code), advance: metrics.advance(glyph) * scale, variableSpace: false };
      },
    });
  }
}

/**
 * Returns the X0 variant of a coded font name with prefix X1–X9 (e.g. "X1NEOAF1" → "X0NEOAF1",
 * "X4NEOAF" → "X0NEOAF"), used when the requested coded font is missing. Maintainer decision
 * 2026-11-06: documents may refer to X1…/X4… coded fonts while only the X0… variants are
 * available.
 * @param {string} name Coded font name.
 * @returns {string|null} Alternative name, or null if the rule does not apply.
 */
export function redirectedCodedFont(name) {
  return /^X[1-9]/i.test(name) ? `X0${name.slice(2)}` : null;
}

/**
 * Splits text bytes into code points of one or two bytes.
 * @param {Uint8Array} bytes Text bytes.
 * @param {1|2} width Bytes per code point.
 * @returns {{code: number, length: number}[]} Code points.
 */
export function splitCodes(bytes, width) {
  const out = [];
  if (width === 1) {
    for (const b of bytes) out.push({ code: b, length: 1 });
  } else {
    for (let i = 0; i + 1 < bytes.length; i += 2) out.push({ code: (bytes[i] << 8) | bytes[i + 1], length: 2 });
  }
  return out;
}

/**
 * Returns the bytes of a TrueType/OpenType font: the whole file for font files, or the
 * concatenated Object Container Data of an embedded font.
 * @param {object} file File record.
 * @param {{beginRow: number}} entry Catalog entry (beginRow −1 for font files).
 * @returns {Promise<Uint8Array>} Font bytes.
 */
export async function fontBytesOf(file, entry) {
  if (entry.beginRow < 0) return file.byteSource.read(0, file.size);
  const parts = await collectFields(file, entry.beginRow, new Set([0xd3ee92]));
  return concat(parts.map((p) => p.data));
}

/**
 * Returns raster glyph bitmaps and placement values for the viewer.
 * @param {object} handle Raster font handle.
 * @param {string[]} gcgids Glyphs.
 * @returns {{id: string, width: number, height: number, rowBytes: number, bits: Uint8Array,
 *   a: number, baseOffset: number}[]} Bitmaps (font units; scale by 1440 / resolution).
 */
export function rasterGlyphs(handle, gcgids) {
  const out = [];
  for (const id of gcgids) {
    const m = handle.metrics.get(id);
    const bm = m ? glyphBitmap(handle.fcs, m.pattern) : null;
    if (bm) out.push({ id, ...bm, bits: bm.bits.slice(), a: m.a, baseOffset: m.baseOffset });
  }
  return out;
}
