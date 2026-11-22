/**
 * Document model (task T057, data-model "Document, PageGroup, Page", "ContentObject"): the
 * logical structure of an AFP document without rendering it.
 *
 * - Document: name (Begin Document), nested page groups (Begin Named Page Group) with their page
 *   range, the pages, the inline resource group (resource groups in the same file) and the
 *   medium map invocations (Invoke Medium Map, MO:DCA "IMM": the medium map applies from the next
 *   page on).
 * - Page: size and resolution from the Page Descriptor in the Active Environment Group (missing or
 *   invalid → 8.5 × 11 in at 1440 units per inch, with a diagnostic), the content objects with
 *   object area, rotation, field range and resource reference, the included page segments and
 *   overlays (IPS, IPO), the TLE and NOP fields (decoded by the structure functions of US2) and
 *   the resources it references that are missing.
 *
 * Object areas come from the object environment groups (readObjectArea), IM images from the IM
 * Image Output Control and Input Descriptor, included objects from the Include Object field.
 */

import { childRows, fieldData } from './access.js';
import { ebcdicName, u, s, orientation, toPageUnits } from './bytes.js';
import { decodePGD, decodeMCF1, decodeMCF2, decodeInclude, decodeIOB } from './structures.js';

const ID = {
  BDT: 0xd3a8a8, BNG: 0xd3a8ad, BPG: 0xd3a8af, BAG: 0xd3a8c9, PGD: 0xd3a6af, MCF1: 0xd3b18a, MCF2: 0xd3ab8a,
  BRG: 0xd3a8c6, BRS: 0xd3a8ce, IMM: 0xd3abcc, TLE: 0xd3a090, NOP: 0xd3eeee, IPS: 0xd3af5f, IPO: 0xd3afd8,
  IOB: 0xd3afc3, BPT: 0xd3a89b, BIM: 0xd3a8fb, BII: 0xd3a87b, BGR: 0xd3a8bb, BBC: 0xd3a8eb, BOC: 0xd3a892,
  IOC: 0xd3a77b, IID: 0xd3a67b,
};

/** Begin field → content object kind (data-model "ContentObject"). */
const OBJECT_KINDS = new Map([
  [ID.BPT, 'text'], [ID.BIM, 'image'], [ID.BII, 'imImage'], [ID.BGR, 'graphics'], [ID.BBC, 'barcode'], [ID.BOC, 'container'],
]);

/** Include Object types (MO:DCA IOB ObjType) → content object kind and resource type. */
const IOB_TYPES = {
  0x5f: ['unsupported', 'pageSegment'], 0x92: ['container', 'objectContainer'], 0x9b: ['text', 'presentationText'],
  0xbb: ['graphics', 'graphics'], 0xeb: ['barcode', 'barcode'], 0xfb: ['image', 'image'],
};

/** Default page size when the Page Descriptor is missing or invalid: 8.5 × 11 in. */
export const DEFAULT_PAGE = Object.freeze({ widthUnits: 12240, heightUnits: 15840, resolution: 1440 });

/**
 * Field range of a group: its Begin row and its End row (or the Begin row for single fields).
 * @param {object} index Field index.
 * @param {number} row Row.
 * @returns {[number, number]} Range.
 */
const rangeOf = (index, row) => [row, index.end[row] >= 0 ? index.end[row] : row];

/**
 * Reads the page groups below a parent, nested.
 * @param {object} file File record.
 * @param {number} parent Parent row.
 * @param {Map<number, number>} pageNumber Begin Page row → page number.
 * @returns {Promise<object[]>} Page groups.
 */
async function pageGroups(file, parent, pageNumber) {
  const { index } = file;
  const out = [];
  for (const row of childRows(index, parent)) {
    if (index.id[row] !== ID.BNG) continue;
    const [from, to] = rangeOf(index, row);
    const numbers = [...pageNumber].filter(([r]) => r > from && r < to).map(([, n]) => n);
    out.push({
      name: ebcdicName(await fieldData(file, row)),
      fieldRange: [from, to],
      startPage: numbers.length ? Math.min(...numbers) : null,
      endPage: numbers.length ? Math.max(...numbers) : null,
      tles: childRows(index, row).filter((r) => index.id[r] === ID.TLE).map((r) => ({ fieldIndex: r })),
      children: await pageGroups(file, row, pageNumber),
    });
  }
  return out;
}

