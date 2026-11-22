/**
 * Marking fields on a page (FR-034, structure view → "Show on page"): which render items belong
 * to a marked field. Shared by the viewer's canvas renderer and the tests.
 */

/**
 * Tells whether an item belongs to a marked field of the document (structure view → "Show on
 * page"). Field rows are numbers within one file, so the file is compared too:
 * - an item of the document itself by its object (sourceField) or by the data field that drew
 *   it: text by its PTX field (textField), graphics by its GAD fields (dataFieldFrom … dataField:
 *   an area or image spans the fields from its opening to its closing order);
 * - an item drawn through an include (page segment, overlay, object; `via`, outermost first) by
 *   the document's include field — its own sourceField is a row of the resource's file, which
 *   neither matches the IPS nor may be confused with a document row of the same number.
 * Without a file (older callers) rows are compared as before.
 * @param {object} item Render item.
 * @param {Set<number>} rows Marked field rows.
 * @param {string|null} fileId File the rows belong to.
 * @returns {boolean} True when marked.
 */
export function marked(item, rows, fileId) {
  const outer = item.via?.[0];
  if (fileId && outer) return outer.fileId === fileId && rows.has(outer.row);
  if (fileId && item.fileId !== undefined && item.fileId !== fileId) return false;
  if (rows.has(item.sourceField) || (item.textField !== undefined && rows.has(item.textField))) return true;
  if (item.dataField === undefined) return false;
  // Graphics: any Graphics Data field from the one that opened the area or image to the one
  // that completed it (consecutive rows of the same object).
  const from = item.dataFieldFrom ?? item.dataField;
  for (const r of rows) if (r >= from && r <= item.dataField) return true;
  return false;
}
