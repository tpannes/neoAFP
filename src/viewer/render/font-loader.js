/**
 * Font loader: registers TrueType/OpenType fonts from AFP files (font files or fonts embedded in
 * object containers) with the browser's FontFace API, so canvas text can use them (FR-012).
 */

/**
 * Loads fonts once per reference.
 */
export class FontLoader {
  /**
   * Creates a loader.
   * @param {import('../worker-client.js').WorkerClient} client Worker client.
   */
  constructor(client) {
    this.client = client;
    /** @type {Map<string, Promise<string|null>>} font ref → CSS family name (null if loading failed) */
    this.families = new Map();
  }

  /**
   * Returns the CSS font family of a TrueType/OpenType font, loading it if needed.
   * @param {string} ref Font reference from a glyph run.
   * @returns {Promise<string|null>} Family name usable in ctx.font, or null if it failed.
   */
  family(ref) {
    if (!this.families.has(ref)) {
      this.families.set(ref, (async () => {
        try {
          const { bytes } = await this.client.request({ method: 'getFontBytes', args: [ref], priority: 'high' });
          const family = `neoafp-${ref}`;
          const face = new FontFace(family, bytes);
          await face.load();
          (globalThis.document?.fonts ?? self.fonts)?.add(face);
          return family;
        } catch {
          return null;
        }
      })());
    }
    return this.families.get(ref);
  }
}

/** Generic CSS families used for substitute fonts. */
export const SUBSTITUTE_FAMILIES = Object.freeze({
  serif: '"Times New Roman", "Noto Serif", serif',
  'sans-serif': 'Arial, Helvetica, "Noto Sans", sans-serif',
  monospace: '"Courier New", Courier, "Noto Sans Mono", monospace',
});