/**
 * Reads the document structure.
 * @param {object} file Indexed document file.
 * @returns {Promise<{fileId: string, name: string, pageGroups: object[],
 *   pages: {number: number, fieldRange: [number, number]}[],
 *   inlineResourceGroup: {fieldRange: [number, number], resources: {name: string, fieldIndex: number}[]}|null,
 *   mediumMapInvocations: {name: string, fieldIndex: number, beforePage: number}[]}>} Document.
 */
export async function readDocument(file) {
  const { index } = file;
  const pageNumber = new Map(index.pages.map((row, i) => [row, i + 1]));
  const bdt = [...Array(index.count).keys()].find((r) => index.id[r] === ID.BDT);
  let name = '';
  if (bdt !== undefined) name = ebcdicName(await fieldData(file, bdt));
  const groups = [];
  let inlineResourceGroup = null;
  const invocations = [];
  let pagesSeen = 0;
  for (let row = 0; row < index.count; row++) {
    const id = index.id[row];
    if (id === ID.BPG) pagesSeen++;
    else if (id === ID.IMM) invocations.push({ name: ebcdicName(await fieldData(file, row)), fieldIndex: row, beforePage: pagesSeen + 1 });
    else if (id === ID.BRG && !inlineResourceGroup) {
      const resources = [];
      for (const r of childRows(index, row)) {
        if (index.id[r] === ID.BRS) resources.push({ name: ebcdicName(await fieldData(file, r)), fieldIndex: r });
      }
      inlineResourceGroup = { fieldRange: rangeOf(index, row), resources };
    }
  }
  for (const top of [-1, ...(bdt !== undefined ? [bdt] : [])]) groups.push(...await pageGroups(file, top, pageNumber));
  return {
    fileId: file.id,
    name,
    pageGroups: groups,
    pages: index.pages.map((row, i) => ({ number: i + 1, fieldRange: rangeOf(index, row) })),
    inlineResourceGroup,
    mediumMapInvocations: invocations,
  };
}

/**
 * Reads one page: size, resolution, objects, includes, TLE/NOP fields and missing resources.
 * @param {object} file Indexed document file.
 * @param {number} number Page number (1-based).
 * @param {object} helpers Services from the workspace.
 * @param {(file: object, row: number, env: object) => Promise<object|null>} helpers.objectArea
 *   Object area reader (page-renderer readObjectArea).
 * @param {(type: string, name: string) => Promise<boolean>} helpers.exists Whether a resource can be found.
 * @param {(file: object, row: number) => Promise<string|null>} helpers.containerFormat Format of an object container.
 * @param {(problem: {offset: number, reason: string}) => void} helpers.report Reports a page problem.
 * @returns {Promise<object>} Page (data-model "Page").
 */
