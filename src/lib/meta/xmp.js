/**
 * XMP metadata (FR-038, research R13): a small XML parser (no DOMParser, so it runs in workers
 * and Node.js), the RDF/XML property reader, and the Metadata Object header.
 *
 * - XML: elements, attributes, text, CDATA, comments, processing instructions, the five
 *   predefined entities and character references; anything else is an error.
 * - XMP (Adobe XMP Specification Part 1, RDF serialization): every rdf:Description gives
 *   properties from its attributes (except rdf:, xml: and xmlns attributes) and its child
 *   elements: simple values (text or rdf:resource), arrays (rdf:Bag, rdf:Seq, rdf:Alt with the
 *   xml:lang of Alt items), and structures (rdf:parseType="Resource" or a nested
 *   rdf:Description), whose fields are named "parent/field".
 * - Metadata Object (MOCA Reference AFPC-0013-02, Table 4 "MO Syntax"): MOLength, HeaderLength,
 *   MOType, MOFormat, MOCompression (NONE, GZIP; EXI is not supported), MOName, MOData.
 */

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * @typedef {object} XmlElement
 * @property {string} name Qualified name.
 * @property {[string, string][]} attrs Attributes in order.
 * @property {(XmlElement|string)[]} children Child elements and text.
 */

/**
 * Replaces entity and character references.
 * @param {string} s Text with references.
 * @returns {string} Text.
 */
function unescape(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);?/g, (m, ref) => {
    if (!m.endsWith(';')) throw new Error(`unterminated reference ${m}`);
    if (ref[0] === '#') return String.fromCodePoint(ref[1] === 'x' ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1)));
    if (!(ref in ENTITIES)) throw new Error(`unknown entity &${ref};`);
    return ENTITIES[ref];
  });
}

/**
 * Parses XML into an element tree.
 * @param {string} text XML text.
 * @returns {XmlElement} Root element.
 * @throws {Error} If the text is not well-formed XML.
 */
