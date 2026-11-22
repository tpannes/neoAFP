/**
 * Registries: lookup tables that say what each structured field and triplet identifier means.
 *
 * Every entry has a short name (e.g. "BPG"), a full name ("Begin Page") and a specification
 * reference (`specRef`, Constitution Principle I). Entries can also have a `decode` function
 * that turns the raw bytes into named values.
 *
 * Field coverage rule (Principle I, tasks T020/T104): a decoder whose results are not yet
 * asserted by a committed test expectation is marked `rawOnly: true`. The library still uses
 * such decoders internally; the structure view shows the field as raw bytes until it is covered.
 */

/**
 * @typedef {object} RegistryEntry
 * @property {number} id Numeric identifier (3 bytes for fields, 1 byte for triplets).
 * @property {string} shortName Abbreviation, e.g. "BPG".
 * @property {string} fullName Full name, e.g. "Begin Page".
 * @property {string} specRef Where the specification defines it.
 * @property {((data: Uint8Array, context?: object) => object)} [decode] Turns bytes into values.
 * @property {boolean} [rawOnly] Show as raw bytes until a test expectation covers the decoder.
 */

/**
 * A lookup table from identifier to entry.
 */
export class Registry {
  /**
   * Creates an empty registry.
   * @param {string} name Name used in coverage reports, e.g. "modca-fields".
   */
  constructor(name) {
    this.name = name;
    /** @type {Map<number, RegistryEntry>} */
    this.entries = new Map();
  }

  /**
   * Adds entries; an identifier may only be registered once.
   * @param {RegistryEntry[]} entries Entries to add.
   * @returns {void}
   */
  register(entries) {
    for (const entry of entries) {
      if (this.entries.has(entry.id)) throw new Error(`${this.name}: duplicate id ${entry.id.toString(16)}`);
      if (!entry.specRef) throw new Error(`${this.name}: entry ${entry.shortName} has no specRef`);
      this.entries.set(entry.id, Object.freeze({ ...entry }));
    }
  }

  /**
   * Adds or replaces the decoder of an existing entry (used by the format modules).
   * @param {number} id Identifier of the entry.
   * @param {(data: Uint8Array, context?: object) => object} decode Decoder function.
   * @param {{rawOnly?: boolean}} [options] Whether the decoder is not yet covered by a test.
   * @returns {void}
   */
  setDecoder(id, decode, options = {}) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`${this.name}: no entry ${id.toString(16)}`);
    this.entries.set(id, Object.freeze({ ...entry, decode, rawOnly: options.rawOnly ?? entry.rawOnly ?? false }));
  }

  /**
   * Looks up an identifier.
   * @param {number} id Identifier.
   * @returns {RegistryEntry|null} The entry, or null if the identifier is unknown.
   */
  lookup(id) {
    return this.entries.get(id) ?? null;
  }

  /**
   * Lists all entries.
   * @returns {RegistryEntry[]} Entries in registration order.
   */
  list() {
    return [...this.entries.values()];
  }
}

/** Structured fields of MO:DCA-P, FOCA, form definitions and IM images. */
export const fieldRegistry = new Registry('fields');
/** MO:DCA triplets. */
export const tripletRegistry = new Registry('triplets');

/** All registries checked by the field coverage test (format modules add theirs). */
const registries = [fieldRegistry, tripletRegistry];

/**
 * Adds a registry (e.g. PTOCA control sequences) to the set checked by the coverage test.
 * @param {Registry} registry Registry to add.
 * @returns {void}
 */
export function addRegistry(registry) {
  if (!registries.includes(registry)) registries.push(registry);
}

/**
 * Lists all registries.
 * @returns {Registry[]} Field, triplet and format-specific registries.
 */
export function allRegistries() {
  return [...registries];
}

/**
 * Looks up a structured field identifier.
 * @param {number} id 3-byte identifier, e.g. 0xD3A8AF.
 * @returns {RegistryEntry|null} The entry, or null for unknown identifiers.
 */
export function lookupField(id) {
  return fieldRegistry.lookup(id);
}

/**
 * Looks up a triplet identifier.
 * @param {number} id 1-byte triplet identifier, e.g. 0x02.
 * @returns {RegistryEntry|null} The entry, or null for unknown identifiers.
 */
export function lookupTriplet(id) {
  return tripletRegistry.lookup(id);
}
