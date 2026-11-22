/**
 * GOCA default pattern set (GOCA for AFP Reference AFPC-0008-03, "Patterns in the Default Pattern
 * Set", Figure 19; task T299): the fill patterns X'01'–X'0E' as tiles of 240-dpi pels, 1 = drawn
 * in the area color, 0 = background (left alone). The tiles were taken pel for pel from the
 * figure, which the reference prints at 240 dpi; the reference calls them representative and
 * allows implementation differences in dot size and spacing. X'0F' (and X'40') is no fill, X'10'
 * (and X'00') solid fill.
 */

/** Size of a pattern pel in page units (1/1440 inch): 240 dpi. */
export const PATTERN_PEL = 6;

/**
 * Builds a tile from its rows as hex (each row padded to whole bytes, most significant bit first).
 * @param {number} width Width in pels.
 * @param {number} height Height in pels.
 * @param {string} hex Rows, top first.
 * @returns {{width: number, height: number, rowBytes: number, bits: Uint8Array}} Tile.
 */
function tile(width, height, hex) {
  const bits = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bits.length; i++) bits[i] = parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return { width, height, rowBytes: Math.ceil(width / 8), bits };
}

/** Pattern symbol → tile. */
export const PATTERN_TILES = {
  0x01: tile(2, 2, '8040'), // dots, densest
  0x02: tile(2, 2, '8000'), // dots
  0x03: tile(4, 4, '0000c0c0'), // dots
  0x04: tile(8, 8, '00000c0c0000c0c0'), // dots
  0x05: tile(8, 16, '060f0f060000000060f0f06000000000'), // dots
  0x06: tile(16, 16, '7000f800f800f8007000000000000000007000f800f800f80070000000000000'), // dots
  0x07: tile(32, 32, '00003e00000000000000000000000000000000000000000000000000000000003e0000007f000000ff800000ff800000ff800000ff800000ff8000007f0000003e0000000000000000000000000000000000000000000000000000000000000000003e0000007f000000ff800000ff800000ff800000ff800000ff8000007f00'), // dots
  0x08: tile(32, 32, '00000000000000000000000000000000000000000000000000000000000000000000003e0000007f800000ff800000ff800000ff800000ff800000ff0000007f0000003e000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'), // dots, sparsest
  0x09: tile(8, 1, 'e0'), // vertical lines
  0x0a: tile(1, 16, '00008080808080808080000000000000'), // horizontal lines
  0x0b: tile(32, 32, '0003fc000007f800000ff000001fe000003fc000007f800000ff000001fe000003fc000007f800000ff000001fe000003fc000007f800000ff000000fe000001fc000003f8000007f000000fe000001fc000003f8000007f000000ff000001fe000003fc000007f800000ff000001fe000003fc000007f800000ff000001fe00'), // diagonal lines 1, bottom-left to top-right
  0x0c: tile(32, 16, '000000ff000003fc00000ff000003fc00000ff000003fc00000ff000003fc00000ff000003fc00000ff000003fc00000ff000000fc000003f000000fc000003f'), // diagonal lines 2, bottom-left to top-right
  0x0d: tile(32, 32, '0000ff0000007f8000003fc000001fe000000ff0000007f8000003fc000001fe000000ff8000007fc000003fe000001ff000000ff8000007fc000003fe000001ff0000007f8000003fc000001fe000000ff0000007f8000003fc000001fe000000ff0000007f8000003fc000001fe000000ff0000007f8000003fc000001fe00'), // diagonal lines 1, top-left to bottom-right
  0x0e: tile(32, 16, '000ff0000003fc000000ff0000003fc000000ff0000003fc000000ffc000003ff000000ffc000003ff0000003fc000000ff0000003fc000000ff0000003fc000'), // diagonal lines 2, top-left to bottom-right
};

/**
 * Tells how an area with a pattern symbol of the default pattern set is filled.
 * @param {number} symbol Pattern symbol (GSPT).
 * @returns {'none'|'solid'|'pattern'} Fill kind.
 */
export function patternFill(symbol) {
  if (symbol === 0x0f || symbol === 0x40) return 'none';
  return PATTERN_TILES[symbol] ? 'pattern' : 'solid';
}
