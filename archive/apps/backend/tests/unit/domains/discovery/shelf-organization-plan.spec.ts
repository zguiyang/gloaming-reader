import { describe, expect, it } from 'vitest';

import {
  parseShelfOrganizationReply,
  planShelfOrganization,
} from '@/domains/discovery/categories/shelf-organization-plan';

const categories = [
  { id: 'fiction', zhName: '小说', enName: 'Fiction' },
  { id: 'history', zhName: '历史', enName: 'History' },
];

const unassigned = [
  { mappingId: 'novels', displayName: 'Novels' },
  { mappingId: 'art', displayName: 'Art' },
  { mappingId: 'music', displayName: 'Music' },
  { mappingId: 'travel', displayName: 'Travel Writing' },
];

describe('parseShelfOrganizationReply', () => {
  it('reads a fenced JSON object', () => {
    const parsed = parseShelfOrganizationReply(
      '```json\n{"assignments":[{"mappingId":"a","categoryId":"b"}],"proposals":[]}\n```',
    );
    expect(parsed.assignments).toEqual([{ mappingId: 'a', categoryId: 'b' }]);
  });
});

describe('parseShelfOrganizationReply', () => {
  it('reads a name-only proposal', () => {
    const parsed = parseShelfOrganizationReply(
      '{"assignments":[],"proposals":[{"name":"Society","mappingIds":["a","b"]}]}',
    );
    expect(parsed.proposals[0]).toMatchObject({ zhName: 'Society', enName: 'Society', mappingIds: ['a', 'b'] });
  });
});

describe('planShelfOrganization', () => {
  it('keeps assignments to existing categories and a broad multi-term proposal', () => {
    const plan = planShelfOrganization(categories, unassigned, {
      assignments: [{ mappingId: 'novels', categoryId: 'fiction' }],
      proposals: [
        {
          zhName: '艺术',
          enName: 'Art',
          rationale: 'Art and music are one broad reader category.',
          mappingIds: ['art', 'music'],
        },
      ],
    });

    expect(plan.assignments).toEqual([{ mappingId: 'novels', categoryId: 'fiction' }]);
    expect(plan.proposals).toEqual([
      {
        zhName: '艺术',
        enName: 'Art',
        rationale: 'Art and music are one broad reader category.',
        mappingIds: ['art', 'music'],
      },
    ]);
    expect(plan.untouchedMappingIds).toEqual(['travel']);
  });

  it('turns a proposal into an assignment when the name already exists', () => {
    const plan = planShelfOrganization(categories, unassigned, {
      assignments: [],
      proposals: [
        {
          zhName: '小说',
          enName: 'Stories',
          rationale: 'These are fiction.',
          mappingIds: ['novels', 'travel'],
        },
      ],
    });

    expect(plan.proposals).toEqual([]);
    expect(plan.assignments).toEqual([
      { mappingId: 'novels', categoryId: 'fiction' },
      { mappingId: 'travel', categoryId: 'fiction' },
    ]);
  });

  it('drops a proposal that covers only one leftover term', () => {
    const plan = planShelfOrganization(categories, unassigned, {
      assignments: [],
      proposals: [
        {
          zhName: '旅行',
          enName: 'Travel',
          rationale: 'Only one shelf.',
          mappingIds: ['travel'],
        },
      ],
    });

    expect(plan.proposals).toEqual([]);
    expect(plan.untouchedMappingIds).toContain('travel');
  });
});
