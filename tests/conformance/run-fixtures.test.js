/**
 * Fixture runner (task T015): loads every synthetic fixture, and every local reference fixture
 * (see fixtures.js), into a workspace and compares the result with the fixture's expectations,
 * section by section.
 *
 * Sections: fields, decodedFields, tles, nops, xmp, colorManagement, search, renderModel, pixels, sheets,
 * printInfo, resources, extraction, diagnostics. tles, nops, xmp and colorManagement are compared
 * exactly, but only on the keys the expectation lists (arrays must have the same length);
 * resources likewise, with 0.05 mm tolerance. `extraction` finds each resource by name and type
 * (and source path) and checks length, SHA-256, file name and MIME type of the extracted bytes.
 * A synthetic fixture may return `extra` files, opened after the main file. `pixels` maps page → item index → {width, height, sha256}: the size of
 * the image item's pixels and a SHA-256 over all their byte arrays (bilevel rows, RGBA, tiles or
 * embedded JPEG data, in traversal order), so decoded image content is compared exactly. A section that needs a library function which does not exist yet
 * fails with a clear message, so expectations written ahead of implementation fail first (TDD).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspace, createBufferSource, createNodeFileSource } from '../../src/lib/index.js';
import { relative } from 'node:path';
import { createHash } from 'node:crypto';
import { loadSyntheticFixtures, loadReferenceFixtures, pixelHash, SAMPLES } from './fixtures.js';

/** Allowed position difference for render model items: 20 page units = 1 point (SC-003). */
const POSITION_TOLERANCE = 20;

/**
 * Fails clearly when a workspace function needed by an expectation section is missing.
 * @param {object} ws Workspace.
 * @param {string} method Method name.
 * @param {string} section Expectation section.
 * @returns {void}
 */
function requireMethod(ws, method, section) {
  assert.equal(typeof ws[method], 'function', `section "${section}" needs workspace.${method}(), not implemented yet`);
}

/**
 * Compares numbers in nested objects with a tolerance, everything else exactly.
 * @param {*} actual Actual value.
 * @param {*} expected Expected value (only its keys are compared).
 * @param {string} path Location for error messages.
 * @returns {void}
 */
function matchApprox(actual, expected, path) {
  if (typeof expected === 'number' && typeof actual === 'number') {
    assert.ok(Math.abs(actual - expected) <= POSITION_TOLERANCE, `${path}: ${actual} vs ${expected}`);
  } else if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object', `${path}: missing`);
    for (const key of Object.keys(expected)) matchApprox(actual[key], expected[key], `${path}.${key}`);
  } else {
    assert.deepEqual(actual, expected, path);
  }
}

/**
 * Compares nested values exactly, but only the keys present in the expectation; arrays must have
 * the same length.
 * @param {*} actual Actual value.
 * @param {*} expected Expected value.
 * @param {string} path Location for error messages.
 * @param {number} [tolerance] Allowed difference for numbers (0 = exact).
 * @returns {void}
 */
function matchKeys(actual, expected, path, tolerance = 0) {
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path}: not an array`);
    assert.equal(actual.length, expected.length, `${path}: length`);
    expected.forEach((e, i) => matchKeys(actual[i], e, `${path}[${i}]`, tolerance));
  } else if (expected && typeof expected === 'object') {
    assert.ok(actual && typeof actual === 'object', `${path}: missing`);
    for (const key of Object.keys(expected)) matchKeys(actual[key], expected[key], `${path}.${key}`, tolerance);
  } else if (tolerance && typeof expected === 'number' && typeof actual === 'number') {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${path}: ${actual} vs ${expected}`);
  } else {
    assert.deepEqual(actual, expected, path);
  }
}

/**
 * Checks all expectation sections against a loaded file.
 * @param {object} ws Workspace with the file loaded.
 * @param {object} file Summary of the main file.
 * @param {object} expected Expectations.
 * @returns {Promise<void>} Resolves when all present sections match.
 */