export function parseXml(text) {
  const stack = [{ name: '#document', attrs: [], children: [] }];
  let pos = 0;
  const top = () => stack[stack.length - 1];
  const until = (end, what) => {
    const i = text.indexOf(end, pos);
    if (i < 0) throw new Error(`unterminated ${what} at ${pos}`);
    const s = text.slice(pos, i);
    pos = i + end.length;
    return s;
  };
  while (pos < text.length) {
    if (text.startsWith('<?', pos)) { pos += 2; until('?>', 'processing instruction'); continue; }
    if (text.startsWith('<!--', pos)) { pos += 4; until('-->', 'comment'); continue; }
    if (text.startsWith('<![CDATA[', pos)) { pos += 9; top().children.push(until(']]>', 'CDATA section')); continue; }
    if (text.startsWith('<!', pos)) { pos += 2; until('>', 'declaration'); continue; }
    if (text.startsWith('</', pos)) {
      pos += 2;
      const name = until('>', 'end tag').trim();
      const open = stack.pop();
      if (stack.length === 0 || open.name !== name) throw new Error(`end tag </${name}> does not match <${open.name}>`);
      continue;
    }
    if (text[pos] === '<') {
      const m = /^<([^\s/>]+)/.exec(text.slice(pos, pos + 256));
      if (!m) throw new Error(`invalid tag at ${pos}`);
      pos += m[0].length;
      const el = { name: m[1], attrs: [], children: [] };
      for (;;) {
        const ws = /^\s*/.exec(text.slice(pos, pos + 64))[0];
        pos += ws.length;
        if (text.startsWith('/>', pos)) { pos += 2; top().children.push(el); break; }
        if (text[pos] === '>') { pos += 1; top().children.push(el); stack.push(el); break; }
        const a = /^([^\s=/>]+)\s*=\s*(["'])/.exec(text.slice(pos, pos + 256));
        if (!a || ws.length === 0) throw new Error(`invalid attribute at ${pos}`);
        pos += a[0].length;
        el.attrs.push([a[1], unescape(until(a[2], 'attribute value'))]);
      }
      continue;
    }
    const next = text.indexOf('<', pos);
    const raw = text.slice(pos, next < 0 ? text.length : next);
    pos = next < 0 ? text.length : next;
    if (stack.length === 1) {
      if (raw.replace(/^﻿/, '').trim()) throw new Error('text outside the root element');
    } else {
      top().children.push(unescape(raw));
    }
  }
  if (stack.length !== 1) throw new Error(`element <${top().name}> is not closed`);
  const roots = stack[0].children.filter((c) => typeof c !== 'string');
  if (roots.length !== 1) throw new Error('no single root element');
  return roots[0];
}

/**
 * Resolves the namespace of every element and attribute (xmlns declarations).
 * @param {XmlElement} el Element.
 * @param {Map<string, string>} scope Prefix → URI of the enclosing elements.
 * @returns {object} Element with `ns`, `prefix`, `local`, resolved `attrs` and `children`.
 */
function resolve(el, scope) {
  const inner = new Map(scope);
  for (const [name, value] of el.attrs) {
    if (name === 'xmlns') inner.set('', value);
    else if (name.startsWith('xmlns:')) inner.set(name.slice(6), value);
  }
  const split = (qname, isAttr) => {
    const i = qname.indexOf(':');
    const prefix = i < 0 ? '' : qname.slice(0, i);
    const local = i < 0 ? qname : qname.slice(i + 1);
    const ns = prefix === 'xml' ? XML_NS : (isAttr && !prefix ? null : inner.get(prefix) ?? null);
    return { prefix, local, ns };
  };
  return {
    ...split(el.name, false),
    attrs: el.attrs.filter(([n]) => n !== 'xmlns' && !n.startsWith('xmlns:')).map(([n, value]) => ({ ...split(n, true), value })),
    children: el.children.map((c) => (typeof c === 'string' ? c : resolve(c, inner))),
  };
}

/**
 * Child elements of an element (without text).
 * @param {object} el Resolved element.
 * @returns {object[]} Child elements.
 */
const elements = (el) => el.children.filter((c) => typeof c !== 'string');
/**
 * Text content of an element and its descendants.
 * @param {object} el Resolved element.
 * @returns {string} Text.
 */
const textOf = (el) => el.children.map((c) => (typeof c === 'string' ? c : textOf(c))).join('');
/**
 * Tells whether a node is a given RDF element.
 * @param {object} node Resolved element.
 * @param {string} local Local name, e.g. "Bag".
 * @returns {boolean} True if it is rdf:<local>.
 */
const isRdf = (node, local) => node.ns === RDF && node.local === local;
/**
 * Value of an attribute by namespace and local name.
 * @param {object} el Resolved element.
 * @param {string|null} ns Namespace URI.
 * @param {string} local Local name.
 * @returns {string|undefined} Value.
 */
const attr = (el, ns, local) => el.attrs.find((a) => a.ns === ns && a.local === local)?.value;

/**
 * Reads the properties of an rdf:Description (or a structure) into a list.
 * @param {object} desc Resolved element.
 * @param {string} path Name prefix for structure fields ("" at top level).
 * @param {object[]} out Properties.
 * @returns {void}
 */
function readDescription(desc, path, out) {
  for (const a of desc.attrs) {
    if (a.ns === RDF || a.ns === XML_NS || a.ns === null) continue;
    out.push({ namespace: a.ns, prefix: a.prefix, name: path + a.local, value: a.value });
  }
  for (const prop of elements(desc)) readProperty(prop, path, out);
}

/**
 * Reads one property element.
 * @param {object} prop Resolved property element.
 * @param {string} path Name prefix.
 * @param {object[]} out Properties.
 * @returns {void}
 */
function readProperty(prop, path, out) {
  const base = { namespace: prop.ns, prefix: prop.prefix, name: path + prop.local };
  const resource = attr(prop, RDF, 'resource');
  if (resource !== undefined) { out.push({ ...base, value: resource }); return; }
  if (attr(prop, RDF, 'parseType') === 'Resource') { readDescription(prop, `${base.name}/`, out); return; }
  const [first] = elements(prop);
  if (first && ['Bag', 'Seq', 'Alt'].some((k) => isRdf(first, k))) {
    const items = elements(first).filter((li) => isRdf(li, 'li'));
    const entry = { ...base, arrayType: first.local, values: items.map((li) => attr(li, RDF, 'resource') ?? textOf(li)) };
    const langs = items.map((li) => attr(li, XML_NS, 'lang') ?? null);
    if (first.local === 'Alt' && langs.some((l) => l !== null)) entry.languages = langs;
    out.push(entry);
    return;
  }
  if (first && isRdf(first, 'Description')) { readDescription(first, `${base.name}/`, out); return; }
  out.push({ ...base, value: textOf(prop) });
}

/**
 * Reads the properties of an XMP packet.
 * @param {string} rawText XMP text (with or without xpacket wrapper).
 * @param {(d: {severity: string, code: string, params: object}) => void} [report] Records a
 *   diagnostic when the text is not well-formed XML.
 * @returns {{rawText: string, properties: object[]}} The original text and the properties
 *   ({namespace, prefix, name, value} or {…, arrayType, values[, languages]}).
 */
export function parseXmp(rawText, report = () => {}) {
  let root;
  try {
    root = resolve(parseXml(rawText), new Map([['xml', XML_NS]]));
  } catch (e) {
    report({ severity: 'warning', code: 'decodeFailed', params: { reason: `XMP: ${e.message}` } });
    return { rawText, properties: [] };
  }
  const properties = [];
  const walk = (el) => {
    if (isRdf(el, 'Description')) readDescription(el, '', properties);
    else elements(el).forEach(walk);
  };
  walk(root);
  return { rawText, properties };
}

/**
 * Reads a fixed-length UTF-16BE field padded with "@" (MOCA).
 * @param {Uint8Array} d Bytes.
 * @param {number} at Position.
 * @param {number} n Field length in bytes.
 * @returns {string} Text without the padding.
 */
function utf16Field(d, at, n) {
  let s = '';
  for (let i = at; i + 1 < at + n && i + 1 < d.length; i += 2) s += String.fromCharCode((d[i] << 8) | d[i + 1]);
  return s.replace(/@+$/, '');
}

/**
 * Decodes XML bytes (UTF-8 unless a UTF-16 byte order mark is present).
 * @param {Uint8Array} d Bytes.
 * @returns {string} Text.
 */
export function decodeXmlBytes(d) {
  if (d[0] === 0xfe && d[1] === 0xff) return new TextDecoder('utf-16be').decode(d.subarray(2));
  if (d[0] === 0xff && d[1] === 0xfe) return new TextDecoder('utf-16le').decode(d.subarray(2));
  return new TextDecoder('utf-8').decode(d);
}

/**
 * Inflates GZIP data with the platform's DecompressionStream (browsers and Node.js).
 * @param {Uint8Array} d GZIP bytes.
 * @param {'gzip'|'deflate'} [format] Format.
 * @returns {Promise<Uint8Array>} Inflated bytes.
 */
export async function inflate(d, format = 'gzip') {
  const stream = new Blob([d]).stream().pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Reads a Metadata Object.
 * @param {Uint8Array} d MO bytes (the object container data).
 * @returns {Promise<{name: string, type: string, format: string, compression: string, rawText: string}>}
 *   Header values and the metadata text.
 * @throws {Error} If the header is invalid or the compression is not supported.
 */
export async function readMetadataObject(d) {
  if (d.length < 50) throw new Error('metadata object shorter than its header');
  const headerLength = (d[4] << 8) | d[5];
  if (headerLength < 46 || 4 + headerLength > d.length) throw new Error(`invalid MO header length ${headerLength}`);
  const nameLength = (d[48] << 8) | d[49];
  const compression = utf16Field(d, 20, 20);
  let data = d.subarray(4 + headerLength);
  if (compression === 'GZIP') data = await inflate(data);
  else if (compression !== 'NONE') throw new Error(`metadata compression ${compression} not supported`);
  return {
    name: utf16Field(d, 50, Math.min(nameLength, headerLength - 46)),
    type: utf16Field(d, 6, 6),
    format: utf16Field(d, 12, 8),
    compression,
    rawText: decodeXmlBytes(data),
  };
}
