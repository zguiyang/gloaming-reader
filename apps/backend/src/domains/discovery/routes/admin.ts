import { Hono } from 'hono';

import {
  assignCategoryToSourceRecord,
  createManagedCategory,
  deleteManagedCategory,
  listManagedCategories,
  listManagedCategorySourceRecords,
  unassignCategoryFromSourceRecord,
  updateManagedCategoryLabel,
} from '@/domains/discovery/categories';
import { listAdminSourceRecords } from '@/domains/discovery/read-model';
import {
  validateAdminSourceRecordListQuery,
  validateCategorySourceRecordListQuery,
  validateManagedCategoryWrite,
  validateSourceEnabledUpdate,
} from '@/domains/discovery/routes/validator';
import {
  getProjectGutenbergSourceStatus,
  requestProjectGutenbergSync,
  setProjectGutenbergSourceEnabled,
} from '@/domains/discovery/sync/admin';
import { resolveRequestLocale } from '@/infra/http/locale';
import { type AuthVariables, requireAdmin } from '@/infra/http/middleware/auth';
import { HTTP_STATUS } from '@/shared/constants';

/**
 * Admin-only Discovery controls. V1 exposes exactly the Project Gutenberg source
 * (status, enabled toggle, manual background sync trigger) plus stable public
 * category management, admin SourceRecord candidate search, and SourceRecord
 * category assignment. Every route is guarded by `requireAdmin`.
 */
export const discoveryAdminRoutes = new Hono<{ Variables: AuthVariables }>();

const PROJECT_GUTENBERG_SOURCE_PATH = '/api/admin/discovery/sources/project-gutenberg';

discoveryAdminRoutes.get(PROJECT_GUTENBERG_SOURCE_PATH, requireAdmin, async (c) => {
  return c.json(await getProjectGutenbergSourceStatus());
});

discoveryAdminRoutes.patch(PROJECT_GUTENBERG_SOURCE_PATH, requireAdmin, validateSourceEnabledUpdate, async (c) => {
  const { enabled } = c.req.valid('json');
  return c.json(await setProjectGutenbergSourceEnabled(enabled));
});

discoveryAdminRoutes.post(`${PROJECT_GUTENBERG_SOURCE_PATH}/sync`, requireAdmin, async (c) => {
  const accepted = await requestProjectGutenbergSync();
  return c.json(accepted, accepted.result === 'queued' ? HTTP_STATUS.ACCEPTED : HTTP_STATUS.OK);
});

const SOURCE_RECORDS_PATH = '/api/admin/discovery/source-records';

/**
 * Admin candidate search over every SourceRecord, including records hidden from
 * public Discover (unavailable, disabled source, or non-English). It reads only
 * `source_record`, so personal/private EPUB works never appear.
 */
discoveryAdminRoutes.get(SOURCE_RECORDS_PATH, requireAdmin, validateAdminSourceRecordListQuery, async (c) => {
  return c.json(await listAdminSourceRecords(c.req.valid('query'), { locale: resolveRequestLocale(c) }));
});

const CATEGORIES_PATH = '/api/admin/discovery/categories';

discoveryAdminRoutes.get(CATEGORIES_PATH, requireAdmin, async (c) => {
  return c.json(await listManagedCategories());
});

discoveryAdminRoutes.post(CATEGORIES_PATH, requireAdmin, validateManagedCategoryWrite, async (c) => {
  return c.json(await createManagedCategory(c.req.valid('json')), HTTP_STATUS.CREATED);
});

/** Hard delete of an unused category; 409 while any SourceRecord is still assigned. */
discoveryAdminRoutes.delete(`${CATEGORIES_PATH}/:categoryId`, requireAdmin, async (c) => {
  await deleteManagedCategory(c.req.param('categoryId'));
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});

/** Create or edit one localized label; reuses the existing category on collision. */
discoveryAdminRoutes.patch(
  `${CATEGORIES_PATH}/:categoryId/labels`,
  requireAdmin,
  validateManagedCategoryWrite,
  async (c) => {
    return c.json(await updateManagedCategoryLabel(c.req.param('categoryId'), c.req.valid('json')));
  },
);

const RECORD_CATEGORY_PATH = '/api/admin/discovery/source-records/:sourceRecordId/categories/:categoryId';

/** Paginated admin view of every SourceRecord assigned to one category. */
discoveryAdminRoutes.get(
  `${CATEGORIES_PATH}/:categoryId/source-records`,
  requireAdmin,
  validateCategorySourceRecordListQuery,
  async (c) => {
    return c.json(
      await listManagedCategorySourceRecords(c.req.param('categoryId'), c.req.valid('query'), resolveRequestLocale(c)),
    );
  },
);

/** Manual assignment; idempotent, capped at three, and wins over AI assignment. */
discoveryAdminRoutes.put(RECORD_CATEGORY_PATH, requireAdmin, async (c) => {
  await assignCategoryToSourceRecord(c.req.param('sourceRecordId'), c.req.param('categoryId'), 'manual');
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});

/** Manual removal; any explicit removal records exact suppression for the pair. */
discoveryAdminRoutes.delete(RECORD_CATEGORY_PATH, requireAdmin, async (c) => {
  await unassignCategoryFromSourceRecord(c.req.param('sourceRecordId'), c.req.param('categoryId'));
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});
