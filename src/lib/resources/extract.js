/**
 * Resource extraction (FR-057, SC-009): the exact original bytes of a resource with a file name
 * and MIME type. Resource files and font files: the whole file. Members of resource groups: the
 * object's Begin … End fields as stored. Object containers: the contained data (e.g. the PDF,
 * image, font, ICC profile or CMR file). Whole files keep their file name; other resources are
 * named after the resource with an extension for their type.
 */

import { readContainer } from '../objcontainer/object-container.js';

/** File extensions of AFP resource objects (as used for resource libraries). */
const AFP_EXTENSIONS = { pageSegment: 'PSG', overlay: 'OVL', fontCharacterSet: 'CHS', codePage: 'CDP', codedFont: 'FON', formDefinition: 'FDF' };
/** Extension and MIME type by object container format or resource type. */
const DATA_TYPES = {
  pdf: ['pdf', 'application/pdf'], jpeg: ['jpg', 'image/jpeg'], png: ['png', 'image/png'], gif: ['gif', 'image/gif'],
  tiff: ['tif', 'image/tiff'], iccProfile: ['icc', 'application/vnd.iccprofile'], colorManagementResource: ['cmr', 'application/octet-stream'],
  'TrueType': ['ttf', 'font/ttf'], 'OpenType (CFF)': ['otf', 'font/otf'], 'TrueType collection': ['ttc', 'font/collection'],
};
const MODCAP = 'application/vnd.ibm.modcap';

/**
 * Extracts a resource.
 * @param {object} r Internal resource record (from describeResource).
 * @param {(fileId: string) => object} getFile Returns a file record.
 * @returns {Promise<{fileName: string, bytes: Uint8Array, mimeType: string}>} The resource.
 */
export async function extractResource(r, getFile) {
  const file = getFile(r.source.fileId);
  let bytes;
  if (r._container !== null) bytes = (await readContainer(file, r._container)).bytes;
  else if (r._wholeFile) bytes = await file.byteSource.read(0, file.size);
  else bytes = await file.byteSource.read(r.source.byteRange[0], r.source.byteRange[1] - r.source.byteRange[0]);
  const safe = r.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'resource';
  const [ext, mimeType] = AFP_EXTENSIONS[r.type] ? [AFP_EXTENSIONS[r.type], MODCAP]
    : DATA_TYPES[r.type] ?? DATA_TYPES[r.encoding] ?? DATA_TYPES[r._format] ?? (r._container === null ? ['afp', MODCAP] : ['bin', 'application/octet-stream']);
  if (r._wholeFile) return { fileName: file.name, bytes, mimeType };
  return { fileName: `${safe}.${ext}`, bytes, mimeType };
}
