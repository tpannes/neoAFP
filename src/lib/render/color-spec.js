/**
 * Color specifications as given in the file, for the color picker and the structure tree: the
 * color space and the original values, next to the RGB color the renderer draws (which is only an
 * approximation: neoAFP does no color management).
 *
 * A specification is `{space, value}`: `space` names the color space ('OCA', 'RGB', 'CMYK',
 * 'CIELab', 'Highlight' or X'..'), `value` the values as text in the specification's English
 * terms, e.g. "Blue", "0 90 180", "100 20 0 0 %".
 *
 * Sources:
 * - standard OCA colors: PTOCA Set Text Color, GOCA Set (Extended) Color, BCOCA BSD color,
 *   IM image color (PTOCA Reference, "Standard OCA Color Value Table");
 * - extended colors: PTOCA Set Extended Text Color, GOCA Set Process Color, MO:DCA Color
 *   Specification triplet X'4E' (same layout after the first byte: reserved, ColSpce, 4 reserved,
 *   ColSize1–4, ColValue).
 */

/** Standard OCA color names. */
const OCA_NAMES = {
  0x0000: 'Default', 0x0001: 'Blue', 0x0002: 'Red', 0x0003: 'Pink/Magenta', 0x0004: 'Green',
  0x0005: 'Turquoise/Cyan', 0x0006: 'Yellow', 0x0007: 'White', 0x0008: 'Black', 0x0009: 'Dark Blue',
  0x000a: 'Orange', 0x000b: 'Purple', 0x000c: 'Dark Green', 0x000d: 'Dark Turquoise', 0x000e: 'Mustard',
  0x000f: 'Gray', 0x0010: 'Brown', 0xff00: 'Default', 0xff07: 'Default', 0xff08: 'Reset', 0xffff: 'Default',
};

/** Color spaces of extended colors (ColSpce). */
const COLOR_SPACES = { 0x01: 'RGB', 0x04: 'CMYK', 0x06: 'Highlight', 0x08: 'CIELab', 0x40: 'OCA' };

/**
 * Writes a number as X'..' with an even number of hex digits.
 * @param {number} v Number.
 * @returns {string} E.g. "X'0B'".
 */
const hexOf = (v) => {
  const h = v.toString(16).toUpperCase();
  return `X'${h.padStart(h.length + (h.length % 2), '0')}'`;
};

/**
 * Writes a number with at most one decimal.
 * @param {number} v Number.
 * @returns {string} E.g. "54.9".
 */
const fmt = (v) => String(Math.round(v * 10) / 10);

/**
 * Describes a standard OCA color value.
 * @param {number} value Two-byte color value (one byte for GOCA Set Color).
 * @returns {{space: string, value: string}} Specification.
 */
export function ocaColorSpec(value) {
  return { space: 'OCA', value: OCA_NAMES[value] ?? hexOf(value) };
}

/**
 * Describes an extended color (Set Extended Text Color, Set Process Color, triplet X'4E').
 * @param {Uint8Array} d Data: reserved, ColSpce, 4 reserved, ColSize1–4, ColValue.
 * @returns {{space: string, value: string}|null} Specification, or null when too short.
 */
export function extendedColorSpec(d) {
  if (!d || d.length < 11) return null;
  const space = d[1];
  const value = d.subarray(10);
  const bits = d[6] || 8;
  const max = 2 ** bits - 1;
  const at = (k) => (bits === 16 ? (value[2 * k] << 8) | value[2 * k + 1] : value[k]) ?? 0;
  let shown;
  if (space === 0x40) shown = OCA_NAMES[(value[0] << 8) | value[1]] ?? hexOf((value[0] << 8) | value[1]);
  // CIELab: L 0–100 in ColSize1 bits, a* and b* signed 8-bit.
  else if (space === 0x08) shown = `${fmt((value[0] * 100) / 255)} ${value[1] > 127 ? value[1] - 256 : value[1]} ${value[2] > 127 ? value[2] - 256 : value[2]}`;
  else if (space === 0x04) shown = `${[0, 1, 2, 3].map((k) => Math.round((at(k) * 100) / max)).join(' ')} %`;
  else if (space === 0x06) shown = `#${(value[0] << 8) | value[1]}${value.length >= 3 ? ` · ${value[2]} %` : ''}`;
  else shown = [0, 1, 2].map(at).join(' ');
  return { space: COLOR_SPACES[space] ?? hexOf(space), value: shown };
}

/**
 * The `colorSpec` property of a render item, left out when there is no specification (the item
 * is then drawn in the default color).
 * @param {{space: string, value: string}|null|undefined} spec Specification.
 * @returns {{colorSpec?: {space: string, value: string}}} Property to spread into the item.
 */
export function colorSpecField(spec) {
  return spec ? { colorSpec: spec } : {};
}