async function checkExpectations(ws, file, expected) {
  if (expected.kind) assert.equal(file.kind, expected.kind, 'kind');
  if (expected.pageCount !== undefined) assert.equal(file.pageCount, expected.pageCount, 'pageCount');
  if (expected.fields) {
    const { index } = ws.getFileRecord(file.id);
    const actual = Array.from({ length: index.count }, (_, r) => {
      const f = index.get(r);
      return { offset: f.offset, length: f.length, id: f.idHex };
    });
    assert.deepEqual(actual, expected.fields, 'fields');
  }
  if (expected.decodedFields) {
    requireMethod(ws, 'findFieldAtOffset', 'decodedFields');
    requireMethod(ws, 'getField', 'decodedFields');
    for (const exp of expected.decodedFields) {
      const row = ws.findFieldAtOffset(file.id, exp.offset);
      const field = await ws.getField(file.id, row);
      assert.equal(field.idHex ?? field.id, exp.id, `decodedFields @${exp.offset} id`);
      if (exp.parameters) {
        assert.deepEqual(field.parameters.map(({ name, value }) => ({ name, value })), exp.parameters,
          `decodedFields @${exp.offset} parameters`);
      }
      if (exp.triplets) {
        assert.deepEqual(field.triplets.map((t) => ({ id: t.id, decoded: t.decoded })), exp.triplets,
          `decodedFields @${exp.offset} triplets`);
      }
    }
  }
  if (expected.tles) {
    requireMethod(ws, 'getTles', 'tles');
    matchKeys(await ws.getTles(file.id), expected.tles, 'tles');
  }
  if (expected.nops) {
    requireMethod(ws, 'getNops', 'nops');
    matchKeys(await ws.getNops(file.id), expected.nops, 'nops');
  }
  if (expected.xmp) {
    requireMethod(ws, 'getXmp', 'xmp');
    matchKeys(await ws.getXmp(file.id), expected.xmp, 'xmp');
  }
  if (expected.colorManagement) {
    requireMethod(ws, 'getColorManagement', 'colorManagement');
    matchKeys(await ws.getColorManagement(file.id), expected.colorManagement, 'colorManagement');
  }
  if (expected.search) {
    requireMethod(ws, 'buildSearchIndex', 'search');
    // The index is built in slices (so the worker stays responsive); build it completely.
    while (!(await ws.buildSearchIndex({ budgetMs: 1000 })).done);
    for (const { query, results } of expected.search) {
      const out = await ws.search(query);
      assert.equal(out.indexing, false, 'search: index complete');
      matchKeys(out.results, results, `search ${JSON.stringify(query)}`);
    }
  }
  if (expected.renderModel) {
    requireMethod(ws, 'getRenderModel', 'renderModel');
    for (const [pageNumber, exp] of Object.entries(expected.renderModel)) {
      const model = await ws.getRenderModel(file.id, Number(pageNumber));
      matchApprox(model, exp, `renderModel[${pageNumber}]`);
      // Every item links back to the structured field it comes from (T082, FR-034).
      model.items.forEach((item, i) => assert.ok(Number.isInteger(item.sourceField), `renderModel[${pageNumber}].items.${i}: sourceField`));
    }
  }
  if (expected.pixels) {
    requireMethod(ws, 'getImagePixels', 'pixels');
    for (const [pageNumber, byItem] of Object.entries(expected.pixels)) {
      const model = await ws.getRenderModel(file.id, Number(pageNumber));
      for (const [index, exp] of Object.entries(byItem)) {
        const item = model.items[Number(index)];
        assert.ok(item?.imageRef, `pixels[${pageNumber}][${index}]: not an image item`);
        const px = await ws.getImagePixels(item.imageRef);
        // Encoded images (JPEG, PNG, GIF passed to the browser) have no decoded size.
        const actual = { ...(px.width !== undefined && { width: px.width, height: px.height }), sha256: pixelHash(px) };
        assert.deepEqual(actual, exp, `pixels[${pageNumber}][${index}]`);
      }
    }
  }
  if (expected.sheets) {
    requireMethod(ws, 'getSheets', 'sheets');
    matchApprox(await ws.getSheets(file.id), expected.sheets, 'sheets');
  }
  if (expected.printInfo) {
    requireMethod(ws, 'getPrintInfo', 'printInfo');
    for (const [pageNumber, exp] of Object.entries(expected.printInfo)) {
      assert.deepEqual(await ws.getPrintInfo(file.id, Number(pageNumber)), exp, `printInfo[${pageNumber}]`);
    }
  }
  if (expected.resources) {
    requireMethod(ws, 'getResources', 'resources');
    // Millimeters are compared to 0.05 mm (one decimal is shown).
    matchKeys(await ws.getResources(), expected.resources, 'resources', 0.05);
  }
  if (expected.extraction) {
    requireMethod(ws, 'extractResource', 'extraction');
    const resources = await ws.getResources();
    for (const exp of [].concat(expected.extraction)) {
      const r = resources.find((x) => x.name === exp.name && x.type === exp.type && (!exp.source || x.source.path === exp.source));
      assert.ok(r, `extraction: no resource ${exp.type} ${exp.name}`);
      const out = await ws.extractResource(r.id);
      const label = `extraction ${exp.type} ${exp.name}`;
      assert.equal(out.bytes.length, exp.length, `${label} length`);
      if (exp.sha256) assert.equal(createHash('sha256').update(out.bytes).digest('hex'), exp.sha256, `${label} bytes`);
      if (exp.fileName) assert.equal(out.fileName, exp.fileName, `${label} file name`);
      if (exp.mimeType) assert.equal(out.mimeType, exp.mimeType, `${label} MIME type`);
    }
  }
  if (expected.diagnostics) {
    const codes = ws.getDiagnostics({ fileId: file.id }).map((d) => d.code).sort();
    assert.deepEqual(codes, [...expected.diagnostics].sort(), 'diagnostics');
  }
}

for (const fixture of await loadSyntheticFixtures()) {
  test(`synthetic fixture ${fixture.name}`, async () => {
    const ws = createWorkspace();
    const [file] = await ws.addFiles([createBufferSource(fixture.bytes, fixture.name.replace('.fixture.js', '.afp'))], 'file');
    if (fixture.extra?.length) await ws.addFiles(fixture.extra.map((x) => createBufferSource(x.bytes, x.name)), 'file');
    await checkExpectations(ws, file, fixture.expected);
  });
}

for (const fixture of await loadReferenceFixtures()) {
  test(`reference fixture ${fixture.name}`, { skip: fixture.available ? false : 'input files not present' }, async () => {
    const ws = createWorkspace();
    const sources = await Promise.all(fixture.inputs.map((p) => createNodeFileSource(p, relative(SAMPLES, p))));
    try {
      const [file] = await ws.addFiles(sources, 'folder');
      await checkExpectations(ws, file, fixture.expected);
    } finally {
      await Promise.all(sources.map((s) => s.close()));
    }
  });
}

test('fixture folders can be read', async () => {
  assert.ok(Array.isArray(await loadSyntheticFixtures()));
  assert.ok(Array.isArray(await loadReferenceFixtures()));
});
