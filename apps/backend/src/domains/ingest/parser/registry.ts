import type { ContentParser } from './types';

const parsers = new Map<string, ContentParser>();

/** Register a parser implementation (called by each parser module on load). */
export function registerParser(parser: ContentParser): void {
  parsers.set(parser.contentType, parser);
}

/** Resolve a parser by source asset format — unsupported formats fail fast. */
export function parserFor(contentType: string): ContentParser {
  const parser = parsers.get(contentType);
  if (!parser) {
    throw new Error(`No content parser registered for content type: ${contentType}`);
  }
  return parser;
}
