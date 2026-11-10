import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Design guards for selection/focus indicators (DESIGN.md «Selection & focus
 * indicators»).
 *
 * Why these rules exist: drawing a "selected" state with a single-side border
 * on a rounded element makes the border follow the corner radius — it reads as
 * a U or a bracket, and it shifts the box when the state toggles. The rules
 * below keep that pattern (and the two related focus/underline regressions) out
 * of the app now that the shared primitives are out of bounds for routine fixes.
 *
 * Fixes belong in one of two places:
 *   1. usage-site Tailwind classes (square `before:`/`after:` bars, conditional
 *      `after:opacity-100`), or
 *   2. the attribute-scoped theme-layer override block at the end of
 *      `apps/web/app/globals.css` (justify each entry).
 *
 * Extend the allowlist only with a comment explaining why the exception is
 * structural (not an indicator).
 */

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// App/feature surfaces only. `components/ui` is the shared primitive layer: it is
// out of bounds for routine visual fixes and its recipe changes require explicit
// authorization, so the guard does not police it (the Tabs recipe legitimately
// owns the `-5px` indicator offset).
const scanRoots = ['features'].map((dir) => path.join(webRoot, dir));

/** Single-side border with 2px+ (or arbitrary) width — the U/bracket pattern. */
const SIDE_BORDER_INDICATOR = /border-(?:t|b|l|r)-(?:[2-9]|\[)/;
/** A colored focus border stacked under an offset ring reads as two rings. */
const FOCUS_BORDER = /focus-visible:border-(?!transparent)/;
const FOCUS_RING_OFFSET = /focus-visible:ring-offset/;
/** The shared Tabs recipe owns indicators; consumers must not re-offset them. */
const TAB_INDICATOR_OFFSET = /after:bottom-\[-5px\]/;

const ALLOWLIST = new Set<string>();

function collectTsx(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map((entry) => String(entry))
    .filter((entry) => entry.endsWith('.tsx'))
    .map((entry) => path.join(dir, entry));
}

type Violation = { file: string; line: number; rule: string; text: string };

function scan(): Violation[] {
  const violations: Violation[] = [];

  for (const file of scanRoots.flatMap(collectTsx)) {
    const relative = path.relative(webRoot, file);
    if (ALLOWLIST.has(relative)) continue;

    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, index) => {
        const line = index + 1;
        if (SIDE_BORDER_INDICATOR.test(text)) {
          violations.push({ file: relative, line, rule: 'single-side border indicator', text: text.trim() });
        }
        if (FOCUS_BORDER.test(text) && FOCUS_RING_OFFSET.test(text)) {
          violations.push({
            file: relative,
            line,
            rule: 'double focus ring (border + offset ring)',
            text: text.trim(),
          });
        }
        if (TAB_INDICATOR_OFFSET.test(text)) {
          violations.push({
            file: relative,
            line,
            rule: 'consumer overrides the shared tab indicator offset',
            text: text.trim(),
          });
        }
      });
  }

  return violations;
}

describe('selection and focus indicators', () => {
  it('never draws a selected state with a single-side border', () => {
    const violations = scan().filter((entry) => entry.rule === 'single-side border indicator');
    expect(violations, format(violations)).toEqual([]);
  });

  it('never stacks a colored focus border with an offset focus ring', () => {
    const violations = scan().filter((entry) => entry.rule === 'double focus ring (border + offset ring)');
    expect(violations, format(violations)).toEqual([]);
  });

  it('leaves the shared tab indicator offset to the shared Tabs recipe', () => {
    const violations = scan().filter((entry) => entry.rule === 'consumer overrides the shared tab indicator offset');
    expect(violations, format(violations)).toEqual([]);
  });

  it('keeps the filled-control single focus ring override in the theme layer', () => {
    const globals = readFileSync(path.join(webRoot, 'app/globals.css'), 'utf8');
    expect(globals).toContain("[data-appearance='filled']:focus-visible");
  });

  it('keeps the dialog scrim override in the theme layer', () => {
    const globals = readFileSync(path.join(webRoot, 'app/globals.css'), 'utf8');
    expect(globals).toContain("[data-slot='dialog-overlay']");
  });
});

function format(violations: Violation[]): string {
  if (violations.length === 0) return '';
  return violations.map((entry) => `${entry.file}:${entry.line} ${entry.rule} -> ${entry.text}`).join('\n');
}
