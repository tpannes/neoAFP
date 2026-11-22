# neoAFP

A modern, web-based viewer for AFP (Advanced Function Presentation, MO:DCA) documents and their
resources: AFP files, page segments, overlays and fonts. Everything runs in the browser; files
never leave your device — there is no server component, no upload and no request to other sites.

## Features

- **AFP-Viewer** (the main screen): thumbnails on the left, the pages in the middle, a Details
  panel on the right with the file's metadata (documents, page groups, counts, form definition,
  missing resources) and the current page's (size, sheet and side, print settings, fonts,
  overlays, page segments, objects, index values). Pages as printed — text, images, graphics,
  bar codes, overlays, page segments and embedded objects — in one continuous scroll area,
  duplex sheets with front and back side by side as the form definition defines (duplex,
  tumble, N-up), or every page alone with the simplex button; zoom and page navigation; search
  in the page text (fuzzy: accents and case ignored, up to two typos per word) with matches
  highlighted; export of a page as PNG, TIFF or text; a switch that hides the test print (the
  word "TEST" drawn from lines). Missing resources are listed and filled in when the files are
  added; files of up to several hundred megabytes are read in the background.
- **TLE browser**: all index values as a table, one row per page group and one column per TLE
  name; sort, hide columns, search, export as JSON or CSV.
- **NOP browser**: all NOP records with offset, page, encoding (detected: EBCDIC 273,
  Windows-1252 or UTF-8) and text; hide the ISIS Papyrus `$ISIS_TAG` records; search, export.
- **Structure view**: every structured field in a tree (Begin/End pairs as branches, triplets
  below their field) with icons; Details with decoded parameters and triplets and the raw bytes
  in hex; find by name or identifier, jump to a byte offset; links from a page to its fields and
  back; code page choice for NOPs, TLEs and other text where they are shown.
- **Resource-Explorer**: all resources of the open files and folders as a grid with previews or as
  a sortable list; filters by name, type, content (text, IM or IOCA images, bar codes, page
  segments, no text …), dimensions, file size, font, resolution, color profile and encoding,
  kept between visits; a preview dialog with metadata; character grids of fonts and code page
  tables; coded fonts as sample text and character map by code point; form definitions as a
  diagram of each medium map with its print settings; download of the list as CSV, of a preview
  as PNG or TIFF and of the exact original bytes of any resource.
- **Languages**: English, German, French, Spanish, Italian, Dutch, Simplified Chinese and
  Japanese; the browser language is used when available.

## Supported formats

| Area | Supported |
|---|---|
| Data stream | MO:DCA-P documents and resource files (with or without record separators); inline and external resource groups; resources found by file name or by the name in their Begin field, by resolution (240/300/600 dpi copies) |
| Text | PTOCA presentation text; raster, Type 1 and CID-keyed font character sets; TrueType/OpenType fonts as files or embedded in object containers; EBCDIC (Latin, Japanese, Simplified Chinese), ASCII/ANSI and Unicode code pages |
| Images | IOCA (uncompressed, IBM MMR, G3 MH/MR, G4 MMR, TIFF LZW, TIFF PackBits, JPEG; tiles, transparency masks, color spaces), IM images, JPEG, PNG, GIF and TIFF in object containers |
| Graphics | GOCA for AFP (lines with line types, ends and joins, boxes, arcs, curves, areas with fill patterns, custom patterns, linear and radial gradients and boundary lines, markers, character strings in AFP fonts with angle and direction, images) |
| Bar codes | BCOCA: Code 39, Code 93, Code 128 (with GS1 HRI), Codabar, MSI, Industrial/Matrix/Interleaved 2-of-5, UPC/EAN with supplements, POSTNET/PLANET, RM4SCC/KIX, Intelligent Mail, Japan Post, Australia Post, Royal Mail Mailmark, GS1 DataBar (all variants), Data Matrix, QR Code (also with image), PDF417 (also Macro PDF417), MaxiCode, Aztec, Han Xin |
| Embedded objects | PDF pages (pdf.js, bundled), images and fonts in object containers |
| Print control | Form definitions (medium maps, duplex, N-up, medium overlays, copies, bins, media types) |
| Metadata | TLE, NOP; XMP (Metadata Objects and XMP embedded in JPEG, PNG, TIFF, PDF), Color Management Resources and ICC profiles are read by the library |

