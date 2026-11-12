import { Hono } from 'hono';

import { getDictionaryConfig, putDictionaryConfig } from '@/server/domains/dictionary/config/service';
import { lookupWord, testDictionary } from '@/server/domains/dictionary/lookup';
import {
  validateLookupDictionaryQuery,
  validatePutDictionaryConfig,
  validateTestDictionary,
} from '@/server/domains/dictionary/validator';
import { workReadActorFromIdentity } from '@/server/domains/works/access';
import { type AuthVariables, requireAdmin } from '@/server/infra/http/middleware/auth';
import { rateLimit } from '@/server/infra/http/middleware/rate-limit';
import { sendError } from '@/server/infra/http/response';
import { HTTP_STATUS } from '@/server/shared/constants';
import { ERROR_CODES } from '@/server/shared/errors/codes';

export const dictionaryRoutes = new Hono<{ Variables: AuthVariables }>();

// Admin Config
dictionaryRoutes.get('/api/admin/dictionary/config', requireAdmin, async (c) => {
  return c.json(await getDictionaryConfig());
});

dictionaryRoutes.put('/api/admin/dictionary/config', requireAdmin, validatePutDictionaryConfig, async (c) => {
  return c.json(await putDictionaryConfig(c.req.valid('json')));
});

dictionaryRoutes.post('/api/admin/dictionary/test', requireAdmin, validateTestDictionary, async (c) => {
  return c.json(await testDictionary(workReadActorFromIdentity(c.get('user')), c.req.valid('json')));
});

// Public / Reader Lookup (open to guests and authenticated users)
dictionaryRoutes.get(
  '/api/dictionary/lookup',
  rateLimit('dictionaryLookup'),
  validateLookupDictionaryQuery,
  async (c) => {
    const query = c.req.valid('query');
    const entry = await lookupWord({
      actor: workReadActorFromIdentity(c.get('user')),
      word: query.word,
      contextSentence: query.contextSentence,
      workId: query.workId,
      partId: query.partId,
    });

    if (!entry) {
      return sendError(c, ERROR_CODES.NOT_FOUND.WORD_DEFINITION, HTTP_STATUS.NOT_FOUND, { word: query.word });
    }

    return c.json({ ok: true, entry });
  },
);
