/**
 * Outline fonts in AFP font character sets (FOCA pattern technology X'1F' Type 1 and X'1E'
 * CID-keyed): reads the font program stored in the Font Patterns (FNG) data and turns glyph
 * descriptions into path commands (task T061).
 *
 * Specifications: Adobe Type 1 Font Format (eexec encryption, charstring operators, flex, hint
 * replacement, seac accented characters) and Adobe CID-Keyed Font File Format (CIDFontType 0:
 * CIDMap, FDArray with per-font subroutines, binary or hex data after StartData). Layouts were
 * checked against sample files.
 *
 * Paths are in font units (usually 1000 per em) with y pointing up, as in the font.
 */

const EEXEC_KEY = 55665;
const CHARSTRING_KEY = 4330;

/**
 * Decrypts Type 1 encrypted data.
 * @param {Uint8Array} data Encrypted bytes.
 * @param {number} key Initial key (55665 for eexec, 4330 for charstrings).
 * @param {number} skip Number of leading random bytes to drop (4 for eexec, lenIV for charstrings).
 * @returns {Uint8Array} Decrypted bytes.
 */
export function decrypt(data, key, skip) {
  let r = key;
  const out = new Uint8Array(Math.max(0, data.length - skip));
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    const p = c ^ (r >> 8);
    r = ((c + r) * 52845 + 22719) & 0xffff;
    if (i >= skip) out[i - skip] = p;
  }
  return out;
}

/**
 * Text of bytes (Latin-1).
 * @param {Uint8Array} d Bytes.
 * @param {number} [from] First byte.
 * @param {number} [to] End (exclusive).
 * @returns {string} Text.
 */
const latin1 = (d, from = 0, to = d.length) => {
  let s = '';
  for (let i = from; i < to; i += 8192) s += String.fromCharCode(...d.subarray(i, Math.min(to, i + 8192)));
  return s;
};

/**
 * Finds a byte sequence.
 * @param {Uint8Array} d Bytes.
 * @param {string} text ASCII text to find.
 * @param {number} [from] Start position.
 * @returns {number} Position or −1.
 */
