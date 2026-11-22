/**
 * Opening files and folders (FR-001, FR-002, research R11): file picker, folder picker and
 * drag-and-drop of files and folders, including subfolders. Files are handed to a callback as
 * `{ blob, name, path }`; the path is relative to the opened folder.
 */

/**
 * Asks the user to choose files or a folder.
 * @param {{folder: boolean}} options `folder: true` opens a folder picker.
 * @returns {Promise<{blob: File, name: string, path: string}[]>} Chosen files (empty if cancelled).
 */
export function pickFiles({ folder }) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (folder) input.webkitdirectory = true;
    input.addEventListener('change', () => {
      resolve([...input.files].map((f) => ({ blob: f, name: f.name, path: f.webkitRelativePath || f.name })));
    });
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

/**
 * Reads all entries of a directory (the browser returns them in batches).
 * @param {FileSystemDirectoryEntry} dir Directory entry.
 * @returns {Promise<FileSystemEntry[]>} All entries.
 */
function readAllEntries(dir) {
  const reader = dir.createReader();
  const all = [];
  return new Promise((resolve, reject) => {
    const next = () => reader.readEntries((batch) => {
      if (batch.length === 0) resolve(all);
      else {
        all.push(...batch);
        next();
      }
    }, reject);
    next();
  });
}

/**
 * Collects files from a dropped entry, descending into folders.
 * @param {FileSystemEntry} entry File or directory entry.
 * @param {string} prefix Path of the parent folder.
 * @returns {Promise<{blob: File, name: string, path: string}[]>} Files with relative paths.
 */
async function collect(entry, prefix) {
  const path = prefix ? `${prefix}/${entry.name}` : entry.name;
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [{ blob: file, name: file.name, path }];
  }
  const out = [];
  for (const child of await readAllEntries(entry)) out.push(...await collect(child, path));
  return out;
}

/**
 * Turns dropped items into files; tells whether a folder was dropped.
 * @param {DataTransfer} dataTransfer Drop data.
 * @returns {Promise<{files: {blob: File, name: string, path: string}[], folder: boolean}>} Files.
 */
export async function filesFromDrop(dataTransfer) {
  const entries = [...dataTransfer.items]
    .map((item) => (item.kind === 'file' && item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (entries.length === 0) {
    return { files: [...dataTransfer.files].map((f) => ({ blob: f, name: f.name, path: f.name })), folder: false };
  }
  const files = [];
  for (const entry of entries) files.push(...await collect(entry, ''));
  return { files, folder: entries.some((e) => e.isDirectory) };
}

/**
 * Makes an element accept dropped files and folders.
 * @param {HTMLElement} target Drop area.
 * @param {(files: object[], origin: 'file'|'folder') => void} onFiles Called with the dropped files.
 * @returns {void}
 */
export function enableDrop(target, onFiles) {
  target.addEventListener('dragover', (e) => {
    e.preventDefault();
    target.classList.add('drop-target');
  });
  target.addEventListener('dragleave', () => target.classList.remove('drop-target'));
  target.addEventListener('drop', async (e) => {
    e.preventDefault();
    target.classList.remove('drop-target');
    const { files, folder } = await filesFromDrop(e.dataTransfer);
    if (files.length) onFiles(files, folder ? 'folder' : 'file');
  });
}
