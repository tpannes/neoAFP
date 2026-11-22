/**
 * Synthetic fixture (task T048): object containers placed on a page (Begin Object Container with
 * an object environment group, Object Container Data, MO:DCA "Object Container"):
 * 1. a one-page PDF (1 × 0.5 inch, a green rectangle) → item 'pdf';
 * 2. JPEG, 3. PNG, 4. GIF (32 × 24 color gradient) → item 'image';
 * 5. a baseline TIFF with G4 compression (64 × 48, 240 dpi) → item 'image', decoded bilevel;
 * 6. data in a format neoAFP does not show (a Windows bitmap header) → placeholder + diagnostic.
 * There is no Map Container Data, so the architected default mapping "scale to fit" applies
 * (MO:DCA, MCD semantics): the 32 × 24 images fill their 4:3 areas. Formats are recognized from
 * the data (file signatures). TrueType/OpenType fonts in object containers are not part of
 * this fixture.
 *
 * The images were made with Pillow from synthetic content; the PDF was written by hand.
 *
 * Running this module directly writes us1-object-containers.afp next to it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { bytes, field, uint, ebcdic, triplet, documentOf, page, group, ID, MAX_FIELD_DATA } from '../../helpers/afp-builder.js';

const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
export const PDF = b64(
  'JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5' +
  'cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVu' +
  'dCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA3MiAzNl0gL0NvbnRlbnRzIDQgMCBSIC9SZXNvdXJjZXMgPDwgPj4gPj4KZW5kb2Jq' +
  'CjQgMCBvYmoKPDwgL0xlbmd0aCAyNSA+PgpzdHJlYW0KMCAwLjUgMCByZyA2IDYgNjAgMjQgcmUgZgplbmRzdHJlYW0KZW5k' +
  'b2JqCnhyZWYKMCA1CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4g' +
  'CjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDIxNyAwMDAwMCBuIAp0cmFpbGVyCjw8IC9TaXplIDUgL1Jvb3QgMSAwIFIg' +
  'Pj4Kc3RhcnR4cmVmCjI5MgolJUVPRgo=');
const JPEG = b64(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQ' +
  'ERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQU' +
  'FBQUFBQUFBQUFBQUFBT/wAARCAAYACADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAA' +
  'AgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6' +
  'Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXG' +
  'x8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREA' +
  'AgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5' +
  'OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPE' +
  'xcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD4e0nwT0/d/pXZ6T4J+7+7/SvStJ8E9P3f' +
  '6V2ek+Cen7v9K/TcZn2+p8/w3xN8PvHmuk+Cfu/u/wBK7PSfBX3f3f6V6VpPgrp+7/Suz0nwV0/d/pXw2Mz7fU/qvhvib4fe' +
  'MPSfBP3f3f6V2ek+Cfu/u/0oor4HGYytrqf5e8N5hiPd1Oz0nwV9393+ldnpPgr7v7v9KKK+GxmMra6n9V8N5hiPd1P/2Q==');
const PNG = b64(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAYCAIAAAAUMWhjAAAAwElEQVR4nLXU2Q6DIBBA0bGd7jtSbG1M//8H+2oTKAnI4kAh' +
  'OQ8Dxtyg0QZG2EJFCB8AaOpBHVhUgkZgWQPaASwOncCqLPQF1gVhILApBcOBMl8CRgO7/80G9rkGNVAChxT9ZIcYOBI8vPv0' +
  'wClMRK4mBc4O7tu0pAYuhtZe+mUErhLTw4y8wI0uI8DknYzmnRpo9QmYnCMGNSQFuPGIVID7vMxl9jtgOnC39ZMdekCEA0J7' +
  'GvNPkRMIgE7+KjrXFwCiMnIkUw72AAAAAElFTkSuQmCC');
const GIF = b64(
  'R0lGODdhIAAYAIcAAPD/APD1Htz6DvDrPNzrN/DhWtzhU8j/AMj1Gbj6DMTrMcThSvDXePDNltzSfPDDtNzDpcjXZMjNfbjS' +
  'aMTDk6j/AKj1FZT6CajrKpTrJYD/AID1EIDrIKjhP5ThOIDhMKjXVKjNaZTSU6jDfpTDb4DXQIDNUIDDYPC50vCv8Nyv3Nyl' +
  '+Myq2byl1MCb8NS5uvibNry0sPClDuybJ9ibDuyMU+CMQdiRKciMIL2KFKi5k6ivqJS0i6ilvZSlp4C5cICvgIClkKib0pSb' +
  'uYCboKiR56SH9pKK1oSMvWj/AGj1DVT6BWjrGlTrFUD/AED1CEDrEGjhJ1ThIEDhGCj/ACj1BRj6AiTrCQj/AAj1AQjrAiTh' +
  'DgjhA2jXNGjNQVTSL2jDTlTDP0DXIEDNKEDDMCjXFCjNGRjSDiTDGwjXBAjNBQjDBmi5W2ivaFS0T2ildVSlX0C5OECvQECl' +
  'SGibglSbaUCbUGiRj2iHnFSMeUCRWECHYCi5IyivKBi0FySlKQi5BwivCAilCSSbLQibCiiRNyiHPBiMIwiRCwiHDPR9jfBz' +
  'pPBpwtpskuxf2NBfoN57cNB4X8h4Urx4PcBpaLxfeOZT8NhQ2cpOwPBQDbtSlJN69IRz535n8IB90KhiSax4Ip12DZxpJYxf' +
  'GKBPlJxQVY5TMn1OFdY60vAwbLw8yrwt7vIcsOwjifA8SeM+JOAtTNU6DNAtItAjPMwZS70cGKw8o506g6Qtr6gjzpQjl6QZ' +
  '2IwZk5BBVow3Xnw8LoQtW4AjYHwZZWh9qWhztlR4jmhpw1RpnkB9aEBzcEBpeGhf0FRfqEBfgGhV3WhL6lRQuEBViEBLkCh9' +
  'QShzRhh4KSRpRAh9DQhzDghpDyRfSAhfEChVVShLWhhQNQhVEQhLEmBB5Fw35kw8uVQt3VQj51AZ5kMgujw8kjwtnm06DWwt' +
  'HG0cNjgenmMgEyhBXyg3ZBg8OyQtXwhBEwg3FAgtFSwjeSgZcxsgSggjFggZFwAAAAAAAAAAAAAAAAAAACwAAAAAIAAYAEAI' +
  '/wCxCLRCpaCTg0uWJFmooeGFCxUiJjhAUYAAABgDafTTp6Ocj27ctBkJpCQPHjtSxojBgoUKFSlibpvpTZs2bsqaRWPGzNgy' +
  'Z51GCRX16ROlSpUeKWXkyJGlNFDPlJkqpuqXL12yltgqQgSIrxMiiHXggIHZRGgPGVqrZw+yPHnu4BmGBImnI0eMGMmRAwcO' +
  'GzZqCFZEj168ePLg2UOXbtw4ceLUrfv1y5evW7ds4VK1alUsWa9cuUqlpfSV01egqG7ShIlrDrAzZMBAW4FtBQQIDNi9pjea' +
  '33zICA8TBozxE8hJkBjBnIJzChAgPJhOqPqhQYMK2dlepw6d70TCD/8ZIqS8i/M00s+YAQMbtmrVplGjhiyZsmLHhhEz5okT' +
  'p02hhALKJJNIEkkkkDSyyILggOONN9x080400kgDDTTOPPPMKaeYYkoppdyiiSaYYHLJJZZkkskr+bSIjzz32NPOOeeQU447' +
  '67ADTDDC6KILLrl0Vosss8CSSiutsJLFklZU4eQTUCakxJQbVPmQBVgmgMCWFgXgJRdgbiHmFlOUKYUUUaT5wZoeeNDBmwvE' +
  'uYABBhRgpxp4nmHGnmP0eZUXgJogaFchFDqBBIiS1cCigDTqBx+QxiFpSGxU+sOlJ+mg6UoxvOApCqAKIqoff5Q6x6lwwPHG' +
  'qkG06oMPPcTZ2kILLa2wggy4IqLrdYVo11YdedAhFxF1IXFEEci6wBcON9wQWA3XRAuffG4lU0wxcxHjSX+bACjggJIYCAkk' +
  'iiiSzbnVWGMNN/Y1c8wx+y3TybyjiEKUUUc1oiAj/H7jb00R6iQNM9D89Ewnp4zyIYiVjPiIiSimOM/E8UgIDzroOBZOOM+o' +
  'c8ovvfRyGSm2qKIKKpfEEktortTjMmLy2JNOOjWSI846kwEDzC0/AtnZZ0WmcqQ+ROODT4wznmOOOe6ww44wwvDCCy677LJK' +
  'LbXQQsuRSbISEAA7');
const TIFF = b64(
  'SUkqAJgAAACXBWMx0UP9kcFT2Rw2/ZHDa9kcG32RwbPZHBqPi7I4NPsjg0eyOGb7I4Znsjhl+yOGV7I4GPZHBpMx7I4NHsjh' +
  'm+yOGZ7I4ZfsjhleyOBj2RwL+yOC58XZHDHsjg/sjgnsjh/ZHC+yOE9kcT2RwwZj2Rwf2RwT2Rw/sjhfZHCeyOJ7I4vszF3/' +
  '///4jABABAAMAAABAwABAAAAQAAAAAEBAwABAAAAMAAAAAIBAwABAAAAAQAAAAMBAwABAAAABAAAAAYBAwABAAAAAQAAABEB' +
  'BAABAAAACAAAABYBAwABAAAAMAAAABcBBAABAAAAjwAAABoBBQABAAAALgEAABsBBQABAAAANgEAABwBAwABAAAAAQAAACgB' +
  'AwABAAAAAgAAAAAAAADwAAAAAQAAAPAAAAABAAAA');
const BMP = bytes(0x42, 0x4d, uint(62, 4), new Uint8Array(56));

/**
 * Builds an object container with an object area (width × height in 1/1440 inch).
 * @param {number} n Object number.
 * @param {Uint8Array} data Container data.
 * @param {number} x Area x.
 * @param {number} y Area y.
 * @param {number} w Area width.
 * @param {number} h Area height.
 * @returns {Uint8Array} Begin Object Container … End Object Container.
 */