function indexOf(d, text, from = 0) {
  const first = text.charCodeAt(0);
  outer: for (let i = from; i <= d.length - text.length; i++) {
    if (d[i] !== first) continue;
    for (let j = 1; j < text.length; j++) if (d[i + j] !== text.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

/**
 * Converts hex text (with whitespace) to bytes.
 * @param {Uint8Array} d Hex characters.
 * @returns {Uint8Array} Bytes.
 */
function fromHex(d) {
  const out = new Uint8Array(d.length >> 1);
  let n = 0;
  let hi = -1;
  for (const c of d) {
    const v = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
    if (v < 0) continue;
    if (hi < 0) hi = v;
    else {
      out[n++] = (hi << 4) | v;
      hi = -1;
    }
  }
  return out.subarray(0, n);
}

/**
 * Reads a number value "/Key 123" from PostScript text.
 * @param {string} text PostScript text.
 * @param {string} key Key without slash.
 * @param {number} fallback Value if missing.
 * @returns {number} Value.
 */
function psNumber(text, key, fallback) {
  const m = text.match(new RegExp(`/${key}\\s+(-?[\\d.]+)`));
  return m ? Number(m[1]) : fallback;
}

/**
 * Reads entries "/name n RD <n bytes>" or "dup i n RD <n bytes>" from decrypted private data.
 * @param {Uint8Array} d Decrypted private section.
 * @param {RegExp} pattern Pattern matching the entry header (group 1 = key, group 2 = length,
 *   last match position = end of the "RD " token).
 * @param {number} from Start position.
 * @param {number} to End position.
 * @returns {Map<string, Uint8Array>} Key → encrypted charstring bytes.
 */
function readEntries(d, pattern, from, to) {
  const out = new Map();
  const text = latin1(d, from, to);
  const re = new RegExp(pattern.source, 'g');
  let m;
  while ((m = re.exec(text))) {
    const start = from + m.index + m[0].length;
    const len = Number(m[2]);
    out.set(m[1], d.subarray(start, start + len));
    re.lastIndex = m.index + m[0].length + len;
  }
  return out;
}

/**
 * Reads a Type 1 font program (PFB with segment headers, or PFA text) from FNG data.
 * @param {Uint8Array} fng Font Patterns data of a Type 1 font character set.
 * @returns {{charStrings: Map<string, Uint8Array>, subrs: Uint8Array[], lenIV: number,
 *   fontMatrix: number[]}|null} Encrypted charstrings and subroutines, or null if not found.
 */
export function readType1(fng) {
  const start = Math.max(indexOf(fng, '%!PS-AdobeFont'), indexOf(fng, '%!FontType1'));
  if (start < 0) return null;
  let clear;
  let encrypted;
  if (fng[start - 6] === 0x80 && fng[start - 5] === 0x01) {
    // PFB: segments of 0x80, type (1 text, 2 binary, 3 end), 4-byte little-endian length.
    const text = [];
    const binary = [];
    let pos = start - 6;
    while (fng[pos] === 0x80 && fng[pos + 1] !== 0x03 && pos + 6 <= fng.length) {
      const len = fng[pos + 2] | (fng[pos + 3] << 8) | (fng[pos + 4] << 16) | (fng[pos + 5] << 24);
      (fng[pos + 1] === 0x01 ? text : binary).push(fng.subarray(pos + 6, pos + 6 + len));
      if (fng[pos + 1] === 0x01 && binary.length) break; // trailing cleartext (zeros, cleartomark)
      pos += 6 + len;
    }
    clear = text[0];
    encrypted = concatBytes(binary);
  } else {
    const ee = indexOf(fng, 'eexec', start);
    if (ee < 0) return null;
    clear = fng.subarray(start, ee);
    let p = ee + 5;
    while (fng[p] === 0x0d || fng[p] === 0x0a || fng[p] === 0x20) p++;
    const hexLike = [...fng.subarray(p, p + 4)].every((c) => /[0-9A-Fa-f]/.test(String.fromCharCode(c)));
    encrypted = hexLike ? fromHex(fng.subarray(p)) : fng.subarray(p);
  }
  const priv = decrypt(encrypted, EEXEC_KEY, 4);
  const privText = latin1(priv, 0, Math.min(priv.length, 4096));
  const lenIV = psNumber(privText, 'lenIV', 4);
  const csStart = indexOf(priv, '/CharStrings');
  const subrsMap = readEntries(priv, /dup\s+(\d+)\s+(\d+)\s+(?:RD|-\|)\s/, 0, csStart < 0 ? priv.length : csStart);
  const subrs = [];
  for (const [i, bytes] of subrsMap) subrs[Number(i)] = bytes;
  const charStrings = readEntries(priv, /\/([^\s/]+)\s+(\d+)\s+(?:RD|-\|)\s/, Math.max(csStart, 0), priv.length);
  const matrix = latin1(clear).match(/\/FontMatrix\s*\[([^\]]+)\]/);
  return { charStrings, subrs, lenIV, fontMatrix: matrix ? matrix[1].trim().split(/\s+/).map(Number) : [0.001, 0, 0, 0.001, 0, 0] };
}

/**
 * Concatenates byte arrays.
 * @param {Uint8Array[]} parts Parts.
 * @returns {Uint8Array} Joined bytes.
 */
function concatBytes(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/**
 * Reads a CID-keyed font program (CIDFontType 0) from FNG data.
 * @param {Uint8Array} fng Font Patterns data of a CID-keyed font character set.
 * @returns {{cidCount: number, charString: (cid: number) => {bytes: Uint8Array, fd: number}|null,
 *   fds: {subrs: Uint8Array[], lenIV: number}[], fontMatrix: number[]}|null} Font, or null.
 */
export function readCidFont(fng) {
  const start = indexOf(fng, '%!PS-Adobe-3.0 Resource-CIDFont');
  if (start < 0) return null;
  const sd = indexOf(fng, 'StartData', start);
  if (sd < 0) return null;
  const header = latin1(fng, start, sd);
  const kind = header.match(/\((Binary|Hex)\)\s+(\d+)\s*$/);
  if (!kind) return null;
  const dataLen = Number(kind[2]);
  const dataStart = sd + 'StartData'.length + 1;
  const data = kind[1] === 'Hex' ? fromHex(fng.subarray(dataStart, dataStart + 2 * dataLen + dataLen / 16 + 64)).subarray(0, dataLen)
    : fng.subarray(dataStart, dataStart + dataLen);
  const cidCount = psNumber(header, 'CIDCount', 0);
  const mapOffset = psNumber(header, 'CIDMapOffset', 0);
  const fdBytes = psNumber(header, 'FDBytes', 1);
  const gdBytes = psNumber(header, 'GDBytes', 4);
  const num = (at, n) => {
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + (data[at + i] ?? 0);
    return v;
  };
  // FDArray: one Private dictionary per font dictionary, in order.
  const fds = [];
  for (const priv of header.split('/Private').slice(1)) {
    const subrMapOffset = psNumber(priv, 'SubrMapOffset', 0);
    const sdBytes = psNumber(priv, 'SDBytes', 4);
    const subrCount = psNumber(priv, 'SubrCount', 0);
    const lenIV = psNumber(priv, 'lenIV', 4);
    const subrs = [];
    for (let i = 0; i < subrCount; i++) {
      const a = num(subrMapOffset + i * sdBytes, sdBytes);
      const b = num(subrMapOffset + (i + 1) * sdBytes, sdBytes);
      subrs.push(data.subarray(a, b));
    }
    fds.push({ subrs, lenIV });
  }
  const entry = fdBytes + gdBytes;
  const matrix = header.match(/\/FontMatrix\s*\[([^\]]+)\]/);
  return {
    cidCount,
    fds,
    fontMatrix: matrix ? matrix[1].trim().split(/\s+/).map(Number) : [0.001, 0, 0, 0.001, 0, 0],
    charString(cid) {
      if (cid < 0 || cid >= cidCount) return null;
      const at = mapOffset + cid * entry;
      const fd = num(at, fdBytes);
      const a = num(at + fdBytes, gdBytes);
      const b = num(at + entry + fdBytes, gdBytes);
      if (b <= a) return null;
      return { bytes: data.subarray(a, b), fd };
    },
  };
}

/**
 * Reads a CMap (code → CID mapping) embedded in the font data, e.g. a "…-UCS2-H" CMap, where the
 * Font Name Map gives Unicode values that the CMap turns into CIDs.
 * Supports `cidrange` and `cidchar` entries with hexadecimal codes.
 * @param {Uint8Array} fng Font Patterns data.
 * @returns {Map<number, number>|null} Code → CID, or null if there is no CMap.
 */
export function readCMap(fng) {
  const begin = indexOf(fng, 'begincmap');
  if (begin < 0) return null;
  const end = indexOf(fng, 'endcmap', begin);
  const text = latin1(fng, begin, end < 0 ? Math.min(fng.length, begin + 2_000_000) : end);
  const map = new Map();
  for (const block of text.matchAll(/begincidrange([\s\S]*?)endcidrange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\d+)/g)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      const cid = Number(m[3]);
      for (let c = lo; c <= hi && c - lo < 0x10000; c++) map.set(c, cid + c - lo);
    }
  }
  for (const block of text.matchAll(/begincidchar([\s\S]*?)endcidchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*(\d+)/g)) map.set(parseInt(m[1], 16), Number(m[2]));
  }
  return map.size ? map : null;
}

