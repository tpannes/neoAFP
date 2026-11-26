/**
 * Interface icons (FR-095): small line drawings on a 24 × 24 grid, drawn with the current text
 * color, for toolbar buttons and for the item kinds of the structure tree. Each entry is the
 * inner SVG markup of one icon.
 */

const ICONS = {
  // Toolbar
  open: '<path d="M14 3v5h5"/><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M12 11v6M9 14l3-3 3 3"/>',
  folder: '<path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/>',
  resources: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  // Hide the thumbnails (to the left) or the Details panel (to the right).
  collapseLeft: '<path d="M12 6l-6 6 6 6M18 6l-6 6 6 6"/>',
  collapseRight: '<path d="M12 6l6 6-6 6M6 6l6 6-6 6"/>',
  pages: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/><path d="M4 6v15h12" opacity=".5"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 10v10"/>',
  comment: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  tree: '<rect x="3" y="3" width="6" height="5" rx="1"/><rect x="13" y="10" width="8" height="5" rx="1"/><rect x="13" y="17" width="8" height="5" rx="1"/><path d="M6 8v11.5h7M6 12.5h7"/>',
  first: '<path d="M6 5v14M18 6l-7 6 7 6z"/>',
  previous: '<path d="M15 6l-6 6 6 6"/>',
  next: '<path d="M9 6l6 6-6 6"/>',
  last: '<path d="M18 5v14M6 6l7 6-7 6z"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6M11 8v6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4M8 11h6"/>',
  // Zoom modes: the whole page (arrows to top and bottom), the page width (arrows to the sides), 1:1.
  fitPage: '<rect x="6" y="3" width="12" height="18" rx="1"/><path d="M12 7v10M9.5 9.5L12 7l2.5 2.5M9.5 14.5L12 17l2.5-2.5"/>',
  fitWidth: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M7 12h10M9.5 9.5L7 12l2.5 2.5M14.5 9.5L17 12l-2.5 2.5"/>',
  actualSize: '<path d="M4.5 9L7 7v10M15.5 9L18 7v10M11.5 10v.5M11.5 13.5v.5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  // A rubber stamp, struck through: hide the "TEST" stamp printed on the pages.
  testPrint: '<circle cx="12" cy="5.5" r="2.5"/><path d="M10.5 8v4M13.5 8v4"/><rect x="4" y="12" width="16" height="4.5" rx="1"/><path d="M5.5 20h13M3 3l18 18"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  inspect: '<circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="1"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  // Color picker: an eyedropper, bulb at the top right, tip at the bottom left.
  pipette: '<path d="M13 6.5l4.5 4.5"/><path d="M14.8 8.3l2.9-2.9a2 2 0 0 0-2.8-2.8l-2.9 2.9"/><path d="M15.2 9.2L7 17.4l-2.6.8.8-2.6 8.2-8.2"/><path d="M4.4 18.2L3 21"/>',
  fileJson: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/><path d="M10 11.5c-.9 0-1.4.5-1.4 1.3v.9c0 .5-.4.8-.9.8.5 0 .9.3.9.8v.9c0 .8.5 1.3 1.4 1.3M14 11.5c.9 0 1.4.5 1.4 1.3v.9c0 .5.4.8.9.8-.5 0-.9.3-.9.8v.9c0 .8-.5 1.3-1.4 1.3"/>',
  fileImage: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/><circle cx="9.5" cy="12" r="1.5"/><path d="M19 17l-4-4-7 7"/>',
  // Resource filters: buttons and choices.
  shapes: '<circle cx="7" cy="7" r="3.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1"/><path d="M7 13.5l4 7H3z"/><circle cx="17" cy="17" r="3.5"/>',
  layers: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 12.5l9 5 9-5M3 17l9 5 9-5"/>',
  ruler: '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>',
  dpi: '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r=".8"/><circle cx="15" cy="9" r=".8"/><circle cx="9" cy="15" r=".8"/><circle cx="15" cy="15" r=".8"/>',
  code: '<path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 6l-3 12"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.6-.7 1.6-1.6 0-.4-.2-.8-.4-1.1-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5c0-4.1-4-7.5-9-7.5z"/><circle cx="7.5" cy="11.5" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  rgb: '<circle cx="12" cy="8.5" r="4.5"/><circle cx="8.5" cy="14.5" r="4.5"/><circle cx="15.5" cy="14.5" r="4.5"/>',
  cmyk: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  noText: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/><path d="M4 4l16 16"/>',
  // One page / a sheet with its two sides (thumbnail strip, page layout).
  sheetSides: '<rect x="2.5" y="5" width="8.5" height="14" rx="1"/><rect x="13" y="5" width="8.5" height="14" rx="1"/><path d="M5 9h4M5 12h4M15.5 9h4M15.5 12h4"/>',
  sizeIcon: '<rect x="10" y="10" width="4" height="4" rx=".5"/>',
  sizeSmall: '<rect x="8.5" y="8.5" width="7" height="7" rx="1"/>',
  sizeMedium: '<rect x="6.5" y="6.5" width="11" height="11" rx="1"/>',
  sizeLarge: '<rect x="4" y="4" width="16" height="16" rx="1.5"/>',
  sizeLarger: '<path d="M8 6h6l3 3v9H8z"/><path d="M3 3l3 3M21 3l-3 3M3 21l3-3M21 21l-3-3"/>',
  notApplicable: '<circle cx="12" cy="12" r="8"/><path d="M6.5 6.5l11 11"/>',
  fileCsv: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5"/><rect x="8" y="11" width="8" height="7" rx=".5"/><path d="M8 14.5h8M12 11v7"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  // Three like rows held by a brace: like items grouped (structure tree).
  groupItems: '<path d="M4 6h9M4 12h9M4 18h9"/><path d="M17 4.5c1.4 0 2 .7 2 2V10l1.8 2-1.8 2v3.5c0 1.3-.6 2-2 2"/>',
  collapseAll: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/><path d="M11.5 14.5h6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
  filterReset: '<path d="M3 5h14l-5.5 7v6l-3-1.5V12z"/><path d="M16 14l5 5M21 14l-5 5"/>',
  log: '<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  error: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".6"/>',
  warning: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.5"/>',
  locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  actual: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9v6M14 9v6"/>',
  extract: '<path d="M12 3v12M8 11l4 4 4-4"/><path d="M4 15v5h16v-5"/>',
  // Structure tree kinds
  printFile: '<path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="1"/><path d="M7 14h10v7H7z"/>',
  document: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  pageGroup: '<path d="M4 7h6l2 2h8v10H4z"/><path d="M4 7V5h5"/>',
  page: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  environment: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  resourceGroup: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  resource: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>',
  overlay: '<rect x="3" y="7" width="12" height="13" rx="1"/><path d="M9 7V4h12v13h-6"/>',
  pageSegment: '<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2"/><rect x="8" y="8" width="8" height="8"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  graphics: '<path d="M4 20L10 6l4 8 6-10"/><circle cx="10" cy="6" r="1.5"/><circle cx="14" cy="14" r="1.5"/>',
  barcode: '<path d="M4 5v14M7 5v14M11 5v14M13 5v14M17 5v14M20 5v14"/>',
  objectContainer: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>',
  formDefinition: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h8M8 11h3M13 11h3M8 15h8"/>',
  mediumMap: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 9h16M9 9v10"/>',
  font: '<path d="M5 20L11 4h2l6 16M8 14h8"/>',
  // Font types (resource filter): a stepped letter of pixels (raster), a letter with outline
  // nodes (Type 1), a CJK character (CID-keyed), "TT" (TrueType), "OT" (OpenType), stacked TT
  // pages (TrueType collection).
  fontRaster: '<path d="M4 20v-5h2v-4h2V7h2V4h4v3h2v4h2v4h2v5"/><path d="M6 15h12"/>',
  fontType1: '<path d="M6 19L12 6l6 13M8.5 14h7"/><rect x="10.5" y="2.5" width="3" height="3"/><rect x="3.5" y="18.5" width="3" height="3"/><rect x="17.5" y="18.5" width="3" height="3"/>',
  fontCid: '<path d="M12 3v3M4 7h16M8 10c1.5 4.5 5 8.5 12 10M16 10c-1.5 4.5-5 8.5-12 10"/>',
  fontTrueType: '<path d="M3 5h11M8.5 5v15M11 11h10M16 11v9"/>',
  fontOpenType: '<circle cx="8" cy="12.5" r="5"/><path d="M14 8h7M17.5 8v10"/>',
  fontCollection: '<rect x="3" y="7" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/><path d="M6 11h5M8.5 11v7M10 13.5h4.5M12.3 13.5V18"/>',
  include: '<path d="M4 12h12M12 7l5 5-5 5"/><path d="M20 4v16"/>',
  tle: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8" r="1.5"/>',
  nop: '<path d="M4 5h16v11H9l-5 4z"/>',
  map: '<path d="M4 7h6M14 7h6M4 17h6M14 17h6"/><path d="M10 7l4 10M10 17l4-10"/>',
  descriptor: '<path d="M3 8h18v8H3z"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>',
  position: '<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="3"/>',
  data: '<path d="M4 6h16M4 10h16M4 14h16M4 18h10"/>',
  control: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  end: '<path d="M9 5H5v14h4"/><path d="M13 12h7"/>',
  triplet: '<circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/>',
  other: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  unknown: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 17v.5"/>',
};

