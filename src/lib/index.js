/**
 * Public API of the neoAFP library (contracts/library-api.md).
 *
 * The library contains all AFP knowledge and has no dependency on the browser page (DOM), so it
 * runs in a Web Worker, on the main thread and in Node.js tests alike (Constitution Principle II).
 * The viewer uses it only through these exports, via the parser worker.
 */

export { createBlobSource, createBufferSource } from './io/byte-source.js';
export { createNodeFileSource } from './io/node-file-source.js';
export { createWorkspace } from './workspace.js';
export { exportResourcesCsv } from './export/csv.js';
