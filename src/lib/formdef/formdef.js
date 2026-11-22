/**
 * Form definitions (FR-014, task T079): print instructions for documents — medium maps with
 * duplex mode, paper tray (input bin), output bin, media type, page position, N-up and medium
 * overlays. A document selects a medium map by name with Invoke Medium Map (IMM).
 *
 * Fields (MO:DCA Reference; layouts checked against sample files):
 * - BFM/EFM Begin/End Form Map; BDG/EDG document environment group with defaults (PGP, MDD).
 * - BMM/EMM Begin/End Medium Map (name).
 * - MDD Medium Descriptor: X/Y unit base (1 + 1), units per base (2 + 2), medium size (3 + 3).
 * - PGP Page Position format 1 (X'D3ACAF'): page X/Y offset (3 + 3) on the medium; format 2
 *   (X'D3B1AF'): constant, repeating group length, then groups of X/Y offset (3 + 3),
 *   orientation (2), sheet side (1: 0 front, 1 back), flags (1) — used for N-up.
 * - MCC Medium Copy Count: repeating groups (copy subgroups) of start and stop copy number
 *   (2 + 2), reserved (1), MMC id (1). Simplex: each group prints copies start…stop with the
 *   settings of its MMC (e.g. the original from tray 1, copies from tray 2), the copy count is
 *   the sum over all groups. Duplex: the groups come in pairs, the first for the front, the
 *   second for the back of the same copies, so only the first of each pair counts. Counting every
 *   group doubled every duplex sheet: a duplex map with the pair (1–1, 2–2) is one copy, and a
 *   duplex map with ten groups is five copies, e.g. front MMCs with X'F9' = 0 and back MMCs
 *   with X'F9' = 1.
 * - MFC Medium Finishing Control: flags (1), reserved (1), media collection (1), scope (1), then
 *   triplets; each Finishing Operation triplet X'85' names an operation (byte 2: X'01' corner
 *   staple, X'02' saddle stitch out, X'03' edge stitch, X'04' fold in, X'05' separation cut, X'06'
 *   perforation cut, X'07' Z-fold, X'08' center fold in, X'09' trim, X'0A' punch, X'0C' perfect
 *   bind, X'0D' ring bind, X'12' saddle stitch in), the reference edge (byte 5: X'00' bottom,
 *   X'01' right, X'02' top, X'03' left) and the number of staples or holes (byte 6, 0 = device
 *   default).
 * - MMC Medium Modification Control: MMC id (1), reserved (1), keyword pairs. Keywords used:
 *   X'E1' input bin (media source), X'F4' duplex (1 simplex, 2 normal, 3 tumble), X'FC' N-up
 *   (1–4), X'D1' medium overlay local id, X'90'/X'91' output bin high/low byte. X'E1' and X'F4'
 *   were verified against sample form definitions; the others follow the MO:DCA keyword list.
 * - MMO Map Medium Overlay: groups of local id and overlay name.
 * - MMT Map Media Type: media type name (Fully Qualified Name X'11').
 */

import { collectFields, fieldData, childRows } from '../modca/access.js';
import { u, s, orientation, ebcdicName, toPageUnits } from '../modca/bytes.js';
import { readCommonTriplets, FQN } from '../modca/structures.js';

const ID = {
  BDG: 0xd3a8c4, BMM: 0xd3a8cc, MDD: 0xd3a688, PGP1: 0xd3acaf, PGP2: 0xd3b1af, MCC: 0xd3a288,
  MMC: 0xd3a788, MMO: 0xd3b1df, MMT: 0xd3ab88, MFC: 0xd3a088, PMC: 0xd3a7af,
};

/** Finishing operation types (Finishing Operation triplet X'85'). */
const FINISHING = {
  0x01: 'cornerStaple', 0x02: 'saddleStitchOut', 0x03: 'edgeStitch', 0x04: 'foldIn', 0x05: 'separationCut',
  0x06: 'perforationCut', 0x07: 'zFold', 0x08: 'centerFoldIn', 0x09: 'trim', 0x0a: 'punch', 0x0c: 'perfectBind',
  0x0d: 'ringBind', 0x12: 'saddleStitchIn',
};
/** Reference edges of finishing operations. */
const EDGES = { 0x00: 'bottom', 0x01: 'right', 0x02: 'top', 0x03: 'left' };

