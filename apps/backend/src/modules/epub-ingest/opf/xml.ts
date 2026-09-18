import { XMLParser } from 'fast-xml-parser';

/** Minimal XML helpers with fast-xml-parser (attributes prefixed `@_`). */
export function parseXml(xml: string): unknown {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    parseTagValue: false,
    parseAttributeValue: false,
    isArray: (name) => name === 'item' || name === 'itemref' || name === 'navPoint' || name === 'dc:creator',
  });
  return parser.parse(xml);
}

export function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && '#text' in value && typeof value['#text'] === 'string') {
    return value['#text'];
  }
  return '';
}

/**
 * Recursively concatenate text from a fast-xml-parser value tree —
 * strings, `#text` nodes, nested objects and arrays (VersOne.Epub semantics:
 * `XElement.Value` joins all descendant text). Attribute keys (`@_*`) are
 * skipped. Handles `<dc:description><p>…</p></dc:description>` and deeper
 * nesting that `textOf` cannot see.
 *
 * Known parser boundary: fast-xml-parser object mode cannot preserve the
 * interleaving of `#text` and child elements inside mixed content (e.g.
 * `<p>First <em>sentence</em>.</p>`), so text order may be imperfect there.
 * Descendant text is still fully captured — strictly better than empty.
 */
export function textOfDeep(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    let out = '';
    for (const item of value) out += textOfDeep(item);
    return out;
  }
  if (value && typeof value === 'object') {
    let out = '';
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('@_')) continue;
      out += textOfDeep(child);
    }
    return out;
  }
  return '';
}

/** All metadata values whose local name (namespace prefix stripped) matches, case-insensitive. */
export function metadataValuesByLocalName(metadata: Record<string, unknown>, name: string): unknown[] {
  const target = name.toLowerCase();
  const out: unknown[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    const local = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
    if (local.toLowerCase() !== target) continue;
    if (Array.isArray(value)) out.push(...value);
    else out.push(value);
  }
  return out;
}

/** First value by local name (`dc:description` / `dcterms:description` / `description` / case variants). */
export function metadataByLocalName(metadata: Record<string, unknown>, name: string): unknown {
  return metadataValuesByLocalName(metadata, name)[0];
}