/** Adobe StandardEncoding names needed by `seac` (accented characters). */
const STANDARD_ENCODING = (() => {
  const names = [];
  const ascii = ['space', 'exclam', 'quotedbl', 'numbersign', 'dollar', 'percent', 'ampersand', 'quoteright',
    'parenleft', 'parenright', 'asterisk', 'plus', 'comma', 'hyphen', 'period', 'slash',
    'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'colon', 'semicolon',
    'less', 'equal', 'greater', 'question', 'at'];
  ascii.forEach((n, i) => { names[32 + i] = n; });
  for (let i = 0; i < 26; i++) {
    names[65 + i] = String.fromCharCode(65 + i);
    names[97 + i] = String.fromCharCode(97 + i);
  }
  Object.assign(names, { 91: 'bracketleft', 92: 'backslash', 93: 'bracketright', 94: 'asciicircum', 95: 'underscore',
    96: 'quoteleft', 123: 'braceleft', 124: 'bar', 125: 'braceright', 126: 'asciitilde', 161: 'exclamdown',
    162: 'cent', 163: 'sterling', 164: 'fraction', 165: 'yen', 166: 'florin', 167: 'section', 168: 'currency',
    169: 'quotesingle', 170: 'quotedblleft', 171: 'guillemotleft', 172: 'guilsinglleft', 173: 'guilsinglright',
    174: 'fi', 175: 'fl', 177: 'endash', 178: 'dagger', 179: 'daggerdbl', 180: 'periodcentered', 182: 'paragraph',
    183: 'bullet', 184: 'quotesinglbase', 185: 'quotedblbase', 186: 'quotedblright', 187: 'guillemotright',
    188: 'ellipsis', 189: 'perthousand', 191: 'questiondown', 193: 'grave', 194: 'acute', 195: 'circumflex',
    196: 'tilde', 197: 'macron', 198: 'breve', 199: 'dotaccent', 200: 'dieresis', 202: 'ring', 203: 'cedilla',
    205: 'hungarumlaut', 206: 'ogonek', 207: 'caron', 208: 'emdash', 225: 'AE', 227: 'ordfeminine', 232: 'Lslash',
    233: 'Oslash', 234: 'OE', 235: 'ordmasculine', 241: 'ae', 245: 'dotlessi', 248: 'lslash', 249: 'oslash',
    250: 'oe', 251: 'germandbls' });
  return names;
})();