export async function readPage(file, number, helpers) {
  const { index } = file;
  const row = index.pages[number - 1];
  if (row === undefined) throw new RangeError(`no page ${number}`);
  const children = childRows(index, row);
  const bag = children.find((r) => index.id[r] === ID.BAG);
  const envRows = bag === undefined ? [] : childRows(index, bag);
  let size = null;
  const fonts = [];
  for (const r of envRows) {
    if (index.id[r] === ID.PGD) {
      const pgd = decodePGD(await fieldData(file, r));
      if (pgd.width > 0 && pgd.height > 0 && pgd.xUnits > 0 && pgd.yUnits > 0) size = pgd;
    } else if (index.id[r] === ID.MCF1 || index.id[r] === ID.MCF2) {
      fonts.push(...(index.id[r] === ID.MCF1 ? decodeMCF1 : decodeMCF2)(await fieldData(file, r)));
    }
  }
  if (!size) helpers.report({ offset: index.offset[row], reason: 'page descriptor missing; using 8.5 × 11 in' });
  const kx = size ? toPageUnits(size.xBase, size.xUnits) : 1;
  const ky = size ? toPageUnits(size.yBase, size.yUnits) : 1;
  const env = { kx, ky, width: size ? size.width * kx : DEFAULT_PAGE.widthUnits, height: size ? size.height * ky : DEFAULT_PAGE.heightUnits };
  const perInch = (base, units) => (base === 1 ? units / 10 * 2.54 : units / 10);
  const page = {
    number,
    name: ebcdicName(await fieldData(file, row)),
    fieldRange: rangeOf(index, row),
    widthUnits: env.width,
    heightUnits: env.height,
    xResolution: size ? perInch(size.xBase, size.xUnits) : DEFAULT_PAGE.resolution,
    yResolution: size ? perInch(size.yBase, size.yUnits) : DEFAULT_PAGE.resolution,
    orientation: 0, // a page has no orientation of its own; its placement on the sheet does (sheets)
    objects: [],
    includedOverlays: [],
    includedSegments: [],
    tles: [],
    nops: [],
    missingResources: [],
  };
  const missing = async (type, name) => {
    if (!name || await helpers.exists(type, name)) return;
    if (!page.missingResources.some((m) => m.type === type && m.name === name)) page.missingResources.push({ type, name });
  };
  for (const f of fonts) {
    if (f.codedFont) await missing('codedFont', f.codedFont);
    else {
      await missing('fontCharacterSet', f.characterSet);
      await missing('codePage', f.codePage);
    }
  }
  for (const r of children) {
    const id = index.id[r];
    if (id === ID.TLE) page.tles.push({ fieldIndex: r });
    else if (id === ID.NOP) page.nops.push({ fieldIndex: r });
    else if (id === ID.IPS || id === ID.IPO) {
      const inc = decodeInclude(await fieldData(file, r));
      const entry = { name: inc.name, x: inc.x * kx, y: inc.y * ky, fieldIndex: r };
      if (id === ID.IPO) page.includedOverlays.push({ ...entry, rotation: inc.rotation });
      else page.includedSegments.push(entry);
      await missing(id === ID.IPO ? 'overlay' : 'pageSegment', inc.name);
    } else if (id === ID.IOB) {
      const iob = decodeIOB(await fieldData(file, r));
      const [kind, type] = IOB_TYPES[iob.objectType] ?? ['unsupported', 'objectContainer'];
      const fx = iob.units ? toPageUnits(iob.units.xBase, iob.units.xUnits) : kx;
      const fy = iob.units ? toPageUnits(iob.units.yBase, iob.units.yUnits) : ky;
      page.objects.push({
        kind: type === 'pageSegment' ? 'unsupported' : kind,
        area: { x: iob.x * kx, y: iob.y * ky, width: iob.areaSize ? iob.areaSize.width * fx : null, height: iob.areaSize ? iob.areaSize.height * fy : null },
        rotation: iob.xRotation,
        fieldRange: [r, r],
        resourceRef: iob.name,
        containerFormat: null,
        xmp: null,
        colorManagement: [],
      });
      await missing(type, iob.name);
    } else if (OBJECT_KINDS.has(id)) {
      page.objects.push(await contentObject(file, r, OBJECT_KINDS.get(id), env, helpers));
    }
  }
  return page;
}

/**
 * Describes one object on the page.
 * @param {object} file File record.
 * @param {number} row Begin row of the object.
 * @param {string} kind Object kind.
 * @param {object} env Page environment (kx, ky, width, height).
 * @param {object} helpers Services (see readPage).
 * @returns {Promise<object>} Content object.
 */
async function contentObject(file, row, kind, env, helpers) {
  const { index } = file;
  let area = { x: 0, y: 0, width: null, height: null };
  let rotation = 0;
  if (kind === 'text') {
    area = { x: 0, y: 0, width: env.width, height: env.height }; // text uses the page presentation space
  } else if (kind === 'imImage') {
    // IM image: IOC offset and IID size, both in the image's own units (MO:DCA "IM Image Object").
    let ioc = null;
    let iid = null;
    for (const r of childRows(index, row)) {
      if (index.id[r] === ID.IOC) ioc = await fieldData(file, r);
      if (index.id[r] === ID.IID) iid = await fieldData(file, r);
    }
    const fx = iid ? toPageUnits(iid[12], u(iid, 14, 2)) : 6;
    const fy = iid ? toPageUnits(iid[13], u(iid, 16, 2)) : 6;
    area = {
      x: ioc ? s(ioc, 0, 3) * fx : 0,
      y: ioc ? s(ioc, 3, 3) * fy : 0,
      width: iid ? u(iid, 18, 2) * fx : null,
      height: iid ? u(iid, 20, 2) * fy : null,
    };
    rotation = ioc ? orientation(u(ioc, 6, 2)) : 0;
  } else {
    const a = await helpers.objectArea(file, row, env);
    if (a) {
      area = { x: a.x, y: a.y, width: a.width, height: a.height };
      rotation = a.rotation ?? 0;
    }
  }
  return {
    kind,
    area,
    rotation,
    fieldRange: rangeOf(index, row),
    resourceRef: null,
    containerFormat: kind === 'container' ? await helpers.containerFormat(file, row) : null,
    xmp: null,
    colorManagement: [],
  };
}
