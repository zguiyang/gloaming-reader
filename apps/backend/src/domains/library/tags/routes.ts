import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from '@gloaming/i18n';
import { userTagWriteSchema } from '@gloaming/shared/library';

import { type AuthVariables, requireAuth } from '@/infra/http/middleware/auth';
import { sendValidationError } from '@/infra/http/response';
import { HTTP_STATUS } from '@/shared/constants';

import { getPersonalTaggingPreference, setPersonalTaggingPreference } from './personal-ai-tagging';
import {
  assignUserTag,
  completeUserTagTranslations,
  createUserTag,
  deleteUserTag,
  listUserTags,
  renameUserTag,
  unassignUserTag,
} from './service';

export const libraryTagRoutes = new Hono<{ Variables: AuthVariables }>();

const localeTagWriteSchema = userTagWriteSchema.extend({ locale: z.enum(SUPPORTED_LOCALES).optional() });

const validateUserTag = zValidator('json', localeTagWriteSchema, (result, c) => {
  if (!result.success) {
    return sendValidationError(
      c,
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
});

libraryTagRoutes.get('/api/library/tags', requireAuth, async (c) => {
  const user = c.get('user')!;
  return c.json(await listUserTags(user.id));
});

libraryTagRoutes.get('/api/settings/personal-tagging', requireAuth, async (c) => {
  const user = c.get('user')!;
  return c.json(await getPersonalTaggingPreference(user.id));
});

libraryTagRoutes.put(
  '/api/settings/personal-tagging',
  requireAuth,
  zValidator('json', z.object({ enabled: z.boolean() })),
  async (c) => {
    const user = c.get('user')!;
    const { enabled } = c.req.valid('json');
    await setPersonalTaggingPreference(user.id, enabled);
    return c.json(await getPersonalTaggingPreference(user.id));
  },
);

libraryTagRoutes.post('/api/library/tags', requireAuth, validateUserTag, async (c) => {
  const user = c.get('user')!;
  const input = c.req.valid('json');
  return c.json(await createUserTag(user.id, input.name, input.locale ?? DEFAULT_LOCALE), HTTP_STATUS.CREATED);
});

libraryTagRoutes.patch('/api/library/tags/:tagId', requireAuth, validateUserTag, async (c) => {
  const user = c.get('user')!;
  const input = c.req.valid('json');
  return c.json(await renameUserTag(user.id, c.req.param('tagId'), input.name, input.locale ?? DEFAULT_LOCALE));
});

libraryTagRoutes.post('/api/library/tags/:tagId/translations/complete', requireAuth, async (c) => {
  const user = c.get('user')!;
  return c.json(await completeUserTagTranslations(user.id, c.req.param('tagId')));
});

libraryTagRoutes.delete('/api/library/tags/:tagId', requireAuth, async (c) => {
  const user = c.get('user')!;
  await deleteUserTag(user.id, c.req.param('tagId'));
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});

libraryTagRoutes.put('/api/library/:workId/tags/:tagId', requireAuth, async (c) => {
  const user = c.get('user')!;
  await assignUserTag(user.id, c.req.param('workId'), c.req.param('tagId'));
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});

libraryTagRoutes.delete('/api/library/:workId/tags/:tagId', requireAuth, async (c) => {
  const user = c.get('user')!;
  await unassignUserTag(user.id, c.req.param('workId'), c.req.param('tagId'));
  return c.body(null, HTTP_STATUS.NO_CONTENT);
});
