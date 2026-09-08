import { Hono } from 'hono';

import type { TaxonomyKind } from '@gloaming/shared/taxonomy';
import { TAXONOMY_KINDS } from '@gloaming/shared/taxonomy';

import { HTTP_STATUS } from '@/constants';
import { type AuthVariables, requireAdmin } from '@/middleware/auth';
import * as taxonomyService from '@/modules/taxonomy/service';
import {
  validateCreateTaxonomy,
  validateTaxonomyListQuery,
  validateUpdateTaxonomy,
} from '@/modules/taxonomy/validator';

export const taxonomyRoutes = new Hono<{ Variables: AuthVariables }>();

function parseKind(raw: string | undefined): TaxonomyKind | null {
  return raw && (TAXONOMY_KINDS as readonly string[]).includes(raw) ? (raw as TaxonomyKind) : null;
}

taxonomyRoutes.get('/api/admin/taxonomy/:kind', requireAdmin, validateTaxonomyListQuery, async (c) => {
  const kind = parseKind(c.req.param('kind'));
  if (!kind) return c.json({ error: 'kind 必须是 tag / category / source' }, HTTP_STATUS.BAD_REQUEST);
  const items = await taxonomyService.listTaxonomy(kind, c.req.valid('query'));
  return c.json({ items });
});

taxonomyRoutes.post('/api/admin/taxonomy/:kind', requireAdmin, validateCreateTaxonomy, async (c) => {
  const kind = parseKind(c.req.param('kind'));
  if (!kind) return c.json({ error: 'kind 必须是 tag / category / source' }, HTTP_STATUS.BAD_REQUEST);
  const item = await taxonomyService.createTaxonomyItem(kind, c.req.valid('json'));
  return c.json(item, HTTP_STATUS.CREATED);
});

taxonomyRoutes.patch('/api/admin/taxonomy/:kind/:id', requireAdmin, validateUpdateTaxonomy, async (c) => {
  const kind = parseKind(c.req.param('kind'));
  if (!kind) return c.json({ error: 'kind 必须是 tag / category / source' }, HTTP_STATUS.BAD_REQUEST);
  const item = await taxonomyService.updateTaxonomyItem(kind, c.req.param('id'), c.req.valid('json'));
  return c.json(item);
});

taxonomyRoutes.delete('/api/admin/taxonomy/:kind/:id', requireAdmin, async (c) => {
  const kind = parseKind(c.req.param('kind'));
  if (!kind) return c.json({ error: 'kind 必须是 tag / category / source' }, HTTP_STATUS.BAD_REQUEST);
  await taxonomyService.deleteTaxonomyItem(kind, c.req.param('id'));
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});

/** Prune unreferenced tags/categories — sources never delete. */
taxonomyRoutes.post('/api/admin/taxonomy/:kind/cleanup', requireAdmin, async (c) => {
  const kind = parseKind(c.req.param('kind'));
  if (!kind || kind === 'source') {
    return c.json({ error: 'cleanup 仅支持 tag / category' }, HTTP_STATUS.BAD_REQUEST);
  }
  const deleted = await taxonomyService.cleanupUnusedTaxonomy(kind);
  return c.json({ deleted });
});
