/**
 * Viewer start-up: loads the interface language, starts the parser worker and connects the
 * application frame (<neoafp-app>) and its two screens, the AFP-Viewer and the Resource-Explorer.
 */

import { initI18n } from './i18n/i18n.js';
import { WorkerClient } from './worker-client.js';
import './components/app-shell.js';
import './views/afp-viewer.js';
import './views/resources-view.js';

/**
 * Starts the viewer.
 * @returns {Promise<void>} Resolves when the interface is ready.
 */
async function start() {
  await initI18n();
  const client = new WorkerClient();
  const app = document.querySelector('neoafp-app');
  await app.attach(client);
  const viewer = document.createElement('afp-viewer');
  app.registerScreen('viewer', viewer);
  await viewer.attach(client, app);
  app.showScreen('viewer');
  const resources = document.createElement('resources-view');
  app.registerScreen('resources', resources);
  resources.attach(client, app);
  app.showScreen('viewer');
}

start().catch((error) => {
  document.body.textContent = `neoAFP could not start: ${error?.message ?? error}`;
});
