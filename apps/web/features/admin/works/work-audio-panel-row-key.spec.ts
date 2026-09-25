import { describe, expect, it } from 'vitest';

import { workAudioPartRowReactKey } from './work-audio-panel';

describe('workAudioPartRowReactKey', () => {
  it('includes voice role so US and UK rows are not reused', () => {
    const partId = 'part-abc';
    expect(workAudioPartRowReactKey('us', partId)).toBe('us:part-abc');
    expect(workAudioPartRowReactKey('uk', partId)).toBe('uk:part-abc');
    expect(workAudioPartRowReactKey('us', partId)).not.toBe(workAudioPartRowReactKey('uk', partId));
  });
});
