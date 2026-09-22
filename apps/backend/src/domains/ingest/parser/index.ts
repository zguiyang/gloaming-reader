// Composition root: load every parser implementation (side-effect registration)
// before exposing the orchestrator, so callers never wire parsers manually.
import '@/domains/ingest/parser/epub-parser';

export type { ContentParsePersisted, ContentWorkRow, ParseWorkflowLease } from './service';
export { ParseWorkflowLeaseLostError, runContentParse, startParseWorkflowLease } from './service';
