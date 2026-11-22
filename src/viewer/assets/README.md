# Viewer assets

Graphics used by the viewer interface (not by AFP documents).

- `icons/`: interface icons (buttons, toolbar, file types); SVG preferred, so they stay sharp at
  any zoom and can take the theme color via `currentColor`.
- `logos/`: the neoAFP logo: `neoafp-logo.svg` for the light theme and `neoafp-logo-dark.svg`
  (light "neo", brighter blues) for the dark theme. The favicon is in `icons/`
  (`neoafp-favicon.svg`, and `neoafp-favicon.ico` with 16 and 32 px for browsers without SVG
  favicons).
- `icons/neoafp-app-icon.svg`: the app icon (1024 × 1024, for an installed app or a store
  listing); not used by the viewer yet.

Further graphics go into new subfolders here (e.g. `images/`). Files are loaded from this
folder only, never from other sites. Third-party graphics need a license that allows
redistribution; note their source and license in a `SOURCE.md` next to them.
