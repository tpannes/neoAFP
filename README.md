# neoAFP

A modern, web-based viewer for AFP (Advanced Function Presentation, MO:DCA) documents and their
resources: AFP files, page segments, overlays and fonts. Everything runs in the browser; files
never leave your device — there is no server component, no upload and no request to other sites.

## How neoAFP was built

neoAFP was created 100 % by AI: all code, tests and documentation were written by Claude Opus
(Anthropic), guided by me. After a fair amount of vibe coding, it is my first project built
with spec-driven development (SDD), using GitHub Spec Kit.

In spec-driven development the specification comes first and stays the reference for everything
else: requirements are written down and clarified before any code exists, then turned into a
technical plan and a list of small, ordered tasks that the AI implements one by one. Compared
with vibe coding, this has the following advantages:

- **A shared source of truth.** Requirements are numbered and precise, so the AI and I always
  mean the same thing, and every change can be traced from requirement to code and test.
- **Consistency across many sessions.** A large project outlives any single conversation; the
  spec, the plan and the task list carry the decisions from one session to the next.
- **Fewer repeated mistakes.** Every bug fix and design decision is written into the task list,
  so a later change or a fresh implementation does not fall into the same trap again.
- **Tests that follow the spec.** Expectations are derived from the requirements and the
  published AFP references, not from what the code happens to do.
- **Scope under control.** What is in, what is out and what is blocked is decided in the spec,
  not discovered halfway through the code.

## Features

- **Open AFP data your way.** Drop files or a whole folder onto the window, or use the Open
  buttons. When you open a folder, neoAFP finds the fonts, overlays, page segments and form
  definitions the documents need by itself, even in 240, 300 and 600 dpi copies, and tells you
  at once which resources are missing. Add them later and the pages are redrawn. Files of
  several hundred megabytes open quickly; only the pages you look at are drawn.
- **See the pages as they will be printed.** Text, fonts, images, graphics, bar codes, overlays
  and embedded PDFs appear as on paper. Duplex sheets show front and back side by side, N-up
  sheets show all their pages, or you switch to one page after another. Scroll through the
  whole document, jump to a page, use the thumbnails, and zoom to the page, to its width or to
  100 %.
- **Know what is on a page.** The Details panel shows the file at a glance (documents, page
  groups, form definition, missing resources) and everything about the current page: size,
  sheet and side, print settings such as bins and copies, fonts, overlays, page segments,
  objects and index values.
- **Find text.** Search the text of all pages; neoAFP ignores case and accents, tolerates up to
  two typos per word and highlights every match on the page.
- **Trace any element to its source.** Click text, an image or a line on the page and the
  structure view opens on the structured field that drew it, even when it comes from an overlay
  or page segment in another file. The other way round, any field can show you where it lands
  on the page.
- **Look inside the data stream.** The structure view shows every structured field and triplet
  as a tree, with decoded parameters and the raw bytes in hex. Find fields by name or
  identifier, jump to a byte offset, group long runs of like items, and choose the code page
  for text where the file does not say.
- **Work with index values and comments.** TLEs appear as a table with one row per page group
  and one column per index name; NOPs as a list with their page, encoding and text. Sort,
  filter, hide columns or ISIS Papyrus tagging records, and export both as JSON or CSV.
- **Explore resources.** The Resource Explorer shows every font, overlay, page segment, image,
  form definition and color profile of the open files as previews or as a list. Filter by type,
  content, size, resolution, font or encoding, look at character sets and code page tables, see
  each medium map of a form definition as a diagram, and download any resource with its exact
  original bytes, a preview as PNG or TIFF, or the whole list as CSV.
- **Take pages with you.** Save the current page as a PNG or TIFF image, or as plain text in
  reading order.
- **Use it in your language.** The interface speaks English, German, French, Spanish, Italian,
  Dutch, Simplified Chinese and Japanese, follows your browser's language, and has a light and
  a dark theme.

## Supported formats

| Area | Supported |
|---|---|
| Data stream | MO:DCA-P documents and resource files (with or without record separators); inline and external resource groups; resources found by file name or by the name in their Begin field, by resolution (240/300/600 dpi copies) |
| Text | PTOCA presentation text; raster, Type 1 and CID-keyed font character sets; TrueType/OpenType fonts as files or embedded in object containers; EBCDIC (Latin, Japanese, Simplified Chinese), ASCII/ANSI and Unicode code pages |
| Images | IOCA (uncompressed, IBM MMR, G3 MH/MR, G4 MMR, TIFF algorithm 2, TIFF LZW (also with predictor), TIFF PackBits, JPEG; tiles, transparency masks, color spaces), IM images, JPEG, PNG, GIF and TIFF in object containers |
| Graphics | GOCA for AFP (lines with line types, ends and joins, boxes, arcs, curves, areas with fill patterns, custom patterns, linear and radial gradients and boundary lines, markers, character strings in AFP fonts with angle and direction, images) |
| Bar codes | BCOCA: Code 39, Code 93, Code 128 (with GS1 HRI), Codabar, MSI, Industrial/Matrix/Interleaved 2-of-5, UPC/EAN with supplements, POSTNET/PLANET, RM4SCC/KIX, Intelligent Mail, Japan Post, Australia Post, Royal Mail Mailmark, GS1 DataBar (all variants), Data Matrix, QR Code (also with image), PDF417 (also Macro PDF417), MaxiCode, Aztec, Han Xin |
| Embedded objects | PDF pages (pdf.js, bundled), images and fonts in object containers |
| Print control | Form definitions (medium maps, duplex, N-up, medium overlays, copies, bins, media types) |
| Metadata | TLE, NOP; XMP (Metadata Objects and XMP embedded in JPEG, PNG, TIFF, PDF), Color Management Resources and ICC profiles are read by the library |

## Known gaps

- IOCA compressions RL4, ABIC, concatenated ABIC, JBIG2 and the OS/2 Image Support color
  compression are not decoded, nor TIFF LZW with predictor for bilevel images: such images show a
  placeholder and a diagnostic.
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
