/**
 * Resource filters and sorting (T126, FR-053, data-model "Filters"): each filter alone and
 * combined (all active filters must match), case-insensitive name match, filter options derived
 * only from the loaded resources, sorting by every column in both directions. Text sorts
 * ignore case; size classes sort by size (icon … largerThanA4, notApplicable); missing values
 * come last in both directions; equal values keep their order.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterResources, sortResources, filterOptions, fileSizeRange } from '../../src/lib/resources/filter.js';
import { linkFontTypes } from '../../src/lib/resources/catalog.js';

const R = (name, type, o = {}) => ({
  id: name, name, type, widthMm: null, heightMm: null, sizeClass: 'notApplicable', fileSize: 0, resolution: null,
  colorProfile: null, encoding: null, source: { kind: 'folder', path: `${name}.res` }, ...o,
});
const ALL = [
  R('S1BRAND', 'pageSegment', { widthMm: 40, heightMm: 20, sizeClass: 'small', fileSize: 900, resolution: 300, encoding: 'IOCA G4', contents: ['ioca'], colorModels: ['rgb', 'cmyk'] }),
  R('O1FORM', 'overlay', { widthMm: 210, heightMm: 297, sizeClass: 'a4', fileSize: 5000, resolution: 240, contents: ['text', 'barcode'], fontTypes: ['raster', 'truetype'] }),
  R('C0HELV', 'fontCharacterSet', { fileSize: 12000, resolution: 300, encoding: 'Raster', fontTypes: ['raster'] }),
  R('s1brand2', 'pageSegment', { widthMm: 10, heightMm: 5, sizeClass: 'icon', fileSize: 100, resolution: 600, encoding: 'IOCA G4', source: { kind: 'inline', path: 'a.afp' } }),
  R('IMG1', 'image', { widthMm: 100, heightMm: 50, sizeClass: 'medium', fileSize: 70, colorProfile: 'sRGB', colorModels: ['rgb'], encoding: 'JPEG' }),
];
const names = (list) => list.map((r) => r.name);

test('no filter keeps everything', () => {
  assert.deepEqual(names(filterResources(ALL, {})), names(ALL));
});

test('each filter alone', () => {
  assert.deepEqual(names(filterResources(ALL, { name: 'BrAnD' })), ['S1BRAND', 's1brand2']);
  assert.deepEqual(names(filterResources(ALL, { types: ['pageSegment', 'image'] })), ['S1BRAND', 's1brand2', 'IMG1']);
  assert.deepEqual(names(filterResources(ALL, { resolutions: [300] })), ['S1BRAND', 'C0HELV']);
  assert.deepEqual(names(filterResources(ALL, { colorModels: ['rgb'] })), ['S1BRAND', 'IMG1']);
  // A page segment with an RGB and a CMYK image matches either; resources without colors match neither.
  assert.deepEqual(names(filterResources(ALL, { colorModels: ['cmyk'] })), ['S1BRAND']);
  assert.deepEqual(names(filterResources(ALL, { encodings: ['IOCA G4'] })), ['S1BRAND', 's1brand2']);
  assert.deepEqual(names(filterResources(ALL, { sizeClasses: ['a4', 'notApplicable'] })), ['O1FORM', 'C0HELV']);
});

test('filters combine: all active filters must match', () => {
  assert.deepEqual(names(filterResources(ALL, { name: 'brand', resolutions: [600] })), ['s1brand2']);
  assert.deepEqual(names(filterResources(ALL, { types: ['pageSegment'], sizeClasses: ['small'], encodings: ['IOCA G4'] })), ['S1BRAND']);
  assert.deepEqual(names(filterResources(ALL, { types: ['overlay'], resolutions: [300] })), []);
  // Empty lists are inactive filters.
  assert.deepEqual(names(filterResources(ALL, { types: [], name: '' })), names(ALL));
});

test('options come only from loaded resources, without empty values, sorted', () => {
  assert.deepEqual(filterOptions(ALL), {
    types: ['fontCharacterSet', 'image', 'overlay', 'pageSegment'],
    resolutions: [240, 300, 600],
    colorModels: ['rgb', 'cmyk'],
    encodings: ['IOCA G4', 'JPEG', 'Raster'],
    sizeClasses: ['icon', 'small', 'medium', 'a4', 'notApplicable'],
    contentTypes: ['text', 'noText', 'ioca', 'barcode'],
    fileSizes: ['under1k', '1kTo10k', '10kTo100k'],
    fontTypes: ['raster', 'truetype'],
    origins: ['inline', 'folder'],
  });
  assert.deepEqual(filterOptions([]), {
    types: [], resolutions: [], colorModels: [], encodings: [], sizeClasses: [], contentTypes: [], fileSizes: [], fontTypes: [], origins: [],
  });
});

test('content kinds, "no text", file size ranges and font types; any chosen value matches', () => {
  assert.deepEqual(names(filterResources(ALL, { contentTypes: ['text'] })), ['O1FORM']);
  // "No text": overlays and page segments without text (other types have no content kinds).
  assert.deepEqual(names(filterResources(ALL, { contentTypes: ['noText'] })), ['S1BRAND', 's1brand2']);
  assert.deepEqual(names(filterResources(ALL, { contentTypes: ['barcode', 'ioca'] })), ['S1BRAND', 'O1FORM']);
  assert.deepEqual(names(filterResources(ALL, { fileSizes: ['under1k'] })), ['S1BRAND', 's1brand2', 'IMG1']);
  assert.deepEqual(names(filterResources(ALL, { fileSizes: ['1kTo10k', '10kTo100k'] })), ['O1FORM', 'C0HELV']);
  assert.deepEqual(names(filterResources(ALL, { fontTypes: ['raster'] })), ['O1FORM', 'C0HELV']);
  assert.deepEqual(names(filterResources(ALL, { fontTypes: ['truetype', 'cid'] })), ['O1FORM']);
  assert.deepEqual(names(filterResources(ALL, { fontTypes: ['raster'], contentTypes: ['noText'] })), []);
  assert.equal(fileSizeRange(1023), 'under1k');
  assert.equal(fileSizeRange(1024), '1kTo10k');
  assert.equal(fileSizeRange(1048576), 'over1m');
});

test('sorting by every column, both directions; missing values last', () => {
  assert.deepEqual(names(sortResources(ALL, { by: 'name' })), ['C0HELV', 'IMG1', 'O1FORM', 'S1BRAND', 's1brand2']);
  assert.deepEqual(names(sortResources(ALL, { by: 'name', direction: 'desc' })), ['s1brand2', 'S1BRAND', 'O1FORM', 'IMG1', 'C0HELV']);
  assert.deepEqual(names(sortResources(ALL, { by: 'fileSize' })), ['IMG1', 's1brand2', 'S1BRAND', 'O1FORM', 'C0HELV']);
  assert.deepEqual(names(sortResources(ALL, { by: 'resolution', direction: 'desc' })), ['s1brand2', 'S1BRAND', 'C0HELV', 'O1FORM', 'IMG1']);
  assert.deepEqual(names(sortResources(ALL, { by: 'widthMm' })), ['s1brand2', 'S1BRAND', 'IMG1', 'O1FORM', 'C0HELV']);
  assert.deepEqual(names(sortResources(ALL, { by: 'heightMm', direction: 'desc' })), ['O1FORM', 'IMG1', 'S1BRAND', 's1brand2', 'C0HELV']);
  assert.deepEqual(names(sortResources(ALL, { by: 'sizeClass' })), ['s1brand2', 'S1BRAND', 'IMG1', 'O1FORM', 'C0HELV']);
  assert.deepEqual(names(sortResources(ALL, { by: 'type' })), ['C0HELV', 'IMG1', 'O1FORM', 'S1BRAND', 's1brand2']);
  assert.deepEqual(names(sortResources(ALL, { by: 'colorProfile' })), ['IMG1', 'S1BRAND', 'O1FORM', 'C0HELV', 's1brand2']);
  assert.deepEqual(names(sortResources(ALL, { by: 'encoding' })), ['S1BRAND', 's1brand2', 'IMG1', 'C0HELV', 'O1FORM']);
  // Source sorts by its displayed text ("inline: a.afp" or the path), like the CSV column.
  assert.deepEqual(names(sortResources(ALL, { by: 'source' })), ['C0HELV', 'IMG1', 's1brand2', 'O1FORM', 'S1BRAND']);
  assert.notEqual(sortResources(ALL, { by: 'name' }), ALL, 'returns a new array');
});

test('font types: coded fonts through their character sets, overlays through the fonts they map', () => {
  const rec = (name, type, fontTypes, refs = []) => ({ name, type, fontTypes, _fontRefs: refs });
  const fcsR = rec('C0RAST', 'fontCharacterSet', ['raster']);
  const fcsO = rec('CZOUTL', 'fontCharacterSet', ['type1']);
  const tt = rec('Arial', 'truetypeFont', ['truetype']);
  const cf = rec('X0MIX', 'codedFont', [], [{ characterSet: 'C0RAST' }, { characterSet: 'czoutl' }]);
  const missing = rec('X0GONE', 'codedFont', [], [{ characterSet: 'C0NONE' }]);
  const ovl = rec('O1', 'overlay', [], [{ codedFont: 'X0MIX' }, { dataObject: 'ARIAL' }]);
  const seg = rec('S1', 'pageSegment', [], [{ characterSet: 'CZOUTL', codedFont: '' }]);
  const cp = rec('T1NEOCP2', 'codePage', []);
  linkFontTypes([ovl, seg, cf, missing, fcsR, fcsO, tt, cp]);
  assert.deepEqual(cf.fontTypes, ['raster', 'type1']);
  assert.deepEqual(missing.fontTypes, []);
  assert.deepEqual(ovl.fontTypes, ['raster', 'type1', 'truetype']);
  assert.deepEqual(seg.fontTypes, ['type1']);
  assert.deepEqual(cp.fontTypes, []);
});

test('the name box also finds the internal name (Begin field) of a resource file', () => {
  const list = [R('S1TB22_N', 'pageSegment', { internalName: '70001' }), R('S1OTHER', 'pageSegment')];
  assert.deepEqual(names(filterResources(list, { name: '7000' })), ['S1TB22_N']);
  assert.deepEqual(names(filterResources(list, { name: 'tb22' })), ['S1TB22_N']);
});

test('origins: inline, folder or file; a combined resource matches by any of its sources', () => {
  const both = R('F1FORM', 'formDefinition', { sources: [{ kind: 'folder', path: 'F1FORM.FDF' }, { kind: 'inline', path: 'a.afp' }] });
  const list = [...ALL, both];
  assert.deepEqual(names(filterResources(list, { origins: ['inline'] })), ['s1brand2', 'F1FORM']);
  assert.equal(names(filterResources(list, { origins: ['folder'] })).includes('s1brand2'), false);
  assert.deepEqual(names(filterResources(list, { origins: ['file'] })), []);
});

test('identical copies: the content hash ignores sequence numbers and separators', async () => {
  const { contentHash } = await import('../../src/lib/resources/catalog.js');
  // Begin Form Map with sequence number 1, then the same field with sequence number 5, CR/LF after it.
  const a = Uint8Array.of(0x5a, 0x00, 0x08, 0xd3, 0xa8, 0xcd, 0x00, 0x00, 0x01);
  const b = Uint8Array.of(0x5a, 0x00, 0x08, 0xd3, 0xa8, 0xcd, 0x00, 0x00, 0x05, 0x0d, 0x0a);
  const c = Uint8Array.of(0x5a, 0x00, 0x08, 0xd3, 0xa8, 0xcd, 0x08, 0x00, 0x01);
  assert.equal(contentHash(a), contentHash(b));
  assert.notEqual(contentHash(a), contentHash(c), 'other flags are other content');
});
