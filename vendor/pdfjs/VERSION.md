# Vendored pdf.js

The only third-party code in neoAFP. Used by the viewer to render PDF documents embedded in AFP
object containers.

| Item | Value |
|---|---|
| Package | `pdfjs-dist` |
| Version | 5.7.284 (published 2026-04-27) |
| Source | https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-5.7.284.tgz |
| Tarball SHA-256 | `f14db72530dec74fe666910e246242b9bb698df30f0e06622c4471b340a0413d` |
| Tarball integrity (npm) | `sha512-h4EdYQczmGhbOlqc3PPZwxevn7ApdWPbovAuWXOB/DjIyigSnwfy2oze7c6mRcSr9XgLp3eN3EeL4DyySTPMFw==` (verified) |
| License | Apache License 2.0 (`LICENSE`); bundled WebAssembly decoders carry their own licenses in `wasm/LICENSE_*` |

## Files taken from the package

| Here | From the package | SHA-256 |
|---|---|---|
| `pdf.mjs` | `build/pdf.mjs` | `f36805aa525535f968b9df66c9925bb1410f71b76f16822a783dd2b2c54c14ee` |
| `pdf.worker.mjs` | `build/pdf.worker.mjs` | `535304b72e8a4354480292070ffc0574be1106f571a6c3949768bd46f3923af6` |
| `cmaps/` | `cmaps/` | character maps for PDFs with non-embedded CJK fonts (`cMapUrl`) |
| `standard_fonts/` | `standard_fonts/` | the 14 standard PDF fonts (`standardFontDataUrl`) |
| `wasm/` | `wasm/` without `quickjs-eval.*` | JPEG 2000, JBIG2 and color management decoders (`wasmUrl`) |
| `iccs/` | `iccs/` | ICC profiles for CMYK conversion (`iccUrl`) |
| `LICENSE` | `LICENSE` | |

Not taken: `wasm/quickjs-eval.js` and `wasm/quickjs-eval.wasm` (QuickJS, for JavaScript inside
PDFs). neoAFP turns PDF scripting off (`enableScripting: false`, `isEvalSupported: false`) and
pdf.js loads only `jbig2*`, `openjpeg*` and `qcms_bg.wasm` from `wasm/` for rendering; the
package also ships no license file for QuickJS.

All licenses of the files here are listed in `THIRD-PARTY-NOTICES.md` at the project root.

## Updating

Replace all files from one exact newer release (again without `quickjs-eval.*`, unless a new
release loads it for rendering), verify the tarball against the npm `integrity` value, update
this table and `THIRD-PARTY-NOTICES.md`, and check documents with embedded PDFs in the viewer
(pages render, no CSP or WebAssembly messages in the console).
