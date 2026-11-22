/**
 * Specification references (T163, Principle I): every structured field and triplet in the
 * registry, every PTOCA control sequence, GOCA order, BCOCA bar code type, IOCA self-defining
 * field and compression, and every registered object type OID neoAFP interprets names the
 * specification and section that define it; codes are unique per table. The IM image fields and
 * the FOCA and form definition fields are part of the field registry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allRegistries, lookupField } from '../../src/lib/modca/registry/index.js';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { documentOf, page, field, group, hex } from '../helpers/afp-builder.js';
import { CONTROL_SEQUENCE_TABLE } from '../../src/lib/ptoca/ptoca.js';
import { ORDER_TABLE } from '../../src/lib/goca/goca.js';
import { BARCODE_TYPE_TABLE } from '../../src/lib/bcoca/bcoca.js';
import { COMPRESSION_TABLE, SELF_DEFINING_FIELD_TABLE } from '../../src/lib/ioca/ioca.js';
import { OBJECT_TYPE_TABLE } from '../../src/lib/objcontainer/object-types.js';

const SPEC = /^(MO:DCA|PTOCA|GOCA|BCOCA|IOCA|FOCA|CMOCA|MOCA|AFP Line Data)/;

test('every registry entry has a specification reference', () => {
  for (const registry of allRegistries()) {
    for (const entry of registry.list()) {
      assert.match(entry.specRef ?? '', SPEC, `${registry.name}: ${entry.shortName}`);
    }
  }
});

test('IM image, FOCA and form definition fields are registered', () => {
  for (const [hex, name] of [['D3A87B', 'BII'], ['D3A67B', 'IID'], ['D3AC7B', 'ICP'], ['D3EE7B', 'IRD'], ['D3A77B', 'IOC'],
    ['D3A689', 'FND'], ['D3A789', 'FNC'], ['D38C87', 'CPI'], ['D3A8CD', 'BFM'], ['D3A788', 'MMC'], ['D3B1AF', 'PGP']]) {
    const entry = lookupField(Number.parseInt(hex, 16));
    assert.equal(entry?.shortName, name, hex);
    assert.match(entry.specRef, SPEC, hex);
  }
});

test('retired fields CTC and the Form Environment Group are known, not reported as unknown', async () => {
  // As written by older generators (test sets: CTC always X'00000000 00000000 2D00').
  const afp = documentOf('RETIRED1', page('PAGE0001', field('D3A79B', hex('00000000 00000000 2D00')),
    group('D3A8C5', 'FEG00001', field('D3A6C5', hex('0000')))));
  const ws = createWorkspace();
  const [file] = await ws.addFiles([createBufferSource(afp, 'retired.afp')], 'file');
  assert.deepEqual(ws.getDiagnostics().filter((d) => d.code === 'unknownField'), []);
  for (const [hexId, name] of [['D3A79B', 'CTC'], ['D3A8C5', 'BFG'], ['D3A6C5', 'FGD'], ['D3A9C5', 'EFG']]) {
    const entry = lookupField(Number.parseInt(hexId, 16));
    assert.equal(entry?.shortName, name, hexId);
    assert.match(entry.specRef, /retired/, hexId);
  }
  assert.ok(file);
});

for (const [name, table] of Object.entries({
  CONTROL_SEQUENCE_TABLE, ORDER_TABLE, BARCODE_TYPE_TABLE, COMPRESSION_TABLE, SELF_DEFINING_FIELD_TABLE, OBJECT_TYPE_TABLE,
})) {
  test(`${name}: references and unique codes`, () => {
    assert.ok(table.length > 0);
    for (const e of table) assert.match(e.specRef, SPEC, `${name} ${e.code}`);
    assert.equal(new Set(table.map((e) => e.code)).size, table.length, `${name}: duplicate codes`);
  });
}