/**
 * @typedef {['M', number, number] | ['L', number, number] | ['C', number, number, number, number, number, number] | ['Z']} PathCommand
 */

/**
 * Runs a Type 1 charstring and returns the glyph outline.
 * @param {Uint8Array} encrypted Encrypted charstring.
 * @param {object} font Font access.
 * @param {Uint8Array[]} font.subrs Encrypted subroutines.
 * @param {number} font.lenIV Random bytes at the start of each charstring (−1 = not encrypted).
 * @param {(name: string) => Uint8Array|null} [font.glyph] Encrypted charstring by glyph name (for seac).
 * @returns {{path: PathCommand[], advance: number, lsb: number}} Outline and metrics in font units.
 */
export function runCharString(encrypted, font) {
  const plain = (b) => (font.lenIV < 0 ? b : decrypt(b, CHARSTRING_KEY, font.lenIV));
  const path = [];
  const stack = [];
  const ps = [];
  let x = 0;
  let y = 0;
  let advance = 0;
  let lsb = 0;
  let flex = null;
  let open = false;
  let done = false;
  const move = (nx, ny) => {
    if (flex) {
      flex.push([nx, ny]);
    } else {
      if (open) path.push(['Z']);
      path.push(['M', nx, ny]);
      open = true;
    }
    x = nx;
    y = ny;
  };
  const line = (nx, ny) => { path.push(['L', nx, ny]); x = nx; y = ny; };
  const curve = (x1, y1, x2, y2, x3, y3) => { path.push(['C', x1, y1, x2, y2, x3, y3]); x = x3; y = y3; };

  const exec = (cs, depth) => {
    if (depth > 10) return;
    for (let i = 0; i < cs.length && !done; i++) {
      const v = cs[i];
      if (v >= 32) {
        if (v <= 246) stack.push(v - 139);
        else if (v <= 250) stack.push((v - 247) * 256 + cs[++i] + 108);
        else if (v <= 254) stack.push(-(v - 251) * 256 - cs[++i] - 108);
        else {
          stack.push(((cs[i + 1] << 24) | (cs[i + 2] << 16) | (cs[i + 3] << 8) | cs[i + 4]));
          i += 4;
        }
        continue;
      }
      switch (v) {
        case 1: case 3: stack.length = 0; break; // hstem, vstem
        case 4: move(x, y + stack[0]); stack.length = 0; break; // vmoveto
        case 5: line(x + stack[0], y + stack[1]); stack.length = 0; break; // rlineto
        case 6: line(x + stack[0], y); stack.length = 0; break; // hlineto
        case 7: line(x, y + stack[0]); stack.length = 0; break; // vlineto
        case 8: { // rrcurveto
          const [a, b, c, d, e, f] = stack;
          curve(x + a, y + b, x + a + c, y + b + d, x + a + c + e, y + b + d + f);
          stack.length = 0;
          break;
        }
        case 9: if (open) { path.push(['Z']); open = false; } stack.length = 0; break; // closepath
        case 10: { // callsubr
          const n = stack.pop();
          const sub = font.subrs[n];
          if (sub) exec(plain(sub), depth + 1);
          break;
        }
        case 11: return; // return
        case 13: lsb = stack[0]; advance = stack[1]; x = lsb; y = 0; stack.length = 0; break; // hsbw
        case 14: done = true; break; // endchar
        case 21: move(x + stack[0], y + stack[1]); stack.length = 0; break; // rmoveto
        case 22: move(x + stack[0], y); stack.length = 0; break; // hmoveto
        case 30: { // vhcurveto
          const [a, b, c, d] = stack;
          curve(x, y + a, x + b, y + a + c, x + b + d, y + a + c);
          stack.length = 0;
          break;
        }
        case 31: { // hvcurveto
          const [a, b, c, d] = stack;
          curve(x + a, y, x + a + b, y + c, x + a + b, y + c + d);
          stack.length = 0;
          break;
        }
        case 12: {
          const op = cs[++i];
          switch (op) {
            case 0: case 1: case 2: stack.length = 0; break; // dotsection, vstem3, hstem3
            case 6: { // seac: accented character from base and accent glyphs
              const [, adx, ady, bchar, achar] = stack;
              stack.length = 0;
              const base = font.glyph?.(STANDARD_ENCODING[bchar]);
              const accent = font.glyph?.(STANDARD_ENCODING[achar]);
              const keepAdvance = advance;
              const keepLsb = lsb;
              if (base) {
                const b = runCharString(base, font);
                path.push(...b.path);
              }
              if (accent) {
                const a = runCharString(accent, font);
                const dx = adx + keepLsb - a.lsb;
                for (const cmd of a.path) path.push(shift(cmd, dx, ady));
              }
              advance = keepAdvance;
              done = true;
              break;
            }
            case 7: lsb = stack[0]; advance = stack[2]; x = lsb; y = stack[1]; stack.length = 0; break; // sbw
            case 12: { const b = stack.pop(); const a = stack.pop(); stack.push(a / b); break; } // div
            case 16: { // callothersubr
              const n = stack.pop();
              const argc = stack.pop();
              const args = stack.splice(stack.length - argc, argc);
              if (n === 1) { flex = []; } else if (n === 0 && flex) {
                // flex: reference point + 6 control points → two curves
                const p = flex;
                flex = null;
                if (p.length >= 7) {
                  path.push(['C', p[1][0], p[1][1], p[2][0], p[2][1], p[3][0], p[3][1]]);
                  path.push(['C', p[4][0], p[4][1], p[5][0], p[5][1], p[6][0], p[6][1]]);
                  x = p[6][0];
                  y = p[6][1];
                }
                ps.push(y, x);
              } else if (n === 3) {
                ps.push(3); // hint replacement: subroutine 3 is called next
              } else {
                ps.push(...args.reverse());
              }
              break;
            }
            case 17: stack.push(ps.pop() ?? 0); break; // pop
            case 33: stack.length = 0; break; // setcurrentpoint (position already tracked)
            default: stack.length = 0;
          }
          break;
        }
        default: stack.length = 0;
      }
    }
  };
  exec(plain(encrypted), 0);
  if (open) path.push(['Z']);
  return { path, advance, lsb };
}

