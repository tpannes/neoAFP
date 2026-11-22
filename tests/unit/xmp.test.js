/**
 * XMP reader (T100, FR-038, research R13): properties from rdf:Description attributes and child
 * elements, rdf:Bag/Seq/Alt arrays, namespaces resolved from xmlns declarations, entities and
 * CDATA, nested structures; invalid XML keeps the raw text and reports a diagnostic. Also the
 * Metadata Object header (MOCA Reference AFPC-0013-02, Table 4 "MO Syntax").
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { parseXmp, readMetadataObject } from '../../src/lib/meta/xmp.js';
import { metadataObject } from '../helpers/fixture-meta.js';

const RDF = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
const DC = 'http://purl.org/dc/elements/1.1/';
const XMP = 'http://ns.adobe.com/xap/1.0/';

const PACKET = `<?xpacket begin="\u{feff}" id="W5M0MpCehiHzreSzNTczkc9d"?>
<!-- a comment -->
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="${RDF}">
  <rdf:Description rdf:about="" xmlns:dc="${DC}" xmlns:xmp="${XMP}" xmp:CreatorTool="neoAFP &amp; friends">
   <dc:creator><rdf:Seq><rdf:li>Alice</rdf:li><rdf:li>Bob</rdf:li></rdf:Seq></dc:creator>
   <dc:subject><rdf:Bag><rdf:li>afp</rdf:li><rdf:li>test</rdf:li></rdf:Bag></dc:subject>
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">Title &lt;one&gt;</rdf:li><rdf:li xml:lang="de">Titel</rdf:li></rdf:Alt></dc:title>
   <xmp:CreateDate>2026-11-07T10:00:00Z</xmp:CreateDate>
   <dc:source><![CDATA[a <raw> value]]></dc:source>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">
   <pdf:Producer>neoAFP &#x263A;</pdf:Producer>
   <pdf:Info rdf:parseType="Resource"><pdf:Version>1.7</pdf:Version></pdf:Info>
   <xmp:Rating xmlns:xmp="${XMP}" rdf:resource="urn:five"/>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

test('attributes, simple values, arrays, CDATA, entities, nested structures and resources', () => {
  const report = [];
  const xmp = parseXmp(PACKET, (d) => report.push(d));
  assert.equal(xmp.rawText, PACKET);
  assert.deepEqual(report, []);
  assert.deepEqual(xmp.properties, [
    { namespace: XMP, prefix: 'xmp', name: 'CreatorTool', value: 'neoAFP & friends' },
    { namespace: DC, prefix: 'dc', name: 'creator', arrayType: 'Seq', values: ['Alice', 'Bob'] },
    { namespace: DC, prefix: 'dc', name: 'subject', arrayType: 'Bag', values: ['afp', 'test'] },
    { namespace: DC, prefix: 'dc', name: 'title', arrayType: 'Alt', values: ['Title <one>', 'Titel'], languages: ['x-default', 'de'] },
    { namespace: XMP, prefix: 'xmp', name: 'CreateDate', value: '2026-11-07T10:00:00Z' },
    { namespace: DC, prefix: 'dc', name: 'source', value: 'a <raw> value' },
    { namespace: 'http://ns.adobe.com/pdf/1.3/', prefix: 'pdf', name: 'Producer', value: 'neoAFP ☺' },
    { namespace: 'http://ns.adobe.com/pdf/1.3/', prefix: 'pdf', name: 'Info/Version', value: '1.7' },
    { namespace: XMP, prefix: 'xmp', name: 'Rating', value: 'urn:five' },
  ]);
});

test('invalid XML keeps the raw text and reports decodeFailed', () => {
  const report = [];
  const broken = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description></x:xmpmeta>';
  const xmp = parseXmp(broken, (d) => report.push(d));
  assert.equal(xmp.rawText, broken);
  assert.deepEqual(xmp.properties, []);
  assert.equal(report.length, 1);
  assert.equal(report[0].code, 'decodeFailed');
});

test('Metadata Object header: name, type, format, compression and data (also GZIP)', async () => {
  const xml = '<x:xmpmeta xmlns:x="adobe:ns:meta/"/>';
  const plain = await readMetadataObject(metadataObject(xml, { name: 'Info' }));
  assert.deepEqual(plain, { name: 'Info', type: 'DES', format: 'XMP', compression: 'NONE', rawText: xml });
  const zipped = await readMetadataObject(metadataObject(null, { compression: 'GZIP', data: new Uint8Array(gzipSync(Buffer.from(xml))) }));
  assert.deepEqual(zipped, { name: '', type: 'DES', format: 'XMP', compression: 'GZIP', rawText: xml });
});