## Known gaps

- IOCA compressions RL4, ABIC, concatenated ABIC, JBIG2, TIFF algorithm 2, TIFF LZW with
  predictor and the OS/2 color compression are not decoded: such images show a placeholder and a
  diagnostic.
- Royal Mail RED TAG bar codes are not drawn (placeholder and diagnostic).
- Line data, mixed-mode data and page definitions are not supported: they are not part of
  MO:DCA (they are defined in IBM's line data reference; page definitions are usually built with
  PPFA). Such files are listed as not supported.
- GOCA gradients are interpolated in RGB, also when they are defined in CMYK or CIELAB.
- PTOCA: overstrike and the glyph runs for complex scripts are not drawn.
- Object containers other than PDF, JPEG, PNG, GIF, TIFF and TrueType/OpenType fonts (e.g. EPS,
  PCL, JPEG 2000) show a placeholder and a diagnostic.
- Only the first copy of a copy group is shown; N-up page positions are taken as positions on
  the sheet (no partition origins); an Include Page between pages is reported, not shown.
- Mixing rules, conditional page overlays and links (Link Logical Element) have no effect on the
  display.
- Color management resources and ICC profiles are listed as resources but not applied to colors.
- Stand-alone ICC profile files are not opened (only profiles inside AFP files are listed).
- The structure view shows a few fields raw: the retired Color Attribute Table fields, Page
  Position format 1, line-data page definition fields, and the FOCA Code Page Index and Font Name
  Map (their record layout depends on other fields).

## Requirements

- A current desktop browser (Chrome, Edge, Firefox or Safari)
- Node.js 24 or newer (LTS), only for running the tests
- Any static file server (ES modules and workers do not load from `file://`)

## Run the viewer

```sh
python3 -m http.server 8000     # any static file server works
# then open http://localhost:8000/
```

## Run the tests

```sh
node --test tests/
```

The tests in the repository use only synthetic files built by the tests themselves. Tests for
your own AFP documents can stay outside the repository: put them in a folder `tests/` next to
your documents and name that folder's parent in the environment variable `AFP_SAMPLES`
(e.g. `AFP_SAMPLES=~/afp-samples node --test tests/`). Every `*.test.js` there is then run too
(see `tests/conformance/local-tests.test.js`), and reference expectations in
`tests/reference/<name>/expected.json` are checked like the synthetic fixtures (see
`tests/conformance/fixtures.js`).

## Adding a language

1. Copy `src/viewer/locales/en.json` to `src/viewer/locales/<tag>.json` (a BCP 47 tag, e.g. `pt`).
2. Set `meta.tag`, `meta.name` (the language's own name, shown in the language menu) and
   `meta.direction` (`ltr` or `rtl`), and translate every value in `messages`. Keep every
   `{placeholder}` exactly as in English; numbers are formatted for the language automatically.
3. Add the tag to `languages` in `src/viewer/locales/index.json`.
4. Run `node --test tests/unit/locales.test.js`: it fails for missing texts or different
   placeholders.
5. If the language needs particular fonts, add a `:lang(<tag>)` font stack in
   `src/viewer/styles/base.css` (see Japanese and Simplified Chinese there).

## Third-party code

- [pdf.js](https://mozilla.github.io/pdf.js/) (Apache License 2.0), bundled in `vendor/pdfjs/`
  for embedded PDF pages, with its decoders and fonts under their own licenses.
- Code page tables generated from ICU data (Unicode License V3), see
  `src/lib/codepages/tables/SOURCE.md`.
- Bar code tables derived from BWIPP (MIT License), noted in the files that use them.
- GS1 DataBar, Han Xin and Royal Mail Mailmark encoders ported from Zint (BSD 3-Clause
  License), noted in the files that use them.

Details and license texts: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## License

Copyright (C) 2026 Timo Pannes

neoAFP is free software: you can redistribute it and/or modify it under the terms of the GNU
Affero General Public License as published by the Free Software Foundation, either version 3
of the License, or (at your option) any later version. It is distributed in the hope that it
will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY
or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.

If you run a modified version of neoAFP for others over a network (for example on a web
server), the license requires you to offer those users the source code of your version
(section 13).