/**
 * Reads the finishing operations of a Medium Finishing Control.
 * @param {Uint8Array} d MFC data.
 * @returns {{operation: string, edge: string|null, count: number}[]} Operations (unknown types as
 *   "X'nn'").
 */
export function readFinishing(d) {
  const out = [];
  for (let pos = 4; pos + 1 < d.length;) {
    const len = d[pos];
    if (len < 2 || pos + len > d.length) break;
    if (d[pos + 1] === 0x85 && len >= 7) {
      const type = d[pos + 2];
      out.push({
        operation: FINISHING[type] ?? `X'${type.toString(16).toUpperCase().padStart(2, '0')}'`,
        edge: EDGES[d[pos + 5]] ?? null,
        count: d[pos + 6] ?? 0,
      });
    }
    pos += len;
  }
  return out;
}

/** Duplex values of the MMC keyword X'F4'. */
const DUPLEX = { 0x01: 'simplex', 0x02: 'normal', 0x03: 'tumble' };

/**
 * @typedef {object} MediumMap
 * @property {string} name Medium map name.
 * @property {'simplex'|'normal'|'tumble'} duplex Duplex mode.
 * @property {number|null} inputBin Paper tray, or null if not specified.
 * @property {number|null} outputBin Output bin, or null.
 * @property {string|null} mediaType Media type name, or null.
 * @property {number} nUp Pages per sheet side (1–4).
 * @property {{x: number, y: number, rotation: number, side: 'front'|'back'}[]} pagePositions Page
 *   positions on the medium (page units).
 * @property {string[]} mediumOverlays Overlays printed on every sheet side.
 * @property {{width: number, height: number}|null} mediumSize Medium size in page units, if given.
 * @property {number} copies Number of copies (all copy groups together).
 * @property {{operation: string, edge: string|null, count: number}[]} finishing Finishing
 *   operations (stapling, punching …), empty if none are given.
 */

/**
 * Counts the copies of a medium map from its copy subgroups (MCC).
 * @param {number[]} groups Copies of each subgroup, in order.
 * @param {'simplex'|'normal'|'tumble'} duplex Duplex mode.
 * @returns {number} Copies (at least 1): all groups for simplex; for duplex the first group of
 *   each front/back pair.
 */
export function copiesOf(groups, duplex) {
  let copies = 0;
  for (let i = 0; i < groups.length; i += duplex === 'simplex' ? 1 : 2) copies += groups[i];
  return copies || 1;
}

/**
 * Reads the settings that may appear in a medium map or in the document environment group.
 * @param {object} file File record.
 * @param {number[]} rows Rows of the group's fields.
 * @param {object} base Defaults to start from.
 * @returns {Promise<object>} Settings.
 */
