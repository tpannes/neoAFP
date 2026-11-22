/**
 * Worker client: the viewer's side of the parser worker protocol
 * (contracts/worker-protocol.md). Turns requests into Promises and forwards worker events.
 */

/**
 * Connection to the parser worker.
 */
export class WorkerClient {
  /**
   * Starts the parser worker.
   * @param {URL|string} [url] Worker script; defaults to worker/parser-worker.js next to this file.
   */
  constructor(url = new URL('./worker/parser-worker.js', import.meta.url)) {
    this.worker = new Worker(url, { type: 'module' });
    this.nextId = 1;
    /** @type {Map<number, {resolve: Function, reject: Function}>} */
    this.pending = new Map();
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
    this.worker.addEventListener('message', (e) => this.#onMessage(e.data));
    this.worker.addEventListener('error', (e) => this.#emit('error', { message: e.message ?? 'worker error' }));
  }

  /**
   * Handles a message from the worker: a response or an event.
   * @param {object} message Message data.
   * @returns {void}
   */
  #onMessage(message) {
    if (message.event) {
      this.#emit(message.event, message);
      return;
    }
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    if (message.ok) entry.resolve(message.result);
    else entry.reject(Object.assign(new Error(message.error.message), { name: message.error.name }));
  }

  /**
   * Notifies event listeners.
   * @param {string} name Event name.
   * @param {object} data Event data.
   * @returns {void}
   */
  #emit(name, data) {
    for (const handler of this.listeners.get(name) ?? []) handler(data);
  }

  /**
   * Calls a library method in the worker with normal priority.
   * @param {string} method Method name (workspace method or `addBlobs`).
   * @param {...any} args Arguments (must be structured-clone-safe).
   * @returns {Promise<any>} The result.
   */
  call(method, ...args) {
    return this.request({ method, args });
  }

  /**
   * Sends a request with options.
   * @param {{method: string, args?: any[], priority?: 'high'|'normal'|'low'}} request Request.
   * @returns {Promise<any> & {requestId: number}} The result; `requestId` can be passed to cancel().
   */
  request({ method, args = [], priority = 'normal' }) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, args, priority });
    });
    promise.requestId = id;
    return promise;
  }

  /**
   * Cancels a request that has not started yet.
   * @param {number} requestId Id from request().requestId.
   * @returns {Promise<boolean>} True if the request was cancelled.
   */
  cancel(requestId) {
    return this.call('cancel', requestId);
  }

  /**
   * Subscribes to worker events ('progress', 'diagnostic', 'fileReady', 'pagesInvalidated', 'error').
   * @param {string} name Event name.
   * @param {(data: object) => void} handler Called for each event.
   * @returns {() => void} Function that removes the subscription.
   */
  on(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(handler);
    return () => this.listeners.get(name).delete(handler);
  }
}
