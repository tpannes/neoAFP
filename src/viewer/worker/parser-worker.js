/**
 * Parser worker: runs the neoAFP library in a background thread so reading large files never
 * blocks the page (FR-082, research R3). Protocol: contracts/worker-protocol.md.
 *
 * Requests  { id, method, args, priority? }  → responses { id, ok, result | error }.
 * Events    { event: 'progress' | 'diagnostic' | 'fileReady' | 'pagesInvalidated', ... }.
 *
 * Requests run in two lanes. 'high' requests (current page, visible thumbnails, the Details
 * panel's page tab) have a lane of their own and run one at a time, next to whatever the other
 * lane is doing; 'normal' and 'low' requests share the second lane, one at a time, 'normal'
 * first. Long work (TLE tables, NOP lists, search indexing of 2 GB files) therefore never makes
 * the page wait (T230): the library awaits its file reads and yields to the event loop in long
 * loops, so a high request starts within a few milliseconds. `cancel` removes a request that
 * has not started yet.
 */

import { createWorkspace, createBlobSource } from '../../lib/index.js';

const PRIORITY = { high: 0, normal: 1, low: 2 };

/**
 * Posts an event to the viewer.
 * @param {object} message Event message.
 * @returns {void}
 */
const emit = (message) => self.postMessage(message);

const workspace = createWorkspace({
  onProgress: (p) => emit({ event: 'progress', ...p }),
  onDiagnostic: (diagnostic) => emit({ event: 'diagnostic', diagnostic }),
  onPagesInvalidated: (e) => emit({ event: 'pagesInvalidated', ...e }),
});

/** Methods the viewer may call besides the workspace methods. */
const extraMethods = {
  /**
   * Adds files given as Blobs (from file pickers or drag-and-drop).
   * @param {{blob: Blob, name: string, path: string}[]} items Files.
   * @param {'file'|'folder'} origin How they were opened.
   * @returns {Promise<object[]>} File summaries.
   */
  async addBlobs(items, origin) {
    const out = [];
    for (const item of items) {
      const [file] = await workspace.addFiles([createBlobSource(item.blob, item.name, item.path)], origin);
      if (!file) continue; // skipped (operating system metadata in a folder, e.g. .DS_Store)
      emit({ event: 'fileReady', file });
      out.push(file);
    }
    return out;
  },

  /**
   * Cancels a waiting request.
   * @param {number} requestId Id of the request to cancel.
   * @returns {boolean} True if the request was waiting and is now removed.
   */
  cancel(requestId) {
    const i = queue.findIndex((r) => r.id === requestId);
    if (i < 0) return false;
    const [request] = queue.splice(i, 1);
    emit({ id: request.id, ok: false, error: { name: 'AbortError', message: 'cancelled' } });
    return true;
  },
};

/** Waiting requests. */
const queue = [];
/** Whether each lane is busy: 'high' and 'other'. */
const busy = { high: false, other: false };

/**
 * Collects the buffers of typed arrays in a result so they can be transferred without copying.
 * Arrays are copied first, because they may be views on data the library still uses.
 * @param {*} value Result value (modified in place for copied arrays).
 * @param {Transferable[]} list Collected buffers.
 * @param {number} depth Current nesting depth.
 * @returns {*} The value with typed arrays replaced by transferable copies.
 */
function prepareTransfer(value, list, depth = 0) {
  if (ArrayBuffer.isView(value)) {
    const copy = value.slice();
    list.push(copy.buffer);
    return copy;
  }
  if (depth > 3 || value === null || typeof value !== 'object' || value instanceof Blob) return value;
  if (Array.isArray(value)) return value.map((v) => prepareTransfer(v, list, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = prepareTransfer(v, list, depth + 1);
  return out;
}

/**
 * Runs one request and posts its response.
 * @param {{id: number, method: string, args: any[]}} request Request.
 * @returns {Promise<void>} Resolves when the response is posted.
 */
async function run(request) {
  try {
    const fn = request.method in extraMethods ? extraMethods[request.method]
      : typeof workspace[request.method] === 'function' && !request.method.startsWith('_')
        && request.method !== 'getFileRecord' ? workspace[request.method].bind(workspace) : null;
    if (!fn) throw new TypeError(`unknown method: ${request.method}`);
    const transfer = [];
    const result = prepareTransfer(await fn(...(request.args ?? [])), transfer);
    self.postMessage({ id: request.id, ok: true, result }, transfer);
  } catch (error) {
    emit({ id: request.id, ok: false, error: { name: error?.name ?? 'Error', message: String(error?.message ?? error) } });
  }
}

/**
 * Starts each idle lane on its waiting requests (one after another, highest priority first).
 * @returns {void}
 */
function drain() {
  for (const lane of ['high', 'other']) {
    if (busy[lane]) continue;
    const inLane = (r) => (r.rank === PRIORITY.high) === (lane === 'high');
    if (!queue.some(inLane)) continue;
    busy[lane] = true;
    (async () => {
      for (;;) {
        queue.sort((a, b) => a.rank - b.rank || a.seq - b.seq);
        const i = queue.findIndex(inLane);
        if (i < 0) break;
        await run(queue.splice(i, 1)[0]);
      }
      busy[lane] = false;
    })();
  }
}

let seq = 0;
self.addEventListener('message', (event) => {
  const request = event.data;
  if (request?.method === 'cancel') {
    // Cancel runs immediately, not behind the requests it cancels.
    const removed = extraMethods.cancel(request.args?.[0]);
    emit({ id: request.id, ok: true, result: removed });
    return;
  }
  queue.push({ ...request, rank: PRIORITY[request.priority] ?? PRIORITY.normal, seq: seq++ });
  drain();
});
