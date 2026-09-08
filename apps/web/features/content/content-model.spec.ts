import { describe, expect, it } from 'vitest';

import { paragraphsFromBody } from '@/features/content/content-model';

describe('paragraphsFromBody', () => {
  it('splits on blank lines', () => {
    expect(paragraphsFromBody('One.\n\nTwo.\n\n\nThree.')).toEqual(['One.', 'Two.', 'Three.']);
    expect(paragraphsFromBody('   ')).toEqual([]);
  });
});
