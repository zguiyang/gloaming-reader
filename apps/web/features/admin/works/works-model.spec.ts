import { describe, expect, it } from 'vitest';

import { canPreviewWork } from './works-model';

describe('canPreviewWork', () => {
  it('allows preview when chapters exist and workflow is not blocking', () => {
    expect(canPreviewWork({ status: 'parsed', partCount: 3 })).toBe(true);
    expect(canPreviewWork({ status: 'ready', parts: [{}, {}] })).toBe(true);
    expect(canPreviewWork({ status: 'published', partCount: 1 })).toBe(true);
  });

  it('blocks preview without chapters or during blocking workflow states', () => {
    expect(canPreviewWork({ status: 'parsed', partCount: 0 })).toBe(false);
    expect(canPreviewWork({ status: 'uploaded', partCount: 2 })).toBe(false);
    expect(canPreviewWork({ status: 'processing', partCount: 2 })).toBe(false);
    expect(canPreviewWork({ status: 'metadata', partCount: 2 })).toBe(false);
    expect(canPreviewWork({ status: 'failed', partCount: 2 })).toBe(false);
  });
});
