import { describe, expect, it } from 'vitest';

import { normalizePublicCategoryName, PUBLIC_CATEGORY_ASSIGNMENT_LIMIT } from '@gloaming/shared/discovery';

import {
  buildPublicCategory,
  decideCategoryAssignment,
  shouldSuppressOnRemoval,
  toPublicCategoryListItem,
  toPublicCategoryManagementItem,
} from '@/domains/discovery/categories/policy';

function categoryFixture() {
  return buildPublicCategory({
    id: 'cat-scifi',
    createdBy: 'manual',
    sourceLocale: 'en-US',
    meaning: 'Speculative fiction grounded in science or technology.',
    labels: [
      { locale: 'en-US', name: 'Science Fiction', editedBy: 'manual' },
      { locale: 'zh-CN', name: '科幻小说', editedBy: 'ai' },
    ],
    aliases: [{ locale: 'en-US', alias: 'Sci-Fi', editedBy: 'manual' }],
  });
}

describe('public category projection policy', () => {
  it('derives localized names and manual-protected locales from label rows', () => {
    const category = categoryFixture();
    expect(category.localizedNames).toEqual({ 'en-US': 'Science Fiction', 'zh-CN': '科幻小说' });
    expect(category.manualLocales).toEqual(['en-US']);
    expect(category.aliases).toEqual([{ locale: 'en-US', alias: 'Sci-Fi', editedBy: 'manual' }]);
  });

  it('projects only id, localized name, and count for the public item', () => {
    const category = categoryFixture();
    expect(toPublicCategoryListItem(category, 'zh-CN', 2)).toEqual({
      id: 'cat-scifi',
      name: '科幻小说',
      recordCount: 2,
    });

    // Missing locale falls back without claiming a translation.
    expect(toPublicCategoryListItem(category, 'fr-FR', 0)).toEqual({
      id: 'cat-scifi',
      name: 'Science Fiction',
      recordCount: 0,
    });

    const internal = toPublicCategoryListItem(category, 'en-US', 1);
    expect(internal).not.toHaveProperty('meaning');
    expect(internal).not.toHaveProperty('aliases');
    expect(internal).not.toHaveProperty('manualLocales');
    expect(internal).not.toHaveProperty('localizedNames');
  });

  it('returns null for a category without any label and keeps management fields', () => {
    const labelLess = buildPublicCategory({
      id: 'cat-empty',
      createdBy: 'manual',
      sourceLocale: null,
      meaning: null,
      labels: [],
      aliases: [],
    });
    expect(toPublicCategoryListItem(labelLess, 'en-US', 0)).toBeNull();

    const managed = toPublicCategoryManagementItem(categoryFixture(), 3);
    expect(managed.recordCount).toBe(3);
    expect(managed.meaning).toBe('Speculative fiction grounded in science or technology.');
  });

  it('normalizes names so manual reuse and uniqueness share one comparison key', () => {
    expect(normalizePublicCategoryName('  Science   Fiction ')).toBe(normalizePublicCategoryName('science fiction'));
    expect(normalizePublicCategoryName('C++')).toBe('c++');
  });
});

describe('public category assignment policy', () => {
  it('caps net-new assignments at the product limit', () => {
    expect(
      decideCategoryAssignment({
        incomingSource: 'manual',
        existingSource: null,
        assignmentCount: PUBLIC_CATEGORY_ASSIGNMENT_LIMIT - 1,
        suppressed: false,
      }),
    ).toBe('insert');
    expect(
      decideCategoryAssignment({
        incomingSource: 'manual',
        existingSource: null,
        assignmentCount: PUBLIC_CATEGORY_ASSIGNMENT_LIMIT,
        suppressed: false,
      }),
    ).toBe('limit');
    expect(
      decideCategoryAssignment({
        incomingSource: 'ai',
        existingSource: null,
        assignmentCount: PUBLIC_CATEGORY_ASSIGNMENT_LIMIT,
        suppressed: false,
      }),
    ).toBe('limit');
  });

  it('is idempotent for a repeated identical assignment', () => {
    expect(
      decideCategoryAssignment({
        incomingSource: 'manual',
        existingSource: 'manual',
        assignmentCount: 3,
        suppressed: true,
      }),
    ).toBe('noop');
    expect(
      decideCategoryAssignment({
        incomingSource: 'ai',
        existingSource: 'ai',
        assignmentCount: 3,
        suppressed: false,
      }),
    ).toBe('noop');
  });

  it('gives manual assignment precedence and never removes existing rows on a limit', () => {
    // A manual request promotes an AI-origin row to manual.
    expect(
      decideCategoryAssignment({
        incomingSource: 'manual',
        existingSource: 'ai',
        assignmentCount: 3,
        suppressed: true,
      }),
    ).toBe('promote');
    // AI never overrides a manual row, even when a suppression is absent.
    expect(
      decideCategoryAssignment({
        incomingSource: 'ai',
        existingSource: 'manual',
        assignmentCount: 0,
        suppressed: false,
      }),
    ).toBe('keep');
  });

  it('suppresses exact AI-origin removals so a retry cannot restore the pair', () => {
    expect(
      decideCategoryAssignment({
        incomingSource: 'ai',
        existingSource: null,
        assignmentCount: 0,
        suppressed: true,
      }),
    ).toBe('keep');
    // An explicit manual request clears suppression upstream, so it still inserts.
    expect(
      decideCategoryAssignment({
        incomingSource: 'manual',
        existingSource: null,
        assignmentCount: 0,
        suppressed: true,
      }),
    ).toBe('insert');
  });

  it('records suppression for any explicit removal, not just AI-origin assignments', () => {
    expect(shouldSuppressOnRemoval('ai')).toBe(true);
    expect(shouldSuppressOnRemoval('manual')).toBe(true);
    expect(shouldSuppressOnRemoval(null)).toBe(false);
  });
});
