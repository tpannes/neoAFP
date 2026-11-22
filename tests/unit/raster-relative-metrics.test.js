/**
 * Raster fonts with relative metrics (FOCA Font Control unit base X'02'): increments, A-spaces
 * and baseline offsets are in 1/1000 em, the bitmaps at the Shape Resolution. They must be laid
 * out exactly like the same font with metrics in pels (bug: the relative values were read as
 * pels, so characters stood about 30 times too far apart and jumped up and down). Built with
 * the text fixture's font, once in pels and once in relative units (10 pt at 240 dpi = 33⅓ pels
 * per em).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource } from '../../src/lib/index.js';
import { resourceGroup } from '../helpers/afp-builder.js';
import { fontCharacterSet, codePage } from '../helpers/fixture-text.js';
import { buildBytes } from '../fixtures/synthetic/us1-missing-resources.fixture.js';

/**
 * Renders the fixture page with the given font resources and returns its first glyph run and
 * the glyph data the viewer gets.
 * @param {boolean} relative Font metrics in relative units.
 * @returns {Promise<{run: object, glyphs: object}>} Run and glyph data.
 */
async function render(relative) {
  const ws = createWorkspace();
  const [doc] = await ws.addFiles([
    createBufferSource(buildBytes(), 'doc.afp'),
    createBufferSource(resourceGroup(fontCharacterSet('C0MISSNG', { relative }), codePage('T1MISSNG')), 'fonts.afp'),
  ], 'file');
  const model = await ws.getRenderModel(doc.id, 1);
  const run = model.items.find((i) => i.type === 'glyphRun');
  return { run, glyphs: ws.getGlyphs(run.font.ref, run.ids) };
}

test('relative raster metrics give the same layout and glyph placement as pel metrics', async () => {
  const pels = await render(false);
  const rel = await render(true);
  assert.equal(pels.run.font.kind, 'raster');
  assert.equal(rel.run.font.kind, 'raster');
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≠ ${b}`);
  pels.run.dx.forEach((d, i) => near(rel.run.dx[i], d));
  near(rel.run.x, pels.run.x);
  near(rel.run.y, pels.run.y);
  assert.equal(rel.glyphs.resolution, pels.glyphs.resolution);
  pels.glyphs.glyphs.forEach((g, i) => {
    near(rel.glyphs.glyphs[i].a, g.a);
    near(rel.glyphs.glyphs[i].baseOffset, g.baseOffset);
    assert.equal(rel.glyphs.glyphs[i].width, g.width);
  });
});
