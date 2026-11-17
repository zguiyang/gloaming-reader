/**
 * Domain-local failure for the Project Gutenberg snapshot pipeline.
 * Messages are written to be safe for `discovery_source.last_error_summary`:
 * they never include raw response bodies, credentials, stack traces, or URLs.
 */
export class GutenbergSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GutenbergSnapshotError';
  }
}
