/**
 * Synthetic fixture (task T041): presentation text in a raster font.
 *
 * The inline resource group holds the 240-dpi raster font character set and code page of
 * tests/helpers/fixture-text.js (glyphs A, B, C and space; FND, FNC, FNO, FNP, FNI, FNM, FNG and
 * CPD, CPC, CPI). The page maps them with a Map Coded Font (format 2) and writes text with
 * absolute and relative moves (AMI, AMB, RMI, RMB, BLN with SIM and SBI), the four text
 * orientations (STO 0°, 90°, 180°, 270°) and colors (STC, SEC RGB).
 *
 * The expectations record each glyph run's position, rotation, color, text and character
 * advances. They agree with the values worked out from the font metrics: every glyph advances
 * 24 font units = 24/240 inch = 144 page units; rotated text counts I and B from the corner of
 * the text space where its directions start.
 *
 * Running this module directly writes us1-text.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, uint, documentOf, group, resourceGroup, ID } from '../../helpers/afp-builder.js';
import {
  fontCharacterSet, codePage, mapCodedFont, AMI, AMB, RMI, RMB, SBI, SIM, BLN, SCFL, TRN, STC, STO, SEC_RGB,
} from '../../helpers/fixture-text.js';

/** The page content (positions in 1/1440 inch). */
const TEXT = bytes(
  SCFL(1), STO(0), SIM(1440),
  AMB(1440), AMI(1440), TRN('ABC CAB'),
  SBI(360), BLN(), TRN('BAC'),
  RMB(360), RMI(720), STC(0x0002), TRN('CCC'),
  AMB(2880), AMI(1440), SEC_RGB(0x00, 0x80, 0x00), TRN('AB'), RMI(-144), TRN('A'),
  STC(0xff07),
  // Rotated orientations: I and B count from the corner of the text space that the directions
  // start from (90°: top right, 180°: bottom right, 270°: bottom left), page 11906 × 16838.
  STO(90), AMI(4320), AMB(11906 - 4320), TRN('ABC'), // page (4320, 4320), downwards
  STO(180), AMI(11906 - 7200), AMB(16838 - 8640), TRN('ABC'), // page (7200, 8640), leftwards
  STO(270), AMI(16838 - 10080), AMB(7200), TRN('ABC'), // page (7200, 10080), upwards
);

/**
 * Builds the file.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  const units = bytes(0x00, 0x00, uint(14400, 2), uint(14400, 2));
  const pageContent = bytes(
    group(ID.BAG, 'AEG1', mapCodedFont(), field(ID.PGD, bytes(units, uint(11906, 3), uint(16838, 3), uint(0, 3))),
      field(ID.PTD, bytes(units, uint(11906, 3), uint(16838, 3), uint(0, 2)))),
    group(ID.BPT, 'PT000001', field(ID.PTX, TEXT)),
  );
  return bytes(resourceGroup(fontCharacterSet(), codePage()),
    documentOf('TEXTDOC1', group(ID.BNG, 'GROUP001', group(ID.BPG, 'PAGE0001', pageContent))));
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us1-text.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us1-text.afp', import.meta.url), buildBytes());
}
