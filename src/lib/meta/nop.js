/**
 * No Operation records (FR-036, MO:DCA Reference, "No Operation (NOP)"): their data is undefined
 * (UNDF), so the file gives no code page for it. NOP text is shown in the code page the user
 * chose for NOPs. Without that choice each NOP is shown in EBCDIC 273 (German) or Windows-1252,
 * whichever gives more readable characters (generators write comments in either: e.g. the test
 * sets mix EBCDIC and ASCII NOPs in one file); on a tie EBCDIC 273 wins. ASCII-like text whose
 * bytes above X'7F' all form valid UTF-8 sequences (and at least one does) is UTF-8: ISIS
 * Papyrus writes its $ISIS_TAG records that way, and read as Windows-1252 "ä" would become "Ã¤". A NOP that decodes in
 * neither (less than half of its bytes readable in both, e.g. the binary tables some font
 * resources keep in NOPs) is shown in EBCDIC 273 too, never in whichever code page happens to
 * score a little higher on binary data. Bytes that are not text appear as placeholders; NOPs
 * have no hex form of their own (the raw bytes are in the structure view's hex display).
 */

import { sequentialReader } from '../modca/access.js';
import { loadCodePage, decode } from '../codepages/index.js';
import { decodePrintable, DEFAULT_CODE_PAGE } from './hex.js';
import { enclosingPage } from './owner.js';

/** Code pages tried for NOPs without a user choice, in order of preference. */
const CANDIDATES = [DEFAULT_CODE_PAGE, 'windows-1252'];
/** All code pages detection can choose (loaded before decoding). */
const DETECTED = [...CANDIDATES, 'utf-8'];
/** Characters that count as readable when choosing a code page. */
const READABLE = /[A-Za-z0-9 .,:;\-()'"\/_=+%&@#*!?ÄÖÜäöüß]/u;
/** Share of readable characters from which a NOP counts as text in a code page. */
const TEXT_SHARE = 0.5;

/**
 * Chooses the code page under which NOP bytes read best; EBCDIC 273 when they are text in
 * neither candidate.
 * @param {Uint8Array} bytes NOP data.
 * @returns {string} Code page id.
 */
export function detectNopCodePage(bytes) {
  let best = CANDIDATES[0];
  let bestScore = -1;
  for (const id of CANDIDATES) {
    let score = 0;
    for (const ch of decode(id, bytes)) if (READABLE.test(ch)) score++;
    if (score > bestScore) { best = id; bestScore = score; }
  }
  if (bestScore < bytes.length * TEXT_SHARE) return DEFAULT_CODE_PAGE;
  return best === 'windows-1252' && isMultibyteUtf8(bytes) ? 'utf-8' : best;
}

/**
 * Tells whether bytes are valid UTF-8 with at least one character of two or more bytes.
 * @param {Uint8Array} bytes Bytes.
 * @returns {boolean} True for UTF-8 text that is not plain ASCII.
 */
export function isMultibyteUtf8(bytes) {
  let multi = false;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) continue;
    const n = b >= 0xc2 && b <= 0xdf ? 1 : b >= 0xe0 && b <= 0xef ? 2 : b >= 0xf0 && b <= 0xf4 ? 3 : -1;
    if (n < 0 || i + n >= bytes.length) return false;
    for (let k = 1; k <= n; k++) if ((bytes[i + k] & 0xc0) !== 0x80) return false;
    i += n;
    multi = true;
  }
  return multi;
}

const NOP = 0xd3eeee;

/** Marker of the NOPs ISIS Papyrus writes to carry PDF/UA tagging through the AFP. */
const ISIS_TAG = '$ISIS_TAG';

/**
 * Tells whether a NOP is an ISIS Papyrus tagging record: its data starts (after blanks) with
 * "$ISIS_TAG", written in ASCII or in EBCDIC (the test files use ASCII). Checked on the bytes in
 * both encodings, so a code page chosen for NOPs does not change the answer.
 * @param {Uint8Array} bytes NOP data.
 * @returns {boolean} True for an ISIS tagging NOP.
 */
export function isIsisTag(bytes) {
  const head = bytes.subarray(0, 32);
  return [DEFAULT_CODE_PAGE, 'windows-1252'].some((cp) => decode(cp, head).trimStart().startsWith(ISIS_TAG));
}

/**
 * Collects and decodes the NOPs of a file.
 * @param {object} file File record.
 * @param {string|null} override Code page chosen for NOPs, or null.
 * @returns {Promise<{index: number, offset: number, ownerRef: number|null, pageNumber: number|null,
 *   rawBytes: Uint8Array, fileCodePage: null, codePage: string, text: string, isisTag: boolean}[]>}
 *   NOPs in file order; `codePage` is the override or the detected code page, `pageNumber` the
 *   page the NOP is on (null outside pages), `isisTag` whether it is an ISIS tagging record.
 */
export async function readNops(file, override) {
  const { index } = file;
  for (const id of DETECTED) await loadCodePage(id);
  const out = [];
  const read = sequentialReader(file);
  for (let row = 0; row < index.count; row++) {
    if (index.id[row] !== NOP) continue;
    // A copy, so the NOP does not keep the reader's whole window alive.
    const rawBytes = (await read(row)).slice();
    const codePage = override ?? detectNopCodePage(rawBytes);
    out.push({
      index: row,
      offset: index.offset[row],
      ownerRef: index.parent[row] >= 0 ? index.parent[row] : null,
      pageNumber: enclosingPage(file, row)?.pageNumber ?? null,
      rawBytes,
      fileCodePage: null,
      codePage,
      text: await decodePrintable(codePage, rawBytes),
      isisTag: isIsisTag(rawBytes),
    });
  }
  return out;
}

/**
 * Counts the NOPs and the ISIS tagging NOPs of a file (Details panel, FR-096) without decoding
 * them: the NOP count comes from the field index, the ISIS count from the first bytes of each NOP,
 * read in order through a sequentialReader. Cached on the file record (independent of code page
 * choices, see isIsisTag).
 * @param {object} file File record.
 * @returns {Promise<{nopCount: number, isisTagCount: number}>} Counts.
 */
export async function countNops(file) {
  file.nopCounts ??= (async () => {
    const { index } = file;
    await loadCodePage(DEFAULT_CODE_PAGE);
    await loadCodePage('windows-1252');
    const read = sequentialReader(file);
    let nopCount = 0;
    let isisTagCount = 0;
    for (let row = 0; row < index.count; row++) {
      if (index.id[row] !== NOP) continue;
      nopCount++;
      if (isIsisTag(await read(row))) isisTagCount++;
    }
    return { nopCount, isisTagCount };
  })();
  return file.nopCounts;
}
