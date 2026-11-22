/**
 * Link from the structure view to the page view (FR-034, task T112): the page a structured field
 * is on and the page-level object that render items of the field point to (`sourceField`).
 */

import { enclosingPage } from '../meta/owner.js';

/** Presentation Text Data: glyph runs carry its row as `textField`. */
const PTX = 0xd3ee9b;
/** Graphics Data: graphics items carry its row as `dataField`. */
const GAD = 0xd3eebb;

/**
 * Finds the page a field is on and the page-level object that contains it: the direct child of
 * Begin Page whose row render items carry as `sourceField`. For a Presentation Text Data field
 * also `textField` (the field itself): only the glyph runs of that field are its text — marking
 * by `sourceField` would mark the whole text object (every PTX of the BPT). Likewise `dataField`
 * for a Graphics Data field (GAD). An End field (EPT, EGR …) gives the object of its Begin field.
 * @param {object} file File record.
 * @param {number} fieldIndex Field row.
 * @returns {{pageNumber: number|null, sourceField: number|null, textField: number|null,
 *   dataField: number|null}} Page, object row and, for PTX or GAD, the field row.
 */
export function locate(file, fieldIndex) {
  const { index } = file;
  if (!Number.isInteger(fieldIndex) || fieldIndex < 0 || fieldIndex >= index.count) throw new RangeError(`no field ${fieldIndex}`);
  const page = enclosingPage(file, fieldIndex);
  const none = { textField: null, dataField: null };
  if (!page) return { pageNumber: null, sourceField: null, ...none };
  if (page.pageRow === fieldIndex) return { pageNumber: page.pageNumber, sourceField: null, ...none };
  // End fields (End Presentation Text, End Graphics …) stand beside their Begin field: they mean
  // the object it begins.
  let r = endOwner(index, fieldIndex) ?? fieldIndex;
  while (index.parent[r] !== page.pageRow) r = index.parent[r];
  const id = index.id[fieldIndex];
  return { pageNumber: page.pageNumber, sourceField: r, textField: id === PTX ? fieldIndex : null, dataField: id === GAD ? fieldIndex : null };
}

/**
 * Finds the Begin field an End field closes.
 * @param {object} index Field index.
 * @param {number} row Row.
 * @returns {number|null} Begin row, or null when the row is no End field of a group.
 */
function endOwner(index, row) {
  // End fields have the type byte X'A9' (Begin: X'A8'); their Begin is the previous sibling whose end is this row.
  if (((index.id[row] >> 8) & 0xff) !== 0xa9) return null;
  // Walk back over the group's content (deeper rows) to its Begin; stop at the common parent.
  for (let r = row - 1; r > index.parent[row]; r--) {
    if (index.end[r] === row) return r;
  }
  return null;
}
