/**
 * Diagnostics: problem reports about opened files.
 *
 * The library never throws because of file content (contracts/library-api.md, "Errors").
 * Instead, everything it cannot read, does not support or has to substitute becomes a
 * diagnostic with a severity, a code, the file and byte offset, and a message key that the
 * viewer translates into the user's language (FR-081).
 */

/** All diagnostic codes, each with the message key the viewer translates. */
export const DIAGNOSTIC_CODES = Object.freeze({
  unknownField: 'diagnostic.unknownField',
  unknownTriplet: 'diagnostic.unknownTriplet',
  unsupportedObject: 'diagnostic.unsupportedObject',
  missingResource: 'diagnostic.missingResource',
  duplicateResource: 'diagnostic.duplicateResource',
  fontSubstituted: 'diagnostic.fontSubstituted',
  truncated: 'diagnostic.truncated',
  decodeFailed: 'diagnostic.decodeFailed',
  unsupportedFileKind: 'diagnostic.unsupportedFileKind',
});

/** Allowed severities, from least to most serious. */
export const SEVERITIES = Object.freeze(['info', 'warning', 'error']);

/**
 * @typedef {object} Diagnostic
 * @property {'info'|'warning'|'error'} severity How serious the problem is.
 * @property {string} code One of the keys of DIAGNOSTIC_CODES.
 * @property {string|null} fileId File the problem belongs to.
 * @property {number|null} offset Byte offset in the file, if known.
 * @property {string|null} fieldId Structured field identifier (6 hex digits), if relevant.
 * @property {string} messageKey Translation key for the message.
 * @property {object} params Values inserted into the translated message.
 */

/**
 * Creates a diagnostic and checks that its code and severity are known.
 * @param {object} input Diagnostic properties.
 * @param {'info'|'warning'|'error'} input.severity How serious the problem is.
 * @param {string} input.code One of the keys of DIAGNOSTIC_CODES.
 * @param {string} [input.fileId] File the problem belongs to.
 * @param {number} [input.offset] Byte offset in the file.
 * @param {string} [input.fieldId] Structured field identifier as 6 hex digits.
 * @param {string} [input.messageKey] Translation key; defaults to the code's key.
 * @param {object} [input.params] Values for the message.
 * @returns {Diagnostic} A frozen diagnostic object (plain data, safe to send to the viewer).
 */
export function createDiagnostic({ severity, code, fileId = null, offset = null, fieldId = null,
  messageKey, params = {} }) {
  if (!SEVERITIES.includes(severity)) throw new TypeError(`unknown severity: ${severity}`);
  if (!(code in DIAGNOSTIC_CODES)) throw new TypeError(`unknown diagnostic code: ${code}`);
  return Object.freeze({
    severity,
    code,
    fileId,
    offset,
    fieldId,
    messageKey: messageKey ?? DIAGNOSTIC_CODES[code],
    params: { ...params },
  });
}

/**
 * Collects diagnostics for all open files and lets callers filter them.
 */
export class DiagnosticCollector {
  /**
   * Creates an empty collector.
   * @param {(d: Diagnostic) => void} [onAdd] Called for every added diagnostic.
   */
  constructor(onAdd) {
    /** @type {Diagnostic[]} */
    this.items = [];
    this.onAdd = onAdd;
  }

  /**
   * Adds a diagnostic.
   * @param {Parameters<typeof createDiagnostic>[0]} input Diagnostic properties.
   * @returns {Diagnostic} The stored diagnostic.
   */
  add(input) {
    const diagnostic = createDiagnostic(input);
    this.items.push(diagnostic);
    this.onAdd?.(diagnostic);
    return diagnostic;
  }

  /**
   * Lists diagnostics, optionally only for one file and/or one severity.
   * @param {{fileId?: string, severity?: 'info'|'warning'|'error'}} [filter] Filter.
   * @returns {Diagnostic[]} Matching diagnostics in the order they were added.
   */
  list(filter = {}) {
    return this.items.filter((d) => (filter.fileId === undefined || d.fileId === filter.fileId)
      && (filter.severity === undefined || d.severity === filter.severity));
  }

  /**
   * Removes all diagnostics of one file, or all diagnostics.
   * @param {string} [fileId] File whose diagnostics to remove; all when omitted.
   * @returns {void}
   */
  clear(fileId) {
    this.items = fileId === undefined ? [] : this.items.filter((d) => d.fileId !== fileId);
  }
}
