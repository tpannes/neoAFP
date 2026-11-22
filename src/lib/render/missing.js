/**
 * Lists the resources a render model misses (FR-054: the Resource-Explorer's preview names
 * them, not only the Log Viewer): included overlays, page segments and objects drawn as
 * placeholders (`reason: 'missingResource'`, with `resourceType` and `resourceName`), and the
 * coded fonts, character sets and code pages behind substitute fonts (the font descriptor's
 * `missing`, set by render/fonts.js). Read from the model itself, so the list is complete also
 * when the warning was logged once before (diagnostics are reported once per document).
 */

/**
 * Collects the missing resources of a model.
 * @param {{items: object[]}} model Render model.
 * @returns {{type: string, name: string}[]} Each missing resource once, sorted by type and name.
 */
export function missingResources(model) {
  const found = new Map();
  const add = (type, name) => {
    if (name) found.set(`${type}:${name}`, { type, name });
  };
  for (const item of model?.items ?? []) {
    if (item.type === 'placeholder' && item.reason === 'missingResource') add(item.resourceType ?? 'objectContainer', item.resourceName);
    for (const m of item.font?.missing ?? []) add(m.type, m.name);
  }
  return [...found.values()].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}
