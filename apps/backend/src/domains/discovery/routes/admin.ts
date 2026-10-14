import { Hono } from 'hono';

import { discoveryGutenbergImportResultSchema } from '@gloaming/shared/discovery';
import { EPUB_UPLOAD_MAX_BYTES } from '@gloaming/shared/works';

import {
  assignCategoryToSourceRecord,
  createManagedCategory,
  listManagedCategories,
  listManagedCategorySourceRecords,
  unassignCategoryFromSourceRecord,
  updateManagedCategoryLabel,
} from '@/domains/discovery/categories';
import { GutenbergSnapshotError } from '@/domains/discovery/gutenberg/errors';
import {
  importProjectGutenbergSingleSample,
  isEpubUploadFileName,
  parseGutenbergExternalId,
} from '@/domains/discovery/gutenberg/single-record';
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
import { sendError } from '@/infra/http/response';
import { HTTP_STATUS } from '@/shared/constants';
import { ERROR_CODES } from '@/shared/errors/codes';

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

/**
 * Admin single-sample import: one uploaded EPUB (multipart, memory-only) plus a
 * required numeric `externalId` form field. Any `.epub` file name is accepted
 * case-insensitively; identity comes only from the id field, never the name.
 * The uploaded bytes are parsed and verified against the one exact RDF record
 * fetched for the id; nothing from the upload is persisted.
 */
discoveryAdminRoutes.post(`${PROJECT_GUTENBERG_SOURCE_PATH}/import`, requireAdmin, async (c) => {
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (contentLength > EPUB_UPLOAD_MAX_BYTES + 1024) {
    return sendError(c, ERROR_CODES.UPLOAD.FILE_TOO_LARGE, HTTP_STATUS.BAD_REQUEST, { maxMb: 50 });
  }

  const form = await c.req.parseBody();
  const keys = Object.keys(form).sort();
  if (keys.length !== 2 || keys[0] !== 'externalId' || keys[1] !== 'file') {
    return sendError(c, ERROR_CODES.VALIDATION_INVALID_INPUT, HTTP_STATUS.BAD_REQUEST);
  }
  const rawExternalId = form.externalId;
  const externalId = typeof rawExternalId === 'string' ? parseGutenbergExternalId(rawExternalId) : null;
  if (!externalId) {
    return sendError(c, ERROR_CODES.DISCOVERY.GUTENBERG_IMPORT_ID_INVALID, HTTP_STATUS.BAD_REQUEST);
  }

  const file = form.file;
  if (!file || typeof file !== 'object' || !('arrayBuffer' in file)) {
    return sendError(c, ERROR_CODES.UPLOAD.FILE_REQUIRED, HTTP_STATUS.BAD_REQUEST);
  }
  const sample = file as File;
  if (!isEpubUploadFileName(sample.name)) {
    return sendError(c, ERROR_CODES.DISCOVERY.GUTENBERG_IMPORT_FILE_INVALID, HTTP_STATUS.BAD_REQUEST);
  }

  const bytes = Buffer.from(await sample.arrayBuffer());
  if (bytes.length > EPUB_UPLOAD_MAX_BYTES) {
    return sendError(c, ERROR_CODES.UPLOAD.FILE_TOO_LARGE, HTTP_STATUS.BAD_REQUEST, { maxMb: 50 });
  }

  try {
    const result = await importProjectGutenbergSingleSample({ externalId, bytes });
    return c.json(discoveryGutenbergImportResultSchema.parse(result), HTTP_STATUS.CREATED);
  } catch (error) {
    // Upload bytes were memory-only; surface a sanitized summary only.
    const summary = error instanceof GutenbergSnapshotError ? error.message : null;
    return sendError(
      c,
      ERROR_CODES.DISCOVERY.GUTENBERG_IMPORT_FAILED,
      HTTP_STATUS.BAD_REQUEST,
      summary ? { reason: summary } : undefined,
    );
  }
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
