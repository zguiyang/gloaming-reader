// Composition root: load every parser implementation (side-effect registration)
// before exposing the orchestrator, so callers never wire parsers manually.
import '@/domains/ingest/parser/epub-parser';

export type { ContentWorkRow } from './service';
export { processContentWork } from './service';
