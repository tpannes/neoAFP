# Third-party notices

neoAFP is licensed under the GNU Affero General Public License v3.0 or later (see `LICENSE`).
It contains the following third-party components. Each keeps its own license; all of them
allow redistribution as part of an AGPL-licensed work. The full license texts are in the files
named below.

## pdf.js (vendored, `vendor/pdfjs/`)

Mozilla's PDF renderer, used to draw PDF pages embedded in AFP object containers. Copied
unchanged from `pdfjs-dist` 5.7.284; version, source and checksums are in
`vendor/pdfjs/VERSION.md`.

| Part | Files | License | License text |
|---|---|---|---|
| pdf.js | `pdf.mjs`, `pdf.worker.mjs`, `cmaps/` | Apache License 2.0 | `vendor/pdfjs/LICENSE` |
| JBIG2 decoder (PDFium) | `wasm/jbig2.wasm`, `wasm/jbig2_nowasm_fallback.js` | BSD 3-Clause; Mozilla's build Apache License 2.0 | `vendor/pdfjs/wasm/LICENSE_JBIG2`, `LICENSE_PDFJS_JBIG2` |
| OpenJPEG (JPEG 2000) | `wasm/openjpeg.wasm`, `wasm/openjpeg_nowasm_fallback.js` | BSD 2-Clause | `vendor/pdfjs/wasm/LICENSE_OPENJPEG`, `LICENSE_PDFJS_OPENJPEG` |
| qcms (color management) | `wasm/qcms_bg.wasm` | MIT; Mozilla's build BSD 2-Clause | `vendor/pdfjs/wasm/LICENSE_QCMS`, `LICENSE_PDFJS_QCMS` |
| Foxit standard fonts (PDFium) | `standard_fonts/Foxit*.pfb` | BSD 3-Clause | `vendor/pdfjs/standard_fonts/LICENSE_FOXIT` |
| Liberation Sans fonts | `standard_fonts/LiberationSans-*.ttf` | SIL Open Font License 1.1 | `vendor/pdfjs/standard_fonts/LICENSE_LIBERATION` |
| CMYK ICC profile | `iccs/CGATS001Compat-v2-micro.icc` | CC0 1.0 | `vendor/pdfjs/iccs/LICENSE` |

The package's QuickJS engine (`wasm/quickjs-eval.*`, JavaScript inside PDFs) is not included:
neoAFP never runs JavaScript from PDFs (`enableScripting: false`, `isEvalSupported: false`)
and pdf.js does not load it for rendering.

## ICU character set mapping data

The EBCDIC code page tables in `src/lib/codepages/tables/` are generated from the ICU
`icu-data` mapping files. Unicode License V3, text in
`src/lib/codepages/tables/LICENSE-ICU-DATA.txt`; source revision in `SOURCE.md` there.

## Barcode Writer in Pure PostScript (BWIPP)

Tables in `src/lib/bcoca/symbologies/` (PDF417 codeword patterns, GS1 application
identifiers, MaxiCode, postal bar codes) are taken from BWIPP (`barcode.ps`, as distributed
with bwip-js 4.5.1). Copyright (c) 2004-2024 Terry Burton, MIT License; the copyright and
permission notice is repeated in each file that contains such tables (`pdf417-patterns.js`,
`gs1-ai.js`, `maxicode.js`, `postal.js`). `linear.js` only follows BWIPP for the Code 2 of 5
start and stop patterns, which are fixed by the symbology.

## Not third-party

The interface icons, the neoAFP logos and favicon, and the language flags in
`src/viewer/assets/` were drawn for neoAFP (flags from the official geometry and colors, see
`src/viewer/assets/flags/SOURCE.md`) and fall under the project license.

## Zint

GS1 DataBar (`databar.js`), Han Xin Code (`hanxin.js`) and the 4-state Royal Mail Mailmark
(`postal.js`) in `src/lib/bcoca/symbologies/` are ported from Zint 2.16.0 (`backend/rss.c`,
`general_field.c`, `hanxin.c`, `mailmark.c`). Copyright (C) 2008-2025 Robin Stuart, BSD 3-Clause
License; the full notice is repeated in each of these files.