async function readSettings(file, rows, base) {
  const out = {
    ...base, pagePositions: [...(base.pagePositions ?? [])], overlayMap: new Map(base.overlayMap ?? []),
    finishing: [...(base.finishing ?? [])], mediaTypes: new Map(base.mediaTypes ?? []), pmcs: [...(base.pmcs ?? [])],
  };
  const mmcs = new Map();
  let units = base.units ?? { kx: 1, ky: 1 };
  for (const row of rows) {
    const id = file.index.id[row];
    const d = await fieldData(file, row);
    if (id === ID.MDD) {
      units = { kx: toPageUnits(d[0], u(d, 2, 2)), ky: toPageUnits(d[1], u(d, 4, 2)) };
      const w = u(d, 6, 3);
      const h = u(d, 9, 3);
      out.mediumSize = w && h ? { width: w * units.kx, height: h * units.ky } : out.mediumSize ?? null;
    } else if (id === ID.PGP1) {
      out.pagePositions = [{ x: s(d, 0, 3) * units.kx, y: s(d, 3, 3) * units.ky, rotation: 0, side: 'front' }];
    } else if (id === ID.PGP2) {
      // Constant X'01', then repeating groups: RGLength (1), XmOset (3), YmOset (3), PGorient (2),
      // SHside (1: bit X'01' = back side), PgFlgs (1, optional), PMCid (1, optional).
      const rgLen = d[1] || 12;
      out.pagePositions = [];
      for (let pos = 2; pos + 9 <= d.length; pos += rgLen) {
        out.pagePositions.push({ x: s(d, pos, 3) * units.kx, y: s(d, pos + 3, 3) * units.ky,
          rotation: orientation(u(d, pos + 6, 2)), side: (d[pos + 8] & 0x01) === 1 ? 'back' : 'front',
          flags: rgLen >= 11 ? d[pos + 9] : 0, pmcId: rgLen >= 12 ? d[pos + 10] : null });
      }
    } else if (id === ID.MCC) {
      out.copyGroups = [];
      out.copyMmcs = [];
      for (let pos = 0; pos + 6 <= d.length; pos += 6) {
        out.copyGroups.push(Math.max(0, u(d, pos + 2, 2) - u(d, pos, 2) + 1));
        out.copyMmcs.push(d[pos + 5]);
      }
    } else if (id === ID.MFC) {
      out.finishing = readFinishing(d);
    } else if (id === ID.MMC) {
      mmcs.set(d[0], readMmc(d));
    } else if (id === ID.MMO) {
      const rgLen = d[0] || 12;
      for (let pos = 4; pos + 9 <= d.length; pos += rgLen) out.overlayMap.set(d[pos], ebcdicName(d, pos + 4));
    } else if (id === ID.MMT) {
      for (const [lid, name] of readMediaTypes(d)) out.mediaTypes.set(lid, name);
    } else if (id === ID.PMC) {
      out.pmcs.push(readPmc(d, units));
    }
  }
  // The copy subgroups name their MMC; in duplex the first of a pair makes the front, the second
  // the back of the same copies (MO:DCA "MMC" keyword X'F4'). The viewer shows the first copy.
  const ids = out.copyMmcs ?? [];
  const front = mmcs.get(ids[0]) ?? mmcs.values().next().value ?? null;
  if (front) {
    out.duplex = DUPLEX[front.duplex] ?? out.duplex;
    if (front.inputBin !== null) out.inputBin = front.inputBin;
    if (front.outputBin !== null) out.outputBin = front.outputBin;
    if (front.nUp !== null) out.nUp = Math.min(4, Math.max(1, front.nUp));
    out.front = front;
    out.back = out.duplex !== 'simplex' ? (mmcs.get(ids[1]) ?? front) : null;
  }
  if (out.copyGroups) out.copies = copiesOf(out.copyGroups, out.duplex);
  out.units = units;
  return out;
}

/**
 * Reads a Medium Modification Control (MO:DCA "MMC"): MMCid (1), X'FF' (1), then keyword and
 * parameter byte pairs in ascending order. X'F2' (medium overlay) and X'F3' (text suppression)
 * may occur up to eight times; X'D1' is offset stack/edge mark change (jog), not an overlay.
 * @param {Uint8Array} d MMC data.
 * @returns {object} Settings: duplex (X'F4' value), inputBin (X'E1'), inputFormat (X'E0'),
 *   outputBin (X'90'/X'91'), nUp (X'FC'), overlayIds (X'F2'), suppressionIds (X'F3'),
 *   constantForms (X'F9' = X'01'), mediaTypeId (X'E8'/X'E9'), jog (X'D1' = X'01'), quality
 *   (X'F8'), perforationCut (X'A1'), separationCut (X'A2'), fixedInfo (X'A0'), setupId
 *   (X'B4'/X'B5'); null where not given.
 */
