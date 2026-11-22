/**
 * Viewer preferences stored on this device: interface language and view choices.
 * Files themselves are never stored (spec Assumptions). Storage may be unavailable (private
 * windows, blocked site data), so every access is guarded and falls back to defaults.
 */

const KEY = 'neoafp.prefs';

/** Default preferences. */
export const DEFAULT_PREFS = Object.freeze({
  language: null, // null = follow the browser language
  resourceView: 'grid',
  gridZoom: 1,
  pageView: 'auto',
  hideTestPrint: false,
  showThumbnails: true,
  showDetails: true,
  tleHiddenColumns: [],
  hideIsisTags: false,
  resourceFilter: null,
  logSeverities: ['error', 'warning', 'info'],
  groupStructure: true,
  previewZoom: 'fit',
  thumbWidth: 120,
  thumbMode: 'pages',
});

/**
 * Reads the stored preferences.
 * @returns {{language: string|null, resourceView: 'grid'|'list', gridZoom: number, pageView: 'auto'|'simplex',
 *   hideTestPrint: boolean, showThumbnails: boolean, showDetails: boolean, tleHiddenColumns: string[],
 *   hideIsisTags: boolean, resourceFilter: object|null, logSeverities: ('error'|'warning'|'info')[],
 *   groupStructure: boolean, previewZoom: 'fit'|'actual', thumbWidth: number,
 *   thumbMode: 'pages'|'sheets'}}
 *   Preferences, with defaults for anything missing or invalid (`resourceFilter`: the Resource
 *   Explorer's filter settings, FR-053; `logSeverities`: the message types the Log Viewer shows;
 *   `groupStructure`: like items grouped in the structure tree; `previewZoom`: the last of "Fit to
 *   screen" and "Actual size" chosen in the resource preview; `thumbWidth`, `thumbMode`: thumbnail
 *   width in CSS pixels (one of the strip's zoom steps; an older stored thumbSize is taken over) and
 *   one row per page or per sheet).
 */
export function loadPrefs() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    stored = {};
  }
  return {
    language: typeof stored.language === 'string' ? stored.language : DEFAULT_PREFS.language,
    resourceView: stored.resourceView === 'list' ? 'list' : 'grid',
    gridZoom: Number.isFinite(stored.gridZoom) ? stored.gridZoom : DEFAULT_PREFS.gridZoom,
    pageView: stored.pageView === 'simplex' ? 'simplex' : DEFAULT_PREFS.pageView,
    hideTestPrint: stored.hideTestPrint === true,
    showThumbnails: stored.showThumbnails !== false,
    showDetails: stored.showDetails !== false,
    tleHiddenColumns: Array.isArray(stored.tleHiddenColumns) ? stored.tleHiddenColumns.filter((c) => typeof c === 'string') : [],
    hideIsisTags: stored.hideIsisTags === true,
    resourceFilter: stored.resourceFilter && typeof stored.resourceFilter === 'object' ? stored.resourceFilter : null,
    logSeverities: Array.isArray(stored.logSeverities)
      ? DEFAULT_PREFS.logSeverities.filter((s) => stored.logSeverities.includes(s))
      : [...DEFAULT_PREFS.logSeverities],
    groupStructure: stored.groupStructure !== false,
    previewZoom: stored.previewZoom === 'actual' ? 'actual' : 'fit',
    thumbWidth: [64, 80, 100, 120, 145, 170, 200].includes(stored.thumbWidth) ? stored.thumbWidth
      : ({ small: 80, large: 170 })[stored.thumbSize] ?? 120,
    thumbMode: stored.thumbMode === 'sheets' ? 'sheets' : 'pages',
  };
}

/**
 * Changes one or more preferences and stores them.
 * @param {Partial<ReturnType<typeof loadPrefs>>} changes Values to change.
 * @returns {ReturnType<typeof loadPrefs>} The updated preferences.
 */
export function savePrefs(changes) {
  const next = { ...loadPrefs(), ...changes };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the change applies to this session only.
  }
  return next;
}