/** Icon and color group of each structure tree kind (fieldKind() in src/lib/modca/tree.js). */
const KIND_ICONS = {
  printFile: ['printFile', 'container'], document: ['document', 'container'], pageGroup: ['pageGroup', 'container'],
  page: ['page', 'page'], environmentGroup: ['environment', 'env'], objectEnvironmentGroup: ['environment', 'env'],
  documentEnvironmentGroup: ['environment', 'env'], documentIndex: ['tle', 'meta'], resourceGroup: ['resourceGroup', 'resource'],
  resource: ['resource', 'resource'], pageSegment: ['pageSegment', 'resource'], overlay: ['overlay', 'resource'],
  text: ['text', 'object'], image: ['image', 'object'], imImage: ['image', 'object'], graphics: ['graphics', 'object'],
  barcode: ['barcode', 'object'], objectContainer: ['objectContainer', 'object'], formDefinition: ['formDefinition', 'resource'],
  mediumMap: ['mediumMap', 'resource'], pageMap: ['mediumMap', 'resource'], dataMap: ['mediumMap', 'resource'],
  fontCharacterSet: ['font', 'resource'], codePage: ['font', 'resource'], codedFont: ['font', 'resource'],
  colorAttributeTable: ['table', 'resource'], object: ['other', 'object'],
  includeSegment: ['include', 'include'], includeOverlay: ['include', 'include'], includeObject: ['include', 'include'],
  includePage: ['include', 'include'], include: ['include', 'include'],
  tle: ['tle', 'meta'], nop: ['nop', 'meta'], attribute: ['tle', 'meta'], map: ['map', 'field'],
  descriptor: ['descriptor', 'field'], position: ['position', 'field'], data: ['data', 'field'], control: ['control', 'field'],
  copyCount: ['control', 'field'], process: ['control', 'field'], table: ['table', 'field'], migration: ['descriptor', 'field'],
  variable: ['control', 'field'], link: ['map', 'field'], fontData: ['font', 'field'], end: ['end', 'end'],
  triplet: ['triplet', 'triplet'], other: ['other', 'field'], unknown: ['unknown', 'unknown'],
};