function container(n, data, x, y, w, h) {
  const name = ebcdic(`OC${String(n).padStart(6, '0')}`, 8);
  const obd = bytes(triplet(0x43, 0x01), triplet(0x4b, 0x00, 0x00, uint(14400, 2), uint(14400, 2)),
    triplet(0x4c, 0x02, uint(w, 3), uint(h, 3)));
  const obp = bytes(0x01, 23, uint(x, 3), uint(y, 3), uint(0, 2), uint(0x2d00, 2), 0x00,
    uint(0, 3), uint(0, 3), uint(0, 2), uint(0x2d00, 2), 0x01); // RefCSys X'01': standard origin
  const parts = [];
  for (let pos = 0; pos < data.length; pos += MAX_FIELD_DATA) parts.push(field(ID.OCD, data.subarray(pos, pos + MAX_FIELD_DATA)));
  // Container Data Descriptor: bytes 0–11 retired (zero), no triplets.
  return bytes(field(ID.BOC, name), group('D3A8C7', 'OEG00001', field('D3A66B', obd), field('D3AC6B', obp)),
    field('D3A692', new Uint8Array(12)), ...parts, field(ID.EOC, name));
}

/**
 * Builds the file.
 * @returns {Uint8Array} AFP bytes.
 */
export function buildBytes() {
  return documentOf('OCDOC001', page('PAGE0001',
    container(1, PDF, 1440, 1440, 1440, 720),
    container(2, JPEG, 4320, 1440, 1440, 1080),
    container(3, PNG, 7200, 1440, 1440, 1080),
    container(4, GIF, 1440, 4320, 1440, 1080),
    container(5, TIFF, 4320, 4320, 384, 288),
    container(6, BMP, 7200, 4320, 1440, 1080),
  ));
}

/**
 * Builds the fixture.
 * @returns {Promise<{bytes: Uint8Array, expected: object}>} Bytes and expectations.
 */
export async function build() {
  const expected = JSON.parse(await readFile(new URL('./us1-object-containers.expected.json', import.meta.url), 'utf8'));
  return { bytes: buildBytes(), expected };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await writeFile(new URL('./us1-object-containers.afp', import.meta.url), buildBytes());
}
