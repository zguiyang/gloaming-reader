import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

describe('Library tag management language labels', () => {
  const pageSource = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'library-tags-page.tsx'), 'utf8');

  it('shows friendly locale labels instead of raw BCP-47 tags in display and edit contexts', () => {
    // Display list and edit labels must go through localeLabel (locale endonyms), not raw identifiers.
    expect(pageSource).toMatch(/\{localeLabel\(language\)\}:\s*\{/);
    expect(pageSource).toMatch(/<span>\{localeLabel\(language\)\}<\/span>/);
    expect(pageSource).toMatch(/\(\$\{localeLabel\(language\)\}\)/);
    expect(pageSource).not.toMatch(/>\{language\}</);
  });

  it('keeps translation editing keyed by raw supported locale tags', () => {
    // Rename persistence and localizedNames lookups still use the locale identifiers.
    expect(pageSource).toMatch(/editingNames\[language\]/);
    expect(pageSource).toMatch(/tag\.localizedNames\?\.\[language\]/);
    expect(pageSource).toMatch(/renameUserTag\(tag\.id, name, language\)/);
  });
});
