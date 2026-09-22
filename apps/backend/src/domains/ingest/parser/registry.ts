import type { ContentParser } from './types';

const parsers = new Map<string, ContentParser>();

/** Register a parser implementation (called by each parser module on load). */
export function registerParser(parser: ContentParser): void {
  parsers.set(parser.kind, parser);
}

/** Resolve the parser for a work origin kind — unknown kinds fail fast. */
export function parserFor(kind: string): ContentParser {
  const parser = parsers.get(kind);
  if (!parser) {
    throw new Error(`No content parser registered for origin kind: ${kind}`);
  }
  return parser;
}
