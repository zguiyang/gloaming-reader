import { normalizePublicCategoryName, publicCategoryNameSchema } from '@/shared/discovery';

/** New main categories suggested in one batch. Keeps the vocabulary broad. */
export const SHELF_ORGANIZATION_MAX_PROPOSALS = 3;

/** A new category needs a cluster of source terms, not a single narrow shelf. */
export const SHELF_ORGANIZATION_MIN_PROPOSAL_TERMS = 2;

/** Hard ceiling so later sources reuse categories instead of growing a new list. */
export const SHELF_ORGANIZATION_MAX_MAIN_CATEGORIES = 12;

export type ShelfOrganizationCategory = {
  id: string;
  zhName: string;
  enName: string;
};

export type ShelfOrganizationTerm = {
  mappingId: string;
  displayName: string;
  recordCount?: number;
};

export type ShelfOrganizationModelOutput = {
  assignments: Array<{ mappingId: string; categoryId: string }>;
  proposals: Array<{ zhName: string; enName: string; rationale: string; mappingIds: string[] }>;
};

function mappingIdsFrom(row: Record<string, unknown>): string[] {
  if (Array.isArray(row.mappingIds)) {
    return row.mappingIds.filter((id): id is string => typeof id === 'string');
  }
  if (!Array.isArray(row.mappings)) return [];
  return row.mappings.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const mappingId = (item as Record<string, unknown>).mappingId;
    return typeof mappingId === 'string' ? [mappingId] : [];
  });
}

const modelOutputSchema = {
  parse(value: unknown): ShelfOrganizationModelOutput {
    if (!value || typeof value !== 'object') {
      throw new Error('Shelf organization response was empty');
    }
    const record = value as Record<string, unknown>;
    const assignments = Array.isArray(record.assignments) ? record.assignments : [];
    const proposals = Array.isArray(record.proposals) ? record.proposals : [];
    return {
      assignments: assignments.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        const mappingId = typeof row.mappingId === 'string' ? row.mappingId : '';
        const categoryId = typeof row.categoryId === 'string' ? row.categoryId : '';
        if (!mappingId || !categoryId) return [];
        return [{ mappingId, categoryId }];
      }),
      proposals: proposals.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        const zhName = typeof row.zhName === 'string' ? row.zhName : typeof row.name === 'string' ? row.name : '';
        const enName = typeof row.enName === 'string' ? row.enName : typeof row.name === 'string' ? row.name : '';
        if (!zhName || !enName) return [];
        const rationale = typeof row.rationale === 'string' ? row.rationale : '';
        const mappingIds = mappingIdsFrom(row);
        return [{ zhName, enName, rationale, mappingIds }];
      }),
    };
  },
};

/** Read the first JSON object from a model reply, including fenced blocks. */
export function parseShelfOrganizationReply(text: string): ShelfOrganizationModelOutput {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('Shelf organization response did not contain JSON');
  }
  return modelOutputSchema.parse(JSON.parse(body.slice(start, end + 1)));
}

export type ShelfOrganizationPlan = {
  assignments: Array<{ mappingId: string; categoryId: string }>;
  proposals: Array<{ zhName: string; enName: string; rationale: string; mappingIds: string[] }>;
  untouchedMappingIds: string[];
};

function parseName(value: string): string | null {
  const parsed = publicCategoryNameSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * Keep only assignments onto known categories and proposals that still cover
 * at least two leftover source terms. A proposal whose name matches an existing
 * category becomes an assignment instead of a new category.
 */
export function planShelfOrganization(
  categories: ShelfOrganizationCategory[],
  unassigned: ShelfOrganizationTerm[],
  raw: ShelfOrganizationModelOutput,
  options?: { maxProposals?: number },
): ShelfOrganizationPlan {
  const unassignedIds = new Set(unassigned.map((term) => term.mappingId));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const categoryIdByName = new Map<string, string>();
  for (const category of categories) {
    for (const name of [category.zhName, category.enName]) {
      if (!name) continue;
      categoryIdByName.set(normalizePublicCategoryName(name), category.id);
    }
  }

  const used = new Set<string>();
  const assignments: ShelfOrganizationPlan['assignments'] = [];

  function assign(mappingId: string, categoryId: string): void {
    if (!unassignedIds.has(mappingId) || used.has(mappingId) || !categoryById.has(categoryId)) return;
    used.add(mappingId);
    assignments.push({ mappingId, categoryId });
  }

  for (const assignment of raw.assignments) {
    assign(assignment.mappingId, assignment.categoryId);
  }

  const proposalLimit = options?.maxProposals ?? SHELF_ORGANIZATION_MAX_PROPOSALS;
  const proposals: ShelfOrganizationPlan['proposals'] = [];
  for (const proposal of raw.proposals) {
    if (proposals.length >= proposalLimit) break;
    const mappingIds = [...new Set(proposal.mappingIds)].filter((id) => unassignedIds.has(id) && !used.has(id));
    if (mappingIds.length < SHELF_ORGANIZATION_MIN_PROPOSAL_TERMS) continue;
    const zhName = parseName(proposal.zhName);
    const enName = parseName(proposal.enName);
    if (!zhName || !enName) continue;

    const zhOwner = categoryIdByName.get(normalizePublicCategoryName(zhName));
    const enOwner = categoryIdByName.get(normalizePublicCategoryName(enName));
    if (zhOwner && enOwner && zhOwner !== enOwner) continue;
    const existingId = zhOwner ?? enOwner;
    if (existingId) {
      for (const mappingId of mappingIds) assign(mappingId, existingId);
      continue;
    }

    for (const mappingId of mappingIds) used.add(mappingId);
    proposals.push({
      zhName,
      enName,
      rationale: proposal.rationale.trim().slice(0, 300),
      mappingIds,
    });
  }

  return {
    assignments,
    proposals,
    untouchedMappingIds: unassigned.filter((term) => !used.has(term.mappingId)).map((term) => term.mappingId),
  };
}
