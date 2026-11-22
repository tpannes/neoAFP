/**
 * Missing resources of a resource preview (FR-054): the Resource-Explorer's preview names what
 * its render model misses — included page segments and overlays drawn as placeholders, and the
 * character set and code page behind a substitute font — read from the model, so a second
 * render (when the warnings were already logged once) gives the same list.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { bytes, field, uint, ebcdic, triplet, group, ID } from '../helpers/afp-builder.js';
import { AMI, AMB, SCFL, TRN } from '../helpers/fixture-text.js';

const UNITS = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2));

/**
 * An overlay that maps a missing font and includes a missing page segment and overlay.
 * @returns {Uint8Array} Overlay file.
 */
function overlay() {
  const fqn = (type, name) => triplet(0x02, type, 0x00, ebcdic(name, 8));
  const rg = bytes(triplet(0x24, 0x05, 1), fqn(0x86, 'C0MISSNG'), fqn(0x85, 'T1MISSNG'), triplet(0x26, uint(0, 2)));
  return group(ID.BMO, 'O1PREVW1',
    group(ID.BAG, 'AEG1', field('D3AB8A', bytes(uint(rg.length + 2, 2), rg)),
      field(ID.PGD, bytes(UNITS, uint(11906, 3), uint(16838, 3), uint(0, 3)))),
    group(ID.BPT, 'PT000001', field(ID.PTX, bytes(SCFL(1), AMB(1440), AMI(1440), TRN('ABC')))),
    field('D3AF5F', bytes(ebcdic('S1MISSNG', 8), uint(1440, 3), uint(2880, 3))),
    field('D3AFD8', bytes(ebcdic('O1MISSNG', 8), uint(5760, 3), uint(4320, 3), uint(0, 2))));
}

test('the preview model lists missing segments, overlays and font parts, also when rendered again', async () => {
  const ws = createWorkspace();
  await ws.addFiles([createBufferSource(overlay(), 'O1PREVW1.OVL')], 'folder');
  const [resource] = (await ws.getResources()).filter((r) => r.name === 'O1PREVW1');
  const expected = [
    { type: 'codePage', name: 'T1MISSNG' }, { type: 'fontCharacterSet', name: 'C0MISSNG' },
    { type: 'overlay', name: 'O1MISSNG' }, { type: 'pageSegment', name: 'S1MISSNG' },
  ];
  assert.deepEqual((await ws.getResourceRenderModel(resource.id)).missingResources, expected);
  assert.deepEqual((await ws.getResourceRenderModel(resource.id)).missingResources, expected);
});