const NS = 'http://www.w3.org/2000/svg';

// File size choices: one to five bars, the bars above the size drawn faint.
for (let n = 1; n <= 5; n++) {
  ICONS[`bars${n}`] = [4, 8, 12, 16, 20].map((x, i) => `<path d="M${x} 20V${18 - i * 3}"${i < n ? '' : ' stroke-opacity=".3"'}/>`).join('');
}

/**
 * Creates an icon.
 * @param {string} name Icon name (a key of ICONS).
 * @param {string} [className] Extra class.
 * @returns {SVGSVGElement} Icon, hidden from screen readers (the button or item carries the text).
 */
export function icon(name, className = '') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `ico ${className}`.trim());
  svg.innerHTML = ICONS[name] ?? ICONS.other;
  return svg;
}

/**
 * Creates the icon of a structure tree kind, colored by its group (CSS class kind-<group>).
 * @param {string} kind Node kind.
 * @returns {SVGSVGElement} Icon.
 */
export function kindIcon(kind) {
  const [name, group] = KIND_ICONS[kind] ?? KIND_ICONS.unknown;
  return icon(name, `kind-icon kind-${group}`);
}

/**
 * Creates a button with an icon and a translated label; the label is shown as text unless
 * `iconOnly` is set (then it is the tooltip and accessible name).
 * @param {string} iconName Icon name.
 * @param {string} labelKey Locale key of the label.
 * @param {{iconOnly?: boolean, className?: string}} [options] Options.
 * @returns {HTMLButtonElement} Button (labels are kept up to date by applyTranslations).
 */
export function iconButton(iconName, labelKey, { iconOnly = false, className = '' } = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `${iconOnly ? 'icon-only' : 'with-icon'} ${className}`.trim();
  b.append(icon(iconName));
  if (iconOnly) {
    b.dataset.i18nAttr = `title:${labelKey},aria-label:${labelKey}`;
  } else {
    const span = document.createElement('span');
    span.dataset.i18n = labelKey;
    b.append(span);
  }
  return b;
}

/**
 * Creates the neoAFP logo; the dark theme uses the version with light lettering ("neo" is dark
 * navy in the normal logo). The translated app title is its text alternative.
 * @param {string} className Class of the image (sets its size, see base.css).
 * @returns {HTMLPictureElement} Logo.
 */
export function brandLogo(className) {
  const url = (name) => new URL(`./assets/logos/${name}`, import.meta.url).href;
  const picture = document.createElement('picture');
  const dark = document.createElement('source');
  dark.srcset = url('neoafp-logo-dark.svg');
  dark.media = '(prefers-color-scheme: dark)';
  const img = document.createElement('img');
  img.className = className;
  img.src = url('neoafp-logo.svg');
  img.dataset.i18nAttr = 'alt:app.title';
  picture.append(dark, img);
  return picture;
}