/**
 * Moves a path command.
 * @param {PathCommand} cmd Command.
 * @param {number} dx X offset.
 * @param {number} dy Y offset.
 * @returns {PathCommand} Moved command.
 */
function shift(cmd, dx, dy) {
  if (cmd[0] === 'Z') return cmd;
  const out = [cmd[0]];
  for (let i = 1; i < cmd.length; i += 2) out.push(cmd[i] + dx, cmd[i + 1] + dy);
  return out;
}

/**
 * Builds a glyph outline reader for an AFP outline font character set.
 * @param {{technology: string, patternData: Uint8Array}} fcs Font character set.
 * @returns {{outline: (id: string|number) => {path: PathCommand[], advance: number}|null,
 *   unitsPerEm: number}|null} Outline reader, or null if the program cannot be read.
 */
export function outlineReader(fcs) {
  if (fcs.technology === 'type1') {
    const t1 = readType1(fcs.patternData);
    if (!t1) return null;
    const font = { subrs: t1.subrs, lenIV: t1.lenIV, glyph: (name) => t1.charStrings.get(name) ?? null };
    return {
      unitsPerEm: Math.round(1 / (t1.fontMatrix[0] || 0.001)),
      outline(name) {
        const cs = t1.charStrings.get(String(name));
        return cs ? runCharString(cs, font) : null;
      },
    };
  }
  if (fcs.technology === 'cid') {
    const cf = readCidFont(fcs.patternData);
    if (!cf) return null;
    const cmap = readCMap(fcs.patternData);
    return {
      unitsPerEm: Math.round(1 / (cf.fontMatrix[0] || 0.001)),
      outline(code) {
        const cid = cmap ? (cmap.get(Number(code)) ?? Number(code)) : Number(code);
        const entry = cf.charString(cid);
        if (!entry) return null;
        const fd = cf.fds[entry.fd] ?? cf.fds[0] ?? { subrs: [], lenIV: 4 };
        return runCharString(entry.bytes, { subrs: fd.subrs, lenIV: fd.lenIV });
      },
    };
  }
  return null;
}
