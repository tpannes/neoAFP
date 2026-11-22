/**
 * Groups in the structure tree (FR-030): runs of like items directly after one another — the
 * same structured field (e.g. dozens of TLEs, or the page groups of a document) or the same
 * triplet — are shown as one group node, opened only when needed. Pure functions (no DOM), so
 * they can be tested on their own; structure-view.js uses them when grouping is switched on.
 */

/** Smallest run of like items that becomes a group. */
export const MIN_GROUP = 3;

/**
 * Tells whether two tree nodes are alike: same kind of item (field or triplet) and identifier.
 * @param {{type: string, code: string}} a Node.
 * @param {{type: string, code: string}} b Node.
 * @returns {boolean} True when they belong in one group.
 */
function alike(a, b) {
  return a.type === b.type && a.code === b.code && a.type !== 'group';
}

/**
 * Replaces runs of at least MIN_GROUP like nodes by group nodes.
 * @param {object[]} nodes Tree nodes in order (from getTree).
 * @returns {object[]} Nodes and groups in the same order. A group has `type: 'group'`, the
 *   first member's kind, identifier, names, row, offset and page, `count`, `members` (the nodes)
 *   and `memberIds` (their ids, for revealing a member), and the id "g:" + the first member's id.
 */
export function groupNodes(nodes) {
  const out = [];
  for (let i = 0; i < nodes.length;) {
    let j = i + 1;
    while (j < nodes.length && alike(nodes[i], nodes[j])) j++;
    if (j - i >= MIN_GROUP) {
      const members = nodes.slice(i, j);
      const first = members[0];
      const last = members[members.length - 1];
      out.push({
        id: `g:${first.id}`, type: 'group', memberType: first.type, kind: first.kind, code: first.code,
        shortName: first.shortName, fullName: first.fullName, label: '', row: first.row, tripletIndex: first.tripletIndex,
        offset: first.offset, length: last.offset + last.length - first.offset, pageNumber: first.pageNumber,
        hasChildren: true, count: members.length, members, memberIds: new Set(members.map((m) => m.id)),
      });
    } else {
      out.push(...nodes.slice(i, j));
    }
    i = j;
  }
  return out;
}