export function readMmc(d) {
  const kw = [];
  for (let i = 2; i + 1 < d.length; i += 2) kw.push([d[i], d[i + 1]]);
  const one = (k) => kw.find(([key]) => key === k)?.[1] ?? null;
  const all = (k) => kw.filter(([key]) => key === k).map(([, v]) => v).filter(Boolean);
  const pair = (hi, lo) => (one(hi) === null && one(lo) === null ? null : ((one(hi) ?? 0) << 8) | (one(lo) ?? 0));
  return {
    duplex: one(0xf4) ?? 0x01,
    inputBin: one(0xe1), inputFormat: one(0xe0), outputBin: pair(0x90, 0x91), nUp: one(0xfc),
    overlayIds: all(0xf2), suppressionIds: all(0xf3), constantForms: one(0xf9) === 0x01,
    mediaTypeId: pair(0xe8, 0xe9), jog: one(0xd1) === 0x01, quality: one(0xf8),
    perforationCut: one(0xa1) !== null, separationCut: one(0xa2) !== null, fixedInfo: one(0xa0), setupId: pair(0xb4, 0xb5),
  };
}

/**
 * Reads a Map Media Type (MO:DCA "MMT"): repeating groups of RGLength (2), reserved (6), triplets
 * — Fully Qualified Name type X'11' (media type name, or OID) and Extended Resource Local
 * Identifier X'22' type X'40' (the local ID the MMC keywords X'E8'/X'E9' select).
 * @param {Uint8Array} d MMT data.
 * @returns {Map<number, string>} Local ID → media type name (or OID).
 */
export function readMediaTypes(d) {
  const out = new Map();
  for (let pos = 0; pos + 2 <= d.length;) {
    const len = u(d, pos, 2);
    if (len < 8 || pos + len > d.length) break;
    const triplets = d.subarray(pos + 8, pos + len);
    const t = readCommonTriplets(triplets);
    let lid = null;
    for (let i = 0; i + 1 < triplets.length;) {
      const tl = triplets[i];
      if (tl < 2) break;
      if (triplets[i + 1] === 0x22 && triplets[i + 2] === 0x40) lid = u(triplets, i + 3, Math.min(4, tl - 3));
      i += tl;
    }
    const name = t.oid ?? t.names[FQN.MEDIA_TYPE] ?? null;
    if (name) out.set(lid ?? out.size, name);
    pos += len;
  }
  return out;
}

/**
 * Reads a Page Modification Control (MO:DCA "PMC"): PMCid (1), reserved (1), triplets. Each
 * Resource Object Include triplet X'6C' includes an overlay on the page: ObjType (X'DF' overlay,
 * X'DC' preprinted form overlay), name (8), X/Y offset (3 + 3) and rotation (2, overlays only), in
 * the units of a Measurement Units triplet X'4B' or else the medium map's MDD.
 * @param {Uint8Array} d PMC data.
 * @param {{kx: number, ky: number}} mddUnits Page units per MDD unit.
 * @returns {{id: number, overlays: {name: string, x: number, y: number, rotation: number, form: boolean}[]}}
 *   Overlays with offsets in page units.
 */
export function readPmc(d, mddUnits) {
  let units = mddUnits;
  const includes = [];
  for (let i = 2; i + 1 < d.length;) {
    const tl = d[i];
    if (tl < 2 || i + tl > d.length) break;
    const t = d.subarray(i, i + tl);
    if (t[1] === 0x4b && tl >= 8) units = { kx: toPageUnits(t[2], u(t, 4, 2)), ky: toPageUnits(t[3], u(t, 6, 2)) };
    else if (t[1] === 0x6c && tl >= 17 && (t[2] === 0xdf || t[2] === 0xdc)) includes.push(t);
    i += tl;
  }
  return {
    id: d[0],
    overlays: includes.map((t) => ({
      name: ebcdicName(t, 3), x: s(t, 11, 3) * units.kx, y: s(t, 14, 3) * units.ky,
      rotation: t[2] === 0xdf && t.length >= 19 ? orientation(u(t, 17, 2)) : 0, form: t[2] === 0xdc,
    })),
  };
}

/**
 * Names the medium overlays an MMC selects (X'F2' local IDs mapped by MMO).
 * @param {object} st Settings of the medium map.
 * @param {object|null} mmc MMC settings.
 * @returns {string[]} Overlay names.
 */
function overlaysOf(st, mmc) {
  return (mmc?.overlayIds ?? []).map((lid) => st.overlayMap.get(lid)).filter(Boolean);
}

