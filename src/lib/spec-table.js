/**
 * Code tables with specification references (Principle I, task T163): every code neoAFP
 * interprets — PTOCA control sequences, GOCA orders, BCOCA bar code types, IOCA self-defining
 * fields and compressions, registered object type OIDs — is listed with its name as the
 * specification writes it and where it is defined.
 */

/**
 * @typedef {object} SpecEntry
 * @property {number|string} code Code (or OID).
 * @property {string} shortName Mnemonic, or the name when the specification has none.
 * @property {string} fullName Full name.
 * @property {string} specRef Document and section.
 */

/**
 * Builds a frozen table.
 * @param {string} document Specification, e.g. "PTOCA Reference (AFPC-0009-04)".
 * @param {string} section Section or table, e.g. "Control Sequences".
 * @param {[number|string, string, string][]} rows Code, short name (may be empty), full name.
 * @returns {readonly SpecEntry[]} Entries.
 */
export function specTable(document, section, rows) {
  return Object.freeze(rows.map(([code, shortName, fullName]) => Object.freeze({
    code,
    shortName: shortName || fullName,
    fullName,
    specRef: `${document}, ${section}, "${fullName}${shortName ? ` (${shortName})` : ''}"`,
  })));
}

/**
 * Turns a table into a map code → short name.
 * @param {readonly SpecEntry[]} table Table.
 * @returns {Readonly<Record<string, string>>} Map.
 */
export const shortNames = (table) => Object.freeze(Object.fromEntries(table.map((e) => [e.code, e.shortName])));
