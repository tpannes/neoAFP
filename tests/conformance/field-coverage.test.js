/**
 * Field coverage (task T020, Constitution Principle I, maintainer decision "Option B"):
 * a structured field or triplet may only be shown decoded if a committed test expectation
 * asserts its decoded values (`decodedFields` in the synthetic fixtures). Only committed files are
 * read, never local reference fixtures, so the result is the same on every machine.
 *
 * - A registry entry with a decoder must be covered, or marked `rawOnly: true`.
 * - A `rawOnly` entry that is covered fails too, so the marker is removed once coverage exists.
 * `rawOnly` affects only the structure view; the library still uses the decoder internally.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allRegistries } from '../../src/lib/modca/registry/index.js';
import '../../src/lib/index.js';
import { loadSyntheticFixtures } from './fixtures.js';

/**
 * Collects the identifiers whose decoded values are asserted in expectations.
 * @returns {Promise<{fields: Set<number>, triplets: Set<number>, others: Map<string, Set<number>>}>}
 *   Covered structured field IDs, triplet IDs and IDs per other registry name.
 */
async function coveredIds() {
  const fields = new Set();
  const triplets = new Set();
  const others = new Map();
  const expectations = (await loadSyntheticFixtures()).map((f) => f.expected);
  for (const expected of expectations) {
    for (const entry of expected.decodedFields ?? []) {
      if (entry.parameters) fields.add(parseInt(entry.id, 16));
      for (const t of entry.triplets ?? []) if (t.decoded) triplets.add(t.id);
    }
    for (const [registry, ids] of Object.entries(expected.decodedOther ?? {})) {
      const set = others.get(registry) ?? new Set();
      ids.forEach((id) => set.add(id));
      others.set(registry, set);
    }
  }
  return { fields, triplets, others };
}

test('every decoder is covered by a committed expectation or marked rawOnly', async () => {
  const covered = await coveredIds();
  const uncovered = [];
  const staleRawOnly = [];
  for (const registry of allRegistries()) {
    const set = registry.name === 'fields' ? covered.fields
      : registry.name === 'triplets' ? covered.triplets
        : covered.others.get(registry.name) ?? new Set();
    for (const entry of registry.list()) {
      if (!entry.decode) continue;
      const isCovered = set.has(entry.id);
      const label = `${registry.name}: ${entry.shortName} (${entry.id.toString(16).toUpperCase()})`;
      if (!isCovered && !entry.rawOnly) uncovered.push(label);
      if (isCovered && entry.rawOnly) staleRawOnly.push(label);
    }
  }
  assert.deepEqual(uncovered, [], `decoders without a committed expectation (add decodedFields or mark rawOnly):\n${uncovered.join('\n')}`);
  assert.deepEqual(staleRawOnly, [], `covered decoders still marked rawOnly (remove the marker):\n${staleRawOnly.join('\n')}`);
});