/**
 * Lists further controls of the front MMC for the print information.
 * @param {object|null} mmc MMC settings.
 * @returns {{jog: boolean, quality: number|null, perforationCut: boolean, separationCut: boolean,
 *   constantForms: boolean, setupId: number|null, inputFormat: number|null}} Controls.
 */
function controlsOf(mmc) {
  return {
    jog: Boolean(mmc?.jog), quality: mmc?.quality ?? null, perforationCut: Boolean(mmc?.perforationCut),
    separationCut: Boolean(mmc?.separationCut), constantForms: Boolean(mmc?.constantForms),
    setupId: mmc?.setupId ?? null, inputFormat: mmc?.inputFormat ?? null,
  };
}

/**
 * Reads a form definition resource.
 * @param {object} file File record.
 * @param {number} bfmRow Row of Begin Form Map.
 * @returns {Promise<{name: string, mediumMaps: Map<string, MediumMap>, first: MediumMap|null}>}
 *   Medium maps by name (in order) and the first one (used before any IMM).
 */
export async function readFormDefinition(file, bfmRow) {
  const name = ebcdicName(await fieldData(file, bfmRow));
  const children = childRows(file.index, bfmRow);
  let defaults = { duplex: 'simplex', inputBin: null, outputBin: null, mediaType: null, nUp: 1, pagePositions: [], mediumSize: null, copies: 1, finishing: [] };
  const bdg = children.find((r) => file.index.id[r] === ID.BDG);
  if (bdg !== undefined) defaults = await readSettings(file, childRows(file.index, bdg), defaults);
  const mediumMaps = new Map();
  for (const row of children) {
    if (file.index.id[row] !== ID.BMM) continue;
    const mapName = ebcdicName(await fieldData(file, row));
    const rows = [];
    const collect = (r) => { for (const c of childRows(file.index, r)) { rows.push(c); collect(c); } };
    collect(row);
    const st = await readSettings(file, rows, defaults);
    mediumMaps.set(mapName, {
      name: mapName,
      duplex: st.duplex,
      inputBin: st.inputBin ?? null,
      outputBin: st.outputBin ?? null,
      mediaType: st.mediaType ?? null,
      nUp: st.nUp ?? 1,
      pagePositions: st.pagePositions.length ? st.pagePositions : [{ x: 0, y: 0, rotation: 0, side: 'front' }],
      mediumOverlays: overlaysOf(st, st.front),
      // Back side of a duplex copy: the second MMC of the copy subgroup pair.
      backMediumOverlays: st.back ? overlaysOf(st, st.back) : null,
      suppressions: { front: st.front?.suppressionIds ?? [], back: st.back?.suppressionIds ?? st.front?.suppressionIds ?? [] },
      constantForms: { front: Boolean(st.front?.constantForms), back: Boolean(st.back?.constantForms) },
      mediaType: (st.front?.mediaTypeId !== null && st.front?.mediaTypeId !== undefined ? st.mediaTypes.get(st.front.mediaTypeId) : null)
        ?? st.mediaType ?? (st.mediaTypes.size ? st.mediaTypes.values().next().value : null),
      controls: controlsOf(st.front),
      pmcs: st.pmcs,
      mediumSize: st.mediumSize ?? null,
      copies: st.copies ?? 1,
      finishing: st.finishing ?? [],
    });
  }
  return { name, mediumMaps, first: mediumMaps.values().next().value ?? null };
}

/** Medium map used when no form definition is available (spec edge case). */
export const DEFAULT_MEDIUM_MAP = Object.freeze({
  name: null, duplex: 'simplex', inputBin: null, outputBin: null, mediaType: null, nUp: 1,
  pagePositions: [{ x: 0, y: 0, rotation: 0, side: 'front' }], mediumOverlays: [], backMediumOverlays: null, mediumSize: null, copies: 1,
  finishing: Object.freeze([]), suppressions: { front: [], back: [] }, constantForms: { front: false, back: false },
  controls: { jog: false, quality: null, perforationCut: false, separationCut: false, constantForms: false, setupId: null, inputFormat: null },
  pmcs: Object.freeze([]),
});
